import { describe, expect, it, vi } from 'vitest';
import {
  extractFeatureSequence,
  featureLocationCoordinateSignature,
  isAmbiguousFeatureLocation,
  isMaterializableFeatureLocation,
  isQuarantinedFeatureLocation,
} from '../../bio/feature-location';
import {
  featureTypeLabel,
  parseFeatures,
  parseGenBank,
  QUALIFIER_VALUE_MAX_BYTES,
  type GenBankQualifier,
  type GenBankQualifierTruncation,
} from '../../bio/genbank-parser';
import { resolveFeatureColor } from '../../bio/feature-palette';
import { applyInsertion, applySubstitution } from '../../bio/mutate';
import { reverseComplement, reverseComplementFeatures } from '../../bio/reverse-complement';
import type { Feature } from '../../bio/types';
import vectors from '../../../public/data/vectors.json';
import {
  buildArtifactExportLossReport,
  describePayloadSnapshot,
  featuresToCsv,
  inventoryReportHtml,
  normalizeRecord,
  parseImportedRecords,
  toGenBankLite,
  toGff3Lite,
} from '../motif-artifact';

const sequence = 'ATGCCCGGGCCATTTAAA';

function joinedFeature(metadata: Record<string, unknown> = {}): Feature {
  return {
    id: 'joined-cds',
    name: 'joined CDS',
    type: 'cds',
    start: 0,
    end: 12,
    strand: 1,
    color: '#888888',
    metadata,
    subRanges: [
      { start: 0, end: 3, strand: 1 },
      { start: 9, end: 12, strand: 1 },
    ],
  };
}

function record(feature: Feature) {
  return {
    id: 'joined-record',
    name: 'Joined record',
    description: 'Multipart export fixture',
    sequence,
    topology: 'linear' as const,
    type: 'dna' as const,
    features: [feature],
    sites: [],
    active: true,
    default: false,
  };
}

