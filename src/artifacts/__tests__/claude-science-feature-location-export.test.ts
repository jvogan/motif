import { describe, expect, it } from 'vitest';
import {
  extractFeatureSequence,
  featureLocationCoordinateSignature,
  isAmbiguousFeatureLocation,
  isMaterializableFeatureLocation,
  isQuarantinedFeatureLocation,
} from '../../bio/feature-location';
import {
  parseFeatures,
  parseGenBank,
  QUALIFIER_VALUE_MAX_BYTES,
  type GenBankQualifier,
  type GenBankQualifierTruncation,
} from '../../bio/genbank-parser';
import { reverseComplement, reverseComplementFeatures } from '../../bio/reverse-complement';
import type { Feature } from '../../bio/types';
import { featuresToCsv, normalizeRecord, parseImportedRecords, toGenBankLite, toGff3Lite } from '../motif-artifact';

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
    expect(edited).toContain('/transl_except="(pos:7..9,aa:Pyl)"');
    expect(edited).not.toContain('/transl_except="(pos:4..6,aa:Sec)"');
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
    expect(exported).not.toContain('/transl_except="(pos:4..6,aa:Sec)"');
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
