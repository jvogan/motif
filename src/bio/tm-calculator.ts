/**
 * Advanced melting temperature (Tm) calculator.
 * Implements nearest-neighbor thermodynamics (SantaLucia 1998),
 * Wallace rule, and salt corrections (Owczarzy 2004/2008).
 * Primary references: https://doi.org/10.1073/pnas.95.4.1460 and
 * https://doi.org/10.1021/bi702363u.
 * All functions are pure — no side effects.
 */

import {
  inspectNucleotideSequence,
  isCanonicalDna,
  normalizeNucleotideSequence,
} from './nucleotide';
import { reverseComplement } from './reverse-complement';

// ─── Constants ─────────────────────────────────────────────────────────────

/** Gas constant (cal/mol·K) */
const R = 1.987;

/**
 * Nearest-neighbor thermodynamic parameters.
 * SantaLucia 1998 unified parameters, Table 2.
 * Keys: duplex written as XY/X'Y' (5'→3' / 3'→5').
 * dH in kcal/mol, dS in cal/mol·K.
 */
export const NN_PARAMS: Record<string, { dH: number; dS: number }> = {
  // Notation: "XY" means 5'-XY-3' paired with its complement
  'AA': { dH: -7.9, dS: -22.2 },   // AA/TT
  'AT': { dH: -7.2, dS: -20.4 },   // AT/TA
  'TA': { dH: -7.2, dS: -21.3 },   // TA/AT
  'CA': { dH: -8.5, dS: -22.7 },   // CA/GT
  'GT': { dH: -8.4, dS: -22.4 },   // GT/CA
  'CT': { dH: -7.8, dS: -21.0 },   // CT/GA
  'GA': { dH: -8.2, dS: -22.2 },   // GA/CT
  'CG': { dH: -10.6, dS: -27.2 },  // CG/GC
  'GC': { dH: -9.8, dS: -24.4 },   // GC/CG
  'GG': { dH: -8.0, dS: -19.9 },   // GG/CC
  // Reverse complements (symmetry)
  'TT': { dH: -7.9, dS: -22.2 },   // TT/AA = AA/TT
  'TG': { dH: -8.5, dS: -22.7 },   // TG/AC = CA/GT (complement)
  'AC': { dH: -8.4, dS: -22.4 },   // AC/TG = GT/CA (complement)
  'TC': { dH: -8.2, dS: -22.2 },   // TC/AG = GA/CT (complement)
  'AG': { dH: -7.8, dS: -21.0 },   // AG/TC = CT/GA (complement)
  'CC': { dH: -8.0, dS: -19.9 },   // CC/GG = GG/CC
};

/**
 * Initiation parameters from the unified DNA nearest-neighbor model
 * (SantaLucia 1998, Table 2).  The terminal base-pair contribution is
 * sequence-dependent; using the GC value at both ends materially biases AT-
 * ended oligos.  Values are in kcal/mol and cal/mol·K, respectively.
 */
export const DNA_NN_INITIATION = {
  terminalAT: { dH: 2.3, dS: 4.1 },
  terminalGC: { dH: 0.1, dS: -2.8 },
  symmetry: { dH: 0, dS: -1.4 },
} as const;

