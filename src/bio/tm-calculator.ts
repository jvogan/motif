/**
 * Advanced melting temperature (Tm) calculator.
 * Implements nearest-neighbor thermodynamics (SantaLucia 1998),
 * Wallace rule, and salt corrections (Owczarzy 2004/2008).
 * All functions are pure — no side effects.
 */

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

/** Initiation parameters (per terminal base-pair, SantaLucia 1998) */
const INIT_H = 0.1;   // kcal/mol (note: positive)
const INIT_S = -2.8;  // cal/mol·K

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
  /** dNTP concentration in mM, default 0 (affects free Mg2+) */
  dntpConcentration?: number;
  /** Salt correction formula, default 'owczarzy' */
  saltCorrection?: 'owczarzy' | 'santalucia' | 'wetmur';
}

// ─── Core thermodynamics ───────────────────────────────────────────────────

/**
 * Compute thermodynamic parameters (dH, dS, dG37) for a DNA duplex.
 * Uses nearest-neighbor parameters from SantaLucia 1998.
 * Input should be the 5'→3' sequence of the top strand (DNA, uppercase).
 */
export function duplexThermodynamics(seq: string): {
  deltaH: number;
  deltaS: number;
  deltaG37: number;
} {
  const upper = seq.toUpperCase().replace(/U/g, 'T');

  // Initiation: 2 terminal base-pairs
  // dH in kcal/mol → convert to cal/mol for consistency
  let dH = 2 * INIT_H * 1000; // cal/mol
  let dS = 2 * INIT_S;        // cal/mol·K

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
  gcFraction: number,
  seqLength: number,
): number {
  // Free Mg2+ = mgConc - dNTP (simplified: assume dNTP already deducted)
  const Mg = mgConc / 1000; // molar
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
    // Mixed Na+/Mg2+ regime (Owczarzy 2008, eq. 16)
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
  } else {
    // Mg2+ dominates (Owczarzy 2008, eq. 7)
    const a = 9.69e-5;
    const b = -1.02e-5;
    const c = 1.13e-4;
    const d = -3.17e-5;
    const e = -5.34e-4;
    const f = 6.32e-4;
    const g = 5.32e-5;
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
 * (R10 #5: the previous implementation applied the entropy coefficient 0.368
 * — units cal/mol·K — straight to 1/Tm with `1/seqLength` standing in for the
 * proper (N−1)/ΔH, an ~345× units error that returned sub-absolute-zero Tm
 * (≈ −254 °C) for any [Na+] below 1 M, non-monotonically. The only test
 * asserted merely `!isNaN`, so −254 passed CI.)
 */
function santaluciaSaltCorrection(
  tmK: number,
  naConc: number,
  seqLength: number,
  thermo?: { deltaH: number; deltaS: number; ctMolar: number },
): number {
  if (thermo && seqLength > 1) {
    const lnNaMolar = Math.log(naConc / 1000); // [Na+] in mol/L
    const dsCorrected = thermo.deltaS + 0.368 * (seqLength - 1) * lnNaMolar;
    const denom = dsCorrected + R * Math.log(thermo.ctMolar / 4);
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
  thermo?: { deltaH: number; deltaS: number; ctMolar: number },
): number {
  switch (method) {
    case 'santalucia':
      return santaluciaSaltCorrection(tmK, naConc, seqLength, thermo);
    case 'wetmur':
      return wetmurSaltCorrection(tmK, naConc);
    case 'owczarzy':
    default:
      if (mgConc > 0) {
        return owczarzyMg(tmK, naConc, mgConc, gcFraction, seqLength);
      }
      return owczarzyNa(tmK, naConc, gcFraction);
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
  const upper = seq.toUpperCase().replace(/U/g, 'T').replace(/[^ATGC]/g, '');

  if (upper.length === 0) {
    return { tm: 0, method: 'none', deltaH: 0, deltaS: 0, deltaG37: 0 };
  }

  const method = options?.method ?? 'nearest-neighbor';
  const naConc = options?.naConcentration ?? 50;
  const mgConc = options?.mgConcentration ?? 0;
  const primerConc = (options?.primerConcentration ?? 250) / 1e9; // nM → M
  const saltCorrMethod = options?.saltCorrection ?? 'owczarzy';

  // Deduct dNTPs from free Mg2+ (dNTPs chelate Mg2+)
  const dntpConc = options?.dntpConcentration ?? 0;
  const freeMg = Math.max(0, mgConc - dntpConc);

  const fGC = gcFraction(upper);

  // Wallace rule — always used for very short oligos (< 14 nt).
  //
  // Phase 35 P-I (P1-A13): the Owczarzy / SantaLucia / Wetmur salt-correction
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
    };
  }
  if (method === 'wallace') {
    const tm = wallaceTm(upper);
    // Apply salt correction if non-standard conditions
    let correctedTm = tm;
    if (naConc !== 1000 || freeMg > 0) {
      correctedTm = saltCorrectedTm(tm + 273.15, naConc, freeMg, fGC, upper.length, saltCorrMethod);
    }
    return {
      tm: Math.round(correctedTm * 10) / 10,
      method: 'wallace',
      deltaH: 0,
      deltaS: 0,
      deltaG37: 0,
    };
  }

  if (method === 'gc-adjusted') {
    const tm = gcAdjustedTm(upper);
    let correctedTm = tm;
    if (naConc !== 1000 || freeMg > 0) {
      correctedTm = saltCorrectedTm(tm + 273.15, naConc, freeMg, fGC, upper.length, saltCorrMethod);
    }
    return {
      tm: Math.round(correctedTm * 10) / 10,
      method: 'gc-adjusted',
      deltaH: 0,
      deltaS: 0,
      deltaG37: 0,
    };
  }

  // Nearest-neighbor (SantaLucia 1998)
  const { deltaH, deltaS, deltaG37 } = duplexThermodynamics(upper);

  // Ct = total strand concentration
  // For non-self-complementary oligos: Tm = dH / (dS + R * ln(Ct/4)) - 273.15
  const Ct = primerConc;
  const tmK = deltaH / (deltaS + R * Math.log(Ct / 4));
  const tmC = tmK - 273.15;

  // Apply salt correction. The SantaLucia method needs the duplex ΔH/ΔS (and
  // Ct), which only exist here on the NN path — thread them through so its
  // entropy-based correction is unit-correct (R10 #5).
  let correctedTm = tmC;
  if (naConc !== 1000 || freeMg > 0) {
    correctedTm = saltCorrectedTm(tmK, naConc, freeMg, fGC, upper.length, saltCorrMethod, {
      deltaH,
      deltaS,
      ctMolar: Ct,
    });
  }

  return {
    tm: Math.round(correctedTm * 10) / 10,
    method: 'nearest-neighbor (SantaLucia 1998)',
    deltaH,
    deltaS,
    deltaG37,
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
  const p = primer.toUpperCase().replace(/U/g, 'T').replace(/[^ATGC]/g, '');
  const t = template.toUpperCase().replace(/U/g, 'T').replace(/[^ATGC]/g, '');

  // Count mismatches over the shorter of the two
  const compareLen = Math.min(p.length, t.length);
  let mismatches = 0;
  for (let i = 0; i < compareLen; i++) {
    if (p[i] !== t[i]) mismatches++;
  }
  // Length difference counts as mismatches
  mismatches += Math.abs(p.length - t.length);

  // Calculate base Tm for the primer
  const baseTm = calculateTm(primer, options);

  // Penalize: each mismatch ≈ -1 kcal/mol dH, roughly -2–3°C Tm penalty
  // Approximate: ~3°C per mismatch (heuristic, position-dependent effects ignored)
  const penalty = mismatches * 3;

  return {
    ...baseTm,
    tm: Math.round((baseTm.tm - penalty) * 10) / 10,
    method: `${baseTm.method} with ${mismatches} mismatch${mismatches === 1 ? '' : 'es'}`,
  };
}