describe('multipart feature interchange exports', () => {
  it('quarantines unmarked reverse multipart arrays without guessing their order', () => {
    const ambiguous = normalizeRecord({
      id: 'current-reverse',
      name: 'Current reverse',
      molecule: 'dna',
      topology: 'linear',
      seq: sequence,
      annotations: [{
        id: 'current-cds',
        name: 'current CDS',
        type: 'cds',
        start: 0,
        end: 12,
        strand: -1,
        color: '#888888',
        subRanges: [
          { start: 9, end: 12, strand: -1 },
          { start: 0, end: 3, strand: -1 },
        ],
      }],
    }, 0);

    expect(ambiguous?.features[0].subRanges).toEqual([
      { start: 9, end: 12, strand: -1 },
      { start: 0, end: 3, strand: -1 },
    ]);
    expect(ambiguous?.features[0].metadata).toMatchObject({ motifSubRangeOrderAmbiguous: true });
    expect(ambiguous?.features[0].metadata.motifSubRangeOrder).toBeUndefined();
    expect(isAmbiguousFeatureLocation(ambiguous!.features[0])).toBe(true);
    expect(isMaterializableFeatureLocation(ambiguous!.features[0])).toBe(false);
    expect(extractFeatureSequence(sequence, ambiguous!.features[0], 'dna')).toBe('');
    expect(toGenBankLite(ambiguous!, 'linear')).toContain('complement(order(1..3,10..12))');
    const ambiguousGffRows = toGff3Lite(ambiguous!).split('\n').filter((line) => line.includes('\tMotif\tcds\t'));
    expect(ambiguousGffRows.map((row) => row.split('\t')[7])).toEqual(['.', '.']);
    expect(ambiguousGffRows.every((row) => row.includes('motif_location_operator=ambiguous'))).toBe(true);

    const reloaded = normalizeRecord({
      ...ambiguous!,
      seq: ambiguous!.sequence,
      molecule: ambiguous!.type,
      annotations: ambiguous!.features,
    }, 0);
    expect(reloaded?.features[0].subRanges).toEqual(ambiguous?.features[0].subRanges);
    expect(isAmbiguousFeatureLocation(reloaded!.features[0])).toBe(true);

    const marked = normalizeRecord({
      id: 'marked-reverse',
      name: 'Marked reverse',
      molecule: 'dna',
      topology: 'linear',
      seq: sequence,
      annotations: [{
        ...ambiguous!.features[0],
        metadata: { motifSubRangeOrder: 'biological' },
      }],
    }, 0);
    expect(marked?.features[0].subRanges).toEqual(ambiguous?.features[0].subRanges);
    expect(marked?.features[0].metadata).toMatchObject({ motifSubRangeOrder: 'biological' });
    expect(isMaterializableFeatureLocation(marked!.features[0])).toBe(true);
    expect(extractFeatureSequence(sequence, marked!.features[0], 'dna')).toBe('TGGCAT');
  });

  it('derives reverse ambiguity from piece strands when the top-level strand is omitted', () => {
    const normalized = normalizeRecord({
      id: 'piece-strand-reverse',
      name: 'Piece-strand reverse',
      molecule: 'dna',
      topology: 'linear',
      seq: sequence,
      annotations: [{
        id: 'piece-strand-cds',
        name: 'piece-strand CDS',
        type: 'cds',
        start: 0,
        end: 12,
        color: '#888888',
        subRanges: [
          { start: 9, end: 12, strand: -1 },
          { start: 0, end: 3, strand: -1 },
        ],
      }],
    }, 0);

    expect(normalized?.features[0].strand).toBe(-1);
    expect(normalized?.features[0].metadata).toMatchObject({ motifSubRangeOrderAmbiguous: true });
    expect(normalized?.features[0].metadata.motifSubRangeOrder).toBeUndefined();
    expect(extractFeatureSequence(sequence, normalized!.features[0], 'dna')).toBe('');
  });

  it('quarantines a legacy outer-complemented mixed-strand location', () => {
    const normalized = normalizeRecord({
      id: 'legacy-mixed-complement',
      name: 'Legacy mixed complement',
      molecule: 'dna',
      topology: 'linear',
      seq: sequence,
      annotations: [{
        id: 'legacy-mixed-cds',
        name: 'legacy mixed CDS',
        type: 'cds',
        start: 0,
        end: 12,
        strand: -1,
        color: '#888888',
        // Legacy outer-complement parsing flipped each piece but retained the
        // GenBank text order, leaving a mixed effective strand.
        subRanges: [
          { start: 0, end: 3, strand: 1 },
          { start: 9, end: 12, strand: -1 },
        ],
      }],
    }, 0);

    expect(normalized?.features[0].strand).toBe(0);
    expect(normalized?.features[0].metadata).toMatchObject({ motifSubRangeOrderAmbiguous: true });
    expect(normalized?.features[0].metadata.motifSubRangeOrder).toBeUndefined();
    expect(extractFeatureSequence(sequence, normalized!.features[0], 'dna')).toBe('');
  });

  it('preserves an explicit ambiguity quarantine through whole-record reverse complement', () => {
    const sourceFeature = joinedFeature({ motifSubRangeOrderAmbiguous: true });
    sourceFeature.strand = -1;
    sourceFeature.subRanges = [
      { start: 9, end: 12, strand: -1 },
      { start: 0, end: 3, strand: -1 },
    ];
    const transformedFeatures = reverseComplementFeatures([sourceFeature], sequence.length);
    expect(transformedFeatures[0].strand).toBe(1);

    const normalized = normalizeRecord({
      id: 'reverse-complemented-ambiguous',
      name: 'Reverse-complemented ambiguous',
      molecule: 'dna',
      topology: 'linear',
      seq: reverseComplement(sequence),
      annotations: transformedFeatures,
    }, 0);

    expect(normalized?.features[0].strand).toBe(1);
    expect(normalized?.features[0].metadata).toMatchObject({ motifSubRangeOrderAmbiguous: true });
    expect(normalized?.features[0].metadata.motifSubRangeOrder).toBeUndefined();
    expect(extractFeatureSequence(normalized!.sequence, normalized!.features[0], 'dna')).toBe('');
  });

  it('round-trips a joined GenBank location without changing its product', () => {
    const source = record(joinedFeature());
    const genbank = toGenBankLite(source, source.topology);

    expect(genbank).toContain('join(1..3,10..12)');
    const reparsed = parseGenBank(genbank);
    expect(reparsed).toHaveLength(1);
    expect(extractFeatureSequence(reparsed[0].sequence, reparsed[0].features[0], 'dna').toUpperCase()).toBe('ATGCCA');
  });

  it('reads a record with no features back with no features', () => {
    const empty = { ...record(joinedFeature()), features: [] };
    const genbank = toGenBankLite(empty, empty.topology);

    expect(genbank).toContain('FEATURES             Location/Qualifiers\nORIGIN');
    const reparsed = parseGenBank(genbank);
    expect(reparsed).toHaveLength(1);
    expect(reparsed[0].sequence.toUpperCase()).toBe(empty.sequence.toUpperCase());
    expect(reparsed[0].features).toEqual([]);
  });

  it('keeps one period on DEFINITION across an export-import-export cycle', () => {
    const source = { ...record(joinedFeature()), description: 'High-copy cloning vector.' };
    const first = toGenBankLite(source, source.topology);
    expect(first).toContain('DEFINITION  High-copy cloning vector.\n');

    const reparsed = parseGenBank(first)[0];
    expect(reparsed.definition).toBe('High-copy cloning vector.');
    const second = toGenBankLite({ ...source, description: reparsed.definition! }, source.topology);
    expect(second).toContain('DEFINITION  High-copy cloning vector.\n');

    const bare = { ...record(joinedFeature()), description: 'Multipart export fixture' };
    expect(toGenBankLite(bare, bare.topology)).toContain('DEFINITION  Multipart export fixture.\n');
  });

  it('keeps the record name in LOCUS so a re-import keeps the same name', () => {
    const source = { ...record(joinedFeature()), name: 'pET-28a(+)' };
    const genbank = toGenBankLite(source, source.topology);
    // Only the name token changes: the same columns as before, 16 wide plus one space.
    expect(genbank.split('\n')[0]).toMatch(/^LOCUS {7}pET-28a\(\+\) +\d+ bp /);
    expect(genbank.split('\n')[0].indexOf(' bp ')).toBe(12 + 16 + 1 + 11);
    expect(parseGenBank(genbank)[0].name).toBe('pET-28a(+)');

    const spaced = { ...record(joinedFeature()), name: 'pUC19 edited' };
    expect(parseGenBank(toGenBankLite(spaced, spaced.topology))[0].name).toBe('pUC19_edited');
  });

  it('lays out LOCUS in the NCBI columns for DNA, RNA and protein', () => {
    const base = { ...record(joinedFeature()), features: [] };
    const locus = (type: 'dna' | 'rna' | 'protein', topology: 'linear' | 'circular') => (
      toGenBankLite({ ...base, type, topology }, topology).split('\n')[0]
    );
    // 1-based columns: length ends at 40, unit 42-43, molecule 48-53,
    // topology 56-63, division 65-67, date 69-79.
    const columns = (line: string) => [line.slice(29, 40).trim(), line.slice(41, 43), line.slice(47, 53).trim(),
      line.slice(55, 63).trim(), line.slice(64, 67), line.slice(68)];
    expect(columns(locus('dna', 'circular'))).toEqual(['18', 'bp', 'DNA', 'circular', 'UNK', expect.stringMatching(/^\d{2}-[A-Z]{3}-\d{4}$/)]);
    expect(columns(locus('rna', 'linear')).slice(0, 5)).toEqual(['18', 'bp', 'RNA', 'linear', 'UNK']);
    expect(columns(locus('protein', 'linear')).slice(0, 5)).toEqual(['18', 'aa', '', 'linear', 'UNK']);
    for (const line of [locus('dna', 'circular'), locus('protein', 'linear')]) expect(line).toHaveLength(79);

    const reparsed = parseGenBank(toGenBankLite({ ...base, topology: 'circular' }, 'circular'))[0];
    expect([reparsed.length, reparsed.moleculeType, reparsed.topology]).toEqual([18, 'DNA', 'circular']);
  });

  it('preserves codon_start in Basic GenBank', () => {
    const source = record(joinedFeature({ codon_start: '2' }));
    const genbank = toGenBankLite(source, source.topology);

    expect(genbank).toContain('/codon_start=2');
    const reparsed = parseGenBank(genbank)[0].features[0];
    expect(reparsed.metadata.codon_start).toBe('2');
  });

  it('round-trips repeated GenBank qualifiers in source order with escaped and multiline values', () => {
    const parsed = parseFeatures([
      '     misc_feature    1..3',
      '                     /label="qualifier"',
      '                     /note="first line',
      '                     second ""quoted"" line"',
      '                     /note="second"',
      '                     /pseudo',
    ].join('\n'))[0];
    const normalized = normalizeRecord({
      id: 'qualifier-record',
      name: 'Qualifier record',
      molecule: 'dna',
      topology: 'linear',
      seq: sequence,
      annotations: [parsed],
    }, 0)!;

    const genbank = toGenBankLite(normalized, 'linear');
    expect(genbank.indexOf('/note="first line')).toBeLessThan(genbank.indexOf('/note="second"'));
    expect(genbank).toContain('second ""quoted"" line"');
    expect(genbank).toContain('/pseudo');
    const reparsed = parseGenBank(genbank)[0].features[0];
    expect(reparsed.metadata.motifQualifiers).toEqual([
      { key: 'label', value: 'qualifier' },
      { key: 'note', value: 'first line second "quoted" line' },
      { key: 'note', value: 'second' },
      { key: 'pseudo', value: true },
    ]);
  });

  it('records qualifier truncation in both feature metadata and the parsed import receipt', () => {
    const value = 'x'.repeat(QUALIFIER_VALUE_MAX_BYTES + 10);
    const parsed = parseFeatures([
      '     misc_feature    1..3',
      `                     /note="${value}"`,
    ].join('\n'))[0];
    expect(parsed.metadata.motifQualifierTruncations).toEqual([
      expect.objectContaining({
        key: 'note',
        originalLength: QUALIFIER_VALUE_MAX_BYTES + 10,
        limit: QUALIFIER_VALUE_MAX_BYTES,
      }),
    ]);

    const imported = parseGenBank([
      'LOCUS       TRUNCATED     3 bp    DNA     linear   SYN 08-AUG-2026',
      'FEATURES             Location/Qualifiers',
      '     misc_feature    1..3',
      `                     /note="${value}"`,
      'ORIGIN',
      '        1 aaa',
      '//',
    ].join('\n'))[0];
    expect(imported.qualifierTruncations).toEqual([
      expect.objectContaining({ key: 'note', featureIndex: 0, limit: QUALIFIER_VALUE_MAX_BYTES }),
    ]);
    const [recordInput] = parseImportedRecords([
      'LOCUS       TRUNCATED     3 bp    DNA     linear   SYN 08-AUG-2026',
      'FEATURES             Location/Qualifiers',
      '     misc_feature    1..3',
      `                     /note="${value}"`,
      'ORIGIN',
      '        1 aaa',
      '//',
    ].join('\n'), '', 'auto', 'linear');
    expect(recordInput.provenance).toMatchObject({
      genbankQualifierTruncations: [expect.objectContaining({ key: 'note', featureIndex: 0 })],
    });
  });

  it('bounds qualifier receipts by UTF-8 bytes without splitting Unicode or retaining malformed surrogates', () => {
    const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
    const isWellFormed = (value: string) => {
      for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
          const next = value.charCodeAt(index + 1);
          if (next < 0xdc00 || next > 0xdfff) return false;
          index += 1;
        } else if (code >= 0xdc00 && code <= 0xdfff) return false;
      }
      return true;
    };
    const parseNote = (value: string) => parseFeatures([
      '     misc_feature    1..3',
      `                     /note="${value}"`,
    ].join('\n'))[0];
    const qualifiers = (feature: Feature) => feature.metadata.motifQualifiers as GenBankQualifier[] | undefined;
    const truncations = (feature: Feature) => feature.metadata.motifQualifierTruncations as GenBankQualifierTruncation[] | undefined;

    const emojiValue = '😀'.repeat(Math.ceil((QUALIFIER_VALUE_MAX_BYTES + 32) / 4));
    const emojiFeature = parseNote(emojiValue);
    const emojiNote = qualifiers(emojiFeature)?.find((entry) => entry.key === 'note')?.value;
    const emojiReceipt = truncations(emojiFeature)?.[0];
    expect(typeof emojiNote).toBe('string');
    expect(byteLength(emojiNote as string)).toBeLessThanOrEqual(QUALIFIER_VALUE_MAX_BYTES);
    expect(isWellFormed(emojiNote as string)).toBe(true);
    expect(emojiReceipt).toMatchObject({
      key: 'note',
      originalBytes: byteLength(emojiValue),
      originalLength: byteLength(emojiValue),
      retainedBytes: byteLength(emojiNote as string),
      retainedLength: byteLength(emojiNote as string),
      limit: QUALIFIER_VALUE_MAX_BYTES,
    });

    const combiningValue = `${'e\u0301'.repeat(Math.ceil((QUALIFIER_VALUE_MAX_BYTES + 8) / 3))}`;
    const combiningFeature = parseNote(combiningValue);
    const combiningNote = qualifiers(combiningFeature)?.find((entry) => entry.key === 'note')?.value;
    expect(byteLength(combiningNote as string)).toBeLessThanOrEqual(QUALIFIER_VALUE_MAX_BYTES);
    expect(isWellFormed(combiningNote as string)).toBe(true);

    const malformedValue = `${'a'.repeat(QUALIFIER_VALUE_MAX_BYTES)}\ud800`;
    const malformedFeature = parseNote(malformedValue);
    const malformedNote = qualifiers(malformedFeature)?.find((entry) => entry.key === 'note')?.value;
    expect(byteLength(malformedNote as string)).toBeLessThanOrEqual(QUALIFIER_VALUE_MAX_BYTES);
    expect(isWellFormed(malformedNote as string)).toBe(true);
    expect(truncations(malformedFeature)?.[0]).toMatchObject({
      originalBytes: QUALIFIER_VALUE_MAX_BYTES + 3,
      limit: QUALIFIER_VALUE_MAX_BYTES,
    });

    const exactBoundary = 'a'.repeat(QUALIFIER_VALUE_MAX_BYTES);
    const exactFeature = parseNote(exactBoundary);
    expect(qualifiers(exactFeature)?.find((entry) => entry.key === 'note')?.value).toBe(exactBoundary);
    expect(truncations(exactFeature)).toBeUndefined();
  });

  it('retains and diagnoses quarantined raw locations without materializing them', () => {
    const parsed = parseFeatures([
      '     misc_feature    J00194.1:100..200',
      '                     /label="remote feature"',
    ].join('\n'))[0];
    const normalized = normalizeRecord({
      id: 'remote-record',
      name: 'Remote record',
      molecule: 'dna',
      topology: 'linear',
      seq: sequence,
      annotations: [parsed],
    }, 0)!;

    expect(isQuarantinedFeatureLocation(normalized.features[0])).toBe(true);
    expect(extractFeatureSequence(normalized.sequence, normalized.features[0], 'dna')).toBe('');
    const genbank = toGenBankLite(normalized, 'linear');
    expect(genbank).toContain('J00194.1:100..200');
    expect(genbank).toContain('retained raw INSDC syntax');
    expect(toGff3Lite(normalized)).toContain('omitted quarantined feature');
    const reparsed = parseGenBank(genbank)[0];
    expect(reparsed.importDiagnostics).toEqual([
      expect.objectContaining({ code: 'remote_location', location: 'J00194.1:100..200' }),
    ]);
  });

  it('preserves explicit translation tables and emits a record default on coding features', () => {
    const explicitUnsupported = record(joinedFeature({ transl_table: '27' }));
    const explicitGenbank = toGenBankLite(explicitUnsupported, explicitUnsupported.topology);
    expect(explicitGenbank).toContain('/transl_table=27');
    expect(parseGenBank(explicitGenbank)[0].features[0].metadata.transl_table).toBe('27');

    const inherited = { ...record(joinedFeature()), translationTableId: 2 };
    expect(toGenBankLite(inherited, inherited.topology)).toContain('/transl_table=2');
    expect(toGff3Lite(inherited)).toContain(';transl_table=2');

    const overridden = { ...record(joinedFeature({ transl_table: 15 })), translationTableId: 2 };
    const overriddenGenbank = toGenBankLite(overridden, overridden.topology);
    expect(overriddenGenbank).toContain('/transl_table=15');
    expect(overriddenGenbank).not.toContain('/transl_table=2');
    expect(toGff3Lite(overridden)).toContain(';transl_table=15');
  });

  it('updates preserved coding qualifiers after feature metadata edits', () => {
    const parsed = parseFeatures([
      '     CDS             1..12',
      '                     /label="editable CDS"',
      '                     /codon_start=1',
      '                     /transl_table=1',
      '                     /transl_except="(pos:4..6,aa:Sec)"',
    ].join('\n'))[0];
    const normalized = normalizeRecord({
      id: 'edited-qualifiers',
      name: 'Edited qualifiers',
      molecule: 'dna',
      topology: 'linear',
      seq: sequence,
      annotations: [parsed],
    }, 0)!;
    normalized.features[0].metadata.codon_start = '2';
    normalized.features[0].metadata.transl_table = 11;
    normalized.features[0].metadata.transl_except = '(pos:7..9,aa:Pyl)';

    const edited = toGenBankLite(normalized, 'linear');
    expect(edited).toContain('/codon_start=2');
    expect(edited).not.toContain('/codon_start=1');
    expect(edited).toContain('/transl_table=11');
    expect(edited).not.toMatch(/\/transl_table=1(?:\r?\n|$)/);
    expect(edited).toContain('/transl_except=(pos:7..9,aa:Pyl)');
    expect(edited).not.toContain('(pos:4..6,aa:Sec)');
  });

  it('emits an inherited coding translation table alongside preserved qualifiers', () => {
    const parsed = parseFeatures([
      '     CDS             1..12',
      '                     /label="inherited CDS"',
      '                     /note="kept"',
    ].join('\n'))[0];
    const normalized = normalizeRecord({
      id: 'inherited-qualifiers',
      name: 'Inherited qualifiers',
      molecule: 'dna',
      topology: 'linear',
      seq: sequence,
      translationTableId: 11,
      annotations: [parsed],
    }, 0)!;

    const exported = toGenBankLite(normalized, 'linear');
    expect(exported).toContain('/transl_table=11');
  });

  it('removes stale semantic qualifiers when their authoritative metadata is cleared', () => {
    const parsed = parseFeatures([
      '     CDS             1..12',
      '                     /label="cleared CDS"',
      '                     /codon_start=1',
      '                     /transl_table=1',
      '                     /transl_except="(pos:4..6,aa:Sec)"',
    ].join('\n'))[0];
    const normalized = normalizeRecord({
      id: 'cleared-qualifiers',
      name: 'Cleared qualifiers',
      molecule: 'dna',
      topology: 'linear',
      seq: sequence,
      annotations: [parsed],
    }, 0)!;
    normalized.features[0].metadata.codon_start = null;
    normalized.features[0].metadata.transl_table = 'not-a-table';
    normalized.features[0].metadata.transl_except = '';
    // Alias fields must not resurrect a canonical field that was explicitly
    // cleared or invalidated.
    normalized.features[0].metadata.codonStart = 3;
    normalized.features[0].metadata.translTable = 11;
    normalized.features[0].metadata.translExcept = '(pos:7..9,aa:Pyl)';

    const exported = toGenBankLite(normalized, 'linear');
    expect(exported).toContain('/label="cleared CDS"');
    expect(exported).not.toContain('/codon_start=1');
    expect(exported).not.toContain('/transl_table=1');
    expect(exported).not.toContain('(pos:4..6,aa:Sec)');
    expect(exported).not.toContain('/transl_except=""');

    // The same cleared value must stay absent when there is no raw qualifier
    // array to override (the ordinary generated-qualifier path).
    delete normalized.features[0].metadata.motifQualifiers;
    const generatedOnly = toGenBankLite(normalized, 'linear');
    expect(generatedOnly).not.toContain('/transl_except=');
  });

  it('does not invent or export translation-table semantics for noncoding features', () => {
    const noncodingFeature: Feature = {
      ...joinedFeature({ transl_table: 15 }),
      id: 'promoter',
      name: 'promoter',
      type: 'promoter',
      subRanges: undefined,
      start: 0,
      end: 6,
    };
    const source = { ...record(noncodingFeature), translationTableId: 2 };

    expect(toGenBankLite(source, source.topology)).not.toContain('/transl_table=');
    expect(toGff3Lite(source)).not.toContain(';transl_table=');

    const [headerLine, rowLine] = featuresToCsv([source]).split('\n');
    const header = headerLine.split(',');
    const row = rowLine.split(',');
    expect(row[header.indexOf('feature_translation_table')]).toBe('');
    expect(row[header.indexOf('effective_translation_table_id')]).toBe('');
  });

  it('round-trips unchanged fuzzy bounds instead of silently making them exact', () => {
    const fuzzy = parseFeatures([
      '     CDS             <1..>3',
      '                     /label="partial CDS"',
    ].join('\n'))[0];
    const genbank = toGenBankLite(record({ ...fuzzy, id: 'partial-cds' }), 'linear');

    expect(genbank).toContain('<1..>3');
    const reparsed = parseGenBank(genbank)[0].features[0];
    expect(reparsed.metadata).toMatchObject({
      motifOriginalLocation: '<1..>3',
      motifLocationFuzzy: true,
    });
  });

  it.each([
    'order(<1..3,10..>12)',
    '<2..>4',
    '<1..>3\n                     /note="injected"',
  ])('does not trust forged fuzzy-location metadata: %s', (forgedLocation) => {
    const feature = joinedFeature({
      motifLocationFuzzy: true,
      motifOriginalLocation: forgedLocation,
      motifOriginalLocationSignature: featureLocationCoordinateSignature(joinedFeature()),
    });
    const genbank = toGenBankLite(record(feature), 'linear');

    expect(genbank).toContain('join(1..3,10..12)');
    expect(genbank).not.toContain('/note="injected"');
    expect(genbank).not.toContain('order(<1..3,10..>12)');
  });

  it('does not let guarded fuzzy join metadata bypass ambiguity quarantine', () => {
    const ambiguous = joinedFeature({ motifSubRangeOrderAmbiguous: true });
    ambiguous.strand = -1;
    ambiguous.subRanges = [
      { start: 9, end: 12, strand: -1 },
      { start: 0, end: 3, strand: -1 },
    ];
    ambiguous.metadata = {
      ...ambiguous.metadata,
      motifLocationFuzzy: true,
      motifOriginalLocation: 'complement(join(<1..3,10..>12))',
      motifOriginalLocationSignature: featureLocationCoordinateSignature(ambiguous),
    };

    const genbank = toGenBankLite(record(ambiguous), 'linear');
    expect(genbank).toContain('complement(order(1..3,10..12))');
    expect(genbank).not.toContain('complement(join(<1..3,10..>12))');
  });

  it('wraps long multipart locations at the GenBank feature column', () => {
    const longSequence = 'A'.repeat(200);
    const longFeature = joinedFeature();
    longFeature.end = 100;
    longFeature.subRanges = Array.from({ length: 20 }, (_, index) => ({
      start: index * 5,
      end: index * 5 + 2,
      strand: 1,
    }));
    const source = {
      ...record(longFeature),
      sequence: longSequence,
    };
    const genbank = toGenBankLite(source, source.topology);
    const locationLines = genbank.split('\n').filter((line) => (
      /^ {5}cds\s/.test(line) || (/^ {21}\S/.test(line) && !line.trimStart().startsWith('/'))
    ));

    expect(locationLines.length).toBeGreaterThan(1);
    expect(locationLines.every((line) => line.length <= 80)).toBe(true);
    const reparsed = parseGenBank(genbank)[0].features[0];
    expect(reparsed.subRanges).toHaveLength(20);
    expect(extractFeatureSequence(longSequence, reparsed, 'dna')).toBe('A'.repeat(40));
  });

  it('keeps ordered locations ordered instead of materializing a false join', () => {
    const source = record(joinedFeature({ motifLocationOperator: 'order' }));
    const genbank = toGenBankLite(source, source.topology);

    expect(genbank).toContain('order(1..3,10..12)');
    expect(genbank).not.toContain('join(1..3,10..12)');
    const reparsed = parseGenBank(genbank)[0].features[0];
    expect(reparsed.metadata.motifLocationOperator).toBe('order');
    expect(extractFeatureSequence(sequence, reparsed, 'dna')).toBe('');
    const gffRows = toGff3Lite(source).split('\n').filter((line) => line.includes('\tMotif\tcds\t'));
    expect(gffRows.map((row) => row.split('\t')[7])).toEqual(['.', '.']);
  });

  it('treats an empty runtime subRanges array as omission at normalization', () => {
    const normalized = normalizeRecord({
      id: 'empty-array',
      name: 'Empty array',
      molecule: 'dna',
      topology: 'linear',
      seq: sequence,
      annotations: [{
        id: 'contiguous',
        name: 'contiguous',
        type: 'cds',
        start: 0,
        end: 3,
        strand: 1,
        color: '#888888',
        subRanges: [],
      }],
    }, 0);

    expect(normalized?.features[0].subRanges).toBeUndefined();
    expect(extractFeatureSequence(sequence, normalized!.features[0], 'dna')).toBe('ATG');
  });

  it.each([
    {
      input: 'complement(join(1..3,10..12))',
      canonical: 'complement(join(1..3,10..12))',
      product: 'TGGCAT',
      subRanges: [
        { start: 9, end: 12, strand: -1 },
        { start: 0, end: 3, strand: -1 },
      ],
    },
    {
      input: 'join(complement(1..3),complement(10..12))',
      canonical: 'complement(join(10..12,1..3))',
      product: 'CATTGG',
      subRanges: [
        { start: 0, end: 3, strand: -1 },
        { start: 9, end: 12, strand: -1 },
      ],
    },
  ])('round-trips reverse biological order for $input', ({ input, canonical, product, subRanges }) => {
    const parsed = parseFeatures([
      `     CDS             ${input}`,
      '                     /label="reverse joined CDS"',
    ].join('\n'))[0];
    const source = record({ ...parsed, id: 'reverse-joined-cds' });
    const genbank = toGenBankLite(source, source.topology);

    expect(genbank).toContain(canonical);
    const reparsed = parseGenBank(genbank)[0].features[0];
    expect(reparsed.subRanges).toEqual(subRanges);
    expect(extractFeatureSequence(sequence, reparsed, 'dna')).toBe(product);
  });

  it('emits one GFF3 row per discontinuous segment with a shared ID', () => {
    const gff = toGff3Lite(record(joinedFeature()));
    const rows = gff.split('\n').filter((line) => line.includes('\tMotif\tcds\t'));

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.split('\t').slice(3, 5))).toEqual([
      ['1', '3'],
      ['10', '12'],
    ]);
    expect(rows.map((row) => row.split('\t')[7])).toEqual(['0', '0']);
    expect(rows[0]).toMatch(/ID=joined-cds;Name=joined%20CDS;motif_location_operator=join;motif_part=1\/2$/);
    expect(rows[1]).toMatch(/ID=joined-cds;Name=joined%20CDS;motif_location_operator=join;motif_part=2\/2$/);
  });

  it('emits biological-order CDS phase across discontinuous rows', () => {
    const framed = joinedFeature({ codon_start: '2' });
    framed.subRanges = [
      { start: 0, end: 2, strand: 1 },
      { start: 8, end: 12, strand: 1 },
    ];
    const rows = toGff3Lite(record(framed)).split('\n').filter((line) => line.includes('\tMotif\tcds\t'));

    expect(rows.map((row) => row.split('\t')[7])).toEqual(['1', '2']);
    expect(rows.map((row) => row.split('\t')[8])).toEqual([
      'ID=joined-cds;Name=joined%20CDS;motif_location_operator=join;motif_part=1/2',
      'ID=joined-cds;Name=joined%20CDS;motif_location_operator=join;motif_part=2/2',
    ]);
  });

  it('reports assembled length and explicit location in Feature CSV', () => {
    const csv = featuresToCsv([record(joinedFeature())]);
    const [header, row] = csv.split('\n');

    expect(header).toContain('length,location,segment_count');
    expect(row).toContain(',6,"join(1..3,10..12)",2');
  });
});

