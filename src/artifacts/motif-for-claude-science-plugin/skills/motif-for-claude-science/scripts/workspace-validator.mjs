// Generated from src/artifacts/claude-science-workspace-envelope.ts. Regenerate with the documented esbuild command; do not edit by hand.

// src/bio/codon-tables.ts
var STANDARD_CODE = {
  id: 1,
  name: "Standard",
  codons: {
    TTT: "F",
    TTC: "F",
    TTA: "L",
    TTG: "L",
    CTT: "L",
    CTC: "L",
    CTA: "L",
    CTG: "L",
    ATT: "I",
    ATC: "I",
    ATA: "I",
    ATG: "M",
    GTT: "V",
    GTC: "V",
    GTA: "V",
    GTG: "V",
    TCT: "S",
    TCC: "S",
    TCA: "S",
    TCG: "S",
    CCT: "P",
    CCC: "P",
    CCA: "P",
    CCG: "P",
    ACT: "T",
    ACC: "T",
    ACA: "T",
    ACG: "T",
    GCT: "A",
    GCC: "A",
    GCA: "A",
    GCG: "A",
    TAT: "Y",
    TAC: "Y",
    TAA: "*",
    TAG: "*",
    CAT: "H",
    CAC: "H",
    CAA: "Q",
    CAG: "Q",
    AAT: "N",
    AAC: "N",
    AAA: "K",
    AAG: "K",
    GAT: "D",
    GAC: "D",
    GAA: "E",
    GAG: "E",
    TGT: "C",
    TGC: "C",
    TGA: "*",
    TGG: "W",
    CGT: "R",
    CGC: "R",
    CGA: "R",
    CGG: "R",
    AGT: "S",
    AGC: "S",
    AGA: "R",
    AGG: "R",
    GGT: "G",
    GGC: "G",
    GGA: "G",
    GGG: "G"
  },
  // The initiator list is distinct from the residue map: NCBI Table 1 marks
  // TTG and CTG as alternative starts even though both encode Leu internally.
  // See https://www.ncbi.nlm.nih.gov/Taxonomy/Utils/wprintgc.cgi?mode=t#SG1.
  starts: ["TTG", "CTG", "ATG"],
  stops: ["TAA", "TAG", "TGA"]
};
var VERTEBRATE_MITO_CODE = {
  id: 2,
  name: "Vertebrate Mitochondrial",
  codons: {
    ...STANDARD_CODE.codons,
    TGA: "W",
    ATA: "M",
    AGA: "*",
    AGG: "*"
  },
  starts: ["ATT", "ATC", "ATA", "ATG", "GTG"],
  stops: ["TAA", "TAG", "AGA", "AGG"]
};
var INVERTEBRATE_MITO_CODE = {
  id: 5,
  name: "Invertebrate Mitochondrial",
  codons: {
    ...STANDARD_CODE.codons,
    TGA: "W",
    ATA: "M",
    AGA: "S",
    AGG: "S"
  },
  starts: ["ATT", "ATC", "ATA", "ATG", "GTG", "TTG"],
  stops: ["TAA", "TAG"]
};
var BACTERIAL_CODE = {
  id: 11,
  name: "Bacterial, Archaeal and Plant Plastid",
  codons: { ...STANDARD_CODE.codons },
  starts: ["ATG", "GTG", "TTG", "ATT", "CTG", "ATC", "ATA"],
  stops: ["TAA", "TAG", "TGA"]
};
var ASCIDIAN_MITO_CODE = {
  id: 13,
  name: "Ascidian Mitochondrial",
  codons: {
    ...STANDARD_CODE.codons,
    TGA: "W",
    ATA: "M",
    AGA: "G",
    AGG: "G"
  },
  starts: ["ATG", "GTG", "TTG", "ATA"],
  stops: ["TAA", "TAG"]
};
var SCENEDESMUS_MITO_CODE = {
  id: 22,
  name: "Scenedesmus obliquus Mitochondrial",
  codons: {
    ...STANDARD_CODE.codons,
    TCA: "*",
    TAG: "L"
  },
  starts: ["ATG"],
  stops: ["TAA", "TCA", "TGA"]
};
var YEAST_MITO_CODE = {
  id: 3,
  name: "Yeast Mitochondrial",
  codons: {
    ...STANDARD_CODE.codons,
    TGA: "W",
    CTT: "T",
    CTC: "T",
    CTA: "T",
    CTG: "T",
    ATA: "M"
  },
  starts: ["ATA", "ATG", "GTG"],
  stops: ["TAA", "TAG"]
};
var MOLD_PROTOZOAN_MITO_CODE = {
  id: 4,
  name: "Mold, Protozoan, Coelenterate Mitochondrial / Mycoplasma",
  codons: {
    ...STANDARD_CODE.codons,
    TGA: "W"
  },
  starts: ["TTA", "TTG", "CTG", "ATT", "ATC", "ATA", "ATG", "GTG"],
  stops: ["TAA", "TAG"]
};
var CILIATE_NUCLEAR_CODE = {
  id: 6,
  name: "Ciliate, Dasycladacean and Hexamita Nuclear",
  codons: {
    ...STANDARD_CODE.codons,
    TAA: "Q",
    TAG: "Q"
  },
  starts: ["ATG"],
  stops: ["TGA"]
};
var ECHINODERM_MITO_CODE = {
  id: 9,
  name: "Echinoderm and Flatworm Mitochondrial",
  codons: {
    ...STANDARD_CODE.codons,
    TGA: "W",
    AAA: "N",
    AGA: "S",
    AGG: "S"
  },
  starts: ["ATG", "GTG"],
  stops: ["TAA", "TAG"]
};
var EUPLOTID_NUCLEAR_CODE = {
  id: 10,
  name: "Euplotid Nuclear",
  codons: {
    ...STANDARD_CODE.codons,
    TGA: "C"
  },
  starts: ["ATG"],
  stops: ["TAA", "TAG"]
};
var ALT_YEAST_NUCLEAR_CODE = {
  id: 12,
  name: "Alternative Yeast Nuclear",
  codons: {
    ...STANDARD_CODE.codons,
    CTG: "S"
  },
  starts: ["CTG", "ATG"],
  stops: ["TAA", "TAG", "TGA"]
};
var ALT_FLATWORM_MITO_CODE = {
  id: 14,
  name: "Alternative Flatworm Mitochondrial",
  codons: {
    ...STANDARD_CODE.codons,
    TAA: "Y",
    TGA: "W",
    AAA: "N",
    AGA: "S",
    AGG: "S"
  },
  starts: ["ATG"],
  stops: ["TAG"]
};
var BLEPHARISMA_MACRONUCLEAR_CODE = {
  id: 15,
  name: "Blepharisma Macronuclear",
  codons: {
    ...STANDARD_CODE.codons,
    TAG: "Q"
  },
  starts: ["ATG"],
  stops: ["TAA", "TGA"]
};
var CHLOROPHYCEAN_MITO_CODE = {
  id: 16,
  name: "Chlorophycean Mitochondrial",
  codons: {
    ...STANDARD_CODE.codons,
    TAG: "L"
  },
  starts: ["ATG"],
  stops: ["TAA", "TGA"]
};
var TREMATODE_MITO_CODE = {
  id: 21,
  name: "Trematode Mitochondrial",
  codons: {
    ...STANDARD_CODE.codons,
    TGA: "W",
    ATA: "M",
    AAA: "N",
    AGA: "S",
    AGG: "S"
  },
  starts: ["ATG", "GTG"],
  stops: ["TAA", "TAG"]
};
var THRAUSTOCHYTRIUM_MITO_CODE = {
  id: 23,
  name: "Thraustochytrium Mitochondrial",
  codons: {
    ...STANDARD_CODE.codons,
    TTA: "*"
  },
  starts: ["ATT", "ATG", "GTG"],
  stops: ["TTA", "TAA", "TAG", "TGA"]
};
var RHABDOPLEURIDAE_MITO_CODE = {
  id: 24,
  name: "Rhabdopleuridae Mitochondrial",
  codons: {
    ...STANDARD_CODE.codons,
    TGA: "W",
    AGA: "S",
    AGG: "K"
  },
  starts: ["TTG", "CTG", "ATG", "GTG"],
  stops: ["TAA", "TAG"]
};
var GRACILIBACTERIA_CODE = {
  id: 25,
  name: "Candidate Division SR1 and Gracilibacteria",
  codons: {
    ...STANDARD_CODE.codons,
    TGA: "G"
  },
  starts: ["TTG", "ATG", "GTG"],
  stops: ["TAA", "TAG"]
};
var PACHYSOLEN_NUCLEAR_CODE = {
  id: 26,
  name: "Pachysolen tannophilus Nuclear",
  codons: {
    ...STANDARD_CODE.codons,
    CTG: "A"
  },
  starts: ["CTG", "ATG"],
  stops: ["TAA", "TAG", "TGA"]
};
var MESODINIUM_NUCLEAR_CODE = {
  id: 29,
  name: "Mesodinium Nuclear",
  codons: {
    ...STANDARD_CODE.codons,
    TAA: "Y",
    TAG: "Y"
  },
  starts: ["ATG"],
  stops: ["TGA"]
};
var PERITRICH_NUCLEAR_CODE = {
  id: 30,
  name: "Peritrich Nuclear",
  codons: {
    ...STANDARD_CODE.codons,
    TAA: "E",
    TAG: "E"
  },
  starts: ["ATG"],
  stops: ["TGA"]
};
var BALANOPHORACEAE_PLASTID_CODE = {
  id: 32,
  name: "Balanophoraceae Plastid",
  codons: {
    ...STANDARD_CODE.codons,
    TAG: "W"
  },
  starts: ["TTG", "CTG", "ATT", "ATC", "ATA", "ATG", "GTG"],
  stops: ["TAA", "TGA"]
};
var CEPHALODISCIDAE_MITO_CODE = {
  id: 33,
  name: "Cephalodiscidae Mitochondrial UAA-Tyr",
  codons: {
    ...STANDARD_CODE.codons,
    TAA: "Y",
    TGA: "W",
    AGA: "S",
    AGG: "K"
  },
  starts: ["TTG", "CTG", "ATG", "GTG"],
  stops: ["TAG"]
};
var NCBI_TRANSLATION_TABLES = {
  1: STANDARD_CODE,
  2: VERTEBRATE_MITO_CODE,
  3: YEAST_MITO_CODE,
  4: MOLD_PROTOZOAN_MITO_CODE,
  5: INVERTEBRATE_MITO_CODE,
  6: CILIATE_NUCLEAR_CODE,
  9: ECHINODERM_MITO_CODE,
  10: EUPLOTID_NUCLEAR_CODE,
  11: BACTERIAL_CODE,
  12: ALT_YEAST_NUCLEAR_CODE,
  13: ASCIDIAN_MITO_CODE,
  14: ALT_FLATWORM_MITO_CODE,
  15: BLEPHARISMA_MACRONUCLEAR_CODE,
  16: CHLOROPHYCEAN_MITO_CODE,
  21: TREMATODE_MITO_CODE,
  22: SCENEDESMUS_MITO_CODE,
  23: THRAUSTOCHYTRIUM_MITO_CODE,
  24: RHABDOPLEURIDAE_MITO_CODE,
  25: GRACILIBACTERIA_CODE,
  26: PACHYSOLEN_NUCLEAR_CODE,
  29: MESODINIUM_NUCLEAR_CODE,
  30: PERITRICH_NUCLEAR_CODE,
  32: BALANOPHORACEAE_PLASTID_CODE,
  33: CEPHALODISCIDAE_MITO_CODE
};
var VALID_NCBI_TABLE_IDS = Object.keys(NCBI_TRANSLATION_TABLES).map(Number);
var CUSTOM_AA_ALPHABET = new Set("ACDEFGHIKLMNPQRSTVWY*".split(""));