export interface DuplexThermodynamicsOptions {
  /** Apply the C2 symmetry entropy penalty for a self-complementary duplex. */
  selfComplementary?: boolean;
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TmResult {
  /** Melting temperature in °C */
  tm: number;
  /** Which calculation method was used */
  method: string;
  /** Duplex enthalpy in cal/mol (negative for stable duplexes) */
  deltaH: number;
  /** Duplex entropy in cal/mol·K (negative for stable duplexes) */
  deltaS: number;
  /** Duplex free energy at 37°C in cal/mol */
  deltaG37: number;
  /** Whether the result is exact, ambiguity-limited, or invalid. */
  status: 'exact' | 'ambiguous' | 'invalid';
  /** Exact sequence after formatting whitespace/case/RNA normalization. */
  evaluatedSequence: string;
  /** Human-readable reason when an exact Tm was not evaluated. */
  message?: string;
}

export interface TmOptions {
  /** Calculation method, default 'nearest-neighbor' */
  method?: 'nearest-neighbor' | 'wallace' | 'gc-adjusted';
  /** Na+ concentration in mM, default 50 */
  naConcentration?: number;
  /** Mg2+ concentration in mM, default 0 */
  mgConcentration?: number;
  /** Primer/oligonucleotide concentration in nM, default 250 */
  primerConcentration?: number;
  /** Total dNTP concentration in mM, summed across dATP+dCTP+dGTP+dTTP (affects free Mg2+). */
  dntpConcentration?: number;
  /** Salt correction formula, default 'owczarzy' */
  saltCorrection?: 'owczarzy' | 'santalucia' | 'wetmur';
  /** Override automatic self-complementarity detection for a duplex. */
  selfComplementary?: boolean;
}

export const MAX_NA_CONCENTRATION_MILLIMOLAR = 1_000;
export const MAX_DIVALENT_CONCENTRATION_MILLIMOLAR = 100;
export const MAX_PRIMER_CONCENTRATION_NANOMOLAR = 1_000_000_000;

function invalidTmResult(
  evaluatedSequence: string,
  status: 'ambiguous' | 'invalid',
  message: string,
): TmResult {
  return {
    tm: 0,
    method: 'none',
    deltaH: 0,
    deltaS: 0,
    deltaG37: 0,
    status,
    evaluatedSequence,
    message,
  };
}

function validateFiniteConcentration(
  name: string,
  value: number,
  minimum: number,
  maximum: number,
  allowZero: boolean,
): string | null {
  if (!Number.isFinite(value)) return `${name} must be finite.`;
  if (allowZero ? value < minimum : value <= minimum) return `${name} must be ${allowZero ? 'non-negative' : 'greater than zero'}.`;
  if (value > maximum) return `${name} exceeds the supported physical bound of ${maximum}.`;
  return null;
}

function validateTmOptions(options: TmOptions | undefined): string | null {
  const method = options?.method ?? 'nearest-neighbor';
  if (!['nearest-neighbor', 'wallace', 'gc-adjusted'].includes(method)) {
    return `Unsupported Tm method: ${String(method)}.`;
  }
  const saltCorrection = options?.saltCorrection ?? 'owczarzy';
  if (!['owczarzy', 'santalucia', 'wetmur'].includes(saltCorrection)) {
    return `Unsupported salt-correction method: ${String(saltCorrection)}.`;
  }
  const na = options?.naConcentration ?? 50;
  const mg = options?.mgConcentration ?? 0;
  const dntp = options?.dntpConcentration ?? 0;
  const primer = options?.primerConcentration ?? 250;
  return validateFiniteConcentration('Na+ concentration', na, 0, MAX_NA_CONCENTRATION_MILLIMOLAR, false)
    ?? validateFiniteConcentration('Mg2+ concentration', mg, 0, MAX_DIVALENT_CONCENTRATION_MILLIMOLAR, true)
    ?? validateFiniteConcentration('dNTP concentration', dntp, 0, MAX_DIVALENT_CONCENTRATION_MILLIMOLAR, true)
    ?? validateFiniteConcentration('primer concentration', primer, 0, MAX_PRIMER_CONCENTRATION_NANOMOLAR, false);
}

function validateThermoInput(
  thermo: { deltaH: number; deltaS: number; ctMolar: number; selfComplementary?: boolean } | undefined,
): string | null {
  if (!thermo) return null;
  if (!Number.isFinite(thermo.deltaH) || !Number.isFinite(thermo.deltaS)) {
    return 'Thermodynamic enthalpy and entropy must be finite.';
  }
  if (!Number.isFinite(thermo.ctMolar) || thermo.ctMolar <= 0 || thermo.ctMolar > 1) {
    return 'Thermodynamic strand concentration must be finite, greater than zero, and at most 1 M.';
  }
  return null;
}

/**
 * Resolve free Mg2+ in the presence of total dNTPs using Owczarzy et al. 2008
 * eq. 17. Concentrations are molar. The paper notes that total Mg minus
 * total dNTP is a good approximation when Mg is in clear excess; using the
 * equilibrium quadratic throughout also behaves correctly when dNTP >= Mg.
 */
export function freeMagnesiumConcentration(
  totalMgMolar: number,
  totalDntpMolar: number,
): number {
  if (!Number.isFinite(totalMgMolar) || totalMgMolar < 0) {
    throw new RangeError('Total Mg2+ concentration must be finite and non-negative.');
  }
  if (!Number.isFinite(totalDntpMolar) || totalDntpMolar < 0) {
    throw new RangeError('Total dNTP concentration must be finite and non-negative.');
  }
  if (totalMgMolar === 0) return 0;
  if (totalDntpMolar === 0) return totalMgMolar;

  // Ka is the Mg:dNTP association constant reported by Owczarzy et al.
  // (the reciprocal of the dissociation constant used in the equilibrium).
  const associationConstant = 3e4;
  const linear = 1 + associationConstant * (totalDntpMolar - totalMgMolar);
  const discriminant = linear * linear + 4 * associationConstant * totalMgMolar;
  const root = (-linear + Math.sqrt(discriminant)) / (2 * associationConstant);
  // Roundoff can produce a tiny negative value at the boundary; physical free
  // magnesium is bounded by the total concentration.
  return Math.min(totalMgMolar, Math.max(0, root));
}

// ─── Core thermodynamics ───────────────────────────────────────────────────

/**
 * Compute thermodynamic parameters (dH, dS, dG37) for a DNA duplex.
 * Uses nearest-neighbor parameters from SantaLucia 1998.
 * Input should be the 5'→3' sequence of the top strand (DNA, uppercase).
 */
export function duplexThermodynamics(
  seq: string,
  options: DuplexThermodynamicsOptions = {},
): {
  deltaH: number;
  deltaS: number;
  deltaG37: number;
} {
  return duplexThermodynamicsWithOptions(seq, options);
}

/**
 * Compute nearest-neighbor thermodynamics with explicit duplex assumptions.
 * This is kept separate from the legacy one-argument wrapper so existing
 * callers remain source-compatible while Tm and secondary-structure callers
 * share the same terminal and symmetry primitives.
 */
export function duplexThermodynamicsWithOptions(
  seq: string,
  options: DuplexThermodynamicsOptions = {},
): {
  deltaH: number;
  deltaS: number;
  deltaG37: number;
} {
  const upper = normalizeNucleotideSequence(seq);
  if (!isCanonicalDna(upper)) {
    throw new Error('Nearest-neighbor thermodynamics requires an unambiguous A/C/G/T sequence.');
  }
  if (upper.length < 2) {
    throw new Error('Nearest-neighbor thermodynamics requires at least two canonical bases.');
  }

  // Two sequence-dependent terminal initiation contributions. dH in kcal/mol
  // is converted to cal/mol for consistency with the NN table.
  const firstTerminal = /[AT]/.test(upper[0])
    ? DNA_NN_INITIATION.terminalAT
    : DNA_NN_INITIATION.terminalGC;
  const lastTerminal = /[AT]/.test(upper[upper.length - 1])
    ? DNA_NN_INITIATION.terminalAT
    : DNA_NN_INITIATION.terminalGC;
  let dH = (firstTerminal.dH + lastTerminal.dH) * 1000;
  let dS = firstTerminal.dS + lastTerminal.dS;

  // Sum nearest-neighbor contributions
  for (let i = 0; i < upper.length - 1; i++) {
    const dinuc = upper[i] + upper[i + 1];
    const params = NN_PARAMS[dinuc];
    if (params) {
      dH += params.dH * 1000; // kcal → cal
      dS += params.dS;
    }
    // Unknown dinucleotide: skip (best-effort for degenerate sequences)
  }

  if (options.selfComplementary) {
    dH += DNA_NN_INITIATION.symmetry.dH * 1000;
    dS += DNA_NN_INITIATION.symmetry.dS;
  }

  const T37 = 310.15; // 37°C in Kelvin
  const dG37 = dH - T37 * dS;

  return { deltaH: dH, deltaS: dS, deltaG37: dG37 };
}

// ─── Salt correction ───────────────────────────────────────────────────────

/**
 * Apply Owczarzy et al. (2004) Na+ salt correction to Tm.
 * Tm is in Kelvin here; we accept/return Kelvin for precision.
 * naConc in mM. Returns corrected Tm in °C.
 */
function owczarzyNa(tmK: number, naConc: number, gcFraction: number): number {
  const ln_Na = Math.log(naConc / 1000); // molar
  const inv_Tm_corrected =
    1 / tmK +
    (4.29 * gcFraction - 3.95) * 1e-5 * ln_Na +
    9.40e-6 * ln_Na * ln_Na;
  return 1 / inv_Tm_corrected - 273.15;
}

/**
 * Apply Owczarzy et al. (2008) Mg2+ correction.
 * naConc and mgConc in mM. Returns corrected Tm in °C.
 */
function owczarzyMg(
  tmK: number,
  naConc: number,
  mgConc: number,
  dntpConc: number,
  gcFraction: number,
  seqLength: number,
): number {
  const Mg = freeMagnesiumConcentration(mgConc / 1000, dntpConc / 1000);
  const Na = naConc / 1000; // molar

  if (Mg === 0) {
    return owczarzyNa(tmK, naConc, gcFraction);
  }

  // Ratio determines which formula to apply
  const ratio = Math.sqrt(Mg) / Na;

  let inv_Tm_corrected: number;

  if (ratio < 0.22) {
    // Na+ dominates — use Na correction
    return owczarzyNa(tmK, naConc, gcFraction);
  } else if (ratio < 6.0) {
    // Mixed Na+/Mg2+ regime (Owczarzy 2008, eqs. 16 and 18–20). The
    // monovalent-dependent a, d and g terms are essential in this branch.
    const ln_Na = Math.log(Na);
    const a = 3.92e-5 * (0.843 - 0.352 * Math.sqrt(Na) * ln_Na);
    const b = -9.11e-6;
    const c = 6.26e-5;
    const d = 1.42e-5 * (1.279 - 4.03e-3 * ln_Na - 8.03e-3 * ln_Na * ln_Na);
    const e = -4.82e-4;
    const f = 5.25e-4;
    const g = 8.31e-5 * (0.486 - 0.258 * ln_Na + 5.25e-3 * ln_Na * ln_Na * ln_Na);
    const ln_Mg = Math.log(Mg);
    inv_Tm_corrected =
      1 / tmK +
      a + b * ln_Mg +
      gcFraction * (c + d * ln_Mg) +
      (1 / (2 * (seqLength - 1))) * (e + f * ln_Mg + g * ln_Mg * ln_Mg);
    return 1 / inv_Tm_corrected - 273.15;
  } else {
    // Mg2+ dominates: use the constant Eq. 16 coefficients, as required by
    // Owczarzy et al. 2008 once R >= 6.
    const a = 3.92e-5;
    const b = -9.11e-6;
    const c = 6.26e-5;
    const d = 1.42e-5;
    const e = -4.82e-4;
    const f = 5.25e-4;
    const g = 8.31e-5;
    const ln_Mg = Math.log(Mg);
    inv_Tm_corrected =
      1 / tmK +
      a + b * ln_Mg +
      gcFraction * (c + d * ln_Mg) +
      (1 / (2 * (seqLength - 1))) * (e + f * ln_Mg + g * ln_Mg * ln_Mg);
    return 1 / inv_Tm_corrected - 273.15;
  }
}

/**
 * Apply the SantaLucia 1998 salt correction.
 *
 * The published correction adjusts the duplex ENTROPY:
 *   ΔS(Na+) = ΔS(1M) + 0.368 · (N − 1) · ln[Na+]      ([Na+] in mol/L)
 * and then Tm = ΔH / (ΔS(Na+) + R·ln(Ct/4)). It therefore needs the
 * nearest-neighbor ΔH/ΔS, which only exist on the NN path; when they are
 * supplied via `thermo` we apply that entropy form directly. For the
 * thermodynamics-free methods (Wallace, GC-adjusted) we fall back to the
 * log10 Tm form Tm(1M) + 16.6·log10[Na+], which is physical and monotonic.
 *
 * naConc in mM. Returns corrected Tm in °C.
 *
 * The previous implementation applied the entropy coefficient 0.368
 * — units cal/mol·K — straight to 1/Tm with `1/seqLength` standing in for the
 * proper (N−1)/ΔH, an ~345× units error that returned sub-absolute-zero Tm
 * (≈ −254 °C) for any [Na+] below 1 M, non-monotonically. The only test
 * asserted merely `!isNaN`, so −254 passed CI.)
 */
function santaluciaSaltCorrection(
  tmK: number,
  naConc: number,
  seqLength: number,
  thermo?: { deltaH: number; deltaS: number; ctMolar: number; selfComplementary?: boolean },
): number {
  if (thermo && seqLength > 1) {
    const lnNaMolar = Math.log(naConc / 1000); // [Na+] in mol/L
    const dsCorrected = thermo.deltaS + 0.368 * (seqLength - 1) * lnNaMolar;
    const concentrationFactor = thermo.selfComplementary ? 1 : 4;
    const denom = dsCorrected + R * Math.log(thermo.ctMolar / concentrationFactor);
    const tmKCorrected = thermo.deltaH / denom;
    if (Number.isFinite(tmKCorrected) && tmKCorrected > 0) {
      return tmKCorrected - 273.15;
    }
    // Degenerate denominator (pathological inputs) — fall through to the
    // empirical form rather than emit a non-physical value.
  }
  return tmK - 273.15 + 16.6 * Math.log10(naConc / 1000);
}

/**
 * Apply Wetmur 1991 salt correction.
 * naConc in mM. Returns corrected Tm in °C.
 */
function wetmurSaltCorrection(tmK: number, naConc: number): number {
  // Tm(Na) ≈ Tm(1M) + 16.6 * log10([Na+])
  const correction = 16.6 * Math.log10(naConc / 1000);
  return tmK - 273.15 + correction;
}

/**
 * Apply salt correction to a Tm (in K) and return corrected Tm in °C.
 */
export function saltCorrectedTm(
  tmK: number,
  naConc: number,
  mgConc = 0,
  gcFraction = 0.5,
  seqLength = 20,
  method: 'owczarzy' | 'santalucia' | 'wetmur' = 'owczarzy',
  thermo?: { deltaH: number; deltaS: number; ctMolar: number; selfComplementary?: boolean },
  dntpConc = 0,
): number {
  if (!Number.isFinite(tmK) || tmK <= 0) throw new RangeError('Tm must be a finite temperature in Kelvin.');
  const naError = validateFiniteConcentration('Na+ concentration', naConc, 0, MAX_NA_CONCENTRATION_MILLIMOLAR, false);
  if (naError) throw new RangeError(naError);
  const mgError = validateFiniteConcentration('Mg2+ concentration', mgConc, 0, MAX_DIVALENT_CONCENTRATION_MILLIMOLAR, true);
  if (mgError) throw new RangeError(mgError);
  const dntpError = validateFiniteConcentration('dNTP concentration', dntpConc, 0, MAX_DIVALENT_CONCENTRATION_MILLIMOLAR, true);
  if (dntpError) throw new RangeError(dntpError);
  if (!Number.isFinite(gcFraction) || gcFraction < 0 || gcFraction > 1) {
    throw new RangeError('GC fraction must be finite and between 0 and 1.');
  }
  if (!Number.isInteger(seqLength) || seqLength < 2) {
    throw new RangeError('Sequence length must be an integer of at least 2 bases.');
  }
  const thermoError = validateThermoInput(thermo);
  if (thermoError) throw new RangeError(thermoError);
  switch (method) {
    case 'santalucia':
      return santaluciaSaltCorrection(tmK, naConc, seqLength, thermo);
    case 'wetmur':
      return wetmurSaltCorrection(tmK, naConc);
    case 'owczarzy':
      if (mgConc > 0) {
        return owczarzyMg(tmK, naConc, mgConc, dntpConc, gcFraction, seqLength);
      }
      return owczarzyNa(tmK, naConc, gcFraction);
    default:
      throw new RangeError(`Unsupported salt-correction method: ${String(method)}.`);
  }
}

// ─── GC fraction helper ────────────────────────────────────────────────────

function gcFraction(seq: string): number {
  const upper = seq.toUpperCase();
  const gc = (upper.match(/[GC]/g) ?? []).length;
  const total = (upper.match(/[ATGCU]/g) ?? []).length;
  return total > 0 ? gc / total : 0.5;
}

// ─── Wallace rule ──────────────────────────────────────────────────────────

function wallaceTm(seq: string): number {
  const upper = seq.toUpperCase();
  const A = (upper.match(/A/g) ?? []).length;
  const T = (upper.match(/[TU]/g) ?? []).length;
  const G = (upper.match(/G/g) ?? []).length;
  const C = (upper.match(/C/g) ?? []).length;
  return 2 * (A + T) + 4 * (G + C);
}

// ─── GC-adjusted Tm ───────────────────────────────────────────────────────

function gcAdjustedTm(seq: string): number {
  const upper = seq.toUpperCase();
  const G = (upper.match(/G/g) ?? []).length;
  const C = (upper.match(/C/g) ?? []).length;
  const total = (upper.match(/[ATGCU]/g) ?? []).length;
  if (total === 0) return 0;
  return 64.9 + 41 * (G + C - 16.4) / total;
}

// ─── Main Tm calculator ───────────────────────────────────────────────────

/**
 * Calculate melting temperature for a DNA oligonucleotide.
 *
 * For sequences ≤ 13 nt, Wallace rule is used regardless of method
 * (nearest-neighbor is inaccurate for very short oligos).
 */
export function calculateTm(seq: string, options?: TmOptions): TmResult {
  const inspected = inspectNucleotideSequence(seq);
  const upper = inspected.sequence;

  const optionError = validateTmOptions(options);
  if (optionError) return invalidTmResult(upper, 'invalid', optionError);

  if (inspected.invalidCharacters.length > 0) {
    return invalidTmResult(
      upper,
      'invalid',
      `Tm requires nucleotide characters only; invalid input: ${inspected.invalidCharacters.join(', ')}.`,
    );
  }

  if (inspected.ambiguous) {
    return invalidTmResult(
      upper,
      'ambiguous',
      'Tm was not evaluated because the oligo contains IUPAC ambiguity symbols. Use an unambiguous ordered sequence or evaluate an explicit range externally.',
    );
  }

  if (upper.length === 0) {
    return invalidTmResult(upper, 'invalid', 'Tm requires a non-empty oligonucleotide.');
  }

  const method = options?.method ?? 'nearest-neighbor';
  const naConc = options?.naConcentration ?? 50;
  const mgConc = options?.mgConcentration ?? 0;
  const primerConc = (options?.primerConcentration ?? 250) / 1e9; // nM → M
  const saltCorrMethod = options?.saltCorrection ?? 'owczarzy';

  // Keep total Mg and total dNTP concentrations separate. Owczarzy's complete
  // equilibrium treatment is applied by the salt-correction decision tree;
  // pre-subtracting here would make the dNTP >= Mg branch impossible.
  const dntpConc = options?.dntpConcentration ?? 0;

  const fGC = gcFraction(upper);

  // Wallace rule — always used for very short oligos (< 14 nt).
  //
  // The Owczarzy / SantaLucia / Wetmur salt-correction
  // formulas are derived for oligos ≥ 14 nt. Applying them to a 6-mer produces
  // non-physical Tm values (e.g. negative Tm for `AAAAAA` at default 50mM Na+).
  // Wallace's rule assumes ~1 M Na+ implicitly, so for the short-oligo regime
  // we now return the pure Wallace Tm without salt correction and label it
  // explicitly. Long oligos (`method === 'wallace'` deliberately on ≥14 nt)
  // still get the correction so users can compare buffer conditions.
  if (upper.length < 14) {
    const tm = wallaceTm(upper);
    return {
      tm: Math.round(tm * 10) / 10,
      method: 'wallace (short, no salt correction)',
      deltaH: 0,
      deltaS: 0,
      deltaG37: 0,
      status: 'exact',
      evaluatedSequence: upper,
    };
  }
  if (method === 'wallace') {
    const tm = wallaceTm(upper);
    // Apply salt correction if non-standard conditions
    let correctedTm = tm;
    if (naConc !== 1000 || mgConc > 0) {
      correctedTm = saltCorrectedTm(tm + 273.15, naConc, mgConc, fGC, upper.length, saltCorrMethod, undefined, dntpConc);
    }
    return {
      tm: Math.round(correctedTm * 10) / 10,
      method: 'wallace',
      deltaH: 0,
      deltaS: 0,
      deltaG37: 0,
      status: 'exact',
      evaluatedSequence: upper,
    };
  }

  if (method === 'gc-adjusted') {
    const tm = gcAdjustedTm(upper);
    let correctedTm = tm;
    if (naConc !== 1000 || mgConc > 0) {
      correctedTm = saltCorrectedTm(tm + 273.15, naConc, mgConc, fGC, upper.length, saltCorrMethod, undefined, dntpConc);
    }
    return {
      tm: Math.round(correctedTm * 10) / 10,
      method: 'gc-adjusted',
      deltaH: 0,
      deltaS: 0,
      deltaG37: 0,
      status: 'exact',
      evaluatedSequence: upper,
    };
  }

  // Nearest-neighbor (SantaLucia 1998)
  const selfComplementary = options?.selfComplementary ?? upper === reverseComplement(upper);
  const { deltaH, deltaS, deltaG37 } = duplexThermodynamicsWithOptions(upper, { selfComplementary });

  // Ct = total strand concentration
  // For non-self-complementary oligos: Ct/4. A self-complementary duplex has
  // a single strand species and uses Ct, with the SantaLucia symmetry entropy
  // penalty included above.
  const Ct = primerConc;
  const concentrationFactor = selfComplementary ? 1 : 4;
  const tmK = deltaH / (deltaS + R * Math.log(Ct / concentrationFactor));
  const tmC = tmK - 273.15;

  // Apply salt correction. The SantaLucia method needs the duplex ΔH/ΔS (and
  // Ct), which only exist here on the NN path — thread them through so its
  // entropy-based correction is unit-correct.
  let correctedTm = tmC;
  if (naConc !== 1000 || mgConc > 0) {
    correctedTm = saltCorrectedTm(tmK, naConc, mgConc, fGC, upper.length, saltCorrMethod, {
      deltaH,
      deltaS,
      ctMolar: Ct,
      selfComplementary,
    }, dntpConc);
  }

  return {
    tm: Math.round(correctedTm * 10) / 10,
    method: 'nearest-neighbor (SantaLucia 1998)',
    deltaH,
    deltaS,
    deltaG37,
    status: 'exact',
    evaluatedSequence: upper,
  };
}

/**
 * Calculate Tm for a primer against a specific template.
 * Accounts for mismatches: each mismatch reduces dH by ~1 kcal/mol.
 */
export function primerTm(
  primer: string,
  template: string,
  options?: TmOptions,
): TmResult {
  const inspectedPrimer = inspectNucleotideSequence(primer);
  const inspectedTemplate = inspectNucleotideSequence(template);
  const baseTm = calculateTm(primer, options);
  const invalid = [...new Set([
    ...inspectedPrimer.invalidCharacters,
    ...inspectedTemplate.invalidCharacters,
  ])];
  const ambiguous = inspectedPrimer.ambiguous || inspectedTemplate.ambiguous;
  if (invalid.length > 0 || ambiguous) {
    return {
      ...baseTm,
      status: invalid.length > 0 ? 'invalid' : 'ambiguous',
      evaluatedSequence: inspectedPrimer.sequence,
      message: invalid.length > 0
        ? `Primer/template comparison contains invalid nucleotide input: ${invalid.join(', ')}.`
        : 'Primer/template comparison was not evaluated because the primer or template contains IUPAC ambiguity symbols.',
    };
  }
  const p = inspectedPrimer.sequence;
  const t = inspectedTemplate.sequence;

  // Count mismatches over the shorter of the two
  const compareLen = Math.min(p.length, t.length);
  let mismatches = 0;
  for (let i = 0; i < compareLen; i++) {
    if (p[i] !== t[i]) mismatches++;
  }
  // Length difference counts as mismatches
  mismatches += Math.abs(p.length - t.length);

  // Penalize: each mismatch ≈ -1 kcal/mol dH, roughly -2–3°C Tm penalty
  // Approximate: ~3°C per mismatch (heuristic, position-dependent effects ignored)
  const penalty = mismatches * 3;

  return {
    ...baseTm,
    tm: Math.round((baseTm.tm - penalty) * 10) / 10,
    method: `${baseTm.method} with ${mismatches} mismatch${mismatches === 1 ? '' : 'es'}`,
  };
}