describe('unstranded features in Basic GenBank', () => {
  function plainFeature(id: string, strand: Feature['strand'], start: number, end: number): Feature {
    return { id, name: id, type: 'misc_feature', start, end, strand, color: '#888888', metadata: {} };
  }
  const withoutDate = (text: string) => text.replace(/\d{2}-[A-Z]{3}-\d{4}$/m, 'DATE');
  function vector(features: Feature[]) {
    return { ...record(features[0]), features };
  }

  it('marks only the unstranded feature, and the marker reads back as strand 0', () => {
    const source = vector([
      plainFeature('MCS', 0, 2, 12),
      plainFeature('forward', 1, 0, 6),
      plainFeature('reverse', -1, 6, 15),
    ]);
    const first = toGenBankLite(source, source.topology);

    expect(first).toContain([
      '     misc_feature    3..12',
      '                     /label="MCS"',
      '                     /motif_strand="none"',
      '                     /ApEinfo_fwdcolor="#888888"',
      '                     /ApEinfo_revcolor="#888888"',
      '     misc_feature    1..6',
    ].join('\n'));
    expect(first.match(/\/motif_strand=/g)).toHaveLength(1);

    const reparsed = parseGenBank(first)[0];
    expect(reparsed.features.map((feature) => [feature.name, feature.strand])).toEqual([
      ['MCS', 0],
      ['forward', 1],
      ['reverse', -1],
    ]);
    // The re-imported copy carries the marker as a preserved qualifier; the
    // second export writes it once, in the same place.
    const second = toGenBankLite({ ...source, features: reparsed.features }, source.topology);
    expect(withoutDate(second)).toBe(withoutDate(first));
  });

  it('drops a preserved marker once the feature has a direction', () => {
    const reparsed = parseGenBank(toGenBankLite(vector([plainFeature('MCS', 0, 2, 12)]), 'linear'))[0];
    const edited = { ...reparsed.features[0], strand: 1 as const };
    const exported = toGenBankLite(vector([edited]), 'linear');

    expect(exported).not.toContain('motif_strand');
    expect(parseGenBank(exported)[0].features[0].strand).toBe(1);
  });

  it('leaves a mixed-strand join to its own location text', () => {
    const mixed: Feature = {
      ...joinedFeature(),
      strand: 0,
      subRanges: [
        { start: 0, end: 3, strand: 1 },
        { start: 9, end: 12, strand: -1 },
      ],
    };
    const exported = toGenBankLite(record(mixed), 'linear');

    expect(exported).toContain('join(1..3,complement(10..12))');
    expect(exported).not.toContain('motif_strand');
  });

  it('keeps every bundled plasmid feature strand through export and re-import', () => {
    const unstranded: string[] = [];
    for (const [index, raw] of (vectors as Parameters<typeof normalizeRecord>[0][]).entries()) {
      const source = normalizeRecord(raw, index);
      expect(source).not.toBeNull();
      const reparsed = parseGenBank(toGenBankLite(source!, source!.topology))[0];
      const strands = (features: readonly Feature[]) => features.map((feature) => [feature.name, feature.strand]);
      expect(strands(reparsed.features)).toEqual(strands(source!.features));
      unstranded.push(...source!.features.filter((feature) => feature.strand === 0).map((feature) => `${source!.name}: ${feature.name}`));
    }
    expect(unstranded).toEqual([
      'pUC19: MCS',
      'pACYC184: p15A ori',
      'pBluescript SK(+): MCS',
      'pcDNA3.1(+): MCS',
      'pcDNA3.1(+): SV40 ori',
    ]);
  });

  it('dates LOCUS with the local calendar day, not the UTC one', () => {
    // 20:30 on 23 Sep in Los Angeles is already 24 Sep in UTC.
    const zone = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T03:30:00Z'));
    try {
      const source = vector([plainFeature('MCS', 0, 2, 12)]);
      expect(toGenBankLite(source, source.topology).split('\n')[0]).toMatch(/ 23-SEP-2026$/);
      // A western evening that crosses a year boundary keeps the old year.
      vi.setSystemTime(new Date('2027-01-01T05:00:00Z'));
      expect(toGenBankLite(source, source.topology).split('\n')[0]).toMatch(/ 31-DEC-2026$/);
    } finally {
      vi.useRealTimers();
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });

  it('writes the same file twice for the same record apart from the date', () => {
    const source = vector([plainFeature('MCS', 0, 2, 12), plainFeature('forward', 1, 0, 6)]);
    const first = toGenBankLite(source, source.topology);
    const second = toGenBankLite(source, source.topology);

    expect(first.split('\n')[0]).toMatch(/ \d{2}-[A-Z]{3}-\d{4}$/);
    expect(withoutDate(second)).toBe(withoutDate(first));
  });
});

describe('INSDC feature keys in Basic GenBank', () => {
  // INSDC Feature Table Definition 11.4, section 7.2. Promoter, terminator,
  // RBS, polyA_signal and enhancer were folded into `regulatory` in 2014.
  const insdcKeys = new Set([
    'assembly_gap', 'C_region', 'CDS', 'centromere', 'D-loop', 'D_segment', 'exon', 'gap', 'gene', 'iDNA',
    'intron', 'J_segment', 'mat_peptide', 'misc_binding', 'misc_difference', 'misc_feature', 'misc_recomb',
    'misc_RNA', 'misc_structure', 'mobile_element', 'modified_base', 'mRNA', 'ncRNA', 'N_region',
    'old_sequence', 'operon', 'oriT', 'polyA_site', 'precursor_RNA', 'prim_transcript', 'primer_bind',
    'propeptide', 'protein_bind', 'regulatory', 'repeat_region', 'rep_origin', 'rRNA', 'S_region',
    'sig_peptide', 'source', 'stem_loop', 'STS', 'telomere', 'tmRNA', 'transit_peptide', 'tRNA', 'unsure',
    'V_region', 'V_segment', "3'UTR", "5'UTR",
  ]);
  // Every Motif type, with the key and the qualifier that carries the type.
  const written: Record<Feature['type'], string> = {
    orf: 'CDS /motif_type="orf"',
    gene: 'gene',
    cds: 'CDS',
    promoter: 'regulatory /regulatory_class="promoter"',
    terminator: 'regulatory /regulatory_class="terminator"',
    rbs: 'regulatory /regulatory_class="ribosome_binding_site"',
    origin: 'rep_origin',
    resistance: 'misc_feature /motif_type="resistance"',
    restriction_site: 'misc_feature /motif_type="restriction_site"',
    primer_bind: 'primer_bind',
    misc_feature: 'misc_feature',
    mRNA: 'mRNA',
    rRNA: 'rRNA',
    tRNA: 'tRNA',
    ncRNA: 'ncRNA /ncRNA_class="other"',
    regulatory: 'regulatory /regulatory_class="other"',
    repeat_region: 'repeat_region',
    sig_peptide: 'sig_peptide',
    mat_peptide: 'mat_peptide',
    transit_peptide: 'transit_peptide',
    intron: 'intron',
    exon: 'exon',
    polyA_signal: 'regulatory /regulatory_class="polyA_signal_sequence"',
    enhancer: 'regulatory /regulatory_class="enhancer"',
    custom: 'misc_feature /motif_type="custom"',
  };
  const types = Object.keys(written) as Feature['type'][];
  const typed = (type: Feature['type'], index: number): Feature => ({
    id: type, name: `${type} feature`, type, start: index, end: index + 3, strand: 1, color: '#888888', metadata: {},
  });
  const source = { ...record(typed('gene', 0)), sequence: 'ACGT'.repeat(10), features: types.map(typed) };
  const withoutDate = (text: string) => text.replace(/\d{2}-[A-Z]{3}-\d{4}$/m, 'DATE');
  // One "key /qualifier" string per feature block.
  const keysAndMarkers = (text: string) => text.slice(text.indexOf('\nFEATURES'), text.indexOf('\nORIGIN')).split('\n')
    .filter((line) => /^ {5}\S/.test(line) || /^ +\/(?:regulatory_class|ncRNA_class|motif_type)=/.test(line))
    .join('\n').split(/\n(?= {5}\S)/)
    .map((block) => block.split('\n').map((line, index) => (index === 0 ? line.trim().split(/\s+/)[0] : line.trim())).join(' '));

  it('writes an INSDC key for every Motif type and reads the same type back', () => {
    const first = toGenBankLite(source, source.topology);
    expect(keysAndMarkers(first)).toEqual(types.map((type) => written[type]));
    for (const entry of keysAndMarkers(first)) expect(insdcKeys.has(entry.split(' ')[0]), entry).toBe(true);

    const reparsed = parseGenBank(first)[0];
    expect(reparsed.features.map((feature) => feature.type)).toEqual(types);
    const second = toGenBankLite({ ...source, features: reparsed.features }, source.topology);
    expect(withoutDate(second)).toBe(withoutDate(first));
  });

  it('rewrites the type qualifiers when an imported feature changes type', () => {
    const reparsed = parseGenBank(toGenBankLite(source, source.topology))[0].features;
    const swap: Partial<Record<Feature['type'], Feature['type']>> = { promoter: 'resistance', resistance: 'terminator', orf: 'cds' };
    const retyped = reparsed.map((feature) => ({ ...feature, type: swap[feature.type] ?? feature.type }));
    const exported = toGenBankLite({ ...source, features: retyped }, source.topology);

    expect(parseGenBank(exported)[0].features.map((feature) => feature.type)).toEqual(retyped.map((feature) => feature.type));
    expect(exported).not.toContain('/regulatory_class="promoter"');
    expect(exported).not.toContain('/motif_type="orf"');
  });

  it('reads an NCBI regulatory feature by its class and keeps a class Motif has no type for', () => {
    const [promoter, silencer] = parseFeatures([
      '     regulatory      1..30',
      '                     /regulatory_class="promoter"',
      '     regulatory      40..60',
      '                     /regulatory_class="silencer"',
    ].join('\n'));
    expect([promoter.type, silencer.type]).toEqual(['promoter', 'regulatory']);
    const exported = toGenBankLite({ ...source, features: [silencer] }, source.topology);
    expect(exported).toContain('/regulatory_class="silencer"');
    expect(exported).not.toContain('/regulatory_class="other"');
  });

  // INSDC 11.4 mandatory qualifiers, for every key that has one.
  const mandatory: Record<string, string[][]> = {
    assembly_gap: [['estimated_length'], ['gap_type']], gap: [['estimated_length']], misc_binding: [['bound_moiety']],
    mobile_element: [['mobile_element_type']], modified_base: [['mod_base']], ncRNA: [['ncRNA_class']],
    old_sequence: [['citation', 'compare']], operon: [['operon']], protein_bind: [['bound_moiety']],
    regulatory: [['regulatory_class']], source: [['organism'], ['mol_type']],
  };
  const featureBlocks = (text: string) => text.slice(text.indexOf('\nFEATURES'), text.indexOf('\nORIGIN')).split('\n').slice(2)
    .join('\n').split(/\n(?= {5}\S)/);
  const missingMandatory = (text: string) => featureBlocks(text).flatMap((block) => {
    const key = block.trim().split(/\s+/)[0];
    return (mandatory[key] ?? []).filter((names) => !names.some((name) => block.includes(`/${name}=`))).map((names) => `${key} /${names[0]}`);
  });

  it('writes every mandatory INSDC qualifier for every Motif type', () => {
    expect(missingMandatory(toGenBankLite(source, source.topology))).toEqual([]);
  });

  it('keeps an ncRNA class, writes "other" when there is none, and drops it off a retyped feature', () => {
    const [classed, unclassed] = parseFeatures([
      '     ncRNA           1..20',
      '                     /ncRNA_class="miRNA"',
      '     ncRNA           complement(21..30)',
      '                     /note="no class"',
    ].join('\n'));
    const made = { ...typed('ncRNA', 30), metadata: { ncRNA_class: 'snoRNA' } };
    const retyped = { ...classed, id: 'retyped', type: 'misc_feature' as const };
    const first = toGenBankLite({ ...source, features: [classed, unclassed, made, typed('ncRNA', 33), retyped] }, source.topology);
    expect(keysAndMarkers(first)).toEqual([
      'ncRNA /ncRNA_class="miRNA"',
      'ncRNA /ncRNA_class="other"',
      'ncRNA /ncRNA_class="snoRNA"',
      'ncRNA /ncRNA_class="other"',
      'misc_feature',
    ]);
    expect(missingMandatory(first)).toEqual([]);

    const reparsed = parseGenBank(first)[0].features;
    expect(reparsed.map((feature) => feature.metadata.ncRNA_class)).toEqual(['miRNA', 'other', 'snoRNA', 'other', undefined]);
    const second = toGenBankLite({ ...source, features: reparsed }, source.topology);
    expect(withoutDate(second)).toBe(withoutDate(first));
  });

  it('writes an imported key Motif has no type for back under that key', () => {
    const imported = parseFeatures([
      '     protein_bind    1..17',
      '                     /bound_moiety="lac repressor"',
      '     stem_loop       18..30',
      '                     /note="hairpin"',
      '     misc_binding    31..36',
      '                     /bound_moiety="theophylline"',
      "     5'UTR           complement(1..8)",
      '     misc_RNA        9..20',
      '     misc_signal     21..25',
      '                     /note="a key INSDC retired in 2014"',
    ].join('\n'));
    expect(imported.map((feature) => feature.type)).toEqual([...Array(5).fill('custom'), 'regulatory']);
    const first = toGenBankLite({ ...source, features: imported }, source.topology);
    expect(keysAndMarkers(first)).toEqual(['protein_bind', 'stem_loop', 'misc_binding', "5'UTR", 'misc_RNA', 'regulatory /regulatory_class="other"']);
    expect(first).not.toMatch(/original/i);
    expect(missingMandatory(first)).toEqual([]);

    const reparsed = parseGenBank(first)[0].features;
    expect(reparsed.map(featureTypeLabel)).toEqual(['protein_bind', 'stem_loop', 'misc_binding', "5'UTR", 'misc_RNA', 'regulatory']);
    expect(withoutDate(toGenBankLite({ ...source, features: reparsed }, source.topology))).toBe(withoutDate(first));

    // A record saved by an older build holds the key lower-cased; a Motif custom
    // feature and a retyped one follow their type.
    const [proteinBind] = imported;
    const others = toGenBankLite({ ...source, features: [
      { ...typed('custom', 0), metadata: { motifOriginalFeatureKey: 'misc_rna' } },
      typed('custom', 3),
      { ...proteinBind, type: 'promoter' },
      { ...proteinBind, type: 'gene' },
    ] }, source.topology);
    expect(keysAndMarkers(others)).toEqual(['misc_RNA', 'misc_feature /motif_type="custom"', 'regulatory /regulatory_class="promoter"', 'gene']);
    expect(parseGenBank(others)[0].features.map((feature) => feature.type)).toEqual(['custom', 'custom', 'promoter', 'gene']);
  });

  it('reads a key INSDC retired in 2014 as regulatory with the class that replaced it', () => {
    // INSDC Feature Table, `regulatory`: it replaced these keys on 15-DEC-2014;
    // the /regulatory_class vocabulary names each one's class.
    const imported = parseFeatures([
      '     -10_signal      1..6',
      '     -35_signal      complement(7..12)',
      '                     /note="sigma70 box"',
      '     TATA_signal     13..19',
      '     GC_signal       20..25',
      '     CAAT_signal     26..30',
      '     attenuator      31..40',
      '                     /label="trp attenuator"',
      '     misc_signal     21..25',
      '                     /note="a key INSDC retired in 2014"',
      '     misc_signal     1..4',
      '     TATA_signal     5..9',
      '                     /regulatory_class="promoter"',
      '     regulatory      10..20',
      '                     /regulatory_class="riboswitch"',
      '                     /bound_moiety="thiamine pyrophosphate"',
    ].join('\n'));
    expect(imported.map((feature) => feature.type)).toEqual([...Array(8).fill('regulatory'), 'promoter', 'regulatory']);
    expect(imported.map((feature) => feature.metadata.motifOriginalFeatureKey)).toEqual([
      '-10_signal', '-35_signal', 'tata_signal', 'gc_signal', 'caat_signal', 'attenuator', 'misc_signal', 'misc_signal', 'tata_signal', 'regulatory',
    ]);
    // A name comes from the file's own qualifiers, else the key.
    expect(imported.map((feature) => feature.name)).toEqual([
      '-10_signal', 'sigma70 box', 'tata_signal', 'gc_signal', 'caat_signal', 'trp attenuator', 'a key INSDC retired in 2014', 'misc_signal', 'tata_signal', 'regulatory',
    ]);

    const first = toGenBankLite({ ...source, features: imported }, source.topology);
    expect(keysAndMarkers(first)).toEqual([
      'regulatory /regulatory_class="minus_10_signal"',
      'regulatory /regulatory_class="minus_35_signal"',
      'regulatory /regulatory_class="TATA_box"',
      'regulatory /regulatory_class="GC_signal"',
      'regulatory /regulatory_class="CAAT_signal"',
      'regulatory /regulatory_class="attenuator"',
      'regulatory /regulatory_class="other"',
      'regulatory /regulatory_class="other"',
      'regulatory /regulatory_class="promoter"',
      'regulatory /regulatory_class="riboswitch"',
    ]);
    expect(missingMandatory(first)).toEqual([]);
    // No retired key survives, and "other" says which key it was.
    expect(first).not.toMatch(/^ {5}(?:-10_signal|-35_signal|TATA_signal|GC_signal|CAAT_signal|attenuator|misc_signal) /m);
    const blocks = featureBlocks(first);
    expect(blocks[1]).toContain('/regulatory_class="minus_35_signal"\n                     /note="sigma70 box"');
    expect(blocks[6]).toContain('/regulatory_class="other"\n                     /note="misc_signal"\n                     /note="a key INSDC retired in 2014"');
    expect(blocks[7]).toContain('/regulatory_class="other"\n                     /note="misc_signal"\n');
    expect(blocks[9]).toContain('/bound_moiety="thiamine pyrophosphate"');

    const reparsed = parseGenBank(first)[0].features;
    expect(reparsed.map((feature) => feature.type)).toEqual(imported.map((feature) => feature.type));
    expect(reparsed.map((feature) => feature.name)).toEqual(imported.map((feature) => feature.name));
    expect(withoutDate(toGenBankLite({ ...source, features: reparsed }, source.topology))).toBe(withoutDate(first));
  });

  it('writes "other" for a feature retyped to regulatory from a class that reads as another type', () => {
    const imported = parseFeatures([
      '     regulatory      1..10',
      '                     /regulatory_class="promoter"',
      '     regulatory      11..20',
      '                     /regulatory_class="riboswitch"',
      '     regulatory      21..26',
      '                     /regulatory_class="minus_10_signal"',
      '     regulatory      27..32',
      '                     /regulatory_class="ribosome_binding_site"',
    ].join('\n'));
    expect(imported.map((feature) => feature.type)).toEqual(['promoter', 'regulatory', 'regulatory', 'rbs']);
    // Untouched, each class goes back out as it came in.
    expect(keysAndMarkers(toGenBankLite({ ...source, features: imported }, source.topology))).toEqual([
      'regulatory /regulatory_class="promoter"',
      'regulatory /regulatory_class="riboswitch"',
      'regulatory /regulatory_class="minus_10_signal"',
      'regulatory /regulatory_class="ribosome_binding_site"',
    ]);

    // The promoter and the RBS retyped to regulatory in the Inspector.
    const retyped = imported.map((feature) => ({ ...feature, type: 'regulatory' as const }));
    const exported = toGenBankLite({ ...source, features: retyped }, source.topology);
    expect(keysAndMarkers(exported)).toEqual([
      'regulatory /regulatory_class="other"',
      'regulatory /regulatory_class="riboswitch"',
      'regulatory /regulatory_class="minus_10_signal"',
      'regulatory /regulatory_class="other"',
    ]);
    expect(exported.match(/\/regulatory_class=/g)).toHaveLength(4);
    expect(parseGenBank(exported)[0].features.map((feature) => feature.type)).toEqual(Array(4).fill('regulatory'));
  });

  it('keeps every bundled plasmid feature type through export and re-import', () => {
    for (const [index, raw] of (vectors as Parameters<typeof normalizeRecord>[0][]).entries()) {
      const bundled = normalizeRecord(raw, index)!;
      const exported = toGenBankLite(bundled, bundled.topology);
      for (const entry of keysAndMarkers(exported)) expect(insdcKeys.has(entry.split(' ')[0]), `${bundled.name}: ${entry}`).toBe(true);
      expect(parseGenBank(exported)[0].features.map((feature) => [feature.name, feature.type]))
        .toEqual(bundled.features.map((feature) => [feature.name, feature.type]));
    }
  });
});

describe('feature colours in Basic GenBank', () => {
  const withoutDate = (text: string) => text.replace(/\d{2}-[A-Z]{3}-\d{4}$/m, 'DATE');
  const colored = (name: string, color: string, strand: Feature['strand'] = 1): Feature => ({
    id: name, name, type: 'misc_feature', start: 0, end: 6, strand, color, metadata: {},
  });
  const one = (feature: Feature) => ({ ...record(feature), features: [feature] });
  const paletteColor = resolveFeatureColor({ name: 'plain', type: 'misc_feature' });

  it('keeps every bundled plasmid feature colour through export and re-import', () => {
    let written = 0;
    for (const [index, raw] of (vectors as Parameters<typeof normalizeRecord>[0][]).entries()) {
      const bundled = normalizeRecord(raw, index)!;
      const first = toGenBankLite(bundled, bundled.topology);
      written += first.match(/\/ApEinfo_fwdcolor=/g)?.length ?? 0;
      const reparsed = parseGenBank(first)[0];
      const shape = (features: readonly Feature[]) => features.map((feature) => (
        [feature.name, feature.type, feature.start, feature.end, feature.strand, feature.color]
      ));
      expect(shape(reparsed.features), bundled.name).toEqual(shape(bundled.features));
      const second = toGenBankLite({ ...bundled, features: reparsed.features }, bundled.topology);
      expect(withoutDate(second).replace(/^ACCESSION.*$/m, ''), bundled.name).toBe(withoutDate(first).replace(/^ACCESSION.*$/m, ''));
    }
    // Every bundled feature has its own colour; none is the palette's.
    expect(written).toBe(78);
  });

  it('leaves a palette colour out and reads the same colour back', () => {
    const exported = toGenBankLite(one(colored('plain', paletteColor)), 'linear');
    expect(exported).not.toContain('ApEinfo');
    expect(parseGenBank(exported)[0].features[0].color).toBe(paletteColor);
  });

  it('writes a reverse feature colour as both halves of the pair', () => {
    const exported = toGenBankLite(one(colored('rev', '#ff9900', -1)), 'linear');
    expect(exported).toContain('/ApEinfo_fwdcolor="#ff9900"\n                     /ApEinfo_revcolor="#ff9900"');
    expect(parseGenBank(exported)[0].features[0].color).toBe('#ff9900');
  });

  it('writes a recolour over the imported pair, adds one a file lacked, and drops one reset to the palette', () => {
    const [imported, bare] = parseFeatures([
      '     misc_feature    1..6',
      '                     /label=plain',
      '                     /ApEinfo_fwdcolor=#123456',
      '                     /ApEinfo_revcolor=#654321',
      '                     /ApEinfo_graphicformat="arrow_data {{0 1 2 0 0 -1} {} 0}"',
      '     misc_feature    7..12',
      '                     /label=other',
      '                     /note="from a file without colours"',
    ].join('\n'));
    expect(imported.color).toBe('#123456');

    const recoloured = toGenBankLite({ ...one(imported), features: [{ ...imported, color: '#00aa55' }, { ...bare, color: '#abcdef' }] }, 'linear');
    expect(recoloured.match(/ApEinfo_(?:fwd|rev)color/g)).toHaveLength(4);
    expect(recoloured).toContain([
      '                     /label="plain"',
      '                     /ApEinfo_fwdcolor="#00aa55"',
      '                     /ApEinfo_revcolor="#00aa55"',
      '                     /ApEinfo_graphicformat="arrow_data {{0 1 2 0 0 -1} {} 0}"',
    ].join('\n'));
    expect(recoloured).toContain('/note="from a file without colours"\n                     /ApEinfo_fwdcolor="#abcdef"');
    expect(parseGenBank(recoloured)[0].features.map((feature) => feature.color)).toEqual(['#00aa55', '#abcdef']);

    const reset = toGenBankLite(one({ ...imported, color: paletteColor }), 'linear');
    expect(reset).not.toMatch(/ApEinfo_(?:fwd|rev)color/);
    expect(parseGenBank(reset)[0].features[0].color).toBe(paletteColor);
  });

  it('does not write a theme colour no GenBank reader can use', () => {
    const exported = toGenBankLite(one(colored('themed', 'var(--accent, #4f7cff)')), 'linear');
    expect(exported).not.toContain('ApEinfo');
  });
});

describe('a kept INSDC key wherever a feature type is shown', () => {
  const [operator, pribnow, madeHere] = [
    ...parseFeatures([
      '     protein_bind    5..21',
      '                     /bound_moiety="lac repressor"',
      '                     /note="lac operator"',
      '     -10_signal      complement(30..35)',
    ].join('\n')),
    { id: 'made', name: 'made here', type: 'custom', start: 40, end: 44, strand: 1, color: '#888888', metadata: {} } as Feature,
  ];
  const keyed = { ...record(operator), sequence: 'ACGT'.repeat(15), features: [operator, pribnow, madeHere] };

  it('names the key the loss report says each format writes', () => {
    const written = (format: Parameters<typeof buildArtifactExportLossReport>[1]) => (
      buildArtifactExportLossReport(keyed, format).originalFeatureKeys.map(({ key, exportedType }) => [key, exportedType])
    );
    expect(written('genbank')).toEqual([['protein_bind', 'protein_bind'], ['-10_signal', 'regulatory']]);
    expect(written('gff3')).toEqual([['protein_bind', 'protein_bind'], ['-10_signal', 'regulatory']]);
    expect(written('csv')).toEqual([['protein_bind', 'protein_bind'], ['-10_signal', 'regulatory']]);
    expect(written('report')).toEqual([['protein_bind', 'protein_bind'], ['-10_signal', 'regulatory']]);
    expect(written('record-json')).toEqual([['protein_bind', 'custom'], ['-10_signal', 'regulatory']]);
    expect(written('fasta')).toEqual([['protein_bind', null], ['-10_signal', null]]);
    expect(written('raw-sequence')).toEqual([['protein_bind', null], ['-10_signal', null]]);
    // The GenBank claim is the key the writer puts on the feature line.
    expect(toGenBankLite(keyed, 'linear')).toContain('\n     protein_bind    5..21\n');
  });

  it('shows the key in the copy summary, GFF3, the feature CSV and the HTML report', () => {
    const payload = { records: [keyed], selectedRecordId: keyed.id } as unknown as Parameters<typeof describePayloadSnapshot>[0];
    const text = describePayloadSnapshot(payload, keyed.id, ['common'])?.text ?? '';
    expect(text).toContain('Features (3): lac operator protein_bind 5..21 · 17 bp (+); -10_signal regulatory complement(30..35)');
    expect(text).toContain('; made here custom 41..44');

    const gffTypes = toGff3Lite(keyed).split('\n').filter((line) => line.includes('\tMotif\t')).map((line) => line.split('\t')[2]);
    expect(gffTypes).toEqual(['protein_bind', 'regulatory', 'custom']);

    const csvTypes = featuresToCsv([keyed]).split('\n').slice(1).map((line) => line.split(',')[6]);
    expect(csvTypes).toEqual(['protein_bind', 'regulatory', 'custom']);

    const html = inventoryReportHtml([keyed]);
    expect(html).toContain('<li>lac operator · protein_bind · 5-21 ·');
    expect(html).toContain('<li>made here · custom · 41-44 ·');
  });
});

describe('several /transl_except on one CDS in Basic GenBank', () => {
  // GG ATG TGA GCA TGA AAA TAA GG: the CDS is 3..20 and both TGA codons are read
  // as Sec, so the protein is M U A U K. INSDC writes one /transl_except each.
  const twoSec = (qualifiers: string[]) => [
    'LOCUS       TwoSec                    22 bp    DNA     linear   UNK 23-SEP-2026',
    'FEATURES             Location/Qualifiers',
    '     CDS             3..20',
    ...qualifiers,
    'ORIGIN',
    '        1 ggatgtgagc atgaaaataa gg',
    '//',
  ].join('\n');
  const label = '                     /label="TwoSec CDS"';
  const first = '                     /transl_except=(pos:6..8,aa:Sec)';
  const second = '                     /transl_except=(pos:12..14,aa:Sec)';
  const note = (text: string) => `                     /note="${text}"`;
  const imported = (qualifiers: string[]) => normalizeRecord(parseImportedRecords(twoSec(qualifiers), '', 'auto', 'linear')[0], 0)!;
  const cdsLines = (exported: string) => {
    const lines = exported.split('\n');
    const start = lines.findIndex((line) => line.startsWith('     CDS '));
    const end = lines.findIndex((line, index) => index > start && (line.startsWith('ORIGIN') || /^ {5}\S/.test(line)));
    return lines.slice(start + 1, end);
  };

  it('imports every exception and writes each back as its own qualifier, in place', () => {
    const record = imported([label, first, second, '                     /translation="MUAUK"']);
    expect(record.features[0].metadata.transl_except).toBe('(pos:6..8,aa:Sec),(pos:12..14,aa:Sec)');
    const exported = toGenBankLite(record, 'linear');
    expect(cdsLines(exported).slice(0, 4)).toEqual([label, first, second, '                     /translation="MUAUK"']);
    const again = normalizeRecord(parseImportedRecords(exported, '', 'auto', 'linear')[0], 0)!;
    expect(again.features[0].metadata.transl_except).toBe('(pos:6..8,aa:Sec),(pos:12..14,aa:Sec)');
    expect(toGenBankLite(again, 'linear')).toBe(exported);
  });

  it('keeps each exception at its own place among other qualifiers', () => {
    const record = imported([label, first, note('between'), second]);
    expect(cdsLines(toGenBankLite(record, 'linear')).slice(0, 4)).toEqual([label, first, note('between'), second]);
  });

  it('drops the imported copies an edit removed, so no stale exception survives', () => {
    const record = imported([label, first, second]);
    record.features[0].metadata.transl_except = '(pos:6..8,aa:Sec)';
    const exported = toGenBankLite(record, 'linear');
    expect(exported.match(/\/transl_except=/g)).toHaveLength(1);
    expect(exported).toContain(first);

    const three = imported([label, first, note('between'), second, '                     /transl_except=(pos:15..17,aa:Pyl)']);
    three.features[0].metadata.transl_except = '(pos:12..14,aa:Sec),(pos:6..8,aa:Sec)';
    const edited = toGenBankLite(three, 'linear');
    expect(cdsLines(edited).slice(0, 4)).toEqual([label, second, note('between'), first]);
    expect(edited).not.toContain('aa:Pyl');
  });

  it('writes exceptions an edit added after the last imported copy', () => {
    const record = imported([label, first, note('after')]);
    record.features[0].metadata.transl_except = '(pos:6..8,aa:Sec),(pos:12..14,aa:Sec),(pos:15..17,aa:Pyl)';
    expect(cdsLines(toGenBankLite(record, 'linear')).slice(0, 5)).toEqual([
      label,
      first,
      second,
      '                     /transl_except=(pos:15..17,aa:Pyl)',
      note('after'),
    ]);
  });

  it('removes every imported copy when the exceptions are cleared', () => {
    const record = imported([label, first, second]);
    record.features[0].metadata.transl_except = '';
    expect(toGenBankLite(record, 'linear')).not.toContain('/transl_except');
  });

  it('writes only the exception an edit left, when a base change drops the other', () => {
    const record = imported([label, first, second]);
    // Base 8 turns the first TGA into TGC (Cys), so its Sec override goes.
    const edited = applySubstitution(record.sequence, [], record.features, 7, 'C');
    expect(edited.features[0].metadata.transl_except).toBe('(pos:12..14,aa:Sec)');
    const exported = toGenBankLite({ ...record, sequence: edited.raw, features: edited.features }, 'linear');
    expect(cdsLines(exported).slice(0, 2)).toEqual([label, second]);
    expect(exported.match(/\/transl_except=/g)).toHaveLength(1);
  });

  it('keeps every copy of another repeated position qualifier through an edit', () => {
    const [repeat] = parseGenBank([
      'LOCUS       Repeats                   22 bp    DNA     linear   UNK 23-SEP-2026',
      'FEATURES             Location/Qualifiers',
      '     repeat_region   3..20',
      '                     /rpt_unit_range=3..5',
      '                     /rpt_unit_range=12..14',
      'ORIGIN',
      '        1 ggatgtgagc atgaaaataa gg',
      '//',
    ].join('\n'));
    const edited = applyInsertion(repeat.sequence, [], repeat.features, 0, 'GGG');
    const exported = toGenBankLite(normalizeRecord({ id: 'repeats', name: 'Repeats', molecule: 'dna', topology: 'linear', seq: edited.raw, annotations: edited.features }, 0)!, 'linear');
    expect(exported).toContain('                     /rpt_unit_range=6..8\n                     /rpt_unit_range=15..17');
  });

  it('writes one qualifier per exception for a feature Motif made itself', () => {
    const record = imported([first, second]);
    delete record.features[0].metadata.motifQualifiers;
    const exported = toGenBankLite(record, 'linear');
    expect(exported).toContain(`${first}\n${second}`);
    expect(exported.match(/\/transl_except=/g)).toHaveLength(2);
  });
});

describe('location-valued qualifiers in Basic GenBank', () => {
  const file = (qualifiers: string[]) => [
    'LOCUS       Unquoted                  22 bp    DNA     linear   UNK 23-SEP-2026',
    'FEATURES             Location/Qualifiers',
    '     CDS             3..20',
    '                     /transl_except="(pos:6..8,aa:Sec)"',
    '     tRNA            1..22',
    '                     /anticodon="(pos:4..6,aa:Phe,seq:gaa)"',
    '     repeat_region   3..20',
    '                     /rpt_unit_range="3..5"',
    '     tmRNA           1..22',
    '                     /tag_peptide="10..21"',
    ...qualifiers,
    'ORIGIN',
    '        1 ggatgtgagc atgaaaataa gg',
    '//',
  ].join('\n');
  const exported = (text: string) => toGenBankLite(normalizeRecord(parseImportedRecords(text, '', 'auto', 'linear')[0], 0)!, 'linear');

  it('writes /transl_except, /anticodon, /rpt_unit_range and /tag_peptide without quotes, as INSDC does', () => {
    const first = exported(file([]));
    for (const line of [
      '/transl_except=(pos:6..8,aa:Sec)',
      '/anticodon=(pos:4..6,aa:Phe,seq:gaa)',
      '/rpt_unit_range=3..5',
      '/tag_peptide=10..21',
    ]) expect(first).toContain(`                     ${line}\n`);
    // The unquoted file reads back to the same values and writes the same bytes.
    expect(exported(first)).toBe(first);
  });

  it('keeps the quotes on other qualifiers, and on a value a space would split', () => {
    const first = exported(file(['     misc_feature    2..4', '                     /rpt_unit_range="3..5 or 6..8"', '                     /note="(pos:1..3)"']));
    expect(first).toContain('/rpt_unit_range="3..5 or 6..8"');
    expect(first).toContain('/note="(pos:1..3)"');
  });

  it('writes a generated /transl_except without quotes', () => {
    const cds: Feature = { id: 'cds', name: 'made here', type: 'cds', start: 2, end: 20, strand: 1, color: '#000000', metadata: { transl_except: '(pos:6..8,aa:Sec),(pos:12..14,aa:Sec)' } };
    const text = toGenBankLite(normalizeRecord({ id: 'made', name: 'made', molecule: 'dna', topology: 'linear', seq: 'ggatgtgagcatgaaaataagg', annotations: [cds] }, 0)!, 'linear');
    expect(text.match(/\/transl_except=.*/g)).toEqual(['/transl_except=(pos:6..8,aa:Sec)', '/transl_except=(pos:12..14,aa:Sec)']);
  });
});