// src/artifacts/claude-science-session.ts
var MAX_ARTIFACT_DATABASE_JSON_CHARACTERS = 128 * 1024 * 1024;
var MAX_CUSTOM_ENZYMES = 100;
var MAX_HIDDEN_ENZYMES_PER_RECORD = 512;
var MAX_TRANSLATION_LAYERS_PER_RECORD = 200;
var MAX_TRANSLATION_LAYER_TEXT_LENGTH = 160;
var MAX_MOTIF_LENGTH = 256;
var MAX_CUSTOM_ENZYME_NAME_LENGTH = 64;
var MAX_CUSTOM_ENZYME_RECOGNITION_LENGTH = 64;
var MAX_HIDDEN_FEATURE_TRANSLATIONS_PER_RECORD = 2e3;
var VALID_SOURCE_IDS = /* @__PURE__ */ new Set([
  "common",
  "all",
  "favorites",
  "golden-gate-type-iis",
  "common-mcs",
  "classic-6-cutter",
  "diagnostic-screening"
]);
var VALID_TRANSLATION_TABLE_IDS = new Set(VALID_NCBI_TABLE_IDS);
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function requiredString(value, path, maxLength = MAX_TRANSLATION_LAYER_TEXT_LENGTH) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`${path} must be a non-empty string no longer than ${maxLength} characters.`);
  }
  return value.trim();
}
function requiredInteger(value, path) {
  if (!Number.isInteger(value)) throw new Error(`${path} must be an integer.`);
  return Number(value);
}
function uniqueId(base, used, maxLength = MAX_TRANSLATION_LAYER_TEXT_LENGTH) {
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    const suffixText = `-${suffix}`;
    candidate = `${base.slice(0, Math.max(0, maxLength - suffixText.length))}${suffixText}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}
function normalizeCustomEnzymes(value) {
  if (value === void 0) return [];
  if (!Array.isArray(value)) throw new Error("artifactState.customEnzymes must be an array.");
  if (value.length > MAX_CUSTOM_ENZYMES) {
    throw new Error(`artifactState.customEnzymes cannot contain more than ${MAX_CUSTOM_ENZYMES} entries.`);
  }
  const byName = /* @__PURE__ */ new Map();
  value.forEach((raw, index) => {
    const path = `artifactState.customEnzymes[${index}]`;
    if (!isObject(raw)) throw new Error(`${path} must be an object.`);
    const name = requiredString(raw.name, `${path}.name`, MAX_CUSTOM_ENZYME_NAME_LENGTH);
    const recognitionSequence = requiredString(
      raw.recognitionSequence,
      `${path}.recognitionSequence`,
      MAX_CUSTOM_ENZYME_RECOGNITION_LENGTH
    ).toUpperCase();
    if (!/^[ACGTRYSWKMBDHVN]+$/.test(recognitionSequence)) {
      throw new Error(`${path}.recognitionSequence must contain only IUPAC DNA symbols.`);
    }
    const cutOffset = requiredInteger(raw.cutOffset, `${path}.cutOffset`);
    const complementCutOffset = requiredInteger(raw.complementCutOffset, `${path}.complementCutOffset`);
    if (Math.abs(cutOffset) > 100 || Math.abs(complementCutOffset) > 100) {
      throw new Error(`${path} cut offsets must be between -100 and 100.`);
    }
    if (raw.overhang !== "blunt" && raw.overhang !== "5prime" && raw.overhang !== "3prime") {
      throw new Error(`${path}.overhang must be "blunt", "5prime", or "3prime".`);
    }
    byName.set(name.toLowerCase(), { name, recognitionSequence, cutOffset, complementCutOffset, overhang: raw.overhang });
  });
  return Array.from(byName.values());
}
function normalizeTranslationLayers(value, recordLengths) {
  if (value === void 0) return {};
  if (!isObject(value)) throw new Error("artifactState.translationLayersByRecord must be an object.");
  const result = {};
  for (const [recordId, rawLayers] of Object.entries(value)) {
    const sequenceLength = recordLengths.get(recordId);
    if (sequenceLength === void 0) continue;
    if (!Array.isArray(rawLayers)) {
      throw new Error(`artifactState.translationLayersByRecord.${recordId} must be an array.`);
    }
    if (rawLayers.length > MAX_TRANSLATION_LAYERS_PER_RECORD) {
      throw new Error(`Record ${recordId} cannot restore more than ${MAX_TRANSLATION_LAYERS_PER_RECORD} translation layers.`);
    }
    const usedIds = /* @__PURE__ */ new Set();
    result[recordId] = rawLayers.map((raw, index) => {
      const path = `artifactState.translationLayersByRecord.${recordId}[${index}]`;
      if (!isObject(raw)) throw new Error(`${path} must be an object.`);
      const baseId = requiredString(raw.id, `${path}.id`);
      const label = requiredString(raw.label, `${path}.label`);
      const start = requiredInteger(raw.start, `${path}.start`);
      const end = requiredInteger(raw.end, `${path}.end`);
      if (start < 0 || end <= start || end > sequenceLength) {
        throw new Error(`${path} must use a valid 0-based [start,end) range within ${sequenceLength} residues.`);
      }
      const strand = raw.strand === -1 ? -1 : raw.strand === 1 ? 1 : null;
      if (strand === null) throw new Error(`${path}.strand must be 1 or -1.`);
      const frame = raw.frame === 0 || raw.frame === 1 || raw.frame === 2 ? raw.frame : null;
      if (frame === null) throw new Error(`${path}.frame must be 0, 1, or 2.`);
      const translationTableId = raw.translationTableId === void 0 ? 1 : requiredInteger(raw.translationTableId, `${path}.translationTableId`);
      if (!VALID_TRANSLATION_TABLE_IDS.has(translationTableId)) {
        throw new Error(`${path}.translationTableId must be a supported NCBI genetic-code id.`);
      }
      const color = raw.color === void 0 ? void 0 : requiredString(raw.color, `${path}.color`, 32);
      const featureId = raw.featureId === void 0 ? void 0 : requiredString(raw.featureId, `${path}.featureId`);
      if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`${path}.color must be a 6-digit hex color.`);
      if (raw.needsReview !== void 0 && typeof raw.needsReview !== "boolean") {
        throw new Error(`${path}.needsReview must be a boolean.`);
      }
      if (raw.completeCds !== void 0 && typeof raw.completeCds !== "boolean") {
        throw new Error(`${path}.completeCds must be a boolean.`);
      }
      return {
        id: uniqueId(baseId, usedIds),
        label,
        start,
        end,
        strand,
        frame,
        translationTableId,
        source: "layer",
        color,
        ...raw.needsReview ? { needsReview: true } : {},
        ...raw.completeCds ? { completeCds: true } : {},
        ...featureId ? { featureId } : {}
      };
    });
  }
  return result;
}
function normalizeStringArraysByRecord(value, path, recordLengths, maxEntries) {
  if (value === void 0) return {};
  if (!isObject(value)) throw new Error(`${path} must be an object.`);
  const result = {};
  for (const [recordId, rawValues] of Object.entries(value)) {
    if (!recordLengths.has(recordId)) continue;
    if (!Array.isArray(rawValues) || rawValues.some((item) => typeof item !== "string")) {
      throw new Error(`${path}.${recordId} must be a string array.`);
    }
    if (maxEntries !== void 0 && rawValues.length > maxEntries) {
      throw new Error(`${path}.${recordId} cannot contain more than ${maxEntries} entries.`);
    }
    result[recordId] = Array.from(new Set(rawValues.map((item) => item.trim()).filter(Boolean)));
  }
  return result;
}
function normalizeRestrictionSources(value, recordLengths) {
  const raw = normalizeStringArraysByRecord(value, "artifactState.enzymeSourcesByRecord", recordLengths);
  const result = {};
  for (const [recordId, sources] of Object.entries(raw)) {
    const validated = sources.filter((source) => VALID_SOURCE_IDS.has(source));
    if (validated.length !== sources.length) throw new Error(`artifactState.enzymeSourcesByRecord.${recordId} contains an unknown source.`);
    result[recordId] = validated;
  }
  return result;
}
function normalizeBooleanByRecord(value, path, recordLengths) {
  if (value === void 0) return {};
  if (!isObject(value)) throw new Error(`${path} must be an object.`);
  const result = {};
  for (const [recordId, rawValue] of Object.entries(value)) {
    if (!recordLengths.has(recordId)) continue;
    if (typeof rawValue !== "boolean") throw new Error(`${path}.${recordId} must be a boolean.`);
    result[recordId] = rawValue;
  }
  return result;
}
function normalizeMotifs(value, recordLengths) {
  if (value === void 0) return {};
  if (!isObject(value)) throw new Error("artifactState.motifsByRecord must be an object.");
  const result = {};
  for (const [recordId, rawValue] of Object.entries(value)) {
    if (!recordLengths.has(recordId)) continue;
    if (typeof rawValue !== "string" || rawValue.length > MAX_MOTIF_LENGTH) {
      throw new Error(
        `artifactState.motifsByRecord.${recordId} must be a string no longer than ${MAX_MOTIF_LENGTH} characters.`
      );
    }
    result[recordId] = rawValue;
  }
  return result;
}
function normalizeArtifactDurableState(value, recordLengths) {
  if (value === void 0) {
    return {
      customEnzymes: [],
      translationLayersByRecord: {},
      enzymeSourcesByRecord: {},
      hiddenEnzymesByRecord: {},
      hiddenFeatureTranslationsByRecord: {},
      restrictionLabelsByRecord: {},
      motifsByRecord: {}
    };
  }
  if (!isObject(value)) throw new Error("artifactState must be an object.");
  return {
    customEnzymes: normalizeCustomEnzymes(value.customEnzymes),
    translationLayersByRecord: normalizeTranslationLayers(value.translationLayersByRecord, recordLengths),
    enzymeSourcesByRecord: normalizeRestrictionSources(value.enzymeSourcesByRecord, recordLengths),
    hiddenEnzymesByRecord: normalizeStringArraysByRecord(
      value.hiddenEnzymesByRecord,
      "artifactState.hiddenEnzymesByRecord",
      recordLengths,
      MAX_HIDDEN_ENZYMES_PER_RECORD
    ),
    hiddenFeatureTranslationsByRecord: normalizeStringArraysByRecord(
      value.hiddenFeatureTranslationsByRecord,
      "artifactState.hiddenFeatureTranslationsByRecord",
      recordLengths,
      MAX_HIDDEN_FEATURE_TRANSLATIONS_PER_RECORD
    ),
    restrictionLabelsByRecord: normalizeBooleanByRecord(
      value.restrictionLabelsByRecord,
      "artifactState.restrictionLabelsByRecord",
      recordLengths
    ),
    motifsByRecord: normalizeMotifs(value.motifsByRecord, recordLengths)
  };
}

// src/artifacts/claude-science-workspace-collections.ts
var MAX_ARTIFACT_NOTES = 1e3;
var MAX_ARTIFACT_WORKFLOW_RESULTS = 1e3;
var MAX_ARTIFACT_NOTE_BODY_LENGTH = 65536;
var MAX_ARTIFACT_NOTE_TITLE_LENGTH = 256;
var MAX_ARTIFACT_NOTE_TAGS = 50;
var MAX_ARTIFACT_TAG_LENGTH = 128;
var MAX_ARTIFACT_ID_LENGTH = 160;
var MAX_ARTIFACT_WORKFLOW_NAME_LENGTH = 256;
var MAX_ARTIFACT_WORKFLOW_RECORD_IDS = 250;
var MAX_ARTIFACT_PROVENANCE_PARENT_IDS = 250;
var MAX_ARTIFACT_PROVENANCE_TEXT_LENGTH = 256;
var MAX_ARTIFACT_STRUCTURED_DEPTH = 12;
var MAX_ARTIFACT_STRUCTURED_NODES = 5e4;
var MAX_ARTIFACT_STRUCTURED_ENTRIES = 1e4;
var MAX_ARTIFACT_STRUCTURED_KEY_LENGTH = 256;
var MAX_ARTIFACT_STRUCTURED_STRING_LENGTH = 16384;
var MAX_ARTIFACT_COLLECTION_TEXT_CHARACTERS = 8388608;
var UNSAFE_OBJECT_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
var WORKFLOW_KINDS = /* @__PURE__ */ new Set(["digest", "gel", "golden_gate", "ligation"]);
function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function consumeText(value, path, budget) {
  budget.textCharacters += value.length;
  if (budget.textCharacters > MAX_ARTIFACT_COLLECTION_TEXT_CHARACTERS) {
    throw new Error(
      `${path} makes workspace notes and workflow data exceed the maximum of ${MAX_ARTIFACT_COLLECTION_TEXT_CHARACTERS.toLocaleString()} text characters.`
    );
  }
}
function boundedString(value, path, maxLength, budget, options = {}) {
  if (typeof value !== "string") throw new Error(`${path} must be a string.`);
  const normalized = options.trim === false ? value.replace(/\r\n?/g, "\n") : value.trim();
  if (!options.allowBlank && !normalized.trim()) throw new Error(`${path} must not be blank.`);
  if (normalized.length > maxLength) {
    throw new Error(`${path} cannot exceed ${maxLength.toLocaleString()} characters.`);
  }
  consumeText(normalized, path, budget);
  return normalized;
}
function normalizeId(value, path, budget) {
  return boundedString(value, path, MAX_ARTIFACT_ID_LENGTH, budget);
}
function normalizeTimestamp(value, path, budget) {
  const raw = boundedString(value, path, 64, budget);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    throw new Error(`${path} must be an ISO 8601 date-time.`);
  }
  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds)) throw new Error(`${path} must be a valid ISO 8601 date-time.`);
  return new Date(milliseconds).toISOString();
}
function normalizeStringArray(value, path, maxEntries, maxLength, budget, options = {}) {
  if (value === void 0 && !options.required) return [];
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  if (value.length > maxEntries) {
    throw new Error(`${path} cannot contain more than ${maxEntries.toLocaleString()} entries.`);
  }
  const normalized = value.map((item, index) => boundedString(
    item,
    `${path}[${index}]`,
    maxLength,
    budget
  ));
  return options.deduplicate ? Array.from(new Set(normalized)) : normalized;
}
function normalizeJsonValue(value, path, budget, ancestors, depth) {
  budget.nodes += 1;
  if (budget.nodes > MAX_ARTIFACT_STRUCTURED_NODES) {
    throw new Error(`${path} exceeds the maximum of ${MAX_ARTIFACT_STRUCTURED_NODES.toLocaleString()} structured-data nodes.`);
  }
  if (depth > MAX_ARTIFACT_STRUCTURED_DEPTH) {
    throw new Error(`${path} exceeds the maximum structured-data depth of ${MAX_ARTIFACT_STRUCTURED_DEPTH}.`);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > MAX_ARTIFACT_STRUCTURED_STRING_LENGTH) {
      throw new Error(`${path} cannot exceed ${MAX_ARTIFACT_STRUCTURED_STRING_LENGTH.toLocaleString()} characters.`);
    }
    consumeText(value, path, budget);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} must not contain NaN or Infinity.`);
    return value;
  }
  if (typeof value !== "object" || value === null) {
    throw new Error(`${path} must contain JSON-compatible values only.`);
  }
  if (ancestors.has(value)) throw new Error(`${path} must not contain circular references.`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_ARTIFACT_STRUCTURED_ENTRIES) {
        throw new Error(`${path} cannot contain more than ${MAX_ARTIFACT_STRUCTURED_ENTRIES.toLocaleString()} entries.`);
      }
      return value.map((item, index) => normalizeJsonValue(
        item,
        `${path}[${index}]`,
        budget,
        ancestors,
        depth + 1
      ));
    }
    if (!isPlainObject(value)) throw new Error(`${path} must contain plain JSON objects only.`);
    const entries = Object.entries(value);
    if (entries.length > MAX_ARTIFACT_STRUCTURED_ENTRIES) {
      throw new Error(`${path} cannot contain more than ${MAX_ARTIFACT_STRUCTURED_ENTRIES.toLocaleString()} properties.`);
    }
    const normalized = {};
    for (const [key, item] of entries) {
      if (UNSAFE_OBJECT_KEYS.has(key)) throw new Error(`${path}.${key} is not an allowed object key.`);
      if (!key || key.length > MAX_ARTIFACT_STRUCTURED_KEY_LENGTH) {
        throw new Error(`${path} contains an empty or overlong object key.`);
      }
      consumeText(key, `${path}.${key}`, budget);
      normalized[key] = normalizeJsonValue(item, `${path}.${key}`, budget, ancestors, depth + 1);
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}
function normalizeJsonObject(value, path, budget) {
  if (!isPlainObject(value)) throw new Error(`${path} must be a plain JSON object.`);
  return normalizeJsonValue(value, path, budget, /* @__PURE__ */ new WeakSet(), 0);
}
function normalizeProvenance(value, path, budget, required) {
  if (value === void 0) {
    if (required) throw new Error(`${path} is required.`);
    return void 0;
  }
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  const source = boundedString(value.source, `${path}.source`, MAX_ARTIFACT_PROVENANCE_TEXT_LENGTH, budget);
  const optionalText = (field) => value[field] === void 0 ? void 0 : boundedString(value[field], `${path}.${field}`, MAX_ARTIFACT_PROVENANCE_TEXT_LENGTH, budget);
  const operation = optionalText("operation");
  const actor = optionalText("actor");
  const engine = optionalText("engine");
  const engineVersion = optionalText("engineVersion");
  const parentIds = value.parentIds === void 0 ? void 0 : normalizeStringArray(
    value.parentIds,
    `${path}.parentIds`,
    MAX_ARTIFACT_PROVENANCE_PARENT_IDS,
    MAX_ARTIFACT_ID_LENGTH,
    budget
  );
  const metadata = value.metadata === void 0 ? void 0 : normalizeJsonObject(value.metadata, `${path}.metadata`, budget);
  return {
    source,
    ...operation === void 0 ? {} : { operation },
    ...actor === void 0 ? {} : { actor },
    ...engine === void 0 ? {} : { engine },
    ...engineVersion === void 0 ? {} : { engineVersion },
    ...parentIds === void 0 ? {} : { parentIds },
    ...metadata === void 0 ? {} : { metadata }
  };
}
function normalizeNote(value, index, context, budget) {
  const path = `notes[${index}]`;
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  const id = normalizeId(value.id, `${path}.id`, budget);
  const title = value.title === void 0 ? void 0 : boundedString(value.title, `${path}.title`, MAX_ARTIFACT_NOTE_TITLE_LENGTH, budget);
  const body = boundedString(
    value.body,
    `${path}.body`,
    MAX_ARTIFACT_NOTE_BODY_LENGTH,
    budget,
    { trim: false }
  );
  const format = value.format === void 0 || value.format === "plain" ? "plain" : value.format === "markdown" ? "markdown" : (() => {
    throw new Error(`${path}.format must be "plain" or "markdown".`);
  })();
  const scope = value.scope === "workspace" || value.scope === "record" || value.scope === "range" ? value.scope : (() => {
    throw new Error(`${path}.scope must be "workspace", "record", or "range".`);
  })();
  const recordId = value.recordId === void 0 ? void 0 : normalizeId(value.recordId, `${path}.recordId`, budget);
  let range;
  if (value.range !== void 0) {
    if (!isPlainObject(value.range)) throw new Error(`${path}.range must be an object.`);
    const start = value.range.start;
    const end = value.range.end;
    if (!Number.isInteger(start) || !Number.isInteger(end) || Number(start) < 0 || Number(end) <= Number(start)) {
      throw new Error(`${path}.range must be a valid 0-based [start,end) range.`);
    }
    range = { start: Number(start), end: Number(end) };
  }
  if (scope === "workspace" && (recordId !== void 0 || range !== void 0)) {
    throw new Error(`${path} workspace notes cannot carry recordId or range.`);
  }
  if (scope === "record" && (recordId === void 0 || range !== void 0)) {
    throw new Error(`${path} record notes require recordId and cannot carry range.`);
  }
  if (scope === "range" && (recordId === void 0 || range === void 0)) {
    throw new Error(`${path} range notes require both recordId and range.`);
  }
  if (recordId !== void 0 && context.recordLengths) {
    const recordLength = context.recordLengths.get(recordId);
    if (recordLength === void 0) throw new Error(`${path}.recordId does not match a workspace record.`);
    if (range && range.end > recordLength) {
      throw new Error(`${path}.range must fit within the ${recordLength}-residue record.`);
    }
  }
  const tags = value.tags === void 0 ? void 0 : normalizeStringArray(
    value.tags,
    `${path}.tags`,
    MAX_ARTIFACT_NOTE_TAGS,
    MAX_ARTIFACT_TAG_LENGTH,
    budget,
    { deduplicate: true }
  );
  const createdAt = normalizeTimestamp(value.createdAt, `${path}.createdAt`, budget);
  const updatedAt = normalizeTimestamp(value.updatedAt, `${path}.updatedAt`, budget);
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new Error(`${path}.updatedAt cannot be earlier than createdAt.`);
  }
  const provenance = normalizeProvenance(value.provenance, `${path}.provenance`, budget, false);
  return {
    id,
    ...title === void 0 ? {} : { title },
    body,
    format,
    scope,
    ...recordId === void 0 ? {} : { recordId },
    ...range === void 0 ? {} : { range },
    ...tags === void 0 ? {} : { tags },
    createdAt,
    updatedAt,
    ...provenance === void 0 ? {} : { provenance }
  };
}
function normalizeWorkflowResult(value, index, context, budget) {
  const path = `workflowResults[${index}]`;
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  const id = normalizeId(value.id, `${path}.id`, budget);
  if (!WORKFLOW_KINDS.has(value.kind)) {
    throw new Error(`${path}.kind must be "digest", "gel", "golden_gate", or "ligation".`);
  }
  const kind = value.kind;
  const name = boundedString(value.name, `${path}.name`, MAX_ARTIFACT_WORKFLOW_NAME_LENGTH, budget);
  const inputRecordIds = normalizeStringArray(
    value.inputRecordIds,
    `${path}.inputRecordIds`,
    MAX_ARTIFACT_WORKFLOW_RECORD_IDS,
    MAX_ARTIFACT_ID_LENGTH,
    budget,
    { required: true }
  );
  if (inputRecordIds.length === 0) throw new Error(`${path}.inputRecordIds must contain at least one record id.`);
  const inputSha256s = value.inputSha256s === void 0 ? void 0 : normalizeStringArray(
    value.inputSha256s,
    `${path}.inputSha256s`,
    MAX_ARTIFACT_WORKFLOW_RECORD_IDS,
    64,
    budget
  );
  if (inputSha256s && inputSha256s.length !== inputRecordIds.length) {
    throw new Error(`${path}.inputSha256s must align one-to-one with inputRecordIds.`);
  }
  inputSha256s?.forEach((sha256, shaIndex) => {
    if (!/^[0-9a-f]{64}$/i.test(sha256)) {
      throw new Error(`${path}.inputSha256s[${shaIndex}] must be a 64-character SHA-256 value.`);
    }
  });
  const normalizedInputSha256s = inputSha256s?.map((sha256) => sha256.toLowerCase());
  const parameters = normalizeJsonObject(value.parameters ?? {}, `${path}.parameters`, budget);
  const outputRecordIds = normalizeStringArray(
    value.outputRecordIds,
    `${path}.outputRecordIds`,
    MAX_ARTIFACT_WORKFLOW_RECORD_IDS,
    MAX_ARTIFACT_ID_LENGTH,
    budget
  );
  if (context.recordLengths) {
    inputRecordIds.forEach((recordId, recordIndex) => {
      if (!context.recordLengths?.has(recordId)) {
        throw new Error(`${path}.inputRecordIds[${recordIndex}] does not match a workspace record.`);
      }
    });
    if (!context.allowMissingWorkflowOutputRecords) {
      outputRecordIds.forEach((recordId, recordIndex) => {
        if (!context.recordLengths?.has(recordId)) {
          throw new Error(`${path}.outputRecordIds[${recordIndex}] does not match a workspace record.`);
        }
      });
    }
  }
  const result = value.result === void 0 ? void 0 : normalizeJsonObject(value.result, `${path}.result`, budget);
  const createdAt = normalizeTimestamp(value.createdAt, `${path}.createdAt`, budget);
  const provenance = normalizeProvenance(value.provenance, `${path}.provenance`, budget, true);
  if (!provenance) throw new Error(`${path}.provenance is required.`);
  return {
    id,
    kind,
    name,
    inputRecordIds,
    ...normalizedInputSha256s === void 0 ? {} : { inputSha256s: normalizedInputSha256s },
    parameters,
    outputRecordIds,
    ...result === void 0 ? {} : { result },
    createdAt,
    provenance
  };
}
function assertUniqueIds(values, path) {
  const ids = /* @__PURE__ */ new Set();
  for (const value of values) {
    if (ids.has(value.id)) throw new Error(`${path} contains duplicate id "${value.id}".`);
    ids.add(value.id);
  }
}
function normalizeNotesWithBudget(value, context, budget) {
  if (value === void 0) return [];
  if (!Array.isArray(value)) throw new Error("notes must be an array when provided.");
  if (value.length > MAX_ARTIFACT_NOTES) {
    throw new Error(`notes cannot contain more than ${MAX_ARTIFACT_NOTES.toLocaleString()} entries.`);
  }
  const notes = value.map((note, index) => normalizeNote(note, index, context, budget));
  assertUniqueIds(notes, "notes");
  return notes;
}
function normalizeWorkflowResultsWithBudget(value, budget, context) {
  if (value === void 0) return [];
  if (!Array.isArray(value)) throw new Error("workflowResults must be an array when provided.");
  if (value.length > MAX_ARTIFACT_WORKFLOW_RESULTS) {
    throw new Error(`workflowResults cannot contain more than ${MAX_ARTIFACT_WORKFLOW_RESULTS.toLocaleString()} entries.`);
  }
  const results = value.map((result, index) => normalizeWorkflowResult(result, index, context, budget));
  assertUniqueIds(results, "workflowResults");
  return results;
}
function normalizeArtifactWorkspaceCollections(value, context = {}) {
  if (value === void 0 || value === null) return { notes: [], workflowResults: [] };
  if (!isPlainObject(value)) throw new Error("Workspace collections must be an object.");
  const budget = { nodes: 0, textCharacters: 0 };
  return {
    notes: normalizeNotesWithBudget(value.notes, context, budget),
    workflowResults: normalizeWorkflowResultsWithBudget(value.workflowResults, budget, context)
  };
}

// src/artifacts/claude-science-workspace-envelope.ts
function isPlainObject2(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
var RECORD_KEYED_ARTIFACT_STATE_FIELDS = [
  "translationLayersByRecord",
  "enzymeSourcesByRecord",
  "hiddenEnzymesByRecord",
  "hiddenFeatureTranslationsByRecord",
  "restrictionLabelsByRecord",
  "motifsByRecord"
];
function assertArtifactStateRecordKeys(artifactState, recordLengths) {
  if (!isPlainObject2(artifactState)) return;
  for (const field of RECORD_KEYED_ARTIFACT_STATE_FIELDS) {
    const recordMap = artifactState[field];
    if (!isPlainObject2(recordMap)) continue;
    const unknownRecordIds = Object.keys(recordMap).filter((recordId) => !recordLengths.has(recordId));
    if (unknownRecordIds.length > 0) {
      throw new Error(
        `artifactState.${field} references unknown record id${unknownRecordIds.length === 1 ? "" : "s"}: ` + unknownRecordIds.join(", ")
      );
    }
  }
}
function assertAlignmentRecordKeys(workspace, recordLengths) {
  if (workspace.alignments !== void 0 && !Array.isArray(workspace.alignments)) {
    throw new Error("Workspace alignments must be an array when provided.");
  }
  if (workspace.alignment !== void 0 && !isPlainObject2(workspace.alignment)) {
    throw new Error("Workspace alignment must be a plain object when provided.");
  }
  if (workspace.alignment !== void 0 && workspace.alignments !== void 0) {
    throw new Error("Workspace must provide either alignment or alignments, not both.");
  }
  const alignments = Array.isArray(workspace.alignments) ? workspace.alignments : isPlainObject2(workspace.alignment) ? [workspace.alignment] : [];
  const missingRecordIds = /* @__PURE__ */ new Set();
  for (const alignment of alignments) {
    if (!isPlainObject2(alignment) || typeof alignment.alignedFasta === "string") continue;
    const rows = Array.isArray(alignment.rows) ? alignment.rows : Array.isArray(alignment.sequences) ? alignment.sequences : [];
    for (const row of rows) {
      if (!isPlainObject2(row) || typeof row.sourceRecordId !== "string") continue;
      const recordId = row.sourceRecordId.trim();
      if (recordId && !recordLengths.has(recordId)) missingRecordIds.add(recordId);
    }
  }
  if (missingRecordIds.size > 0) {
    const ids = Array.from(missingRecordIds);
    throw new Error(
      `Alignment rows reference unknown record id${ids.length === 1 ? "" : "s"}: ${ids.join(", ")}`
    );
  }
}
function normalizeArtifactWorkspaceEnvelope(value, recordLengths) {
  if (!isPlainObject2(value)) throw new Error("Workspace payload must be a plain object.");
  const collections = normalizeArtifactWorkspaceCollections(value, { recordLengths });
  assertAlignmentRecordKeys(value, recordLengths);
  assertArtifactStateRecordKeys(value.artifactState, recordLengths);
  return {
    ...collections,
    artifactState: normalizeArtifactDurableState(value.artifactState, recordLengths)
  };
}
export {
  normalizeArtifactWorkspaceEnvelope
};
