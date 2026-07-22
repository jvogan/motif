/* eslint-disable react-refresh/only-export-components -- artifact entry exports pure runtime test seams */
import { Component, memo, useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type CSSProperties, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Activity, AlignCenter, Beaker, ChevronDown, ChevronLeft, ChevronRight, Crosshair, Dna, FileText, History, Info, Languages, LayoutGrid, List, Map as MapIcon, Maximize2, Minimize2, NotebookPen, Plus, Redo2, Search, Settings, ShieldCheck, Tag, Trash2, Undo2, Workflow, Wrench, X, type LucideIcon } from 'lucide-react';
import vectorsRaw from '../../public/data/vectors.json?raw';
import type { Feature, FeatureStrand, FeatureType, ORF, RestrictionEnzyme, RestrictionSite, SequenceType, Topology } from '../bio/types';
import { extractEmbeddedFastaContent, parseFasta } from '../bio/fasta-parser';
import { parseFeatures, parseGenBank } from '../bio/genbank-parser';
import { gcContent, meltingTemperature, molecularWeight, nucleotideComposition, proteinMolecularWeight } from '../bio/gc-content';
import { findORFs } from '../bio/orf-detection';
import type { DigestFragment } from '../bio/restriction-digest';
import { RESTRICTION_ENZYMES, findRestrictionSites } from '../bio/restriction-sites';
import { RESTRICTION_ENZYMES_FULL } from '../bio/enzyme-data';
import {
  RESTRICTION_PRESETS,
  resolveEnzymeUnion,
  type RestrictionEnzymeSourceId,
} from '../bio/restriction-presets';
import { applySubstitution, applyInsertion, applyDeletion, type MutationResult } from '../bio/mutate';
import {
  ABI_IMPORT_LIMITS,
  parseAbiImport,
  type SangerTraceData,
} from '../bio/abi-import';
import { complement, reverseComplement, reverseComplementFeatures } from '../bio/reverse-complement';
import {
  extractFeatureSequence,
  featureGenBankLocation,
  featureLocationCoordinateSignature,
  featureLocationLength,
  featureLocationSegments,
  isAmbiguousFeatureLocation,
  isMaterializableFeatureLocation,
  isMultipartFeature,
  isOrderedFeatureLocation,
} from '../bio/feature-location';
import { translate, translateCompleteCds } from '../bio/translate';
import { computeMapLayout } from '../plasmid-map/layout';
import { bpToAngle, pointOnCircle } from '../plasmid-map/geometry/coordinates';
import { featureSegments as mapFeatureSegments, featureSpans, normalizeSpan } from '../plasmid-map/geometry/ranges';
import { selectionOverlayPaths } from '../plasmid-map/selection-overlay';
import { mapModeForBlock, type MapLayout, type MapMode, type MapSpan } from '../plasmid-map/types';
import {
  contentPointFromRoot,
  mapContentPoint,
  mapRootPoint,
  rootPointFromContent,
  type MapContentPoint,
  type MapRootPoint,
} from '../plasmid-map/point-spaces';
import { SequenceMapView } from '../components/plasmid-map/SequenceMapView';
import { LargeSequenceViewer } from './LargeSequenceViewer';
import { ClaudeScienceMsaViewer } from './ClaudeScienceMsaViewer';
import {
  ClaudeScienceNotesPanel,
  type ArtifactNoteInput,
  type ArtifactNoteTextUpdate,
} from './ClaudeScienceNotesPanel';
import ClaudeScienceDataSettings from './ClaudeScienceDataSettings';
import { ClaudeScienceWorkflowHistoryPanel } from './ClaudeScienceWorkflowHistoryPanel';
import { ClaudeScienceAgentResultsPanel } from './ClaudeScienceAgentResultsPanel';
import { ClaudeScienceFreshnessBadge } from './ClaudeScienceFreshnessBadge';
import { ClaudeSciencePrimerWorkspace, type ClaudeSciencePrimerExport, type ClaudeSciencePrimerHandoff } from './ClaudeSciencePrimerWorkspace';
import ClaudeScienceGelWorkspace, {
  createClaudeScienceGelLaneCandidates,
  type ClaudeScienceGelResultIdentity,
} from './ClaudeScienceGelWorkspace';
import { type ArtifactGelLadderPreset, type ArtifactGelPreview } from './claude-science-gel-preview';
import { ClaudeScienceAssemblyWorkspace, type ClaudeScienceAssemblySavePayload } from './ClaudeScienceAssemblyWorkspace';
import {
  ClaudeScienceCloningDesignWorkspace,
  type ClaudeScienceCloningDesignWorkspaceHandle,
  type ClaudeScienceCloningPrimerRequest,
  type ClaudeScienceCloningSavePayload,
} from './ClaudeScienceCloningDesignWorkspace';
import {
  ClaudeScienceConstructVerificationWorkspace,
  type ClaudeScienceConstructVerificationRecord,
  type ClaudeScienceConstructVerificationRequest,
  type ClaudeScienceConstructVerificationSavePayload,
} from './ClaudeScienceConstructVerificationWorkspace';
import {
  artifactConstructReadEvidenceSha256,
  buildArtifactConstructVerificationArtifacts,
  findDuplicateArtifactConstructVerificationResult,
} from './claude-science-construct-verification-artifacts';
import {
  ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS,
  ARTIFACT_CONSTRUCT_VERIFICATION_TEXT_LIMITS,
  verifyArtifactConstruct,
} from './claude-science-construct-verification';
import {
  findPcrMaterializationDuplicate,
  materializePcrAmplicon,
  simulateSelectedPrimerPair,
  type PcrMaterializationSourceRecord,
} from './claude-science-pcr-materialization';
import {
  planArtifactGibsonDesign,
  planArtifactGoldenGateDesign,
  type ArtifactCloningInput,
  type ArtifactCloningPlanProvenance,
  type ArtifactGoldenGatePartInput,
} from './claude-science-cloning-design';
import {
  DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
  normalizeClaudeScienceMsaViewPreferences,
  type ClaudeScienceMsaViewPreferences,
} from './claude-science-msa-view-preferences';
import {
  ARTIFACT_SANGER_MAX_WORKSPACE_SAMPLE_ENTRIES,
  artifactSangerTraceSampleEntries,
  normalizeArtifactSangerTrace,
} from './claude-science-sanger';
import {
  ArtifactAlignmentError,
  formatAlignedFasta,
  formatClustal,
  normalizeArtifactAlignments,
  safeAlignmentFilename,
  serializeArtifactAlignment,
  type ArtifactAlignment,
  type ArtifactAlignmentInput,
} from './claude-science-msa';
import { buildDigestRecipe, type DigestRecipe } from './claude-science-digest-recipe';
import { materializeDigestWorkflow } from './claude-science-digest-workflow';
import { sha256HexSync } from './claude-science-sha256';
import {
  createScientificFreshnessRecordIndex,
  evaluateAlignmentsFreshness,
  evaluateAnalysisResultsFreshness,
  evaluateWorkflowResultsFreshness,
} from './claude-science-freshness';
import {
  appendArtifactAnalysisAsset,
  appendArtifactAnalysisWorkspaceResult,
  artifactAnalysisResultRecordIds,
  cloneArtifactAnalysisWorkspace,
  normalizeArtifactAnalysisWorkspace,
  removeArtifactAnalysisAsset,
  removeArtifactAnalysisWorkspaceResult,
  removeArtifactAnalysisResultsForRecord,
  serializeArtifactAnalysisWorkspace,
  type ArtifactAnalysisAsset,
  type ArtifactAnalysisResult,
} from './claude-science-analysis-results';
import {
  clampFloatingSurfaceRect,
  moveFloatingSurfaceRect,
  resizeFloatingSurfaceRectFromBottomRight,
  type FloatingSurfaceRect,
  type FloatingSurfaceSizeLimits,
  type FloatingSurfaceViewport,
} from './floating-surface-geometry';
import {
  addArtifactNote,
  appendArtifactWorkflowResult,
  getArtifactNotesSnapshot,
  getArtifactWorkflowResultsSnapshot,
  normalizeArtifactWorkspaceCollections,
  removeArtifactNote,
  removeArtifactWorkflowResult,
  serializeArtifactWorkspaceCollections,
  updateArtifactNote,
  type ArtifactJsonObject,
  type ArtifactJsonValue,
  type ArtifactNote,
  type ArtifactWorkflowResult,
} from './claude-science-workspace-collections';
import { normalizeArtifactWorkspaceEnvelope } from './claude-science-workspace-envelope';
import { chooseRailPopoverPlacement, collectRailPopoverObstacles, RAIL_POPOVER_MIN_HEIGHT } from './rail-popover-placement';
import {
  MOTIF_INVENTORY_SCHEMA,
  MOTIF_INVENTORY_SCHEMA_V1,
  LARGE_SEQUENCE_DETAIL_THRESHOLD,
  MAX_CUSTOM_ENZYMES,
  MAX_CUSTOM_ENZYME_NAME_LENGTH,
  MAX_CUSTOM_ENZYME_RECOGNITION_LENGTH,
  MAX_MOTIF_LENGTH,
  MAX_TRANSLATION_LAYER_TEXT_LENGTH,
  MAX_TRANSLATION_LAYERS_PER_RECORD,
  normalizeArtifactDurableState,
  parseArtifactDatabaseJson,
  parseArtifactRecordJson,
  type ArtifactDurableState,
  type PortableTranslationTrack,
} from './claude-science-session';
import {
  ARTIFACT_TRANSLATION_CODE_OPTIONS,
  artifactFeatureTranslationTableValue,
  artifactTranslationCodeLabel,
  isSupportedArtifactTranslationTableId,
  normalizeArtifactTranslationTableId,
  resolveArtifactTranslationCode,
  type ArtifactTranslationCodeResolution,
} from './claude-science-translation-code';
import {
  applySequenceEditToAnchors,
  confirmNoteRangeAnchor,
  restoreNoteAnchors,
  snapshotNoteAnchors,
  type NoteAnchorSnapshot,
  type SequenceCoordinateEdit,
} from './claude-science-sequence-edit';
import {
  requestBrowserBlobDownload,
  requestBrowserTextDownload,
  type BrowserDownloadReceipt,
} from './claude-science-download';
import './motif-artifact.css';

const MOTIF_ARTIFACT_VERSION = '0.2.1';
const MOTIF_ARTIFACT_BUILD_ID = (() => {
  if (typeof document === 'undefined') return 'development';
  const value = document.querySelector<HTMLMetaElement>('meta[name="motif-build-id"]')?.content.trim() ?? '';
  return /^[a-f0-9]{64}$/u.test(value) ? value : 'development';
})();
const MOTIF_ARTIFACT_BUILD_LABEL = MOTIF_ARTIFACT_BUILD_ID === 'development'
  ? MOTIF_ARTIFACT_BUILD_ID
  : MOTIF_ARTIFACT_BUILD_ID.slice(0, 12);
const MAX_INTERACTIVE_TRANSLATION_RESIDUES = 5_000;
const ANNOTATION_LIST_PAGE_SIZE = 120;
export const MOTIF_MAX_RECORD_LENGTH = 250_000;
export const MOTIF_MAX_RECORDS = 100;
export const MOTIF_MAX_FEATURES_PER_RECORD = 2_000;
export const MOTIF_MAX_SUBRANGES_PER_FEATURE = 2_000;
export const MOTIF_MAX_SITES_PER_RECORD = 2_048;
export const MOTIF_MAX_HITS_PER_SITE = 10_000;
export const MOTIF_MAX_TOTAL_HITS_PER_RECORD = 50_000;
export const MOTIF_MAX_TAGS_PER_RECORD = 100;
export const MOTIF_MAX_SHORT_TEXT_LENGTH = 1_024;
export const MOTIF_MAX_DESCRIPTION_LENGTH = 16_384;
export const MOTIF_MAX_TAG_LENGTH = 256;
export const MOTIF_MAX_OVERHANG_LENGTH = 64;
export const MOTIF_MAX_RAW_SEQUENCE_CHARACTERS = 1_000_000;
export const MOTIF_MAX_METADATA_JSON_DEPTH = 16;
export const MOTIF_MAX_METADATA_JSON_NODES = 10_000;
export const MOTIF_MAX_METADATA_JSON_BYTES = 1_048_576;
export const MOTIF_MAX_PAYLOAD_JSON_NODES = 250_000;
export const MOTIF_MAX_PAYLOAD_JSON_BYTES = 33_554_432;

type ArtifactFeatureInput = Partial<Feature> & {
  start?: number;
  end?: number;
  direction?: 'forward' | 'reverse' | 'none' | 1 | -1 | 0;
};

type ArtifactRecordInput = {
  id?: string;
  name?: string;
  description?: string;
  seq?: string;
  sequence?: string;
  molecule?: SequenceType;
  topology?: Topology;
  type?: SequenceType;
  /** Portable NCBI genetic-code id used when a feature does not define /transl_table. */
  translationTableId?: number;
  length?: number;
  annotations?: ArtifactFeatureInput[];
  features?: ArtifactFeatureInput[];
  sites?: InventorySiteInput[];
  organism?: string;
  source?: string;
  group?: string;
  project?: string;
  folder?: string;
  collection?: string;
  dateAdded?: string;
  tags?: string[];
  /** Explicit single-stranded end sequences. Empty string means a known blunt end; absence means unspecified. */
  overhang5?: string;
  overhang3?: string;
  /** Physical protrusion chemistry for each end. Sticky sequences without polarity remain viewable but are not assembly-ready. */
  overhang5Type?: ArtifactOverhangType;
  overhang3Type?: ArtifactOverhangType;
  active?: boolean;
  default?: boolean;
  provenance?: Record<string, unknown>;
  /** Versioned, JSON-safe AB1 calls, quality values, peak locations, and channels. */
  sangerTrace?: SangerTraceData;
  /** Runtime safety marker carried by parsed GenBank records. */
  truncated?: unknown;
};

type InventorySiteInput = {
  enzyme?: string;
  motif?: string;
  count?: number;
  hits?: Array<{ position?: number; cutPosition?: number; strand?: 1 | -1; indexBase?: 0 | 1 }>;
  indexBase?: 0 | 1;
  overhang?: RestrictionEnzyme['overhang'];
};

type ArtifactVector = {
  id: string;
  name: string;
  description?: string;
  sequence: string;
  topology: Topology;
  type: SequenceType;
  translationTableId?: number;
  features: Feature[];
  organism?: string;
  source?: string;
  dateAdded?: string;
  tags?: string[];
  overhang5?: string;
  overhang3?: string;
  overhang5Type?: ArtifactOverhangType;
  overhang3Type?: ArtifactOverhangType;
  sites: RestrictionSite[];
  active: boolean;
  default?: boolean;
  group?: string;
  provenance?: Record<string, unknown>;
  sangerTrace?: SangerTraceData;
};

type ArtifactConstructTraceEvidence = {
  baseCalls: string;
  qualityScores?: readonly number[];
  sha256: string;
};

/** The digest follows exactly the bounded calls and qualities sent to verification. */
function artifactConstructTraceEvidence(record: ArtifactVector): ArtifactConstructTraceEvidence | null {
  const trace = record.sangerTrace;
  if (!trace || trace.baseCalls.length > ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxReadLength) return null;
  // Malformed imported quality arrays are not repaired. The engine receives the
  // calls without qualities and will surface that limitation as review evidence.
  const qualityScores = trace.qualityScores.length > 0 && trace.qualityScores.length === trace.baseCalls.length
    ? trace.qualityScores
    : undefined;
  const evidence = {
    baseCalls: trace.baseCalls,
    ...(qualityScores ? { qualityScores } : {}),
  };
  return {
    ...evidence,
    sha256: artifactConstructReadEvidenceSha256(evidence),
  };
}

function boundedArtifactConstructName(value: string): string {
  const maximumLength = ARTIFACT_CONSTRUCT_VERIFICATION_TEXT_LIMITS.maxNameLength;
  return value.length <= maximumLength
    ? value
    : `${value.slice(0, Math.max(0, maximumLength - 1))}…`;
}

type ArtifactOverhangType = 'blunt' | '5prime' | '3prime';

type ArtifactPayload = {
  schema?: string;
  inventory?: {
    id?: string;
    title?: string;
    description?: string;
    updatedAt?: string;
  };
  records?: ArtifactRecordInput[];
  entries?: ArtifactRecordInput[];
  vectors?: ArtifactRecordInput[];
  record?: ArtifactRecordInput;
  selectedRecordId?: string;
  selectedName?: string;
  selectedIndex?: number;
  defaultMotif?: string;
  motif?: string;
  artifactState?: unknown;
  alignment?: ArtifactAlignmentInput;
  alignments?: ArtifactAlignmentInput[];
  notes?: ArtifactNote[];
  workflowResults?: ArtifactWorkflowResult[];
  analysisResults?: ArtifactAnalysisResult[];
  analysisAssets?: ArtifactAnalysisAsset[];
};

type LoadedPayload = {
  schema: string;
  inventory: {
    id: string;
    title: string;
    description: string;
    updatedAt?: string;
  };
  records: ArtifactVector[];
  selectedRecordId: string;
  defaultMotif: string;
  alignments: ArtifactAlignment[];
  notes: ArtifactNote[];
  workflowResults: ArtifactWorkflowResult[];
  analysisResults: ArtifactAnalysisResult[];
  analysisAssets: ArtifactAnalysisAsset[];
};

type PreparedArtifactWorkspace = {
  payload: LoadedPayload;
  artifactState: ArtifactDurableState;
};

type InitialArtifactSource =
  | { kind: 'sample' }
  | { kind: 'payload'; value: unknown; origin: 'script' | 'window' };

type RuntimeRecoveryPayload = {
  schema: string;
  inventory: LoadedPayload['inventory'];
  records: ArtifactRecordInput[];
  selectedRecordId: string;
  defaultMotif: string;
  alignments: ArtifactAlignmentInput[];
  notes: ArtifactNote[];
  workflowResults: ArtifactWorkflowResult[];
  analysisResults: ArtifactAnalysisResult[];
  analysisAssets: ArtifactAnalysisAsset[];
  artifactState: ArtifactDurableState;
};

type PreparedArtifactDatabaseRestore = ReturnType<typeof prepareArtifactDatabaseRestore>;

type PendingArtifactDatabaseRestore = {
  prepared: PreparedArtifactDatabaseRestore;
  sourceLabel: string;
  durability: 'durable-checkpoint' | 'session-hydration';
  returnFocus: HTMLElement | null;
};

type WorkbenchNotice = { message: string; tone: 'status' | 'error' };
type DigestSaveReceipt = { workflowResultId: string; recordCount: number };

type ArtifactFileImportResult = {
  records: ArtifactVector[];
  message: string;
  tone: 'status' | 'error';
};

let lastGoodRuntimeRecoveryPayload: RuntimeRecoveryPayload | null = null;

type Selection =
  | { kind: 'feature'; id: string }
  | { kind: 'restriction'; clusterId: string; tickIds: readonly string[]; enzyme?: string }
  | null;

// A bare {x, y} for a map point used to be enough. It is not: the click surface
// and the geometry beneath it live in two different coordinate spaces that are
// equal only at a pristine fit. See ../plasmid-map/point-spaces — use
// MapRootPoint for pan/zoom anchoring and MapContentPoint for anything that
// resolves to an angle or a base.

type MapViewport = {
  k: number;
  tx: number;
  ty: number;
};

type ArtifactThemeName = 'light' | 'dark' | 'claude-light' | 'claude-dark';
type SequenceViewMode = 'standard' | 'detail';
type MapThemeName = 'dark' | 'light';
type PaneKey = 'inventory' | 'map' | 'sequence' | 'tools';
type PanePlacement = 'docked' | 'floating';
type PanePlacements = Record<PaneKey, PanePlacement>;
type FloatingPaneRects = Record<PaneKey, FloatingSurfaceRect>;
type ResizablePaneKey = 'inventory' | 'sequence' | 'map' | 'tools';
type StackedResizablePaneKey = 'inventory' | 'sequence';
type ResizeEdge = 'before' | 'after';
type PaneWidths = Record<ResizablePaneKey, number>;
type StackedPaneHeights = Record<StackedResizablePaneKey, number | null>;
type PaneVisibility = Record<PaneKey, boolean>;
type InventoryGroup = {
  key: string;
  label: string;
  records: ArtifactVector[];
};
type ImportDefaults = {
  name: string;
  group: string;
  type: SequenceType | 'auto';
  topology: Topology;
};
type RestrictionSourceInput = string | readonly string[];
type MotifArtifactErrorCode =
  | 'MOTIF_INVALID_INVENTORY_REPLACEMENT'
  | 'MOTIF_INVALID_RECORD_INPUT'
  | 'MOTIF_INVALID_GENBANK_IMPORT'
  | 'MOTIF_TRUNCATED_GENBANK_IMPORT'
  | 'MOTIF_RECORD_TOO_LARGE'
  | 'MOTIF_INPUT_LIMIT_EXCEEDED'
  | 'MOTIF_INVALID_ALIGNMENT_INPUT'
  | 'MOTIF_INVALID_WORKSPACE_INPUT'
  | 'MOTIF_UNSAVED_WORKSPACE'
  | 'MOTIF_INVALID_PRELOAD';
type MotifArtifactErrorDetails = Record<string, unknown>;

export class MotifArtifactRuntimeError extends Error {
  readonly code: MotifArtifactErrorCode;
  readonly details: MotifArtifactErrorDetails;

  constructor(code: MotifArtifactErrorCode, message: string, details: MotifArtifactErrorDetails = {}) {
    super(message);
    this.name = 'MotifArtifactRuntimeError';
    this.code = code;
    this.details = details;
  }
}

type TranslateTarget = {
  start: number;
  end: number;
  label: string;
  defaultStrand: 'sense' | 'antisense';
  defaultFrame: 0 | 1 | 2;
  key: string;
  whole: boolean;
  featureId?: string;
  translationTableId?: number;
  completeCds?: boolean;
  translationSource?: 'feature' | 'layer';
};

const THEME_OPTIONS: Array<{ id: ArtifactThemeName; label: string; description: string }> = [
  { id: 'light', label: 'Light', description: 'Neutral surface · blue' },
  { id: 'dark', label: 'Dark', description: 'Deep neutral · blue' },
  { id: 'claude-light', label: 'Claude Light', description: 'Warm paper · coral' },
  { id: 'claude-dark', label: 'Claude Dark', description: 'Warm charcoal · coral' },
];

const DEFAULT_ENZYME_SOURCES: readonly RestrictionEnzymeSourceId[] = ['common', 'golden-gate-type-iis'];
const RESTRICTION_SOURCE_OPTIONS: Array<{
  id: RestrictionEnzymeSourceId;
  label: string;
  description: string;
  enzymeCount: number;
}> = [
  {
    id: 'common',
    label: 'Common',
    description: 'Default working-set enzymes for routine maps.',
    enzymeCount: RESTRICTION_ENZYMES.length,
  },
  ...RESTRICTION_PRESETS.map((preset) => ({
    id: preset.id,
    label: preset.shortName,
    description: preset.description,
    enzymeCount: preset.enzymeNames.length,
  })),
  {
    id: 'all',
    label: 'Full list',
    description: 'Full bundled restriction-enzyme catalog.',
    enzymeCount: RESTRICTION_ENZYMES_FULL.length,
  },
];
const VALID_RESTRICTION_SOURCE_IDS = new Set<RestrictionEnzymeSourceId>(RESTRICTION_SOURCE_OPTIONS.map((option) => option.id));

function normalizeRestrictionSources(
  sources: RestrictionSourceInput,
  fallback: readonly RestrictionEnzymeSourceId[] = DEFAULT_ENZYME_SOURCES,
): RestrictionEnzymeSourceId[] {
  const list = Array.isArray(sources) ? sources : [sources];
  const cleaned = list.filter((source): source is RestrictionEnzymeSourceId => (
    VALID_RESTRICTION_SOURCE_IDS.has(source as RestrictionEnzymeSourceId)
  ));
  if (cleaned.includes('all')) return ['all'];
  if (Array.isArray(sources) && sources.length === 0) return [];
  return cleaned.length > 0 ? Array.from(new Set(cleaned)) : [...fallback];
}

function restrictionEnzymeNamesForSources(sources: readonly RestrictionEnzymeSourceId[]): string[] {
  if (sources.length === 0) return [];
  return resolveEnzymeUnion(sources).map((enzyme) => enzyme.name);
}

function restrictionEnzymesForSources(
  sources: readonly RestrictionEnzymeSourceId[],
  customEnzymes: readonly RestrictionEnzyme[] = [],
): RestrictionEnzyme[] {
  const byName = new Map<string, RestrictionEnzyme>();
  if (sources.length > 0) {
    for (const enzyme of resolveEnzymeUnion(sources)) byName.set(enzyme.name.toLowerCase(), enzyme);
  }
  for (const enzyme of customEnzymes) byName.set(enzyme.name.toLowerCase(), enzyme);
  return Array.from(byName.values());
}

const DEFAULT_PANE_WIDTHS: PaneWidths = {
  inventory: 210,
  sequence: 520,
  map: 560,
  tools: 260,
};

// Sequence's max is a backstop, not the working constraint. Two mechanisms already
// bound this pane physically: resizePanePair refuses to take the neighbour below its
// own min, and clampPaneWidthsForViewport shrinks everything proportionally once the
// row stops fitting. The old 760 sat BELOW both of them, so it — not the workspace —
// was what stopped the drag, at every desktop width including 2560 where the map was
// sitting on 1528px of slack and dragging moved nothing at all.
//
// The pane earns the width: at 760 the sequence renders 85 bases per line over 79
// lines; at 1500 it renders 185 over 41, with no horizontal overflow either way. The
// cap was costing 2.2x the vertical scrolling for nothing.
//
// 2000 is chosen so the real constraints bind first across every width we lay out for:
// the physical ceiling is main - inventory - toolsRail - handles - map.min, which is
// ~1348px at 1920 and ~1988px at 2560 (the widest common desktop). Past that the cap
// resumes as a backstop rather than a governor. It must stay a CONSTANT: the drag
// handler clamps preferredPaneWidths to this max, so a viewport-derived value would
// permanently shrink the user's remembered width every time they narrowed the window.
const PANE_WIDTH_LIMITS: Record<ResizablePaneKey, { min: number; max: number }> = {
  inventory: { min: 160, max: 420 },
  sequence: { min: 240, max: 2000 },
  map: { min: 300, max: 900 },
  tools: { min: 220, max: 540 },
};

const STACKED_PANE_HEIGHT_LIMITS: Record<StackedResizablePaneKey, { min: number; max: number }> = {
  inventory: { min: 96, max: 520 },
  sequence: { min: 280, max: 900 },
};
const COMPACT_PINNED_PANE_WIDTH_LIMITS: Partial<Record<ResizablePaneKey, { min: number; max: number }>> = {
  inventory: { min: 160, max: 280 },
  tools: { min: 240, max: 320 },
};
const COMPACT_ROW_DIVIDER_HEIGHT = 9;
const COMPACT_ROW_MIN_HEIGHT = 240;
const COMPACT_SHORT_ROW_MIN_HEIGHT = 150;
const TWO_ROW_VERY_SHORT_MIN_HEIGHT = 120;
const DEFAULT_STACKED_PANE_HEIGHTS: StackedPaneHeights = { inventory: null, sequence: null };

const TOOLS_RAIL_WIDTH = 48;
const DEFAULT_PANE_VISIBILITY: PaneVisibility = {
  inventory: true,
  map: true,
  sequence: true,
  tools: true,
};

const DEFAULT_PANE_ORDER: readonly PaneKey[] = ['inventory', 'sequence', 'map', 'tools'];
const CONTENT_PANE_KEYS: readonly Exclude<PaneKey, 'tools'>[] = ['inventory', 'sequence', 'map'];
const STACKED_LAYOUT_MEDIA = '(max-width: 767px)';
const COMPACT_PINNED_LAYOUT_MEDIA = '(min-width: 640px) and (max-width: 1535px)';
const TWO_ROW_LAYOUT_MEDIA = '(min-width: 640px) and (max-width: 1535px)';
const OVERLAY_TOOLS_LAYOUT_MEDIA = '(max-width: 1535px)';
const PANE_ORDER_FALLBACK: Record<PaneKey, number> = DEFAULT_PANE_ORDER.reduce(
  (acc, pane, index) => ({ ...acc, [pane]: index }),
  {} as Record<PaneKey, number>,
);

const PANE_SELECTOR: Record<PaneKey, string> = {
  inventory: '.motif-cs-sidebar',
  map: '.motif-cs-map-column',
  sequence: '.motif-cs-sequence-column',
  tools: '.motif-cs-inspector',
};

const PANE_LABELS: Record<PaneKey, string> = {
  inventory: 'inventory',
  map: 'map',
  sequence: 'sequence',
  tools: 'tools',
};

const PANE_ICONS: Record<PaneKey, LucideIcon> = {
  inventory: LayoutGrid,
  map: MapIcon,
  sequence: List,
  tools: Wrench,
};

/**
 * The pane widths React holds are flex-basis values; what the user sees is the basis
 * plus whatever share of the row's leftover space flex-grow assigned. Any interaction
 * that reasons about "how much room does the neighbour have left" has to use the
 * rendered geometry, or it will refuse to move while slack is still visible on screen.
 *
 * Falls back to the stored width per pane, so a pane that is floating (and therefore
 * not part of the row), hidden, or not yet mounted keeps its value rather than
 * collapsing to zero.
 */
function measuredPaneWidths(stored: PaneWidths, placements: PanePlacements): PaneWidths {
  const next = { ...stored };
  if (typeof document === 'undefined') return next;
  for (const pane of Object.keys(next) as ResizablePaneKey[]) {
    if (placements[pane] !== 'docked') continue;
    const element = document.querySelector<HTMLElement>(PANE_SELECTOR[pane]);
    const width = element?.getBoundingClientRect().width ?? 0;
    if (width > 0) next[pane] = width;
  }
  return next;
}

const DEFAULT_PANE_PLACEMENTS: PanePlacements = {
  inventory: 'docked',
  map: 'docked',
  sequence: 'docked',
  tools: 'docked',
};

const FLOATING_PANE_LIMITS: Record<PaneKey, FloatingSurfaceSizeLimits> = {
  inventory: { minWidth: 260, minHeight: 280, maxWidth: 620, maxHeight: 760 },
  sequence: { minWidth: 420, minHeight: 320, maxWidth: 1040, maxHeight: 900 },
  map: { minWidth: 340, minHeight: 320, maxWidth: 900, maxHeight: 900 },
  tools: { minWidth: 280, minHeight: 280, maxWidth: 720, maxHeight: 900 },
};

function floatingPaneViewport(): FloatingSurfaceViewport {
  const topbarBottom = typeof document === 'undefined'
    ? 0
    : document.querySelector<HTMLElement>('.motif-cs-topbar')?.getBoundingClientRect().bottom ?? 0;
  const toolsRailWidth = typeof document === 'undefined'
    ? 0
    : document.querySelector<HTMLElement>('.motif-cs-inspector[data-tools-pinned="false"]')?.getBoundingClientRect().width ?? 0;
  return {
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 800 : window.innerHeight,
    insets: {
      top: Math.max(8, topbarBottom + 8),
      right: Math.max(8, toolsRailWidth + 8),
      bottom: 8,
      left: 8,
    },
  };
}

function defaultFloatingPaneRects(viewport = floatingPaneViewport()): FloatingPaneRects {
  const defaults: FloatingPaneRects = {
    inventory: { x: 24, y: 92, w: 340, h: 520 },
    sequence: { x: Math.max(24, viewport.width * 0.18), y: 76, w: 680, h: 620 },
    map: { x: Math.max(24, viewport.width - 620), y: 92, w: 580, h: 580 },
    tools: { x: Math.max(24, viewport.width - 420), y: 84, w: 360, h: 620 },
  };
  return defaults;
}

type WorkspaceLayoutPrefs = {
  theme: ArtifactThemeName;
  paneWidths: PaneWidths;
  stackedPaneHeights: StackedPaneHeights;
  paneVisibility: PaneVisibility;
  paneOrder: PaneKey[];
  toolsPinned: boolean;
  panePlacements: PanePlacements;
  floatingPaneRects: FloatingPaneRects;
};

const WORKSPACE_LAYOUT_STORAGE_KEY = 'motif.claude-science.workspace-layout.v1';
const MSA_VIEW_STORAGE_KEY = 'motif.claude-science.msa-view.v1';
const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayoutPrefs = {
  theme: 'light',
  paneWidths: DEFAULT_PANE_WIDTHS,
  stackedPaneHeights: DEFAULT_STACKED_PANE_HEIGHTS,
  paneVisibility: DEFAULT_PANE_VISIBILITY,
  paneOrder: [...DEFAULT_PANE_ORDER],
  toolsPinned: false,
  panePlacements: DEFAULT_PANE_PLACEMENTS,
  floatingPaneRects: defaultFloatingPaneRects(),
};

function isPaneKey(value: unknown): value is PaneKey {
  return typeof value === 'string' && DEFAULT_PANE_ORDER.includes(value as PaneKey);
}

function normalizeArtifactThemeName(value: unknown): ArtifactThemeName {
  if (value === 'light' || value === 'dark' || value === 'claude-light' || value === 'claude-dark') return value;
  if (value === 'claude') return 'claude-light';
  if (value === 'tokyo') return 'claude-dark';
  return DEFAULT_WORKSPACE_LAYOUT.theme;
}

function applyArtifactTheme(theme: ArtifactThemeName): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = theme;
  const themeColor = window.getComputedStyle(root).getPropertyValue('--workspace-bg').trim();
  if (themeColor) document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', themeColor);
}

function normalizePaneWidths(value: unknown): PaneWidths {
  const source = value && typeof value === 'object' ? value as Partial<Record<ResizablePaneKey, unknown>> : {};
  const next: PaneWidths = { ...DEFAULT_PANE_WIDTHS };
  for (const key of Object.keys(DEFAULT_PANE_WIDTHS) as ResizablePaneKey[]) {
    const raw = source[key];
    if (!Number.isFinite(raw)) continue;
    const limits = PANE_WIDTH_LIMITS[key];
    next[key] = clamp(raw as number, limits.min, limits.max);
  }
  return next;
}

function normalizeStackedPaneHeights(value: unknown): StackedPaneHeights {
  const source = value && typeof value === 'object' ? value as Partial<StackedPaneHeights> : {};
  const next: StackedPaneHeights = { ...DEFAULT_STACKED_PANE_HEIGHTS };
  for (const pane of Object.keys(DEFAULT_STACKED_PANE_HEIGHTS) as StackedResizablePaneKey[]) {
    const height = source[pane];
    const limits = STACKED_PANE_HEIGHT_LIMITS[pane];
    next[pane] = Number.isFinite(height) ? clamp(height as number, limits.min, limits.max) : null;
  }
  return next;
}

function normalizePaneVisibility(value: unknown): PaneVisibility {
  const source = value && typeof value === 'object' ? value as Partial<Record<PaneKey, unknown>> : {};
  const next: PaneVisibility = { ...DEFAULT_PANE_VISIBILITY };
  for (const key of DEFAULT_PANE_ORDER) {
    if (typeof source[key] === 'boolean') next[key] = source[key];
  }
  // The right rail is a persistent workspace anchor; keep it present
  // and let Tools switch between rail and expanded states instead of disappearing.
  next.tools = true;
  // The permanent Tools rail is navigation, not workspace content. Recover old
  // saved layouts that hid every content pane instead of reopening to a blank page.
  if (!CONTENT_PANE_KEYS.some((key) => next[key])) next.sequence = true;
  return next;
}

function normalizePaneOrder(value: unknown): PaneKey[] {
  const ordered = Array.isArray(value) ? value.filter(isPaneKey) : [];
  return [...ordered, ...DEFAULT_PANE_ORDER].filter((pane, index, list) => list.indexOf(pane) === index);
}

function normalizePanePlacements(value: unknown): PanePlacements {
  const source = value && typeof value === 'object' ? value as Partial<Record<PaneKey, unknown>> : {};
  return Object.fromEntries(DEFAULT_PANE_ORDER.map((pane) => [
    pane,
    source[pane] === 'floating' ? 'floating' : 'docked',
  ])) as PanePlacements;
}

function normalizeFloatingPaneRects(value: unknown): FloatingPaneRects {
  const source = value && typeof value === 'object' ? value as Partial<Record<PaneKey, unknown>> : {};
  const defaults = defaultFloatingPaneRects();
  return Object.fromEntries(DEFAULT_PANE_ORDER.map((pane) => {
    const candidate = source[pane];
    const rect = candidate && typeof candidate === 'object' ? candidate as Partial<FloatingSurfaceRect> : {};
    const limits = FLOATING_PANE_LIMITS[pane];
    const preferred = {
      x: Number.isFinite(rect.x) ? rect.x as number : defaults[pane].x,
      y: Number.isFinite(rect.y) ? rect.y as number : defaults[pane].y,
      w: clamp(
        Number.isFinite(rect.w) ? rect.w as number : defaults[pane].w,
        limits.minWidth ?? 1,
        limits.maxWidth ?? Number.POSITIVE_INFINITY,
      ),
      h: clamp(
        Number.isFinite(rect.h) ? rect.h as number : defaults[pane].h,
        limits.minHeight ?? 1,
        limits.maxHeight ?? Number.POSITIVE_INFINITY,
      ),
    };
    return [pane, preferred];
  })) as FloatingPaneRects;
}

function normalizeWorkspaceLayout(value: unknown): WorkspaceLayoutPrefs {
  const source = value && typeof value === 'object' ? value as Partial<Record<keyof WorkspaceLayoutPrefs, unknown>> : {};
  const paneVisibility = normalizePaneVisibility(source.paneVisibility);
  let panePlacements = normalizePanePlacements(source.panePlacements);
  if (!CONTENT_PANE_KEYS.some((pane) => paneVisibility[pane] && panePlacements[pane] === 'docked')) {
    const fallbackPane = CONTENT_PANE_KEYS.find((pane) => paneVisibility[pane]) ?? 'sequence';
    panePlacements = { ...panePlacements, [fallbackPane]: 'docked' };
  }
  return {
    theme: normalizeArtifactThemeName(source.theme),
    paneWidths: normalizePaneWidths(source.paneWidths),
    stackedPaneHeights: normalizeStackedPaneHeights(source.stackedPaneHeights),
    paneVisibility,
    paneOrder: normalizePaneOrder(source.paneOrder),
    toolsPinned: panePlacements.tools === 'floating'
      ? true
      : typeof source.toolsPinned === 'boolean' ? source.toolsPinned : DEFAULT_WORKSPACE_LAYOUT.toolsPinned,
    panePlacements,
    floatingPaneRects: normalizeFloatingPaneRects(source.floatingPaneRects),
  };
}

function loadWorkspaceLayoutPrefs(): WorkspaceLayoutPrefs {
  if (typeof window === 'undefined') return DEFAULT_WORKSPACE_LAYOUT;
  try {
    const raw = window.localStorage?.getItem(WORKSPACE_LAYOUT_STORAGE_KEY);
    return raw ? normalizeWorkspaceLayout(JSON.parse(raw)) : DEFAULT_WORKSPACE_LAYOUT;
  } catch {
    return DEFAULT_WORKSPACE_LAYOUT;
  }
}

function saveWorkspaceLayoutPrefs(prefs: WorkspaceLayoutPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(WORKSPACE_LAYOUT_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* localStorage can be unavailable in embedded/private contexts; layout still works in memory. */
  }
}

function clearWorkspaceLayoutPrefs(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.removeItem(WORKSPACE_LAYOUT_STORAGE_KEY);
  } catch {
    /* ignore unavailable storage */
  }
}

function loadMsaViewPreferences(): ClaudeScienceMsaViewPreferences {
  if (typeof window === 'undefined') return DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES;
  try {
    const raw = window.localStorage?.getItem(MSA_VIEW_STORAGE_KEY);
    return raw
      ? normalizeClaudeScienceMsaViewPreferences(JSON.parse(raw))
      : DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES;
  } catch {
    return DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES;
  }
}

function saveMsaViewPreferences(preferences: ClaudeScienceMsaViewPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(MSA_VIEW_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    /* localStorage can be unavailable in embedded/private contexts; MSA settings still work in memory. */
  }
}

function clearMsaViewPreferences(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.removeItem(MSA_VIEW_STORAGE_KEY);
  } catch {
    /* ignore unavailable storage */
  }
}

const INVENTORY_SYSTEM_GROUP_ORDER = ['imported', 'derived', 'protein', 'rna', 'vectors'] as const;
type InventorySystemGroupKey = typeof INVENTORY_SYSTEM_GROUP_ORDER[number];
const INVENTORY_SYSTEM_GROUP_LABELS: Record<InventorySystemGroupKey, string> = {
  imported: 'Imported',
  derived: 'Derived',
  protein: 'Proteins',
  rna: 'RNA',
  vectors: 'Vectors / DNA',
};

function mapThemeForArtifactTheme(theme: ArtifactThemeName): MapThemeName {
  return theme === 'light' || theme === 'claude-light' ? 'light' : 'dark';
}

type MapSelectionRange = {
  start: number;
  end: number;
};

type MapPointerAction = 'range' | 'pan';

type MapDragState =
  | {
      mode: 'range';
      start: MapContentPoint;
      startBp: number;
      lastAngle: number;
      cumulativeAngle: number;
      moved: boolean;
    }
  | {
      mode: 'pan';
      start: MapRootPoint;
      viewport: MapViewport;
      moved: boolean;
    };

type WindowRect = { x: number; y: number; w: number; h: number };

function clampWindowRect(
  rect: WindowRect,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
  rightInset = 0,
): WindowRect {
  const safeRightInset = clamp(rightInset, 0, Math.max(0, viewportWidth - 17));
  const availableWidth = Math.max(1, viewportWidth - safeRightInset);
  const minW = Math.min(280, Math.max(1, availableWidth - 16));
  const minH = Math.min(180, Math.max(1, viewportHeight - 16));
  const maxW = Math.max(minW, availableWidth - 16);
  const maxH = Math.max(minH, viewportHeight - 16);
  const w = clamp(rect.w, minW, maxW);
  const h = clamp(rect.h, minH, maxH);
  const x = clamp(rect.x, 8, Math.max(8, viewportWidth - safeRightInset - w - 8));
  const y = clamp(rect.y, 8, Math.max(8, viewportHeight - Math.min(h, viewportHeight - 16) - 8));
  return { x, y, w, h };
}

function defaultTranslationsWindowRect(): WindowRect {
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
  return clampWindowRect({
    x: Math.max(16, viewportWidth - 760),
    y: Math.max(88, viewportHeight - 440),
    w: 420,
    h: 360,
  }, viewportWidth, viewportHeight);
}

function defaultAlignmentWindowRect(): WindowRect {
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
  // An alignment is the widest, tallest thing this workspace shows, and the
  // caps are what it opens at before anyone drags a corner. The old 940x600
  // ignored the screen entirely: on a 2560x1400 display it left 810px of unused
  // width and 400px of unused height while the residues scrolled in a 194px
  // slot. These caps still keep a visible margin, so it reads as a window
  // rather than a takeover, and both are clamped by the viewport terms beside
  // them on small screens.
  const width = Math.min(940, Math.max(320, viewportWidth - 40));
  const height = Math.min(820, Math.max(300, viewportHeight - 150));
  return clampWindowRect({
    x: Math.max(16, Math.round((viewportWidth - width) / 2)),
    y: Math.max(54, Math.round((viewportHeight - height) / 2)),
    w: width,
    h: height,
  }, viewportWidth, viewportHeight);
}

function defaultGelWindowRect(): WindowRect {
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
  const width = Math.min(860, Math.max(320, viewportWidth - 48));
  const height = Math.min(590, Math.max(320, viewportHeight - 104));
  return clampWindowRect({
    x: Math.max(16, Math.round((viewportWidth - width) / 2)),
    y: Math.max(50, Math.round((viewportHeight - height) / 2)),
    w: width,
    h: height,
  }, viewportWidth, viewportHeight);
}

function defaultAssemblyWindowRect(): WindowRect {
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
  const width = Math.min(1040, Math.max(340, viewportWidth - 40));
  const height = Math.min(650, Math.max(340, viewportHeight - 88));
  return clampWindowRect({
    x: Math.max(16, Math.round((viewportWidth - width) / 2)),
    y: Math.max(42, Math.round((viewportHeight - height) / 2)),
    w: width,
    h: height,
  }, viewportWidth, viewportHeight);
}

function defaultPrimerWindowRect(): WindowRect {
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
  const width = Math.min(1120, Math.max(340, viewportWidth - 40));
  const height = Math.min(720, Math.max(360, viewportHeight - 88));
  return clampWindowRect({
    x: Math.max(16, Math.round((viewportWidth - width) / 2)),
    y: Math.max(42, Math.round((viewportHeight - height) / 2)),
    w: width,
    h: height,
  }, viewportWidth, viewportHeight);
}

function defaultCloningDesignWindowRect(): WindowRect {
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
  const width = Math.min(1180, Math.max(360, viewportWidth - 32));
  const height = Math.min(760, Math.max(380, viewportHeight - 72));
  return clampWindowRect({
    x: Math.max(12, Math.round((viewportWidth - width) / 2)),
    y: Math.max(34, Math.round((viewportHeight - height) / 2)),
    w: width,
    h: height,
  }, viewportWidth, viewportHeight);
}

function defaultConstructVerificationWindowRect(): WindowRect {
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
  const width = Math.min(1180, Math.max(360, viewportWidth - 32));
  const height = Math.min(760, Math.max(380, viewportHeight - 72));
  return clampWindowRect({
    x: Math.max(12, Math.round((viewportWidth - width) / 2)),
    y: Math.max(34, Math.round((viewportHeight - height) / 2)),
    w: width,
    h: height,
  }, viewportWidth, viewportHeight);
}

function createGelResultIdentity(): ClaudeScienceGelResultIdentity {
  return {
    workflowResultId: `gel-${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
    provenance: {
      source: 'motif-for-claude-science-artifact',
      operation: 'gel_preview',
      engine: 'artifact-qualitative-gel',
      engineVersion: '1',
    },
  };
}

declare global {
  interface Window {
    MOTIF_ARTIFACT_DATA?: ArtifactPayload | ArtifactRecordInput | ArtifactRecordInput[];
    motifRenderInventory?: (entriesOrPayload: ArtifactPayload | ArtifactRecordInput | ArtifactRecordInput[]) => void;
    motifAddRecords?: (recordOrRecords: ArtifactRecordInput | ArtifactRecordInput[]) => number;
    motifGetInventory?: () => ArtifactRecordInput[];
    motifGetActiveRecord?: () => ArtifactRecordInput | null;
    motifAddAlignments?: (alignmentOrAlignments: ArtifactAlignmentInput | ArtifactAlignmentInput[]) => number;
    motifGetAlignments?: () => ArtifactAlignmentInput[];
    motifAddNotes?: (noteOrNotes: ArtifactNote | ArtifactNote[]) => number;
    motifGetNotes?: () => ArtifactNote[];
    motifUpdateNote?: (noteId: string, patch: Partial<ArtifactNote> & { updatedAt: string }) => ArtifactNote;
    motifRemoveNotes?: (noteIdOrIds: string | string[]) => number;
    motifAddWorkflowResults?: (resultOrResults: ArtifactWorkflowResult | ArtifactWorkflowResult[]) => number;
    motifGetWorkflowResults?: () => ArtifactWorkflowResult[];
    motifRemoveWorkflowResults?: (resultIdOrIds: string | string[]) => number;
    motifAddAnalysisAssets?: (assetOrAssets: ArtifactAnalysisAsset | ArtifactAnalysisAsset[]) => number;
    motifAddAnalysisResults?: (resultOrResults: ArtifactAnalysisResult | ArtifactAnalysisResult[]) => number;
    motifGetAnalysisWorkspace?: () => { analysisResults: ArtifactAnalysisResult[]; analysisAssets: ArtifactAnalysisAsset[] };
    motifRemoveAnalysisResults?: (resultIdOrIds: string | string[]) => number;
    motifGetWorkspace?: () => Record<string, unknown>;
    motifReplaceWorkspace?: (
      payload: ArtifactPayload,
      options?: { discardUnsavedChanges?: boolean },
    ) => number;
    motifRemoveRecords?: (recordIdOrIds: string | string[]) => number;
    motifClearWorkspace?: () => void;
    motifDescribe?: () => RecordSummary | null;
    motifHelp?: () => MotifHelp;
    motifListRestrictionSources?: () => Array<{ id: RestrictionEnzymeSourceId; label: string; active: boolean; enzymeCount: number; description?: string }>;
    motifSetRestrictionSources?: (sources: RestrictionSourceInput) => RestrictionEnzymeSourceId[];
  }
}

// Self-describing manifest returned by window.motifHelp(). This is the discovery
// surface for the Claude Science coordinating agent: it should NOT hand-edit the
// embedded seed JSON to add sequences — it can call motifAddRecords(...) at runtime.
type MotifHelp = {
  summary: string;
  build: { version: string; runtimeBuildId: string };
  howToAddSequences: string;
  capabilities: Record<string, string>;
  agentRules: string[];
  api: Record<string, string>;
  apis: Record<string, string>;
  restrictionSources: Array<{ id: RestrictionEnzymeSourceId; label: string; description: string; enzymeCount: number }>;
  recordSchema: Record<string, string>;
  featureSchema: Record<string, string>;
  alignmentSchema: Record<string, string>;
  noteSchema: Record<string, string>;
  workflowResultSchema: Record<string, string>;
  analysisResultSchema: Record<string, string>;
  sharing: Record<string, string>;
  example: ArtifactRecordInput;
  groupedExample: ArtifactRecordInput;
};

const DATA_PLACEHOLDERS = ['__SEQUENCE_INVENTORY__', '__MOTIF_ARTIFACT_DATA__'];
const DEFAULT_SCHEMA = MOTIF_INVENTORY_SCHEMA;
/* Two different ORF floors are in use and they are not interchangeable. The
   Analysis panel scans exploratively at 10 aa; the record summary makes a
   citable statement at the classic 30 aa floor. On pUC19 that is 221 against
   96 — the same word, the same record, and a 2.3x disagreement that no reader
   could resolve, because neither readout named its floor except the summary's
   empty case ("none >=30 aa"). Both are correct populations, so the fix is that
   both now say which one they are; unifying them would have moved a number
   somebody may already be quoting. Named here so the label and the argument
   passed to findORFs cannot drift apart. */
const ANALYSIS_ORF_MIN_AA = 10;
const SUMMARY_ORF_MIN_AA = 30;
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.25;
const MAP_FIT_PAN_MARGIN_SCALE = 0.08;
const MAP_FIT_WHEEL_PAN_SCALE = 0.22;
const MAP_ZOOMED_WHEEL_PAN_SCALE = 0.78;
const MAP_CIRCULAR_RANGE_HIT_MIN = 18;
const MAP_CIRCULAR_RANGE_HIT_MAX = 34;
const MAP_LINEAR_RANGE_HIT_Y = 18;
const MAP_LINEAR_RANGE_HIT_X = 8;
const DEFAULT_MAP_VIEWPORT: MapViewport = { k: 1, tx: 0, ty: 0 };
const builtInRecords = JSON.parse(vectorsRaw) as ArtifactRecordInput[];

const MOTIF_HELP_API: Record<string, string> = {
  'motifAddRecords(recordOrRecords)': 'Append one record or an array; returns number added; focuses the first new record.',
  'motifRenderInventory(recordsOrPayload)': 'Replace records while preserving compatible alignments, notes, results, and durable settings. Workspace fields or orphaning replacements are rejected transactionally; use motifReplaceWorkspace for intentional full replacement.',
  'motifGetInventory()': 'Return all current records (serialized, round-trippable into motifAddRecords/motifRenderInventory).',
  'motifGetActiveRecord()': 'Return the currently selected record, or null.',
  'motifAddAlignments(alignmentOrAlignments)': 'Validate and append one precomputed gapped alignment or an array; returns number added.',
  'motifGetAlignments()': 'Return alignments held in this session with engine provenance and gapped rows.',
  'motifAddNotes(noteOrNotes)': 'Validate and append workspace, record, or range notes transactionally; returns number added.',
  'motifGetNotes()': 'Return a defensive snapshot of all saved notes.',
  'motifUpdateNote(noteId, patch)': 'Update one note transactionally. patch.updatedAt is required; id and createdAt are immutable.',
  'motifRemoveNotes(noteIdOrIds)': 'Remove one note id or an array transactionally; returns number removed.',
  'motifAddWorkflowResults(resultOrResults)': 'Append validated digest, gel, Golden Gate, or ligation result provenance.',
  'motifGetWorkflowResults()': 'Return a defensive snapshot of saved workflow results.',
  'motifRemoveWorkflowResults(resultIdOrIds)': 'Remove saved workflow-result ids transactionally; returns number removed.',
  'motifAddAnalysisAssets(assetOrAssets)': 'Append bounded inert text/JSON assets for typed analyses; returns number added.',
  'motifAddAnalysisResults(resultOrResults)': 'Append validated primer, PCR, assembly, construct-verification, BLAST, structure, report, or table results; returns number added and reveals Results.',
  'motifGetAnalysisWorkspace()': 'Return defensive snapshots of typed analysis results and their inert assets.',
  'motifRemoveAnalysisResults(resultIdOrIds)': 'Remove analysis results only when no other result depends on them; returns number removed.',
  'motifGetWorkspace()': 'Return a complete defensive workspace snapshot suitable for motifReplaceWorkspace or JSON backup.',
  'motifReplaceWorkspace(payload, options?)': 'Validate and replace records, alignments, notes, results, and durable state atomically as a session baseline. A dirty workspace is preserved unless options.discardUnsavedChanges is explicitly true.',
  'motifRemoveRecords(recordIdOrIds)': 'Remove records and dependent notes/workflow results transactionally; returns number removed.',
  'motifClearWorkspace()': 'Clear all workspace data while retaining display preferences.',
  'motifDescribe()': 'Return a text summary of the active record + current selection.',
  'motifListRestrictionSources()': 'List selectable restriction-enzyme source groups and which are active for the current record.',
  'motifSetRestrictionSources(sources)': "Set active restriction groups for the current record. Accepts [], 'all', ['all'], or ids such as ['common', 'golden-gate-type-iis'].",
  'motifHelp()': 'Return this manifest.',
};

// window.motifHelp() payload. Kept module-scope + static so the discovery contract
// is identical no matter which record is active. See the effect that assigns
// window.motifAddRecords / window.motifHelp.
const MOTIF_HELP: MotifHelp = {
  summary:
    'Motif sequence workbench. Records (DNA/RNA/protein) are held in an in-memory inventory. ' +
    'You can add, group, inspect, annotate, translate, search, and export sequences at RUNTIME.',
  build: {
    version: MOTIF_ARTIFACT_VERSION,
    runtimeBuildId: MOTIF_ARTIFACT_BUILD_ID,
  },
  howToAddSequences:
    'Call window.motifAddRecords(recordOrRecords) to APPEND without disturbing existing records ' +
    '(returns the count added and focuses the first). Use window.motifRenderInventory(records) only ' +
    'to REPLACE the record inventory; linked workspace data is preserved or the call is rejected. ' +
    'Read the current inventory with window.motifGetInventory().',
  capabilities: {
    addSequences: 'Append DNA, RNA, or protein records at runtime with motifAddRecords(...).',
    groupSequences: "Put records into compact collapsible groups using record.group, project, folder, collection, or tags like 'project:Design queue'.",
    annotateFeatures: 'Provide feature annotations with name/type/start/end/direction/color; clicking a feature highlights the corresponding sequence/map/protein context.',
    inspectSelections: 'Use motifDescribe() after user map/sequence/feature selections to summarize the active record and selected range.',
    restrictionMaps: "Switch restriction source groups with motifSetRestrictionSources([...]); use [] to scan no bundled enzymes, or ['all'] for the full bundled list including Type IIS enzymes.",
    reverseComplement: 'The UI can show/add reverse complements for DNA/RNA records and preserve feature coordinates.',
    translate: 'Translate ranges, complete coding features, or whole nucleotide records with selectable supported NCBI genetic codes. CDS/ORF metadata.transl_table overrides the record translationTableId; unsupported explicit qualifiers block instead of falling back.',
    multipleSequenceAlignment: 'Open Alignment from Tools to compare 2–10 same-type records locally, or inspect/import precomputed MAFFT, MUSCLE, or Clustal Omega aligned FASTA. Alignment nucleotide-to-protein overlays currently use the Standard code.',
    notes: 'Save workspace, record, or selected-range notes in the Tools pane or with motifAddNotes(...). Markdown is stored as inert text.',
    workflowHistory: 'Store digest, gel, Golden Gate, and ligation result summaries with explicit input/output record ids and engine provenance.',
    analysisResults: 'Store typed primer, PCR, assembly, construct-verification, BLAST, structure, report, or table results. The UI renders supplied content as inert text/data only.',
    backupRecovery: 'motifGetWorkspace() and Settings → Data & recovery produce a complete v2 JSON snapshot. A browser download is only a request until the file is verified; restoring a selected JSON file establishes a durable checkpoint. motifReplaceWorkspace(...) hydrates a session baseline transactionally.',
    exportInventory: 'The export panel can produce database JSON, CSV, FASTA, multi-FASTA, basic GenBank, HTML/Markdown report, PDF via print, and ZIP. Workspace data lives in this artifact session, so export JSON or ZIP before reloading.',
  },
  agentRules: [
    'Call window.motifHelp() first when you are unsure what this artifact supports.',
    'For normal user requests, append with motifAddRecords(...); do not rewrite the embedded HTML JSON.',
    'When adding related sequences, set a group/project/folder/collection field so the left inventory stays organized.',
    'After changing inventory, verify with motifGetActiveRecord() or motifGetInventory() before telling the user it worked; motifAddRecords() updates those APIs synchronously.',
    'Use motifAddAlignments(...) for precomputed gapped rows. Never claim the browser artifact executed MAFFT, MUSCLE, or Clustal Omega; preserve the actual engine metadata.',
    'Use motifGetWorkspace()/motifReplaceWorkspace(...) for a complete handoff. motifRenderInventory(...) is records-only and rejects workspace fields so notes or provenance cannot be discarded silently.',
    'Use motifAddAnalysisResults(...) for evidence and computed results. Never inject HTML or SVG; analysis assets accept only bounded inert text/JSON formats.',
    "For enzyme requests, prefer motifSetRestrictionSources(['all']) or specific source ids rather than assuming only common enzymes are available.",
  ],
  api: {
    ...MOTIF_HELP_API,
  },
  apis: {
    ...MOTIF_HELP_API,
  },
  restrictionSources: RESTRICTION_SOURCE_OPTIONS.map((option) => ({ ...option })),
  recordSchema: {
    name: 'string — display name (required in practice).',
    sequence: `string — residues (maximum ${MOTIF_MAX_RECORD_LENGTH.toLocaleString()} per record). Aliases: seq. DNA/RNA = ACGTU…, protein = amino-acid letters.`,
    type: "'dna' | 'rna' | 'protein' — molecule type. Aliases: molecule. Inferred from the sequence if omitted.",
    topology: "'circular' | 'linear' — defaults to circular for DNA, linear otherwise.",
    translationTableId: 'number — optional supported NCBI genetic-code id for DNA/RNA records; defaults to table 1. A CDS/ORF metadata.transl_table qualifier takes precedence.',
    description: 'string — optional one-line description.',
    features: 'ArtifactFeatureInput[] — optional annotations. Alias: annotations.',
    group: 'string — optional compact inventory group. Aliases: project, folder, collection; aliases serialize back as canonical group.',
    organism: 'string — optional.',
    source: 'string — optional provenance label.',
    tags: "string[] — optional; tags prefixed project:, folder:, group:, or collection: also create inventory groups.",
    overhang5: "string — optional explicit left-end single-stranded DNA sequence; '' means known blunt, omission means unspecified.",
    overhang3: "string — optional explicit right-end single-stranded DNA sequence; '' means known blunt, omission means unspecified.",
    overhang5Type: "'blunt' | '5prime' | '3prime' — optional left-end protrusion chemistry; required for assembly-safe sticky ends.",
    overhang3Type: "'blunt' | '5prime' | '3prime' — optional right-end protrusion chemistry; required for assembly-safe sticky ends.",
    sites: 'InventorySiteInput[] — optional precomputed restriction sites. Usually omit and let the artifact scan.',
    id: 'string — optional; auto-generated if omitted.',
  },
  featureSchema: {
    name: 'string — feature label.',
    type: "FeatureType — e.g. 'cds' | 'gene' | 'promoter' | 'terminator' | 'primer_bind' | 'misc_feature' | 'resistance' | 'origin'.",
    start: 'number — 0-indexed inclusive start.',
    end: 'number — exclusive end (end > start).',
    direction: "'forward' | 'reverse' | 'none' (or 1 | -1 | 0) — strand.",
    subRanges: 'non-empty Array<{ start, end, strand? }> — optional authoritative pieces in biological 5′→3′ order; each strand inherits direction when omitted. start/end remain the coordinate envelope. An empty array is treated like omission at the runtime boundary.',
    color: 'string — optional CSS color for the feature.',
    metadata: "object — optional structured provenance/details. CDS/ORF features may set transl_table to a supported NCBI table id; translated feature types may set codon_start to 1, 2, or 3. An unsupported explicit CDS/ORF transl_table is preserved but translation is blocked. Set motifLocationOperator: 'order' only on a multi-piece INSDC order(...) location that must not be implicitly concatenated. For manually authored reverse multipart payloads, set motifSubRangeOrder: 'biological'; unmarked reverse multipart locations are preserved but quarantined from sequence-derived actions because older text-order checkpoints cannot be distinguished safely.",
  },
  alignmentSchema: {
    name: 'string — alignment name used in this session and full-workspace exports.',
    molecule: "'dna' | 'rna' | 'protein' — required; all rows must use this alphabet because symbols alone can be ambiguous.",
    rows: 'Array<{ id?, name, aligned, sourceRecordId? }> — at least 2 equal-length gapped rows; . gaps normalize to -.',
    referenceRowId: 'string — optional row id used as the default visual reference.',
    engine: "{ id, label, version?, mode: 'browser' | 'local-command' | 'imported', parameters?, usedFallback? } — honest provenance for the result.",
    alignedFasta: 'string — alternative to rows when adding a pre-aligned FASTA payload.',
  },
  noteSchema: {
    id: 'string — caller-supplied stable id.',
    scope: "'workspace' | 'record' | 'range'. Record/range notes require recordId; range also requires a 0-based [start,end) range.",
    title: 'string — optional short title.',
    body: 'string — required note text. Markdown is a storage hint and is never interpreted as HTML.',
    format: "'plain' | 'markdown'.",
    createdAt: 'ISO 8601 date-time — immutable.',
    updatedAt: 'ISO 8601 date-time — required for add/update.',
    provenance: 'optional { source, operation?, actor?, engine?, engineVersion?, parentIds?, metadata? }.',
  },
  workflowResultSchema: {
    id: 'string — caller-supplied stable result id.',
    kind: "'digest' | 'gel' | 'golden_gate' | 'ligation'.",
    name: 'string — human-readable result name.',
    inputRecordIds: 'string[] — ordered existing workspace inputs.',
    inputSha256s: 'optional string[] — exact sequence SHA-256 values aligned one-to-one with inputRecordIds.',
    outputRecordIds: 'string[] — derived workspace records, when materialized.',
    parameters: 'JSON object — bounded workflow settings.',
    result: 'optional JSON object — compact fragment, lane, or assembly summary.',
    createdAt: 'ISO 8601 date-time.',
    provenance: 'required { source, operation?, actor?, engine?, engineVersion?, parentIds?, metadata? }.',
  },
  analysisResultSchema: {
    kind: "'primer_design' | 'pcr' | 'assembly_plan' | 'construct_verification' | 'blast_search' | 'structure_model' | 'report' | 'table'.",
    status: "'complete' | 'partial' | 'failed'.",
    inputRecordIds: 'string[] — ordered existing workspace records used by the analysis.',
    inputSha256s: 'optional string[] — exact sequence SHA-256 values aligned to inputRecordIds.',
    dependsOnResultIds: 'string[] — typed result dependencies; cycles and dangling ids are rejected.',
    assetIds: 'string[] — bounded inert analysis assets already added with motifAddAnalysisAssets(...).',
    parameters: 'JSON object — bounded engine/provider settings.',
    data: 'Strict kind-specific object. Call motifHelp() and use the packaged skill for complete examples.',
    provenance: 'required source plus optional actor, operation, engine/version, parent ids, and bounded metadata.',
  },
  sharing: {
    html: 'Use dist-motif/motif-artifact.html or a generated custom artifact. The artifact HTML is self-contained after build.',
    skill: 'Ship dist-motif/motif-for-claude-science-skill/SKILL.md with the HTML so Claude Science/agents know how to drive the runtime APIs.',
    customPayload: 'Build a custom preloaded inventory with npm run build:motif -- --payload payload.json --out preview/custom-motif-artifact.html.',
  },
  example: {
    name: 'GFP (demo)',
    type: 'protein',
    description: 'Example protein record added via motifAddRecords.',
    sequence: 'MSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTLTYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFKDDGNYKTRAEVKFEGDTLVNRIELKGIDFKEDGNILGHKLEYNYNSHNVYIMADKQKNGIKVNFKIRHNIEDGSVQLADHYQQNTPIGDGPVLLPDNHYLSTQSALSKDPNEKRDHMVLLEFVTAAGITHGMDELYK',
    features: [{ name: 'chromophore', type: 'misc_feature', start: 64, end: 67, direction: 'none' }],
    organism: 'Aequorea victoria',
    source: 'demo',
  },
  groupedExample: {
    name: 'Design insert A',
    type: 'dna',
    topology: 'linear',
    translationTableId: 11,
    group: 'Design queue',
    description: 'Example grouped DNA record added via motifAddRecords.',
    sequence: 'ATGGCCGCCGCCGCCGCCGCCGCCGCCGCC',
    features: [{ name: 'coding insert', type: 'cds', start: 0, end: 30, direction: 'forward', metadata: { transl_table: 11, codon_start: 1 } }],
    source: 'demo',
  },
};

const enzymeByLowerName = new Map(RESTRICTION_ENZYMES.map((enzyme) => [enzyme.name.toLowerCase(), enzyme]));
const fullEnzymeByLowerName = new Map(RESTRICTION_ENZYMES_FULL.map((enzyme) => [enzyme.name.toLowerCase(), enzyme]));
const ALLOWED_SEQUENCE_TYPES = new Set<SequenceType>(['dna', 'rna', 'protein', 'misc', 'unknown', 'mixed']);
const emptyFeatures: readonly Feature[] = [];
const emptyTracks: readonly InlineTranslationTrack[] = [];
const emptyTickIds: readonly string[] = [];
const EMPTY_ARTIFACT_VECTOR: ArtifactVector = {
  id: '__empty__',
  name: 'No sequence loaded',
  description: 'Add or drop a DNA, RNA, or protein sequence to begin.',
  sequence: '',
  topology: 'linear',
  type: 'dna',
  features: [],
  sites: [],
  active: false,
};
const featureTypeOptions: FeatureType[] = [
  'cds',
  'gene',
  'promoter',
  'terminator',
  'rbs',
  'origin',
  'resistance',
  'restriction_site',
  'primer_bind',
  'regulatory',
  'sig_peptide',
  'misc_feature',
  'custom',
];
const ALLOWED_FEATURE_TYPES: readonly FeatureType[] = [
  'orf',
  'gene',
  'cds',
  'promoter',
  'terminator',
  'rbs',
  'origin',
  'resistance',
  'restriction_site',
  'primer_bind',
  'misc_feature',
  'mRNA',
  'rRNA',
  'tRNA',
  'ncRNA',
  'regulatory',
  'repeat_region',
  'sig_peptide',
  'mat_peptide',
  'transit_peptide',
  'intron',
  'exon',
  'polyA_signal',
  'enhancer',
  'custom',
];
const featureTypeByLowerName = new Map(ALLOWED_FEATURE_TYPES.map((type) => [type.toLowerCase(), type]));
const SAFE_FEATURE_COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%+\-/]+\)|[a-z]+)$/i;
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * React-side record builders naturally acquire optional keys whose value is
 * `undefined` (for example a missing inventory group or feature sub-range).
 * Those keys are not JSON values and must not cross the same strict contract
 * used by the public runtime API.  Strip object properties only; an undefined
 * array element remains invalid so malformed external-style input is not
 * silently repaired.
 */
export function omitUndefinedObjectProperties<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => omitUndefinedObjectProperties(item)) as T;
  }
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, omitUndefinedObjectProperties(item)]),
  ) as T;
}

function omitRecordState<T>(current: Record<string, T>, removed: ReadonlySet<string>): Record<string, T> {
  let changed = false;
  const next = { ...current };
  for (const id of removed) {
    if (!Object.prototype.hasOwnProperty.call(next, id)) continue;
    delete next[id];
    changed = true;
  }
  return changed ? next : current;
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = Array.from(value).filter((character) => {
    const code = character.charCodeAt(0);
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
  }).join('').trim();
  return normalized || undefined;
}

function normalizeTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags = Array.from(new Set(value
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => normalizeOptionalText(tag))
    .filter((tag): tag is string => Boolean(tag))));
  return tags.length > 0 ? tags : undefined;
}

function normalizeJsonValue(value: unknown, seen = new WeakSet<object>(), depth = 0): ArtifactJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (depth > MOTIF_MAX_METADATA_JSON_DEPTH || (typeof value !== 'object' || value === null)) return null;
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalizeJsonValue(item, seen, depth + 1));
    seen.delete(value);
    return normalized;
  }
  if (!isPlainObject(value)) {
    seen.delete(value);
    return null;
  }
  const normalized: ArtifactJsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (UNSAFE_OBJECT_KEYS.has(key)) continue;
    normalized[key] = normalizeJsonValue(item, seen, depth + 1);
  }
  seen.delete(value);
  return normalized;
}

function normalizeJsonObject(value: unknown): ArtifactJsonObject {
  const normalized = normalizeJsonValue(value);
  return normalized !== null && typeof normalized === 'object' && !Array.isArray(normalized)
    ? normalized
    : {};
}

type JsonInspectionLimits = {
  maxDepth: number;
  maxNodes: number;
  maxBytes: number;
  maxStringLength?: number;
};

type JsonInspectionBudget = {
  nodes: number;
  bytes: number;
};

const METADATA_JSON_LIMITS: JsonInspectionLimits = {
  maxDepth: MOTIF_MAX_METADATA_JSON_DEPTH,
  maxNodes: MOTIF_MAX_METADATA_JSON_NODES,
  maxBytes: MOTIF_MAX_METADATA_JSON_BYTES,
  maxStringLength: MOTIF_MAX_DESCRIPTION_LENGTH,
};

const PAYLOAD_JSON_LIMITS: JsonInspectionLimits = {
  maxDepth: MOTIF_MAX_METADATA_JSON_DEPTH + 5,
  maxNodes: MOTIF_MAX_PAYLOAD_JSON_NODES,
  maxBytes: MOTIF_MAX_PAYLOAD_JSON_BYTES,
};

const utf8Encoder = new TextEncoder();

function jsonEncodedByteLength(value: string): number {
  return utf8Encoder.encode(JSON.stringify(value)).byteLength;
}

function jsonCompatibilityIssue(
  value: unknown,
  path: string,
  limits: JsonInspectionLimits,
  seen = new WeakSet<object>(),
  depth = 0,
  budget: JsonInspectionBudget = { nodes: 0, bytes: 0 },
): string | null {
  budget.nodes += 1;
  if (budget.nodes > limits.maxNodes) {
    return `${path} exceeds the maximum of ${limits.maxNodes.toLocaleString()} JSON nodes`;
  }
  if (depth > limits.maxDepth) return `${path} exceeds the maximum supported nesting depth of ${limits.maxDepth}`;

  if (value === null) {
    budget.bytes += 4;
  } else if (typeof value === 'string') {
    if (limits.maxStringLength !== undefined && value.length > limits.maxStringLength) {
      return `${path} exceeds the maximum string length of ${limits.maxStringLength.toLocaleString()} characters`;
    }
    budget.bytes += jsonEncodedByteLength(value);
  } else if (typeof value === 'boolean') {
    budget.bytes += value ? 4 : 5;
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value)) return `${path} must not contain NaN or Infinity`;
    budget.bytes += String(value).length;
  } else {
    if (typeof value !== 'object') return `${path} must contain JSON-compatible values only`;
    if (seen.has(value)) return `${path} must not contain circular references`;
    if (!Array.isArray(value) && !isPlainObject(value)) return `${path} must contain plain JSON objects only`;
    seen.add(value);
    budget.bytes += 2;
    const entries = Array.isArray(value) ? value.entries() : Object.entries(value);
    let entryCount = 0;
    for (const [key, item] of entries) {
      if (!Array.isArray(value)) {
        if (UNSAFE_OBJECT_KEYS.has(String(key))) {
          seen.delete(value);
          return `${path}.${String(key)} is not an allowed object key`;
        }
        if (String(key).length > MOTIF_MAX_SHORT_TEXT_LENGTH) {
          seen.delete(value);
          return `${path} contains an object key longer than ${MOTIF_MAX_SHORT_TEXT_LENGTH.toLocaleString()} characters`;
        }
        budget.bytes += jsonEncodedByteLength(String(key)) + 1;
      }
      if (entryCount > 0) budget.bytes += 1;
      entryCount += 1;
      const issue = jsonCompatibilityIssue(item, `${path}.${String(key)}`, limits, seen, depth + 1, budget);
      if (issue) {
        seen.delete(value);
        return issue;
      }
    }
    seen.delete(value);
  }

  return budget.bytes > limits.maxBytes
    ? `${path} exceeds the maximum serialized size of ${Math.floor(limits.maxBytes / 1_048_576).toLocaleString()} MiB`
    : null;
}

function normalizeFeatureType(value: unknown): FeatureType {
  if (typeof value !== 'string') return 'misc_feature';
  return featureTypeByLowerName.get(value.trim().toLowerCase()) ?? 'custom';
}

function normalizeFeatureColor(value: unknown): string {
  if (typeof value !== 'string') return '#9AA3B5';
  const color = value.trim();
  return color.length <= 80 && SAFE_FEATURE_COLOR.test(color) ? color : '#9AA3B5';
}

function nextUniqueId(base: string, usedIds: Set<string>): string {
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }
  for (let suffix = 2; suffix < 100_000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!usedIds.has(candidate)) {
      usedIds.add(candidate);
      return candidate;
    }
  }
  const fallback = `${base}-${crypto.randomUUID()}`;
  usedIds.add(fallback);
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sameViewport(a: MapViewport, b: MapViewport): boolean {
  return Math.abs(a.k - b.k) < 0.0001 && Math.abs(a.tx - b.tx) < 0.01 && Math.abs(a.ty - b.ty) < 0.01;
}

function clampMapViewport(
  viewport: MapViewport,
  bg: { x: number; y: number; width: number; height: number },
): MapViewport {
  const k = clamp(Number.isFinite(viewport.k) ? viewport.k : 1, MIN_ZOOM, MAX_ZOOM);
  if (k <= MIN_ZOOM + 0.0001) {
    // At "Fit", allow a small bounded pan. Otherwise a trackpad/mouse wheel over
    // the map appears inert in a full-height workspace where the page itself
    // cannot scroll, which makes the map feel stuck.
    const marginX = Math.max(20, bg.width * MAP_FIT_PAN_MARGIN_SCALE);
    const marginY = Math.max(20, bg.height * MAP_FIT_PAN_MARGIN_SCALE);
    const tx = clamp(Number.isFinite(viewport.tx) ? viewport.tx : 0, -marginX, marginX);
    const ty = clamp(Number.isFinite(viewport.ty) ? viewport.ty : 0, -marginY, marginY);
    return Math.abs(tx) < 0.01 && Math.abs(ty) < 0.01 ? DEFAULT_MAP_VIEWPORT : { k: MIN_ZOOM, tx, ty };
  }

  const right = bg.x + bg.width;
  const minTx = right - right * k;
  const maxTx = bg.x - bg.x * k;
  const bottom = bg.y + bg.height;
  const minTy = bottom - bottom * k;
  const maxTy = bg.y - bg.y * k;

  return {
    k,
    tx: clamp(Number.isFinite(viewport.tx) ? viewport.tx : 0, Math.min(minTx, maxTx), Math.max(minTx, maxTx)),
    ty: clamp(Number.isFinite(viewport.ty) ? viewport.ty : 0, Math.min(minTy, maxTy), Math.max(minTy, maxTy)),
  };
}

function effectiveSequenceScroller(sequenceElement: HTMLElement): HTMLElement {
  if (sequenceElement.scrollHeight > sequenceElement.clientHeight + 1) return sequenceElement;
  const pane = sequenceElement.closest<HTMLElement>('.motif-cs-sequence-column');
  return pane && pane.scrollHeight > pane.clientHeight + 1 ? pane : sequenceElement;
}

function looksLikeImplicitProteinSequence(rawSequence: string): boolean {
  const trimmed = rawSequence.trim();
  if (!trimmed || /[a-z]/.test(trimmed)) return false;

  // Keep automatic inference conservative. Horizontal whitespace between
  // residue-like words is much more likely to be prose ("HELLO WORLD") than a
  // sequence; wrapped FASTA rows have already been joined by parseFasta.
  return !/[A-Z*][\t ]+[A-Z*]/.test(trimmed);
}

export function normalizeSequence(sequence: unknown, sequenceTypeHint?: unknown): string {
  if (typeof sequence !== 'string') return '';
  const normalized = sequence.toUpperCase().replace(/[^A-Z*]/g, '');
  const withoutStops = normalized.replace(/\*/g, '');
  if (sequenceTypeHint === 'dna') return /^[ACGTRYSWKMBDHVN]+$/.test(withoutStops) ? withoutStops : '';
  if (sequenceTypeHint === 'rna') return /^[ACGURYSWKMBDHVN]+$/.test(withoutStops) ? withoutStops : '';
  if (sequenceTypeHint === 'protein') return /^[ACDEFGHIKLMNPQRSTVWYOUJBXZ*]+$/.test(normalized) ? normalized : '';
  if (normalized.includes('*')) return /^[ACDEFGHIKLMNPQRSTVWYOUJBXZ*]+$/.test(normalized) ? normalized : '';
  if (/^[ACGTUNRYSWKMBDHV]+$/.test(withoutStops)) return withoutStops;
  return /^[ACDEFGHIKLMNPQRSTVWYOUJBXZ]+$/.test(withoutStops) && looksLikeImplicitProteinSequence(sequence)
    ? withoutStops
    : '';
}

function normalizeSequenceType(type: unknown, sequence: string): SequenceType {
  if (type === 'dna' || type === 'rna' || type === 'protein' || type === 'misc' || type === 'unknown' || type === 'mixed') {
    return type;
  }
  if (sequence.includes('*')) return 'protein';
  if (/^[ACGTUNRYSWKMBDHV]+$/i.test(sequence)) return sequence.includes('U') && !sequence.includes('T') ? 'rna' : 'dna';
  return 'protein';
}

function normalizeTopology(topology: unknown, sequenceType: SequenceType): Topology {
  if (topology === 'linear' || topology === 'circular') return topology;
  return sequenceType === 'dna' ? 'circular' : 'linear';
}

function normalizeRecordOverhang(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return undefined;
  const normalized = value.toUpperCase().replace(/\s+/g, '');
  return /^[ACGTRYSWKMBDHVN]*$/.test(normalized) ? normalized : undefined;
}

function normalizeRecordOverhangType(value: unknown, sequence: string | undefined): ArtifactOverhangType | undefined {
  if (value === 'blunt' || value === '5prime' || value === '3prime') return value;
  return sequence === '' ? 'blunt' : undefined;
}

function recordEndLabel(sequence: string | undefined, type: ArtifactOverhangType | undefined): string {
  if (sequence === undefined) return 'unspecified';
  if (sequence === '') return 'blunt';
  const polarity = type === '5prime' ? '5′' : type === '3prime' ? '3′' : 'polarity unspecified';
  return `${sequence} (${polarity} overhang)`;
}

function normalizeSubRanges(value: unknown, sequenceLength: number): Feature['subRanges'] {
  if (!Array.isArray(value)) return undefined;
  const ranges = value.flatMap((candidate) => {
    if (!isPlainObject(candidate) || !Number.isFinite(candidate.start) || !Number.isFinite(candidate.end)) return [];
    const start = clamp(Math.floor(Number(candidate.start)), 0, sequenceLength);
    const end = clamp(Math.floor(Number(candidate.end)), start, sequenceLength);
    if (end <= start) return [];
    const strand = candidate.strand === -1 || candidate.strand === 0 || candidate.strand === 1
      ? candidate.strand
      : undefined;
    return [{ start, end, ...(strand === undefined ? {} : { strand }) }];
  });
  return ranges;
}

function normalizeFeature(
  feature: ArtifactFeatureInput,
  index: number,
  sequenceLength: number,
): Feature | null {
  if (!isPlainObject(feature)) return null;
  const rawStart = Number.isFinite(feature.start) ? Math.floor(Number(feature.start)) : 0;
  const rawEnd = Number.isFinite(feature.end) ? Math.floor(Number(feature.end)) : rawStart;
  const start = Math.max(0, Math.min(sequenceLength, rawStart));
  const end = Math.max(start, Math.min(sequenceLength, rawEnd));

  const direction = feature.direction;
  const strand = feature.strand === -1 || feature.strand === 0 || feature.strand === 1
    ? feature.strand
    : direction === 'reverse'
      ? -1
      : direction === 'none'
        ? 0
        : direction === -1 || direction === 0 || direction === 1
          ? direction
    : 1;

  let subRanges = normalizeSubRanges(feature.subRanges, sequenceLength);
  if (subRanges?.length === 0) subRanges = undefined;
  if (!subRanges && end <= start) return null;
  let metadata = normalizeJsonObject(feature.metadata);
  const segmentStrands = subRanges?.map((range) => (
    range.strand === -1 || range.strand === 0 || range.strand === 1 ? range.strand : strand
  ));
  const normalizedStrand: FeatureStrand = !segmentStrands
    ? strand as FeatureStrand
    : segmentStrands.every((segmentStrand) => segmentStrand === -1)
      ? -1
      : segmentStrands.every((segmentStrand) => segmentStrand === 1)
        ? 1
        : segmentStrands.every((segmentStrand) => segmentStrand === 0)
          ? 0
          : 0;
  // Preserve caller order: an unmarked reverse array can mean either a current
  // biological-order payload or an older, undocumented GenBank import in text
  // order, and those cannot be distinguished losslessly. Never guess by
  // silently reversing it. Unmarked reverse locations are quarantined from
  // sequence-derived actions; known/new biological-order locations carry an
  // explicit marker so subsequent workspace checkpoints are unambiguous. An
  // existing quarantine remains authoritative across coordinate transforms;
  // only an explicit biological marker can clear it.
  if (subRanges && subRanges.length > 1) {
    if (metadata.motifSubRangeOrder === 'biological') {
      delete metadata.motifSubRangeOrderAmbiguous;
    } else if (metadata.motifSubRangeOrderAmbiguous === true || strand === -1 || normalizedStrand === -1) {
      metadata = { ...metadata, motifSubRangeOrderAmbiguous: true };
      delete metadata.motifSubRangeOrder;
    } else {
      metadata = { ...metadata, motifSubRangeOrder: 'biological' };
      delete metadata.motifSubRangeOrderAmbiguous;
    }
  }
  const normalizedStart = subRanges ? Math.min(...subRanges.map((range) => range.start)) : start;
  const normalizedEnd = subRanges ? Math.max(...subRanges.map((range) => range.end)) : end;

  return {
    id: normalizeOptionalText(feature.id) ?? `feature-${index + 1}`,
    name: normalizeOptionalText(feature.name) ?? `Feature ${index + 1}`,
    type: normalizeFeatureType(feature.type),
    start: normalizedStart,
    end: normalizedEnd,
    strand: normalizedStrand,
    color: normalizeFeatureColor(feature.color),
    metadata,
    subRanges,
  };
}

function normalizeSitePosition(position: unknown, defaultIndexBase: 0 | 1): number | null {
  if (!Number.isFinite(position)) return null;
  const raw = Math.floor(Number(position));
  if (raw < 0) return null;
  if (defaultIndexBase === 0) return raw;
  return raw === 0 ? 0 : raw - 1;
}

function normalizeSites(sites: readonly InventorySiteInput[] | undefined, sequenceLength: number): RestrictionSite[] {
  if (!Array.isArray(sites) || sequenceLength <= 0) return [];
  const normalized: RestrictionSite[] = [];

  for (const site of sites) {
    if (!isPlainObject(site)) continue;
    const enzymeName = typeof site.enzyme === 'string' && site.enzyme.trim()
      ? site.enzyme.trim()
      : typeof site.motif === 'string' && site.motif.trim()
        ? site.motif.trim()
        : 'site';
    const enzyme = fullEnzymeByLowerName.get(enzymeName.toLowerCase()) ?? enzymeByLowerName.get(enzymeName.toLowerCase());
    const recognitionSequence = normalizeOptionalText(site.motif) ?? enzyme?.recognitionSequence ?? enzymeName;
    const defaultIndexBase = site.indexBase === 0 ? 0 : 1;

    for (const hit of Array.isArray(site.hits) ? site.hits : []) {
      if (!isPlainObject(hit)) continue;
      const hitIndexBase = hit.indexBase === 0 || hit.indexBase === 1 ? hit.indexBase : defaultIndexBase;
      const position = normalizeSitePosition(hit.position, hitIndexBase);
      if (position === null || position >= sequenceLength) continue;
      const cutPosition = normalizeSitePosition(hit.cutPosition, hitIndexBase)
        ?? ((position + (enzyme?.cutOffset ?? 0)) % sequenceLength);
      normalized.push({
        enzyme: enzyme?.name ?? enzymeName,
        position,
        cutPosition,
        recognitionSequence,
        overhang: site.overhang === '5prime' || site.overhang === '3prime' || site.overhang === 'blunt'
          ? site.overhang
          : enzyme?.overhang ?? 'blunt',
        strand: hit.strand === -1 ? -1 : 1,
      });
    }
  }

  return normalized;
}

function normalizeInventoryGroupLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const label = value.replace(/\s+/g, ' ').trim();
  if (!label) return undefined;
  return label;
}

function truncatedGenBankReason(record: unknown): string | null {
  if (!isObject(record)) return null;
  const marker = record.truncated;
  if (!marker) return null;
  if (isObject(marker) && typeof marker.reason === 'string' && marker.reason.trim()) return marker.reason.trim();
  return 'The GenBank record is marked as truncated.';
}

export function normalizeRecord(
  record: ArtifactRecordInput,
  index: number,
): ArtifactVector | null {
  if (!isObject(record) || truncatedGenBankReason(record)) return null;
  const sequenceTypeHint = record.molecule ?? record.type;
  const sequence = normalizeSequence(record.seq ?? record.sequence ?? '', sequenceTypeHint);
  if (!sequence || sequence.length > MOTIF_MAX_RECORD_LENGTH) return null;

  const type = normalizeSequenceType(sequenceTypeHint, sequence);
  if (record.sangerTrace !== undefined && type !== 'dna') {
    throw new Error('sangerTrace is only valid on DNA records.');
  }
  const translationTableId = record.translationTableId === undefined
    ? undefined
    : normalizeArtifactTranslationTableId(record.translationTableId);
  if (translationTableId === null) {
    throw new Error('translationTableId must be a supported NCBI genetic-code id.');
  }
  if (translationTableId !== undefined && !isNucleotideType(type)) {
    throw new Error('translationTableId is only valid on DNA and RNA records.');
  }
  const topology = normalizeTopology(record.topology, type);
  const rawId = normalizeOptionalText(record.id) ?? normalizeOptionalText(record.name) ?? `record-${index + 1}`;
  const id = rawId || `record-${index + 1}`;
  const rawFeatures = Array.isArray(record.annotations)
    ? record.annotations
    : Array.isArray(record.features)
      ? record.features
      : [];
  const usedFeatureIds = new Set<string>();
  const features = rawFeatures
    .map((feature, featureIndex) => normalizeFeature(feature, featureIndex, sequence.length))
    .filter((feature): feature is Feature => feature !== null)
    .map((feature) => ({ ...feature, id: nextUniqueId(feature.id, usedFeatureIds) }));
  const overhang5 = normalizeRecordOverhang(record.overhang5);
  const overhang3 = normalizeRecordOverhang(record.overhang3);

  return {
    id,
    name: normalizeOptionalText(record.name) ?? id,
    description: normalizeOptionalText(record.description),
    sequence,
    topology,
    type,
    translationTableId,
    features,
    sites: normalizeSites(record.sites, sequence.length),
    organism: normalizeOptionalText(record.organism),
    source: normalizeOptionalText(record.source),
    group: normalizeInventoryGroupLabel(record.group ?? record.project ?? record.folder ?? record.collection),
    dateAdded: normalizeOptionalText(record.dateAdded),
    tags: normalizeTags(record.tags),
    overhang5,
    overhang3,
    overhang5Type: normalizeRecordOverhangType(record.overhang5Type, overhang5),
    overhang3Type: normalizeRecordOverhangType(record.overhang3Type, overhang3),
    active: record.active !== false,
    default: record.default === true,
    provenance: isPlainObject(record.provenance) ? normalizeJsonObject(record.provenance) : undefined,
    sangerTrace: record.sangerTrace === undefined
      ? undefined
      : normalizeArtifactSangerTrace(record.sangerTrace, sequence),
  };
}

function normalizeRecords(records: ArtifactRecordInput[]): ArtifactVector[] {
  const usedIds = new Set<string>();
  const normalized: ArtifactVector[] = [];

  records.forEach((record, index) => {
    const next = normalizeRecord(record, index);
    if (!next) return;

    const id = nextUniqueId(next.id, usedIds);
    normalized.push({ ...next, id });
  });

  return normalized;
}

function isNucleotideType(sequenceType: SequenceType): boolean {
  return sequenceType === 'dna' || sequenceType === 'rna';
}

function safeSlug(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'record';
}

function uniqueRecordId(base: string, records: readonly ArtifactVector[], preserveBase = false): string {
  const used = new Set(records.map((record) => record.id));
  if (preserveBase && base && !used.has(base)) return base;
  if (preserveBase && base) {
    for (let index = 2; index < 10000; index += 1) {
      const candidate = `${base}-${index}`;
      if (!used.has(candidate)) return candidate;
    }
    return `${base}-${Date.now()}`;
  }
  const root = safeSlug(base);
  if (!used.has(root)) return root;
  for (let index = 2; index < 10000; index += 1) {
    const candidate = `${root}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${root}-${Date.now()}`;
}

function uniqueAlignmentId(base: string, alignments: readonly ArtifactAlignment[]): string {
  const used = new Set(alignments.map((alignment) => alignment.id));
  const root = safeSlug(base || 'alignment');
  if (!used.has(root)) return root;
  for (let index = 2; index < 10000; index += 1) {
    const candidate = `${root}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${root}-${Date.now()}`;
}

function uniqueAlignmentName(base: string, alignments: readonly ArtifactAlignment[]): string {
  const requested = base.trim() || 'Alignment';
  const used = new Set(alignments.map((alignment) => alignment.name.trim().toLowerCase()));
  if (!used.has(requested.toLowerCase())) return requested;
  // Saving a copy of a copy passes in a name this function already suffixed, and
  // suffixing that again concatenated instead of counting: "REVIEW 2" became
  // "REVIEW 2 2" and then "REVIEW 2 2 2", names that defeat telling the results
  // apart. Count from the root instead — but only when the bare root is itself
  // taken, so a name that merely ends in a number ("Run 2019") is never rewritten
  // into one the user never chose.
  const suffixed = /^(.*\S)\s+\d+$/.exec(requested);
  const root = suffixed && used.has(suffixed[1].toLowerCase()) ? suffixed[1] : requested;
  for (let index = 2; index < 10000; index += 1) {
    const candidate = `${root} ${index}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${root} ${Date.now()}`;
}

function uniqueFeatureId(base: string, features: readonly Feature[]): string {
  const used = new Set(features.map((feature) => feature.id));
  const root = `feature-${safeSlug(base)}`;
  if (!used.has(root)) return root;
  for (let index = 2; index < 10000; index += 1) {
    const candidate = `${root}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${root}-${Date.now()}`;
}

function serializeSites(sites: readonly RestrictionSite[]): InventorySiteInput[] {
  const grouped = new Map<string, InventorySiteInput>();
  for (const site of sites) {
    const key = `${site.enzyme}:${site.recognitionSequence}:${site.overhang}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.hits = [
        ...(existing.hits ?? []),
        {
          position: site.position + 1,
          cutPosition: site.cutPosition + 1,
          strand: site.strand ?? 1,
        },
      ];
      existing.count = existing.hits.length;
    } else {
      grouped.set(key, {
        enzyme: site.enzyme,
        motif: site.recognitionSequence,
        count: 1,
        overhang: site.overhang,
        hits: [{
          position: site.position + 1,
          cutPosition: site.cutPosition + 1,
          strand: site.strand ?? 1,
        }],
      });
    }
  }
  return Array.from(grouped.values());
}

function reverseComplementRestrictionSites(sites: readonly RestrictionSite[], sequenceLength: number): RestrictionSite[] {
  if (sequenceLength <= 0) return [];
  return sites.map((site) => {
    const recognitionLength = Math.max(1, cleanMotif(site.recognitionSequence, 'dna').length || site.recognitionSequence.length || 1);
    const mirroredStart = sequenceLength - Math.min(sequenceLength, site.position + recognitionLength);
    const mirroredCut = ((sequenceLength - site.cutPosition) % sequenceLength + sequenceLength) % sequenceLength;
    return {
      ...site,
      position: Math.max(0, Math.min(sequenceLength - 1, mirroredStart)),
      cutPosition: mirroredCut,
      strand: site.strand === -1 ? 1 : -1,
    };
  });
}

function serializeRecord(record: ArtifactVector): ArtifactRecordInput {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    molecule: record.type,
    topology: record.topology,
    translationTableId: record.translationTableId,
    seq: record.sequence,
    length: record.sequence.length,
    annotations: record.features.map((feature) => ({
      id: feature.id,
      name: feature.name,
      type: feature.type,
      start: feature.start,
      end: feature.end,
      strand: feature.strand,
      direction: strandLabel(feature.strand) as ArtifactFeatureInput['direction'],
      color: feature.color,
      metadata: normalizeJsonObject(feature.metadata),
      subRanges: feature.subRanges?.map((subRange) => ({ ...subRange })),
    })),
    sites: serializeSites(record.sites),
    organism: record.organism,
    source: record.source,
    group: record.group,
    dateAdded: record.dateAdded,
    tags: record.tags ? [...record.tags] : undefined,
    overhang5: record.overhang5,
    overhang3: record.overhang3,
    overhang5Type: record.overhang5Type,
    overhang3Type: record.overhang3Type,
    active: record.active,
    default: record.default,
    provenance: record.provenance ? normalizeJsonObject(record.provenance) : undefined,
    sangerTrace: record.sangerTrace
      ? normalizeArtifactSangerTrace(record.sangerTrace, record.sequence)
      : undefined,
  };
}

export function createDefensiveRuntimeSnapshot(records: readonly ArtifactVector[]): ArtifactRecordInput[] {
  return records.map(serializeRecord);
}

function rememberLastGoodRuntimePayload(
  payload: LoadedPayload,
  artifactState: ArtifactDurableState,
): void {
  const collections = normalizeArtifactWorkspaceCollections(payload, {
    recordLengths: new Map(payload.records.map((record) => [record.id, record.sequence.length])),
  });
  const analysis = cloneArtifactAnalysisWorkspace({
    analysisResults: payload.analysisResults,
    analysisAssets: payload.analysisAssets,
  }, {
    recordLengths: new Map(payload.records.map((record) => [record.id, record.sequence.length])),
  });
  lastGoodRuntimeRecoveryPayload = {
    schema: payload.schema,
    inventory: { ...payload.inventory },
    records: createDefensiveRuntimeSnapshot(payload.records),
    selectedRecordId: payload.selectedRecordId,
    defaultMotif: payload.defaultMotif,
    alignments: payload.alignments.map(serializeArtifactAlignment),
    notes: collections.notes,
    workflowResults: collections.workflowResults,
    analysisResults: analysis.analysisResults,
    analysisAssets: analysis.analysisAssets,
    artifactState: normalizeArtifactDurableState(
      artifactState,
      new Map(payload.records.map((record) => [record.id, record.sequence.length])),
    ),
  };
}

type RecordSummary = { text: string; data: Record<string, unknown> };

function scanRestrictionSitesForRecord(
  record: ArtifactVector,
  scanEnzymes: readonly RestrictionEnzyme[],
): readonly RestrictionSite[] {
  // Nothing to scan is not the same as nothing to report: sites that arrived in
  // the payload belong to the record and are not this scan's to discard. This
  // returned `emptySites`, so a record carrying supplied sites summarised as
  // zero the moment no enzyme source was selected, while the export of the same
  // record still listed them. Same answer as recordSitesForExport now.
  if (record.type !== 'dna' || scanEnzymes.length === 0) return record.sites;
  const scanned = findRestrictionSites(record.sequence, [...scanEnzymes], { topology: record.topology });
  if (record.sites.length === 0) return scanned;
  const seen = new Set(scanned.map(restrictionSiteTickId));
  const injectedOnly = record.sites.filter((site) => !seen.has(restrictionSiteTickId(site)));
  return injectedOnly.length > 0 ? [...scanned, ...injectedOnly] : scanned;
}

// Plain-language + structured snapshot of the active record, built from the
// same pure Motif engines the UI uses. This is what the Claude Science
// coordinating agent reads (via window.motifDescribe / the "Copy summary" button)
// so it can reason about the plasmid in prose — the round-trip that makes the
// artifact feel native rather than a static viewer.
function buildRecordSummary(
  record: ArtifactVector,
  topology: Topology,
  sites: readonly RestrictionSite[],
  selection: { label: string; sequence: string } | null,
): RecordSummary {
  const molecule = record.type;
  const isDna = molecule === 'dna';
  const isNucleotide = molecule === 'dna' || molecule === 'rna';
  const length = record.sequence.length;
  const unit = isNucleotide ? (isDna ? 'bp' : 'nt') : 'aa';
  const gc = isNucleotide && length > 0 ? gcContent(record.sequence) : null;
  const tm = isNucleotide && length > 0 ? meltingTemperature(record.sequence) : null;
  const translationCode = resolveArtifactTranslationCode(record.translationTableId);

  const features = record.features ?? [];
  const featureList = features.map((feature) => {
    const featureTranslationCode = CODING_FEATURE_TYPES.has(feature.type)
      ? resolveArtifactTranslationCode(
          record.translationTableId,
          TRANSLATION_CODE_FEATURE_TYPES.has(feature.type) ? feature.metadata : undefined,
        )
      : null;
    return {
      name: feature.name,
      type: feature.type,
      start: feature.start,
      end: feature.end,
      strand: featureStrandLabel(feature),
      location: genBankLocation(feature),
      length: featureLocationLength(feature),
      locationOrder: isAmbiguousFeatureLocation(feature)
        ? 'ambiguous-unmarked'
        : isOrderedFeatureLocation(feature)
          ? 'order'
          : feature.subRanges?.length ? 'biological' : 'contiguous',
      materializable: isMaterializableFeatureLocation(feature),
      subRanges: feature.subRanges?.map((range) => ({ ...range })),
      translationTable: featureTranslationCode?.supported
        ? { id: featureTranslationCode.id, name: featureTranslationCode.name, source: featureTranslationCode.source }
        : featureTranslationCode
          ? { supported: false, message: featureTranslationCode.message }
          : null,
    };
  });

  // Per-enzyme cut counts from the current (visible) site set.
  const counts = new Map<string, number>();
  for (const site of sites) counts.set(site.enzyme, (counts.get(site.enzyme) ?? 0) + 1);
  const singleCutters = Array.from(counts.entries())
    .filter(([, count]) => count === 1)
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b));
  const enzymesThatCut = counts.size;

  const orfs = isDna && translationCode.supported
    ? findORFs(record.sequence, SUMMARY_ORF_MIN_AA, translationCode.table, { topology })
    : [];
  const longestOrf = orfs[0] ?? null; // findORFs sorts by length desc

  const selectionData = selection && selection.sequence
    ? {
        label: selection.label,
        length: selection.sequence.length,
        gcPercent: isNucleotide ? Number((gcContent(selection.sequence) * 100).toFixed(1)) : null,
        tmCelsius: isNucleotide ? nullableFixed(meltingTemperature(selection.sequence), 1) : null,
        sequence: selection.sequence.length <= 120 ? selection.sequence : `${selection.sequence.slice(0, 120)}…`,
      }
    : null;
  const ends = isDna && (record.overhang5 !== undefined || record.overhang3 !== undefined)
    ? {
        left: {
          sequence: record.overhang5 ?? null,
          type: record.overhang5Type ?? null,
          label: recordEndLabel(record.overhang5, record.overhang5Type),
        },
        right: {
          sequence: record.overhang3 ?? null,
          type: record.overhang3Type ?? null,
          label: recordEndLabel(record.overhang3, record.overhang3Type),
        },
      }
    : null;

  const data: Record<string, unknown> = {
    name: record.name,
    molecule,
    topology,
    length,
    gcPercent: gc == null ? null : Number((gc * 100).toFixed(1)),
    tmCelsius: nullableFixed(tm, 1),
    features: featureList,
    restriction: isDna ? { enzymesThatCut, singleCutters } : null,
    ends,
    translationTable: isNucleotide && translationCode.supported
      ? { id: translationCode.id, name: translationCode.name, source: translationCode.source }
      : null,
    orfs: isDna
      ? {
          count: orfs.length,
          // A machine consumer has even less chance than a reader of guessing
          // which population `count` describes, and the app publishes two.
          minAminoAcids: SUMMARY_ORF_MIN_AA,
          longest: longestOrf
            ? { start: longestOrf.start, end: longestOrf.end, aminoAcids: longestOrf.aminoAcids, strand: longestOrf.strand }
            : null,
        }
      : null,
    selection: selectionData,
  };

  const strandGlyph = (strand: string) => (strand === 'reverse' ? '−' : strand === 'forward' ? '+' : strand === 'mixed' ? '±' : '·');
  const lines: string[] = [];
  lines.push(`${record.name} — ${length.toLocaleString()} ${unit} ${topology} ${molecule.toUpperCase()}`);
  if (gc != null) lines.push(`GC ${(gc * 100).toFixed(1)}%${tm != null ? ` · Tm ${tm.toFixed(1)} °C` : ''}`);
  if (featureList.length > 0) {
    const shown = featureList
      .slice(0, 8)
      .map((feature) => `${feature.name} ${feature.type} ${feature.location} · ${feature.length} ${unit} (${strandGlyph(feature.strand)})${feature.materializable ? '' : ` [${feature.locationOrder}]`}`)
      .join('; ');
    lines.push(`Features (${featureList.length}): ${shown}${featureList.length > 8 ? '; …' : ''}`);
  } else {
    lines.push('Features: none annotated');
  }
  if (isDna) {
    if (translationCode.supported) lines.push(`Genetic code: ${artifactTranslationCodeLabel(translationCode)}`);
    if (ends) lines.push(`Ends: left ${ends.left.label}; right ${ends.right.label}`);
    const shownCutters = singleCutters.slice(0, 10).join(', ');
    lines.push(
      `Restriction: ${singleCutters.length} single cutter${singleCutters.length === 1 ? '' : 's'}` +
        `${shownCutters ? ` (${shownCutters}${singleCutters.length > 10 ? ', …' : ''})` : ''}; ` +
        `${enzymesThatCut} enzyme${enzymesThatCut === 1 ? '' : 's'} cut`,
    );
    if (longestOrf) {
      // The empty case has always named its floor; the non-empty one did not,
      // which is how this line came to report 96 while the Analysis chip
      // reported 221 for the same record with nothing to tell them apart.
      lines.push(
        `ORFs: ${orfs.length} ≥${SUMMARY_ORF_MIN_AA} aa (longest ${longestOrf.aminoAcids.toLocaleString()} aa at ` +
          `${longestOrf.start + 1}–${longestOrf.end}, ${longestOrf.strand === -1 ? '−' : '+'} strand)`,
      );
    } else {
      lines.push(`ORFs: none ≥${SUMMARY_ORF_MIN_AA} aa`);
    }
  }
  if (selectionData) {
    lines.push(
      `Selection: ${selectionData.label}` +
        `${selectionData.gcPercent != null ? ` GC ${selectionData.gcPercent}%` : ''}` +
        `${selectionData.tmCelsius != null ? ` Tm ${selectionData.tmCelsius} °C` : ''}`,
    );
  }

  return { text: lines.join('\n'), data };
}

export function describePayloadSnapshot(
  payload: LoadedPayload,
  selectedRecordId: string | null,
  restrictionSources: readonly RestrictionEnzymeSourceId[] = DEFAULT_ENZYME_SOURCES,
  customEnzymes: readonly RestrictionEnzyme[] = [],
): RecordSummary | null {
  const record = payload.records.find((item) => item.id === selectedRecordId) ?? payload.records[0];
  if (!record) return null;
  const scanEnzymes = restrictionEnzymesForSources(restrictionSources, customEnzymes);
  return buildRecordSummary(record, record.topology, scanRestrictionSitesForRecord(record, scanEnzymes), null);
}

function nullableFixed(value: number | null, digits: number): number | null {
  return value == null ? null : Number(value.toFixed(digits));
}

function toFasta(name: string, sequence: string, lineWidth = 80): string {
  const header = name.trim().replace(/\s+/g, '_') || 'sequence';
  const lines = [];
  for (let index = 0; index < sequence.length; index += lineWidth) {
    lines.push(sequence.slice(index, index + lineWidth));
  }
  return `>${header}\n${lines.join('\n')}`;
}

function genBankFeatureType(type: FeatureType): string {
  if (type === 'origin') return 'rep_origin';
  if (type === 'polyA_signal') return 'polyA_signal';
  return type;
}

function genBankLocation(feature: Feature): string {
  const originalLocation = feature.metadata.motifOriginalLocation;
  const originalSignature = feature.metadata.motifOriginalLocationSignature;
  if (!isAmbiguousFeatureLocation(feature)
    && feature.metadata.motifLocationFuzzy === true
    && typeof originalLocation === 'string'
    && typeof originalSignature === 'string'
    && /[<>]/.test(originalLocation)
    && !/[\r\n]/.test(originalLocation)
    && originalSignature === featureLocationCoordinateSignature(feature)) {
    try {
      const reparsed = parseFeatures([
        `     misc_feature    ${originalLocation}`,
        '                     /label="fuzzy location guard"',
      ].join('\n'))[0];
      if (reparsed
        && featureLocationCoordinateSignature(reparsed) === originalSignature
        && isOrderedFeatureLocation(reparsed) === isOrderedFeatureLocation(feature)) {
        return originalLocation;
      }
    } catch {
      // Metadata is user-controlled. Invalid or semantically different raw
      // locations fall back to the normalized, safe formatter below.
    }
  }
  return featureGenBankLocation(feature);
}

function genBankFeatureLines(feature: Feature, recordTranslationTableId?: number): string[] {
  const location = genBankLocation(feature);
  const firstPrefix = `     ${genBankFeatureType(feature.type).padEnd(15, ' ')} `;
  const continuationPrefix = ' '.repeat(firstPrefix.length);
  const chunkWidth = 80 - firstPrefix.length;
  const chunks: string[] = [];
  let remaining = location;
  while (remaining.length > chunkWidth) {
    const comma = remaining.lastIndexOf(',', chunkWidth - 1);
    const splitAt = comma > 0 ? comma + 1 : chunkWidth;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  if (remaining) chunks.push(remaining);
  const locationLines = chunks.map((chunk, index) => `${index === 0 ? firstPrefix : continuationPrefix}${chunk}`);
  const rawCodonStart = Number(feature.metadata.codon_start ?? feature.metadata.codonStart);
  const codonStartLine = Number.isInteger(rawCodonStart) && rawCodonStart >= 1 && rawCodonStart <= 3
    ? [`                     /codon_start=${rawCodonStart}`]
    : [];
  const hasFeatureTranslationTable = ['transl_table', 'translTable', 'translationTableId']
    .some((key) => Object.prototype.hasOwnProperty.call(feature.metadata, key));
  const rawTranslationTable = feature.metadata.transl_table
    ?? feature.metadata.translTable
    ?? feature.metadata.translationTableId;
  const parsedFeatureTranslationTable = typeof rawTranslationTable === 'string' && /^\d+$/.test(rawTranslationTable.trim())
    ? Number(rawTranslationTable.trim())
    : typeof rawTranslationTable === 'number' && Number.isInteger(rawTranslationTable)
      ? rawTranslationTable
      : null;
  const emittedTranslationTable = feature.type === 'cds' || feature.type === 'orf'
    ? hasFeatureTranslationTable
      ? parsedFeatureTranslationTable
      : recordTranslationTableId ?? null
    : null;
  const translationTableLine = emittedTranslationTable !== null && emittedTranslationTable > 0
    ? [`                     /transl_table=${emittedTranslationTable}`]
    : [];
  return [
    ...locationLines,
    `                     /label="${feature.name.replace(/"/g, "'")}"`,
    ...codonStartLine,
    ...translationTableLine,
  ];
}

function sequenceOriginLines(sequence: string): string {
  const lines = [];
  const lower = sequence.toLowerCase();
  for (let index = 0; index < lower.length; index += 60) {
    const chunk = lower.slice(index, index + 60);
    const grouped = chunk.match(/.{1,10}/g)?.join(' ') ?? chunk;
    lines.push(`${String(index + 1).padStart(9, ' ')} ${grouped}`);
  }
  return lines.join('\n');
}

function genBankDate(date = new Date()): string {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${day}-${months[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

export function toGenBankLite(record: ArtifactVector, topology: Topology): string {
  const date = genBankDate();
  const molecule = record.type === 'protein' ? 'aa' : record.type === 'rna' ? 'RNA' : 'DNA';
  const topologyLabel = topology === 'circular' ? 'circular' : 'linear';
  // The length needs its unit token. A reader only records a declared length when
  // `bp` or `aa` follows the number, and that declared length is what arms the
  // truncation checks when the file is read back in. Protein records already
  // satisfy this because their molecule token is `aa`, so spelling out the unit
  // is only needed for nucleotides.
  const lengthUnit = record.type === 'protein' ? '' : 'bp ';
  const locus = `LOCUS       ${safeSlug(record.name).slice(0, 16).padEnd(16, ' ')} ${String(record.sequence.length).padStart(11, ' ')} ${lengthUnit}${molecule.padEnd(6, ' ')} ${topologyLabel.padEnd(8, ' ')} UNK ${date}`;
  const features = record.features
    .flatMap((feature) => genBankFeatureLines(feature, record.translationTableId))
    .join('\n');

  return [
    locus,
    `DEFINITION  ${record.description || record.name}.`,
    `ACCESSION   ${record.id}`,
    `SOURCE      ${record.source || 'Motif for Claude Science'}`,
    'FEATURES             Location/Qualifiers',
    features || '     source          1..1',
    'ORIGIN',
    sequenceOriginLines(record.sequence),
    '//',
  ].join('\n');
}

function gffEscape(value: string): string {
  return encodeURIComponent(value);
}

export function toGff3Lite(record: ArtifactVector): string {
  const seqId = safeSlug(record.name);
  const rows = [
    '##gff-version 3',
    `##sequence-region ${seqId} 1 ${record.sequence.length}`,
    ...record.features.flatMap((feature) => {
      const segments = featureLocationSegments(feature);
      const orderedLocation = isOrderedFeatureLocation(feature);
      const ambiguousLocation = isAmbiguousFeatureLocation(feature);
      const materializableLocation = isMaterializableFeatureLocation(feature);
      const featureTranslationTableValue = artifactFeatureTranslationTableValue(feature.metadata);
      const gffTranslationTable = feature.type === 'cds' || feature.type === 'orf'
        ? featureTranslationTableValue
          ? featureTranslationTableValue === '__invalid__' ? '' : featureTranslationTableValue
          : record.translationTableId === undefined ? '' : String(record.translationTableId)
        : '';
      const translationTableAttribute = gffTranslationTable
        ? `;transl_table=${gffEscape(gffTranslationTable)}`
        : '';
      let nextCdsPhase = codonStartFrame(feature.metadata);
      return segments.map((segment, segmentIndex) => {
        const cdsPhase = feature.type === 'cds' && materializableLocation ? nextCdsPhase : null;
        if (cdsPhase !== null) {
          const segmentLength = segment.end - segment.start;
          if (segmentLength <= cdsPhase) nextCdsPhase = (cdsPhase - segmentLength) as 0 | 1 | 2;
          else {
            const remainder = (segmentLength - cdsPhase) % 3;
            nextCdsPhase = ((3 - remainder) % 3) as 0 | 1 | 2;
          }
        }
        const multipartAttributes = segments.length > 1
          ? `;motif_location_operator=${ambiguousLocation ? 'ambiguous' : orderedLocation ? 'order' : 'join'};motif_part=${segmentIndex + 1}/${segments.length}`
          : '';
        return [
          seqId,
          'Motif',
          feature.type,
          String(segment.start + 1),
          String(segment.end),
          '.',
          segment.strand === -1 ? '-' : segment.strand === 1 ? '+' : '.',
          cdsPhase === null ? '.' : String(cdsPhase),
          `ID=${gffEscape(feature.id)};Name=${gffEscape(feature.name)}${translationTableAttribute}${multipartAttributes}`,
        ].join('\t');
      });
    }),
    '##FASTA',
    toFasta(seqId, record.sequence),
  ];
  return rows.join('\n');
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : Array.isArray(value) ? value.join('; ') : String(value);
  const guarded = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

function inventoryToCsv(records: readonly ArtifactVector[]): string {
  const rows = [
    ['id', 'name', 'group', 'type', 'topology', 'translation_table_id', 'length', 'overhang5', 'overhang5_type', 'overhang3', 'overhang3_type', 'feature_count', 'site_count', 'source', 'organism', 'tags'].join(','),
    ...records.map((record) => [
      record.id,
      record.name,
      record.group ?? '',
      record.type,
      record.topology,
      isNucleotideType(record.type) ? record.translationTableId ?? 1 : '',
      record.sequence.length,
      record.overhang5 ?? '',
      record.overhang5Type ?? '',
      record.overhang3 ?? '',
      record.overhang3Type ?? '',
      record.features.length,
      record.sites.length,
      record.source ?? '',
      record.organism ?? '',
      record.tags ?? [],
    ].map(csvCell).join(',')),
  ];
  return rows.join('\n');
}

export function featuresToCsv(records: readonly ArtifactVector[]): string {
  const rows = [
    ['record_id', 'record_name', 'record_group', 'record_translation_table_id', 'feature_id', 'feature_name', 'type', 'feature_translation_table', 'effective_translation_table_id', 'start_1based', 'end_1based', 'strand', 'length', 'location', 'segment_count'].join(','),
    ...records.flatMap((record) => record.features.map((feature) => {
      const hasTranslationSemantics = isNucleotideType(record.type) && CODING_FEATURE_TYPES.has(feature.type);
      const supportsFeatureCode = hasTranslationSemantics && TRANSLATION_CODE_FEATURE_TYPES.has(feature.type);
      const featureCodeValue = supportsFeatureCode
        ? artifactFeatureTranslationTableValue(feature.metadata)
        : '';
      const effectiveCode = hasTranslationSemantics
        ? resolveArtifactTranslationCode(record.translationTableId, supportsFeatureCode ? feature.metadata : undefined)
        : null;
      return [
        record.id,
        record.name,
        record.group ?? '',
        isNucleotideType(record.type) ? record.translationTableId ?? 1 : '',
        feature.id,
        feature.name,
        feature.type,
        featureCodeValue === '__invalid__' ? 'invalid' : featureCodeValue,
        effectiveCode?.supported ? effectiveCode.id : '',
        feature.start + 1,
        feature.end,
        featureStrandLabel(feature),
        featureLocationLength(feature),
        genBankLocation(feature),
        featureLocationSegments(feature).length,
      ].map(csvCell).join(',');
    })),
  ];
  return rows.join('\n');
}

function sitesToCsv(records: readonly ArtifactVector[]): string {
  const rows = [
    ['record_id', 'record_name', 'record_group', 'enzyme', 'recognition', 'position_1based', 'cut_1based', 'strand', 'overhang'].join(','),
    ...records.flatMap((record) => record.sites.map((site) => [
      record.id,
      record.name,
      record.group ?? '',
      site.enzyme,
      site.recognitionSequence,
      site.position + 1,
      site.cutPosition + 1,
      site.strand === -1 ? '-' : '+',
      site.overhang,
    ].map(csvCell).join(','))),
  ];
  return rows.join('\n');
}

function recordSitesForExport(record: ArtifactVector, scanEnzymes: readonly RestrictionEnzyme[]): RestrictionSite[] {
  if (!isNucleotideType(record.type)) return record.sites;
  if (scanEnzymes.length === 0) return record.sites;
  const scanSequence = record.type === 'rna' ? record.sequence.replace(/U/gi, 'T') : record.sequence;
  const scanned = findRestrictionSites(scanSequence, [...scanEnzymes], { topology: record.topology });
  if (record.sites.length === 0) return scanned;
  const seen = new Set(scanned.map(restrictionSiteTickId));
  const injectedOnly = record.sites.filter((site) => !seen.has(restrictionSiteTickId(site)));
  return injectedOnly.length > 0 ? [...scanned, ...injectedOnly] : scanned;
}

function toMultiFasta(records: readonly ArtifactVector[]): string {
  return records.map((record) => toFasta(record.name, record.sequence)).join('\n\n');
}

function toMultiGenBank(records: readonly ArtifactVector[]): string {
  return records.map((record) => toGenBankLite(record, record.topology)).join('\n');
}

function uniqueArchiveName(name: string, usedNames: Set<string>): string {
  const safeName = name.replace(/^\/+/, '').replace(/\.\./g, '_') || 'record';
  if (!usedNames.has(safeName)) {
    usedNames.add(safeName);
    return safeName;
  }

  const dot = safeName.lastIndexOf('.');
  const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
  const ext = dot > 0 ? safeName.slice(dot) : '';
  for (let index = 2; index < 10000; index += 1) {
    const candidate = `${stem}-${index}${ext}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
  }
  const fallback = `${stem}-${Date.now()}${ext}`;
  usedNames.add(fallback);
  return fallback;
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inventoryReportMarkdown(records: readonly ArtifactVector[]): string {
  const lines = [
    '# Motif Sequence Inventory',
    '',
    `Records: ${records.length}`,
    '',
    '| Record | Group | Type | Length | Features | Source |',
    '| --- | --- | --- | ---: | ---: | --- |',
    ...records.map((record) => (
      `| ${record.name.replace(/\|/g, '/')} | ${(record.group ?? '').replace(/\|/g, '/')} | ${record.type} | ${record.sequence.length} | ${record.features.length} | ${(record.source ?? '').replace(/\|/g, '/')} |`
    )),
    '',
  ];
  for (const record of records) {
    lines.push(`## ${record.name}`, '');
    lines.push(`${record.description ?? 'No description.'}`, '');
    if (record.group) lines.push(`- Group: ${record.group}`);
    lines.push(`- Type: ${record.type}`);
    lines.push(`- Topology: ${record.topology}`);
    lines.push(`- Length: ${sequenceLengthLabel(record.sequence.length, record.type)}`);
    if (record.features.length > 0) {
      lines.push(`- Features: ${record.features.map((feature) => `${feature.name} (${featureRangeLabel(feature)}; ${featureLocationLength(feature)} ${sequenceUnitLabel(record.type)})`).join('; ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function inventoryReportHtml(records: readonly ArtifactVector[]): string {
  const rows = records.map((record) => `
      <tr>
        <td>${htmlEscape(record.name)}</td>
        <td>${htmlEscape(record.group ?? '')}</td>
        <td>${htmlEscape(record.type)}</td>
        <td>${record.sequence.length.toLocaleString()}</td>
        <td>${record.features.length.toLocaleString()}</td>
        <td>${htmlEscape(record.source ?? '')}</td>
      </tr>`).join('');
  const details = records.map((record) => `
    <section>
      <h2>${htmlEscape(record.name)}</h2>
      <p>${htmlEscape(record.description ?? 'No description.')}</p>
      <dl>
        ${record.group ? `<dt>Group</dt><dd>${htmlEscape(record.group)}</dd>` : ''}
        <dt>Type</dt><dd>${htmlEscape(record.type)}</dd>
        <dt>Topology</dt><dd>${htmlEscape(record.topology)}</dd>
        <dt>Length</dt><dd>${htmlEscape(sequenceLengthLabel(record.sequence.length, record.type))}</dd>
      </dl>
      ${record.features.length > 0 ? `<h3>Features</h3><ul>${record.features.map((feature) => `<li>${htmlEscape(feature.name)} · ${htmlEscape(feature.type)} · ${htmlEscape(featureRangeLabel(feature))} · ${featureLocationLength(feature).toLocaleString()} ${htmlEscape(sequenceUnitLabel(record.type))}</li>`).join('')}</ul>` : ''}
    </section>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Motif Sequence Inventory</title>
  <style>
    body { font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; margin: 32px; }
    h1, h2, h3 { line-height: 1.2; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0 28px; }
    th, td { border-bottom: 1px solid #d1d5db; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; }
    dt { font-weight: 700; }
    section { break-inside: avoid; margin: 0 0 24px; }
    @media print { body { margin: 18mm; } }
  </style>
</head>
<body>
  <h1>Motif Sequence Inventory</h1>
  <p>${records.length} record${records.length === 1 ? '' : 's'} exported from Motif.</p>
  <table>
    <thead><tr><th>Record</th><th>Group</th><th>Type</th><th>Length</th><th>Features</th><th>Source</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${details}
</body>
</html>`;
}

type ZipTextFile = { name: string; content: string };
let zipCrcTable: Uint32Array | null = null;

function zipCrc32(bytes: Uint8Array): number {
  if (!zipCrcTable) {
    zipCrcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      zipCrcTable[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = zipCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDosDateTime(date = new Date()): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const packedDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: packedDate };
}

function createZipBlob(files: readonly ZipTextFile[]): Blob {
  const encoder = new TextEncoder();
  const localParts: BlobPart[] = [];
  const centralParts: BlobPart[] = [];
  const { time, date } = zipDosDateTime();
  let offset = 0;

  for (const file of files) {
    const name = file.name.replace(/^\/+/, '').replace(/\.\./g, '_');
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(file.content);
    const crc = zipCrc32(data);

    const local = new Uint8Array(30);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localParts.push(local, nameBytes, data);

    const central = new Uint8Array(46);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((size, part) => size + (part instanceof Uint8Array ? part.byteLength : 0), 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);

  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}

function recordInputFromGenBank(record: ReturnType<typeof parseGenBank>[number], index: number): ArtifactRecordInput {
  const type = normalizeSequenceType(record.moleculeType?.toLowerCase().includes('rna') ? 'rna' : undefined, record.sequence);
  return {
    id: record.accession || record.version || record.name || `genbank-${index + 1}`,
    name: record.name || record.accession || `GenBank record ${index + 1}`,
    description: record.definition,
    molecule: type,
    topology: record.topology,
    seq: record.sequence,
    annotations: record.features,
    organism: record.organism,
    source: record.source || 'GenBank paste',
    dateAdded: new Date().toISOString(),
    active: true,
  };
}

function actionableImportError(error: unknown): string {
  if (error instanceof MotifArtifactRuntimeError) return error.message;
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'The sequence could not be imported. Check that the file is a complete FASTA, GenBank, AB1/ABI, Database JSON, or valid raw sequence.';
}

export function parseImportedRecords(
  input: string,
  preferredName: string,
  typeHint: SequenceType | 'auto',
  topologyHint: Topology,
): ArtifactRecordInput[] {
  const text = input.trim();
  if (!text) return [];

  const recordJson = parseArtifactRecordJson(text);
  if (recordJson) return [recordJson as ArtifactRecordInput];

  if (/^\s*LOCUS\s/m.test(text)) {
    let records: ReturnType<typeof parseGenBank>;
    try {
      records = parseGenBank(text);
    } catch (cause) {
      throw new MotifArtifactRuntimeError(
        'MOTIF_INVALID_GENBANK_IMPORT',
        'This GenBank record could not be parsed. Export or paste a complete GenBank record and try again.',
        { cause: cause instanceof Error ? cause.message : String(cause) },
      );
    }

    const truncated = records
      .map((record, index) => {
        const lengthMismatch = record.length > 0 && record.sequence.length !== record.length;
        return {
          index,
          record,
          incomplete: Boolean(record.truncated) || lengthMismatch,
          reason: record.truncated?.reason || (lengthMismatch
            ? `LOCUS declared ${record.length} residues but ${record.sequence.length} were parsed from ORIGIN.`
            : undefined),
        };
      })
      .filter((entry) => entry.incomplete);
    if (truncated.length > 0) {
      throw new MotifArtifactRuntimeError(
        'MOTIF_TRUNCATED_GENBANK_IMPORT',
        'This GenBank import is incomplete. Paste or export the complete record through the end of the ORIGIN sequence, then retry.',
        {
          records: truncated.map(({ index, record, reason }) => ({
            index,
            name: record.name,
            reason: reason || 'The parser detected a truncated ORIGIN sequence.',
          })),
        },
      );
    }
    if (records.length === 0) {
      throw new MotifArtifactRuntimeError(
        'MOTIF_INVALID_GENBANK_IMPORT',
        'No complete GenBank record was found. Include LOCUS, ORIGIN sequence rows, and the full record content, then retry.',
      );
    }
    return records.map(recordInputFromGenBank);
  }

  const embeddedFasta = extractEmbeddedFastaContent(text);
  const fastaInput = embeddedFasta ?? (text.includes('>') ? text : null);
  if (fastaInput) {
    const records = parseFasta(fastaInput);
    if (records.length > 0) {
      return records.map((record, index) => {
        const seq = normalizeSequence(record.sequence, typeHint === 'auto' ? undefined : typeHint);
        const molecule = typeHint === 'auto' ? normalizeSequenceType(undefined, seq) : typeHint;
        const name = records.length === 1 && preferredName.trim()
          ? preferredName.trim()
          : record.rawHeader || record.header || `FASTA record ${index + 1}`;
        return {
          id: safeSlug(name),
          name,
          description: record.description,
          molecule,
          topology: normalizeTopology(topologyHint, molecule),
          seq,
          source: 'FASTA paste',
          dateAdded: new Date().toISOString(),
          active: true,
          ...(record.gapsRemoved ? { provenance: { gapsRemoved: record.gapsRemoved } } : {}),
        };
      }).filter((record) => Boolean(record.seq));
    }
  }

  const seq = normalizeSequence(text, typeHint === 'auto' ? undefined : typeHint);
  if (!seq) return [];
  const molecule = typeHint === 'auto' ? normalizeSequenceType(undefined, seq) : typeHint;
  const name = preferredName.trim() || 'Pasted sequence';
  return [{
    id: safeSlug(name),
    name,
    molecule,
    topology: normalizeTopology(topologyHint, molecule),
    seq,
    source: 'Raw sequence paste',
    dateAdded: new Date().toISOString(),
    active: true,
  }];
}

function applyImportDefaults(records: readonly ArtifactRecordInput[], defaults: ImportDefaults): ArtifactRecordInput[] {
  const groupLabel = normalizeInventoryGroupLabel(defaults.group);
  const nameOverride = defaults.name.trim();
  return records.map((record, index) => ({
    ...record,
    ...(groupLabel ? { group: groupLabel } : {}),
    ...(nameOverride && records.length === 1 ? { id: safeSlug(nameOverride), name: nameOverride } : {}),
    ...(nameOverride && records.length > 1 ? { name: `${nameOverride} ${index + 1}` } : {}),
  }));
}

function sequenceForFeature(sequence: string, feature: Feature | null, sequenceType?: SequenceType): string {
  if (!feature) return sequence;
  return extractFeatureSequence(sequence, feature, sequenceType);
}

function restrictionSiteTickId(site: Pick<RestrictionSite, 'enzyme' | 'position' | 'cutPosition' | 'strand' | 'recognitionSequence'>): string {
  const strand = site.strand === -1 ? -1 : 1;
  return `${site.enzyme}@${site.position}:${site.cutPosition}:${strand}:${site.recognitionSequence}`;
}

function restrictionSiteLayoutTickId(site: Pick<RestrictionSite, 'enzyme' | 'position'>): string {
  return `${site.enzyme}@${site.position}`;
}

function restrictionSelectionHasSite(selectedTickIds: ReadonlySet<string>, site: RestrictionSite): boolean {
  return selectedTickIds.has(restrictionSiteTickId(site)) || selectedTickIds.has(restrictionSiteLayoutTickId(site));
}

function restrictionEnzymeIsTypeIIS(enzyme: RestrictionEnzyme | undefined): boolean {
  if (!enzyme) return false;
  const recognitionLength = enzyme.recognitionSequence.length;
  return Math.min(enzyme.cutOffset, enzyme.complementCutOffset) < 0
    || Math.max(enzyme.cutOffset, enzyme.complementCutOffset) > recognitionLength;
}

export function createCenteredBluntEnzyme(name: string, recognitionSequence: string): RestrictionEnzyme {
  const cutOffset = Math.floor(recognitionSequence.length / 2);
  return {
    name,
    recognitionSequence,
    cutOffset,
    complementCutOffset: cutOffset,
    overhang: 'blunt',
  };
}

function mapRangeLength(range: MapSelectionRange | null, sequenceLength: number): number {
  if (!range || sequenceLength <= 0) return 0;
  return clamp(range.end - range.start, 0, sequenceLength);
}

function mapRangeLabel(range: MapSelectionRange, sequenceLength: number): string {
  const length = mapRangeLength(range, sequenceLength);
  const wraps = range.end > sequenceLength;
  const end = wraps ? ((range.end - 1) % sequenceLength) + 1 : range.end;
  return `${range.start + 1}-${end}${wraps ? ' wrap' : ''} (${length.toLocaleString()})`;
}

function artifactSelectionOverlayPaths(layout: MapLayout, ranges: readonly MapSelectionRange[]): string[] {
  if (layout.mode !== 'circular') return selectionOverlayPaths(layout, ranges);
  const result: string[] = [];
  const radius = Math.max(1, layout.radius + 7);
  const radialBoundary = (bp: number) => {
    const angle = bpToAngle(bp, layout.length);
    const halfWidthDegrees = clamp((0.8 / radius) * (180 / Math.PI), 0.08, 0.28);
    const edgeA = pointOnCircle(layout.center.x, layout.center.y, radius, angle - halfWidthDegrees);
    const edgeB = pointOnCircle(layout.center.x, layout.center.y, radius, angle + halfWidthDegrees);
    return [
      `M ${layout.center.x.toFixed(2)} ${layout.center.y.toFixed(2)}`,
      `L ${edgeA.x.toFixed(2)} ${edgeA.y.toFixed(2)}`,
      `L ${edgeB.x.toFixed(2)} ${edgeB.y.toFixed(2)}`,
      'Z',
    ].join(' ');
  };
  const emptyLine = `M ${layout.center.x.toFixed(2)} ${layout.center.y.toFixed(2)}`;

  for (const range of ranges) {
    const spans = normalizeSpan(range.start, range.end, layout.length, layout.topology);
    const fills = selectionOverlayPaths(layout, [range]);
    fills.forEach((fill, index) => {
      const span = spans[index];
      if (!span) return;
      result.push(
        fill,
        index === 0 ? radialBoundary(span.start) : emptyLine,
        index === spans.length - 1 ? radialBoundary(span.end) : emptyLine,
      );
    });
  }
  return result;
}

function sequenceForRange(sequence: string, range: MapSelectionRange | null, topology: Topology): string {
  if (!range) return sequence;
  const spans = normalizeSpan(range.start, range.end, sequence.length, topology);
  if (spans.length === 0) return '';
  return spans.map((span) => sequence.slice(span.start, span.end)).join('');
}

function coordinateAtRangeOffset(spans: readonly MapSpan[], offset: number): number {
  let remaining = offset;
  for (const span of spans) {
    const spanLength = span.end - span.start;
    if (remaining < spanLength) return span.start + remaining;
    remaining -= spanLength;
  }
  const last = spans[spans.length - 1];
  return last ? Math.max(last.start, last.end - 1) : 0;
}

function codonRangeFromRangeOffset(spans: readonly MapSpan[], offset: number, sequenceLength: number): { start: number; end: number } {
  const coords = [
    coordinateAtRangeOffset(spans, offset),
    coordinateAtRangeOffset(spans, offset + 1),
    coordinateAtRangeOffset(spans, offset + 2),
  ];
  let end = coords[0] + 1;
  for (let i = 1; i < coords.length; i += 1) {
    if (coords[i] === end % sequenceLength) {
      end += 1;
    } else {
      end = Math.max(...coords) + 1;
      break;
    }
  }
  return { start: coords[0], end };
}

function pointToSequenceAngle(point: MapContentPoint, layout: MapLayout): number {
  const dx = point.x - layout.center.x;
  const dy = point.y - layout.center.y;
  return (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
}

function pointToSequenceOffset(point: MapContentPoint, layout: MapLayout): number {
  if (layout.length <= 0) return 0;
  if (layout.mode === 'linear' && layout.linearAxis) {
    const raw = ((point.x - layout.linearAxis.startX) / Math.max(1, layout.linearAxis.width)) * layout.length;
    return clamp(Math.round(raw), 0, layout.length);
  }

  const angle = pointToSequenceAngle(point, layout);
  return clamp(Math.round((angle / 360) * layout.length), 0, Math.max(0, layout.length - 1));
}

function mapPointerActionAtPoint(point: MapContentPoint, layout: MapLayout, zoom: number): MapPointerAction {
  // The pointer is converted into map-content coordinates before it reaches
  // this function. Divide the intended screen-space hit widths by the current
  // zoom so the range band does not expand over the canvas as the map grows.
  const contentScale = Math.max(MIN_ZOOM, Number.isFinite(zoom) ? zoom : MIN_ZOOM);
  if (layout.mode === 'circular') {
    const distance = Math.hypot(point.x - layout.center.x, point.y - layout.center.y);
    const tolerance = clamp(layout.radius * 0.14, MAP_CIRCULAR_RANGE_HIT_MIN, MAP_CIRCULAR_RANGE_HIT_MAX) / contentScale;
    return Math.abs(distance - layout.radius) <= tolerance ? 'range' : 'pan';
  }

  const axis = layout.linearAxis;
  if (!axis) return 'pan';
  const hitX = MAP_LINEAR_RANGE_HIT_X / contentScale;
  const hitY = MAP_LINEAR_RANGE_HIT_Y / contentScale;
  const alongAxis = point.x >= axis.startX - hitX
    && point.x <= axis.endX + hitX;
  return alongAxis && Math.abs(point.y - axis.y) <= hitY ? 'range' : 'pan';
}

function signedCircularAngleDelta(fromAngle: number, toAngle: number): number {
  return ((toAngle - fromAngle + 540) % 360) - 180;
}

function positiveModulo(value: number, length: number): number {
  return ((value % length) + length) % length;
}

function rangeFromCircularAngleDrag(startBp: number, cumulativeAngle: number, sequenceLength: number): MapSelectionRange {
  if (sequenceLength <= 0) return { start: 0, end: 0 };
  const spanLength = clamp(Math.round((Math.abs(cumulativeAngle) / 360) * sequenceLength), 1, sequenceLength);
  if (spanLength >= sequenceLength) return { start: 0, end: sequenceLength };
  const start = clamp(startBp, 0, Math.max(0, sequenceLength - 1));
  if (cumulativeAngle >= 0) return { start, end: start + spanLength };
  const reverseStart = positiveModulo(start - spanLength, sequenceLength);
  const reverseEnd = start <= reverseStart ? start + sequenceLength : start;
  return { start: reverseStart, end: reverseEnd };
}

function rangeFromMapDrag(startBp: number, endBp: number, sequenceLength: number, topology: Topology): MapSelectionRange {
  if (sequenceLength <= 0) return { start: 0, end: 0 };
  if (topology === 'linear') {
    const start = clamp(Math.min(startBp, endBp), 0, Math.max(0, sequenceLength - 1));
    const end = clamp(Math.max(startBp, endBp), start + 1, sequenceLength);
    return { start, end };
  }

  const start = clamp(startBp, 0, Math.max(0, sequenceLength - 1));
  let end = clamp(endBp, 0, Math.max(0, sequenceLength - 1));
  if (end <= start) end += sequenceLength;
  if (end - start < 1) end = start + 1;
  if (end - start > sequenceLength) end = start + sequenceLength;
  return { start, end };
}

async function writeTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the textarea copy path for artifact sandboxes.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

export function readInitialArtifactSourceFromDom(): InitialArtifactSource {
  const scriptElement = document.getElementById('motif-artifact-data');
  if (scriptElement) {
    const scriptPayload = scriptElement.textContent?.trim() ?? '';
    const isBuildPlaceholder = DATA_PLACEHOLDERS.includes(scriptPayload);
    if (!scriptPayload && !isBuildPlaceholder) {
      throw new MotifArtifactRuntimeError(
        'MOTIF_INVALID_PRELOAD',
        'Preloaded workspace could not be opened: the embedded payload is blank. No bundled sample data was substituted.',
        { operation: 'initialHydration', origin: 'script', mutated: false },
      );
    }
    if (!isBuildPlaceholder && (scriptPayload.length > MOTIF_MAX_PAYLOAD_JSON_BYTES
      || utf8Encoder.encode(scriptPayload).byteLength > MOTIF_MAX_PAYLOAD_JSON_BYTES)) {
      throw new MotifArtifactRuntimeError(
        'MOTIF_INVALID_PRELOAD',
        'Preloaded workspace could not be opened: the embedded payload exceeds the 32 MiB input limit. No bundled sample data was substituted.',
        { operation: 'initialHydration', origin: 'script', mutated: false },
      );
    }
    if (!isBuildPlaceholder) {
      try {
        return { kind: 'payload', value: JSON.parse(scriptPayload), origin: 'script' };
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new MotifArtifactRuntimeError(
          'MOTIF_INVALID_PRELOAD',
          `Preloaded workspace could not be opened: embedded JSON is malformed (${detail}). No bundled sample data was substituted.`,
          { operation: 'initialHydration', origin: 'script', mutated: false },
        );
      }
    }
  }
  if (window.MOTIF_ARTIFACT_DATA !== undefined) {
    return { kind: 'payload', value: window.MOTIF_ARTIFACT_DATA, origin: 'window' };
  }
  return { kind: 'sample' };
}

function coercePayload(raw: unknown): ArtifactPayload {
  if (Array.isArray(raw)) return { records: raw as ArtifactRecordInput[] };
  if (!isObject(raw)) return {};

  const payload = raw as ArtifactPayload;
  if (['records', 'entries', 'vectors', 'record'].some((field) => (
    Object.prototype.hasOwnProperty.call(payload, field)
  ))) {
    return payload;
  }

  const maybeRecord = raw as ArtifactRecordInput;
  if (typeof maybeRecord.seq === 'string' || typeof maybeRecord.sequence === 'string') {
    return { ...payload, records: [maybeRecord] };
  }

  return payload;
}

function payloadRecords(payload: ArtifactPayload): ArtifactRecordInput[] {
  if (Array.isArray(payload.records)) return payload.records;
  if (Array.isArray(payload.entries)) return payload.entries;
  if (Array.isArray(payload.vectors)) return payload.vectors;
  if (payload.record) return [payload.record];
  return [];
}

function payloadHasExplicitRecords(rawPayload: unknown, payload: ArtifactPayload): boolean {
  return Array.isArray(rawPayload)
    || (isObject(rawPayload) && ['records', 'entries', 'vectors', 'record'].some((field) => (
      Object.prototype.hasOwnProperty.call(rawPayload, field)
    )))
    || Array.isArray(payload.records)
    || Array.isArray(payload.entries)
    || Array.isArray(payload.vectors)
    || Boolean(payload.record);
}

function resolveSelectedRecordId(
  records: readonly ArtifactVector[],
  payload: ArtifactPayload,
  fallbackRecordId?: string,
): string {
  if (payload.selectedRecordId) {
    const selected = records.find((record) => record.id === payload.selectedRecordId);
    if (selected) return selected.id;
  }

  if (payload.selectedName) {
    const selected = records.find((record) => record.name === payload.selectedName);
    if (selected) return selected.id;
  }

  if (Number.isInteger(payload.selectedIndex) && payload.selectedIndex !== undefined) {
    const selected = records[payload.selectedIndex];
    if (selected) return selected.id;
  }

  const explicitDefault = records.find((record) => record.default);
  if (explicitDefault) return explicitDefault.id;

  if (fallbackRecordId && records.some((record) => record.id === fallbackRecordId)) return fallbackRecordId;

  return records[0]?.id ?? 'record-1';
}

function loadArtifactPayload(rawPayload: unknown = null, fallbackSelectedRecordId?: string): LoadedPayload {
  const fallbackRecords = normalizeRecords(builtInRecords).filter((record) => record.active);
  const fallbackPayload: LoadedPayload = {
    schema: DEFAULT_SCHEMA,
    inventory: {
      id: 'motif-built-in-vectors',
      title: 'Motif for Claude Science',
      description: 'Built-in Motif vector set. Inject a JSON payload to render a Claude Science inventory.',
    },
    records: fallbackRecords,
    selectedRecordId: resolveSelectedRecordId(fallbackRecords, {}, fallbackSelectedRecordId),
    defaultMotif: 'GAATTC',
    alignments: [],
    notes: [],
    workflowResults: [],
    analysisResults: [],
    analysisAssets: [],
  };

  if (!rawPayload) return fallbackPayload;

  const payload = coercePayload(rawPayload);
  const rawRecords = payloadRecords(payload) as unknown[];
  if (rawRecords.length > 0) validateRuntimeRecordInputs(rawRecords, 'motifRenderInventory', true);
  validateRuntimePayloadEnvelope(rawPayload);
  const records = normalizeRecords(rawRecords as ArtifactRecordInput[]).filter((record) => record.active);
  const hasExplicitRecords = payloadHasExplicitRecords(rawPayload, payload);
  const usableRecords = hasExplicitRecords ? records : records.length > 0 ? records : fallbackRecords;
  const inventory = isPlainObject(payload.inventory) ? payload.inventory : undefined;
  const alignments = normalizeArtifactAlignments(payload.alignments ?? payload.alignment);
  const workspaceCollections = normalizeArtifactWorkspaceCollections(payload, {
    recordLengths: new Map(usableRecords.map((record) => [record.id, record.sequence.length])),
  });
  const analysisWorkspace = normalizeArtifactAnalysisWorkspace({
    analysisResults: payload.analysisResults,
    analysisAssets: payload.analysisAssets,
  }, {
    recordLengths: new Map(usableRecords.map((record) => [record.id, record.sequence.length])),
  });

  return {
    schema: normalizeOptionalText(payload.schema) === MOTIF_INVENTORY_SCHEMA_V1
      ? DEFAULT_SCHEMA
      : normalizeOptionalText(payload.schema) ?? DEFAULT_SCHEMA,
    inventory: {
      id: normalizeOptionalText(inventory?.id) ?? (hasExplicitRecords ? 'motif-sequence-inventory' : fallbackPayload.inventory.id),
      title: normalizeOptionalText(inventory?.title) ?? (hasExplicitRecords ? 'Motif sequence inventory' : fallbackPayload.inventory.title),
      description: normalizeOptionalText(inventory?.description) ?? (
        hasExplicitRecords
          ? `${usableRecords.length.toLocaleString()} active sequence record${usableRecords.length === 1 ? '' : 's'} injected from Claude Science.`
          : fallbackPayload.inventory.description
      ),
      updatedAt: normalizeOptionalText(inventory?.updatedAt),
    },
    records: usableRecords,
    selectedRecordId: resolveSelectedRecordId(usableRecords, payload, fallbackSelectedRecordId ?? fallbackPayload.selectedRecordId),
    defaultMotif: normalizeOptionalText(payload.defaultMotif) ?? normalizeOptionalText(payload.motif) ?? fallbackPayload.defaultMotif,
    alignments,
    notes: workspaceCollections.notes,
    workflowResults: workspaceCollections.workflowResults,
    analysisResults: analysisWorkspace.analysisResults,
    analysisAssets: analysisWorkspace.analysisAssets,
  };
}

export function prepareInitialArtifactWorkspace(
  rawWorkspace: unknown,
  origin: 'script' | 'window' = 'script',
): PreparedArtifactWorkspace {
  try {
    return prepareArtifactDatabaseRestore(rawWorkspace);
  } catch (cause) {
    if (cause instanceof MotifArtifactRuntimeError && cause.code === 'MOTIF_INVALID_PRELOAD') throw cause;
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new MotifArtifactRuntimeError(
      'MOTIF_INVALID_PRELOAD',
      `Preloaded workspace could not be opened: ${detail} No bundled sample data was substituted.`,
      { operation: 'initialHydration', origin, mutated: false },
    );
  }
}

export function loadInitialArtifactWorkspace(): PreparedArtifactWorkspace {
  const source = readInitialArtifactSourceFromDom();
  if (source.kind === 'sample') {
    const payload = loadArtifactPayload(null);
    const artifactState = normalizeArtifactDurableState(
      undefined,
      new Map(payload.records.map((record) => [record.id, record.sequence.length])),
    );
    rememberLastGoodRuntimePayload(
      payload,
      artifactState,
    );
    return { payload, artifactState };
  }

  const prepared = prepareInitialArtifactWorkspace(source.value, source.origin);
  rememberLastGoodRuntimePayload(prepared.payload, prepared.artifactState);
  return prepared;
}

type RuntimeRecordIssue = {
  index: number;
  code: 'invalid_record' | 'truncated_genbank' | 'malformed_field' | 'record_too_large' | 'resource_limit';
  message: string;
  path?: string;
};

function omitTraceArraysForGenericJsonValidation(value: unknown): unknown {
  const stripRecord = (record: unknown): unknown => {
    if (!isPlainObject(record) || record.sangerTrace === undefined) return record;
    return {
      ...record,
      sangerTrace: isPlainObject(record.sangerTrace)
        ? { schema: record.sangerTrace.schema, version: record.sangerTrace.version }
        : record.sangerTrace,
    };
  };
  if (Array.isArray(value)) return value.map(stripRecord);
  if (!isPlainObject(value)) return value;
  const projected = { ...value };
  const hasRecordContainer = ['records', 'entries', 'vectors', 'record'].some((field) => (
    Object.prototype.hasOwnProperty.call(projected, field)
  ));
  if (!hasRecordContainer
    && (typeof projected.seq === 'string' || typeof projected.sequence === 'string')) {
    return stripRecord(projected);
  }
  for (const field of ['records', 'entries', 'vectors'] as const) {
    if (Array.isArray(projected[field])) projected[field] = projected[field].map(stripRecord);
  }
  if (projected.record !== undefined) projected.record = stripRecord(projected.record);
  return projected;
}

function collectMalformedRecordIssues(
  record: Record<string, unknown>,
  index: number,
  sequenceLength: number,
  validateTrace = true,
): RuntimeRecordIssue[] {
  const issues: RuntimeRecordIssue[] = [];
  const add = (
    path: string,
    message: string,
    code: RuntimeRecordIssue['code'] = 'malformed_field',
  ) => issues.push({ index, code, path, message });
  const basePath = `records[${index}]`;

  for (const field of ['id', 'name', 'description', 'organism', 'source', 'group', 'project', 'folder', 'collection', 'dateAdded']) {
    if (record[field] !== undefined && typeof record[field] !== 'string') {
      add(`${basePath}.${field}`, `${field} must be a string when provided`);
    } else if (typeof record[field] === 'string') {
      const limit = field === 'description' ? MOTIF_MAX_DESCRIPTION_LENGTH : MOTIF_MAX_SHORT_TEXT_LENGTH;
      if (record[field].length > limit) {
        add(
          `${basePath}.${field}`,
          `${field} cannot exceed ${limit.toLocaleString()} characters`,
          'resource_limit',
        );
      }
    }
  }
  for (const field of ['active', 'default']) {
    if (record[field] !== undefined && typeof record[field] !== 'boolean') {
      add(`${basePath}.${field}`, `${field} must be a boolean when provided`);
    }
  }
  for (const field of ['type', 'molecule'] as const) {
    if (record[field] !== undefined && !ALLOWED_SEQUENCE_TYPES.has(record[field] as SequenceType)) {
      add(`${basePath}.${field}`, `${field} is not a supported sequence type`);
    }
  }
  if (record.topology !== undefined && record.topology !== 'linear' && record.topology !== 'circular') {
    add(`${basePath}.topology`, 'topology must be linear or circular');
  }
  const normalizedRecordSequence = normalizeSequence(record.seq ?? record.sequence ?? '', record.molecule ?? record.type);
  const normalizedRecordType = normalizeSequenceType(record.molecule ?? record.type, normalizedRecordSequence);
  if (record.translationTableId !== undefined) {
    if (typeof record.translationTableId !== 'number'
      || !Number.isInteger(record.translationTableId)
      || !isSupportedArtifactTranslationTableId(record.translationTableId)) {
      add(`${basePath}.translationTableId`, 'translationTableId must be a supported integer NCBI genetic-code id');
    } else if (!isNucleotideType(normalizedRecordType)) {
      add(`${basePath}.translationTableId`, 'translationTableId is valid on DNA and RNA records only');
    }
  }
  for (const field of ['overhang5', 'overhang3'] as const) {
    const value = record[field];
    if (value === undefined) continue;
    if (typeof value !== 'string') {
      add(`${basePath}.${field}`, `${field} must be a DNA string when provided`);
      continue;
    }
    if (value.length > MOTIF_MAX_OVERHANG_LENGTH) {
      add(
        `${basePath}.${field}`,
        `${field} cannot exceed ${MOTIF_MAX_OVERHANG_LENGTH} bases`,
        'resource_limit',
      );
      continue;
    }
    const compact = value.toUpperCase().replace(/\s+/g, '');
    if (!/^[ACGTRYSWKMBDHVN]*$/.test(compact)) {
      add(`${basePath}.${field}`, `${field} must contain DNA IUPAC bases only`);
    }
    if (normalizedRecordType !== 'dna') {
      add(`${basePath}.${field}`, `${field} is valid on DNA records only`);
    }
  }
  for (const [sequenceField, typeField] of [
    ['overhang5', 'overhang5Type'],
    ['overhang3', 'overhang3Type'],
  ] as const) {
    const typeValue = record[typeField];
    if (typeValue === undefined) continue;
    if (typeValue !== 'blunt' && typeValue !== '5prime' && typeValue !== '3prime') {
      add(`${basePath}.${typeField}`, `${typeField} must be blunt, 5prime, or 3prime`);
      continue;
    }
    if (normalizedRecordType !== 'dna') {
      add(`${basePath}.${typeField}`, `${typeField} is valid on DNA records only`);
    }
    const sequenceValue = record[sequenceField];
    if (typeof sequenceValue !== 'string') {
      add(`${basePath}.${typeField}`, `${typeField} requires a matching ${sequenceField} string`);
      continue;
    }
    const compact = sequenceValue.replace(/\s+/g, '');
    if (typeValue === 'blunt' && compact.length > 0) {
      add(`${basePath}.${typeField}`, `${typeField} cannot be blunt when ${sequenceField} contains a sticky sequence`);
    } else if (typeValue !== 'blunt' && compact.length === 0) {
      add(`${basePath}.${typeField}`, `${typeField} must be blunt when ${sequenceField} is empty`);
    }
  }
  if (record.tags !== undefined) {
    if (!Array.isArray(record.tags)) {
      add(`${basePath}.tags`, 'tags must be an array of strings');
    } else if (record.tags.length > MOTIF_MAX_TAGS_PER_RECORD) {
      add(
        `${basePath}.tags`,
        `tags cannot contain more than ${MOTIF_MAX_TAGS_PER_RECORD.toLocaleString()} entries`,
        'resource_limit',
      );
    } else {
      record.tags.forEach((tag, tagIndex) => {
        if (typeof tag !== 'string') {
          add(`${basePath}.tags[${tagIndex}]`, 'each tag must be a string');
        } else if (tag.length > MOTIF_MAX_TAG_LENGTH) {
          add(
            `${basePath}.tags[${tagIndex}]`,
            `tag cannot exceed ${MOTIF_MAX_TAG_LENGTH.toLocaleString()} characters`,
            'resource_limit',
          );
        }
      });
    }
  }
  if (record.provenance !== undefined) {
    if (!isPlainObject(record.provenance)) add(`${basePath}.provenance`, 'provenance must be a plain JSON object');
    else {
      const issue = jsonCompatibilityIssue(record.provenance, `${basePath}.provenance`, METADATA_JSON_LIMITS);
      if (issue) add(`${basePath}.provenance`, issue, issue.includes('exceeds') ? 'resource_limit' : 'malformed_field');
    }
  }
  if (record.sangerTrace !== undefined && validateTrace) {
    try {
      const recordSequence = normalizeSequence(record.seq ?? record.sequence ?? '', record.molecule ?? record.type);
      const recordType = normalizeSequenceType(record.molecule ?? record.type, recordSequence);
      if (recordType !== 'dna') throw new Error('sangerTrace is only valid on DNA records.');
      normalizeArtifactSangerTrace(record.sangerTrace, recordSequence);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'sangerTrace is malformed';
      add(
        `${basePath}.sangerTrace`,
        message,
        /more than|cannot exceed|safety limit|no longer than/i.test(message) ? 'resource_limit' : 'malformed_field',
      );
    }
  }

  const featureCount = ['annotations', 'features'].reduce((count, field) => (
    count + (Array.isArray(record[field]) ? record[field].length : 0)
  ), 0);
  const featureCardinalityExceeded = featureCount > MOTIF_MAX_FEATURES_PER_RECORD;
  if (featureCardinalityExceeded) {
    add(
      `${basePath}.features`,
      `annotations and features cannot contain more than ${MOTIF_MAX_FEATURES_PER_RECORD.toLocaleString()} entries in total`,
      'resource_limit',
    );
  }

  for (const field of ['annotations', 'features'] as const) {
    const rawFeatures = record[field];
    if (rawFeatures === undefined) continue;
    if (!Array.isArray(rawFeatures)) {
      add(`${basePath}.${field}`, `${field} must be an array of feature objects`);
      continue;
    }
    if (featureCardinalityExceeded) continue;
    rawFeatures.forEach((feature, featureIndex) => {
      const featurePath = `${basePath}.${field}[${featureIndex}]`;
      if (!isPlainObject(feature)) {
        add(featurePath, 'feature must be a plain object');
        return;
      }
      for (const stringField of ['id', 'name', 'type', 'color']) {
        if (feature[stringField] !== undefined && typeof feature[stringField] !== 'string') {
          add(`${featurePath}.${stringField}`, `${stringField} must be a string when provided`);
        } else if (typeof feature[stringField] === 'string') {
          const limit = stringField === 'color' ? 80 : MOTIF_MAX_SHORT_TEXT_LENGTH;
          if (feature[stringField].length > limit) {
            add(
              `${featurePath}.${stringField}`,
              `${stringField} cannot exceed ${limit.toLocaleString()} characters`,
              'resource_limit',
            );
          }
        }
      }
      if (!Number.isFinite(feature.start) || !Number.isFinite(feature.end)) {
        add(featurePath, 'feature start and end must be finite numbers');
      } else {
        const start = Number(feature.start);
        const end = Number(feature.end);
        if (start < 0 || end <= start || end > sequenceLength) {
          add(featurePath, `feature coordinates must satisfy 0 <= start < end <= ${sequenceLength}`);
        }
      }
      if (feature.strand !== undefined && feature.strand !== -1 && feature.strand !== 0 && feature.strand !== 1) {
        add(`${featurePath}.strand`, 'strand must be -1, 0, or 1');
      }
      if (feature.direction !== undefined
        && feature.direction !== 'forward' && feature.direction !== 'reverse' && feature.direction !== 'none'
        && feature.direction !== -1 && feature.direction !== 0 && feature.direction !== 1) {
        add(`${featurePath}.direction`, 'direction must be forward, reverse, none, -1, 0, or 1');
      }
      if (feature.metadata !== undefined) {
        if (!isPlainObject(feature.metadata)) add(`${featurePath}.metadata`, 'metadata must be a plain JSON object');
        else {
          const issue = jsonCompatibilityIssue(feature.metadata, `${featurePath}.metadata`, METADATA_JSON_LIMITS);
          if (issue) add(`${featurePath}.metadata`, issue, issue.includes('exceeds') ? 'resource_limit' : 'malformed_field');
        }
      }
      if (feature.subRanges !== undefined) {
        if (!Array.isArray(feature.subRanges)) {
          add(`${featurePath}.subRanges`, 'subRanges must be an array');
        } else if (feature.subRanges.length > MOTIF_MAX_SUBRANGES_PER_FEATURE) {
          add(
            `${featurePath}.subRanges`,
            `subRanges cannot contain more than ${MOTIF_MAX_SUBRANGES_PER_FEATURE.toLocaleString()} entries`,
            'resource_limit',
          );
        } else {
          feature.subRanges.forEach((subRange, subRangeIndex) => {
            const subRangePath = `${featurePath}.subRanges[${subRangeIndex}]`;
            if (!isPlainObject(subRange) || !Number.isFinite(subRange.start) || !Number.isFinite(subRange.end)) {
              add(subRangePath, 'subRange must be an object with finite start and end numbers');
              return;
            }
            const start = Number(subRange.start);
            const end = Number(subRange.end);
            if (start < 0 || end <= start || end > sequenceLength) {
              add(subRangePath, `subRange coordinates must satisfy 0 <= start < end <= ${sequenceLength}`);
            }
            if (subRange.strand !== undefined && subRange.strand !== -1 && subRange.strand !== 0 && subRange.strand !== 1) {
              add(`${subRangePath}.strand`, 'subRange strand must be -1, 0, or 1');
            }
          });
        }
      }
    });
  }

  if (record.sites !== undefined) {
    if (!Array.isArray(record.sites)) {
      add(`${basePath}.sites`, 'sites must be an array of site objects');
    } else if (record.sites.length > MOTIF_MAX_SITES_PER_RECORD) {
      add(
        `${basePath}.sites`,
        `sites cannot contain more than ${MOTIF_MAX_SITES_PER_RECORD.toLocaleString()} entries`,
        'resource_limit',
      );
    } else {
      let totalHits = 0;
      record.sites.forEach((site, siteIndex) => {
        const sitePath = `${basePath}.sites[${siteIndex}]`;
        if (!isPlainObject(site)) {
          add(sitePath, 'site must be a plain object');
          return;
        }
        for (const stringField of ['enzyme', 'motif']) {
          if (site[stringField] !== undefined && typeof site[stringField] !== 'string') {
            add(`${sitePath}.${stringField}`, `${stringField} must be a string when provided`);
          } else if (typeof site[stringField] === 'string' && site[stringField].length > MOTIF_MAX_SHORT_TEXT_LENGTH) {
            add(
              `${sitePath}.${stringField}`,
              `${stringField} cannot exceed ${MOTIF_MAX_SHORT_TEXT_LENGTH.toLocaleString()} characters`,
              'resource_limit',
            );
          }
        }
        if (site.count !== undefined && (!Number.isInteger(site.count) || Number(site.count) < 0)) {
          add(`${sitePath}.count`, 'count must be a non-negative integer');
        }
        if (site.indexBase !== undefined && site.indexBase !== 0 && site.indexBase !== 1) {
          add(`${sitePath}.indexBase`, 'indexBase must be 0 or 1');
        }
        if (site.overhang !== undefined && site.overhang !== 'blunt' && site.overhang !== '5prime' && site.overhang !== '3prime') {
          add(`${sitePath}.overhang`, 'overhang must be blunt, 5prime, or 3prime');
        }
        if (site.hits !== undefined) {
          if (!Array.isArray(site.hits)) {
            add(`${sitePath}.hits`, 'hits must be an array');
          } else if (site.hits.length > MOTIF_MAX_HITS_PER_SITE) {
            add(
              `${sitePath}.hits`,
              `hits cannot contain more than ${MOTIF_MAX_HITS_PER_SITE.toLocaleString()} entries`,
              'resource_limit',
            );
          } else {
            totalHits += site.hits.length;
            site.hits.forEach((hit, hitIndex) => {
              const hitPath = `${sitePath}.hits[${hitIndex}]`;
              if (!isPlainObject(hit)) {
                add(hitPath, 'hit must be a plain object');
                return;
              }
              if (!Number.isFinite(hit.position) || Number(hit.position) < 0) {
                add(`${hitPath}.position`, 'position must be a non-negative finite number');
              }
              if (hit.cutPosition !== undefined && (!Number.isFinite(hit.cutPosition) || Number(hit.cutPosition) < 0)) {
                add(`${hitPath}.cutPosition`, 'cutPosition must be a non-negative finite number');
              }
              if (hit.strand !== undefined && hit.strand !== -1 && hit.strand !== 1) {
                add(`${hitPath}.strand`, 'hit strand must be -1 or 1');
              }
              if (hit.indexBase !== undefined && hit.indexBase !== 0 && hit.indexBase !== 1) {
                add(`${hitPath}.indexBase`, 'hit indexBase must be 0 or 1');
              }
            });
          }
        }
      });
      if (totalHits > MOTIF_MAX_TOTAL_HITS_PER_RECORD) {
        add(
          `${basePath}.sites`,
          `sites cannot contain more than ${MOTIF_MAX_TOTAL_HITS_PER_RECORD.toLocaleString()} hits in total`,
          'resource_limit',
        );
      }
    }
  }
  return issues;
}

export function validateRuntimeRecordInputs(
  rawRecords: readonly unknown[],
  operation: 'motifRenderInventory' | 'motifAddRecords',
  aggregateAlreadyValidated = false,
): void {
  const issues: RuntimeRecordIssue[] = [];
  let traceSampleEntries = 0;
  for (const record of rawRecords) {
    if (!isPlainObject(record) || !isPlainObject(record.sangerTrace) || !isPlainObject(record.sangerTrace.channels)) continue;
    for (const base of ['A', 'C', 'G', 'T']) {
      const channel = record.sangerTrace.channels[base];
      if (Array.isArray(channel)) traceSampleEntries += channel.length;
    }
  }
  const traceWorkspaceExceeded = traceSampleEntries > ARTIFACT_SANGER_MAX_WORKSPACE_SAMPLE_ENTRIES;
  if (traceWorkspaceExceeded) {
    issues.push({
      index: -1,
      code: 'resource_limit',
      path: 'records.sangerTrace.channels',
      message: `Workspace traces cannot contain more than ${ARTIFACT_SANGER_MAX_WORKSPACE_SAMPLE_ENTRIES.toLocaleString()} channel sample entries in total`,
    });
  }
  if (rawRecords.length > MOTIF_MAX_RECORDS) {
    issues.push({
      index: -1,
      code: 'resource_limit',
      path: 'records',
      message: `Inventory cannot contain more than ${MOTIF_MAX_RECORDS.toLocaleString()} records`,
    });
  }

  const recordsToValidate = rawRecords.length > MOTIF_MAX_RECORDS
    ? rawRecords.slice(0, MOTIF_MAX_RECORDS)
    : rawRecords;
  recordsToValidate.forEach((record, index) => {
    const truncationReason = truncatedGenBankReason(record);
    if (truncationReason) {
      issues.push({ index, code: 'truncated_genbank', message: truncationReason });
      return;
    }
    if (!isPlainObject(record)) {
      issues.push({
        index,
        code: 'invalid_record',
        message: 'Record must be a plain object containing a valid sequence.',
      });
      return;
    }
    const sequenceTypeHint = record.molecule ?? record.type;
    const rawSequence = record.seq ?? record.sequence ?? '';
    const rawSequenceTooLong = typeof rawSequence === 'string' && rawSequence.length > MOTIF_MAX_RAW_SEQUENCE_CHARACTERS;
    if (rawSequenceTooLong) {
      issues.push({
        index,
        code: 'resource_limit',
        path: `records[${index}].sequence`,
        message: `Raw sequence text cannot exceed ${MOTIF_MAX_RAW_SEQUENCE_CHARACTERS.toLocaleString()} characters`,
      });
    }
    const sequence = rawSequenceTooLong ? '' : normalizeSequence(rawSequence, sequenceTypeHint);
    if (!sequence) {
      issues.push({
        index,
        code: 'invalid_record',
        path: `records[${index}].sequence`,
        message: 'Record must contain a valid DNA, RNA, or sequence-like protein value. Set type: "protein" for ambiguous peptide text.',
      });
    } else if (sequence.length > MOTIF_MAX_RECORD_LENGTH) {
      issues.push({
        index,
        code: 'record_too_large',
        path: `records[${index}].sequence`,
        message: `Record contains ${sequence.length.toLocaleString()} residues; the artifact supports at most ${MOTIF_MAX_RECORD_LENGTH.toLocaleString()} per record. Split the record before importing it.`,
      });
    }
    issues.push(...collectMalformedRecordIssues(record, index, sequence.length, !traceWorkspaceExceeded));
  });

  if (!aggregateAlreadyValidated && !issues.some((issue) => issue.code === 'resource_limit')) {
    const aggregateIssue = jsonCompatibilityIssue(
      omitTraceArraysForGenericJsonValidation(rawRecords),
      'records',
      PAYLOAD_JSON_LIMITS,
    );
    if (aggregateIssue) {
      issues.push({
        index: -1,
        code: aggregateIssue.includes('exceeds') ? 'resource_limit' : 'malformed_field',
        path: 'records',
        message: aggregateIssue,
      });
    }
  }

  if (issues.length === 0) return;
  const hasTruncatedGenBank = issues.some((issue) => issue.code === 'truncated_genbank');
  const hasOversizedRecord = issues.some((issue) => issue.code === 'record_too_large');
  const hasResourceLimit = issues.some((issue) => issue.code === 'resource_limit');
  const preservedMessage = operation === 'motifRenderInventory'
    ? 'The existing inventory was preserved.'
    : 'No records were added.';
  throw new MotifArtifactRuntimeError(
    hasTruncatedGenBank ? 'MOTIF_TRUNCATED_GENBANK_IMPORT' : hasOversizedRecord ? 'MOTIF_RECORD_TOO_LARGE' : hasResourceLimit ? 'MOTIF_INPUT_LIMIT_EXCEEDED' : operation === 'motifRenderInventory'
      ? 'MOTIF_INVALID_INVENTORY_REPLACEMENT'
      : 'MOTIF_INVALID_RECORD_INPUT',
    hasTruncatedGenBank
      ? `${operation} rejected a truncated GenBank record. Import the complete record through the end of ORIGIN and retry. ${preservedMessage}`
      : hasOversizedRecord
        ? `${operation} rejected a record over the ${MOTIF_MAX_RECORD_LENGTH.toLocaleString()}-residue artifact limit. Split the record before importing it. ${preservedMessage}`
        : hasResourceLimit
          ? `${operation} rejected input that exceeds the artifact's bounded resource limits. Split the inventory or reduce annotations and metadata, then retry. ${preservedMessage}`
      : `${operation} rejected ${issues.length} invalid record${issues.length === 1 ? '' : 's'}. ${preservedMessage}`,
    { operation, inputCount: rawRecords.length, issues, mutated: false },
  );
}

function validateRuntimePayloadEnvelope(rawPayload: unknown): void {
  const issues: RuntimeRecordIssue[] = [];
  const add = (path: string, message: string, code: RuntimeRecordIssue['code'] = 'malformed_field') => {
    issues.push({ index: -1, code, path, message });
  };
  const payload = coercePayload(rawPayload);
  const recordCount = payloadRecords(payload).length;
  if (isPlainObject(rawPayload)) {
    for (const field of ['records', 'entries', 'vectors'] as const) {
      if (Object.prototype.hasOwnProperty.call(rawPayload, field) && !Array.isArray(rawPayload[field])) {
        add(`payload.${field}`, `${field} must be an array when provided`);
      }
    }
    if (Object.prototype.hasOwnProperty.call(rawPayload, 'record') && !isPlainObject(rawPayload.record)) {
      add('payload.record', 'record must be a plain object when provided');
    }
    const recordContainers = ['records', 'entries', 'vectors', 'record'].filter((field) => (
      Object.prototype.hasOwnProperty.call(rawPayload, field)
    ));
    if (recordContainers.length > 1) {
      add('payload', `payload has ambiguous record containers: ${recordContainers.join(', ')}`);
    }
  }
  if (recordCount > MOTIF_MAX_RECORDS) {
    add(
      'payload.records',
      `Inventory cannot contain more than ${MOTIF_MAX_RECORDS.toLocaleString()} records`,
      'resource_limit',
    );
  } else {
    const aggregateIssue = jsonCompatibilityIssue(
      omitTraceArraysForGenericJsonValidation(rawPayload),
      'payload',
      PAYLOAD_JSON_LIMITS,
    );
    if (aggregateIssue) {
      add('payload', aggregateIssue, aggregateIssue.includes('exceeds') ? 'resource_limit' : 'malformed_field');
    }
  }
  for (const field of ['schema', 'selectedRecordId', 'selectedName', 'defaultMotif', 'motif'] as const) {
    const value = payload[field];
    if (value !== undefined && typeof value !== 'string') {
      add(`payload.${field}`, `${field} must be a string when provided`);
    } else if (typeof value === 'string' && value.length > MOTIF_MAX_SHORT_TEXT_LENGTH) {
      add(
        `payload.${field}`,
        `${field} cannot exceed ${MOTIF_MAX_SHORT_TEXT_LENGTH.toLocaleString()} characters`,
        'resource_limit',
      );
    }
  }
  if (typeof payload.schema === 'string'
    && payload.schema.startsWith('motif.claude-science.inventory.')
    && payload.schema !== MOTIF_INVENTORY_SCHEMA_V1
    && payload.schema !== DEFAULT_SCHEMA) {
    add('payload.schema', `Unsupported Motif inventory schema: ${payload.schema}`);
  }
  if (payload.selectedIndex !== undefined && !Number.isInteger(payload.selectedIndex)) {
    add('payload.selectedIndex', 'selectedIndex must be an integer when provided');
  }
  if (payload.inventory !== undefined) {
    if (!isPlainObject(payload.inventory)) {
      add('payload.inventory', 'inventory must be a plain object');
    } else {
      for (const field of ['id', 'title', 'description', 'updatedAt'] as const) {
        const value = payload.inventory[field];
        if (value !== undefined && typeof value !== 'string') {
          add(`payload.inventory.${field}`, `${field} must be a string when provided`);
        } else if (typeof value === 'string') {
          const limit = field === 'description' ? MOTIF_MAX_DESCRIPTION_LENGTH : MOTIF_MAX_SHORT_TEXT_LENGTH;
          if (value.length > limit) {
            add(
              `payload.inventory.${field}`,
              `${field} cannot exceed ${limit.toLocaleString()} characters`,
              'resource_limit',
            );
          }
        }
      }
    }
  }

  if (issues.length === 0) return;
  const hasResourceLimit = issues.some((issue) => issue.code === 'resource_limit');
  throw new MotifArtifactRuntimeError(
    hasResourceLimit ? 'MOTIF_INPUT_LIMIT_EXCEEDED' : 'MOTIF_INVALID_INVENTORY_REPLACEMENT',
    hasResourceLimit
      ? 'motifRenderInventory rejected a payload that exceeds the artifact\'s bounded resource limits. The existing inventory was preserved.'
      : 'motifRenderInventory rejected a malformed payload envelope. The existing inventory was preserved.',
    { operation: 'motifRenderInventory', inputCount: recordCount, issues, mutated: false },
  );
}

export function prepareInventoryReplacement(
  rawPayload: ArtifactPayload | ArtifactRecordInput | ArtifactRecordInput[],
  fallbackSelectedRecordId?: string,
): LoadedPayload {
  const payload = coercePayload(rawPayload);
  const hasExplicitRecords = payloadHasExplicitRecords(rawPayload, payload);
  if (!hasExplicitRecords) {
    throw new MotifArtifactRuntimeError(
      'MOTIF_INVALID_INVENTORY_REPLACEMENT',
      'motifRenderInventory requires a record, a record array, or a payload with records. The existing inventory was preserved.',
      { operation: 'motifRenderInventory', inputCount: 0, issues: [{ code: 'missing_records' }], mutated: false },
    );
  }

  const rawRecords = payloadRecords(payload) as unknown[];
  // An explicit literal empty collection is the only replacement form that is
  // allowed to clear. Every non-empty collection must validate in full first.
  const nextPayload = loadArtifactPayload(rawPayload, fallbackSelectedRecordId);
  if (rawRecords.length > 0 && nextPayload.records.length === 0) {
    throw new MotifArtifactRuntimeError(
      'MOTIF_INVALID_INVENTORY_REPLACEMENT',
      'motifRenderInventory received records but none were active and usable. The existing inventory was preserved; pass [] to clear intentionally.',
      { operation: 'motifRenderInventory', inputCount: rawRecords.length, issues: [{ code: 'no_active_records' }], mutated: false },
    );
  }
  return nextPayload;
}

const RECORDS_ONLY_FORBIDDEN_FIELDS = [
  'alignment',
  'alignments',
  'artifactState',
  'notes',
  'workflowResults',
  'analysisResults',
  'analysisAssets',
] as const;

type RecordsOnlyCompatibilityIssue = {
  category: 'alignment' | 'note' | 'workflowResult' | 'analysisResult' | 'artifactState';
  message: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function artifactRecordBiologyChanged(previous: ArtifactVector, next: ArtifactVector): boolean {
  return previous.sequence !== next.sequence
    || previous.type !== next.type
    || previous.translationTableId !== next.translationTableId
    || previous.topology !== next.topology
    || previous.overhang5 !== next.overhang5
    || previous.overhang3 !== next.overhang3
    || previous.overhang5Type !== next.overhang5Type
    || previous.overhang3Type !== next.overhang3Type;
}

/**
 * Prepare the records-only page API as one transaction. Existing workspace
 * sidecars are cloned and revalidated against the prospective record set; a
 * caller must use motifReplaceWorkspace when a replacement would orphan any
 * linked result or durable record setting.
 */
export function prepareRecordsOnlyWorkspaceReplacement(
  currentPayload: LoadedPayload,
  currentArtifactState: ArtifactDurableState,
  rawPayload: ArtifactPayload | ArtifactRecordInput | ArtifactRecordInput[],
  fallbackSelectedRecordId?: string,
): PreparedArtifactWorkspace {
  if (isPlainObject(rawPayload)) {
    const forbiddenFields = RECORDS_ONLY_FORBIDDEN_FIELDS.filter((field) => (
      Object.prototype.hasOwnProperty.call(rawPayload, field)
    ));
    if (forbiddenFields.length > 0) {
      throw new MotifArtifactRuntimeError(
        'MOTIF_INVALID_WORKSPACE_INPUT',
        'motifRenderInventory is records-only and will not discard workspace state silently. Use motifReplaceWorkspace for a complete backup payload.',
        { operation: 'motifRenderInventory', forbiddenFields, mutated: false },
      );
    }
  }

  const replacement = prepareInventoryReplacement(rawPayload, fallbackSelectedRecordId);
  const recordLengths = new Map(replacement.records.map((record) => [record.id, record.sequence.length]));
  const previousRecordsById = new Map(currentPayload.records.map((record) => [record.id, record]));
  const biologicallyChangedRecordIds = new Set(replacement.records.flatMap((record) => {
    const previous = previousRecordsById.get(record.id);
    return previous && artifactRecordBiologyChanged(previous, record) ? [record.id] : [];
  }));
  const issues: RecordsOnlyCompatibilityIssue[] = [];
  const capture = <T,>(
    category: RecordsOnlyCompatibilityIssue['category'],
    operation: () => T,
  ): T | null => {
    try {
      return operation();
    } catch (error) {
      issues.push({ category, message: errorMessage(error) });
      return null;
    }
  };
  const addBiologicalIdentityIssue = (
    category: RecordsOnlyCompatibilityIssue['category'],
    recordIds: Iterable<string | undefined>,
  ) => {
    const changedIds = Array.from(new Set(Array.from(recordIds).flatMap((recordId) => (
      recordId && biologicallyChangedRecordIds.has(recordId) ? [recordId] : []
    ))));
    if (changedIds.length > 0) {
      issues.push({
        category,
        message: `Preserved ${category} data is linked to biologically changed record${changedIds.length === 1 ? '' : 's'}: ${changedIds.join(', ')}.`,
      });
    }
  };

  const missingAlignmentRecordIds = Array.from(new Set(currentPayload.alignments.flatMap((alignment) => (
    alignment.rows.flatMap((row) => (
      row.sourceRecordId && !recordLengths.has(row.sourceRecordId) ? [row.sourceRecordId] : []
    ))
  ))));
  if (missingAlignmentRecordIds.length > 0) {
    issues.push({
      category: 'alignment',
      message: `Alignment rows reference records absent from the replacement: ${missingAlignmentRecordIds.join(', ')}.`,
    });
  }
  addBiologicalIdentityIssue('alignment', currentPayload.alignments.flatMap((alignment) => (
    alignment.rows.map((row) => row.sourceRecordId)
  )));
  const alignments = capture('alignment', () => normalizeArtifactAlignments(
    currentPayload.alignments.map(serializeArtifactAlignment),
  ));
  addBiologicalIdentityIssue('note', currentPayload.notes.map((note) => note.recordId));
  const noteCollections = capture('note', () => normalizeArtifactWorkspaceCollections({
    notes: currentPayload.notes,
    workflowResults: [],
  }, { recordLengths }));
  addBiologicalIdentityIssue('workflowResult', currentPayload.workflowResults.flatMap((result) => (
    [...result.inputRecordIds, ...result.outputRecordIds]
  )));
  const previousRecordIds = new Set(currentPayload.records.map((record) => record.id));
  const newlyMissingWorkflowOutputIds = Array.from(new Set(currentPayload.workflowResults.flatMap((result) => (
    result.outputRecordIds.filter((recordId) => previousRecordIds.has(recordId) && !recordLengths.has(recordId))
  ))));
  if (newlyMissingWorkflowOutputIds.length > 0) {
    issues.push({
      category: 'workflowResult',
      message: `Workflow outputs would become newly orphaned: ${newlyMissingWorkflowOutputIds.join(', ')}.`,
    });
  }
  const workflowCollections = capture('workflowResult', () => normalizeArtifactWorkspaceCollections({
    notes: [],
    workflowResults: currentPayload.workflowResults,
  }, { recordLengths, allowMissingWorkflowOutputRecords: true }));
  addBiologicalIdentityIssue(
    'analysisResult',
    currentPayload.analysisResults.flatMap(artifactAnalysisResultRecordIds),
  );
  const analysisWorkspace = capture('analysisResult', () => normalizeArtifactAnalysisWorkspace({
    analysisResults: currentPayload.analysisResults,
    analysisAssets: currentPayload.analysisAssets,
  }, { recordLengths }));

  const artifactStateRecordIds = new Set<string>();
  for (const field of [
    'translationLayersByRecord',
    'enzymeSourcesByRecord',
    'hiddenEnzymesByRecord',
    'hiddenFeatureTranslationsByRecord',
    'restrictionLabelsByRecord',
    'motifsByRecord',
  ] as const) {
    Object.keys(currentArtifactState[field]).forEach((recordId) => artifactStateRecordIds.add(recordId));
    const missingIds = Object.keys(currentArtifactState[field]).filter((recordId) => !recordLengths.has(recordId));
    if (missingIds.length > 0) {
      issues.push({
        category: 'artifactState',
        message: `artifactState.${field} references records absent from the replacement: ${missingIds.join(', ')}.`,
      });
    }
  }
  for (const [recordId, hiddenIds] of Object.entries(currentArtifactState.hiddenFeatureTranslationsByRecord)) {
    const previous = previousRecordsById.get(recordId);
    const next = replacement.records.find((record) => record.id === recordId);
    if (!previous || !next) continue;
    const previousFeatureIds = new Set(previous.features.map((feature) => `feat:${feature.id}`));
    const nextFeatureIds = new Set(next.features.map((feature) => `feat:${feature.id}`));
    const newlyMissingFeatureIds = hiddenIds.filter((id) => previousFeatureIds.has(id) && !nextFeatureIds.has(id));
    if (newlyMissingFeatureIds.length > 0) {
      issues.push({
        category: 'artifactState',
        message: `artifactState.hiddenFeatureTranslationsByRecord.${recordId} would reference removed feature${newlyMissingFeatureIds.length === 1 ? '' : 's'}: ${newlyMissingFeatureIds.join(', ')}.`,
      });
    }
  }
  addBiologicalIdentityIssue('artifactState', artifactStateRecordIds);
  const artifactState = capture('artifactState', () => (
    normalizeArtifactDurableState(currentArtifactState, recordLengths)
  ));

  if (issues.length > 0 || !alignments || !noteCollections || !workflowCollections || !analysisWorkspace || !artifactState) {
    throw new MotifArtifactRuntimeError(
      'MOTIF_INVALID_INVENTORY_REPLACEMENT',
      'motifRenderInventory would orphan existing workspace data. The existing workspace was preserved; use motifReplaceWorkspace for an intentional complete replacement.',
      { operation: 'motifRenderInventory', issues, mutated: false },
    );
  }

  const rawPayloadObject = isPlainObject(rawPayload) ? rawPayload : null;
  const suppliesInventory = Boolean(rawPayloadObject
    && Object.prototype.hasOwnProperty.call(rawPayloadObject, 'inventory'));
  const suppliesSchema = Boolean(rawPayloadObject
    && Object.prototype.hasOwnProperty.call(rawPayloadObject, 'schema'));
  const suppliesDefaultMotif = Boolean(rawPayloadObject && (
    Object.prototype.hasOwnProperty.call(rawPayloadObject, 'defaultMotif')
    || Object.prototype.hasOwnProperty.call(rawPayloadObject, 'motif')
  ));

  return {
    payload: {
      ...replacement,
      schema: suppliesSchema ? replacement.schema : currentPayload.schema,
      inventory: suppliesInventory ? replacement.inventory : { ...currentPayload.inventory },
      defaultMotif: suppliesDefaultMotif ? replacement.defaultMotif : currentPayload.defaultMotif,
      alignments,
      notes: noteCollections.notes,
      workflowResults: workflowCollections.workflowResults,
      analysisResults: analysisWorkspace.analysisResults,
      analysisAssets: analysisWorkspace.analysisAssets,
    },
    artifactState,
  };
}

export function prepareArtifactDatabaseRestore(
  rawDatabase: unknown,
  fallbackSelectedRecordId?: string,
): PreparedArtifactWorkspace {
  // Validate both halves before returning either one. Callers can therefore
  // replace the current workspace in one commit without leaving a partially
  // imported inventory behind when nested session state is malformed.
  const coercedDatabase = coercePayload(rawDatabase);
  const isSidecarOnlyWorkspace = isPlainObject(rawDatabase)
    && !payloadHasExplicitRecords(rawDatabase, coercedDatabase)
    && RECORDS_ONLY_FORBIDDEN_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(rawDatabase, field));
  const restoreInput = isSidecarOnlyWorkspace
    ? { ...rawDatabase, records: [] }
    : rawDatabase;
  const preparedPayload = prepareInventoryReplacement(
    restoreInput as ArtifactPayload | ArtifactRecordInput | ArtifactRecordInput[],
    fallbackSelectedRecordId,
  );
  const recordLengths = new Map(preparedPayload.records.map((record) => [record.id, record.sequence.length]));
  if (!isPlainObject(rawDatabase)) {
    return {
      payload: preparedPayload,
      artifactState: normalizeArtifactDurableState(undefined, recordLengths),
    };
  }
  const envelope = normalizeArtifactWorkspaceEnvelope(rawDatabase, recordLengths);
  const payload: LoadedPayload = {
    ...preparedPayload,
    notes: envelope.notes,
    workflowResults: envelope.workflowResults,
  };
  const artifactState = envelope.artifactState;
  return { payload, artifactState };
}

function artifactDurableFingerprint(payload: LoadedPayload, artifactState: ArtifactDurableState): string {
  return JSON.stringify({
    schema: payload.schema,
    inventory: payload.inventory,
    defaultMotif: payload.defaultMotif,
    records: payload.records.map(serializeRecord),
    alignments: payload.alignments.map(serializeArtifactAlignment),
    notes: payload.notes,
    workflowResults: payload.workflowResults,
    analysisResults: payload.analysisResults,
    analysisAssets: payload.analysisAssets,
    artifactState,
  });
}

export function createArtifactDatabaseSnapshot(
  payload: LoadedPayload,
  artifactState: ArtifactDurableState,
  records: readonly ArtifactVector[] = payload.records,
): Record<string, unknown> {
  const recordLengths = new Map(records.map((record) => [record.id, record.sequence.length]));
  return omitUndefinedObjectProperties({
    schema: DEFAULT_SCHEMA,
    exportedAt: new Date().toISOString(),
    inventory: { ...payload.inventory },
    selectedRecordId: payload.selectedRecordId,
    defaultMotif: payload.defaultMotif,
    records: records.map(serializeRecord),
    alignments: payload.alignments.map(serializeArtifactAlignment),
    ...serializeArtifactWorkspaceCollections({
      notes: payload.notes,
      workflowResults: payload.workflowResults,
    }, {
      recordLengths,
      allowMissingWorkflowOutputRecords: true,
    }),
    ...serializeArtifactAnalysisWorkspace({
      analysisResults: payload.analysisResults,
      analysisAssets: payload.analysisAssets,
    }, { recordLengths }),
    artifactState: normalizeArtifactDurableState(artifactState, recordLengths),
  });
}

function cleanMotif(motif: string, sequenceType: SequenceType): string {
  if (sequenceType === 'protein') return motif.toUpperCase().replace(/[^A-Z*]/g, '');
  if (sequenceType === 'rna') return motif.toUpperCase().replace(/[^ACGU]/g, '');
  return motif.toUpperCase().replace(/[^ACGT]/g, '');
}

function findMotifHits(sequence: string, motif: string, sequenceType: SequenceType, topology: Topology = 'linear'): number[] {
  const cleaned = cleanMotif(motif, sequenceType);
  if (!cleaned) return [];
  // Nucleotide search matches both strands (the reverse-complement of the query
  // on the forward sequence), like the workbench pattern search. Protein stays single.
  const targets = [cleaned];
  if (sequenceType === 'dna' || sequenceType === 'rna') {
    const rc = reverseComplement(cleaned, sequenceType === 'rna');
    if (rc && rc !== cleaned) targets.push(rc);
  }
  const hits = new Set<number>();
  for (const target of targets) {
    if (target.length > sequence.length) continue;
    const circular = topology === 'circular' && sequenceType !== 'protein';
    const scanSequence = circular
      ? sequence + sequence.slice(0, Math.max(0, target.length - 1))
      : sequence;
    const lastStart = circular ? sequence.length - 1 : sequence.length - target.length;
    for (let i = 0; i <= lastStart; i += 1) {
      if (scanSequence.slice(i, i + target.length) === target) hits.add(i);
    }
  }
  return Array.from(hits).sort((a, b) => a - b);
}

function circularSequenceSlice(sequence: string, start: number, length: number): string {
  if (!sequence || length <= 0) return '';
  let result = '';
  for (let offset = 0; offset < length; offset += 1) {
    result += sequence[positiveModulo(start + offset, sequence.length)];
  }
  return result;
}

function motifHitContext(sequence: string, hit: number, motifLength: number, flankLength = 10, topology: Topology = 'linear') {
  if (topology === 'circular' && sequence.length > 0) {
    return {
      left: circularSequenceSlice(sequence, hit - flankLength, Math.min(flankLength, sequence.length)),
      match: circularSequenceSlice(sequence, hit, Math.min(motifLength, sequence.length)),
      right: circularSequenceSlice(sequence, hit + motifLength, Math.min(flankLength, sequence.length)),
      clippedLeft: false,
      clippedRight: false,
    };
  }
  const matchEnd = Math.min(sequence.length, hit + motifLength);
  const contextStart = Math.max(0, hit - flankLength);
  const contextEnd = Math.min(sequence.length, matchEnd + flankLength);
  return {
    left: sequence.slice(contextStart, hit),
    match: sequence.slice(hit, matchEnd),
    right: sequence.slice(matchEnd, contextEnd),
    clippedLeft: contextStart > 0,
    clippedRight: contextEnd < sequence.length,
  };
}

// ── Guide RNA (CRISPR) design ──────────────────────────────────────────────
// Pure PAM scanner. Protospacers are reported in FORWARD coordinates (so a guide
// selects/highlights like any range) regardless of the strand it was found on.
const IUPAC_MATCH: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T', U: 'T',
  R: 'AG', Y: 'CT', S: 'GC', W: 'AT', K: 'GT', M: 'AC',
  B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGT',
};

type NucleaseId = 'spcas9' | 'sacas9' | 'ascas12a' | 'cas13d';
type GuideNuclease = {
  id: NucleaseId;
  name: string;
  enzyme: string;
  pam: string; // IUPAC PAM; '' = none (RNA-targeting)
  pamSide: 3 | 5; // 3′ or 5′ of the protospacer
  spacerLen: number;
  targetsRna?: boolean;
  note: string;
};

const GUIDE_NUCLEASES: readonly GuideNuclease[] = [
  { id: 'spcas9', name: 'SpCas9', enzyme: 'SpCas9', pam: 'NGG', pamSide: 3, spacerLen: 20, note: '20 nt spacer · NGG PAM (3′) · blunt cut 3 bp from PAM' },
  { id: 'sacas9', name: 'SaCas9', enzyme: 'SaCas9', pam: 'NNGRRT', pamSide: 3, spacerLen: 21, note: '21 nt spacer · NNGRRT PAM (3′)' },
  { id: 'ascas12a', name: 'Cas12a (Cpf1)', enzyme: 'AsCas12a', pam: 'TTTV', pamSide: 5, spacerLen: 23, note: '23 nt spacer · TTTV PAM (5′) · staggered cut distal to PAM' },
  { id: 'cas13d', name: 'Cas13d (CasRx)', enzyme: 'RfxCas13d', pam: '', pamSide: 3, spacerLen: 23, targetsRna: true, note: '23 nt spacer · RNA-targeting · no PAM (PFS-independent) · sense strand only' },
];

type GuideHit = {
  id: string;
  strand: 1 | -1;
  start: number; // protospacer start, forward coords, inclusive
  end: number; // exclusive
  spacer: string; // 5′→3′ protospacer on its own strand (the guide target)
  pam: string; // PAM bases 5′→3′ on the guide strand; '' if none
  gc: number; // 0..1
};

function matchesIupac(window: string, pattern: string): boolean {
  if (window.length !== pattern.length) return false;
  for (let i = 0; i < pattern.length; i += 1) {
    const allowed = IUPAC_MATCH[pattern[i]];
    if (!allowed || !allowed.includes(window[i])) return false;
  }
  return true;
}

function gcFraction(seq: string): number {
  if (!seq) return 0;
  let gc = 0;
  for (const base of seq) if (base === 'G' || base === 'C') gc += 1;
  return gc / seq.length;
}

function collectGuidesOnStrand(
  oriented: string,
  strand: 1 | -1,
  nuclease: GuideNuclease,
  toForward: (a: number, b: number) => { start: number; end: number },
  out: GuideHit[],
): void {
  const length = oriented.length;
  const pamLen = nuclease.pam.length;
  const spacerLen = nuclease.spacerLen;
  if (pamLen === 0) {
    for (let p = 0; p + spacerLen <= length; p += 1) {
      const spacer = oriented.slice(p, p + spacerLen);
      const { start, end } = toForward(p, p + spacerLen);
      out.push({ id: `g:${strand}:${start}`, strand, start, end, spacer, pam: '', gc: gcFraction(spacer) });
    }
    return;
  }
  for (let i = 0; i + pamLen <= length; i += 1) {
    const pamSeq = oriented.slice(i, i + pamLen);
    if (!matchesIupac(pamSeq, nuclease.pam)) continue;
    const spacerStart = nuclease.pamSide === 3 ? i - spacerLen : i + pamLen;
    const spacerEnd = spacerStart + spacerLen;
    if (spacerStart < 0 || spacerEnd > length) continue;
    const spacer = oriented.slice(spacerStart, spacerEnd);
    const { start, end } = toForward(spacerStart, spacerEnd);
    out.push({ id: `g:${strand}:${start}`, strand, start, end, spacer, pam: pamSeq, gc: gcFraction(spacer) });
  }
}

function collectCircularGuidesOnStrand(
  oriented: string,
  strand: 1 | -1,
  nuclease: GuideNuclease,
  toForward: (start: number, length: number) => { start: number; end: number },
  out: GuideHit[],
): void {
  const length = oriented.length;
  const pamLen = nuclease.pam.length;
  const spacerLen = nuclease.spacerLen;
  for (let pamStart = 0; pamStart < length; pamStart += 1) {
    const pamSeq = pamLen > 0 ? circularSequenceSlice(oriented, pamStart, pamLen) : '';
    if (pamLen > 0 && !matchesIupac(pamSeq, nuclease.pam)) continue;
    const spacerStart = pamLen === 0
      ? pamStart
      : nuclease.pamSide === 3
        ? pamStart - spacerLen
        : pamStart + pamLen;
    const spacer = circularSequenceSlice(oriented, spacerStart, spacerLen);
    const { start, end } = toForward(positiveModulo(spacerStart, length), spacerLen);
    out.push({ id: `g:${strand}:${start}:${pamStart}`, strand, start, end, spacer, pam: pamSeq, gc: gcFraction(spacer) });
  }
}

function findGuides(
  sequence: string,
  sequenceType: SequenceType,
  nuclease: GuideNuclease,
  topology: Topology = 'linear',
  limit = 500,
): GuideHit[] {
  if (!isNucleotideType(sequenceType) || sequence.length < nuclease.spacerLen + nuclease.pam.length) return [];
  if (nuclease.targetsRna && sequenceType !== 'rna') return [];
  const length = sequence.length;
  const out: GuideHit[] = [];
  if (topology === 'circular') {
    collectCircularGuidesOnStrand(sequence, 1, nuclease, (start, spacerLength) => ({
      start,
      end: start + spacerLength,
    }), out);
    if (!nuclease.targetsRna) {
      const rc = reverseComplement(sequence, sequenceType === 'rna');
      collectCircularGuidesOnStrand(rc, -1, nuclease, (start, spacerLength) => {
        const forwardStart = positiveModulo(length - (start + spacerLength), length);
        return { start: forwardStart, end: forwardStart + spacerLength };
      }, out);
    }
  } else {
    collectGuidesOnStrand(sequence, 1, nuclease, (a, b) => ({ start: a, end: b }), out);
    if (!nuclease.targetsRna) {
      const rc = reverseComplement(sequence, sequenceType === 'rna');
      collectGuidesOnStrand(rc, -1, nuclease, (a, b) => ({ start: length - b, end: length - a }), out);
    }
  }
  out.sort((a, b) => a.start - b.start || a.strand - b.strand);
  return out.length > limit ? out.slice(0, limit) : out;
}

function findGuidesInRange(
  sequence: string,
  sequenceType: SequenceType,
  nuclease: GuideNuclease,
  range: MapSelectionRange | null,
  topology: Topology,
): GuideHit[] {
  if (!range) return findGuides(sequence, sequenceType, nuclease, topology);
  const spans = normalizeSpan(range.start, range.end, sequence.length, topology);
  const scopedSequence = sequenceForRange(sequence, range, topology);
  if (spans.length === 0 || !scopedSequence) return [];
  return findGuides(scopedSequence, sequenceType, nuclease, 'linear').map((guide) => {
    const start = coordinateAtRangeOffset(spans, guide.start);
    return {
      ...guide,
      id: `${guide.id}:range:${range.start}:${range.end}`,
      start,
      end: start + (guide.end - guide.start),
    };
  });
}

function formatRange(start: number, end: number): string {
  return `${start + 1}-${end}`;
}

function featureRangeLabel(feature: Pick<Feature, 'start' | 'end' | 'strand' | 'subRanges'>): string {
  const ranges = featureLocationSegments(feature).map((segment) => formatRange(segment.start, segment.end));
  if (ranges.length === 0) return feature.subRanges !== undefined ? 'invalid location' : formatRange(feature.start, feature.end);
  if (ranges.length === 1) return ranges[0];
  if (ranges.length <= 4) return ranges.join(' + ');
  return `${ranges.slice(0, 2).join(' + ')} + … + ${ranges[ranges.length - 1]} (${ranges.length} segments)`;
}

function strandLabel(strand: FeatureStrand): string {
  if (strand === -1) return 'reverse';
  if (strand === 0) return 'none';
  return 'forward';
}

function featureStrandLabel(feature: Pick<Feature, 'start' | 'end' | 'strand' | 'subRanges'>): string {
  const strands = new Set(featureLocationSegments(feature).map((segment) => segment.strand));
  return strands.size > 1 ? 'mixed' : strandLabel(strands.values().next().value ?? feature.strand);
}

function sequenceLengthLabel(length: number, sequenceType: SequenceType): string {
  if (sequenceType === 'protein') return `${length.toLocaleString()} aa`;
  if (sequenceType === 'rna') return `${length.toLocaleString()} nt`;
  return `${length.toLocaleString()} bp`;
}

function sequenceUnitLabel(sequenceType: SequenceType): 'aa' | 'nt' | 'bp' {
  if (sequenceType === 'protein') return 'aa';
  if (sequenceType === 'rna') return 'nt';
  return 'bp';
}

function defaultMotifForRecord(sequenceType: SequenceType, fallbackMotif: string): string {
  if (sequenceType === 'protein') return '';
  if (sequenceType === 'rna') return fallbackMotif.replace(/T/g, 'U');
  return fallbackMotif;
}

function useElementSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 620, height: 560 });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(220, Math.floor(entry.contentRect.width));
      const height = Math.max(260, Math.floor(entry.contentRect.height));
      setSize((current) => (
        Math.abs(current.width - width) < 2 && Math.abs(current.height - height) < 2
          ? current
          : { width, height }
      ));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}

type EditSnapshot = {
  sequence: string;
  features: readonly Feature[];
  sites: readonly RestrictionSite[];
  sangerTrace?: SangerTraceData;
  noteAnchors: NoteAnchorSnapshot[];
  hadTranslationLayerEntry: boolean;
  translationLayers: PortableTranslationTrack[];
  selectedTranslationLayerId: string | null;
};

type EditTransaction = {
  before: EditSnapshot;
  after: EditSnapshot;
};

function portableTranslationLayersByRecord(
  value: Readonly<Record<string, readonly InlineTranslationTrack[]>>,
): Record<string, PortableTranslationTrack[]> {
  return Object.fromEntries(
    Object.entries(value).map(([id, layers]) => [
      id,
      layers.map((layer) => ({
        id: layer.id,
        label: layer.label,
        start: layer.start,
        end: layer.end,
        strand: layer.strand,
        frame: layer.frame,
        translationTableId: layer.translationTableId,
        source: 'layer' as const,
        color: layer.color,
        ...(layer.needsReview ? { needsReview: true } : {}),
        ...(layer.completeCds ? { completeCds: true } : {}),
        ...(layer.featureId ? { featureId: layer.featureId } : {}),
      })),
    ]),
  );
}

// Accepted keystrokes for base editing: canonical bases + IUPAC ambiguity codes.
const DNA_EDIT_ALPHABET = 'ACGTRYSWKMBDHVN';
const RNA_EDIT_ALPHABET = 'ACGURYSWKMBDHVN';

function hasNativeTextSelection(): boolean {
  return (window.getSelection?.()?.toString() ?? '').length > 0;
}

function cleanPastedSequenceForEdit(value: string, alphabet: string): string {
  const allowed = new Set(alphabet.split(''));
  return value.toUpperCase().split('').filter((char) => allowed.has(char)).join('');
}

// Max feature-name length shown on the plasmid map before it is ellipsized, so
// an over-long name doesn't get its label dropped or shrink the whole fitted map
// for lack of room. Full names are untouched in the sequence pane, inspector,
// Features list, and exports.
const MAP_LABEL_MAX_CHARS = 14;

function compactMapFeatureLabel(name: string): string {
  const compact = name
    .replace(/\bforward\b/gi, 'fwd')
    .replace(/\breverse\b/gi, 'rev')
    .replace(/\bpromoter\b/gi, 'prom.')
    .replace(/\bprimer\b/gi, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return compact.length > MAP_LABEL_MAX_CHARS
    ? `${compact.slice(0, MAP_LABEL_MAX_CHARS - 1).trimEnd()}…`
    : compact;
}

type ArtifactRuntimeErrorBoundaryState = {
  errorMessage: string | null;
  errorCode: MotifArtifactErrorCode | null;
  recoveryStatus: string | null;
};

export class ArtifactRuntimeErrorBoundary extends Component<{ children: ReactNode }, ArtifactRuntimeErrorBoundaryState> {
  state: ArtifactRuntimeErrorBoundaryState = { errorMessage: null, errorCode: null, recoveryStatus: null };

  static getDerivedStateFromError(error: unknown): Partial<ArtifactRuntimeErrorBoundaryState> {
    return {
      errorMessage: error instanceof Error ? error.message : 'An unexpected render error occurred.',
      errorCode: error instanceof MotifArtifactRuntimeError ? error.code : null,
      recoveryStatus: null,
    };
  }

  private copyRecoveryJson = async () => {
    const snapshot = lastGoodRuntimeRecoveryPayload;
    if (!snapshot) {
      this.setState({ recoveryStatus: 'No recovery snapshot is available yet.' });
      return;
    }
    const copied = await writeTextToClipboard(JSON.stringify(snapshot));
    this.setState({
      recoveryStatus: copied
        ? 'Recovery JSON copied. Reload, then restore it from Add Entry.'
        : 'Copy was blocked. Use your browser developer tools to read window.motifGetInventory before reloading.',
    });
  };

  render() {
    if (!this.state.errorMessage) return this.props.children;
    const isPreloadFailure = this.state.errorCode === 'MOTIF_INVALID_PRELOAD';
    const hasRecoverySnapshot = !isPreloadFailure && Boolean(lastGoodRuntimeRecoveryPayload);
    return (
      <main
        className="motif-cs-shell"
        data-testid="artifact-runtime-error-shell"
        style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}
      >
        <section className="motif-cs-panel" role="alert" style={{ width: 'min(560px, 100%)', padding: 24 }}>
          <div className="motif-cs-kicker">Motif recovery</div>
          <h1>{isPreloadFailure ? 'Preloaded workspace could not be opened' : 'Workspace rendering stopped safely'}</h1>
          {isPreloadFailure ? (
            <p>
              Motif rejected the embedded data before initialization. No bundled sample data was substituted. Fix or
              regenerate the payload, then reload the artifact.
            </p>
          ) : (
            <p>
              The artifact kept the last accepted inventory separate from this failed render. Copy its recovery JSON before
              reloading, then use Add Entry to restore the database JSON.
            </p>
          )}
          <p className="motif-cs-muted">{this.state.errorMessage}</p>
          <div className="motif-cs-inline-actions">
            {!isPreloadFailure ? (
              <button
                className="motif-cs-mini-button motif-cs-mini-button-accent"
                type="button"
                disabled={!hasRecoverySnapshot}
                onClick={() => { void this.copyRecoveryJson(); }}
              >
                Copy recovery JSON
              </button>
            ) : null}
            <button className="motif-cs-mini-button" type="button" onClick={() => window.location.reload()}>
              Reload artifact
            </button>
          </div>
          <p className="motif-cs-muted" role="status" aria-live="polite">
            {this.state.recoveryStatus ?? (hasRecoverySnapshot
              ? 'A last-good recovery snapshot is ready.'
              : isPreloadFailure
                ? 'No workspace was accepted. The embedded source remains unchanged.'
                : 'No recovery snapshot is available yet.')}
          </p>
        </section>
      </main>
    );
  }
}

function App() {
  const initialWorkspaceLayout = useMemo(() => loadWorkspaceLayoutPrefs(), []);
  const initialMsaViewPreferences = useMemo(() => loadMsaViewPreferences(), []);
  const [initialWorkspace] = useState(loadInitialArtifactWorkspace);
  const [payload, setPayload] = useState(initialWorkspace.payload);
  const [selectedRecordId, setSelectedRecordId] = useState(payload.selectedRecordId);
  const payloadRef = useRef(payload);
  const selectedRecordIdRef = useRef(selectedRecordId);
  const describeSnapshotRef = useRef<RecordSummary | null>(null);
  const [hiddenEnzymesByRecord, setHiddenEnzymesByRecord] = useState<Record<string, readonly string[]>>(
    initialWorkspace.artifactState.hiddenEnzymesByRecord,
  );
  const [enzymeSourcesByRecord, setEnzymeSourcesByRecord] = useState<Record<string, readonly RestrictionEnzymeSourceId[]>>(
    initialWorkspace.artifactState.enzymeSourcesByRecord,
  );
  const [restrictionLabelsByRecord, setRestrictionLabelsByRecord] = useState<Record<string, boolean>>(
    initialWorkspace.artifactState.restrictionLabelsByRecord,
  );
  const [motifsByRecord, setMotifsByRecord] = useState<Record<string, string>>(
    initialWorkspace.artifactState.motifsByRecord,
  );
  const [mapViewportsByRecord, setMapViewportsByRecord] = useState<Record<string, MapViewport>>({});
  /* How the map is DRAWN, per record. Deliberately NOT a topology override:
     `record.topology` stays the single source of truth for what the molecule
     is, and nothing here reaches restriction finding, ORF finding, span
     normalisation or the GenBank LOCUS line. A per-view topology override was
     considered and banned before — see the "stores topology on the record so
     the UI, API, and exports agree" guard — and the distinction is the point.
     Banned: shadow state that lets the map and an export disagree about the
     molecule. This: a choice of drawing, sitting beside the zoom viewport,
     which is the other thing that changes the picture and not the science.
     Absent entry = follow the molecule, so a record whose topology is later
     converted goes back to being drawn the way it is. */
  const [mapRenderModeByRecord, setMapRenderModeByRecord] = useState<Record<string, MapMode>>({});
  const [mapRangesByRecord, setMapRangesByRecord] = useState<Record<string, MapSelectionRange | null>>({});
  const [selection, setSelection] = useState<Selection>(null);
  const [sequenceFocusRequest, requestSequenceFocus] = useReducer((count: number) => count + 1, 0);
  const [featureEditorRequest, requestFeatureEditor] = useReducer((count: number) => count + 1, 0);
  const [sequenceViewMode, setSequenceViewMode] = useState<SequenceViewMode>('detail');
  // User-added inline translation layers (from a selection). Coding features
  // (CDS/gene/…) auto-translate; these are extra translated regions the user pins
  // to the sequence. Keyed by record.
  const [translationLayersByRecord, setTranslationLayersByRecord] = useState<Record<string, InlineTranslationTrack[]>>(
    initialWorkspace.artifactState.translationLayersByRecord,
  );
  const [selectedTranslationLayerByRecord, setSelectedTranslationLayerByRecord] = useState<Record<string, string | null>>({});
  const [hiddenFeatureTranslationsByRecord, setHiddenFeatureTranslationsByRecord] = useState<Record<string, readonly string[]>>(
    initialWorkspace.artifactState.hiddenFeatureTranslationsByRecord,
  );
  // Show the antiparallel complement strand under each line (dsDNA/RNA view).
  const [showComplement, setShowComplement] = useState(false);
  // Translate-window controls: strand + frame for the current target (a selection,
  // or the whole sequence). Reset to the target's natural strand when the target
  // changes (see effect below) so the panel updates in place instead of swapping UI.
  const [translateStrand, setTranslateStrand] = useState<'sense' | 'antisense'>('sense');
  const [translateFrame, setTranslateFrame] = useState<0 | 1 | 2>(0);
  const [customEnzymes, setCustomEnzymes] = useState<RestrictionEnzyme[]>(
    initialWorkspace.artifactState.customEnzymes,
  );
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [dropState, setDropState] = useState<{ active: boolean; message: string }>({ active: false, message: '' });
  const [workbenchNotice, setWorkbenchNotice] = useState<WorkbenchNotice | null>(null);
  const workbenchNoticeTimerRef = useRef<number | null>(null);
  const [pendingDatabaseRestore, setPendingDatabaseRestore] = useState<PendingArtifactDatabaseRestore | null>(null);
  const [confirmedDatabaseRestoreCount, bumpConfirmedDatabaseRestoreCount] = useReducer((count: number) => count + 1, 0);
  const [importDefaults, setImportDefaults] = useState<ImportDefaults>({ name: '', group: '', type: 'auto', topology: 'linear' });
  const [importPanelOpen, setImportPanelOpen] = useState(false);
  const dragDepthRef = useRef(0);
  const [theme, setTheme] = useState<ArtifactThemeName>(initialWorkspaceLayout.theme);
  const [preferredPaneWidths, setPreferredPaneWidths] = useState<PaneWidths>(initialWorkspaceLayout.paneWidths);
  const [paneWidths, setPaneWidths] = useState<PaneWidths>(initialWorkspaceLayout.paneWidths);
  const [stackedPaneHeights, setStackedPaneHeights] = useState<StackedPaneHeights>(initialWorkspaceLayout.stackedPaneHeights);
  const [paneVisibility, setPaneVisibility] = useState<PaneVisibility>(initialWorkspaceLayout.paneVisibility);
  const [toolsPinned, setToolsPinned] = useState(initialWorkspaceLayout.toolsPinned);
  const [paneOrder, setPaneOrder] = useState<PaneKey[]>(initialWorkspaceLayout.paneOrder);
  const [panePlacements, setPanePlacements] = useState<PanePlacements>(initialWorkspaceLayout.panePlacements);
  const [floatingPaneRects, setFloatingPaneRects] = useState<FloatingPaneRects>(initialWorkspaceLayout.floatingPaneRects);
  const [floatingPaneZOrder, setFloatingPaneZOrder] = useState<PaneKey[]>(() => (
    DEFAULT_PANE_ORDER.filter((pane) => initialWorkspaceLayout.panePlacements[pane] === 'floating')
  ));
  const [floatingViewport, setFloatingViewport] = useState(floatingPaneViewport);
  // Translations live in a floating "dynamic window" (toggle in the top bar). Rect
  // is remembered so it reopens where the user left it; seeded to the lower-right.
  const [showTranslations, setShowTranslations] = useState(false);
  const [translationPanelOpen, setTranslationPanelOpen] = useState(false);
  const [translationsWin, setTranslationsWin] = useState<WindowRect>(defaultTranslationsWindowRect);
  const [showPrimerDesign, setShowPrimerDesign] = useState(false);
  const [primerWin, setPrimerWin] = useState<WindowRect>(defaultPrimerWindowRect);
  const [cloningPrimerRequest, setCloningPrimerRequest] = useState<ClaudeScienceCloningPrimerRequest | null>(null);
  const [cloningPrimerRecordIndex, setCloningPrimerRecordIndex] = useState(0);
  const [completedCloningPrimerActionIds, setCompletedCloningPrimerActionIds] = useState<string[]>([]);
  const [showAlignment, setShowAlignment] = useState(false);
  const [alignmentWin, setAlignmentWin] = useState<WindowRect>(defaultAlignmentWindowRect);
  const [showGel, setShowGel] = useState(false);
  const [gelWin, setGelWin] = useState<WindowRect>(defaultGelWindowRect);
  const [gelSelectedCandidateIds, setGelSelectedCandidateIds] = useState<string[]>([]);
  const [gelLadderPreset, setGelLadderPreset] = useState<ArtifactGelLadderPreset>('1kb');
  const [gelAgarosePercent, setGelAgarosePercent] = useState(1);
  const [gelWorkflowName, setGelWorkflowName] = useState('Digest gel preview');
  const [gelResultIdentity, setGelResultIdentity] = useState<ClaudeScienceGelResultIdentity>(createGelResultIdentity);
  const [gelStatus, setGelStatus] = useState('');
  const [gelError, setGelError] = useState('');
  const [gelSaved, setGelSaved] = useState(false);
  const [showAssembly, setShowAssembly] = useState(false);
  const [assemblyWin, setAssemblyWin] = useState<WindowRect>(defaultAssemblyWindowRect);
  const [assemblyInitialRecordIds, setAssemblyInitialRecordIds] = useState<string[]>([]);
  const [showCloningDesign, setShowCloningDesign] = useState(false);
  const [cloningDesignWin, setCloningDesignWin] = useState<WindowRect>(defaultCloningDesignWindowRect);
  const [cloningDesignInitialRecordIds, setCloningDesignInitialRecordIds] = useState<string[]>([]);
  const cloningDesignWorkspaceRef = useRef<ClaudeScienceCloningDesignWorkspaceHandle>(null);
  const [showConstructVerification, setShowConstructVerification] = useState(false);
  const [constructVerificationWin, setConstructVerificationWin] = useState<WindowRect>(defaultConstructVerificationWindowRect);
  const [activeAlignmentId, setActiveAlignmentId] = useState<string | null>(payload.alignments[0]?.id ?? null);
  const [msaViewPreferences, setMsaViewPreferences] = useState<ClaudeScienceMsaViewPreferences>(initialMsaViewPreferences);
  const [lockedTranslateTarget, setLockedTranslateTarget] = useState<{ recordId: string; target: TranslateTarget } | null>(null);
  const activeThemeLabel = THEME_OPTIONS.find((option) => option.id === theme)?.label ?? 'Light';
  const artifactState = useMemo<ArtifactDurableState>(() => ({
    customEnzymes: customEnzymes.map((enzyme) => ({ ...enzyme })),
    translationLayersByRecord: portableTranslationLayersByRecord(translationLayersByRecord),
    enzymeSourcesByRecord: Object.fromEntries(
      Object.entries(enzymeSourcesByRecord).map(([id, sources]) => [id, [...sources]]),
    ),
    hiddenEnzymesByRecord: Object.fromEntries(
      Object.entries(hiddenEnzymesByRecord).map(([id, hidden]) => [id, [...hidden]]),
    ),
    hiddenFeatureTranslationsByRecord: Object.fromEntries(
      Object.entries(hiddenFeatureTranslationsByRecord).map(([id, hidden]) => [id, [...hidden]]),
    ),
    restrictionLabelsByRecord: { ...restrictionLabelsByRecord },
    motifsByRecord: { ...motifsByRecord },
  }), [
    customEnzymes,
    enzymeSourcesByRecord,
    hiddenEnzymesByRecord,
    hiddenFeatureTranslationsByRecord,
    motifsByRecord,
    restrictionLabelsByRecord,
    translationLayersByRecord,
  ]);
  const artifactStateRef = useRef<ArtifactDurableState>(artifactState);
  useEffect(() => {
    artifactStateRef.current = artifactState;
  }, [artifactState]);
  const updateTranslationLayers = useCallback((
    updater: (current: Record<string, InlineTranslationTrack[]>) => Record<string, InlineTranslationTrack[]>,
  ) => {
    setTranslationLayersByRecord((current) => {
      const next = updater(current);
      if (next === current) return current;
      artifactStateRef.current = {
        ...artifactStateRef.current,
        translationLayersByRecord: portableTranslationLayersByRecord(next),
      };
      return next;
    });
  }, []);
  const currentDurableFingerprint = useMemo(
    () => artifactDurableFingerprint(payload, artifactState),
    [artifactState, payload],
  );
  const [savedDurableFingerprint, setSavedDurableFingerprint] = useState(() => currentDurableFingerprint);
  const savedDurableFingerprintRef = useRef(savedDurableFingerprint);
  const [hasSessionCheckpoint, setHasSessionCheckpoint] = useState(false);
  const hasUnsavedChanges = currentDurableFingerprint !== savedDurableFingerprint;
  const establishSessionBaseline = useCallback((fingerprint: string, hasDurableCheckpoint: boolean) => {
    savedDurableFingerprintRef.current = fingerprint;
    setSavedDurableFingerprint(fingerprint);
    setHasSessionCheckpoint(hasDurableCheckpoint);
  }, []);
  const showWorkbenchNotice = useCallback((message: string, tone: WorkbenchNotice['tone'] = 'status') => {
    if (workbenchNoticeTimerRef.current !== null) window.clearTimeout(workbenchNoticeTimerRef.current);
    setWorkbenchNotice({ message, tone });
    workbenchNoticeTimerRef.current = window.setTimeout(() => {
      workbenchNoticeTimerRef.current = null;
      setWorkbenchNotice(null);
    }, tone === 'error' ? 5_000 : 2_800);
  }, []);

  useEffect(() => () => {
    if (workbenchNoticeTimerRef.current !== null) window.clearTimeout(workbenchNoticeTimerRef.current);
  }, []);
  const paneDragRef = useRef<PaneKey | null>(null);
  const [paneDragUi, setPaneDragUi] = useState<{ dragged: PaneKey; target: PaneKey | null } | null>(null);
  const suppressPaneToggleClickRef = useRef(false);
  const recordTabsRef = useRef<HTMLElement | null>(null);
  const translationsToggleRef = useRef<HTMLButtonElement | null>(null);
  const alignmentToggleRef = useRef<HTMLElement | null>(null);
  const cloningToggleRef = useRef<HTMLElement | null>(null);
  const constructVerificationToggleRef = useRef<HTMLElement | null>(null);
  const primerToggleRef = useRef<HTMLElement | null>(null);
  const gelReturnFocusRef = useRef<HTMLElement | null>(null);
  const inventoryColumnRef = useRef<HTMLElement | null>(null);
  const sequenceColumnRef = useRef<HTMLElement | null>(null);
  const toolsInspectorRef = useRef<HTMLElement | null>(null);
  const topbarRef = useRef<HTMLElement | null>(null);
  const workspaceMainRef = useRef<HTMLElement | null>(null);
  const [topbarHeight, setTopbarHeight] = useState(38);
  const [workspaceMainSize, setWorkspaceMainSize] = useState({ width: 1280, height: 720 });
  const floatingPaneRectsRef = useRef(floatingPaneRects);
  const floatingPaneInteractionRef = useRef<{
    pane: PaneKey;
    mode: 'move' | 'resize';
    pointerId: number;
    startX: number;
    startY: number;
    base: FloatingSurfaceRect;
  } | null>(null);
  const floatingPaneInteractionCleanupRef = useRef<(() => void) | null>(null);
  const paneResizeCleanupRef = useRef<(() => void) | null>(null);
  const stackedPaneResizeCleanupRef = useRef<(() => void) | null>(null);
  const sequenceScrollByRecordRef = useRef<Record<string, number>>({});
  const mapDragRef = useRef<MapDragState | null>(null);
  const mapPointerIdRef = useRef<number | null>(null);
  const [mapPointerAction, setMapPointerAction] = useState<MapPointerAction>('range');
  // Root space: this is handed straight to zoomAtPoint, which pins a root point.
  const lastZoomAnchorRef = useRef<MapRootPoint | null>(null);
  const suppressNextBackgroundClick = useRef(false);
  const selectedRecord = payload.records.find((record) => record.id === selectedRecordId) ?? payload.records[0];
  const vector = selectedRecord ?? EMPTY_ARTIFACT_VECTOR;
  const hasActiveRecord = Boolean(selectedRecord);
  const recordNamesById = useMemo(() => Object.fromEntries(
    payload.records.map((record) => [record.id, record.name]),
  ), [payload.records]);
  const constructTraceEvidenceByRecordId = useMemo(() => {
    const evidence = new Map<string, ArtifactConstructTraceEvidence>();
    payload.records.forEach((record) => {
      const current = artifactConstructTraceEvidence(record);
      if (current) evidence.set(record.id, current);
    });
    return evidence;
  }, [payload.records]);
  const constructVerificationCandidates = useMemo(() => {
    const records: ClaudeScienceConstructVerificationRecord[] = [];
    let excludedCount = 0;
    payload.records.forEach((record) => {
      if (!record.active || record.type !== 'dna') return;
      if (record.id.length > ARTIFACT_CONSTRUCT_VERIFICATION_TEXT_LIMITS.maxIdLength) {
        excludedCount += 1;
        return;
      }
      const evidence = constructTraceEvidenceByRecordId.get(record.id);
      if (record.sangerTrace) {
        if (!evidence || evidence.baseCalls.length > ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxReadLength) {
          excludedCount += 1;
          return;
        }
      } else if (record.sequence.length > ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxReferenceLength) {
        excludedCount += 1;
        return;
      }
      records.push({
        id: record.id,
        name: boundedArtifactConstructName(record.name),
        sequence: record.sequence,
        topology: record.topology,
        sha256: sha256HexSync(record.sequence),
        ...(evidence ? {
          sangerTrace: {
            baseCalls: evidence.baseCalls,
            ...(evidence.qualityScores ? { qualityScores: evidence.qualityScores } : {}),
          },
          sangerEvidenceSha256: evidence.sha256,
        } : {}),
      });
    });
    return { records, excludedCount };
  }, [constructTraceEvidenceByRecordId, payload.records]);
  const constructVerificationRecords = constructVerificationCandidates.records;
  const constructVerificationExcludedCount = constructVerificationCandidates.excludedCount;
  const constructVerificationInitialReferenceId = useMemo(() => {
    const selected = constructVerificationRecords.find((record) => record.id === selectedRecordId);
    if (selected && !selected.sangerTrace) return selected.id;
    return constructVerificationRecords.find((record) => !record.sangerTrace)?.id
      ?? selected?.id
      ?? constructVerificationRecords[0]?.id;
  }, [constructVerificationRecords, selectedRecordId]);
  const constructVerificationReadCount = useMemo(() => constructVerificationRecords.filter(
    (record) => Boolean(record.sangerTrace),
  ).length, [constructVerificationRecords]);
  const constructVerificationReferenceCount = constructVerificationRecords.length - constructVerificationReadCount;
  const scientificFreshnessRecordIndex = useMemo(() => createScientificFreshnessRecordIndex(
    payload.records.map((record) => ({
      id: record.id,
      sequence: record.sequence,
      topology: record.topology,
      overhang5: record.overhang5,
      overhang3: record.overhang3,
      overhang5Type: record.overhang5Type,
      overhang3Type: record.overhang3Type,
      ...(constructTraceEvidenceByRecordId.get(record.id)
        ? { sangerEvidenceSha256: constructTraceEvidenceByRecordId.get(record.id)!.sha256 }
        : {}),
    })),
  ), [constructTraceEvidenceByRecordId, payload.records]);
  const workflowFreshnessByResultId = useMemo(() => evaluateWorkflowResultsFreshness(
    payload.workflowResults,
    scientificFreshnessRecordIndex,
  ), [payload.workflowResults, scientificFreshnessRecordIndex]);
  const analysisFreshnessByResultId = useMemo(() => evaluateAnalysisResultsFreshness(
    payload.analysisResults,
    scientificFreshnessRecordIndex,
  ), [payload.analysisResults, scientificFreshnessRecordIndex]);
  const alignmentFreshnessById = useMemo(() => evaluateAlignmentsFreshness(
    payload.alignments,
    scientificFreshnessRecordIndex,
  ), [payload.alignments, scientificFreshnessRecordIndex]);
  const alignmentsNeedingReview = useMemo(() => Array.from(alignmentFreshnessById.values()).filter(
    (evaluation) => evaluation.state !== 'fresh',
  ), [alignmentFreshnessById]);
  const representativeAlignmentFreshness = alignmentsNeedingReview.find((evaluation) => evaluation.state === 'stale')
    ?? alignmentsNeedingReview[0];
  const gelLaneCandidates = useMemo(() => createClaudeScienceGelLaneCandidates(
    payload.records.map((record) => ({
      id: record.id,
      name: record.name,
      type: record.type,
      topology: record.topology,
      sequence: record.sequence,
    })),
    payload.workflowResults,
    workflowFreshnessByResultId,
  ), [payload.records, payload.workflowResults, workflowFreshnessByResultId]);
  const assemblyRecords = useMemo(() => payload.records
    .filter((record) => record.active && record.type === 'dna')
    .map((record) => ({
      id: record.id,
      name: record.name,
      sequence: record.sequence,
      sha256: sha256HexSync(record.sequence),
      molecule: 'dna' as const,
      topology: record.topology,
      overhang5: record.overhang5,
      overhang3: record.overhang3,
      overhang5Type: record.overhang5Type,
      overhang3Type: record.overhang3Type,
    })), [payload.records]);
  const cloningDesignRecords = useMemo(() => payload.records
    .filter((record) => record.active && record.type === 'dna')
    .map((record) => ({
      id: record.id,
      name: record.name,
      sequence: record.sequence,
      molecule: 'dna' as const,
      sha256: sha256HexSync(record.sequence),
      group: record.group,
      tags: record.tags,
    })), [payload.records]);
  const recordId = vector.id;
  const sequence = vector.sequence;
  const cloningPrimerWorklist = useMemo(() => {
    if (!cloningPrimerRequest) return [];
    const available = new Set(payload.records.map((record) => record.id));
    return cloningPrimerRequest.actionIds.flatMap((actionId) => {
      const action = cloningPrimerRequest.plan.preparation.find((entry) => entry.id === actionId);
      if (!action) return [];
      const junction = cloningPrimerRequest.plan.kind === 'gibson_design' && action.junctionIndex !== undefined
        ? cloningPrimerRequest.plan.junctions[action.junctionIndex] ?? null
        : null;
      // For a Gibson junction, adding homology to the downstream fragment's
      // forward primer is the least surprising default. The user can still
      // navigate the underlying plan before accepting any unverified tail.
      const preferredRecordId = junction?.rightRecordId
        ?? action.recordIds.find((id) => available.has(id));
      if (!preferredRecordId || !available.has(preferredRecordId)) return [];
      return [{ action, recordId: preferredRecordId }];
    });
  }, [cloningPrimerRequest, payload.records]);
  const activeCloningPrimerItem = cloningPrimerWorklist[cloningPrimerRecordIndex] ?? null;
  const completedCloningPrimerActionCount = completedCloningPrimerActionIds.filter((id) => (
    cloningPrimerWorklist.some((item) => item.action.id === id)
  )).length;
  const cloningPrimerContext = useMemo(() => {
    if (!cloningPrimerRequest || !activeCloningPrimerItem) return null;
    const { action } = activeCloningPrimerItem;
    const input = cloningPrimerRequest.plan.inputs.find((entry) => entry.recordId === activeCloningPrimerItem.recordId);
    const orientation = input?.orientation ?? 'forward';
    if (cloningPrimerRequest.plan.kind === 'golden_gate_design') {
      const part = cloningPrimerRequest.plan.parts.find((entry) => entry.recordId === activeCloningPrimerItem.recordId);
      const leftFusion = part?.leftOverhang ?? part?.requestedLeftOverhang ?? null;
      const rightFusion = part?.rightOverhang ?? part?.requestedRightOverhang ?? null;
      const boundary = leftFusion && rightFusion
        ? `Use the reviewed ${leftFusion} → ${rightFusion} fusion boundaries.`
        : 'Choose the intended left and right fusion sites in the cloning draft before finalizing the editable 5′ tails.';
      return {
        label: action.label,
        detail: `${cloningPrimerRequest.plan.enzyme ?? 'Type IIS'} preparation · ${orientation === 'reverse' ? 'reverse complement' : 'forward'} in the assembly. ${boundary}`,
        requestSha256: cloningPrimerRequest.plan.provenance?.requestSha256 ?? '',
        actionId: action.id,
        actionKind: action.kind,
        method: cloningPrimerRequest.method,
        orientation,
        ...(cloningPrimerRequest.plan.enzyme ? { enzyme: cloningPrimerRequest.plan.enzyme } : {}),
        ...(leftFusion && rightFusion
          ? { fusionSites: { left: leftFusion, right: rightFusion } }
          : {}),
      };
    }
    const junction = action.junctionIndex === undefined
      ? null
      : cloningPrimerRequest.plan.junctions[action.junctionIndex] ?? null;
    return {
      label: action.label,
      detail: junction?.overlapSequence
        ? `Add the verified ${junction.overlapLength} bp homology ${junction.overlapSequence} at junction ${junction.index + 1} · ${orientation === 'reverse' ? 'reverse complement' : 'forward'} in the assembly.`
        : `${action.detail} This record is ${orientation === 'reverse' ? 'reverse complement' : 'forward'} in the assembly; choose the homology sequence in the cloning draft before adding a 5′ tail.`,
      requestSha256: cloningPrimerRequest.plan.provenance?.requestSha256 ?? '',
      actionId: action.id,
      actionKind: action.kind,
      method: cloningPrimerRequest.method,
      orientation,
      ...(junction ? {
        junction: {
          index: junction.index,
          leftRecordId: junction.leftRecordId,
          rightRecordId: junction.rightRecordId,
          ...(junction.overlapSequence ? { overlapSequence: junction.overlapSequence } : {}),
          ...(junction.overlapLength > 0 ? { overlapLength: junction.overlapLength } : {}),
        },
      } : {}),
    };
  }, [activeCloningPrimerItem, cloningPrimerRequest]);
  const cloningPrimerInitialTails = useMemo(() => {
    if (
      !cloningPrimerRequest
      || cloningPrimerRequest.plan.kind !== 'gibson_design'
      || !activeCloningPrimerItem
      || cloningPrimerContext?.orientation !== 'forward'
    ) return { forward: undefined, reverse: undefined };
    const junction = activeCloningPrimerItem.action.junctionIndex === undefined
      ? null
      : cloningPrimerRequest.plan.junctions[activeCloningPrimerItem.action.junctionIndex] ?? null;
    if (!junction?.overlapSequence) return { forward: undefined, reverse: undefined };
    if (activeCloningPrimerItem.recordId === junction.rightRecordId) {
      return { forward: junction.overlapSequence, reverse: undefined };
    }
    if (activeCloningPrimerItem.recordId === junction.leftRecordId) {
      return { forward: undefined, reverse: reverseComplement(junction.overlapSequence) };
    }
    return { forward: undefined, reverse: undefined };
  }, [activeCloningPrimerItem, cloningPrimerContext?.orientation, cloningPrimerRequest]);
  const activeRecordSha256 = useMemo(
    () => hasActiveRecord ? sha256HexSync(vector.sequence) : undefined,
    [hasActiveRecord, vector.sequence],
  );
  const usesLargeSequenceViewer = hasActiveRecord && sequence.length > LARGE_SEQUENCE_DETAIL_THRESHOLD;
  const effectiveSequenceViewMode: SequenceViewMode = usesLargeSequenceViewer ? 'standard' : sequenceViewMode;
  const topology = vector.topology;
  const sequenceType = vector.type;
  const features = vector.features ?? emptyFeatures;
  const enzymeSources = enzymeSourcesByRecord[recordId] ?? DEFAULT_ENZYME_SOURCES;
  const activeEnzymeSourcesRef = useRef<readonly RestrictionEnzymeSourceId[]>(enzymeSources);
  const enzymeSourcesByRecordRef = useRef<Record<string, readonly RestrictionEnzymeSourceId[]>>(enzymeSourcesByRecord);
  const customEnzymesRef = useRef<readonly RestrictionEnzyme[]>(customEnzymes);
  const lastVisibleEnzymeSourcesRef = useRef<Record<string, RestrictionEnzymeSourceId[]>>({});

  const describeRuntimePayloadSnapshot = useCallback((
    nextPayload: LoadedPayload,
    nextSelectedRecordId: string | null,
    restrictionSourcesOverride?: readonly RestrictionEnzymeSourceId[],
  ) => {
    const activeRecord = nextPayload.records.find((record) => record.id === nextSelectedRecordId) ?? nextPayload.records[0];
    if (!activeRecord) return null;
    const sources = restrictionSourcesOverride
      ?? enzymeSourcesByRecordRef.current[activeRecord.id]
      ?? DEFAULT_ENZYME_SOURCES;
    return describePayloadSnapshot(nextPayload, activeRecord.id, sources, customEnzymesRef.current);
  }, []);

  const rememberActiveSequenceScroll = useCallback(() => {
    const activeRecordId = selectedRecordIdRef.current;
    const sequenceElement = document.querySelector<HTMLElement>('.motif-cs-sequence');
    if (activeRecordId && sequenceElement) {
      sequenceScrollByRecordRef.current[activeRecordId] = effectiveSequenceScroller(sequenceElement).scrollTop;
    }
  }, []);

  const selectRecord = useCallback((nextRecordId: string) => {
    rememberActiveSequenceScroll();
    setSelection(null);
    const current = payloadRef.current;
    if (current.selectedRecordId !== nextRecordId) {
      const nextPayload = { ...current, selectedRecordId: nextRecordId };
      payloadRef.current = nextPayload;
      setPayload(nextPayload);
    }
    selectedRecordIdRef.current = nextRecordId;
    setSelectedRecordId(nextRecordId);
  }, [rememberActiveSequenceScroll]);

  const handleRecordTabKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const lastIndex = payload.records.length - 1;
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? lastIndex
        : event.key === 'ArrowRight'
          ? (index + 1) % payload.records.length
          : (index - 1 + payload.records.length) % payload.records.length;
    const nextRecord = payload.records[nextIndex];
    if (!nextRecord) return;
    selectRecord(nextRecord.id);
    window.requestAnimationFrame(() => {
      recordTabsRef.current
        ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
        .item(nextIndex)
        .focus({ preventScroll: true });
    });
  }, [payload.records, selectRecord]);

  useLayoutEffect(() => {
    const sequenceElement = document.querySelector<HTMLElement>('.motif-cs-sequence');
    if (!sequenceElement) return;
    effectiveSequenceScroller(sequenceElement).scrollTop = sequenceScrollByRecordRef.current[recordId] ?? 0;
  }, [recordId]);

  useEffect(() => {
    activeEnzymeSourcesRef.current = enzymeSources;
  }, [enzymeSources]);

  useEffect(() => {
    enzymeSourcesByRecordRef.current = enzymeSourcesByRecord;
  }, [enzymeSourcesByRecord]);

  useEffect(() => {
    customEnzymesRef.current = customEnzymes;
  }, [customEnzymes]);

  useEffect(() => {
    const tabs = recordTabsRef.current;
    const activeTab = tabs?.querySelector<HTMLElement>('.motif-cs-record-tab[data-active="true"]');
    if (!tabs || !activeTab || tabs.clientWidth === 0) return;

    const viewportLeft = tabs.scrollLeft;
    const viewportRight = viewportLeft + tabs.clientWidth;
    const tabLeft = activeTab.offsetLeft;
    const tabRight = tabLeft + activeTab.offsetWidth;
    if (tabLeft < viewportLeft) tabs.scrollTo({ left: tabLeft, behavior: 'auto' });
    else if (tabRight > viewportRight) tabs.scrollTo({ left: tabRight - tabs.clientWidth, behavior: 'auto' });
  }, [recordId]);
  const scanEnzymes = useMemo(() => {
    return restrictionEnzymesForSources(enzymeSources, customEnzymes);
  }, [customEnzymes, enzymeSources]);
  const restrictionSites = useMemo(
    () => scanRestrictionSitesForRecord(vector, scanEnzymes),
    [vector, scanEnzymes],
  );
  const enzymeNames = useMemo(() => {
    const names = new Set<string>();
    for (const site of restrictionSites) names.add(site.enzyme);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [restrictionSites]);
  const hiddenEnzymes = useMemo(
    () => new Set(hiddenEnzymesByRecord[recordId] ?? []),
    [hiddenEnzymesByRecord, recordId],
  );
  const digestEnzymeCatalog = useMemo(
    () => restrictionEnzymesForSources(['all'], customEnzymes),
    [customEnzymes],
  );
  const visibleMapEnzymes = useMemo(
    () => scanEnzymes.filter((enzyme) => !hiddenEnzymes.has(enzyme.name)),
    [hiddenEnzymes, scanEnzymes],
  );
  const visibleRestrictionSites = useMemo(
    () => restrictionSites.filter((site) => !hiddenEnzymes.has(site.enzyme)),
    [hiddenEnzymes, restrictionSites],
  );
  const { ref: mapFrameRef, size: mapSize } = useElementSize();
  const mapColumnRef = useRef<HTMLElement | null>(null);
  // Labels default ON, with no site-count pre-gate. The layout engine already
  // bounds the label ink two ways — display.maxRestrictionLabels caps how many
  // clusters are even candidates, and the radial packer culls whatever will not
  // fit the ring — and it reports the remainder through the "+N more sites" chip.
  // Deciding up front from the raw SITE count skipped all of that: it is the
  // wrong quantity (labels are per CLUSTER, and clusters stay in the 6-39 range
  // while sites run 26-695) and it is all-or-nothing where the engine is graded.
  // Past the threshold a map drew every tick and named none of them, and because
  // labels-off also zeroes the unlabelled count, the chip that would have said so
  // never appeared. Measured across the bundled vectors at 240px-1000px and with
  // both the default and the full enzyme list, letting the packer run yields
  // 4-24 names per map with no collisions, so there was nothing to protect.
  const showRestrictionLabels = restrictionLabelsByRecord[recordId] ?? true;
  const canToggleTopology = hasActiveRecord && (sequenceType === 'dna' || sequenceType === 'rna');
  /* Follows the molecule until someone asks for a different drawing. Protein is
     forced linear here for the same reason computeMapLayout forces it: there is
     no ring to draw. `canDrawAsRing` is what gates the control, so a genuinely
     linear record is not offered a circular drawing of a molecule that has two
     ends. */
  const canDrawAsRing = hasActiveRecord && sequenceType !== 'protein' && topology === 'circular';
  const mapRenderMode: MapMode = sequenceType === 'protein'
    ? 'linear'
    : mapRenderModeByRecord[recordId] ?? mapModeForBlock(topology, sequenceType);
  const setMapRenderMode = useCallback((mode: MapMode) => {
    setMapRenderModeByRecord((current) => (current[recordId] === mode ? current : { ...current, [recordId]: mode }));
  }, [recordId]);
  const mapViewport = mapViewportsByRecord[recordId] ?? DEFAULT_MAP_VIEWPORT;
  const selectedMapRange = mapRangesByRecord[recordId] ?? null;
  const motif = motifsByRecord[recordId] ?? defaultMotifForRecord(sequenceType, payload.defaultMotif);
  const motifHits = useMemo(() => findMotifHits(sequence, motif, sequenceType, topology), [sequence, motif, sequenceType, topology]);
  const cleanedMotifLength = cleanMotif(motif, sequenceType).length;
  const translationLayers = translationLayersByRecord[recordId] ?? emptyTracks;
  const selectedTranslationLayerId = selectedTranslationLayerByRecord[recordId] ?? null;
  const hiddenFeatureTranslationIds = useMemo(
    () => new Set(hiddenFeatureTranslationsByRecord[recordId] ?? []),
    [hiddenFeatureTranslationsByRecord, recordId],
  );
  // Inline amino-acid tracks aligned to the bases: coding-feature translations
  // (auto, "already part of the sequence") + user-pinned layers. NOT a whole-entry
  // frame. Empty for protein/non-nucleotide records; feature AA tracks appear by
  // default and can be removed individually, without a noisy global "AA Off" mode.
  const inlineTranslationTracks = useMemo<readonly InlineTranslationTrack[]>(() => {
    if (!isNucleotideType(sequenceType)) return emptyTracks;
    const fromFeatures: InlineTranslationTrack[] = features
      .filter((feature) => (
        CODING_FEATURE_TYPES.has(feature.type)
        && (feature.strand === 1 || feature.strand === -1)
        && featureLocationLength(feature) >= 3
        && !isMultipartFeature(feature)
        && !hiddenFeatureTranslationIds.has(`feat:${feature.id}`)
      ))
      .flatMap((feature) => {
        const code = resolveArtifactTranslationCode(
          vector.translationTableId,
          TRANSLATION_CODE_FEATURE_TYPES.has(feature.type) ? feature.metadata : undefined,
        );
        if (!code.supported) return [];
        return [{
          id: `feat:${feature.id}`,
          label: feature.name,
          start: feature.start,
          end: feature.end,
          strand: feature.strand === -1 ? -1 : 1,
          frame: codonStartFrame(feature.metadata),
          translationTableId: code.id,
          source: 'feature' as const,
          color: feature.color,
          completeCds: isCompleteCodingFeature(feature),
          featureId: feature.id,
        }];
      });
    return translationLayers.length > 0 ? [...fromFeatures, ...translationLayers] : fromFeatures;
  }, [sequenceType, features, hiddenFeatureTranslationIds, translationLayers, vector.translationTableId]);
  const selectedInlineTranslationTrack = inlineTranslationTracks.find((track) => track.id === selectedTranslationLayerId) ?? null;
  const selectedTranslationLayer = selectedInlineTranslationTrack?.source === 'layer' ? selectedInlineTranslationTrack : null;
  const selectedPinnedLayerNeedsReview = !!selectedTranslationLayer?.needsReview;
  useEffect(() => {
    if (!selectedTranslationLayerId) return;
    if (inlineTranslationTracks.some((track) => track.id === selectedTranslationLayerId)) return;
    setSelectedTranslationLayerByRecord((current) => (
      current[recordId] ? { ...current, [recordId]: null } : current
    ));
  }, [inlineTranslationTracks, recordId, selectedTranslationLayerId]);
  const mapTheme = mapThemeForArtifactTheme(theme);

  const isEditable = hasActiveRecord && (sequenceType === 'dna' || sequenceType === 'rna');
  const isSequenceEditable = isEditable && !usesLargeSequenceViewer;
  const isNucleotideRecord = hasActiveRecord && isNucleotideType(sequenceType);
  const isDnaRecord = hasActiveRecord && sequenceType === 'dna';
  const mapPaneTitle = sequenceType === 'protein'
    ? 'Protein Map'
    : topology === 'circular'
      ? 'Plasmid Map'
      : sequenceType === 'rna'
        ? 'RNA Map'
        : 'Sequence Map';
  const restrictionVisibilityMeta = isDnaRecord
    ? {
      full: `${visibleRestrictionSites.length}/${restrictionSites.length} sites · ${scanEnzymes.length} enzymes`,
      compact: `${visibleRestrictionSites.length}/${restrictionSites.length} · ${scanEnzymes.length} enz`,
    }
    : hasActiveRecord
      ? { full: 'DNA restriction only', compact: 'DNA only' }
      : { full: 'no active record', compact: 'empty' };
  const [caret, setCaret] = useState<number | null>(null);
  const [insertMode, setInsertMode] = useState(false);
  const editHistoryRef = useRef<Record<string, { undo: EditTransaction[]; redo: EditTransaction[] }>>({});
  const [, bumpEditHistory] = useReducer((tick: number) => tick + 1, 0);
  const canUndo = (editHistoryRef.current[recordId]?.undo.length ?? 0) > 0;
  const canRedo = (editHistoryRef.current[recordId]?.redo.length ?? 0) > 0;

  const resetWorkspaceViewState = useCallback(() => {
    setSelection(null);
    setCaret(null);
    setLockedTranslateTarget(null);
    setTranslateStrand('sense');
    setTranslateFrame(0);
    setMapViewportsByRecord({});
    setMapRangesByRecord({});
    setSelectedTranslationLayerByRecord({});
    sequenceScrollByRecordRef.current = {};
    editHistoryRef.current = {};
    bumpEditHistory();
  }, []);

  const resetRecordTransientState = useCallback(() => {
    resetWorkspaceViewState();
    setHiddenEnzymesByRecord({});
    setEnzymeSourcesByRecord({});
    enzymeSourcesByRecordRef.current = {};
    setRestrictionLabelsByRecord({});
    setMotifsByRecord({});
    setTranslationLayersByRecord({});
    setHiddenFeatureTranslationsByRecord({});
    activeEnzymeSourcesRef.current = DEFAULT_ENZYME_SOURCES;
  }, [resetWorkspaceViewState]);

  const resetWorkflowWindowState = useCallback(() => {
    setShowPrimerDesign(false);
    setShowGel(false);
    setGelSelectedCandidateIds([]);
    setGelLadderPreset('1kb');
    setGelAgarosePercent(1);
    setGelWorkflowName('Digest gel preview');
    setGelResultIdentity(createGelResultIdentity());
    setGelStatus('');
    setGelError('');
    setGelSaved(false);
    setShowAssembly(false);
    setAssemblyInitialRecordIds([]);
    setShowCloningDesign(false);
    setCloningDesignInitialRecordIds([]);
    setShowConstructVerification(false);
  }, []);

  const clearWorkspaceData = useCallback(() => {
    const current = payloadRef.current;
    const nextPayload: LoadedPayload = {
      ...current,
      schema: DEFAULT_SCHEMA,
      inventory: {
        ...current.inventory,
        updatedAt: new Date().toISOString(),
      },
      records: [],
      selectedRecordId: 'record-1',
      alignments: [],
      notes: [],
      workflowResults: [],
      analysisResults: [],
      analysisAssets: [],
    };
    resetRecordTransientState();
    customEnzymesRef.current = [];
    artifactStateRef.current = normalizeArtifactDurableState(undefined, new Map());
    setCustomEnzymes([]);
    payloadRef.current = nextPayload;
    selectedRecordIdRef.current = nextPayload.selectedRecordId;
    setSelectedRecordId(nextPayload.selectedRecordId);
    setPayload(nextPayload);
    setShowAlignment(false);
    setShowTranslations(false);
    resetWorkflowWindowState();
    setHasSessionCheckpoint(false);
  }, [resetRecordTransientState, resetWorkflowWindowState]);

  const applyArtifactDatabaseRestore = useCallback((
    restored: PreparedArtifactDatabaseRestore,
    sourceLabel = 'Database JSON',
    durability: 'durable-checkpoint' | 'session-hydration' = 'durable-checkpoint',
  ): number => {
    const restoredSelectedRecord = restored.payload.records.find(
      (record) => record.id === restored.payload.selectedRecordId,
    ) ?? restored.payload.records[0];
    const restoredSources = restoredSelectedRecord
      ? restored.artifactState.enzymeSourcesByRecord[restoredSelectedRecord.id] ?? DEFAULT_ENZYME_SOURCES
      : DEFAULT_ENZYME_SOURCES;

    rememberActiveSequenceScroll();
    resetRecordTransientState();
    payloadRef.current = restored.payload;
    selectedRecordIdRef.current = restored.payload.selectedRecordId;
    enzymeSourcesByRecordRef.current = restored.artifactState.enzymeSourcesByRecord;
    customEnzymesRef.current = restored.artifactState.customEnzymes;
    activeEnzymeSourcesRef.current = restoredSources;
    artifactStateRef.current = restored.artifactState;
    setPayload(restored.payload);
    setSelectedRecordId(restored.payload.selectedRecordId);
    setCustomEnzymes(restored.artifactState.customEnzymes);
    setTranslationLayersByRecord(restored.artifactState.translationLayersByRecord);
    setEnzymeSourcesByRecord(restored.artifactState.enzymeSourcesByRecord);
    setHiddenEnzymesByRecord(restored.artifactState.hiddenEnzymesByRecord);
    setHiddenFeatureTranslationsByRecord(restored.artifactState.hiddenFeatureTranslationsByRecord);
    setRestrictionLabelsByRecord(restored.artifactState.restrictionLabelsByRecord);
    setMotifsByRecord(restored.artifactState.motifsByRecord);
    setShowComplement(false);
    setShowTranslations(false);
    setShowAlignment(false);
    resetWorkflowWindowState();
    setSequenceViewMode(
      (restoredSelectedRecord?.sequence.length ?? 0) > LARGE_SEQUENCE_DETAIL_THRESHOLD
        ? 'standard'
        : 'detail',
    );
    setCopyStatus(null);
    describeSnapshotRef.current = describeRuntimePayloadSnapshot(
      restored.payload,
      restored.payload.selectedRecordId,
      restoredSources,
    );
    establishSessionBaseline(
      artifactDurableFingerprint(restored.payload, restored.artifactState),
      durability === 'durable-checkpoint',
    );
    const count = restored.payload.records.length;
    setDropState({
      active: true,
      message: `${sourceLabel} restored · ${count} record${count === 1 ? '' : 's'}`,
    });
    window.setTimeout(() => setDropState({ active: false, message: '' }), 2200);
    return count;
  }, [describeRuntimePayloadSnapshot, establishSessionBaseline, rememberActiveSequenceScroll, resetRecordTransientState, resetWorkflowWindowState]);

  const requestArtifactDatabaseRestore = useCallback((
    rawDatabase: Record<string, unknown>,
    sourceLabel = 'Database JSON',
    requestedReturnFocus: HTMLElement | null = null,
    durability: 'durable-checkpoint' | 'session-hydration' = 'session-hydration',
  ): number => {
    // Fully validate and normalize both halves before showing the destructive
    // confirmation. Confirming therefore performs one prepared, transactional
    // replacement; cancelling leaves the current workspace byte-for-byte intact.
    const prepared = prepareArtifactDatabaseRestore(rawDatabase, selectedRecordIdRef.current);
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const importTrigger = document.querySelector<HTMLButtonElement>('.motif-cs-add-entry-button');
    // Add / restore lives inside a details element that closes while the modal is
    // open, and WebKit on macOS does not focus a button merely because it was
    // clicked. The persistent Add Entry trigger is therefore the deterministic
    // return target for both paste and file-drop restore requests.
    const returnFocus = requestedReturnFocus
      ?? (activeElement && activeElement !== document.body ? activeElement : null)
      ?? importTrigger;
    setDropState({ active: false, message: '' });
    setImportPanelOpen(false);
    setPendingDatabaseRestore({
      prepared,
      sourceLabel,
      durability,
      returnFocus,
    });
    return prepared.payload.records.length;
  }, []);

  const cancelArtifactDatabaseRestore = useCallback(() => {
    const returnFocus = pendingDatabaseRestore?.returnFocus;
    setPendingDatabaseRestore(null);
    // WebKit assigns fallback focus to the newly exposed tabpanel while removing
    // the dialog. A task queued after the React commit reliably runs after that
    // browser cleanup, whereas a same-frame focus can be overwritten.
    window.setTimeout(() => {
      const owningTool = returnFocus?.closest<HTMLDetailsElement>('details[data-rail-tool]');
      if (owningTool && !owningTool.open) owningTool.open = true;
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        const returnTargetIsVisible = Boolean(
          returnFocus?.isConnected
          && returnFocus.getClientRects().length > 0
          && !returnFocus.closest('details:not([open]), [hidden]'),
        );
        if (returnTargetIsVisible) returnFocus?.focus({ preventScroll: true });
        else document.querySelector<HTMLButtonElement>('.motif-cs-add-entry-button')?.focus({ preventScroll: true });
      }));
    }, 0);
  }, [pendingDatabaseRestore]);

  const confirmArtifactDatabaseRestore = useCallback(() => {
    if (!pendingDatabaseRestore) return;
    const { prepared, sourceLabel, durability } = pendingDatabaseRestore;
    setPendingDatabaseRestore(null);
    applyArtifactDatabaseRestore(prepared, sourceLabel, durability);
    bumpConfirmedDatabaseRestoreCount();
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('.motif-cs-record-tab[data-active="true"]')?.focus({ preventScroll: true });
    });
  }, [applyArtifactDatabaseRestore, pendingDatabaseRestore]);

  const removeRecords = useCallback((recordIdOrIds: string | string[]): number => {
    const ids = Array.from(new Set(Array.isArray(recordIdOrIds) ? recordIdOrIds : [recordIdOrIds]));
    if (ids.length === 0) return 0;
    const current = payloadRef.current;
    const knownIds = new Set(current.records.map((record) => record.id));
    const missing = ids.filter((id) => !knownIds.has(id));
    if (missing.length > 0) {
      throw new MotifArtifactRuntimeError(
        'MOTIF_INVALID_WORKSPACE_INPUT',
        `Unknown record id${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}. No records were removed.`,
        { operation: 'motifRemoveRecords', inputCount: ids.length, mutated: false },
      );
    }

    const removed = new Set(ids);
    const firstRemovedIndex = current.records.findIndex((record) => removed.has(record.id));
    const records = current.records.filter((record) => !removed.has(record.id));
    const alignments = current.alignments.filter((alignment) => (
      !alignment.rows.some((row) => row.sourceRecordId && removed.has(row.sourceRecordId))
    ));
    const notes = current.notes.filter((note) => !note.recordId || !removed.has(note.recordId));
    const workflowResults = current.workflowResults.filter((result) => (
      !result.inputRecordIds.some((id) => removed.has(id))
      && !result.outputRecordIds.some((id) => removed.has(id))
    ));
    let analysisWorkspace = {
      analysisResults: current.analysisResults,
      analysisAssets: current.analysisAssets,
    };
    for (const id of removed) {
      analysisWorkspace = removeArtifactAnalysisResultsForRecord(analysisWorkspace, id, { removeOrphanAssets: true });
    }
    const currentSelectedRecordId = selectedRecordIdRef.current;
    const selectedRecordId = records.some((record) => record.id === currentSelectedRecordId)
      ? currentSelectedRecordId
      : records[Math.min(Math.max(firstRemovedIndex, 0), records.length - 1)]?.id ?? 'record-1';
    const nextPayload: LoadedPayload = {
      ...current,
      records,
      alignments,
      notes,
      workflowResults,
      ...analysisWorkspace,
      selectedRecordId,
    };
    const nextArtifactState = normalizeArtifactDurableState(
      artifactStateRef.current,
      new Map(records.map((record) => [record.id, record.sequence.length])),
    );
    artifactStateRef.current = nextArtifactState;
    enzymeSourcesByRecordRef.current = nextArtifactState.enzymeSourcesByRecord;
    setTranslationLayersByRecord(nextArtifactState.translationLayersByRecord);
    setEnzymeSourcesByRecord(nextArtifactState.enzymeSourcesByRecord);
    setHiddenEnzymesByRecord(nextArtifactState.hiddenEnzymesByRecord);
    setHiddenFeatureTranslationsByRecord(nextArtifactState.hiddenFeatureTranslationsByRecord);
    setRestrictionLabelsByRecord(nextArtifactState.restrictionLabelsByRecord);
    setMotifsByRecord(nextArtifactState.motifsByRecord);
    setSelectedTranslationLayerByRecord((value) => omitRecordState(value, removed));
    setMapViewportsByRecord((value) => omitRecordState(value, removed));
    setMapRangesByRecord((value) => omitRecordState(value, removed));
    for (const id of removed) {
      delete sequenceScrollByRecordRef.current[id];
      delete editHistoryRef.current[id];
      delete lastVisibleEnzymeSourcesRef.current[id];
    }
    bumpEditHistory();
    payloadRef.current = nextPayload;
    selectedRecordIdRef.current = selectedRecordId;
    setSelectedRecordId(selectedRecordId);
    setPayload(nextPayload);
    setSelection(null);
    setCaret(null);
    setLockedTranslateTarget(null);
    resetWorkflowWindowState();
    return ids.length;
  }, [resetWorkflowWindowState]);

  useEffect(() => {
    payloadRef.current = payload;
    rememberLastGoodRuntimePayload(payload, artifactState);
  }, [artifactState, payload]);

  useEffect(() => {
    setActiveAlignmentId((current) => (
      current && payload.alignments.some((alignment) => alignment.id === current)
        ? current
        : payload.alignments[0]?.id ?? null
    ));
  }, [payload.alignments]);

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;
    const warnBeforeReload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeReload);
    return () => window.removeEventListener('beforeunload', warnBeforeReload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    selectedRecordIdRef.current = selectedRecordId;
  }, [selectedRecordId]);

  useLayoutEffect(() => {
    applyArtifactTheme(theme);
  }, [theme]);

  // Reset transient selection state when switching records; feature ids can repeat
  // across imported records, so selections must not leak between entries.
  useEffect(() => {
    setSelection(null);
    setCaret(null);
    setLockedTranslateTarget(null);
  }, [recordId]);

  useEffect(() => {
    if (!isEditable) {
      setShowTranslations(false);
      setShowPrimerDesign(false);
    }
  }, [isEditable]);

  useEffect(() => {
    if (!showPrimerDesign) {
      setCloningPrimerRequest(null);
      setCloningPrimerRecordIndex(0);
      setCompletedCloningPrimerActionIds([]);
    }
  }, [showPrimerDesign]);

  useEffect(() => {
    window.motifRenderInventory = (entriesOrPayload) => {
      const prepared = prepareRecordsOnlyWorkspaceReplacement(
        payloadRef.current,
        artifactStateRef.current,
        entriesOrPayload,
        selectedRecordIdRef.current,
      );
      const nextPayload = prepared.payload;
      const nextSources = prepared.artifactState.enzymeSourcesByRecord[nextPayload.selectedRecordId]
        ?? DEFAULT_ENZYME_SOURCES;
      rememberActiveSequenceScroll();
      resetWorkspaceViewState();
      payloadRef.current = nextPayload;
      selectedRecordIdRef.current = nextPayload.selectedRecordId;
      artifactStateRef.current = prepared.artifactState;
      enzymeSourcesByRecordRef.current = prepared.artifactState.enzymeSourcesByRecord;
      customEnzymesRef.current = prepared.artifactState.customEnzymes;
      activeEnzymeSourcesRef.current = nextSources;
      describeSnapshotRef.current = describeRuntimePayloadSnapshot(
        nextPayload,
        nextPayload.selectedRecordId,
        nextSources,
      );
      setSelectedRecordId(nextPayload.selectedRecordId);
      setPayload(nextPayload);
      resetWorkflowWindowState();
    };
    // Append helper — the safe way to add sequences without clobbering what's
    // already loaded (motifRenderInventory REPLACES the whole inventory). It
    // normalizes before returning, so the number is the actual added count and
    // motifGetInventory()/motifGetActiveRecord() can verify synchronously.
    window.motifAddRecords = (recordOrRecords) => {
      const raw = Array.isArray(recordOrRecords) ? recordOrRecords : [recordOrRecords];
      if (raw.length === 0) return 0;
      validateRuntimeRecordInputs(raw, 'motifAddRecords');
      const currentPayload = payloadRef.current;
      if (currentPayload.records.length + raw.length > MOTIF_MAX_RECORDS) {
        throw new MotifArtifactRuntimeError(
          'MOTIF_INPUT_LIMIT_EXCEEDED',
          `motifAddRecords would exceed the ${MOTIF_MAX_RECORDS}-record artifact limit. No records were added.`,
          {
            operation: 'motifAddRecords',
            inputCount: raw.length,
            issues: [{
              index: -1,
              code: 'resource_limit',
              path: 'records',
              message: `Inventory cannot contain more than ${MOTIF_MAX_RECORDS} records`,
            }],
            mutated: false,
          },
        );
      }
      const stamp = Date.now();
      const additions: ArtifactVector[] = [];
      raw.forEach((record, index) => {
        // Ensure every addition has a stable id so we can focus the first new one
        // (records without an id would otherwise get an unpredictable generated id).
        const withId = record.id ? record : { ...record, id: `motif-added-${stamp}-${index}` };
        const normalized = normalizeRecord(withId, currentPayload.records.length + additions.length);
        if (!normalized) return;
        const id = uniqueRecordId(normalized.id, [...currentPayload.records, ...additions], !!record.id);
        additions.push({ ...normalized, id, default: false });
      });
      if (additions.length === 0) return 0;
      const traceSampleEntries = [...currentPayload.records, ...additions].reduce((total, record) => (
        total + (record.sangerTrace ? artifactSangerTraceSampleEntries(record.sangerTrace) : 0)
      ), 0);
      if (traceSampleEntries > ARTIFACT_SANGER_MAX_WORKSPACE_SAMPLE_ENTRIES) {
        throw new MotifArtifactRuntimeError(
          'MOTIF_INPUT_LIMIT_EXCEEDED',
          `motifAddRecords would exceed the ${ARTIFACT_SANGER_MAX_WORKSPACE_SAMPLE_ENTRIES.toLocaleString()}-sample workspace trace limit. No records were added.`,
          {
            operation: 'motifAddRecords',
            inputCount: raw.length,
            issues: [{
              index: -1,
              code: 'resource_limit',
              path: 'records.sangerTrace.channels',
              message: `Workspace traces cannot contain more than ${ARTIFACT_SANGER_MAX_WORKSPACE_SAMPLE_ENTRIES.toLocaleString()} channel sample entries in total`,
            }],
            mutated: false,
          },
        );
      }
      const nextPayload: LoadedPayload = {
        ...currentPayload,
        records: [...currentPayload.records, ...additions],
        selectedRecordId: additions[0].id,
      };
      rememberActiveSequenceScroll();
      setSelection(null);
      payloadRef.current = nextPayload;
      selectedRecordIdRef.current = nextPayload.selectedRecordId;
      activeEnzymeSourcesRef.current = DEFAULT_ENZYME_SOURCES;
      describeSnapshotRef.current = describeRuntimePayloadSnapshot(nextPayload, nextPayload.selectedRecordId);
      setSelectedRecordId(nextPayload.selectedRecordId);
      setPayload(nextPayload);
      return additions.length;
    };
    window.motifGetInventory = () => createDefensiveRuntimeSnapshot(payloadRef.current.records);
    window.motifGetActiveRecord = () => {
      const currentPayload = payloadRef.current;
      const activeRecord = currentPayload.records.find((record) => record.id === selectedRecordIdRef.current) ?? currentPayload.records[0];
      return activeRecord ? serializeRecord(activeRecord) : null;
    };
    window.motifAddAlignments = (alignmentOrAlignments) => {
      const raw = Array.isArray(alignmentOrAlignments) ? alignmentOrAlignments : [alignmentOrAlignments];
      if (raw.length === 0) return 0;
      const currentPayload = payloadRef.current;
      try {
        const staged = raw.map((candidate, index) => {
          if (!isPlainObject(candidate)) return candidate;
          const requested = typeof candidate.id === 'string' ? candidate.id : `alignment-${Date.now()}-${index + 1}`;
          return { ...candidate, id: uniqueAlignmentId(requested, currentPayload.alignments) };
        });
        const nextAlignments = normalizeArtifactAlignments([
          ...currentPayload.alignments.map(serializeArtifactAlignment),
          ...staged,
        ]);
        const nextPayload: LoadedPayload = { ...currentPayload, alignments: nextAlignments };
        payloadRef.current = nextPayload;
        setPayload(nextPayload);
        setShowTranslations(false);
        setShowConstructVerification(false);
        setShowAlignment(true);
        return raw.length;
      } catch (caught) {
        throw new MotifArtifactRuntimeError(
          caught instanceof ArtifactAlignmentError && caught.code === 'too_large'
            ? 'MOTIF_INPUT_LIMIT_EXCEEDED'
            : 'MOTIF_INVALID_ALIGNMENT_INPUT',
          caught instanceof Error ? caught.message : 'The alignment payload is invalid.',
          { operation: 'motifAddAlignments', inputCount: raw.length, mutated: false },
        );
      }
    };
    window.motifGetAlignments = () => payloadRef.current.alignments.map(serializeArtifactAlignment);
    window.motifAddNotes = (noteOrNotes) => {
      const raw = Array.isArray(noteOrNotes) ? noteOrNotes : [noteOrNotes];
      if (raw.length === 0) return 0;
      const current = payloadRef.current;
      const context = { recordLengths: new Map(current.records.map((record) => [record.id, record.sequence.length])) };
      try {
        let nextNotes = current.notes;
        for (const note of raw) nextNotes = addArtifactNote(nextNotes, note, context);
        const nextPayload: LoadedPayload = { ...current, notes: nextNotes };
        payloadRef.current = nextPayload;
        setPayload(nextPayload);
        return raw.length;
      } catch (cause) {
        throw new MotifArtifactRuntimeError(
          'MOTIF_INVALID_WORKSPACE_INPUT',
          cause instanceof Error ? cause.message : 'The note payload is invalid.',
          { operation: 'motifAddNotes', inputCount: raw.length, mutated: false },
        );
      }
    };
    window.motifGetNotes = () => {
      const current = payloadRef.current;
      return getArtifactNotesSnapshot(current.notes, {
        recordLengths: new Map(current.records.map((record) => [record.id, record.sequence.length])),
      });
    };
    window.motifUpdateNote = (noteId, patch) => {
      const current = payloadRef.current;
      const context = { recordLengths: new Map(current.records.map((record) => [record.id, record.sequence.length])) };
      try {
        const nextNotes = updateArtifactNote(current.notes, noteId, patch, context);
        const updated = nextNotes.find((note) => note.id === noteId);
        if (!updated) throw new Error(`Note "${noteId}" does not exist.`);
        const nextPayload: LoadedPayload = { ...current, notes: nextNotes };
        payloadRef.current = nextPayload;
        setPayload(nextPayload);
        return updated;
      } catch (cause) {
        throw new MotifArtifactRuntimeError(
          'MOTIF_INVALID_WORKSPACE_INPUT',
          cause instanceof Error ? cause.message : 'The note update is invalid.',
          { operation: 'motifUpdateNote', noteId, mutated: false },
        );
      }
    };
    window.motifRemoveNotes = (noteIdOrIds) => {
      const ids = Array.from(new Set(Array.isArray(noteIdOrIds) ? noteIdOrIds : [noteIdOrIds]));
      if (ids.length === 0) return 0;
      const current = payloadRef.current;
      const context = { recordLengths: new Map(current.records.map((record) => [record.id, record.sequence.length])) };
      try {
        let nextNotes = current.notes;
        for (const id of ids) nextNotes = removeArtifactNote(nextNotes, id, context);
        const nextPayload: LoadedPayload = { ...current, notes: nextNotes };
        payloadRef.current = nextPayload;
        setPayload(nextPayload);
        return ids.length;
      } catch (cause) {
        throw new MotifArtifactRuntimeError(
          'MOTIF_INVALID_WORKSPACE_INPUT',
          cause instanceof Error ? cause.message : 'The note removal request is invalid.',
          { operation: 'motifRemoveNotes', inputCount: ids.length, mutated: false },
        );
      }
    };
    window.motifAddWorkflowResults = (resultOrResults) => {
      const raw = Array.isArray(resultOrResults) ? resultOrResults : [resultOrResults];
      if (raw.length === 0) return 0;
      const current = payloadRef.current;
      const context = { recordLengths: new Map(current.records.map((record) => [record.id, record.sequence.length])) };
      try {
        let nextResults = current.workflowResults;
        for (const result of raw) nextResults = appendArtifactWorkflowResult(nextResults, result, context);
        const nextPayload: LoadedPayload = { ...current, workflowResults: nextResults };
        payloadRef.current = nextPayload;
        setPayload(nextPayload);
        return raw.length;
      } catch (cause) {
        throw new MotifArtifactRuntimeError(
          'MOTIF_INVALID_WORKSPACE_INPUT',
          cause instanceof Error ? cause.message : 'The workflow-result payload is invalid.',
          { operation: 'motifAddWorkflowResults', inputCount: raw.length, mutated: false },
        );
      }
    };
    window.motifGetWorkflowResults = () => {
      const current = payloadRef.current;
      return getArtifactWorkflowResultsSnapshot(current.workflowResults, {
        recordLengths: new Map(current.records.map((record) => [record.id, record.sequence.length])),
        allowMissingWorkflowOutputRecords: true,
      });
    };
    window.motifRemoveWorkflowResults = (resultIdOrIds) => {
      const ids = Array.from(new Set(Array.isArray(resultIdOrIds) ? resultIdOrIds : [resultIdOrIds]));
      if (ids.length === 0) return 0;
      const current = payloadRef.current;
      try {
        const requested = new Set(ids);
        const linked = current.workflowResults.filter((result) => (
          !requested.has(result.id)
          && result.provenance.parentIds?.some((parentId) => requested.has(parentId))
        ));
        if (linked.length > 0) {
          throw new Error(
            `Remove linked workflow result${linked.length === 1 ? '' : 's'} first: ${linked.map((result) => result.name).join(', ')}.`,
          );
        }
        let nextResults = current.workflowResults;
        for (const id of ids) nextResults = removeArtifactWorkflowResult(nextResults, id, {
          recordLengths: new Map(current.records.map((record) => [record.id, record.sequence.length])),
          allowMissingWorkflowOutputRecords: true,
        });
        const nextPayload: LoadedPayload = { ...current, workflowResults: nextResults };
        payloadRef.current = nextPayload;
        setPayload(nextPayload);
        resetWorkflowWindowState();
        return ids.length;
      } catch (cause) {
        throw new MotifArtifactRuntimeError(
          'MOTIF_INVALID_WORKSPACE_INPUT',
          cause instanceof Error ? cause.message : 'The workflow-result removal request is invalid.',
          { operation: 'motifRemoveWorkflowResults', inputCount: ids.length, mutated: false },
        );
      }
    };
    window.motifAddAnalysisAssets = (assetOrAssets) => {
      const raw = Array.isArray(assetOrAssets) ? assetOrAssets : [assetOrAssets];
      if (raw.length === 0) return 0;
      const current = payloadRef.current;
      const context = { recordLengths: new Map(current.records.map((record) => [record.id, record.sequence.length])) };
      try {
        let workspace = {
          analysisResults: current.analysisResults,
          analysisAssets: current.analysisAssets,
        };
        for (const asset of raw) workspace = appendArtifactAnalysisAsset(workspace, asset, context);
        const nextPayload: LoadedPayload = { ...current, ...workspace };
        payloadRef.current = nextPayload;
        setPayload(nextPayload);
        return raw.length;
      } catch (cause) {
        throw new MotifArtifactRuntimeError(
          'MOTIF_INVALID_WORKSPACE_INPUT',
          cause instanceof Error ? cause.message : 'The analysis-asset payload is invalid.',
          { operation: 'motifAddAnalysisAssets', inputCount: raw.length, mutated: false },
        );
      }
    };
    window.motifAddAnalysisResults = (resultOrResults) => {
      const raw = Array.isArray(resultOrResults) ? resultOrResults : [resultOrResults];
      if (raw.length === 0) return 0;
      const current = payloadRef.current;
      const context = { recordLengths: new Map(current.records.map((record) => [record.id, record.sequence.length])) };
      try {
        let workspace = {
          analysisResults: current.analysisResults,
          analysisAssets: current.analysisAssets,
        };
        for (const result of raw) workspace = appendArtifactAnalysisWorkspaceResult(workspace, result, context);
        const nextPayload: LoadedPayload = { ...current, ...workspace };
        payloadRef.current = nextPayload;
        setPayload(nextPayload);
        window.requestAnimationFrame(() => {
          const panel = document.querySelector<HTMLDetailsElement>('[data-rail-tool="analysis-results"]');
          if (panel) panel.open = true;
        });
        return raw.length;
      } catch (cause) {
        throw new MotifArtifactRuntimeError(
          'MOTIF_INVALID_WORKSPACE_INPUT',
          cause instanceof Error ? cause.message : 'The analysis-result payload is invalid.',
          { operation: 'motifAddAnalysisResults', inputCount: raw.length, mutated: false },
        );
      }
    };
    window.motifGetAnalysisWorkspace = () => {
      const current = payloadRef.current;
      return cloneArtifactAnalysisWorkspace({
        analysisResults: current.analysisResults,
        analysisAssets: current.analysisAssets,
      }, {
        recordLengths: new Map(current.records.map((record) => [record.id, record.sequence.length])),
      });
    };
    window.motifRemoveAnalysisResults = (resultIdOrIds) => {
      const ids = Array.from(new Set(Array.isArray(resultIdOrIds) ? resultIdOrIds : [resultIdOrIds]));
      if (ids.length === 0) return 0;
      const current = payloadRef.current;
      try {
        const context = {
          recordLengths: new Map(current.records.map((record) => [record.id, record.sequence.length])),
        };
        let workspace = {
          analysisResults: current.analysisResults,
          analysisAssets: current.analysisAssets,
        };
        const candidateAssetIds = new Set<string>();
        for (const id of ids) {
          workspace.analysisResults.find((result) => result.id === id)?.assetIds.forEach((assetId) => {
            candidateAssetIds.add(assetId);
          });
          workspace = removeArtifactAnalysisWorkspaceResult(workspace, id, context);
        }
        candidateAssetIds.forEach((assetId) => {
          const stillUsed = workspace.analysisResults.some((result) => result.assetIds.includes(assetId));
          const stillPresent = workspace.analysisAssets.some((asset) => asset.id === assetId);
          if (!stillUsed && stillPresent) workspace = removeArtifactAnalysisAsset(workspace, assetId, context);
        });
        const nextPayload: LoadedPayload = { ...current, ...workspace };
        payloadRef.current = nextPayload;
        setPayload(nextPayload);
        return ids.length;
      } catch (cause) {
        throw new MotifArtifactRuntimeError(
          'MOTIF_INVALID_WORKSPACE_INPUT',
          cause instanceof Error ? cause.message : 'The analysis-result removal request is invalid.',
          { operation: 'motifRemoveAnalysisResults', inputCount: ids.length, mutated: false },
        );
      }
    };
    window.motifGetWorkspace = () => createArtifactDatabaseSnapshot(payloadRef.current, artifactStateRef.current);
    window.motifReplaceWorkspace = (rawWorkspace, options) => {
      try {
        const prepared = prepareArtifactDatabaseRestore(
          rawWorkspace as Record<string, unknown>,
          selectedRecordIdRef.current,
        );
        const currentFingerprint = artifactDurableFingerprint(payloadRef.current, artifactStateRef.current);
        const incomingFingerprint = artifactDurableFingerprint(prepared.payload, prepared.artifactState);
        if (incomingFingerprint === currentFingerprint) {
          const requestedRecordId = prepared.payload.selectedRecordId;
          if (requestedRecordId !== selectedRecordIdRef.current) {
            selectRecord(requestedRecordId);
          }
          return prepared.payload.records.length;
        }
        if (
          currentFingerprint !== savedDurableFingerprintRef.current
          && options?.discardUnsavedChanges !== true
        ) {
          throw new MotifArtifactRuntimeError(
            'MOTIF_UNSAVED_WORKSPACE',
            'The current workspace has unsaved changes and was preserved. Export and verify a backup, or retry with { discardUnsavedChanges: true } for an intentional replacement.',
            { operation: 'motifReplaceWorkspace', mutated: false, hasUnsavedChanges: true },
          );
        }
        return applyArtifactDatabaseRestore(
          prepared,
          'Runtime workspace',
          'session-hydration',
        );
      } catch (cause) {
        if (cause instanceof MotifArtifactRuntimeError) throw cause;
        throw new MotifArtifactRuntimeError(
          'MOTIF_INVALID_WORKSPACE_INPUT',
          cause instanceof Error ? cause.message : 'The workspace payload is invalid.',
          { operation: 'motifReplaceWorkspace', mutated: false },
        );
      }
    };
    window.motifRemoveRecords = (recordIdOrIds) => {
      return removeRecords(recordIdOrIds);
    };
    window.motifClearWorkspace = clearWorkspaceData;
    window.motifHelp = () => MOTIF_HELP;
    return () => {
      delete window.motifRenderInventory;
      delete window.motifAddRecords;
      delete window.motifGetInventory;
      delete window.motifGetActiveRecord;
      delete window.motifAddAlignments;
      delete window.motifGetAlignments;
      delete window.motifAddNotes;
      delete window.motifGetNotes;
      delete window.motifUpdateNote;
      delete window.motifRemoveNotes;
      delete window.motifAddWorkflowResults;
      delete window.motifGetWorkflowResults;
      delete window.motifRemoveWorkflowResults;
      delete window.motifAddAnalysisAssets;
      delete window.motifAddAnalysisResults;
      delete window.motifGetAnalysisWorkspace;
      delete window.motifRemoveAnalysisResults;
      delete window.motifGetWorkspace;
      delete window.motifReplaceWorkspace;
      delete window.motifRemoveRecords;
      delete window.motifClearWorkspace;
      delete window.motifHelp;
    };
  }, [applyArtifactDatabaseRestore, clearWorkspaceData, describeRuntimePayloadSnapshot, rememberActiveSequenceScroll, removeRecords, resetWorkflowWindowState, resetWorkspaceViewState, selectRecord]);

  useEffect(() => {
    setSelection((current) => {
      if (current?.kind === 'feature' && features.some((feature) => feature.id === current.id)) return current;
      return null;
    });
  }, [features, recordId]);

  useEffect(() => {
    if (selection?.kind === 'restriction' && hiddenEnzymes.has(selection.enzyme ?? '')) {
      setSelection(null);
    }
  }, [hiddenEnzymes, selection]);

  const unhideRestrictionSourceEnzymes = useCallback((
    sources: readonly RestrictionEnzymeSourceId[],
    targetRecordId = recordId,
  ) => {
    const sourceEnzymeNames = restrictionEnzymeNamesForSources(sources);
    if (sourceEnzymeNames.length === 0) return;
    const sourceEnzymes = new Set(sourceEnzymeNames);
    setHiddenEnzymesByRecord((current) => {
      const currentHidden = current[targetRecordId] ?? [];
      const next = currentHidden.filter((enzyme) => !sourceEnzymes.has(enzyme));
      return next.length === currentHidden.length ? current : { ...current, [targetRecordId]: next };
    });
  }, [recordId]);

  useEffect(() => {
    window.motifListRestrictionSources = () => RESTRICTION_SOURCE_OPTIONS.map((option) => ({
      ...option,
      active: activeEnzymeSourcesRef.current.includes(option.id),
    }));
    window.motifSetRestrictionSources = (sources) => {
      const next = normalizeRestrictionSources(sources, activeEnzymeSourcesRef.current);
      const targetRecordId = selectedRecordIdRef.current ?? recordId;
      activeEnzymeSourcesRef.current = next;
      enzymeSourcesByRecordRef.current = { ...enzymeSourcesByRecordRef.current, [targetRecordId]: next };
      artifactStateRef.current = {
        ...artifactStateRef.current,
        enzymeSourcesByRecord: Object.fromEntries(
          Object.entries(enzymeSourcesByRecordRef.current).map(([id, sourcesForRecord]) => [id, [...sourcesForRecord]]),
        ),
      };
      setEnzymeSourcesByRecord((current) => ({ ...current, [targetRecordId]: next }));
      unhideRestrictionSourceEnzymes(next, targetRecordId);
      describeSnapshotRef.current = describeRuntimePayloadSnapshot(payloadRef.current, targetRecordId, next);
      return next;
    };
    return () => {
      delete window.motifListRestrictionSources;
      delete window.motifSetRestrictionSources;
    };
  }, [describeRuntimePayloadSnapshot, recordId, unhideRestrictionSourceEnzymes]);

  // The circular label placer drops a label whose text box can't dodge its
  // neighbours; a few very long feature names (e.g. "M13/pUC reverse primer
  // (-48)") otherwise get hidden entirely. Feed the MAP shortened display names
  // so the boxes fit and stay visible — full names remain everywhere else
  // (sequence ribbons, inspector, Features list, exports).
  const mapFeatures = useMemo(
    () => features.map((feature) => (
      feature.name ? { ...feature, name: compactMapFeatureLabel(feature.name) } : feature
    )),
    [features],
  );

  const layout = useMemo(
    () => computeMapLayout({
      // THE SEAM. This one line used to collapse "what the molecule is" into
      // "how to draw it" — computeMapLayout has always taken `mode` as a
      // first-class input and consulted `topology` only as a fallback, so the
      // capability to draw a plasmid as a line was built and unreachable.
      // `topology` below still travels into the layout unchanged, which is what
      // lets feature segmentation stay true to the molecule while the geometry
      // follows the drawing.
      mode: mapRenderMode,
      name: vector.name,
      length: sequence.length,
      topology,
      sequenceType,
      features: mapFeatures,
      restrictionSites: visibleRestrictionSites,
      width: mapSize.width,
      height: mapSize.height,
      // Cap the linear lane pitch (LINEAR_LANE_PITCH_MAX) so rows pack tightly
      // instead of spreading across the whole pane height (fixes the sparse,
      // whitespace-heavy linear map). No effect on circular layouts.
      fillAvailableHeight: true,
      display: {
        labelDensity: 'high',
        labelFontMode: 'proportional',
        circularOutsideGutterScale: 0.28,
        maxFeatureLabels: 18,
        maxRestrictionLabels: 24,
        showFeatureLabels: true,
        showRestrictionLabels,
      },
    }),
    // `mapRenderMode` belongs here now that it is no longer a pure function of
    // `topology`: without it the map keeps its old drawing until some other
    // dependency happens to change.
    [mapFeatures, mapRenderMode, visibleRestrictionSites, mapSize.height, mapSize.width, sequence.length, sequenceType, showRestrictionLabels, topology, vector.name],
  );

  useEffect(() => {
    mapDragRef.current = null;
    lastZoomAnchorRef.current = null;
    suppressNextBackgroundClick.current = false;
  }, [recordId, layout.mode]);

  useEffect(() => {
    setMapViewportsByRecord((current) => {
      const currentViewport = current[recordId];
      if (!currentViewport) return current;
      const nextViewport = clampMapViewport(currentViewport, layout.bg);
      if (sameViewport(currentViewport, nextViewport)) return current;
      return { ...current, [recordId]: nextViewport };
    });
  }, [layout.bg, recordId]);

  const selectedFeatureId = selection?.kind === 'feature' ? selection.id : null;
  const activeClusterId = selection?.kind === 'restriction' ? selection.clusterId : null;
  const selectedRestrictionTickIds = selection?.kind === 'restriction' ? selection.tickIds : emptyTickIds;
  const selectedRestrictionTickSet = useMemo(() => new Set(selectedRestrictionTickIds), [selectedRestrictionTickIds]);
  const selectedFeature = features.find((feature) => feature.id === selectedFeatureId) ?? null;
  const selectedFeatureSpans = useMemo(
    () => selectedFeature ? featureSpans(selectedFeature, sequence.length, topology) : [],
    [selectedFeature, sequence.length, topology],
  );
  // A multipart biological product is not a contiguous primer/guide scope. Do
  // not silently pass its coordinate envelope to design tools.
  const guideScopeRange = selectedFeatureSpans.length === 1
    ? selectedFeatureSpans[0]
    : selectedFeature
      ? null
      : selectedMapRange;
  // A selected feature already has an exact outline on the map. The broad
  // coordinate sector is reserved for an explicit range selection, where no
  // feature glyph exists to carry the state.
  const visibleMapRanges = useMemo(
    () => selectedMapRange
      ? normalizeSpan(selectedMapRange.start, selectedMapRange.end, sequence.length, topology)
      : [],
    [selectedMapRange, sequence.length, topology],
  );
  const selectionPaths = useMemo(
    () => artifactSelectionOverlayPaths(layout, visibleMapRanges),
    [layout, visibleMapRanges],
  );
  const selectedRestriction = activeClusterId
    ? layout.restrictions.find((restriction) => restriction.clusterId === activeClusterId) ?? null
    : null;
  const selectedRestrictionSites = selection?.kind === 'restriction'
    ? visibleRestrictionSites.filter((site) => restrictionSelectionHasSite(selectedRestrictionTickSet, site))
    : [];
  // Live stats for the current selection (feature or range), shown in the inspector.
  const inspectorSelectionSeq = selectedFeature
    ? sequenceForFeature(sequence, selectedFeature, sequenceType)
    : selectedMapRange
      ? sequenceForRange(sequence, selectedMapRange, topology)
      : '';
  const inspectorGc = isEditable && inspectorSelectionSeq ? gcContent(inspectorSelectionSeq) : null;
  const inspectorTm = isEditable && inspectorSelectionSeq ? meltingTemperature(inspectorSelectionSeq) : null;
  const canAnnotateSelectedMapRange = !!selectedMapRange;
  // Current selection distilled for the record summary (Claude-legible snapshot).
  const selectionSummary = useMemo(() => {
    if (selectedFeature) {
      return { label: `${selectedFeature.name} ${featureRangeLabel(selectedFeature)}`, sequence: inspectorSelectionSeq };
    }
    if (selectedMapRange) {
      return { label: mapRangeLabel(selectedMapRange, sequence.length), sequence: inspectorSelectionSeq };
    }
    return null;
  }, [selectedFeature, selectedMapRange, inspectorSelectionSeq, sequence.length]);
  const selectionBarLabel = selectionSummary?.label
    ?? (selectedRestriction ? `${selection?.kind === 'restriction' && selection.enzyme ? selection.enzyme : selectedRestriction.label?.text ?? 'Restriction'} site` : 'No range selected');

  // The map's status corner reports two independent facts: how the view is
  // transformed, and what is selected. They used to share one slot through a
  // ternary, so any zoom or pan silently replaced the range readout — the
  // selection stayed drawn on the map and stopped saying what it was. They are
  // not alternatives, so join them instead of choosing.
  const mapStatusHint = [
    mapViewport.k > MIN_ZOOM + 0.0001 || Math.abs(mapViewport.tx) > 0.5 || Math.abs(mapViewport.ty) > 0.5
      ? `${Math.round(mapViewport.k * 100)}%`
      : null,
    selectedMapRange ? `range ${mapRangeLabel(selectedMapRange, sequence.length)}` : null,
  ].filter(Boolean).join(' · ');

  // How many restriction sites the map is drawing without a label. The map says this
  // in its "+N more sites" chip, but only through an SVG <title>, which no browser
  // opens on keyboard focus — so a keyboard user is told nothing. This reads the SAME
  // overflow entry the chip renders from, so the two cannot drift into disagreeing
  // about one quantity.
  //
  // `unlabelled` specifically, never a total. An overflow chip reports two quantities
  // — items with no body drawn, and items drawn without a name — and the sentence
  // below is only true of the second. On the restriction chip the first is 0 (every
  // site keeps its density tick), so a total would read the same today and start
  // lying the moment it did not; on the FEATURE chip a total is already meaningless
  // as a single number, which is why the field is not offered.
  const mapUnlabelledSiteCount =
    layout.overflows?.find((overflow) => overflow.kind === 'restriction-labels')?.unlabelled ?? 0;

  // The Translate window's target: the current selection (feature or range), or the
  // whole sequence when nothing is selected. Carries the target's natural strand so
  // a reverse feature defaults to antisense.
  const baseTranslateTarget = useMemo<TranslateTarget>(() => {
    if (selectedFeature) {
      return {
        start: selectedFeature.start,
        end: selectedFeature.end,
        label: `${selectedFeature.name} ${featureRangeLabel(selectedFeature)}`,
        defaultStrand: (selectedFeature.strand === -1 ? 'antisense' : 'sense') as 'sense' | 'antisense',
        defaultFrame: CODING_FEATURE_TYPES.has(selectedFeature.type) ? codonStartFrame(selectedFeature.metadata) : 0,
        key: `f:${selectedFeature.id}`,
        whole: false,
        featureId: selectedFeature.id,
      };
    }
    if (selectedMapRange) {
      return {
        start: selectedMapRange.start,
        end: selectedMapRange.end,
        label: mapRangeLabel(selectedMapRange, sequence.length),
        defaultStrand: 'sense' as const,
        defaultFrame: 0,
        key: `r:${selectedMapRange.start}:${selectedMapRange.end}`,
        whole: false,
      };
    }
    return { start: 0, end: sequence.length, label: 'Whole sequence', defaultStrand: 'sense' as const, defaultFrame: 0, key: 'whole', whole: true };
  }, [selectedFeature, selectedMapRange, sequence.length]);
  const translateTarget = lockedTranslateTarget?.recordId === recordId ? lockedTranslateTarget.target : baseTranslateTarget;
  const translateTargetKey = translateTarget.key;
  const translateTargetFeature = translateTarget.featureId
    ? features.find((feature) => feature.id === translateTarget.featureId) ?? null
    : null;
  const translateTargetSemanticFeature = translateTarget.translationSource === 'layer'
    ? null
    : translateTargetFeature;
  const translateTargetCodingFeature = translateTargetSemanticFeature && CODING_FEATURE_TYPES.has(translateTargetSemanticFeature.type)
    ? translateTargetSemanticFeature
    : null;
  const translateTargetCodeFeature = translateTargetSemanticFeature && TRANSLATION_CODE_FEATURE_TYPES.has(translateTargetSemanticFeature.type)
    ? translateTargetSemanticFeature
    : null;
  const hasUndefinedCodingStrand = translateTargetCodingFeature?.strand === 0;
  const translationCode = useMemo<ArtifactTranslationCodeResolution>(() => (
    translateTarget.translationTableId !== undefined
      ? resolveArtifactTranslationCode(translateTarget.translationTableId)
      : resolveArtifactTranslationCode(vector.translationTableId, translateTargetCodeFeature?.metadata)
  ), [translateTarget.translationTableId, translateTargetCodeFeature?.metadata, vector.translationTableId]);
  const translationCodeContext = translateTarget.translationTableId !== undefined
    ? translateTarget.translationSource === 'feature'
      ? 'Captured from a feature-derived amino-acid track.'
      : 'Captured with the selected pinned amino-acid track.'
    : translationCode.supported && translationCode.source === 'feature'
      ? 'Feature /transl_table override.'
      : translationCode.supported && translateTargetCodeFeature
        ? `${translationCode.source === 'record' ? 'Inherited from the record' : 'Standard default'}; changing creates a feature override.`
      : translationCode.supported && translationCode.source === 'record'
        ? 'Record genetic-code default.'
        : translationCode.supported
          ? 'Standard default; selecting another code saves it on this record.'
          : 'Choose a supported code to repair this explicit qualifier.';
  const multipartTranslateFeature = translateTargetSemanticFeature
    && isMultipartFeature(translateTargetSemanticFeature)
      ? translateTargetSemanticFeature
      : null;
  // Follow the target's natural strand and imported codon_start whenever the
  // target changes; the user can still override either control afterwards.
  useEffect(() => {
    setTranslateStrand(translateTarget.defaultStrand);
    setTranslateFrame(translateTarget.defaultFrame);
  }, [recordId, translateTarget.defaultFrame, translateTarget.defaultStrand, translateTargetKey]);

  // A translation track built from the target + chosen strand/frame — the single
  // source of truth for the popup readout AND for pinning an inline layer.
  const previewTrack = useMemo<InlineTranslationTrack | null>(() => {
    if (!isEditable || !translationCode.supported || selectedPinnedLayerNeedsReview || hasUndefinedCodingStrand || multipartTranslateFeature || translateTarget.end - translateTarget.start < 3) return null;
    const naturalStrand = translateTargetSemanticFeature?.strand === -1 ? 'antisense' : 'sense';
    return {
      id: `preview:${translateTargetKey}:${translateStrand}:${translateFrame}:table-${translationCode.id}`,
      label: translateTarget.label,
      start: translateTarget.start,
      end: translateTarget.end,
      strand: translateStrand === 'antisense' ? -1 : 1,
      frame: translateFrame,
      translationTableId: translationCode.id,
      source: 'layer',
      completeCds: translateTarget.completeCds ?? (
        !!translateTargetSemanticFeature
          && translateTarget.start === translateTargetSemanticFeature.start
          && translateTarget.end === translateTargetSemanticFeature.end
          && translateStrand === naturalStrand
          && translateFrame === codonStartFrame(translateTargetSemanticFeature.metadata)
          && isCompleteCodingFeature(translateTargetSemanticFeature)
      ),
      featureId: translateTargetFeature?.id,
    };
  }, [hasUndefinedCodingStrand, isEditable, multipartTranslateFeature, selectedPinnedLayerNeedsReview, translateFrame, translateStrand, translateTarget, translateTargetFeature?.id, translateTargetKey, translateTargetSemanticFeature, translationCode]);
  const translationPreviewActive = translationPanelOpen || showTranslations || !translateTarget.whole;
  const previewResidues = useMemo(
    () => (translationPreviewActive && previewTrack ? inlineTrackResidues(sequence, sequenceType, previewTrack, topology) : []),
    [previewTrack, sequence, sequenceType, topology, translationPreviewActive],
  );
  const previewProtein = useMemo(() => {
    if (hasUndefinedCodingStrand) return '';
    if (!multipartTranslateFeature) return previewResidues.map((residue) => residue.aa).join('');
    if (!translationCode.supported) return '';
    const naturalSequence = sequenceForFeature(sequence, multipartTranslateFeature, sequenceType);
    const naturalControl = multipartTranslateFeature.strand === -1 ? 'antisense' : 'sense';
    const source = translateStrand === naturalControl
      ? naturalSequence
      : reverseComplement(naturalSequence, sequenceType === 'rna');
    return translateStrand === naturalControl
      && translateFrame === codonStartFrame(multipartTranslateFeature.metadata)
      && isCompleteCodingFeature(multipartTranslateFeature)
      ? translateCompleteCds(source, translateFrame, translationCode.table)
      : translate(source, translateFrame, translationCode.table);
  }, [hasUndefinedCodingStrand, multipartTranslateFeature, previewResidues, sequence, sequenceType, translateFrame, translateStrand, translationCode]);
  const translationUnavailableReason = !translationCode.supported
    ? translationCode.message
    : selectedPinnedLayerNeedsReview
      ? 'This pinned translation is marked for review. Confirm its range, strand, and frame in Annotations before copying or creating a protein.'
    : hasUndefinedCodingStrand
      ? 'This coding feature has no strand direction. Choose forward or reverse before translating it.'
    : translateTargetSemanticFeature && isOrderedFeatureLocation(translateTargetSemanticFeature)
    ? 'INSDC order(...) records segment order but does not assert one materializable sequence, so Motif will not translate it implicitly.'
    : translateTargetSemanticFeature && isAmbiguousFeatureLocation(translateTargetSemanticFeature)
      ? 'This unmarked reverse multipart location has ambiguous segment order. Re-import its original GenBank record or confirm biological order in the source data before translation.'
      : undefined;
  const canPinPreviewTranslation = !!previewTrack && !translateTarget.whole;
  // Selection-only translation (drives the selection bar's Translate / New-record
  // enablement); null for the whole-sequence target.
  const selectionTranslation = useMemo(() => {
    if (translateTarget.whole || !previewProtein) return null;
    return { label: translateTarget.label, protein: previewProtein, isReverse: translateStrand === 'antisense' };
  }, [translateTarget, previewProtein, translateStrand]);
  const selectionActionTranslation = (selectedFeature || selectedMapRange) ? selectionTranslation : null;
  const hasMaterializableSequenceSelection = !!selectionSummary && inspectorSelectionSeq.length > 0;
  const singleCutters = useMemo(() => {
    const counts = new Map<string, number>();
    for (const site of visibleRestrictionSites) counts.set(site.enzyme, (counts.get(site.enzyme) ?? 0) + 1);
    return Array.from(counts.entries()).filter(([, count]) => count === 1).map(([name]) => name).sort();
  }, [visibleRestrictionSites]);

  const setCurrentMapViewport = useCallback((updater: MapViewport | ((viewport: MapViewport) => MapViewport)) => {
    setMapViewportsByRecord((current) => {
      const currentViewport = current[recordId] ?? DEFAULT_MAP_VIEWPORT;
      const rawNext = typeof updater === 'function' ? updater(currentViewport) : updater;
      const nextViewport = clampMapViewport(rawNext, layout.bg);
      if (sameViewport(currentViewport, nextViewport)) return current;
      return { ...current, [recordId]: nextViewport };
    });
  }, [layout.bg, recordId]);

  /** `point` is ROOT space — the new translate keeps that root point where it is. */
  const zoomAtPoint = useCallback((point: MapRootPoint, factor: number) => {
    if (!Number.isFinite(factor) || factor <= 0) return;
    lastZoomAnchorRef.current = point;
    setCurrentMapViewport((currentViewport) => {
      const nextK = clamp(currentViewport.k * factor, MIN_ZOOM, MAX_ZOOM);
      if (Math.abs(nextK - currentViewport.k) < 0.0001) return currentViewport;
      const ratio = nextK / currentViewport.k;
      return {
        k: nextK,
        tx: point.x - (point.x - currentViewport.tx) * ratio,
        ty: point.y - (point.y - currentViewport.ty) * ratio,
      };
    });
  }, [setCurrentMapViewport]);

  const contentZoomAnchor = useMemo(
    (): MapContentPoint => (layout.mode === 'circular' && layout.radius > 0
      ? mapContentPoint(layout.center.x, layout.center.y - layout.radius)
      : mapContentPoint(layout.bg.x + layout.bg.width / 2, layout.bg.y + layout.bg.height / 2)),
    [layout.bg.height, layout.bg.width, layout.bg.x, layout.bg.y, layout.center.x, layout.center.y, layout.mode, layout.radius],
  );

  // The remembered anchor is already root space; the layout-derived fallback is
  // content space and has to be pushed through the current transform first. The
  // fallback is reachable whenever the anchor ref is cleared but the zoom is
  // kept — switching records, or changing map mode — so a zoomed map used to
  // lurch away from the very point the + / - buttons are trying to hold still.
  const buttonZoomAnchor = useCallback(
    (): MapRootPoint => lastZoomAnchorRef.current ?? rootPointFromContent(contentZoomAnchor, mapViewport),
    [contentZoomAnchor, mapViewport],
  );
  const handleZoomIn = useCallback(() => zoomAtPoint(buttonZoomAnchor(), ZOOM_STEP), [buttonZoomAnchor, zoomAtPoint]);
  const handleZoomOut = useCallback(() => zoomAtPoint(buttonZoomAnchor(), 1 / ZOOM_STEP), [buttonZoomAnchor, zoomAtPoint]);
  const handleZoomReset = useCallback(() => setCurrentMapViewport(DEFAULT_MAP_VIEWPORT), [setCurrentMapViewport]);

  const handleMapWheel = useCallback((
    point: MapRootPoint,
    deltaX: number,
    deltaY: number,
    deltaMode: number,
    ctrlKey: boolean,
    shiftKey: boolean,
  ): boolean => {
    lastZoomAnchorRef.current = point;
    const wheelUnit = deltaMode === 1 ? 18 : deltaMode === 2 ? (mapFrameRef.current?.clientHeight ?? 640) : 1;
    const normalizedX = deltaX * wheelUnit;
    const normalizedY = deltaY * wheelUnit;

    if (ctrlKey) {
      zoomAtPoint(point, Math.exp(-normalizedY * 0.0015));
      return true;
    }

    const panScale = mapViewport.k <= MIN_ZOOM + 0.0001 ? MAP_FIT_WHEEL_PAN_SCALE : MAP_ZOOMED_WHEEL_PAN_SCALE;
    const panX = (shiftKey && Math.abs(normalizedX) < 0.5 ? normalizedY : normalizedX) * panScale;
    const panY = (shiftKey ? 0 : normalizedY) * panScale;
    setCurrentMapViewport((currentViewport) => ({
      ...currentViewport,
      tx: currentViewport.tx - panX,
      ty: currentViewport.ty - panY,
    }));
    return true;
  }, [mapFrameRef, mapViewport.k, setCurrentMapViewport, zoomAtPoint]);

  const handleMapPointerStart = useCallback((rootPoint: MapRootPoint, contentPoint: MapContentPoint) => {
    const action = mapPointerActionAtPoint(contentPoint, layout, mapViewport.k);
    setMapPointerAction(action);
    if (action === 'pan') {
      mapDragRef.current = { mode: 'pan', start: rootPoint, viewport: mapViewport, moved: false };
      return true;
    }

    const startBp = pointToSequenceOffset(contentPoint, layout);
    const startAngle = pointToSequenceAngle(contentPoint, layout);
    mapDragRef.current = { mode: 'range', start: contentPoint, startBp, lastAngle: startAngle, cumulativeAngle: 0, moved: false };
    setLockedTranslateTarget(null);
    setSelectedTranslationLayerByRecord((current) => (current[recordId] ? { ...current, [recordId]: null } : current));
    setSelection(null);
    setMapRangesByRecord((current) => ({
      ...current,
      // A drag is a gesture on a PICTURE, so it follows how the map is drawn.
      // `layout.mode` and `topology` were always equal while the only way to
      // get a linear drawing was to convert the record; they can differ now,
      // and a wrapping range is not expressible by one drag along an axis.
      [recordId]: rangeFromMapDrag(startBp, startBp + 1, sequence.length, layout.mode),
    }));
    return true;
  }, [layout, mapViewport, recordId, sequence.length]);

  const handleMapPointerMove = useCallback((rootPoint: MapRootPoint, contentPoint: MapContentPoint) => {
    const drag = mapDragRef.current;
    if (!drag) return;
    const point = drag.mode === 'pan' ? rootPoint : contentPoint;
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) > 2) drag.moved = true;

    if (drag.mode === 'pan') {
      setCurrentMapViewport({
        ...drag.viewport,
        tx: drag.viewport.tx + dx,
        ty: drag.viewport.ty + dy,
      });
      return;
    }

    const endBp = pointToSequenceOffset(contentPoint, layout);
    let nextRange: MapSelectionRange;
    // Keyed on how the map is DRAWN. The angle model needs a ring: on a linear
    // layout `layout.center` is the axis's left end, so dragging along the axis
    // barely moves the angle and the sweep never grows. `pointToSequenceOffset`
    // and the content-point projection above already key on layout.mode — this
    // was the one place in the gesture still asking the molecule instead.
    if (layout.mode === 'circular') {
      const nextAngle = pointToSequenceAngle(contentPoint, layout);
      drag.cumulativeAngle += signedCircularAngleDelta(drag.lastAngle, nextAngle);
      drag.lastAngle = nextAngle;
      nextRange = rangeFromCircularAngleDrag(drag.startBp, drag.cumulativeAngle, sequence.length);
    } else {
      nextRange = rangeFromMapDrag(drag.startBp, endBp, sequence.length, layout.mode);
    }
    setMapRangesByRecord((current) => {
      const previous = current[recordId];
      if (previous && previous.start === nextRange.start && previous.end === nextRange.end) return current;
      return { ...current, [recordId]: nextRange };
    });
  }, [layout, recordId, sequence.length, setCurrentMapViewport]);

  const handleMapPointerEnd = useCallback(() => {
    const drag = mapDragRef.current;
    if (drag?.moved) {
      suppressNextBackgroundClick.current = true;
      window.setTimeout(() => {
        suppressNextBackgroundClick.current = false;
      }, 120);
    }
    mapDragRef.current = null;
  }, []);

  /**
   * Client -> SVG ROOT space. `getScreenCTM()` on the `<svg>` accounts for the
   * viewBox and preserveAspectRatio but NOT for the viewport group's own
   * translate/scale, so this is the space `{k, tx, ty}` is expressed in. Right
   * for zoom anchoring; wrong for "which base is under the cursor".
   */
  const mapRootPointFromClient = useCallback((clientX: number, clientY: number): MapRootPoint | null => {
    const svg = mapFrameRef.current?.querySelector<SVGSVGElement>('svg.motif-plasmid-map');
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const transformed = point.matrixTransform(matrix.inverse());
    return mapRootPoint(transformed.x, transformed.y);
  }, [mapFrameRef]);

  useEffect(() => {
    const mapFrame = mapFrameRef.current;
    if (!mapFrame) return undefined;

    const handleCommandWheel = (event: globalThis.WheelEvent) => {
      if (!event.metaKey || event.ctrlKey) return;
      const point = mapRootPointFromClient(event.clientX, event.clientY);
      if (!point) return;
      const wheelUnit = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? mapFrame.clientHeight : 1;
      zoomAtPoint(point, Math.exp(-(event.deltaY * wheelUnit) * 0.0015));
      event.preventDefault();
      event.stopPropagation();
    };

    mapFrame.addEventListener('wheel', handleCommandWheel, { passive: false, capture: true });
    return () => mapFrame.removeEventListener('wheel', handleCommandWheel, { capture: true });
  }, [mapFrameRef, mapRootPointFromClient, zoomAtPoint]);

  const handleMapSurfacePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    const target = event.target as Element;
    if (target.closest('.motif-pm-feature, .motif-pm-restriction, .motif-pm-range-overlay[data-interactive="true"]')) return;
    const rootPoint = mapRootPointFromClient(event.clientX, event.clientY);
    if (!rootPoint) return;
    lastZoomAnchorRef.current = rootPoint;
    if (!handleMapPointerStart(rootPoint, contentPointFromRoot(rootPoint, mapViewport))) return;
    mapPointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }, [handleMapPointerStart, mapRootPointFromClient, mapViewport]);

  const handleMapSurfacePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const rootPoint = mapRootPointFromClient(event.clientX, event.clientY);
    if (!rootPoint) return;
    const contentPoint = contentPointFromRoot(rootPoint, mapViewport);
    if (mapPointerIdRef.current === null) {
      setMapPointerAction(mapPointerActionAtPoint(contentPoint, layout, mapViewport.k));
      return;
    }
    if (event.pointerId !== mapPointerIdRef.current) return;
    lastZoomAnchorRef.current = rootPoint;
    event.preventDefault();
    handleMapPointerMove(rootPoint, contentPoint);
  }, [handleMapPointerMove, layout, mapRootPointFromClient, mapViewport]);

  const handleMapSurfacePointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== mapPointerIdRef.current) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    mapPointerIdRef.current = null;
    event.preventDefault();
    handleMapPointerEnd();
  }, [handleMapPointerEnd]);

  const handleMapBackgroundClick = useCallback(() => {
    if (suppressNextBackgroundClick.current) {
      suppressNextBackgroundClick.current = false;
      return;
    }
    setLockedTranslateTarget(null);
    setSelectedTranslationLayerByRecord((current) => (
      current[recordId] ? { ...current, [recordId]: null } : current
    ));
    setSelection(null);
    setCaret(null);
    setMapRangesByRecord((current) => {
      if (!current[recordId]) return current;
      return { ...current, [recordId]: null };
    });
  }, [recordId]);

  const handleFeatureClick = useCallback((featureId: string) => {
    const feature = features.find((candidate) => candidate.id === featureId);
    const automaticTranslationId = feature
      && CODING_FEATURE_TYPES.has(feature.type)
      && featureLocationLength(feature) >= 3
      && !isMultipartFeature(feature)
      && !hiddenFeatureTranslationIds.has(`feat:${feature.id}`)
      ? `feat:${feature.id}`
      : null;
    setLockedTranslateTarget(null);
    setSelectedTranslationLayerByRecord((current) => ({ ...current, [recordId]: automaticTranslationId }));
    setSelection({ kind: 'feature', id: featureId });
    setCaret(null);
    setMapRangesByRecord((current) => {
      if (!current[recordId]) return current;
      return { ...current, [recordId]: null };
    });
  }, [features, hiddenFeatureTranslationIds, recordId]);

  const handleMapFeatureClick = useCallback((featureId: string) => {
    requestSequenceFocus();
    handleFeatureClick(featureId);
  }, [handleFeatureClick]);

  const handleRestrictionClick = useCallback((clusterId: string, tickIds: readonly string[], enzyme?: string) => {
    setLockedTranslateTarget(null);
    setSelectedTranslationLayerByRecord((current) => (
      current[recordId] ? { ...current, [recordId]: null } : current
    ));
    setSelection({ kind: 'restriction', clusterId, tickIds, enzyme });
    setCaret(null);
    setMapRangesByRecord((current) => {
      if (!current[recordId]) return current;
      return { ...current, [recordId]: null };
    });
  }, [recordId]);

  const handleSequenceRestrictionClick = useCallback((site: RestrictionSite) => {
    const tickId = restrictionSiteTickId(site);
    const layoutTickId = restrictionSiteLayoutTickId(site);
    const cluster = layout.restrictions.find((restriction) => (
      restriction.tickIds.includes(tickId) || restriction.tickIds.includes(layoutTickId)
    ));
    handleRestrictionClick(cluster?.clusterId ?? `sequence:${tickId}`, [tickId], site.enzyme);
  }, [handleRestrictionClick, layout.restrictions]);

  const handleMotifChange = useCallback((value: string) => {
    if (value.length > MAX_MOTIF_LENGTH) {
      showWorkbenchNotice(`Patterns are limited to ${MAX_MOTIF_LENGTH} characters.`, 'error');
    }
    setMotifsByRecord((current) => ({ ...current, [recordId]: value.slice(0, MAX_MOTIF_LENGTH) }));
  }, [recordId, showWorkbenchNotice]);

  const selectSequenceRange = useCallback((start: number, end: number) => {
    if (sequence.length <= 0) return;
    const rawStart = Math.floor(start);
    const rawEnd = Math.floor(end);
    const rangeStart = clamp(rawStart, 0, Math.max(0, sequence.length - 1));
    const rangeEnd = topology === 'circular' && rawEnd > sequence.length && rawEnd > rawStart
      ? clamp(rangeStart + (rawEnd - rawStart), rangeStart + 1, rangeStart + sequence.length)
      : clamp(rawEnd, rangeStart + 1, sequence.length);
    setLockedTranslateTarget(null);
    setSelectedTranslationLayerByRecord((current) => (current[recordId] ? { ...current, [recordId]: null } : current));
    setSelection(null);
    setCaret(null);
    setMapRangesByRecord((current) => ({
      ...current,
      [recordId]: { start: rangeStart, end: rangeEnd },
    }));
  }, [recordId, sequence.length, topology]);

  const selectTranslationCodon = useCallback((
    start: number,
    end: number,
    strand?: 1 | -1,
    translationTableId?: number,
    featureId?: string,
    translationSource?: 'feature' | 'layer',
    frame?: 0 | 1 | 2,
    completeCds?: boolean,
    label?: string,
  ) => {
    if (sequence.length <= 0) return;
    const rawStart = Math.floor(start);
    const rawEnd = Math.floor(end);
    const rangeStart = clamp(rawStart, 0, Math.max(0, sequence.length - 1));
    const rangeEnd = topology === 'circular' && rawEnd > sequence.length && rawEnd > rawStart
      ? clamp(rangeStart + (rawEnd - rawStart), rangeStart + 1, rangeStart + sequence.length)
      : clamp(rawEnd, rangeStart + 1, sequence.length);
    const target: TranslateTarget = {
      start: rangeStart,
      end: rangeEnd,
      label: label ?? mapRangeLabel({ start: rangeStart, end: rangeEnd }, sequence.length),
      defaultStrand: strand === -1 ? 'antisense' : strand === 1 ? 'sense' : translateStrand,
      defaultFrame: frame ?? 0,
      key: `r:${rangeStart}:${rangeEnd}:table-${translationTableId ?? 'record'}:${featureId ?? ''}:${translationSource ?? ''}:${frame ?? 0}:${completeCds ? 'cds' : 'range'}`,
      whole: false,
      translationTableId,
      featureId,
      completeCds,
      translationSource,
    };
    setLockedTranslateTarget({ recordId, target });
    setSelectedTranslationLayerByRecord((current) => (
      current[recordId] ? { ...current, [recordId]: null } : current
    ));
    setSelection(null);
    setCaret(null);
    setMapRangesByRecord((current) => ({
      ...current,
      [recordId]: { start: rangeStart, end: rangeEnd },
    }));
  }, [recordId, sequence.length, topology, translateStrand]);

  const copyText = useCallback(async (label: string, value: string) => {
    const ok = await writeTextToClipboard(value);
    setCopyStatus(ok ? `${label} copied` : 'Copy blocked');
    if (!ok) showWorkbenchNotice('Copy was blocked. Select the export preview and copy it manually.', 'error');
    window.setTimeout(() => setCopyStatus(null), 1800);
    return ok;
  }, [showWorkbenchNotice]);

  const saveAlignment = useCallback((alignment: ArtifactAlignment): ArtifactAlignment => {
    const current = payloadRef.current;
    const candidate = {
      ...serializeArtifactAlignment(alignment),
      id: uniqueAlignmentId(alignment.id || alignment.name, current.alignments),
      name: uniqueAlignmentName(alignment.name, current.alignments),
    };
    const nextAlignments = normalizeArtifactAlignments([
      ...current.alignments.map(serializeArtifactAlignment),
      candidate,
    ]);
    const saved = nextAlignments[nextAlignments.length - 1];
    const nextPayload: LoadedPayload = { ...current, alignments: nextAlignments };
    payloadRef.current = nextPayload;
    setPayload(nextPayload);
    return saved;
  }, []);

  const updateAlignmentTemplate = useCallback((alignmentId: string, rowId: string): ArtifactAlignment | null => {
    const current = payloadRef.current;
    const existing = current.alignments.find((alignment) => alignment.id === alignmentId);
    if (!existing || !existing.rows.some((row) => row.id === rowId)) return null;
    if (existing.referenceRowId === rowId) return existing;
    const nextAlignments = normalizeArtifactAlignments(current.alignments.map((alignment) => (
      alignment.id === alignmentId
        ? serializeArtifactAlignment({ ...alignment, referenceRowId: rowId })
        : serializeArtifactAlignment(alignment)
    )));
    const updated = nextAlignments.find((alignment) => alignment.id === alignmentId) ?? null;
    if (!updated) return null;
    const nextPayload: LoadedPayload = { ...current, alignments: nextAlignments };
    payloadRef.current = nextPayload;
    setPayload(nextPayload);
    return updated;
  }, []);

  const deleteAlignment = useCallback((alignmentId: string) => {
    const current = payloadRef.current;
    if (!current.alignments.some((alignment) => alignment.id === alignmentId)) return;
    const nextPayload: LoadedPayload = {
      ...current,
      alignments: current.alignments.filter((alignment) => alignment.id !== alignmentId),
    };
    payloadRef.current = nextPayload;
    setPayload(nextPayload);
    showWorkbenchNotice('Alignment removed');
  }, [showWorkbenchNotice]);

  const downloadAlignmentText = useCallback((filename: string, value: string, mime = 'text/plain') => {
    downloadTextFile(filename, value, mime);
  }, []);

  // Copy a plain-language snapshot of the current record + selection so the user
  // (or Claude reading the artifact) can drop it straight into the conversation.
  const handleCopySummary = useCallback(() => {
    const summary = buildRecordSummary(vector, topology, restrictionSites, selectionSummary);
    void copyText('Summary', summary.text);
  }, [vector, topology, restrictionSites, selectionSummary, copyText]);

  useEffect(() => {
    describeSnapshotRef.current = buildRecordSummary(vector, topology, restrictionSites, selectionSummary);
  }, [vector, topology, restrictionSites, selectionSummary]);

  // Plain-language + structured snapshot of the active view, for the Claude
  // Science coordinating agent to read. The function itself stays stable and
  // returns a ref so runtime APIs can update it synchronously before React rerenders.
  useEffect(() => {
    window.motifDescribe = () => describeSnapshotRef.current;
    return () => {
      delete window.motifDescribe;
    };
  }, []);

  // Workbench keyboard shortcuts: Esc clears selection, Cmd/Ctrl+C copies the
  // current selection's sequence, +/-/0 drive map zoom. Skipped while typing in
  // a form field or when a native text selection is active.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const inForm = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      const mod = event.metaKey || event.ctrlKey;

      if (mod && (event.key === 'c' || event.key === 'C')) {
        if (inForm) return;
        if ((window.getSelection?.()?.toString() ?? '').length > 0) return;
        let text = '';
        let label = '';
        if (selectedFeature) {
          text = sequenceForFeature(sequence, selectedFeature, sequenceType);
          label = selectedFeature.name || 'Feature';
        } else if (selectedMapRange) {
          text = sequenceForRange(sequence, selectedMapRange, topology);
          label = 'Selection';
        }
        if (text) {
          event.preventDefault();
          void copyText(label, text);
        }
        return;
      }

      if (inForm || mod) return;
      if (event.key === 'Escape') {
        setLockedTranslateTarget(null);
        setSelection(null);
        setCaret(null);
        setMapRangesByRecord((current) => (current[recordId] ? { ...current, [recordId]: null } : current));
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        handleZoomIn();
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        handleZoomOut();
      } else if (event.key === '0') {
        event.preventDefault();
        handleZoomReset();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedFeature, selectedMapRange, sequence, sequenceType, topology, copyText, handleZoomIn, handleZoomOut, handleZoomReset, recordId]);

  // ── Base editing ──────────────────────────────────────────────────────────
  // Mutations run through the real Motif mutate engine (feature/subRange
  // coordinates shift automatically). One transaction also remaps range notes
  // and pinned translations before either React state is committed.
  const captureEditSnapshot = useCallback((): EditSnapshot | null => {
    const current = payloadRef.current;
    const currentRecord = current.records.find((record) => record.id === recordId);
    if (!currentRecord) return null;
    return {
      sequence: currentRecord.sequence,
      features: currentRecord.features.map((feature) => ({ ...feature })),
      sites: currentRecord.sites.map((site) => ({ ...site })),
      sangerTrace: currentRecord.sangerTrace,
      noteAnchors: snapshotNoteAnchors(current.notes, recordId),
      hadTranslationLayerEntry: Object.prototype.hasOwnProperty.call(
        artifactStateRef.current.translationLayersByRecord,
        recordId,
      ),
      translationLayers: (artifactStateRef.current.translationLayersByRecord[recordId] ?? [])
        .map((layer) => ({ ...layer })),
      selectedTranslationLayerId: selectedTranslationLayerByRecord[recordId] ?? null,
    };
  }, [recordId, selectedTranslationLayerByRecord]);

  const commitEdit = useCallback((
    result: MutationResult,
    caretAfter: number,
    edit: SequenceCoordinateEdit,
  ) => {
    if (result.raw.length > MOTIF_MAX_RECORD_LENGTH) {
      showWorkbenchNotice(`Records are limited to ${MOTIF_MAX_RECORD_LENGTH.toLocaleString()} residues. Delete bases or split the record before inserting more.`, 'error');
      return;
    }
    const current = payloadRef.current;
    const recordIndex = current.records.findIndex((record) => record.id === recordId);
    const currentRecord = current.records[recordIndex];
    if (!currentRecord) return;
    if (
      edit.oldLength !== currentRecord.sequence.length
      || result.raw.length !== edit.oldLength - edit.deletedLength + edit.insertedLength
    ) {
      showWorkbenchNotice('The edit was rejected because its coordinate transaction did not match the active sequence.', 'error');
      return;
    }

    const before = captureEditSnapshot();
    if (!before) return;
    const editedAt = new Date().toISOString();
    const anchors = applySequenceEditToAnchors({
      recordId,
      notes: current.notes,
      translationLayers: artifactStateRef.current.translationLayersByRecord[recordId] ?? [],
      edit,
      editedAt,
    });
    const records = [...current.records];
    records[recordIndex] = {
      ...currentRecord,
      sequence: result.raw,
      features: result.features,
      sites: [],
      sangerTrace: undefined,
    };
    const recordLengths = new Map(records.map((record) => [record.id, record.sequence.length]));
    const collections = normalizeArtifactWorkspaceCollections({
      notes: anchors.notes,
      workflowResults: current.workflowResults,
    }, {
      recordLengths,
      allowMissingWorkflowOutputRecords: true,
    });
    const nextPayload: LoadedPayload = {
      ...current,
      records,
      notes: collections.notes,
      workflowResults: collections.workflowResults,
    };
    const nextTranslationLayersByRecord = { ...artifactStateRef.current.translationLayersByRecord };
    if (before.hadTranslationLayerEntry || anchors.translationLayers.length > 0) {
      nextTranslationLayersByRecord[recordId] = anchors.translationLayers;
    } else {
      delete nextTranslationLayersByRecord[recordId];
    }
    const nextArtifactState = normalizeArtifactDurableState({
      ...artifactStateRef.current,
      translationLayersByRecord: nextTranslationLayersByRecord,
    }, recordLengths);

    // Validate the complete checkpoint shape before publishing either half of
    // the transaction. This prevents recovery effects from observing sidecars
    // against a sequence length they no longer satisfy.
    createArtifactDatabaseSnapshot(nextPayload, nextArtifactState);
    const after: EditSnapshot = {
      sequence: result.raw,
      features: result.features.map((feature) => ({ ...feature })),
      sites: [],
      sangerTrace: undefined,
      noteAnchors: snapshotNoteAnchors(nextPayload.notes, recordId),
      hadTranslationLayerEntry: Object.prototype.hasOwnProperty.call(
        nextArtifactState.translationLayersByRecord,
        recordId,
      ),
      translationLayers: anchors.translationLayers.map((layer) => ({ ...layer })),
      selectedTranslationLayerId: before.selectedTranslationLayerId
        && anchors.translationLayers.some((layer) => layer.id === before.selectedTranslationLayerId)
        ? before.selectedTranslationLayerId
        : null,
    };
    const store = editHistoryRef.current[recordId] ?? { undo: [], redo: [] };
    editHistoryRef.current[recordId] = {
      undo: [...store.undo, { before, after }].slice(-200),
      redo: [],
    };
    payloadRef.current = nextPayload;
    artifactStateRef.current = nextArtifactState;
    setPayload(nextPayload);
    setTranslationLayersByRecord(nextArtifactState.translationLayersByRecord);
    const notices = [
      ...(currentRecord.sangerTrace
        ? ['The edited sequence is no longer linked to its original chromatogram. Undo restores the trace.']
        : []),
      ...(anchors.detachedNoteCount > 0
        ? [`${anchors.detachedNoteCount} fully deleted range note${anchors.detachedNoteCount === 1 ? ' was' : 's were'} retained at record level for review.`]
        : anchors.adjustedNoteCount > 0
          ? [`${anchors.adjustedNoteCount} range note anchor${anchors.adjustedNoteCount === 1 ? '' : 's'} updated.`]
          : []),
      ...(anchors.removedLayerCount > 0
        ? [`${anchors.removedLayerCount} collapsed translation layer${anchors.removedLayerCount === 1 ? ' was' : 's were'} removed; Undo restores it.`]
        : anchors.adjustedLayerCount > 0
          ? [`${anchors.adjustedLayerCount} translation anchor${anchors.adjustedLayerCount === 1 ? '' : 's'} updated.`]
          : []),
    ];
    if (notices.length > 0) showWorkbenchNotice(notices.join(' '), 'status');
    setSelectedTranslationLayerByRecord((selected) => {
      const selectedId = selected[recordId];
      if (!selectedId || anchors.translationLayers.some((layer) => layer.id === selectedId)) return selected;
      return { ...selected, [recordId]: null };
    });
    setLockedTranslateTarget(null);
    setSelection(null);
    setMapRangesByRecord((cur) => (cur[recordId] ? { ...cur, [recordId]: null } : cur));
    setCaret(clamp(caretAfter, 0, result.raw.length));
    bumpEditHistory();
  }, [captureEditSnapshot, recordId, showWorkbenchNotice]);

  const restoreSnapshot = useCallback((snap: EditSnapshot, expectedCurrent: EditSnapshot) => {
    const current = payloadRef.current;
    const recordIndex = current.records.findIndex((record) => record.id === recordId);
    if (recordIndex < 0) return;
    const records = [...current.records];
    records[recordIndex] = {
      ...records[recordIndex],
      sequence: snap.sequence,
      features: snap.features as Feature[],
      sites: snap.sites as RestrictionSite[],
      sangerTrace: snap.sangerTrace,
    };
    const recordLengths = new Map(records.map((record) => [record.id, record.sequence.length]));
    const restoredNotes = restoreNoteAnchors(
      current.notes,
      recordId,
      snap.noteAnchors,
      expectedCurrent.noteAnchors,
    );
    const collections = normalizeArtifactWorkspaceCollections({
      notes: restoredNotes,
      workflowResults: current.workflowResults,
    }, {
      recordLengths,
      allowMissingWorkflowOutputRecords: true,
    });
    const nextPayload: LoadedPayload = {
      ...current,
      records,
      notes: collections.notes,
      workflowResults: collections.workflowResults,
    };
    const restoredTranslationLayersByRecord = {
      ...artifactStateRef.current.translationLayersByRecord,
    };
    if (snap.hadTranslationLayerEntry || snap.translationLayers.length > 0) {
      restoredTranslationLayersByRecord[recordId] = snap.translationLayers;
    } else {
      delete restoredTranslationLayersByRecord[recordId];
    }
    const nextArtifactState = normalizeArtifactDurableState({
      ...artifactStateRef.current,
      translationLayersByRecord: restoredTranslationLayersByRecord,
    }, recordLengths);
    createArtifactDatabaseSnapshot(nextPayload, nextArtifactState);
    payloadRef.current = nextPayload;
    artifactStateRef.current = nextArtifactState;
    setPayload(nextPayload);
    setTranslationLayersByRecord(nextArtifactState.translationLayersByRecord);
    setSelectedTranslationLayerByRecord((selected) => ({
      ...selected,
      [recordId]: snap.selectedTranslationLayerId
        && snap.translationLayers.some((layer) => layer.id === snap.selectedTranslationLayerId)
        ? snap.selectedTranslationLayerId
        : null,
    }));
  }, [recordId]);

  const undoEdit = useCallback(() => {
    const store = editHistoryRef.current[recordId];
    if (!store || store.undo.length === 0) return;
    const transaction = store.undo[store.undo.length - 1];
    const currentAfter = captureEditSnapshot() ?? transaction.after;
    const liveTransaction = { ...transaction, after: currentAfter };
    restoreSnapshot(liveTransaction.before, transaction.after);
    editHistoryRef.current[recordId] = {
      undo: store.undo.slice(0, -1),
      redo: [...store.redo, liveTransaction],
    };
    setCaret((c) => (c === null ? null : clamp(c, 0, liveTransaction.before.sequence.length)));
    bumpEditHistory();
  }, [captureEditSnapshot, recordId, restoreSnapshot]);

  const redoEdit = useCallback(() => {
    const store = editHistoryRef.current[recordId];
    if (!store || store.redo.length === 0) return;
    const transaction = store.redo[store.redo.length - 1];
    const currentBefore = captureEditSnapshot() ?? transaction.before;
    const liveTransaction = { ...transaction, before: currentBefore };
    restoreSnapshot(liveTransaction.after, transaction.before);
    editHistoryRef.current[recordId] = {
      undo: [...store.undo, liveTransaction],
      redo: store.redo.slice(0, -1),
    };
    setCaret((c) => (c === null ? null : clamp(c, 0, liveTransaction.after.sequence.length)));
    bumpEditHistory();
  }, [captureEditSnapshot, recordId, restoreSnapshot]);

  const handlePlaceCaret = useCallback((index: number) => {
    setLockedTranslateTarget(null);
    setSelection(null);
    setMapRangesByRecord((cur) => (cur[recordId] ? { ...cur, [recordId]: null } : cur));
    setCaret(clamp(index, 0, sequence.length));
  }, [recordId, sequence.length]);

  const handleSequenceEditKey = useCallback((event: ReactKeyboardEvent) => {
    if (!isEditable) return;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && (event.key === 'z' || event.key === 'Z')) {
      event.preventDefault();
      if (event.shiftKey) redoEdit(); else undoEdit();
      return;
    }
    if (mod && (event.key === 'y' || event.key === 'Y')) { event.preventDefault(); redoEdit(); return; }
    if (mod) return;
    const c = caret;
    if (c === null) return;
    const len = sequence.length;
    const featureList = features as Feature[];
    switch (event.key) {
      case 'ArrowLeft': event.preventDefault(); setCaret(Math.max(0, c - 1)); return;
      case 'ArrowRight': event.preventDefault(); setCaret(Math.min(len, c + 1)); return;
      case 'Home': event.preventDefault(); setCaret(0); return;
      case 'End': event.preventDefault(); setCaret(len); return;
      case 'Backspace': event.preventDefault(); if (c > 0) commitEdit(applyDeletion(sequence, [], featureList, c - 1, 1), c - 1, { start: c - 1, deletedLength: 1, insertedLength: 0, oldLength: len }); return;
      case 'Delete': event.preventDefault(); if (c < len) commitEdit(applyDeletion(sequence, [], featureList, c, 1), c, { start: c, deletedLength: 1, insertedLength: 0, oldLength: len }); return;
      default: break;
    }
    if (event.key.length === 1) {
      const ch = event.key.toUpperCase();
      const alphabet = sequenceType === 'rna' ? RNA_EDIT_ALPHABET : DNA_EDIT_ALPHABET;
      if (!alphabet.includes(ch)) return;
      event.preventDefault();
      if (insertMode || c >= len) {
        commitEdit(applyInsertion(sequence, [], featureList, c - 1, ch), c + 1, { start: c, deletedLength: 0, insertedLength: 1, oldLength: len });
      } else {
        if (sequence[c]?.toUpperCase() === ch) {
          setCaret(c + 1);
          return;
        }
        commitEdit(applySubstitution(sequence, [], featureList, c, ch), c + 1, { start: c, deletedLength: 1, insertedLength: 1, oldLength: len });
      }
    }
  }, [isEditable, caret, sequence, features, sequenceType, insertMode, commitEdit, undoEdit, redoEdit]);

  const handleSequencePaste = useCallback((event: ReactClipboardEvent) => {
    if (!isEditable || caret === null) return;
    const alphabet = sequenceType === 'rna' ? RNA_EDIT_ALPHABET : DNA_EDIT_ALPHABET;
    const pasted = cleanPastedSequenceForEdit(event.clipboardData.getData('text/plain'), alphabet);
    if (!pasted) return;
    event.preventDefault();
    if (sequence.length + pasted.length > MOTIF_MAX_RECORD_LENGTH) {
      showWorkbenchNotice(`This paste would exceed the ${MOTIF_MAX_RECORD_LENGTH.toLocaleString()}-residue record limit.`, 'error');
      return;
    }
    commitEdit(
      applyInsertion(sequence, [], features as Feature[], caret - 1, pasted),
      caret + pasted.length,
      { start: caret, deletedLength: 0, insertedLength: pasted.length, oldLength: sequence.length },
    );
  }, [caret, commitEdit, features, isEditable, sequence, sequenceType, showWorkbenchNotice]);

  const addRecords = useCallback((recordInputs: readonly ArtifactRecordInput[]): number => {
    if (recordInputs.length === 0) return 0;
    const current = payloadRef.current;
    if (current.records.length + recordInputs.length > MOTIF_MAX_RECORDS) {
      showWorkbenchNotice(`Adding ${recordInputs.length} records would exceed the ${MOTIF_MAX_RECORDS}-record artifact limit. No records were added.`, 'error');
      return 0;
    }

    const sanitizedRecordInputs = recordInputs.map((recordInput) => (
      omitUndefinedObjectProperties(recordInput)
    ));

    try {
      // The UI import path accepts the same shapes as motifAddRecords. Internal
      // React builders may carry optional `undefined` keys, so remove those
      // object properties before enforcing the complete runtime contract. The
      // public window.motifAddRecords path remains deliberately strict.
      validateRuntimeRecordInputs(sanitizedRecordInputs, 'motifAddRecords');
    } catch (error) {
      showWorkbenchNotice(actionableImportError(error), 'error');
      return 0;
    }

    const additions: ArtifactVector[] = [];
    for (const [index, recordInput] of sanitizedRecordInputs.entries()) {
      const normalized = normalizeRecord(recordInput, current.records.length + index);
      // Validation above makes this defensive branch unreachable for supported
      // inputs. Keep the batch untouched if normalization ever grows stricter.
      if (!normalized) {
        showWorkbenchNotice('The import could not be normalized. No records were added.', 'error');
        return 0;
      }
      const id = uniqueRecordId(normalized.id, [...current.records, ...additions]);
      additions.push({ ...normalized, id, default: false });
    }

    const traceSampleEntries = [...current.records, ...additions].reduce((total, record) => (
      total + (record.sangerTrace ? artifactSangerTraceSampleEntries(record.sangerTrace) : 0)
    ), 0);
    if (traceSampleEntries > ARTIFACT_SANGER_MAX_WORKSPACE_SAMPLE_ENTRIES) {
      showWorkbenchNotice(`Adding these traces would exceed the ${ARTIFACT_SANGER_MAX_WORKSPACE_SAMPLE_ENTRIES.toLocaleString()}-sample workspace limit. No records were added.`, 'error');
      return 0;
    }

    const selectedAddition = additions[additions.length - 1];
    const nextPayload = { ...current, records: [...current.records, ...additions] };
    rememberActiveSequenceScroll();
    payloadRef.current = nextPayload;
    selectedRecordIdRef.current = selectedAddition.id;
    setSelectedRecordId(selectedAddition.id);
    setSelection(null);
    setPayload(nextPayload);
    return additions.length;
  }, [rememberActiveSequenceScroll, showWorkbenchNotice]);

  const addRecord = useCallback((recordInput: ArtifactRecordInput): boolean => (
    addRecords([recordInput]) === 1
  ), [addRecords]);

  const saveDigestWorkflow = useCallback((recipe: DigestRecipe): DigestSaveReceipt | null => {
    const current = payloadRef.current;
    const derivedCount = recipe.outcome === 'uncut' ? 0 : recipe.fragments.length;
    if (current.records.length + derivedCount > MOTIF_MAX_RECORDS) {
      showWorkbenchNotice(
        `Saving ${derivedCount} digest fragment${derivedCount === 1 ? '' : 's'} would exceed the ${MOTIF_MAX_RECORDS}-record artifact limit. Nothing was saved.`,
        'error',
      );
      return null;
    }

    const workflowResultId = `digest-${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    const enzymeLabel = recipe.enzymes.map((entry) => entry.name).join(' + ');
    const usedNames = new Set(current.records.map((record) => record.name.trim().toLocaleLowerCase()));
    const uniqueOutputName = (base: string): string => {
      if (!usedNames.has(base.toLocaleLowerCase())) {
        usedNames.add(base.toLocaleLowerCase());
        return base;
      }
      for (let suffix = 2; suffix < 10_000; suffix += 1) {
        const candidate = `${base} (${suffix})`;
        if (!usedNames.has(candidate.toLocaleLowerCase())) {
          usedNames.add(candidate.toLocaleLowerCase());
          return candidate;
        }
      }
      return `${base} · ${workflowResultId.slice(-8)}`;
    };
    const outputIdentities = derivedCount === 0 ? [] : recipe.fragments.map((fragment, index) => {
      const endLabel = [fragment.leftEnzyme, fragment.rightEnzyme]
        .filter((value): value is string => Boolean(value))
        .filter((value, valueIndex, values) => values.indexOf(value) === valueIndex)
        .join('–');
      const baseName = recipe.outcome === 'linearized'
        ? `${vector.name} · linearized${endLabel ? ` (${endLabel})` : ''}`
        : `${vector.name} · digest fragment ${index + 1}${endLabel ? ` (${endLabel})` : ''}`;
      return {
        id: `${workflowResultId}-${recipe.outcome === 'linearized' ? 'linearized' : `fragment-${index + 1}`}`,
        name: uniqueOutputName(baseName),
      };
    });

    try {
      const materialized = materializeDigestWorkflow({
        sourceRecord: {
          id: vector.id,
          name: vector.name,
          sequence: vector.sequence,
          type: vector.type,
          topology: vector.topology,
          translationTableId: vector.translationTableId,
          active: vector.active,
          features: vector.features,
          description: vector.description,
          organism: vector.organism,
          source: vector.source,
          group: vector.group,
          tags: vector.tags,
        },
        recipe,
        workflow: {
          id: workflowResultId,
          createdAt,
          name: `${enzymeLabel || 'Restriction'} digest of ${vector.name}`,
          source: 'motif-for-claude-science-artifact',
          engine: 'motif-for-claude-science-artifact',
          engineVersion: MOTIF_ARTIFACT_VERSION,
          inputSha256: sha256HexSync(vector.sequence),
        },
        outputIdentities,
        existingRecordIds: current.records.map((record) => record.id),
        existingRecordNames: current.records.map((record) => record.name),
      });
      const sanitizedInputs = materialized.records.map((record) => (
        omitUndefinedObjectProperties(record) as ArtifactRecordInput
      ));
      validateRuntimeRecordInputs(sanitizedInputs, 'motifAddRecords');
      const additions = sanitizedInputs.map((recordInput, index) => {
        const normalized = normalizeRecord(recordInput, current.records.length + index);
        if (!normalized) throw new Error(`Digest fragment ${index + 1} could not be normalized.`);
        return { ...normalized, default: false };
      });
      const recordLengths = new Map<string, number>([
        ...current.records.map((record): [string, number] => [record.id, record.sequence.length]),
        ...additions.map((record): [string, number] => [record.id, record.sequence.length]),
      ]);
      const workflowResults = appendArtifactWorkflowResult(
        current.workflowResults,
        materialized.workflowResult,
        { recordLengths },
      );
      const nextPayload: LoadedPayload = {
        ...current,
        records: [...current.records, ...additions],
        workflowResults,
      };
      payloadRef.current = nextPayload;
      setPayload(nextPayload);
      return { workflowResultId, recordCount: additions.length };
    } catch (error) {
      showWorkbenchNotice(
        error instanceof Error ? `Digest was not saved: ${error.message}` : 'Digest was not saved.',
        'error',
      );
      return null;
    }
  }, [showWorkbenchNotice, vector]);

  const updateRecordDetails = useCallback((details: { name: string; description?: string; group?: string }) => {
    const nextName = details.name.trim();
    if (!nextName) return;
    const nextDescription = details.description?.trim() || undefined;
    const nextGroup = details.group?.trim() || undefined;
    if (nextName.length > MOTIF_MAX_SHORT_TEXT_LENGTH || (nextGroup?.length ?? 0) > MOTIF_MAX_SHORT_TEXT_LENGTH || (nextDescription?.length ?? 0) > MOTIF_MAX_DESCRIPTION_LENGTH) {
      showWorkbenchNotice(`Entry names and groups are limited to ${MOTIF_MAX_SHORT_TEXT_LENGTH.toLocaleString()} characters; descriptions to ${MOTIF_MAX_DESCRIPTION_LENGTH.toLocaleString()}.`, 'error');
      return;
    }
    setPayload((current) => ({
      ...current,
      records: current.records.map((record) => (
        record.id === recordId
          ? { ...record, name: nextName, description: nextDescription, group: nextGroup }
          : record
      )),
    }));
  }, [recordId, showWorkbenchNotice]);

  const updateRecordTranslationTableId = useCallback((translationTableId: number) => {
    if (!isSupportedArtifactTranslationTableId(translationTableId)) return;
    setPayload((current) => ({
      ...current,
      records: current.records.map((record) => (
        record.id === recordId ? { ...record, translationTableId } : record
      )),
    }));
  }, [recordId]);

  const deleteActiveRecord = useCallback(() => {
    const deletedName = vector.name;
    const removed = removeRecords(recordId);
    if (removed === 0) return;
    showWorkbenchNotice(`Deleted ${deletedName}. Linked notes, alignments, and results were removed with it.`, 'status');
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const nextRecord = document.querySelector<HTMLButtonElement>('.motif-cs-record-tab[data-active="true"]');
      (nextRecord ?? document.querySelector<HTMLButtonElement>('.motif-cs-add-entry-button'))?.focus({ preventScroll: true });
    }));
  }, [recordId, removeRecords, showWorkbenchNotice, vector.name]);

  // Drag a FASTA / GenBank file anywhere onto the workbench to import it — the
  // same parser the Add-sequence panel uses, so raw / FASTA / GenBank all work.
  const importFiles = useCallback(async (files: FileList | File[], showDropFeedback = true): Promise<ArtifactFileImportResult> => {
    const pendingFiles = Array.from(files);
    const loadedFiles: Array<{ file: File; text: string }> = [];
    const sangerRecords: ArtifactRecordInput[] = [];
    const errors: string[] = [];
    let pendingTraceSampleEntries = payloadRef.current.records.reduce((total, record) => (
      total + (record.sangerTrace ? artifactSangerTraceSampleEntries(record.sangerTrace) : 0)
    ), 0);
    for (const file of pendingFiles) {
      try {
        if (/\.(?:ab1|abi)$/i.test(file.name)) {
          if (file.size > ABI_IMPORT_LIMITS.maxFileBytes) {
            throw new Error(`AB1 files cannot exceed ${Math.round(ABI_IMPORT_LIMITS.maxFileBytes / (1024 * 1024))} MB.`);
          }
          const baseName = file.name.replace(/\.[^.]+$/, '') || 'Imported chromatogram';
          const parsed = parseAbiImport(await file.arrayBuffer(), baseName);
          const parsedTraceEntries = artifactSangerTraceSampleEntries(parsed.sangerTrace);
          if (pendingTraceSampleEntries + parsedTraceEntries > ARTIFACT_SANGER_MAX_WORKSPACE_SAMPLE_ENTRIES) {
            throw new Error(`This plate would exceed the ${ARTIFACT_SANGER_MAX_WORKSPACE_SAMPLE_ENTRIES.toLocaleString()}-sample workspace trace limit.`);
          }
          pendingTraceSampleEntries += parsedTraceEntries;
          const sampleName = parsed.sangerTrace.metadata.sampleName?.trim();
          const preferredName = importDefaults.name.trim() || sampleName || baseName;
          sangerRecords.push(...applyImportDefaults([{
            id: safeSlug(preferredName),
            name: preferredName,
            description: parsed.warnings.length > 0
              ? `Sanger chromatogram imported with ${parsed.warnings.length} parser warning${parsed.warnings.length === 1 ? '' : 's'}.`
              : 'Sanger chromatogram with base calls, quality scores, peak locations, and four dye channels.',
            molecule: 'dna',
            topology: 'linear',
            seq: parsed.sequence,
            source: 'ABI/AB1 chromatogram',
            group: importDefaults.group.trim() || undefined,
            dateAdded: new Date().toISOString(),
            tags: ['sanger', 'ab1'],
            active: true,
            sangerTrace: parsed.sangerTrace,
            provenance: {
              operation: 'import_ab1',
              fileName: file.name,
              format: 'ABIF',
              warnings: parsed.warnings,
            },
          }], { ...importDefaults, type: 'dna', topology: 'linear' }));
          continue;
        }
        const text = await file.text();
        loadedFiles.push({ file, text });
      } catch (error) {
        errors.push(`${file.name}: ${actionableImportError(error)}`);
      }
    }

    const databaseFiles: Array<{ file: File; database: Record<string, unknown> }> = [];
    const ordinaryFiles: Array<{ file: File; text: string }> = [];
    for (const loaded of loadedFiles) {
      try {
        const database = parseArtifactDatabaseJson(loaded.text);
        if (database) databaseFiles.push({ file: loaded.file, database });
        else ordinaryFiles.push(loaded);
      } catch (error) {
        errors.push(`${loaded.file.name}: ${actionableImportError(error)}`);
      }
    }

    if (databaseFiles.length > 0) {
      if (databaseFiles.length !== 1 || ordinaryFiles.length > 0 || sangerRecords.length > 0 || errors.length > 0) {
        const message = 'Restore one Database JSON file at a time; no files were imported.';
        if (showDropFeedback) {
          setDropState({ active: true, message });
          window.setTimeout(() => setDropState({ active: false, message: '' }), 5000);
        }
        return { records: [], message, tone: 'error' };
      }
      const [{ file, database }] = databaseFiles;
      try {
        requestArtifactDatabaseRestore(database, file.name, null, 'durable-checkpoint');
        return { records: [], message: `Review the ${file.name} workspace restore.`, tone: 'status' };
      } catch (error) {
        const message = `${file.name}: ${actionableImportError(error)}`;
        if (showDropFeedback) {
          setDropState({ active: true, message });
          window.setTimeout(() => setDropState({ active: false, message: '' }), 5000);
        }
        return { records: [], message, tone: 'error' };
      }
    }

    const additions: ArtifactRecordInput[] = [...sangerRecords];
    for (const { file, text } of ordinaryFiles) {
      try {
        const baseName = file.name.replace(/\.[^.]+$/, '');
        const preferredName = importDefaults.name.trim() || baseName;
        additions.push(...applyImportDefaults(
          parseImportedRecords(text, preferredName, importDefaults.type, importDefaults.topology),
          importDefaults,
        ));
      } catch (error) {
        errors.push(`${file.name}: ${actionableImportError(error)}`);
      }
    }
    const added = addRecords(additions);
    const importMessage = errors.length > 0
      ? `${added > 0 ? `Imported ${added}; ` : ''}${errors[0]}`
      : added > 0
        ? `Imported ${added} record${added === 1 ? '' : 's'}`
        : 'No usable sequence found. Check the file format or choose the molecule type explicitly.';
    if (showDropFeedback) {
      setDropState({ active: true, message: importMessage });
      window.setTimeout(() => setDropState({ active: false, message: '' }), errors.length > 0 ? 5000 : 1600);
    }
    return {
      records: added > 0 ? payloadRef.current.records.slice(-added) : [],
      message: importMessage,
      tone: errors.length > 0 || added === 0 ? 'error' : 'status',
    };
  }, [addRecords, importDefaults, requestArtifactDatabaseRestore]);

  const dragHasFiles = (event: ReactDragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
  const handleDragEnter = useCallback((event: ReactDragEvent) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDropState({ active: true, message: 'Drop FASTA, GenBank, AB1, or Database JSON' });
  }, []);
  const handleDragOver = useCallback((event: ReactDragEvent) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }, []);
  const handleDragLeave = useCallback((event: ReactDragEvent) => {
    if (!dragHasFiles(event)) return;
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setDropState({ active: false, message: '' });
    }
  }, []);
  const handleDrop = useCallback((event: ReactDragEvent) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) void importFiles(files);
    else setDropState({ active: false, message: '' });
  }, [importFiles]);
  const importMsaRecords = useCallback((files: FileList | File[]) => importFiles(files, false), [importFiles]);

  const addFeature = useCallback((featureInput: ArtifactFeatureInput) => {
    if (features.length >= MOTIF_MAX_FEATURES_PER_RECORD) {
      showWorkbenchNotice(`A record can contain at most ${MOTIF_MAX_FEATURES_PER_RECORD.toLocaleString()} features.`, 'error');
      return;
    }
    setPayload((current) => {
      const currentRecord = current.records.find((record) => record.id === recordId);
      if (!currentRecord) return current;
      const feature = normalizeFeature(featureInput, currentRecord.features.length, currentRecord.sequence.length);
      if (!feature) return current;
      const nextFeature = {
        ...feature,
        id: uniqueFeatureId(feature.name, currentRecord.features),
      };
      setSelection({ kind: 'feature', id: nextFeature.id });
      return {
        ...current,
        records: current.records.map((record) => (
          record.id === recordId
            ? { ...record, features: [...record.features, nextFeature] }
            : record
        )),
      };
    });
  }, [features.length, recordId, showWorkbenchNotice]);

  const addFeatures = useCallback((featureInputs: readonly ArtifactFeatureInput[]) => {
    if (features.length + featureInputs.length > MOTIF_MAX_FEATURES_PER_RECORD) {
      showWorkbenchNotice(`Adding these features would exceed the ${MOTIF_MAX_FEATURES_PER_RECORD.toLocaleString()}-feature record limit. No features were added.`, 'error');
      return;
    }
    setPayload((current) => {
      const currentRecord = current.records.find((record) => record.id === recordId);
      if (!currentRecord) return current;
      const nextFeatures = [...currentRecord.features];
      for (const featureInput of featureInputs) {
        const feature = normalizeFeature(featureInput, nextFeatures.length, currentRecord.sequence.length);
        if (!feature) continue;
        nextFeatures.push({
          ...feature,
          id: uniqueFeatureId(feature.name, nextFeatures),
        });
      }
      if (nextFeatures.length === currentRecord.features.length) return current;
      return {
        ...current,
        records: current.records.map((record) => (
          record.id === recordId ? { ...record, features: nextFeatures } : record
        )),
      };
    });
  }, [features.length, recordId, showWorkbenchNotice]);

  // Open the prefilled feature editor for the current selection. Creating a
  // durable annotation should remain an explicit, named action rather than a
  // silent generic feature mutation.
  const handleAnnotateRange = useCallback(() => {
    if (!selectedMapRange || !canAnnotateSelectedMapRange) return;
    setSelection(null);
    requestFeatureEditor();
  }, [canAnnotateSelectedMapRange, selectedMapRange]);

  const markFeatureTranslationLayersForReview = useCallback((featureId: string) => {
    updateTranslationLayers((current) => {
      const layers = current[recordId] ?? [];
      if (!layers.some((layer) => layer.featureId === featureId && !layer.needsReview)) return current;
      return {
        ...current,
        [recordId]: layers.map((layer) => (
          layer.featureId === featureId ? { ...layer, needsReview: true } : layer
        )),
      };
    });
  }, [recordId, updateTranslationLayers]);

  const updateFeature = useCallback((featureId: string, featureInput: ArtifactFeatureInput) => {
    const featureIndex = features.findIndex((feature) => feature.id === featureId);
    const existingFeature = features[featureIndex];
    if (!existingFeature) return;
    const feature = normalizeFeature(
      { ...existingFeature, ...featureInput, id: featureId },
      featureIndex,
      sequence.length,
    );
    if (!feature) return;
    if (featureTranslationSignature(existingFeature) !== featureTranslationSignature(feature)) {
      markFeatureTranslationLayersForReview(featureId);
    }
    setPayload((current) => ({
      ...current,
      records: current.records.map((record) => (
        record.id === recordId
          ? {
              ...record,
              features: record.features.map((currentFeature) => (
                currentFeature.id === featureId ? { ...feature, id: featureId } : currentFeature
              )),
            }
          : record
      )),
    }));
    setSelection({ kind: 'feature', id: featureId });
  }, [features, markFeatureTranslationLayersForReview, recordId, sequence.length]);

  const updateTranslationCodeForTarget = useCallback((translationTableId: number) => {
    if (!isSupportedArtifactTranslationTableId(translationTableId)) return;
    if (translateTarget.translationTableId !== undefined) {
      if (selectedTranslationLayer) {
        updateTranslationLayers((current) => ({
          ...current,
          [recordId]: (current[recordId] ?? []).map((layer) => (
            layer.id === selectedTranslationLayer.id
              ? { ...layer, translationTableId }
              : layer
          )),
        }));
      }
      setLockedTranslateTarget((current) => current?.recordId === recordId
        ? { ...current, target: { ...current.target, translationTableId } }
        : current);
      return;
    }
    const featureId = translateTargetCodeFeature?.id;
    if (featureId) markFeatureTranslationLayersForReview(featureId);
    setPayload((current) => ({
      ...current,
      records: current.records.map((record) => {
        if (record.id !== recordId) return record;
        if (!featureId) return { ...record, translationTableId };
        return {
          ...record,
          features: record.features.map((feature) => {
            if (feature.id !== featureId) return feature;
            const metadata: Record<string, unknown> = {
              ...feature.metadata,
              transl_table: translationTableId,
            };
            delete metadata.translTable;
            delete metadata.translationTableId;
            return { ...feature, metadata };
          }),
        };
      }),
    }));
    setLockedTranslateTarget((current) => {
      if (!current || current.recordId !== recordId) return current;
      return {
        ...current,
        target: {
          ...current.target,
          translationTableId: featureId ? undefined : translationTableId,
        },
      };
    });
  }, [markFeatureTranslationLayersForReview, recordId, selectedTranslationLayer, translateTarget.translationTableId, translateTargetCodeFeature?.id, updateTranslationLayers]);

  const deleteFeature = useCallback((featureId: string) => {
    markFeatureTranslationLayersForReview(featureId);
    setPayload((current) => {
      const currentRecord = current.records.find((record) => record.id === recordId);
      if (!currentRecord || !currentRecord.features.some((feature) => feature.id === featureId)) return current;
      const nextFeatures = currentRecord.features.filter((feature) => feature.id !== featureId);
      setSelection((currentSelection) => (
        currentSelection?.kind === 'feature' && currentSelection.id === featureId
          ? null
          : currentSelection
      ));
      return {
        ...current,
        records: current.records.map((record) => (
          record.id === recordId ? { ...record, features: nextFeatures } : record
        )),
      };
    });
  }, [markFeatureTranslationLayersForReview, recordId]);

  const addReverseComplementRecord = useCallback(() => {
    if (!isNucleotideType(sequenceType)) return;
    const isRna = sequenceType === 'rna';
    addRecord({
      id: `${recordId}-reverse-complement`,
      name: `${vector.name} reverse complement`,
      description: `Reverse complement generated with Motif from ${vector.name}.`,
      molecule: sequenceType,
      topology,
      translationTableId: vector.translationTableId,
      seq: reverseComplement(sequence, isRna),
      overhang5: vector.overhang3 === undefined ? undefined : reverseComplement(vector.overhang3),
      overhang3: vector.overhang5 === undefined ? undefined : reverseComplement(vector.overhang5),
      overhang5Type: vector.overhang3Type,
      overhang3Type: vector.overhang5Type,
      annotations: reverseComplementFeatures(features as Feature[], sequence.length).map((feature) => ({
        ...feature,
        metadata: { ...feature.metadata, sourceRecordId: recordId, generatedBy: 'reverse_complement' },
      })),
      sites: serializeSites(reverseComplementRestrictionSites(vector.sites, sequence.length)),
      active: true,
      source: 'Motif for Claude Science',
      group: vector.group,
      provenance: { parentRecordId: recordId, operation: 'reverse_complement' },
    });
  }, [
    addRecord,
    features,
    recordId,
    sequence,
    sequenceType,
    topology,
    vector.group,
    vector.name,
    vector.overhang3,
    vector.overhang3Type,
    vector.overhang5,
    vector.overhang5Type,
    vector.sites,
    vector.translationTableId,
  ]);

  const addSelectionReverseComplementRecord = useCallback(() => {
    if (!isNucleotideType(sequenceType) || !inspectorSelectionSeq || !selectionSummary) return;
    const isRna = sequenceType === 'rna';
    const selectedFeatureCode = selectedFeature && TRANSLATION_CODE_FEATURE_TYPES.has(selectedFeature.type)
      ? resolveArtifactTranslationCode(vector.translationTableId, selectedFeature.metadata)
      : null;
    const selectedFeatureMetadata: Record<string, unknown> | null = selectedFeature ? {
      ...selectedFeature.metadata,
      sourceRecordId: recordId,
      sourceFeatureId: selectedFeature.id,
      generatedBy: 'reverse_complement_selection',
    } : null;
    if (selectedFeatureMetadata) {
      const sourceOriginalLocation = typeof selectedFeature?.metadata.motifOriginalLocation === 'string'
        ? selectedFeature.metadata.motifOriginalLocation
        : null;
      if (selectedFeature?.metadata.motifLocationFuzzy === true || (sourceOriginalLocation && /[<>]/.test(sourceOriginalLocation))) {
        selectedFeatureMetadata.partial = true;
        selectedFeatureMetadata.sourceMotifLocationFuzzy = true;
        if (sourceOriginalLocation) selectedFeatureMetadata.sourceMotifOriginalLocation = sourceOriginalLocation;
      }
      delete selectedFeatureMetadata.motifOriginalLocation;
      delete selectedFeatureMetadata.motifOriginalLocationSignature;
      delete selectedFeatureMetadata.motifLocationFuzzy;
      delete selectedFeatureMetadata.motifSubRangeOrder;
      delete selectedFeatureMetadata.motifSubRangeOrderAmbiguous;
      delete selectedFeatureMetadata.motifLocationOperator;
    }
    addRecord({
      name: `${vector.name} · ${selectionSummary.label} reverse complement`,
      description: `Reverse complement of ${selectionSummary.label} from ${vector.name}, generated with Motif.`,
      molecule: sequenceType,
      topology: 'linear',
      translationTableId: selectedFeatureCode?.supported ? selectedFeatureCode.id : vector.translationTableId,
      seq: reverseComplement(inspectorSelectionSeq, isRna),
      annotations: selectedFeature ? [{
        name: `${selectedFeature.name} reverse-complement source`,
        type: selectedFeature.type,
        start: 0,
        end: inspectorSelectionSeq.length,
        strand: selectedFeature.strand === 0 ? 0 : -1,
        color: selectedFeature.color,
        metadata: selectedFeatureMetadata ?? {},
      }] : undefined,
      active: true,
      source: 'Motif for Claude Science',
      group: vector.group,
      provenance: {
        parentRecordId: recordId,
        operation: 'reverse_complement',
        selection: selectionSummary.label,
      },
    });
  }, [addRecord, inspectorSelectionSeq, recordId, selectedFeature, selectionSummary, sequenceType, vector.group, vector.name, vector.translationTableId]);

  const addContextReverseComplementRecord = useCallback(() => {
    if (selectionSummary) {
      if (hasMaterializableSequenceSelection) addSelectionReverseComplementRecord();
      return;
    }
    addReverseComplementRecord();
  }, [addReverseComplementRecord, addSelectionReverseComplementRecord, hasMaterializableSequenceSelection, selectionSummary]);

  const addSelectedFeatureRecord = useCallback(() => {
    if (!selectedFeature) return;
    const extractedSequence = sequenceForFeature(sequence, selectedFeature, sequenceType);
    if (!extractedSequence) return;
    const featureTranslationCode = resolveArtifactTranslationCode(
      vector.translationTableId,
      TRANSLATION_CODE_FEATURE_TYPES.has(selectedFeature.type) ? selectedFeature.metadata : undefined,
    );
    addRecord({
      name: `${vector.name} · ${selectedFeature.name}`,
      description: `${selectedFeature.name} extracted from ${vector.name}, generated with Motif.`,
      molecule: sequenceType,
      topology: 'linear',
      translationTableId: isNucleotideType(sequenceType) && featureTranslationCode.supported
        ? featureTranslationCode.id
        : vector.translationTableId,
      seq: extractedSequence,
      annotations: [{
        name: selectedFeature.name,
        type: selectedFeature.type,
        start: 0,
        end: extractedSequence.length,
        strand: sequenceType === 'protein' ? 0 : 1,
        color: selectedFeature.color,
        metadata: {
          ...selectedFeature.metadata,
          sourceRecordId: recordId,
          sourceFeatureId: selectedFeature.id,
          sourceStrand: selectedFeature.strand,
          generatedBy: 'extract_feature',
        },
      }],
      active: true,
      source: 'Motif for Claude Science',
      group: vector.group,
      provenance: {
        parentRecordId: recordId,
        operation: 'extract_feature',
        selection: `${selectedFeature.name} ${featureRangeLabel(selectedFeature)}`,
      },
    });
  }, [addRecord, recordId, selectedFeature, sequence, sequenceType, vector.group, vector.name, vector.translationTableId]);

  // One "New protein record" for the current translate target (selection or whole),
  // honoring the chosen strand + frame.
  const addPreviewTranslationRecord = useCallback(() => {
    if (!previewProtein || !translationCode.supported) return;
    const strandLabel = translateStrand === 'antisense' ? ' (antisense)' : '';
    const nameStrandLabel = translateStrand === 'antisense' ? ' antisense' : '';
    const frameLabel = `+${translateFrame + 1}`;
    const nameFrameLabel = ` ${frameLabel}`;
    addRecord({
      name: `${vector.name} · ${translateTarget.label}${nameStrandLabel}${nameFrameLabel} protein`,
      description: `Protein translation of ${translateTarget.label}${strandLabel}, frame ${frameLabel}, from ${vector.name}, using ${artifactTranslationCodeLabel(translationCode)}, generated with Motif.`,
      molecule: 'protein',
      topology: 'linear',
      seq: previewProtein,
      active: true,
      source: 'Motif for Claude Science',
      group: vector.group,
      provenance: {
        parentRecordId: recordId,
        parentSequenceSha256: sha256HexSync(sequence),
        operation: 'translate',
        selection: translateTarget.label,
        rangeStart: translateTarget.start,
        rangeEnd: translateTarget.end,
        coordinateSystem: 'zero-based-half-open',
        strand: translateStrand,
        frame: frameLabel,
        completeCds: !!previewTrack?.completeCds,
        translationMode: previewTrack?.completeCds ? 'complete-cds' : 'arbitrary-range',
        translationTableId: translationCode.id,
        translationTableName: translationCode.name,
        translationTableSource: translateTarget.translationSource === 'layer'
          ? 'pinned-layer'
          : translateTarget.translationSource ?? translationCode.source,
        ...(translateTargetFeature ? {
          sourceFeatureId: translateTargetFeature.id,
          sourceFeatureLocation: genBankLocation(translateTargetFeature),
          sourceFeatureCoordinateSignature: featureLocationCoordinateSignature(translateTargetFeature),
        } : {}),
      },
    });
    setShowTranslations(false);
  }, [addRecord, previewProtein, previewTrack?.completeCds, recordId, sequence, translateTarget, translateTargetFeature, translateStrand, translateFrame, translationCode, vector.group, vector.name]);
  const addSelectionTranslationRecord = addPreviewTranslationRecord;

  const addTranslationTrackRecord = useCallback((track: InlineTranslationTrack) => {
    if (track.needsReview) {
      showWorkbenchNotice('Review and update this pinned translation before creating a protein.', 'error');
      return;
    }
    const protein = inlineTrackResidues(sequence, sequenceType, track, topology).map((residue) => residue.aa).join('');
    if (!protein) return;
    const trackCode = resolveArtifactTranslationCode(track.translationTableId);
    if (!trackCode.supported) return;
    const sourceFeature = track.featureId
      ? features.find((feature) => feature.id === track.featureId) ?? null
      : null;
    const strand = track.strand === -1 ? 'antisense' : 'sense';
    const frame = `+${track.frame + 1}`;
    addRecord({
      name: `${vector.name} · ${track.label} ${strand} ${frame} protein`,
      description: `Protein translation of ${track.label}, ${strand} frame ${frame}, from ${vector.name}, using ${artifactTranslationCodeLabel(trackCode)}, generated with Motif.`,
      molecule: 'protein',
      topology: 'linear',
      seq: protein,
      active: true,
      source: 'Motif for Claude Science',
      group: vector.group,
      provenance: {
        parentRecordId: recordId,
        parentSequenceSha256: sha256HexSync(sequence),
        operation: 'translate',
        selection: track.label,
        rangeStart: track.start,
        rangeEnd: track.end,
        coordinateSystem: 'zero-based-half-open',
        strand,
        frame,
        completeCds: !!track.completeCds,
        translationMode: track.completeCds ? 'complete-cds' : 'arbitrary-range',
        translationTableId: trackCode.id,
        translationTableName: trackCode.name,
        translationTableSource: track.source === 'feature' ? 'feature' : 'pinned-layer',
        ...(track.featureId ? { sourceFeatureId: track.featureId } : {}),
        ...(sourceFeature ? {
          sourceFeatureLocation: genBankLocation(sourceFeature),
          sourceFeatureCoordinateSignature: featureLocationCoordinateSignature(sourceFeature),
        } : {}),
      },
    });
  }, [addRecord, features, recordId, sequence, sequenceType, showWorkbenchNotice, topology, vector.group, vector.name]);

  // Pin the current translate target as a persistent inline amino-acid layer
  // (renders above the bases if sense, below if antisense).
  const addTranslationLayer = useCallback((options?: { select?: boolean }) => {
    if (!previewTrack || translateTarget.whole) return;
    const equivalentTrack = inlineTranslationTracks.find((track) => (
      track.start === previewTrack.start
      && track.end === previewTrack.end
      && track.strand === previewTrack.strand
      && track.frame === previewTrack.frame
      && track.translationTableId === previewTrack.translationTableId
      && !!track.completeCds === !!previewTrack.completeCds
    ));
    if (equivalentTrack) {
      if (options?.select !== false) {
        setSelectedTranslationLayerByRecord((current) => ({ ...current, [recordId]: equivalentTrack.id }));
      }
      return;
    }
    if (translationLayers.length >= MAX_TRANSLATION_LAYERS_PER_RECORD) {
      showWorkbenchNotice(`A record can contain at most ${MAX_TRANSLATION_LAYERS_PER_RECORD} pinned translation layers.`, 'error');
      return;
    }
    const layer: InlineTranslationTrack = {
      ...previewTrack,
      id: `layer:${crypto.randomUUID()}`,
      label: `${translateTarget.label} ${translateStrand === 'antisense' ? '−' : '+'}${translateFrame + 1}`.slice(0, MAX_TRANSLATION_LAYER_TEXT_LENGTH),
      source: 'layer',
      color: previewTrack.strand === -1 ? '#c6737b' : '#7e9bbf',
    };
    updateTranslationLayers((current) => {
      const existing = current[recordId] ?? [];
      if (existing.some((entry) => entry.id === layer.id)) return current;
      return { ...current, [recordId]: [...existing, layer] };
    });
    if (options?.select !== false) {
      setSelectedTranslationLayerByRecord((current) => ({ ...current, [recordId]: layer.id }));
    }
  }, [inlineTranslationTracks, previewTrack, recordId, showWorkbenchNotice, translateFrame, translateStrand, translateTarget, translationLayers.length, updateTranslationLayers]);
  const clearTranslationLayers = useCallback(() => {
    updateTranslationLayers((current) => (current[recordId]?.length ? { ...current, [recordId]: [] } : current));
    setSelectedTranslationLayerByRecord((current) => (current[recordId] ? { ...current, [recordId]: null } : current));
  }, [recordId, updateTranslationLayers]);

  const updateTranslationLayer = useCallback((layerId: string, patch: Partial<Omit<InlineTranslationTrack, 'id' | 'source'>>) => {
    const existingLayer = translationLayers.find((layer) => layer.id === layerId);
    if (!existingLayer) return;
    const nextLayer: InlineTranslationTrack = {
      ...existingLayer,
      ...patch,
      needsReview: false,
      source: 'layer',
    };
    updateTranslationLayers((current) => {
      const layers = current[recordId] ?? [];
      if (!layers.some((layer) => layer.id === layerId)) return current;
      return {
        ...current,
        [recordId]: layers.map((layer) => (
          layer.id === layerId ? nextLayer : layer
        )),
      };
    });
    setLockedTranslateTarget({
      recordId,
      target: {
        start: nextLayer.start,
        end: nextLayer.end,
        label: nextLayer.label,
        defaultStrand: nextLayer.strand === -1 ? 'antisense' : 'sense',
        defaultFrame: nextLayer.frame,
        key: `layer:${nextLayer.id}:${nextLayer.start}:${nextLayer.end}:${nextLayer.strand}:${nextLayer.frame}:table-${nextLayer.translationTableId}:${nextLayer.completeCds ? 'cds' : 'range'}`,
        whole: false,
        translationTableId: nextLayer.translationTableId,
        featureId: nextLayer.featureId,
        completeCds: nextLayer.completeCds,
        translationSource: 'layer',
      },
    });
    setSelectedTranslationLayerByRecord((current) => ({ ...current, [recordId]: layerId }));
  }, [recordId, translationLayers, updateTranslationLayers]);

  const deleteTranslationLayer = useCallback((layerId: string) => {
    if (layerId.startsWith('feat:')) {
      setHiddenFeatureTranslationsByRecord((current) => {
        const hidden = current[recordId] ?? [];
        if (hidden.includes(layerId)) return current;
        return { ...current, [recordId]: [...hidden, layerId] };
      });
    } else {
      updateTranslationLayers((current) => {
        const layers = current[recordId] ?? [];
        if (!layers.some((layer) => layer.id === layerId)) return current;
        return { ...current, [recordId]: layers.filter((layer) => layer.id !== layerId) };
      });
    }
    setSelectedTranslationLayerByRecord((current) => (
      current[recordId] === layerId ? { ...current, [recordId]: null } : current
    ));
    setLockedTranslateTarget(null);
  }, [recordId, updateTranslationLayers]);

  // Selection-bar "Translate": pin the translation inline (sense reads above the
  // selected bases, antisense below). The floating Translations window opens only
  // from the global Translate control, so this action does not spawn surprise UI.
  const translateSelectionInline = useCallback(() => {
    // Keep the new layer selected without opening another surface. The same
    // stable action dock can then remove it immediately with "Del AA".
    addTranslationLayer();
    setSequenceViewMode('detail');
  }, [addTranslationLayer]);

  /* Converts the MOLECULE. Reached from Entry Details only — the map's "Draw as"
     control no longer comes here, which is the whole point of #34. Still clears
     the selection, caret and map range, because after a conversion those really
     can mean something different. */
  const convertRecordTopology = useCallback((nextTopology: Topology) => {
    if (!canToggleTopology) return;
    if (nextTopology === topology) return;
    // Drop any explicit drawing choice for this record so the map goes back to
    // showing the molecule as it now is. Leaving it would mean converting to
    // linear and still seeing a ring, which is the same class of lie in reverse.
    setMapRenderModeByRecord((current) => {
      if (!(recordId in current)) return current;
      const next = { ...current };
      delete next[recordId];
      return next;
    });
    setPayload((current) => {
      const nextPayload: LoadedPayload = {
        ...current,
        records: current.records.map((record) => (
          record.id === recordId ? { ...record, topology: nextTopology } : record
        )),
      };
      payloadRef.current = nextPayload;
      return nextPayload;
    });
    setSelection((current) => (current?.kind === 'feature' ? current : null));
    setCaret(null);
    setMapRangesByRecord((current) => {
      if (!current[recordId]) return current;
      return { ...current, [recordId]: null };
    });
  }, [canToggleTopology, recordId, topology]);

  const addCustomEnzyme = useCallback((name: string, recognition: string): string | null => {
    const cleanName = name.trim();
    if (cleanName.length > MAX_CUSTOM_ENZYME_NAME_LENGTH) return `Enzyme names are limited to ${MAX_CUSTOM_ENZYME_NAME_LENGTH} characters`;
    if (recognition.length > MAX_CUSTOM_ENZYME_RECOGNITION_LENGTH) return `Recognition sequences are limited to ${MAX_CUSTOM_ENZYME_RECOGNITION_LENGTH} characters`;
    const known = cleanName ? fullEnzymeByLowerName.get(cleanName.toLowerCase()) : null;
    const rec = recognition.toUpperCase().replace(/[^ACGTRYSWKMBDHVN]/g, '');
    if (!known && rec.length < 3) return 'Enter a known enzyme name or recognition sequence (≥3 bases, IUPAC ok)';
    const enzyme = known ?? createCenteredBluntEnzyme(cleanName || rec, rec);
    let outcome: string | null = null;
    setCustomEnzymes((current) => {
      if (current.some((entry) => entry.name.toLowerCase() === enzyme.name.toLowerCase())) {
        outcome = `${enzyme.name} is already added`;
        return current;
      }
      if (current.length >= MAX_CUSTOM_ENZYMES) {
        outcome = `Custom enzymes are limited to ${MAX_CUSTOM_ENZYMES}`;
        return current;
      }
      return [...current, enzyme];
    });
    // Adding an enzyme is an explicit request to see it. Remove any stale
    // per-record hidden override without re-enabling a broader source group.
    setHiddenEnzymesByRecord((current) => {
      const hidden = new Set(current[recordId] ?? []);
      if (!hidden.delete(enzyme.name)) return current;
      return { ...current, [recordId]: Array.from(hidden).sort() };
    });
    return outcome;
  }, [recordId]);

  const setEnzymeSourceEnabled = useCallback((source: RestrictionEnzymeSourceId, enabled: boolean) => {
    const active = activeEnzymeSourcesRef.current;
    let next: RestrictionEnzymeSourceId[];
    if (source === 'all') {
      next = enabled ? ['all'] : [];
    } else {
      const set = new Set<RestrictionEnzymeSourceId>(active.filter((entry) => entry !== 'all'));
      if (enabled) set.add(source);
      else set.delete(source);
      next = Array.from(set);
    }
    activeEnzymeSourcesRef.current = next;
    // A source-button click is an explicit visibility choice. Only Hide sites
    // records a restorable set; otherwise Show sites could resurrect a source
    // the user deliberately turned off.
    delete lastVisibleEnzymeSourcesRef.current[recordId];
    setEnzymeSourcesByRecord((current) => ({ ...current, [recordId]: next }));
    if (enabled) unhideRestrictionSourceEnzymes(source === 'all' ? ['all'] : [source]);
  }, [recordId, unhideRestrictionSourceEnzymes]);

  const setEnzymeVisible = useCallback((enzyme: string, visible: boolean) => {
    setHiddenEnzymesByRecord((current) => {
      const next = new Set(current[recordId] ?? []);
      if (visible) next.delete(enzyme);
      else next.add(enzyme);
      return { ...current, [recordId]: Array.from(next).sort() };
    });
  }, [recordId]);

  const setAllEnzymesVisible = useCallback((visible: boolean) => {
    if (visible) {
      const active = activeEnzymeSourcesRef.current;
      const restore = active.length > 0
        ? active
        : lastVisibleEnzymeSourcesRef.current[recordId] ?? [];
      // Restore only an explicitly hidden source set. Choosing None in the source
      // controls remains sticky and never silently turns Common back on.
      if (active.length === 0 && restore.length > 0) {
        activeEnzymeSourcesRef.current = restore;
        setEnzymeSourcesByRecord((current) => ({ ...current, [recordId]: restore }));
      }
      setHiddenEnzymesByRecord((current) => ({ ...current, [recordId]: [] }));
      return;
    }
    if (activeEnzymeSourcesRef.current.length > 0) {
      lastVisibleEnzymeSourcesRef.current[recordId] = [...activeEnzymeSourcesRef.current];
    }
    // Hide the sites; do NOT clear the enzyme sources. `hiddenEnzymesByRecord`
    // already drives every display surface — the map ticks, the sequence cuts and
    // the inspector all filter through it — so emptying the source selection as
    // well hid nothing extra, and instead reached the data: exports and
    // `motifDescribe()` read the sources, so a control the user reads as "stop
    // drawing these" silently changed what a downloaded GenBank/CSV/JSON said
    // about the molecule. Measured on pUC19 before this change: the summary went
    // from "11 single cutters; 22 enzymes cut" to "0 single cutters; 0 enzymes
    // cut", and the exports quietly lost every non-Common source.
    setHiddenEnzymesByRecord((current) => ({
      ...current,
      [recordId]: enzymeNames,
    }));
  }, [enzymeNames, recordId]);

  const toggleRestrictionLabels = useCallback(() => {
    setRestrictionLabelsByRecord((current) => ({
      ...current,
      [recordId]: !showRestrictionLabels,
    }));
  }, [recordId, showRestrictionLabels]);

  const ensurePaneVisible = useCallback((pane: PaneKey) => {
    setPaneVisibility((current) => current[pane] ? current : { ...current, [pane]: true });
  }, []);

  useEffect(() => {
    floatingPaneRectsRef.current = floatingPaneRects;
  }, [floatingPaneRects]);

  useEffect(() => {
    const updateViewport = () => setFloatingViewport(floatingPaneViewport());
    updateViewport();
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  const paneElementForKey = useCallback((pane: PaneKey): HTMLElement | null => {
    if (pane === 'inventory') return inventoryColumnRef.current;
    if (pane === 'map') return mapColumnRef.current;
    if (pane === 'sequence') return sequenceColumnRef.current;
    return toolsInspectorRef.current;
  }, []);

  const bringFloatingPaneToFront = useCallback((pane: PaneKey) => {
    setFloatingPaneZOrder((current) => current[current.length - 1] === pane
      ? current
      : [...current.filter((candidate) => candidate !== pane), pane]);
  }, []);

  const popOutPane = useCallback((pane: PaneKey) => {
    setPaneVisibility((current) => current[pane] ? current : { ...current, [pane]: true });
    setPanePlacements((current) => current[pane] === 'floating'
      ? current
      : { ...current, [pane]: 'floating' });
    if (pane === 'tools') setToolsPinned(true);
    bringFloatingPaneToFront(pane);
    window.requestAnimationFrame(() => {
      paneElementForKey(pane)?.querySelector<HTMLButtonElement>('[data-pane-dock]')?.focus({ preventScroll: true });
    });
  }, [bringFloatingPaneToFront, paneElementForKey]);

  const dockPane = useCallback((pane: PaneKey) => {
    setPanePlacements((current) => current[pane] === 'docked'
      ? current
      : { ...current, [pane]: 'docked' });
    setFloatingPaneZOrder((current) => current.filter((candidate) => candidate !== pane));
    window.requestAnimationFrame(() => {
      paneElementForKey(pane)?.querySelector<HTMLButtonElement>('[data-pane-popout]')?.focus({ preventScroll: true });
    });
  }, [paneElementForKey]);

  const stopFloatingPaneInteraction = useCallback(() => {
    floatingPaneInteractionCleanupRef.current?.();
    floatingPaneInteractionCleanupRef.current = null;
    floatingPaneInteractionRef.current = null;
    delete document.body.dataset.motifCsPaneFloatingAction;
  }, []);

  const stopPaneResize = useCallback(() => {
    paneResizeCleanupRef.current?.();
    paneResizeCleanupRef.current = null;
    delete document.body.dataset.motifCsResizing;
  }, []);

  const stopStackedPaneResize = useCallback(() => {
    stackedPaneResizeCleanupRef.current?.();
    stackedPaneResizeCleanupRef.current = null;
    delete document.body.dataset.motifCsStackedResizing;
  }, []);

  useEffect(() => () => {
    stopFloatingPaneInteraction();
    stopPaneResize();
    stopStackedPaneResize();
  }, [stopFloatingPaneInteraction, stopPaneResize, stopStackedPaneResize]);

  const setFloatingPaneRect = useCallback((pane: PaneKey, rect: FloatingSurfaceRect) => {
    floatingPaneRectsRef.current = { ...floatingPaneRectsRef.current, [pane]: rect };
    setFloatingPaneRects((current) => ({ ...current, [pane]: rect }));
  }, []);

  const beginFloatingPaneInteraction = useCallback((
    pane: PaneKey,
    mode: 'move' | 'resize',
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (panePlacements[pane] !== 'floating' || window.innerWidth <= 520) return;
    if (!event.isPrimary || event.button !== 0) return;
    if (mode === 'move' && (event.target as HTMLElement).closest('button, input, textarea, select, a, summary, [contenteditable="true"]')) return;
    event.preventDefault();
    stopFloatingPaneInteraction();
    bringFloatingPaneToFront(pane);
    const surface = event.currentTarget;
    const base = clampFloatingSurfaceRect(
      floatingPaneRectsRef.current[pane],
      floatingPaneViewport(),
      FLOATING_PANE_LIMITS[pane],
    );
    floatingPaneInteractionRef.current = {
      pane,
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      base,
    };
    document.body.dataset.motifCsPaneFloatingAction = mode;
    try {
      surface.setPointerCapture?.(event.pointerId);
    } catch {
      /* Window listeners keep the interaction alive when capture is unavailable. */
    }

    const applyPointer = (clientX: number, clientY: number) => {
      const interaction = floatingPaneInteractionRef.current;
      if (!interaction) return;
      const delta = {
        dx: clientX - interaction.startX,
        dy: clientY - interaction.startY,
      };
      const viewport = floatingPaneViewport();
      const next = interaction.mode === 'move'
        ? moveFloatingSurfaceRect(interaction.base, delta, viewport, FLOATING_PANE_LIMITS[interaction.pane])
        : resizeFloatingSurfaceRectFromBottomRight(interaction.base, delta, viewport, FLOATING_PANE_LIMITS[interaction.pane]);
      setFloatingPaneRect(interaction.pane, next);
    };

    const removeListeners = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishPointer);
      window.removeEventListener('pointercancel', finishPointer);
      window.removeEventListener('blur', finishFromBlur);
      surface.removeEventListener('lostpointercapture', finishPointer);
      if (floatingPaneInteractionCleanupRef.current === removeListeners) {
        floatingPaneInteractionCleanupRef.current = null;
      }
    };
    function handlePointerMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== floatingPaneInteractionRef.current?.pointerId) return;
      moveEvent.preventDefault();
      applyPointer(moveEvent.clientX, moveEvent.clientY);
    }
    function finishPointer(endEvent: PointerEvent) {
      if (endEvent.pointerId !== floatingPaneInteractionRef.current?.pointerId) return;
      stopFloatingPaneInteraction();
    }
    function finishFromBlur() {
      stopFloatingPaneInteraction();
    }
    floatingPaneInteractionCleanupRef.current = removeListeners;
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishPointer);
    window.addEventListener('pointercancel', finishPointer);
    window.addEventListener('blur', finishFromBlur);
    surface.addEventListener('lostpointercapture', finishPointer);
  }, [bringFloatingPaneToFront, panePlacements, setFloatingPaneRect, stopFloatingPaneInteraction]);

  const moveFloatingPaneFromKeyboard = useCallback((pane: PaneKey, event: ReactKeyboardEvent<HTMLElement>) => {
    if (panePlacements[pane] !== 'floating' || !event.altKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 24 : 10;
    const delta = {
      dx: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
      dy: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0,
    };
    setFloatingPaneRect(pane, moveFloatingSurfaceRect(
      floatingPaneRectsRef.current[pane],
      delta,
      floatingPaneViewport(),
      FLOATING_PANE_LIMITS[pane],
    ));
  }, [panePlacements, setFloatingPaneRect]);

  const resizeFloatingPaneFromKeyboard = useCallback((pane: PaneKey, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 24 : 10;
    setFloatingPaneRect(pane, resizeFloatingSurfaceRectFromBottomRight(
      floatingPaneRectsRef.current[pane],
      {
        dx: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
        dy: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0,
      },
      floatingPaneViewport(),
      FLOATING_PANE_LIMITS[pane],
    ));
  }, [setFloatingPaneRect]);

  useEffect(() => {
    const dockFocusedFloatingPane = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const targetPane = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-pane-placement="floating"]');
      if (!targetPane || (event.target as HTMLElement | null)?.closest('[data-motif-cs-escape-scope="true"]')) return;
      const pane = targetPane.dataset.paneKey as PaneKey | undefined;
      if (!pane || !DEFAULT_PANE_ORDER.includes(pane)) return;
      event.preventDefault();
      event.stopPropagation();
      stopFloatingPaneInteraction();
      dockPane(pane);
    };
    window.addEventListener('keydown', dockFocusedFloatingPane);
    return () => window.removeEventListener('keydown', dockFocusedFloatingPane);
  }, [dockPane, stopFloatingPaneInteraction]);

  const scrollPaneIntoView = useCallback((pane: PaneKey) => {
    if (typeof document === 'undefined') return;
    if (panePlacements[pane] === 'floating') {
      bringFloatingPaneToFront(pane);
      paneElementForKey(pane)?.focus({ preventScroll: true });
      return;
    }
    document.querySelector(PANE_SELECTOR[pane])?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [bringFloatingPaneToFront, paneElementForKey, panePlacements]);

  const revealSequencePaneIfStacked = useCallback(() => {
    // Selection focus belongs to the sequence pane's own scroller. Moving the
    // outer stacked workspace here makes Inventory/Map jump when a feature,
    // codon, or restriction range is selected at narrow widths.
    ensurePaneVisible('sequence');
  }, [ensurePaneVisible]);

  const selectSequenceRangeAndReveal = useCallback((start: number, end: number) => {
    selectSequenceRange(start, end);
    revealSequencePaneIfStacked();
  }, [revealSequencePaneIfStacked, selectSequenceRange]);

  const addWorkspaceNote = useCallback((input: ArtifactNoteInput) => {
    const current = payloadRef.current;
    const timestamp = new Date().toISOString();
    const recordLengths = new Map(current.records.map((record) => [record.id, record.sequence.length]));
    const notes = addArtifactNote(current.notes, {
      ...input,
      id: `note-${crypto.randomUUID()}`,
      createdAt: timestamp,
      updatedAt: timestamp,
      provenance: { source: 'user', operation: 'add_note' },
    }, { recordLengths });
    const nextPayload: LoadedPayload = { ...current, notes };
    payloadRef.current = nextPayload;
    setPayload(nextPayload);
  }, []);

  const updateWorkspaceNote = useCallback((noteId: string, patch: ArtifactNoteTextUpdate) => {
    const current = payloadRef.current;
    const existing = current.notes.find((note) => note.id === noteId);
    const recordLengths = new Map(current.records.map((record) => [record.id, record.sequence.length]));
    const notes = updateArtifactNote(current.notes, noteId, {
      ...patch,
      updatedAt: new Date().toISOString(),
      provenance: { ...existing?.provenance, source: 'user', operation: 'update_note' },
    }, { recordLengths });
    const nextPayload: LoadedPayload = { ...current, notes };
    payloadRef.current = nextPayload;
    setPayload(nextPayload);
  }, []);

  const confirmWorkspaceNoteAnchor = useCallback((noteId: string) => {
    const current = payloadRef.current;
    if (!current.notes.some((note) => note.id === noteId)) throw new Error(`Unknown note id: ${noteId}`);
    const recordLengths = new Map(current.records.map((record) => [record.id, record.sequence.length]));
    const notes = normalizeArtifactWorkspaceCollections({
      notes: current.notes.map((note) => (
        note.id === noteId ? confirmNoteRangeAnchor(note, new Date().toISOString()) : note
      )),
      workflowResults: current.workflowResults,
    }, {
      recordLengths,
      allowMissingWorkflowOutputRecords: true,
    }).notes;
    const nextPayload: LoadedPayload = { ...current, notes };
    payloadRef.current = nextPayload;
    setPayload(nextPayload);
  }, []);

  const removeWorkspaceNote = useCallback((noteId: string) => {
    const current = payloadRef.current;
    const recordLengths = new Map(current.records.map((record) => [record.id, record.sequence.length]));
    const notes = removeArtifactNote(current.notes, noteId, { recordLengths });
    const nextPayload: LoadedPayload = { ...current, notes };
    payloadRef.current = nextPayload;
    setPayload(nextPayload);
  }, []);

  const removeWorkspaceWorkflowResult = useCallback((resultId: string) => {
    const current = payloadRef.current;
    const linked = current.workflowResults.filter((result) => result.id !== resultId && result.provenance.parentIds?.includes(resultId));
    if (linked.length > 0) {
      showWorkbenchNotice(
        `Remove ${linked.length} linked workflow result${linked.length === 1 ? '' : 's'} before removing this parent result.`,
        'error',
      );
      return false;
    }
    const workflowResults = removeArtifactWorkflowResult(current.workflowResults, resultId, {
      recordLengths: new Map(current.records.map((record) => [record.id, record.sequence.length])),
      allowMissingWorkflowOutputRecords: true,
    });
    const nextPayload: LoadedPayload = { ...current, workflowResults };
    payloadRef.current = nextPayload;
    setPayload(nextPayload);
    resetWorkflowWindowState();
    return true;
  }, [resetWorkflowWindowState, showWorkbenchNotice]);

  const removeWorkspaceAnalysisResult = useCallback((resultId: string) => {
    const current = payloadRef.current;
    try {
      const removed = current.analysisResults.find((result) => result.id === resultId);
      const context = {
        recordLengths: new Map(current.records.map((record) => [record.id, record.sequence.length])),
      };
      let workspace = removeArtifactAnalysisWorkspaceResult({
        analysisResults: current.analysisResults,
        analysisAssets: current.analysisAssets,
      }, resultId, context);
      removed?.assetIds.forEach((assetId) => {
        const stillUsed = workspace.analysisResults.some((result) => result.assetIds.includes(assetId));
        const stillPresent = workspace.analysisAssets.some((asset) => asset.id === assetId);
        if (!stillUsed && stillPresent) workspace = removeArtifactAnalysisAsset(workspace, assetId, context);
      });
      const nextPayload: LoadedPayload = { ...current, ...workspace };
      payloadRef.current = nextPayload;
      setPayload(nextPayload);
      return true;
    } catch (error) {
      showWorkbenchNotice(error instanceof Error ? error.message : 'The analysis result could not be removed.', 'error');
      return false;
    }
  }, [showWorkbenchNotice]);

  const revealWorkspaceRecord = useCallback((nextRecordId: string) => {
    if (!payloadRef.current.records.some((record) => record.id === nextRecordId)) return;
    selectRecord(nextRecordId);
    setSelection(null);
    setCaret(null);
    revealSequencePaneIfStacked();
  }, [revealSequencePaneIfStacked, selectRecord]);

  const revealWorkspaceNote = useCallback((note: ArtifactNote) => {
    if (!note.recordId || !payloadRef.current.records.some((record) => record.id === note.recordId)) return;
    selectRecord(note.recordId);
    setSequenceViewMode('detail');
    setSelection(null);
    setCaret(null);
    if (note.scope === 'range' && note.range) {
      setMapRangesByRecord((current) => ({ ...current, [note.recordId!]: { ...note.range! } }));
    } else {
      setMapRangesByRecord((current) => current[note.recordId!]
        ? { ...current, [note.recordId!]: null }
        : current);
    }
    revealSequencePaneIfStacked();
  }, [revealSequencePaneIfStacked, selectRecord]);

  const createPrimerAnalysisResult = useCallback((handoff: ClaudeSciencePrimerHandoff): ArtifactAnalysisResult => {
    const currentRecord = payloadRef.current.records.find((record) => record.id === handoff.recordId);
    if (!currentRecord) throw new Error('The primer template is no longer in this workspace.');
    const inputSha256 = sha256HexSync(currentRecord.sequence);
    const pairId = `pair-${handoff.pairNumber}`;
    const cloningPreparation = handoff.preparationContext
      ? normalizeJsonObject(omitUndefinedObjectProperties({
        requestSha256: handoff.preparationContext.requestSha256,
        actionId: handoff.preparationContext.actionId,
        actionKind: handoff.preparationContext.actionKind,
        method: handoff.preparationContext.method,
        orientation: handoff.preparationContext.orientation,
        enzyme: handoff.preparationContext.enzyme,
        fusionSites: handoff.preparationContext.fusionSites
          ? { ...handoff.preparationContext.fusionSites }
          : undefined,
        junction: handoff.preparationContext.junction
          ? { ...handoff.preparationContext.junction }
          : undefined,
      }))
      : null;
    const primer = (candidate: typeof handoff.pair.forward) => ({
      sequence: candidate.sequence,
      tmC: candidate.tm,
      gcPercent: candidate.gcPercent,
      start: candidate.start,
      end: candidate.end,
      ...(candidate.tail ? { tail5: candidate.tail } : {}),
    });
    return {
      id: `primer-design-${crypto.randomUUID()}`,
      kind: 'primer_design',
      name: `${currentRecord.name} · ${cloningPreparation ? 'primer preparation' : 'primer design'}`,
      status: 'complete',
      summary: cloningPreparation
        ? `Saved primer pair ${handoff.pairNumber} for cloning-plan action ${handoff.preparationContext?.actionId}. No prepared amplicon was created.`
        : `Selected pair ${handoff.pairNumber} for a ${handoff.pair.productLength.toLocaleString()} bp ${handoff.intent} product.`,
      inputRecordIds: [currentRecord.id],
      inputSha256s: [inputSha256],
      dependsOnResultIds: [],
      assetIds: [],
      parameters: normalizeJsonObject(omitUndefinedObjectProperties({
        ...handoff.parameters,
        intent: handoff.intent,
        targetStart: handoff.target.start,
        targetEnd: handoff.target.end,
        ...(cloningPreparation ? { cloningPreparation } : {}),
      })),
      data: {
        targetRecordId: currentRecord.id,
        targetRange: { ...handoff.target },
        pairs: [{
          id: pairId,
          forward: primer(handoff.pair.forward),
          reverse: primer(handoff.pair.reverse),
          productLengthBp: handoff.pair.productLength,
          warnings: handoff.pair.tmDifference > 5 ? [`Primer melting temperatures differ by ${handoff.pair.tmDifference.toFixed(1)} °C.`] : [],
        }],
        selectedPairId: pairId,
      },
      createdAt: new Date().toISOString(),
      provenance: {
        source: 'motif-for-claude-science-artifact',
        operation: 'primer_design',
        actor: 'user',
        engine: 'motif-primer-design',
        engineVersion: '1',
        ...(cloningPreparation ? { metadata: { cloningPreparation } } : {}),
      },
    };
  }, []);

  const savePrimerDesignResult = useCallback((handoff: ClaudeSciencePrimerHandoff): ArtifactAnalysisResult => {
    const current = payloadRef.current;
    const candidate = createPrimerAnalysisResult(handoff);
    const duplicate = current.analysisResults.find((result) => (
      result.kind === 'primer_design'
      && result.inputSha256s?.[0] === candidate.inputSha256s?.[0]
      && JSON.stringify(result.parameters) === JSON.stringify(candidate.parameters)
      && JSON.stringify(result.data) === JSON.stringify(candidate.data)
    ));
    if (duplicate) {
      showWorkbenchNotice(`This primer design is already saved as “${duplicate.name}”.`);
      return duplicate;
    }
    const workspace = appendArtifactAnalysisWorkspaceResult({
      analysisResults: current.analysisResults,
      analysisAssets: current.analysisAssets,
    }, candidate, {
      recordLengths: new Map(current.records.map((record) => [record.id, record.sequence.length])),
    });
    const nextPayload: LoadedPayload = { ...current, ...workspace };
    payloadRef.current = nextPayload;
    setPayload(nextPayload);
    showWorkbenchNotice('Primer design saved in Results.');
    return workspace.analysisResults.find((result) => result.id === candidate.id) ?? candidate;
  }, [createPrimerAnalysisResult, showWorkbenchNotice]);

  const simulatePrimerPcr = useCallback((handoff: ClaudeSciencePrimerHandoff) => {
    const primerResult = savePrimerDesignResult(handoff);
    const current = payloadRef.current;
    const template = current.records.find((record) => record.id === handoff.recordId);
    if (!template || !template.active || template.type !== 'dna') {
      throw new Error('PCR simulation requires the active DNA template used for this primer design.');
    }
    const simulation = simulateSelectedPrimerPair({
      id: template.id,
      name: template.name,
      sequence: template.sequence,
      type: 'dna',
      topology: template.topology,
      translationTableId: template.translationTableId,
      active: template.active,
      features: template.features,
      description: template.description,
      organism: template.organism,
      source: template.source,
      group: template.group,
      tags: template.tags,
    }, {
      pair: handoff.pair,
      pairNumber: handoff.pairNumber,
      target: handoff.target,
      parameters: handoff.parameters,
    });
    const templateSha256 = sha256HexSync(template.sequence);
    const productSha256 = sha256HexSync(simulation.product);
    const pcrResult: ArtifactAnalysisResult = {
      id: `pcr-${crypto.randomUUID()}`,
      kind: 'pcr',
      name: `${handoff.recordName} · PCR simulation`,
      status: 'complete',
      summary: `Simulated one exact ${simulation.productLength.toLocaleString()} bp amplicon, including primer tails. No sequence record was created.`,
      inputRecordIds: [handoff.recordId],
      inputSha256s: [templateSha256],
      dependsOnResultIds: [primerResult.id],
      assetIds: [],
      parameters: {
        forwardPrimer: handoff.pair.forward.fullSequence,
        reversePrimer: handoff.pair.reverse.fullSequence,
        forwardBindingStart: simulation.forward.bindStart,
        forwardBindingEnd: simulation.forward.bindEnd,
        reverseBindingStart: simulation.reverse.bindStart,
        reverseBindingEnd: simulation.reverse.bindEnd,
        topology: template.topology,
        productSha256,
      },
      data: {
        templateRecordId: handoff.recordId,
        primerDesignResultId: primerResult.id,
        products: [{
          id: `amplicon-${crypto.randomUUID()}`,
          lengthBp: simulation.productLength,
          ...(!simulation.wrapsOrigin ? {
            templateRange: { start: simulation.forward.bindStart, end: simulation.reverse.bindEnd },
          } : {}),
        }],
      },
      createdAt: new Date().toISOString(),
      provenance: {
        source: 'motif-for-claude-science-artifact',
        operation: 'pcr_simulation',
        actor: 'user',
        engine: 'motif-pcr',
        engineVersion: '1',
        parentIds: [template.id, primerResult.id],
        metadata: {
          templateSha256,
          productSha256,
          wrapsOrigin: simulation.wrapsOrigin,
          recordCreated: false,
        },
      },
    };
    const duplicate = current.analysisResults.find((result) => (
      result.kind === 'pcr'
      && result.inputSha256s?.[0] === templateSha256
      && result.dependsOnResultIds.includes(primerResult.id)
      && result.provenance.operation === 'pcr_simulation'
      && result.provenance.metadata?.productSha256 === productSha256
    ));
    if (duplicate) {
      showWorkbenchNotice(`This exact PCR simulation is already saved as “${duplicate.name}”. No sequence record was created.`);
      return;
    }
    const workspace = appendArtifactAnalysisWorkspaceResult({
      analysisResults: current.analysisResults,
      analysisAssets: current.analysisAssets,
    }, pcrResult, {
      recordLengths: new Map(current.records.map((record) => [record.id, record.sequence.length])),
    });
    const nextPayload: LoadedPayload = { ...current, ...workspace };
    payloadRef.current = nextPayload;
    setPayload(nextPayload);
    showWorkbenchNotice('PCR simulation saved in Results only. No sequence record was created.');
  }, [savePrimerDesignResult, showWorkbenchNotice]);

  const materializePrimerAmplicon = useCallback((handoff: ClaudeSciencePrimerHandoff) => {
    const primerResult = savePrimerDesignResult(handoff);
    const current = payloadRef.current;
    const template = current.records.find((record) => record.id === handoff.recordId);
    if (!template || !template.active || template.type !== 'dna') {
      throw new Error('Amplicon creation requires the active DNA template used for this primer design.');
    }
    const sourceRecord: PcrMaterializationSourceRecord = {
      id: template.id,
      name: template.name,
      sequence: template.sequence,
      type: 'dna',
      topology: template.topology,
      translationTableId: template.translationTableId,
      active: template.active,
      features: template.features,
      ...(template.description ? { description: template.description } : {}),
      ...(template.organism ? { organism: template.organism } : {}),
      ...(template.source ? { source: template.source } : {}),
      ...(template.group ? { group: template.group } : {}),
      ...(template.tags ? { tags: template.tags } : {}),
    };
    const baseName = `${template.name.slice(0, 1_000)} · PCR amplicon`;
    const usedNames = new Set(current.records.map((record) => record.name.trim().toLocaleLowerCase()));
    let recordName = baseName;
    for (let suffix = 2; usedNames.has(recordName.toLocaleLowerCase()); suffix += 1) {
      recordName = `${baseName} ${suffix}`;
    }
    const createdAt = new Date().toISOString();
    const materialized = materializePcrAmplicon({
      sourceRecord,
      selection: {
        pair: handoff.pair,
        pairNumber: handoff.pairNumber,
        target: handoff.target,
        parameters: handoff.parameters,
      },
      identity: {
        recordId: `pcr-record-${crypto.randomUUID()}`,
        resultId: `pcr-${crypto.randomUUID()}`,
        productId: `amplicon-${crypto.randomUUID()}`,
        createdAt,
        recordName,
      },
      primerDesignResultId: primerResult.id,
      ...(handoff.preparationContext ? {
        preparation: {
          requestSha256: handoff.preparationContext.requestSha256,
          actionId: handoff.preparationContext.actionId,
          actionKind: handoff.preparationContext.actionKind,
          method: handoff.preparationContext.method,
          orientation: handoff.preparationContext.orientation,
        },
      } : {}),
    });

    const duplicate = findPcrMaterializationDuplicate(current.records, materialized.materializationKey);
    const replaceInCloningDraft = (productId: string, productName: string): boolean => (
      Boolean(handoff.preparationContext)
      && cloningDesignWorkspaceRef.current?.replacePreparedPart({
        expectedRequestSha256: handoff.preparationContext?.requestSha256 ?? '',
        actionId: handoff.preparationContext?.actionId ?? '',
        sourceRecordId: handoff.recordId,
        productRecordId: productId,
        productRecordName: productName,
      }) === true
    );
    if (duplicate) {
      const reusable = current.records.find((record) => (
        record.id === duplicate.id && record.active && record.type === 'dna'
      ));
      const replaced = reusable
        ? replaceInCloningDraft(reusable.id, reusable.name)
        : false;
      if (replaced) {
        setShowPrimerDesign(false);
        setCloningPrimerRequest(null);
        setCompletedCloningPrimerActionIds([]);
        showWorkbenchNotice(`Reused existing amplicon “${duplicate.name}”, replaced the prepared part, and rechecked the cloning draft.`);
      } else {
        showWorkbenchNotice(`This exact amplicon already exists as “${duplicate.name}”. No duplicate record was created.${reusable ? '' : ' Reactivate it before using it in cloning.'}`);
      }
      return;
    }
    if (current.records.length >= MOTIF_MAX_RECORDS) {
      throw new Error(`Creating this amplicon would exceed the ${MOTIF_MAX_RECORDS}-record artifact limit.`);
    }

    const recordInput = omitUndefinedObjectProperties(materialized.record) as ArtifactRecordInput;
    validateRuntimeRecordInputs([recordInput], 'motifAddRecords');
    const normalized = normalizeRecord(recordInput, current.records.length);
    if (!normalized) throw new Error('The exact PCR product could not be normalized.');
    if (current.records.some((record) => record.id === normalized.id)) {
      throw new Error(`PCR product id “${normalized.id}” already exists.`);
    }
    if (normalized.sequence !== materialized.simulation.product) {
      throw new Error('PCR product normalization changed the simulated sequence; nothing was saved.');
    }

    const records = [...current.records, { ...normalized, default: false }];
    const workspace = appendArtifactAnalysisWorkspaceResult({
      analysisResults: current.analysisResults,
      analysisAssets: current.analysisAssets,
    }, materialized.analysisResult, {
      recordLengths: new Map(records.map((record) => [record.id, record.sequence.length])),
    });
    const replaced = replaceInCloningDraft(normalized.id, normalized.name);
    const nextPayload: LoadedPayload = { ...current, records, ...workspace };
    payloadRef.current = nextPayload;
    setPayload(nextPayload);

    if (replaced) {
      setShowPrimerDesign(false);
      setCloningPrimerRequest(null);
      setCompletedCloningPrimerActionIds([]);
      showWorkbenchNotice(`Created “${normalized.name}”, replaced the prepared part, and rechecked the cloning draft. The source record is unchanged.`);
      return;
    }

    rememberActiveSequenceScroll();
    selectedRecordIdRef.current = normalized.id;
    setSelectedRecordId(normalized.id);
    setSelection(null);
    setShowPrimerDesign(false);
    showWorkbenchNotice(handoff.preparationContext
      ? `Created “${normalized.name}”, but the cloning draft changed and was not replaced. Review the draft before using this record.`
      : `Created and opened “${normalized.name}”. The source record is unchanged.`);
  }, [rememberActiveSequenceScroll, savePrimerDesignResult, showWorkbenchNotice]);

  const selectTranslationCodonAndReveal = useCallback((
    start: number,
    end: number,
    strand?: 1 | -1,
    translationTableId?: number,
    featureId?: string,
    translationSource?: 'feature' | 'layer',
    frame?: 0 | 1 | 2,
    completeCds?: boolean,
    label?: string,
  ) => {
    selectTranslationCodon(
      start,
      end,
      strand,
      translationTableId,
      featureId,
      translationSource,
      frame,
      completeCds,
      label,
    );
    revealSequencePaneIfStacked();
  }, [revealSequencePaneIfStacked, selectTranslationCodon]);

  const handleFeatureClickAndReveal = useCallback((featureId: string) => {
    handleFeatureClick(featureId);
    revealSequencePaneIfStacked();
  }, [handleFeatureClick, revealSequencePaneIfStacked]);

  const handleTranslationTrackSelectAndReveal = useCallback((track: InlineTranslationTrack) => {
    setSequenceViewMode('detail');
    if (track.source === 'feature' && track.id.startsWith('feat:')) {
      handleFeatureClick(track.id.slice(5));
      setSelectedTranslationLayerByRecord((current) => ({ ...current, [recordId]: track.id }));
      revealSequencePaneIfStacked();
      return;
    }
    selectTranslationCodonAndReveal(
      track.start,
      track.end,
      track.strand,
      track.translationTableId,
      track.featureId,
      track.source,
      track.frame,
      track.completeCds,
      track.label,
    );
    setSelectedTranslationLayerByRecord((current) => ({ ...current, [recordId]: track.id }));
  }, [handleFeatureClick, recordId, revealSequencePaneIfStacked, selectTranslationCodonAndReveal]);

  const closeOpenToolDetails = useCallback(() => {
    if (typeof document === 'undefined') return;
    document.querySelectorAll<HTMLDetailsElement>('.motif-cs-inspector details[name="motif-cs-tools"][open]').forEach((panel) => {
      panel.open = false;
    });
  }, []);

  const renewGelDraft = useCallback(() => {
    setGelResultIdentity(createGelResultIdentity());
    setGelSaved(false);
    setGelStatus('');
    setGelError('');
  }, []);

  const openGelForWorkflow = useCallback((digestWorkflowResultId: string) => {
    const result = payloadRef.current.workflowResults.find((entry) => entry.id === digestWorkflowResultId && entry.kind === 'digest');
    if (!result) {
      showWorkbenchNotice('The saved digest result is no longer available for gel preview.', 'error');
      return;
    }
    gelReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeOpenToolDetails();
    setShowTranslations(false);
    setShowAlignment(false);
    setShowAssembly(false);
    setShowCloningDesign(false);
    setShowPrimerDesign(false);
    setShowConstructVerification(false);
    setGelSelectedCandidateIds([`digest:${digestWorkflowResultId}`]);
    setGelWorkflowName(`${result.name} · gel`);
    renewGelDraft();
    setShowGel(true);
  }, [closeOpenToolDetails, renewGelDraft, showWorkbenchNotice]);

  const openPrimerWorkspace = useCallback(() => {
    if (!isEditable) return;
    closeOpenToolDetails();
    setShowTranslations(false);
    setShowAlignment(false);
    setShowGel(false);
    setShowAssembly(false);
    setShowCloningDesign(false);
    setShowConstructVerification(false);
    setCloningPrimerRequest(null);
    setShowPrimerDesign(true);
  }, [closeOpenToolDetails, isEditable]);

  const closePrimerWorkspace = useCallback(() => {
    const returnsToCloningDraft = cloningPrimerRequest !== null;
    setShowPrimerDesign(false);
    if (returnsToCloningDraft) showWorkbenchNotice('Returned to the existing cloning draft.');
  }, [cloningPrimerRequest, showWorkbenchNotice]);

  const openGelWorkspace = useCallback(() => {
    gelReturnFocusRef.current = cloningToggleRef.current
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    closeOpenToolDetails();
    setShowTranslations(false);
    setShowAlignment(false);
    setShowAssembly(false);
    setShowCloningDesign(false);
    setShowPrimerDesign(false);
    setShowConstructVerification(false);
    const firstCandidate = gelLaneCandidates.find((candidate) => candidate.id === `record:${recordId}`)
      ?? gelLaneCandidates[0];
    setGelSelectedCandidateIds(firstCandidate ? [firstCandidate.id] : []);
    setGelWorkflowName(firstCandidate ? `${firstCandidate.label} · gel` : 'Digest gel preview');
    renewGelDraft();
    setShowGel(true);
  }, [closeOpenToolDetails, gelLaneCandidates, recordId, renewGelDraft]);

  const saveGelResult = useCallback((preview: ArtifactGelPreview) => {
    if (gelSaved) return;
    const current = payloadRef.current;
    try {
      const recordLengths = new Map(current.records.map((record) => [record.id, record.sequence.length]));
      const workflowResults = appendArtifactWorkflowResult(current.workflowResults, preview.workflowResult, { recordLengths });
      const nextPayload: LoadedPayload = { ...current, workflowResults };
      payloadRef.current = nextPayload;
      setPayload(nextPayload);
      setGelSaved(true);
      setGelError('');
      setGelStatus('Gel result saved in Workflow Results.');
    } catch (error) {
      setGelError(error instanceof Error ? `Gel result was not saved: ${error.message}` : 'Gel result was not saved.');
    }
  }, [gelSaved]);

  const openAssemblyWorkspace = useCallback(() => {
    closeOpenToolDetails();
    setShowTranslations(false);
    setShowAlignment(false);
    setShowGel(false);
    setShowCloningDesign(false);
    setShowPrimerDesign(false);
    setShowConstructVerification(false);
    const active = assemblyRecords.find((record) => record.id === recordId)?.id;
    const preferred = active
      ? [active, ...assemblyRecords.filter((record) => record.id !== active).map((record) => record.id)]
      : assemblyRecords.map((record) => record.id);
    setAssemblyInitialRecordIds(preferred.slice(0, 2));
    setShowAssembly(true);
  }, [assemblyRecords, closeOpenToolDetails, recordId]);

  const openCloningDesignWorkspace = useCallback((preferredRecordId = recordId) => {
    closeOpenToolDetails();
    setShowTranslations(false);
    setShowAlignment(false);
    setShowGel(false);
    setShowAssembly(false);
    setShowPrimerDesign(false);
    setShowConstructVerification(false);
    const active = assemblyRecords.find((record) => record.id === preferredRecordId)?.id;
    setCloningDesignInitialRecordIds(active ? [active] : []);
    setShowCloningDesign(true);
  }, [assemblyRecords, closeOpenToolDetails, recordId]);

  const saveAssemblyArtifacts = useCallback((saved: ClaudeScienceAssemblySavePayload) => {
    const current = payloadRef.current;
    const sameStrings = (left: readonly string[] | undefined, right: readonly string[] | undefined) => (
      JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
    );
    const duplicate = current.workflowResults.find((result) => (
      result.kind === saved.workflowResult.kind
      && result.name === saved.workflowResult.name
      && sameStrings(result.inputRecordIds, saved.workflowResult.inputRecordIds)
      && sameStrings(result.inputSha256s, saved.workflowResult.inputSha256s)
      && JSON.stringify(result.parameters) === JSON.stringify(saved.workflowResult.parameters)
      && (result.outputRecordIds.length > 0) === Boolean(saved.derivedRecord)
    ));
    if (duplicate) {
      throw new Error(`This exact ${saved.workflowResult.kind === 'golden_gate' ? 'Golden Gate' : 'ligation'} result is already saved as “${duplicate.name}”.`);
    }
    if (saved.derivedRecord && current.records.length >= MOTIF_MAX_RECORDS) {
      throw new Error(`Creating this product would exceed the ${MOTIF_MAX_RECORDS}-record artifact limit.`);
    }
    if (saved.derivedRecord && current.records.some((record) => (
      record.name.trim().toLocaleLowerCase() === saved.derivedRecord?.name.trim().toLocaleLowerCase()
    ))) {
      throw new Error(`A record named “${saved.derivedRecord.name}” already exists. Choose a unique product name.`);
    }
    const additions: ArtifactVector[] = [];
    if (saved.derivedRecord) {
      const inputTranslationTableIds = saved.workflowResult.inputRecordIds.map((id) => (
        current.records.find((record) => record.id === id)?.translationTableId ?? 1
      ));
      const uniqueInputRecordIds = [...new Set(saved.workflowResult.inputRecordIds)];
      const singleParentRecord = uniqueInputRecordIds.length === 1
        ? current.records.find((record) => record.id === uniqueInputRecordIds[0])
        : undefined;
      const translationTableId = singleParentRecord?.translationTableId;
      const recordInput = omitUndefinedObjectProperties({
        ...saved.derivedRecord,
        translationTableId,
        provenance: {
          ...saved.derivedRecord.provenance,
          inputTranslationTableIds,
          ...(translationTableId !== undefined ? { translationTableId } : {}),
          translationTablePolicy: singleParentRecord
            ? 'single-parent-inherited'
            : 'unset-for-multi-parent-product',
        },
      }) as ArtifactRecordInput;
      validateRuntimeRecordInputs([recordInput], 'motifAddRecords');
      const normalized = normalizeRecord(recordInput, current.records.length);
      if (!normalized) throw new Error('The assembly product could not be normalized.');
      if (current.records.some((record) => record.id === normalized.id)) {
        throw new Error(`Assembly product id "${normalized.id}" already exists.`);
      }
      additions.push({ ...normalized, default: false });
    }
    const recordLengths = new Map<string, number>([
      ...current.records.map((record): [string, number] => [record.id, record.sequence.length]),
      ...additions.map((record): [string, number] => [record.id, record.sequence.length]),
    ]);
    const workflowResults = appendArtifactWorkflowResult(current.workflowResults, saved.workflowResult, { recordLengths });
    const nextPayload: LoadedPayload = {
      ...current,
      records: [...current.records, ...additions],
      workflowResults,
    };
    payloadRef.current = nextPayload;
    setPayload(nextPayload);
  }, []);

  const designCloningPreparationPrimers = useCallback((request: ClaudeScienceCloningPrimerRequest) => {
    if (!request.plan.provenance?.requestSha256) {
      throw new Error('This preparation request is missing reviewed cloning-plan provenance.');
    }
    const available = new Set(payloadRef.current.records.map((record) => record.id));
    const firstAction = request.actionIds
      .map((id) => request.plan.preparation.find((action) => action.id === id))
      .find((action) => action?.recordIds.some((id) => available.has(id)));
    const firstJunction = firstAction && request.plan.kind === 'gibson_design' && firstAction.junctionIndex !== undefined
      ? request.plan.junctions[firstAction.junctionIndex] ?? null
      : null;
    const targetId = firstJunction?.rightRecordId
      ?? firstAction?.recordIds.find((id) => available.has(id));
    if (!targetId) throw new Error('This primer-plan step does not identify a source record for primer design.');
    selectRecord(targetId);
    setSelection(null);
    setMapRangesByRecord((current) => current[targetId] ? { ...current, [targetId]: null } : current);
    setCloningPrimerRecordIndex(0);
    setCompletedCloningPrimerActionIds([]);
    setCloningPrimerRequest(request);
    setShowConstructVerification(false);
    setShowPrimerDesign(true);
    showWorkbenchNotice(
      request.actionIds.length > 1
        ? `Started a ${request.actionIds.length}-action primer worklist. The cloning draft remains open underneath.`
        : 'Opened primer design for this cloning-plan step. The cloning draft remains open underneath.',
    );
  }, [selectRecord, showWorkbenchNotice]);

  const navigateCloningPrimerRecord = useCallback((nextIndex: number) => {
    if (!cloningPrimerRequest || nextIndex < 0 || nextIndex >= cloningPrimerWorklist.length) return;
    const targetId = cloningPrimerWorklist[nextIndex]?.recordId;
    if (!targetId) return;
    if (!payloadRef.current.records.some((record) => record.id === targetId)) {
      showWorkbenchNotice('That primer-plan input is no longer available.', 'error');
      return;
    }
    setCloningPrimerRecordIndex(nextIndex);
    selectRecord(targetId);
    setSelection(null);
    setMapRangesByRecord((current) => current[targetId] ? { ...current, [targetId]: null } : current);
    showWorkbenchNotice(`Primer-plan action ${nextIndex + 1} of ${cloningPrimerWorklist.length}.`);
  }, [cloningPrimerRequest, cloningPrimerWorklist, selectRecord, showWorkbenchNotice]);

  const usePrimerDesignForCloning = useCallback((handoff: ClaudeSciencePrimerHandoff) => {
    savePrimerDesignResult(handoff);
    if (!cloningPrimerRequest || !activeCloningPrimerItem) {
      setShowPrimerDesign(false);
      openCloningDesignWorkspace(handoff.recordId);
      return;
    }

    const completed = new Set(completedCloningPrimerActionIds);
    completed.add(activeCloningPrimerItem.action.id);
    setCompletedCloningPrimerActionIds([...completed]);
    const nextIndex = cloningPrimerWorklist.findIndex((item, index) => (
      index > cloningPrimerRecordIndex && !completed.has(item.action.id)
    ));
    const wrappedIndex = nextIndex >= 0
      ? nextIndex
      : cloningPrimerWorklist.findIndex((item) => !completed.has(item.action.id));
    if (wrappedIndex >= 0) {
      navigateCloningPrimerRecord(wrappedIndex);
      showWorkbenchNotice(`Primer plan saved. ${cloningPrimerWorklist.length - completed.size} action${cloningPrimerWorklist.length - completed.size === 1 ? '' : 's'} remaining.`);
      return;
    }

    setShowPrimerDesign(false);
    showWorkbenchNotice('Primer-plan worklist saved. Returned to the existing cloning draft. No amplicon was created.');
  }, [
    activeCloningPrimerItem,
    cloningPrimerRecordIndex,
    cloningPrimerRequest,
    cloningPrimerWorklist,
    completedCloningPrimerActionIds,
    navigateCloningPrimerRecord,
    openCloningDesignWorkspace,
    savePrimerDesignResult,
    showWorkbenchNotice,
  ]);

  const saveCloningDesign = useCallback((saved: ClaudeScienceCloningSavePayload) => {
    const current = payloadRef.current;
    if (!saved.provenance) throw new Error('Resolve the blocking design inputs before saving this plan.');
    if (
      (saved.method === 'golden_gate' && saved.plan.kind !== 'golden_gate_design')
      || (saved.method === 'gibson' && saved.plan.kind !== 'gibson_design')
    ) {
      throw new Error('The cloning method no longer matches the reviewed design.');
    }
    if (
      JSON.stringify(saved.requestedRecordIds) !== JSON.stringify(saved.provenance.inputRecordIds)
      || JSON.stringify(saved.requestedOrientations) !== JSON.stringify(saved.provenance.inputOrientations)
    ) {
      throw new Error('The requested part order or orientation no longer matches this design. Review it before saving.');
    }
    const currentRecordsById = new Map(current.records.map((record) => [record.id, record]));
    const verifiedInputs = saved.provenance.inputRecordIds.map((id, index): ArtifactCloningInput => {
      const record = currentRecordsById.get(id);
      if (!record || record.type !== 'dna') {
        throw new Error(`Source record “${id}” is no longer available as DNA. Reopen the design before saving.`);
      }
      return {
        recordId: record.id,
        name: record.name,
        sequence: record.sequence,
        molecule: 'dna',
        orientation: saved.provenance?.inputOrientations[index] ?? 'forward',
        sha256: saved.provenance?.inputSha256s[index],
      };
    });
    const verifiedPlan = saved.plan.kind === 'golden_gate_design'
      ? planArtifactGoldenGateDesign({
        parts: verifiedInputs.map((input): ArtifactGoldenGatePartInput => {
          const reviewed = saved.plan.kind === 'golden_gate_design'
            ? saved.plan.parts.find((part) => part.recordId === input.recordId)
            : null;
          return {
            ...input,
            ...(reviewed?.goldenBraidLevel ? { goldenBraidLevel: reviewed.goldenBraidLevel } : {}),
            ...(reviewed?.goldenBraidRole ? { goldenBraidRole: reviewed.goldenBraidRole } : {}),
            ...(reviewed?.goldenBraidSlot ? { goldenBraidSlot: reviewed.goldenBraidSlot } : {}),
            ...(reviewed?.requestedLeftOverhang ? { requestedLeftOverhang: reviewed.requestedLeftOverhang } : {}),
            ...(reviewed?.requestedRightOverhang ? { requestedRightOverhang: reviewed.requestedRightOverhang } : {}),
          };
        }),
        organizationMode: saved.plan.organizationMode,
        ...(saved.plan.profile?.id ? { kitId: saved.plan.profile.id } : {}),
        ...(saved.plan.enzyme ? { enzyme: saved.plan.enzyme } : {}),
        ...(saved.plan.goldenBraidDirection ? { goldenBraidDirection: saved.plan.goldenBraidDirection } : {}),
        ...(saved.plan.destinationRecordId ? { destinationRecordId: saved.plan.destinationRecordId } : {}),
      })
      : planArtifactGibsonDesign({
        fragments: verifiedInputs,
        topology: saved.plan.topology,
        minOverlap: saved.plan.minOverlap,
        maxOverlap: saved.plan.maxOverlap,
      });
    const verifiedProvenance: ArtifactCloningPlanProvenance | null = verifiedPlan.provenance;
    if (!verifiedProvenance || verifiedProvenance.requestSha256 !== saved.provenance.requestSha256) {
      throw new Error('A source record or design setting changed after review. Reopen the design before saving.');
    }
    const shouldCreateProduct = saved.intent === 'product';
    const verifiedProduct = shouldCreateProduct ? verifiedPlan.product : null;
    if (shouldCreateProduct && (!saved.product || !verifiedProduct)) {
      throw new Error('This design does not have a validated product sequence yet.');
    }
    if (saved.product && verifiedProduct && (
      saved.product.sha256 !== verifiedProduct.sha256
      || saved.product.sequence !== verifiedProduct.sequence
      || JSON.stringify(saved.orderedRecordIds) !== JSON.stringify(verifiedProduct.orderedRecordIds)
    )) {
      throw new Error('The product preview changed after review. Reopen the design before saving.');
    }
    if (!shouldCreateProduct && JSON.stringify(saved.orderedRecordIds) !== JSON.stringify(saved.requestedRecordIds)) {
      throw new Error('The saved plan order does not match the requested part order.');
    }
    const actualOrderedRecordIds = verifiedProduct?.orderedRecordIds ?? saved.requestedRecordIds;
    const requestedOrientationById = new Map(saved.requestedRecordIds.map((id, index) => (
      [id, saved.requestedOrientations[index] ?? 'forward'] as const
    )));
    const actualOrientations = actualOrderedRecordIds.map((id) => requestedOrientationById.get(id) ?? 'forward');
    const inputTranslationTableIds = actualOrderedRecordIds.map((id) => (
      currentRecordsById.get(id)?.translationTableId ?? 1
    ));
    const uniqueInputRecordIds = [...new Set(actualOrderedRecordIds)];
    const singleParentRecord = uniqueInputRecordIds.length === 1
      ? currentRecordsById.get(uniqueInputRecordIds[0] ?? '')
      : undefined;
    const productTranslationTableId = singleParentRecord?.translationTableId;
    if (shouldCreateProduct && current.records.length >= MOTIF_MAX_RECORDS) {
      throw new Error(`Creating this product would exceed the ${MOTIF_MAX_RECORDS}-record artifact limit.`);
    }
    if (shouldCreateProduct && current.records.some((record) => record.name.trim().toLocaleLowerCase() === saved.name.trim().toLocaleLowerCase())) {
      throw new Error(`A record named “${saved.name}” already exists. Choose a unique design name.`);
    }

    const additions: ArtifactVector[] = [];
    if (verifiedProduct) {
      const recordInput: ArtifactRecordInput = {
        id: `cloning-product-${crypto.randomUUID()}`,
        name: saved.name,
        description: `${saved.method === 'gibson' ? 'Gibson' : 'Golden Gate'} design product generated from ${verifiedProduct.orderedRecordIds.length} ordered inputs.`,
        type: 'dna',
        topology: verifiedProduct.topology,
        ...(productTranslationTableId !== undefined ? { translationTableId: productTranslationTableId } : {}),
        sequence: verifiedProduct.sequence,
        source: 'Motif for Claude Science',
        group: 'Cloning products',
        provenance: {
          operation: saved.method === 'gibson' ? 'gibson_design' : 'golden_gate_design',
          parentRecordIds: [...actualOrderedRecordIds],
          parentOrientations: [...actualOrientations],
          requestedRecordIds: [...saved.requestedRecordIds],
          requestedOrientations: [...saved.requestedOrientations],
          requestSha256: verifiedProvenance.requestSha256,
          productSha256: verifiedProduct.sha256,
          inputTranslationTableIds,
          ...(productTranslationTableId !== undefined ? { translationTableId: productTranslationTableId } : {}),
          translationTablePolicy: singleParentRecord
            ? 'single-parent-inherited'
            : 'unset-for-multi-parent-product',
        },
      };
      validateRuntimeRecordInputs([recordInput], 'motifAddRecords');
      const normalized = normalizeRecord(recordInput, current.records.length);
      if (!normalized) throw new Error('The design product could not be normalized.');
      additions.push({ ...normalized, default: false });
    }

    const plan = verifiedPlan;
    const method = saved.method === 'gibson'
      ? 'gibson' as const
      : plan.kind === 'golden_gate_design' && plan.organizationMode !== 'freeform'
        ? 'golden_braid' as const
        : 'golden_gate' as const;
    const junctions = plan.kind === 'gibson_design'
      ? plan.junctions.map((junction) => ({
        leftRecordId: junction.leftRecordId,
        rightRecordId: junction.rightRecordId,
        compatible: junction.status !== 'missing_overlap',
        ...(junction.overlapSequence ? { overhang: junction.overlapSequence } : {}),
        ...(junction.issues.length ? { note: junction.issues.map((issue) => issue.message).join(' ') } : {}),
      }))
      : undefined;
    const result: ArtifactAnalysisResult = {
      id: `assembly-plan-${crypto.randomUUID()}`,
      kind: 'assembly_plan',
      name: saved.name,
      status: plan.status === 'ready' ? 'complete' : 'partial',
      summary: shouldCreateProduct
        ? `${saved.name} was saved as a ${verifiedProduct?.length.toLocaleString()} bp ${verifiedProduct?.topology} product.`
        : `${saved.name} saved with ${plan.preparation.length.toLocaleString()} preparation step${plan.preparation.length === 1 ? '' : 's'}.`,
      inputRecordIds: [...verifiedProvenance.inputRecordIds],
      inputSha256s: [...verifiedProvenance.inputSha256s],
      dependsOnResultIds: [],
      assetIds: [],
      parameters: plan.kind === 'golden_gate_design'
        ? {
          requestSha256: verifiedProvenance.requestSha256,
          requestedRecordIds: [...saved.requestedRecordIds],
          requestedOrientations: [...saved.requestedOrientations],
          actualOrderedRecordIds: [...actualOrderedRecordIds],
          actualOrientations: [...actualOrientations],
          effectiveInputSha256s: [...verifiedProvenance.effectiveInputSha256s],
          organizationMode: plan.organizationMode,
          goldenBraidDirection: plan.goldenBraidDirection,
          sourceLevel: plan.sourceLevel,
          destinationLevel: plan.destinationLevel,
          destinationRecordId: plan.destinationRecordId,
          goldenBraidIdentityValidated: plan.goldenBraidIdentityValidated,
          goldenBraidParts: plan.parts.map((part) => ({
            recordId: part.recordId,
            level: part.goldenBraidLevel,
            role: part.goldenBraidRole,
            slot: part.goldenBraidSlot,
            requestedLeftOverhang: part.requestedLeftOverhang,
            requestedRightOverhang: part.requestedRightOverhang,
          })),
          enzyme: plan.enzyme,
          profileId: plan.profile?.id ?? null,
          preparation: plan.preparation.map((action) => ({ id: action.id, kind: action.kind, status: action.status })),
        }
        : {
          requestSha256: verifiedProvenance.requestSha256,
          requestedRecordIds: [...saved.requestedRecordIds],
          requestedOrientations: [...saved.requestedOrientations],
          actualOrderedRecordIds: [...actualOrderedRecordIds],
          actualOrientations: [...actualOrientations],
          effectiveInputSha256s: [...verifiedProvenance.effectiveInputSha256s],
          topology: plan.topology,
          minOverlap: plan.minOverlap,
          maxOverlap: plan.maxOverlap,
          preparation: plan.preparation.map((action) => ({ id: action.id, kind: action.kind, status: action.status })),
        },
      data: {
        method,
        orderedPartRecordIds: [...actualOrderedRecordIds],
        ...(additions[0] ? { productRecordId: additions[0].id } : {}),
        ...(plan.kind === 'golden_gate_design' && plan.profile ? { standard: plan.profile.name } : {}),
        ...(plan.kind === 'golden_gate_design' && plan.enzyme ? { enzyme: plan.enzyme } : {}),
        ...(junctions ? { junctions } : {}),
      },
      createdAt: new Date().toISOString(),
      provenance: {
        source: 'motif-for-claude-science-artifact',
        operation: saved.method === 'gibson' ? 'gibson_design' : 'golden_gate_design',
        actor: 'user',
        engine: verifiedProvenance.engine,
        engineVersion: String(verifiedProvenance.adapterVersion),
      },
    };

    const duplicate = current.analysisResults.find((candidate) => (
      candidate.kind === 'assembly_plan'
      && candidate.name === result.name
      && candidate.parameters.requestSha256 === verifiedProvenance.requestSha256
      && Boolean(candidate.data.productRecordId) === shouldCreateProduct
    ));
    if (duplicate) throw new Error(`This exact design is already saved as “${duplicate.name}”.`);

    const recordLengths = new Map<string, number>([
      ...current.records.map((record): [string, number] => [record.id, record.sequence.length]),
      ...additions.map((record): [string, number] => [record.id, record.sequence.length]),
    ]);
    const workspace = appendArtifactAnalysisWorkspaceResult({
      analysisResults: current.analysisResults,
      analysisAssets: current.analysisAssets,
    }, result, { recordLengths });
    const nextPayload: LoadedPayload = {
      ...current,
      records: [...current.records, ...additions],
      ...workspace,
    };
    payloadRef.current = nextPayload;
    setPayload(nextPayload);
    if (additions[0]) {
      selectedRecordIdRef.current = additions[0].id;
      setSelectedRecordId(additions[0].id);
    }
    showWorkbenchNotice(shouldCreateProduct ? 'Design and product saved.' : 'Assembly plan saved in Results.');
  }, [showWorkbenchNotice]);

  const runConstructVerification = useCallback((request: ClaudeScienceConstructVerificationRequest) => {
    return verifyArtifactConstruct({
      reference: {
        id: request.reference.id,
        name: request.reference.name,
        sequence: request.reference.sequence,
        topology: request.reference.topology,
        sha256: request.reference.sha256,
      },
      reads: request.reads.map((read) => ({
        id: read.id,
        name: read.name,
        baseCalls: read.sangerTrace.baseCalls,
        ...(read.sangerTrace.qualityScores && read.sangerTrace.qualityScores.length > 0
          ? { qualityScores: read.sangerTrace.qualityScores }
          : {}),
        sha256: read.sha256,
      })),
      requiredRegions: [{
        id: 'full-reference',
        name: 'Full predicted construct',
        start: 0,
        end: request.reference.sequence.length,
        minDepth: request.minDepth,
        requireBothStrands: request.requireBothStrands,
      }],
      expectedVariants: [],
      thresholds: {
        minCoverageFraction: 1,
        minDepth: request.minDepth,
        requireBothStrands: request.requireBothStrands,
      },
    });
  }, []);

  const saveConstructVerification = useCallback((saved: ClaudeScienceConstructVerificationSavePayload) => {
    const current = payloadRef.current;
    const reference = current.records.find((record) => record.id === saved.snapshot.reference.id);
    if (!reference || reference.type !== 'dna') {
      throw new Error('The predicted reference is no longer available as DNA. Run verification again.');
    }
    const referenceSha256 = sha256HexSync(reference.sequence);
    if (
      referenceSha256 !== saved.snapshot.reference.sequenceSha256
      || reference.topology !== saved.snapshot.reference.topology
      || saved.result.reference.id !== reference.id
      || saved.result.reference.sha256 !== referenceSha256
      || saved.result.reference.topology !== reference.topology
    ) {
      throw new Error('The predicted reference changed after verification. Run verification again before saving.');
    }
    if (
      saved.result.thresholds.minDepth !== saved.snapshot.minDepth
      || saved.result.thresholds.requireBothStrands !== saved.snapshot.requireBothStrands
    ) {
      throw new Error('The saved acceptance criteria no longer match the reviewed run. Run verification again.');
    }
    if (
      saved.result.reads.length !== saved.snapshot.reads.length
      || saved.result.reads.some((read, index) => read.id !== saved.snapshot.reads[index]?.id)
    ) {
      throw new Error('The reviewed read order no longer matches the verification result. Run verification again.');
    }

    const evidenceSha256s = saved.snapshot.reads.map((snapshotRead, index) => {
      const record = current.records.find((candidate) => candidate.id === snapshotRead.id);
      const evidence = record ? artifactConstructTraceEvidence(record) : null;
      const sequenceSha256 = record ? sha256HexSync(record.sequence) : null;
      if (
        !record
        || record.type !== 'dna'
        || !evidence
        || snapshotRead.sangerEvidenceSha256 === null
        || sequenceSha256 !== snapshotRead.sequenceSha256
        || evidence.sha256 !== snapshotRead.sangerEvidenceSha256
        || saved.result.reads[index]?.sha256 !== sequenceSha256
      ) {
        throw new Error(`Sanger evidence “${snapshotRead.id}” changed after verification. Run verification again before saving.`);
      }
      return evidence.sha256;
    });

    const duplicate = findDuplicateArtifactConstructVerificationResult(current.analysisResults, {
      engine: saved.result.provenance.engine,
      engineVersion: saved.result.provenance.engineVersion,
      requestSha256: saved.result.provenance.requestSha256,
    });
    if (duplicate) throw new Error(`This exact verification is already saved as “${duplicate.name}”.`);

    const createdAt = new Date().toISOString();
    const artifacts = buildArtifactConstructVerificationArtifacts(saved.result, evidenceSha256s, {
      resultId: `construct-verification-${crypto.randomUUID()}`,
      assetId: `construct-verification-report-${crypto.randomUUID()}`,
      createdAt,
    });
    const context = {
      recordLengths: new Map(current.records.map((record) => [record.id, record.sequence.length])),
    };
    let workspace = appendArtifactAnalysisAsset({
      analysisResults: current.analysisResults,
      analysisAssets: current.analysisAssets,
    }, artifacts.asset, context);
    workspace = appendArtifactAnalysisWorkspaceResult(workspace, artifacts.result, context);
    const nextPayload: LoadedPayload = { ...current, ...workspace };
    payloadRef.current = nextPayload;
    setPayload(nextPayload);
    showWorkbenchNotice('Construct verification saved in Results with its compact evidence report.');
  }, [showWorkbenchNotice]);

  const openConstructVerificationWorkspace = useCallback(() => {
    closeOpenToolDetails();
    setShowTranslations(false);
    setShowAlignment(false);
    setShowGel(false);
    setShowAssembly(false);
    setShowCloningDesign(false);
    setShowPrimerDesign(false);
    setShowConstructVerification(true);
  }, [closeOpenToolDetails]);

  const openTranslationsWindow = useCallback(() => {
    closeOpenToolDetails();
    setShowAlignment(false);
    setShowGel(false);
    setShowAssembly(false);
    setShowCloningDesign(false);
    setShowPrimerDesign(false);
    setShowConstructVerification(false);
    setShowTranslations(true);
  }, [closeOpenToolDetails]);

  const toggleTranslationsWindow = useCallback(() => {
    setShowTranslations((current) => {
      if (!current) {
        closeOpenToolDetails();
        setShowAlignment(false);
        setShowGel(false);
        setShowAssembly(false);
        setShowCloningDesign(false);
        setShowPrimerDesign(false);
        setShowConstructVerification(false);
      }
      return !current;
    });
  }, [closeOpenToolDetails]);

  const openAlignmentWindow = useCallback(() => {
    closeOpenToolDetails();
    setShowTranslations(false);
    setShowGel(false);
    setShowAssembly(false);
    setShowCloningDesign(false);
    setShowPrimerDesign(false);
    setShowConstructVerification(false);
    setShowAlignment(true);
  }, [closeOpenToolDetails]);

  useEffect(() => {
    if (toolsPinned) return undefined;
    const openPanel = () => document.querySelector<HTMLDetailsElement>(
      '.motif-cs-inspector details[name="motif-cs-tools"][open]',
    );
    const closePanel = (panel: HTMLDetailsElement, restoreFocus: boolean) => {
      panel.open = false;
      if (!restoreFocus) return;
      window.requestAnimationFrame(() => {
        panel.querySelector<HTMLElement>(':scope > summary')?.focus({ preventScroll: true });
      });
    };
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const panel = openPanel();
      if (!panel) return;
      event.preventDefault();
      closePanel(panel, true);
    };
    const closeFromOutsidePointer = (event: PointerEvent) => {
      const panel = openPanel();
      if (!panel || !(event.target instanceof Node) || panel.contains(event.target)) return;
      closePanel(panel, false);
    };

    document.addEventListener('pointerdown', closeFromOutsidePointer, true);
    document.addEventListener('keydown', closeFromEscape);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutsidePointer, true);
      document.removeEventListener('keydown', closeFromEscape);
    };
  }, [toolsPinned]);

  useEffect(() => {
    const inspector = toolsInspectorRef.current;
    if (!inspector) return undefined;
    const handleToggle = (event: Event) => {
      const panel = event.target;
      if (!toolsPinned || !(panel instanceof HTMLDetailsElement) || !panel.open || panel.parentElement !== inspector) return;
      window.requestAnimationFrame(() => {
        const summary = panel.querySelector<HTMLElement>(':scope > summary');
        if (!summary) return;
        const inspectorRect = inspector.getBoundingClientRect();
        const summaryRect = summary.getBoundingClientRect();
        const desiredTop = inspectorRect.top + 4;
        if (summaryRect.top < desiredTop || summaryRect.bottom > inspectorRect.bottom - 4) {
          inspector.scrollTop += summaryRect.top - desiredTop;
        }
      });
    };
    inspector.addEventListener('toggle', handleToggle, true);
    return () => inspector.removeEventListener('toggle', handleToggle, true);
  }, [toolsPinned]);

  const handleMapDockOpen = useCallback(() => {
    closeOpenToolDetails();
    const resetMapScroll = () => {
      mapColumnRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      mapFrameRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    const revealOpenedDockInStackedLayout = () => {
      if (typeof window === 'undefined' || !window.matchMedia(STACKED_LAYOUT_MEDIA).matches) return;
      const openDock = mapColumnRef.current?.querySelector<HTMLDetailsElement>('.motif-cs-map-dock-strip > details[open]');
      const bodyStart = openDock?.querySelector<HTMLElement>('.motif-cs-layer-actions, .motif-cs-digest-body, .motif-cs-muted');
      bodyStart?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    };
    resetMapScroll();
    window.requestAnimationFrame(() => {
      resetMapScroll();
      revealOpenedDockInStackedLayout();
    });
  }, [closeOpenToolDetails, mapFrameRef]);

  useEffect(() => {
    saveWorkspaceLayoutPrefs({
      theme,
      paneWidths: preferredPaneWidths,
      stackedPaneHeights,
      paneVisibility,
      paneOrder,
      toolsPinned,
      panePlacements,
      floatingPaneRects,
    });
  }, [floatingPaneRects, paneOrder, panePlacements, paneVisibility, preferredPaneWidths, stackedPaneHeights, theme, toolsPinned]);

  useEffect(() => {
    saveMsaViewPreferences(msaViewPreferences);
  }, [msaViewPreferences]);

  const resetWorkspaceLayout = useCallback(() => {
    clearWorkspaceLayoutPrefs();
    setPreferredPaneWidths({ ...DEFAULT_WORKSPACE_LAYOUT.paneWidths });
    setPaneWidths({ ...DEFAULT_WORKSPACE_LAYOUT.paneWidths });
    setStackedPaneHeights({ ...DEFAULT_WORKSPACE_LAYOUT.stackedPaneHeights });
    setPaneVisibility({ ...DEFAULT_WORKSPACE_LAYOUT.paneVisibility });
    setToolsPinned(DEFAULT_WORKSPACE_LAYOUT.toolsPinned);
    setPaneOrder([...DEFAULT_WORKSPACE_LAYOUT.paneOrder]);
    setPanePlacements({ ...DEFAULT_WORKSPACE_LAYOUT.panePlacements });
    setFloatingPaneRects(defaultFloatingPaneRects());
    setFloatingPaneZOrder([]);
  }, []);

  // The seven floating tool windows keep their geometry in plain state, so a size
  // dragged onto one survives closing and reopening it. That much is deliberate:
  // a size chosen by dragging a corner is a choice, and closing a window is not a
  // request to forget it. What was missing is the way back — "Reset display" put
  // the panes right and left every window exactly as small as it found it, which
  // is the one state a user actually needs the button for. The signal is what
  // reaches windows that are already open; see FloatingWindow.
  const [windowResetSignal, setWindowResetSignal] = useState(0);
  const resetToolWindowRects = useCallback(() => {
    setTranslationsWin(defaultTranslationsWindowRect());
    setPrimerWin(defaultPrimerWindowRect());
    setAlignmentWin(defaultAlignmentWindowRect());
    setGelWin(defaultGelWindowRect());
    setAssemblyWin(defaultAssemblyWindowRect());
    setCloningDesignWin(defaultCloningDesignWindowRect());
    setConstructVerificationWin(defaultConstructVerificationWindowRect());
    setWindowResetSignal((value) => value + 1);
  }, []);

  const resetDisplayPreferences = useCallback(() => {
    resetWorkspaceLayout();
    resetToolWindowRects();
    clearMsaViewPreferences();
    setMsaViewPreferences({ ...DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES });
  }, [resetToolWindowRects, resetWorkspaceLayout]);

  const downloadWorkspaceBackup = useCallback(() => {
    const snapshot = createArtifactDatabaseSnapshot(payloadRef.current, artifactStateRef.current);
    return downloadTextFile('motif-workspace-backup.json', JSON.stringify(snapshot, null, 2), 'application/json');
  }, []);

  const restoreWorkspaceBackupFile = useCallback(async (file: File, returnFocus: HTMLElement | null = null) => {
    const rawDatabase = parseArtifactDatabaseJson(await file.text());
    if (!rawDatabase) throw new Error('This file is not a Motif Database JSON backup.');
    requestArtifactDatabaseRestore(rawDatabase, file.name, returnFocus, 'durable-checkpoint');
  }, [requestArtifactDatabaseRestore]);

  const toggleToolsPinned = useCallback(() => {
    setPaneVisibility((current) => current.tools ? current : { ...current, tools: true });
    if (panePlacements.tools === 'floating') {
      stopFloatingPaneInteraction();
      setPanePlacements((current) => ({ ...current, tools: 'docked' }));
      setFloatingPaneZOrder((current) => current.filter((pane) => pane !== 'tools'));
      setToolsPinned(false);
      window.requestAnimationFrame(closeOpenToolDetails);
      return;
    }
    setToolsPinned((current) => {
      const next = !current;
      if (!next && typeof window !== 'undefined') {
        window.requestAnimationFrame(closeOpenToolDetails);
      }
      return next;
    });
  }, [closeOpenToolDetails, panePlacements.tools, stopFloatingPaneInteraction]);

  const togglePane = useCallback((pane: PaneKey) => {
    const isStacked = typeof window !== 'undefined' && window.matchMedia(STACKED_LAYOUT_MEDIA).matches;
    setPaneVisibility((current) => {
      const openContentCount = CONTENT_PANE_KEYS.filter((key) => current[key]).length;
      if (pane !== 'tools' && current[pane] && openContentCount <= 1) return current;
      const dockedContentCount = CONTENT_PANE_KEYS.filter((key) => (
        current[key] && panePlacements[key] === 'docked'
      )).length;
      if (pane !== 'tools' && current[pane] && panePlacements[pane] === 'docked' && dockedContentCount <= 1) return current;
      return { ...current, [pane]: !current[pane] };
    });
    if ((isStacked || panePlacements[pane] === 'floating') && !paneVisibility[pane]) {
      window.requestAnimationFrame(() => scrollPaneIntoView(pane));
    }
  }, [panePlacements, paneVisibility, scrollPaneIntoView]);

  const reorderPane = useCallback((dragged: PaneKey, target: PaneKey) => {
    if (dragged === target) return;
    setPaneOrder((current) => {
      const base = DEFAULT_PANE_ORDER.filter((pane) => current.includes(pane));
      const merged = [...current, ...base].filter((pane, index, list) => list.indexOf(pane) === index);
      const withoutDragged = merged.filter((pane) => pane !== dragged);
      const targetIndex = withoutDragged.indexOf(target);
      if (targetIndex < 0) return current;
      withoutDragged.splice(targetIndex, 0, dragged);
      return withoutDragged;
    });
  }, []);

  const handlePaneDragStart = useCallback((pane: PaneKey, event: ReactDragEvent<HTMLButtonElement>) => {
    paneDragRef.current = pane;
    setPaneDragUi({ dragged: pane, target: null });
    document.body.dataset.motifCsPaneDragging = pane;
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-motif-pane', pane);
    event.dataTransfer.setData('text/plain', pane);
  }, []);

  const handlePaneDragOver = useCallback((event: ReactDragEvent<HTMLButtonElement>) => {
    if (!paneDragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const target = event.currentTarget.dataset.paneToggle as PaneKey | undefined;
    if (target && DEFAULT_PANE_ORDER.includes(target)) {
      setPaneDragUi((current) => current && current.target !== target ? { ...current, target } : current);
    }
  }, []);

  const handlePaneDrop = useCallback((target: PaneKey, event: ReactDragEvent<HTMLButtonElement>) => {
    const dragged = (event.dataTransfer.getData('application/x-motif-pane') || paneDragRef.current) as PaneKey | null;
    if (!dragged || !DEFAULT_PANE_ORDER.includes(dragged)) return;
    event.preventDefault();
    event.stopPropagation();
    reorderPane(dragged, target);
    setPaneDragUi(null);
    delete document.body.dataset.motifCsPaneDragging;
    suppressPaneToggleClickRef.current = true;
    window.setTimeout(() => {
      suppressPaneToggleClickRef.current = false;
    }, 250);
  }, [reorderPane]);

  const handlePaneDragEnd = useCallback((event: ReactDragEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    paneDragRef.current = null;
    setPaneDragUi(null);
    delete document.body.dataset.motifCsPaneDragging;
  }, []);

  const handlePaneToggleClick = useCallback((pane: PaneKey) => {
    if (suppressPaneToggleClickRef.current) {
      suppressPaneToggleClickRef.current = false;
      return;
    }
    if (pane === 'tools') {
      toggleToolsPinned();
      return;
    }
    togglePane(pane);
  }, [togglePane, toggleToolsPinned]);

  const collapsePaneAndRestoreFocus = useCallback((pane: PaneKey) => {
    if (pane === 'tools') toggleToolsPinned();
    else togglePane(pane);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-pane-toggle="${pane}"]`)?.focus({ preventScroll: true });
    });
  }, [togglePane, toggleToolsPinned]);

  const paneOrderIndex = useCallback((pane: PaneKey) => {
    const index = paneOrder.indexOf(pane);
    return index >= 0 ? index : PANE_ORDER_FALLBACK[pane];
  }, [paneOrder]);

  const paneCssOrder = useCallback((pane: PaneKey, position: 'pane' | 'before' | 'after' = 'pane') => {
    const base = paneOrderIndex(pane) * 3;
    if (position === 'before') return base;
    if (position === 'after') return base + 2;
    return base + 1;
  }, [paneOrderIndex]);

  const toolsFloating = panePlacements.tools === 'floating';
  const toolsDocked = panePlacements.tools === 'docked' && toolsPinned;
  const toolsRail = panePlacements.tools === 'docked' && !toolsPinned;
  const visibleOrderedPanes = useMemo(
    () => paneOrder.filter((pane) => paneVisibility[pane] && panePlacements[pane] === 'docked'),
    [paneOrder, panePlacements, paneVisibility],
  );
  const visibleContentPanes = useMemo(
    () => paneOrder.filter((pane): pane is Exclude<PaneKey, 'tools'> => (
      pane !== 'tools' && paneVisibility[pane] && panePlacements[pane] === 'docked'
    )),
    [paneOrder, panePlacements, paneVisibility],
  );
  const paneCollapsePointsRight = useCallback((pane: Exclude<PaneKey, 'tools'>) => {
    const index = visibleContentPanes.indexOf(pane);
    return index >= Math.ceil(visibleContentPanes.length / 2);
  }, [visibleContentPanes]);
  const previousVisiblePane = useCallback((pane: PaneKey) => {
    const index = visibleOrderedPanes.indexOf(pane);
    return index > 0 ? visibleOrderedPanes[index - 1] : undefined;
  }, [visibleOrderedPanes]);
  const sequenceBeforeMap = paneVisibility.sequence && paneVisibility.map
    && panePlacements.sequence === 'docked' && panePlacements.map === 'docked'
    && previousVisiblePane('map') === 'sequence';
  const mapBeforeSequence = paneVisibility.sequence && paneVisibility.map
    && panePlacements.sequence === 'docked' && panePlacements.map === 'docked'
    && previousVisiblePane('sequence') === 'map';
  const showSequenceMapResizeHandle = sequenceBeforeMap || mapBeforeSequence;
  const showToolsResizeHandle = paneVisibility.tools && toolsDocked && visibleOrderedPanes[0] !== 'tools';
  const visibleResizablePanes = useMemo(() => {
    const keys: ResizablePaneKey[] = [];
    if (paneVisibility.inventory && panePlacements.inventory === 'docked') keys.push('inventory');
    if (paneVisibility.sequence && panePlacements.sequence === 'docked') keys.push('sequence');
    if (paneVisibility.map && panePlacements.map === 'docked') keys.push('map');
    if (paneVisibility.tools && toolsDocked) keys.push('tools');
    return keys;
  }, [panePlacements, paneVisibility, toolsDocked]);
  const resizeHandleCount = (paneVisibility.inventory && panePlacements.inventory === 'docked' ? 1 : 0)
    + (showSequenceMapResizeHandle ? 1 : 0)
    + (showToolsResizeHandle ? 1 : 0);
  const toolsRailWidth = paneVisibility.tools && toolsRail ? TOOLS_RAIL_WIDTH : 0;

  useLayoutEffect(() => {
    const node = topbarRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const height = Math.max(1, node.getBoundingClientRect().height);
      setTopbarHeight((current) => Math.abs(current - height) < 0.1 ? current : height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const node = workspaceMainRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const width = Math.max(1, Math.floor(node.clientWidth));
      const height = Math.max(1, Math.floor(node.clientHeight));
      setWorkspaceMainSize((current) => current.width === width && current.height === height
        ? current
        : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const stableCompactTopology = workspaceMainSize.width >= 640 && workspaceMainSize.width <= 1535;
  const paneReorderAvailable = workspaceMainSize.width >= 1536;
  const handlePaneToggleKeyDown = useCallback((pane: PaneKey, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!paneReorderAvailable || !event.altKey || !event.shiftKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    setPaneOrder((current) => {
      const index = current.indexOf(pane);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-pane-toggle="${pane}"]`)?.focus({ preventScroll: true });
    });
  }, [paneReorderAvailable]);
  const compactPinnedLayout = toolsDocked && stableCompactTopology;
  const compactMapHiddenTwoRowLayout = compactPinnedLayout
    && workspaceMainSize.width <= 767
    && (!paneVisibility.map || panePlacements.map === 'floating');
  const compactRowResizeActive = compactPinnedLayout
    && paneVisibility.sequence && panePlacements.sequence === 'docked'
    && ((paneVisibility.map && panePlacements.map === 'docked') || compactMapHiddenTwoRowLayout);
  const twoRowResizeActive = !toolsDocked
    && stableCompactTopology
    && visibleContentPanes.length === 3
    && paneVisibility.sequence
    && paneVisibility.map;
  const workspaceRowResizeActive = compactRowResizeActive || twoRowResizeActive;
  const compactRowMinHeight = workspaceMainSize.height <= 360
    ? TWO_ROW_VERY_SHORT_MIN_HEIGHT
    : workspaceMainSize.height <= 620
      ? COMPACT_SHORT_ROW_MIN_HEIGHT
      : COMPACT_ROW_MIN_HEIGHT;
  const compactBottomRowMinHeight = compactRowMinHeight;
  const compactTopRowMaxHeight = Math.max(
    compactRowMinHeight,
    workspaceMainSize.height - COMPACT_ROW_DIVIDER_HEIGHT - compactBottomRowMinHeight,
  );

  const paneWidthLimitsForCurrentLayout = useCallback((pane: ResizablePaneKey) => {
    if (compactPinnedLayout) return COMPACT_PINNED_PANE_WIDTH_LIMITS[pane] ?? PANE_WIDTH_LIMITS[pane];
    if (stableCompactTopology && visibleContentPanes.length === 3 && pane === 'inventory') {
      return {
        ...PANE_WIDTH_LIMITS.inventory,
        max: Math.min(PANE_WIDTH_LIMITS.inventory.max, Math.floor(workspaceMainSize.width * 0.38)),
      };
    }
    return PANE_WIDTH_LIMITS[pane];
  }, [compactPinnedLayout, stableCompactTopology, visibleContentPanes.length, workspaceMainSize.width]);

  const stackedPaneBoundsForCurrentLayout = useCallback((pane: StackedResizablePaneKey) => {
    if (pane === 'sequence' && workspaceRowResizeActive) {
      return { min: compactRowMinHeight, max: compactTopRowMaxHeight };
    }
    return STACKED_PANE_HEIGHT_LIMITS[pane];
  }, [compactRowMinHeight, compactTopRowMaxHeight, workspaceRowResizeActive]);

  const clampPaneWidthsForViewport = useCallback((widths: PaneWidths): PaneWidths => {
    if (compactPinnedLayout) {
      const next = { ...widths };
      for (const pane of ['inventory', 'tools'] as const) {
        const limits = paneWidthLimitsForCurrentLayout(pane);
        next[pane] = clamp(next[pane], limits.min, limits.max);
      }
      return next.inventory === widths.inventory && next.tools === widths.tools ? widths : next;
    }
    if (typeof window !== 'undefined' && window.matchMedia(STACKED_LAYOUT_MEDIA).matches) {
      if (!stableCompactTopology) return widths;
      const limits = paneWidthLimitsForCurrentLayout('inventory');
      const inventory = clamp(widths.inventory, limits.min, limits.max);
      return inventory === widths.inventory ? widths : { ...widths, inventory };
    }
    const twoRowLayout = typeof window !== 'undefined'
      && window.matchMedia(TWO_ROW_LAYOUT_MEDIA).matches
      && visibleContentPanes.length === 3;
    const overlayTools = typeof window !== 'undefined' && window.matchMedia(OVERLAY_TOOLS_LAYOUT_MEDIA).matches;
    const fittedPanes = twoRowLayout
      ? visibleResizablePanes.filter((pane) => pane === 'inventory' || pane === 'sequence')
      : overlayTools
      ? visibleResizablePanes.filter((pane) => pane !== 'tools')
      : visibleResizablePanes;
    if (fittedPanes.length === 0) return widths;
    const mainWidth = Math.max(1, workspaceMainSize.width);
    const effectiveHandleCount = twoRowLayout
      ? Number(fittedPanes.includes('inventory') && fittedPanes.includes('sequence'))
      : resizeHandleCount - (overlayTools && showToolsResizeHandle ? 1 : 0);
    const resizeHandleSpace = Math.max(0, effectiveHandleCount) * 7;
    const effectiveToolsRailWidth = overlayTools ? TOOLS_RAIL_WIDTH : toolsRailWidth;
    const next = { ...widths };
    const total = effectiveToolsRailWidth + resizeHandleSpace + fittedPanes.reduce((sum, key) => sum + next[key], 0);
    if (total <= mainWidth) return widths;

    // Shrink every visible pane proportionally to its available slack. This
    // prevents Map from collapsing to its minimum before Sequence gives up any
    // width, which made compact Claude Science layouts feel lopsided.
    let deficit = total - mainWidth;
    const shrinkable = fittedPanes.filter((key) => next[key] > paneWidthLimitsForCurrentLayout(key).min);
    while (deficit > 0.5 && shrinkable.length > 0) {
      const totalSlack = shrinkable.reduce(
        (sum, key) => sum + Math.max(0, next[key] - paneWidthLimitsForCurrentLayout(key).min),
        0,
      );
      if (totalSlack <= 0) break;
      let consumed = 0;
      for (const key of shrinkable) {
        const slack = Math.max(0, next[key] - paneWidthLimitsForCurrentLayout(key).min);
        const shrink = Math.min(slack, deficit * (slack / totalSlack));
        next[key] -= shrink;
        consumed += shrink;
      }
      if (consumed <= 0.5) break;
      deficit -= consumed;
    }
    return next;
  }, [compactPinnedLayout, paneWidthLimitsForCurrentLayout, resizeHandleCount, showToolsResizeHandle, stableCompactTopology, toolsRailWidth, visibleContentPanes.length, visibleResizablePanes, workspaceMainSize.width]);

  useEffect(() => {
    const clampForCurrentViewport = () => {
      const next = clampPaneWidthsForViewport(preferredPaneWidths);
      setPaneWidths((current) => next.inventory === current.inventory
        && next.sequence === current.sequence
        && next.map === current.map
        && next.tools === current.tools
        ? current
        : next);
    };
    clampForCurrentViewport();
    window.addEventListener('resize', clampForCurrentViewport);
    return () => window.removeEventListener('resize', clampForCurrentViewport);
  }, [clampPaneWidthsForViewport, preferredPaneWidths]);

  const paneResizeNeighbor = useCallback((pane: ResizablePaneKey, edge: ResizeEdge) => {
    if (compactPinnedLayout && (pane === 'inventory' || pane === 'tools')) return undefined;
    const overlayTools = typeof window !== 'undefined' && window.matchMedia(OVERLAY_TOOLS_LAYOUT_MEDIA).matches;
    const twoRowLayout = typeof window !== 'undefined'
      && window.matchMedia(TWO_ROW_LAYOUT_MEDIA).matches
      && visibleContentPanes.length === 3;
    if (twoRowLayout && pane === 'inventory') return 'sequence';
    const fittedPanes = visibleOrderedPanes.filter((key): key is ResizablePaneKey => (
      visibleResizablePanes.includes(key as ResizablePaneKey)
      && !(overlayTools && key === 'tools')
    ));
    const index = fittedPanes.indexOf(pane);
    if (index < 0) return undefined;
    return fittedPanes[index + (edge === 'after' ? 1 : -1)];
  }, [compactPinnedLayout, visibleContentPanes.length, visibleOrderedPanes, visibleResizablePanes]);

  const resizePanePair = useCallback((
    pane: ResizablePaneKey,
    neighbor: ResizablePaneKey,
    startWidths: PaneWidths,
    requestedPaneDelta: number,
  ) => {
    const paneLimits = paneWidthLimitsForCurrentLayout(pane);
    const neighborLimits = paneWidthLimitsForCurrentLayout(neighbor);
    // Flex-grow can make a rendered pane wider than its stored-width maximum.
    // Keep zero in the legal delta range when either rendered width already
    // sits outside its preferred limits, so the user can drag it back toward
    // the configured range instead of being clamped in the wrong direction.
    const paneMinDelta = startWidths[pane] < paneLimits.min
      ? 0
      : paneLimits.min - startWidths[pane];
    const paneMaxDelta = startWidths[pane] > paneLimits.max
      ? 0
      : paneLimits.max - startWidths[pane];
    const neighborMinDelta = startWidths[neighbor] > neighborLimits.max
      ? Number.NEGATIVE_INFINITY
      : startWidths[neighbor] - neighborLimits.max;
    const neighborMaxDelta = startWidths[neighbor] < neighborLimits.min
      ? 0
      : startWidths[neighbor] - neighborLimits.min;
    const minDelta = Math.max(
      paneMinDelta,
      neighborMinDelta,
    );
    const maxDelta = Math.min(
      paneMaxDelta,
      neighborMaxDelta,
    );
    const appliedDelta = clamp(requestedPaneDelta, minDelta, maxDelta);
    return {
      ...startWidths,
      [pane]: startWidths[pane] + appliedDelta,
      [neighbor]: startWidths[neighbor] - appliedDelta,
    };
  }, [paneWidthLimitsForCurrentLayout]);

  const startPaneResize = useCallback((pane: ResizablePaneKey, event: ReactPointerEvent<HTMLDivElement>, edge: ResizeEdge = 'after') => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    // paneWidths are flex BASIS values, and flex-grow then hands out whatever the row
    // has left over on top of them. The two drift apart: at 1920 the map renders 976px
    // against a basis of 560. Pricing the drag against the basis meant the pair stopped
    // when the BASIS hit map.min, leaving ~400px of visibly unused map still on screen
    // and the pane refusing to widen. Seed from the rendered geometry instead. Measured
    // widths already sum to the row, so the free space flex-grow was distributing is
    // zero for the duration of the drag and the pane tracks the pointer one-to-one.
    const startWidths = measuredPaneWidths(paneWidths, panePlacements);
    const startPreferredWidths = { ...preferredPaneWidths };
    const neighbor = paneResizeNeighbor(pane, edge);
    const startWidth = startWidths[pane];
    const direction = pane === 'tools' || edge === 'before' ? -1 : 1;
    const limits = paneWidthLimitsForCurrentLayout(pane);
    const resizeHandleWidth = 7;
    const overlayLayout = window.matchMedia(OVERLAY_TOOLS_LAYOUT_MEDIA).matches;
    const fittedPanes = overlayLayout
      ? visibleResizablePanes.filter((key) => key !== 'tools')
      : visibleResizablePanes;
    const effectiveToolsRailWidth = overlayLayout ? TOOLS_RAIL_WIDTH : toolsRailWidth;
    const otherPaneWidth = fittedPanes
      .filter((key) => key !== pane)
      .reduce((sum, key) => sum + paneWidths[key], effectiveToolsRailWidth);
    const effectiveHandleCount = resizeHandleCount - (overlayLayout && showToolsResizeHandle ? 1 : 0);
    const resizeHandleSpace = Math.max(0, effectiveHandleCount) * resizeHandleWidth;
    const mainWidth = Math.max(1, workspaceMainSize.width);
    const overlayTools = pane === 'tools' && overlayLayout;
    const compactRowMaxWidth = compactPinnedLayout && pane === 'inventory'
      ? mainWidth - resizeHandleWidth - PANE_WIDTH_LIMITS.sequence.min
      : compactPinnedLayout && pane === 'tools'
        ? mainWidth - resizeHandleWidth - PANE_WIDTH_LIMITS.map.min
        : null;
    const maxWidthForViewport = compactRowMaxWidth !== null
      ? Math.min(limits.max, Math.max(limits.min, compactRowMaxWidth))
      : overlayTools
        ? Math.min(limits.max, Math.max(limits.min, mainWidth - 56))
        : Math.max(
            limits.min,
            Math.min(limits.max, mainWidth - otherPaneWidth - resizeHandleSpace),
          );
    stopPaneResize();
    const resizeHandle = event.currentTarget;
    const pointerId = event.pointerId;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      const delta = (moveEvent.clientX - startX) * direction;
      if (neighbor) {
        const nextWidths = resizePanePair(pane, neighbor, startWidths, delta);
        const appliedDelta = nextWidths[pane] - startWidths[pane];
        setPreferredPaneWidths({
          ...startPreferredWidths,
          [pane]: clamp(startPreferredWidths[pane] + appliedDelta, paneWidthLimitsForCurrentLayout(pane).min, paneWidthLimitsForCurrentLayout(pane).max),
          [neighbor]: clamp(startPreferredWidths[neighbor] - appliedDelta, paneWidthLimitsForCurrentLayout(neighbor).min, paneWidthLimitsForCurrentLayout(neighbor).max),
        });
        setPaneWidths(nextWidths);
        return;
      }
      const nextWidth = clamp(startWidth + delta, limits.min, maxWidthForViewport);
      const nextPreferred = { ...startPreferredWidths, [pane]: nextWidth };
      setPreferredPaneWidths(nextPreferred);
      setPaneWidths(clampPaneWidthsForViewport(nextPreferred));
    };

    const removeListeners = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
      window.removeEventListener('blur', handleWindowBlur);
      resizeHandle.removeEventListener('lostpointercapture', handleLostPointerCapture);
      if (paneResizeCleanupRef.current === removeListeners) paneResizeCleanupRef.current = null;
      try {
        if (resizeHandle.hasPointerCapture?.(pointerId)) resizeHandle.releasePointerCapture?.(pointerId);
      } catch {
        /* Capture may already be gone after blur or DOM removal. */
      }
    };
    function handlePointerEnd(endEvent: PointerEvent) {
      if (endEvent.pointerId !== pointerId) return;
      stopPaneResize();
    }
    function handleLostPointerCapture(lostEvent: PointerEvent) {
      if (lostEvent.pointerId !== pointerId) return;
      stopPaneResize();
    }
    function handleWindowBlur() {
      stopPaneResize();
    }

    paneResizeCleanupRef.current = removeListeners;
    document.body.dataset.motifCsResizing = pane;
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
    window.addEventListener('blur', handleWindowBlur);
    resizeHandle.addEventListener('lostpointercapture', handleLostPointerCapture);
    try {
      resizeHandle.setPointerCapture?.(pointerId);
    } catch {
      /* Window listeners keep resizing active when capture is unavailable. */
    }
  }, [clampPaneWidthsForViewport, compactPinnedLayout, paneResizeNeighbor, panePlacements, paneWidthLimitsForCurrentLayout, paneWidths, preferredPaneWidths, resizeHandleCount, resizePanePair, showToolsResizeHandle, stopPaneResize, toolsRailWidth, visibleResizablePanes, workspaceMainSize.width]);
  const resizePaneFromKeyboard = useCallback((pane: ResizablePaneKey, event: ReactKeyboardEvent<HTMLDivElement>, edge: ResizeEdge = 'after') => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = pane === 'tools' || edge === 'before' ? -1 : 1;
    const screenDirection = event.key === 'ArrowRight' ? 1 : -1;
    const step = event.shiftKey ? 32 : 16;
    const neighbor = paneResizeNeighbor(pane, edge);
    if (neighbor) {
      const nextWidths = resizePanePair(pane, neighbor, paneWidths, screenDirection * direction * step);
      const appliedDelta = nextWidths[pane] - paneWidths[pane];
      setPreferredPaneWidths((current) => ({
        ...current,
        [pane]: clamp(current[pane] + appliedDelta, paneWidthLimitsForCurrentLayout(pane).min, paneWidthLimitsForCurrentLayout(pane).max),
        [neighbor]: clamp(current[neighbor] - appliedDelta, paneWidthLimitsForCurrentLayout(neighbor).min, paneWidthLimitsForCurrentLayout(neighbor).max),
      }));
      setPaneWidths(nextWidths);
      return;
    }
    const limits = paneWidthLimitsForCurrentLayout(pane);
    const requested = clamp(preferredPaneWidths[pane] + screenDirection * direction * step, limits.min, limits.max);
    const nextPreferred = { ...preferredPaneWidths, [pane]: requested };
    setPreferredPaneWidths(nextPreferred);
    setPaneWidths(clampPaneWidthsForViewport(nextPreferred));
  }, [clampPaneWidthsForViewport, paneResizeNeighbor, paneWidthLimitsForCurrentLayout, paneWidths, preferredPaneWidths, resizePanePair]);

  const resizeStackedPaneTo = useCallback((pane: StackedResizablePaneKey, height: number) => {
    const bounds = stackedPaneBoundsForCurrentLayout(pane);
    setStackedPaneHeights((current) => ({
      ...current,
      [pane]: clamp(height, bounds.min, bounds.max),
    }));
  }, [stackedPaneBoundsForCurrentLayout]);

  const startStackedPaneResize = useCallback((pane: StackedResizablePaneKey, event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    const supportsRowResize = window.matchMedia(STACKED_LAYOUT_MEDIA).matches
      || window.matchMedia(TWO_ROW_LAYOUT_MEDIA).matches
      || (toolsDocked && window.matchMedia(COMPACT_PINNED_LAYOUT_MEDIA).matches);
    if (!supportsRowResize) return;
    const paneElement = pane === 'inventory' ? inventoryColumnRef.current : sequenceColumnRef.current;
    if (!paneElement) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = paneElement.getBoundingClientRect().height;
    const resizeHandle = event.currentTarget;
    const pointerId = event.pointerId;
    stopStackedPaneResize();

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      resizeStackedPaneTo(pane, startHeight + moveEvent.clientY - startY);
    };
    const removeListeners = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
      window.removeEventListener('blur', handleWindowBlur);
      resizeHandle.removeEventListener('lostpointercapture', handleLostPointerCapture);
      if (stackedPaneResizeCleanupRef.current === removeListeners) stackedPaneResizeCleanupRef.current = null;
      try {
        if (resizeHandle.hasPointerCapture?.(pointerId)) resizeHandle.releasePointerCapture?.(pointerId);
      } catch {
        /* Capture may already be gone after blur or DOM removal. */
      }
    };
    function handlePointerEnd(endEvent: PointerEvent) {
      if (endEvent.pointerId !== pointerId) return;
      stopStackedPaneResize();
    }
    function handleLostPointerCapture(lostEvent: PointerEvent) {
      if (lostEvent.pointerId !== pointerId) return;
      stopStackedPaneResize();
    }
    function handleWindowBlur() {
      stopStackedPaneResize();
    }

    stackedPaneResizeCleanupRef.current = removeListeners;
    document.body.dataset.motifCsStackedResizing = pane;
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
    window.addEventListener('blur', handleWindowBlur);
    resizeHandle.addEventListener('lostpointercapture', handleLostPointerCapture);
    try {
      resizeHandle.setPointerCapture?.(pointerId);
    } catch {
      /* Window listeners keep resizing active when capture is unavailable. */
    }
  }, [resizeStackedPaneTo, stopStackedPaneResize, toolsDocked]);

  const resizeStackedPaneFromKeyboard = useCallback((pane: StackedResizablePaneKey, event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const paneElement = pane === 'inventory' ? inventoryColumnRef.current : sequenceColumnRef.current;
    const currentHeight = paneElement?.getBoundingClientRect().height
      ?? stackedPaneHeights[pane]
      ?? (pane === 'inventory' ? 160 : 360);
    const step = event.shiftKey ? 48 : 24;
    resizeStackedPaneTo(pane, currentHeight + (event.key === 'ArrowDown' ? step : -step));
  }, [resizeStackedPaneTo, stackedPaneHeights]);

  const visibleContentPaneCount = CONTENT_PANE_KEYS.filter((pane) => paneVisibility[pane]).length;
  const dockedContentPaneCount = CONTENT_PANE_KEYS.filter((pane) => (
    paneVisibility[pane] && panePlacements[pane] === 'docked'
  )).length;
  const dockedPaneCount = dockedContentPaneCount + Number(paneVisibility.tools && toolsDocked);
  const canHideContentPane = (pane: Exclude<PaneKey, 'tools'>) => (
    visibleContentPaneCount > 1
    && (panePlacements[pane] !== 'docked' || dockedContentPaneCount > 1)
  );
  const contentPaneHideBlockReason = (pane: Exclude<PaneKey, 'tools'>) => (
    visibleContentPaneCount <= 1
      ? 'At least one content pane must stay visible'
      : panePlacements[pane] === 'docked' && dockedContentPaneCount <= 1
        ? 'Keep one content pane docked in the workspace'
        : ''
  );
  const stackedInventoryBounds = stackedPaneBoundsForCurrentLayout('inventory');
  const effectiveStackedInventoryHeight = stackedPaneHeights.inventory === null
    ? null
    : clamp(stackedPaneHeights.inventory, stackedInventoryBounds.min, stackedInventoryBounds.max);
  const stackedSequenceBounds = stackedPaneBoundsForCurrentLayout('sequence');
  const effectiveStackedSequenceHeight = stackedPaneHeights.sequence === null
    ? null
    : clamp(stackedPaneHeights.sequence, stackedSequenceBounds.min, stackedSequenceBounds.max);
  const defaultCompactTopRowHeight = clamp(
    Math.round((workspaceMainSize.height - COMPACT_ROW_DIVIDER_HEIGHT) * (
      workspaceMainSize.height <= 620
        ? workspaceMainSize.width <= 900 ? 0.44 : 0.5
        : 0.46
    )),
    compactRowMinHeight,
    compactTopRowMaxHeight,
  );
  const renderedStackedSequenceHeight = effectiveStackedSequenceHeight
    ?? (workspaceRowResizeActive ? defaultCompactTopRowHeight : 360);
  const activeRecordTabIndex = Math.max(0, payload.records.findIndex((record) => record.id === recordId));
  const floatingPaneStyle = (pane: PaneKey): CSSProperties => {
    if (panePlacements[pane] !== 'floating') return {};
    const safeViewport: FloatingSurfaceViewport = {
      width: floatingViewport.width,
      height: floatingViewport.height,
      insets: { top: topbarHeight + 8, right: toolsRail ? TOOLS_RAIL_WIDTH + 8 : 8, bottom: 8, left: 8 },
    };
    const rect = clampFloatingSurfaceRect(floatingPaneRects[pane], safeViewport, FLOATING_PANE_LIMITS[pane]);
    const zIndex = 60 + Math.max(0, floatingPaneZOrder.indexOf(pane));
    return {
      '--motif-cs-floating-pane-left': `${rect.x}px`,
      '--motif-cs-floating-pane-top': `${rect.y}px`,
      '--motif-cs-floating-pane-width': `${rect.w}px`,
      '--motif-cs-floating-pane-height': `${rect.h}px`,
      left: rect.x,
      top: rect.y,
      width: rect.w,
      height: rect.h,
      zIndex,
    } as CSSProperties;
  };

  return (
    <div
      className="motif-cs-shell"
      data-motif-artifact="real-component-bundle"
      data-artifact-schema={payload.schema}
      data-theme={theme}
      style={{ '--motif-cs-topbar-height': `${topbarHeight}px` } as CSSProperties}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <a className="motif-cs-skip-link" href="#motif-cs-workspace">Skip to workspace</a>
      {/* The Tools rail is authored last, so its first tool was Tab stop 124 of
          139 at 1440x900 — measured with real keys, all fifteen tools behind
          the whole workspace. A control that requires that many presses is
          effectively unreachable for keyboard users.
          A second skip link is the fix the first one already established: it
          shares the first one's slot, since only the focused link is ever
          untranslated, so no new CSS is needed. The rail is the last pane in
          the DOM, so Tab from it continues straight into the tool summaries —
          measured after: 2 Tab + Enter + 2 Tab, then all fifteen in order. */}
      {paneVisibility.tools ? (
        <a className="motif-cs-skip-link" href="#motif-cs-tools-pane">Skip to tools</a>
      ) : null}
      {dropState.active ? (
        <div className="motif-cs-dropzone" aria-hidden="true">
          <div className="motif-cs-dropzone-card">{dropState.message}</div>
        </div>
      ) : null}
      <div className="motif-cs-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {dropState.message}
      </div>
      {workbenchNotice ? (
        <div
          className="motif-cs-workbench-notice"
          data-tone={workbenchNotice.tone}
          role={workbenchNotice.tone === 'error' ? 'alert' : 'status'}
          aria-live={workbenchNotice.tone === 'error' ? 'assertive' : 'polite'}
        >
          {workbenchNotice.message}
        </div>
      ) : null}
      {pendingDatabaseRestore ? (
        <RestoreWorkspaceDialog
          sourceLabel={pendingDatabaseRestore.sourceLabel}
          incomingRecordCount={pendingDatabaseRestore.prepared.payload.records.length}
          currentRecordCount={payload.records.length}
          hasUnsavedChanges={hasUnsavedChanges}
          onCancel={cancelArtifactDatabaseRestore}
          onConfirm={confirmArtifactDatabaseRestore}
        />
      ) : null}
      <header ref={topbarRef} className="motif-cs-topbar" aria-label="Motif for Claude Science workspace">
        <div className="motif-cs-brand" aria-label="Motif for Claude Science">
          <span translate="no">Motif</span>
          <small translate="no">for Claude Science</small>
        </div>
        {/* A record-count and a sequence-length chip used to render here on every
            load and were hidden by `.motif-cs-topbar-meta > .motif-cs-chip` in the
            BASE block — not a media query — so no viewport, record type, pane
            placement or media mode could reveal them. Deleted rather than shown:
            the topbar reserves 172px on the right for the host's Annotate pill
            and leaves an 8px gap, so there is nowhere to put them, and both facts
            are already on screen — the inventory badge carries the count and the
            inventory row and map header both carry "circular · 2,578 bp". */}
        <div className="motif-cs-topbar-meta">
          <div
            className="motif-cs-pane-switcher"
            role="group"
            aria-label={paneReorderAvailable
              ? 'Pane visibility controls. Drag buttons to reorder the workspace.'
              : 'Pane visibility controls. Compact layouts use a stable workspace arrangement.'}
          >
            {paneOrder.map((pane) => {
              const PaneIcon = PANE_ICONS[pane];
              const paneOn = pane === 'tools' ? true : paneVisibility[pane];
              const paneHideBlocked = pane !== 'tools' && paneOn && !canHideContentPane(pane);
              const paneHideBlockReason = pane === 'tools' ? '' : contentPaneHideBlockReason(pane);
              const paneFloating = panePlacements[pane] === 'floating';
              return (
                <button
                  key={pane}
                  className="motif-cs-pane-toggle"
                  type="button"
                  data-pane-toggle={pane}
                  data-active={(pane === 'tools' ? toolsDocked || toolsFloating : paneOn) || undefined}
                  data-dragging={paneDragUi?.dragged === pane || undefined}
                  data-drop-target={paneDragUi?.target === pane && paneDragUi.dragged !== pane || undefined}
                  draggable={paneReorderAvailable}
                  disabled={paneHideBlocked}
                  onClick={() => handlePaneToggleClick(pane)}
                  onKeyDown={(event) => handlePaneToggleKeyDown(pane, event)}
                  onDragStart={(event) => handlePaneDragStart(pane, event)}
                  onDragOver={handlePaneDragOver}
                  onDrop={(event) => handlePaneDrop(pane, event)}
                  onDragEnd={handlePaneDragEnd}
                  aria-pressed={pane === 'tools' ? toolsDocked || toolsFloating : paneOn}
                  aria-keyshortcuts={paneReorderAvailable ? 'Alt+Shift+ArrowLeft Alt+Shift+ArrowRight' : undefined}
                  aria-label={pane === 'tools'
                    ? `Tools ${toolsFloating ? 'floating' : toolsDocked ? 'expanded' : 'rail'}${paneReorderAvailable ? '; drag or use Alt+Shift+Left/Right Arrow to reorder' : ''}`
                    : `${PANE_LABELS[pane]} pane ${paneOn ? paneFloating ? 'floating' : 'on' : 'off'}${paneHideBlocked ? `; ${paneHideBlockReason.toLowerCase()}` : paneReorderAvailable ? '; drag or use Alt+Shift+Left/Right Arrow to reorder' : ''}`}
                  title={pane === 'tools'
                    ? `${toolsFloating || toolsDocked ? 'Minimize tools to the right rail' : 'Expand tools panel'}${paneReorderAvailable ? '; drag to reorder' : ''}`
                    : paneHideBlocked
                      ? paneHideBlockReason
                      : `${paneOn ? 'Hide' : 'Show'} ${PANE_LABELS[pane]} pane${paneReorderAvailable ? '; drag to reorder' : ''}`}
                >
                  <PaneIcon className="motif-cs-nav-icon" aria-hidden="true" />
                  <span>{PANE_LABELS[pane]}</span>
                  {paneFloating ? <small className="motif-cs-pane-state">Float</small> : null}
                </button>
              );
            })}
          </div>
          <button
            ref={translationsToggleRef}
            className="motif-cs-pane-toggle motif-cs-window-toggle"
            type="button"
            data-active={showTranslations || undefined}
            onClick={toggleTranslationsWindow}
            disabled={!isEditable}
            aria-pressed={showTranslations}
            aria-label={isEditable ? `Translations window ${showTranslations ? 'on' : 'off'}` : hasActiveRecord ? 'Translations unavailable for protein records' : 'Translations unavailable; no active record'}
            title={isEditable ? 'Toggle the floating Translations window' : hasActiveRecord ? 'Translations are available for DNA and RNA records' : 'Add a DNA or RNA record to enable translations'}
          >
            <Languages className="motif-cs-nav-icon" aria-hidden="true" />
            <span>Translate</span>
          </button>
          <label className="motif-cs-theme-picker">
            <span className="motif-cs-visually-hidden">Theme</span>
            <select name="artifact-theme" value={theme} onChange={(event) => setTheme(event.target.value as ArtifactThemeName)}>
              {THEME_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <nav
        ref={recordTabsRef}
        className="motif-cs-record-tabs"
        role={payload.records.length > 0 ? 'tablist' : undefined}
        aria-label={payload.records.length > 0 ? 'Open sequence records' : 'Open sequence records; none open'}
        data-inventory-visible={paneVisibility.inventory || undefined}
      >
        {payload.records.map((record, index) => {
          const active = record.id === recordId;
          return (
            <button
              key={record.id}
              id={`motif-cs-record-tab-${index}`}
              className="motif-cs-record-tab"
              type="button"
              role="tab"
              aria-controls="motif-cs-workspace"
              aria-selected={active}
              aria-label={record.name}
              tabIndex={active ? 0 : -1}
              data-active={active || undefined}
              onClick={() => selectRecord(record.id)}
              onKeyDown={(event) => handleRecordTabKeyDown(event, index)}
            >
              <span className="motif-cs-record-tab-name" translate="no">{record.name}</span>
            </button>
          );
        })}
      </nav>

      <main
        ref={workspaceMainRef}
        id="motif-cs-workspace"
        className="motif-cs-main"
        role={payload.records.length > 0 ? 'tabpanel' : 'region'}
        aria-labelledby={payload.records.length > 0 ? `motif-cs-record-tab-${activeRecordTabIndex}` : undefined}
        aria-label={payload.records.length === 0 ? 'Sequence workspace; no records open' : undefined}
        tabIndex={-1}
        data-visible-pane-count={dockedPaneCount}
        data-content-pane-count={dockedContentPaneCount}
        data-inventory-hidden={!paneVisibility.inventory || panePlacements.inventory === 'floating' || undefined}
        data-map-hidden={!paneVisibility.map || panePlacements.map === 'floating' || undefined}
        data-sequence-hidden={!paneVisibility.sequence || panePlacements.sequence === 'floating' || undefined}
        data-tools-pinned={toolsDocked || undefined}
        style={{
          '--motif-cs-inventory-pane-width': `${paneWidths.inventory}px`,
          '--motif-cs-sequence-pane-width': `${paneWidths.sequence}px`,
          '--motif-cs-map-pane-width': `${paneWidths.map}px`,
          '--motif-cs-tools-pane-width': `${paneWidths.tools}px`,
          '--motif-cs-compact-top-row-height': workspaceRowResizeActive || effectiveStackedSequenceHeight !== null
            ? `${renderedStackedSequenceHeight}px`
            : undefined,
          '--motif-cs-compact-top-row-min': workspaceRowResizeActive ? `${compactRowMinHeight}px` : undefined,
          '--motif-cs-compact-top-row-max': workspaceRowResizeActive ? `${compactTopRowMaxHeight}px` : undefined,
          '--motif-cs-compact-bottom-row-min': workspaceRowResizeActive ? `${compactBottomRowMinHeight}px` : undefined,
        } as CSSProperties}
      >
        {paneVisibility.inventory ? (
          <>
            <aside
              key="inventory-pane"
              ref={inventoryColumnRef}
              className="motif-cs-sidebar motif-cs-pane"
              data-pane-key="inventory"
              data-pane-placement={panePlacements.inventory}
              data-stacked-resized={effectiveStackedInventoryHeight !== null || undefined}
              role={panePlacements.inventory === 'floating' ? 'dialog' : undefined}
              aria-label={panePlacements.inventory === 'floating' ? 'Inventory pane' : undefined}
              tabIndex={panePlacements.inventory === 'floating' ? -1 : undefined}
              onPointerDown={() => panePlacements.inventory === 'floating' && bringFloatingPaneToFront('inventory')}
              onFocusCapture={() => panePlacements.inventory === 'floating' && bringFloatingPaneToFront('inventory')}
              style={{
                '--motif-cs-inventory-pane-width': `${paneWidths.inventory}px`,
                '--motif-cs-stacked-inventory-pane-height': effectiveStackedInventoryHeight === null ? undefined : `${effectiveStackedInventoryHeight}px`,
                flexBasis: paneWidths.inventory,
                order: paneCssOrder('inventory'),
                ...floatingPaneStyle('inventory'),
              } as CSSProperties}
            >
              <div
                className="motif-cs-pane-title"
                tabIndex={panePlacements.inventory === 'floating' ? 0 : undefined}
                role={panePlacements.inventory === 'floating' ? 'group' : undefined}
                aria-label={panePlacements.inventory === 'floating' ? 'Move Inventory pane; use Alt plus arrow keys' : undefined}
                onPointerDown={(event) => beginFloatingPaneInteraction('inventory', 'move', event)}
                onKeyDown={(event) => moveFloatingPaneFromKeyboard('inventory', event)}
              >
                <div>
                  <span>Inventory</span>
                </div>
                <button
                  className="motif-cs-mini-button motif-cs-add-entry-button"
                  type="button"
                  aria-label="Add entry"
                  aria-controls="motif-cs-add-entry"
                  aria-expanded={importPanelOpen}
                  title="Add or drop a sequence entry"
                  onClick={() => setImportPanelOpen((open) => !open)}
                >
                  <Plus size={15} strokeWidth={2.3} aria-hidden="true" />
                </button>
                <PanePlacementControl
                  pane="inventory"
                  title="Inventory"
                  floating={panePlacements.inventory === 'floating'}
                  disabled={dockedContentPaneCount <= 1}
                  onPopOut={popOutPane}
                  onDock={dockPane}
                />
                <button
                  className="motif-cs-pane-collapse"
                  type="button"
                  disabled={!canHideContentPane('inventory')}
                  onClick={() => collapsePaneAndRestoreFocus('inventory')}
                  aria-label={canHideContentPane('inventory') ? 'Collapse inventory pane' : `Inventory pane cannot be collapsed; ${contentPaneHideBlockReason('inventory').toLowerCase()}`}
                  title={canHideContentPane('inventory') ? 'Collapse inventory pane' : contentPaneHideBlockReason('inventory')}
                >
                  {paneCollapsePointsRight('inventory') ? (
                    <ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" />
                  ) : (
                    <ChevronLeft size={14} strokeWidth={2.2} aria-hidden="true" />
                  )}
                </button>
              </div>
              <ImportSequencePanel
                defaults={importDefaults}
                open={importPanelOpen}
                confirmedRestoreCount={confirmedDatabaseRestoreCount}
                onDefaultsChange={setImportDefaults}
                onOpenChange={setImportPanelOpen}
                onAddRecords={addRecords}
                onImportFiles={importFiles}
                onRestoreDatabase={(database) => requestArtifactDatabaseRestore(database)}
              />
              <InventoryList records={payload.records} selectedRecordId={recordId} onSelect={selectRecord} />
              {panePlacements.inventory === 'floating' ? (
                <FloatingPaneResizeHandle pane="inventory" title="Inventory" onPointerDown={beginFloatingPaneInteraction} onKeyDown={resizeFloatingPaneFromKeyboard} />
              ) : null}
            </aside>
            {panePlacements.inventory === 'docked' ? <PaneResizeHandle pane="inventory" label="Resize inventory pane" width={paneWidths.inventory} limits={paneWidthLimitsForCurrentLayout('inventory')} edge="after" onPointerDown={startPaneResize} onKeyDown={resizePaneFromKeyboard} style={{ order: paneCssOrder('inventory', 'after') }} /> : null}
            {panePlacements.inventory === 'docked' ? <StackedPaneResizeHandle
              pane="inventory"
              label="Inventory"
              height={effectiveStackedInventoryHeight ?? 160}
              min={stackedInventoryBounds.min}
              max={stackedInventoryBounds.max}
              onPointerDown={startStackedPaneResize}
              onKeyDown={resizeStackedPaneFromKeyboard}
              onReset={(pane) => setStackedPaneHeights((current) => ({ ...current, [pane]: null }))}
              style={{ order: paneCssOrder('inventory', 'after') }}
            /> : null}
          </>
        ) : null}

        {paneVisibility.map ? (
          <>
            <section
              key="map-pane"
              ref={mapColumnRef}
              className="motif-cs-map-column motif-cs-pane"
              data-pane-key="map"
              data-pane-placement={panePlacements.map}
              role={panePlacements.map === 'floating' ? 'dialog' : undefined}
              aria-label={panePlacements.map === 'floating' ? 'Map pane' : undefined}
              tabIndex={panePlacements.map === 'floating' ? -1 : undefined}
              onPointerDown={() => panePlacements.map === 'floating' && bringFloatingPaneToFront('map')}
              onFocusCapture={() => panePlacements.map === 'floating' && bringFloatingPaneToFront('map')}
              style={{
                '--motif-cs-map-pane-width': `${paneWidths.map}px`,
                flexBasis: paneWidths.map,
                order: paneCssOrder('map'),
                ...floatingPaneStyle('map'),
              } as CSSProperties}
            >
              <div
                className="motif-cs-pane-title"
                tabIndex={panePlacements.map === 'floating' ? 0 : undefined}
                role={panePlacements.map === 'floating' ? 'group' : undefined}
                aria-label={panePlacements.map === 'floating' ? 'Move Map pane; use Alt plus arrow keys' : undefined}
                onPointerDown={(event) => beginFloatingPaneInteraction('map', 'move', event)}
                onKeyDown={(event) => moveFloatingPaneFromKeyboard('map', event)}
              >
                <div>
                  <span>{hasActiveRecord ? mapPaneTitle : 'Map'}</span>
                  <small>{hasActiveRecord ? `${topology} · ${sequenceLengthLabel(sequence.length, sequenceType)}` : 'No active record'}</small>
                </div>
                <PanePlacementControl
                  pane="map"
                  title="Map"
                  floating={panePlacements.map === 'floating'}
                  disabled={dockedContentPaneCount <= 1}
                  onPopOut={popOutPane}
                  onDock={dockPane}
                />
                <button
                  className="motif-cs-pane-collapse"
                  type="button"
                  disabled={!canHideContentPane('map')}
                  onClick={() => collapsePaneAndRestoreFocus('map')}
                  aria-label={canHideContentPane('map') ? 'Collapse map pane' : `Map pane cannot be collapsed; ${contentPaneHideBlockReason('map').toLowerCase()}`}
                  title={canHideContentPane('map') ? 'Collapse map pane' : contentPaneHideBlockReason('map')}
                >
                  {paneCollapsePointsRight('map') ? (
                    <ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" />
                  ) : (
                    <ChevronLeft size={14} strokeWidth={2.2} aria-hidden="true" />
                  )}
                </button>
              </div>
              <div
                ref={mapFrameRef}
                className="motif-cs-map-frame"
                data-map-mode={layout.mode}
                data-map-pointer-action={mapPointerAction}
                data-theme={mapTheme}
                data-empty={!hasActiveRecord || undefined}
                title="Wheel or blank-canvas drag to pan; Shift-wheel pans horizontally; Ctrl/Command-wheel zooms; drag near the sequence to select a range"
              >
                <div
                  className="motif-pm-container"
                  data-map-mode={layout.mode}
                  data-theme={mapTheme}
                  data-map-interaction-surface
                  onPointerDown={handleMapSurfacePointerDown}
                  onPointerMove={handleMapSurfacePointerMove}
                  onPointerUp={handleMapSurfacePointerEnd}
                  onPointerCancel={handleMapSurfacePointerEnd}
                >
                  <SequenceMapView
                    layout={layout}
                    theme={mapTheme}
                    interactive
                    selectedFeatureId={selectedFeatureId}
                    activeClusterId={activeClusterId}
                    selectionPaths={selectionPaths}
                    viewport={mapViewport}
                    onFeatureClick={handleMapFeatureClick}
                    onRestrictionClick={handleRestrictionClick}
                    onBackgroundClick={handleMapBackgroundClick}
                    onWheelZoom={handleMapWheel}
                  />
                </div>
                {!hasActiveRecord ? (
                  <div className="motif-cs-empty-map-state">
                    <strong>No map to display</strong>
                    <span>Add a DNA, RNA, or protein record to render its overview.</span>
                  </div>
                ) : null}
                {hasActiveRecord ? (
                <div className="motif-cs-map-toolbar" role="group" aria-label="Map view controls">
                  <button className="motif-cs-map-button" type="button" onClick={handleZoomOut} disabled={!hasActiveRecord || mapViewport.k <= MIN_ZOOM + 0.0001} aria-label="Zoom out">-</button>
                  <button
                    className="motif-cs-map-button motif-cs-map-reset"
                    type="button"
                    onClick={handleZoomReset}
                    disabled={!hasActiveRecord || (mapViewport.k <= MIN_ZOOM + 0.0001 && Math.abs(mapViewport.tx) < 0.5 && Math.abs(mapViewport.ty) < 0.5)}
                    aria-label="Reset map view"
                    title="Reset map view"
                  >
                    Fit
                  </button>
                  <button className="motif-cs-map-button" type="button" onClick={handleZoomIn} disabled={!hasActiveRecord || mapViewport.k >= MAX_ZOOM - 0.0001} aria-label="Zoom in">+</button>
                  {/* Whether the ring is named is a property of the map, but the
                      only switch for it was in the Map Visibility panel, and at
                      every laptop size measured — 1440x900, 1280x800, 1024x768,
                      900x700 — that panel's own SUMMARY is already past the
                      bottom of the map column, which hides 143-148px of itself.
                      Reaching the toggle meant scrolling a pane nothing invites
                      you to scroll and then opening a closed accordion, for a
                      state you are looking straight at. Same handler and same
                      wording as the panel button, so the two always agree; this
                      is a second route to one control, not a second control.
                      Gated on isDnaRecord exactly as the panel's is, since
                      restriction labels are the only thing it governs. */}
                  {isDnaRecord ? (
                    <button
                      className="motif-cs-map-button motif-cs-map-labels-toggle"
                      type="button"
                      data-active={showRestrictionLabels || undefined}
                      aria-pressed={showRestrictionLabels}
                      onClick={toggleRestrictionLabels}
                      aria-label={`${showRestrictionLabels ? 'Hide' : 'Show'} restriction-site labels`}
                      title={`${showRestrictionLabels ? 'Hide' : 'Show'} restriction-site labels`}
                    >
                      Sites
                    </button>
                  ) : null}
                </div>
                ) : null}
                {mapStatusHint ? (
                  <div className="motif-cs-map-hint">{mapStatusHint}</div>
                ) : null}
              </div>

              <div className="motif-cs-map-dock-strip">
                <details className="motif-cs-panel motif-cs-map-visibility-panel" name="motif-cs-map-dock">
                  <summary className="motif-cs-panel-head" onClick={handleMapDockOpen}>
                    <span>
                      <span className="motif-cs-full-label">Map Visibility</span>
                      <span className="motif-cs-compact-label">Map</span>
                    </span>
                    <span className="motif-cs-panel-meta">
                      <span className="motif-cs-full-label">{restrictionVisibilityMeta.full}</span>
                      <span className="motif-cs-compact-label">{restrictionVisibilityMeta.compact}</span>
                    </span>
                  </summary>
                  {isNucleotideRecord ? (
                    <>
                      <div className="motif-cs-layer-actions">
                        {/* This used to read "◯ Circular | — Linear" and CONVERT the
                            molecule: it wrote topology into the record, cleared the
                            selection, caret and map range, and changed which
                            restriction sites are FOUND — on pUC19, 325 against 324,
                            the one lost being BtgZI at 2576, which straddles the
                            origin — all from a panel called Map Visibility among
                            controls that change only the picture. It now picks a
                            DRAWING. The record is untouched, so nothing is cleared,
                            and the signals that say what the molecule is stay put as
                            the confirmation: the pane subtitle still reads "circular
                            · 2,578 bp" and the inventory line still says circular.
                            Converting lives in Entry Details with the other fields
                            that describe the molecule. */}
                        <span className="motif-cs-muted">Draw as</span>
                        <div className="motif-cs-segmented motif-cs-shape-toggle" role="group" aria-label="Map drawing">
                          <button
                            type="button"
                            data-active={mapRenderMode === 'circular' || undefined}
                            aria-pressed={mapRenderMode === 'circular'}
                            disabled={!canDrawAsRing}
                            title={canDrawAsRing
                              ? 'Draw this map as a ring'
                              : 'A linear molecule has two ends; convert it in Entry Details to draw it as a ring'}
                            onClick={() => setMapRenderMode('circular')}
                          >
                            ◯ Circular
                          </button>
                          <button
                            type="button"
                            data-active={mapRenderMode === 'linear' || undefined}
                            aria-pressed={mapRenderMode === 'linear'}
                            disabled={!hasActiveRecord}
                            title="Draw this map as a line. The record stays as it is."
                            onClick={() => setMapRenderMode('linear')}
                          >
                            — Linear
                          </button>
                        </div>
                        {mapRenderMode !== mapModeForBlock(topology, sequenceType) ? (
                          <span className="motif-cs-muted">Drawing only — still a {topology} {sequenceType.toUpperCase()}</span>
                        ) : null}
                        {isDnaRecord ? (
                          <>
                            <button
                              type="button"
                              className="motif-cs-mini-button"
                              onClick={() => setAllEnzymesVisible(true)}
                              disabled={scanEnzymes.length === 0 && (lastVisibleEnzymeSourcesRef.current[recordId]?.length ?? 0) === 0}
                              title={scanEnzymes.length === 0
                                ? (lastVisibleEnzymeSourcesRef.current[recordId]?.length ?? 0) > 0
                                  ? 'Restore the source groups hidden with Hide sites'
                                  : 'Enable a source group first'
                                : 'Show all sites in the enabled source groups'}
                            >
                              Show sites
                            </button>
                            <button type="button" className="motif-cs-mini-button" onClick={() => setAllEnzymesVisible(false)} title="Turn off source groups and hide restriction sites">Hide sites</button>
                            <button
                              type="button"
                              className="motif-cs-mini-button"
                              data-active={showRestrictionLabels || undefined}
                              aria-pressed={showRestrictionLabels}
                              onClick={toggleRestrictionLabels}
                              aria-label={`${showRestrictionLabels ? 'Hide' : 'Show'} restriction-site labels`}
                              title={`${showRestrictionLabels ? 'Hide' : 'Show'} restriction-site labels`}
                            >
                              Site labels
                            </button>
                            <span className="motif-cs-muted">{singleCutters.length} single-cutters</span>
                            {/* The map's "+N more sites" chip carries this same number, but only
                                to a pointer: it lives in an SVG <title>, which no browser opens
                                on keyboard focus. Stated here it lands where a keyboard user is
                                already going. Read off layout.overflows — the ARRAY THE CHIP
                                RENDERS FROM — so the two cannot drift into disagreeing about the
                                same quantity; a second derivation would be a second chance to be
                                wrong. Worded as a caveat rather than a count, because sitting
                                next to "39 single-cutters" a bare number reads as one more
                                statistic instead of "the map is not showing you everything". */}
                            {mapUnlabelledSiteCount > 0 ? (
                              <span className="motif-cs-muted">{mapUnlabelledSiteCount.toLocaleString()} sites without labels on the map</span>
                            ) : null}

                          </>
                        ) : (
                          <span className="motif-cs-muted">Restriction enzymes act on DNA; RNA is not converted implicitly.</span>
                        )}
                      </div>
                      {isDnaRecord ? (
                        <>
                          <RestrictionSourceControls
                            sources={enzymeSources}
                            enzymeCount={scanEnzymes.length}
                            onToggle={setEnzymeSourceEnabled}
                          />
                          <RestrictionList
                            sites={restrictionSites}
                            enzymes={scanEnzymes}
                            sequenceLength={sequence.length}
                            topology={topology}
                            layout={layout.restrictions}
                            hiddenEnzymes={hiddenEnzymes}
                            selectedClusterId={activeClusterId}
                            selectedTickIds={selectedRestrictionTickIds}
                            onSelect={handleRestrictionClick}
                            onToggle={setEnzymeVisible}
                          />
                          <AddEnzymeForm onAdd={addCustomEnzyme} knownEnzymes={RESTRICTION_ENZYMES_FULL} />
                        </>
                      ) : null}
                    </>
                  ) : (
                    <p className="motif-cs-muted">Map shape and restriction controls are available for nucleotide records.</p>
                  )}
                </details>

                <DigestPanel
                  record={vector}
                  sequenceType={hasActiveRecord ? sequenceType : 'protein'}
                  topology={topology}
                  enzymeCatalog={digestEnzymeCatalog}
                  visibleMapEnzymes={visibleMapEnzymes}
                  workflowResults={payload.workflowResults}
                  inputSha256={sequenceType === 'dna' ? activeRecordSha256 : undefined}
                  onOpen={handleMapDockOpen}
                  onCopy={copyText}
                  onSave={saveDigestWorkflow}
                  onOpenGel={openGelForWorkflow}
                  onSelectRange={selectSequenceRangeAndReveal}
                />
              </div>
              {panePlacements.map === 'floating' ? (
                <FloatingPaneResizeHandle pane="map" title="Map" onPointerDown={beginFloatingPaneInteraction} onKeyDown={resizeFloatingPaneFromKeyboard} />
              ) : null}
            </section>
            {showSequenceMapResizeHandle ? (
              <PaneResizeHandle
                pane="sequence"
                label="Resize sequence and map panes"
                width={paneWidths.sequence}
                edge={sequenceBeforeMap ? 'after' : 'before'}
                onPointerDown={startPaneResize}
                onKeyDown={resizePaneFromKeyboard}
                style={{ order: sequenceBeforeMap ? paneCssOrder('sequence', 'after') : paneCssOrder('sequence', 'before') }}
              />
            ) : null}
          </>
        ) : null}

        {paneVisibility.sequence ? (
          <>
            <section
              key="sequence-pane"
              ref={sequenceColumnRef}
              className="motif-cs-sequence-column motif-cs-pane motif-cs-primary-pane"
              data-pane-key="sequence"
              data-pane-placement={panePlacements.sequence}
              data-stacked-resized={effectiveStackedSequenceHeight !== null || undefined}
              role={panePlacements.sequence === 'floating' ? 'dialog' : undefined}
              aria-label={panePlacements.sequence === 'floating' ? 'Sequence pane' : undefined}
              tabIndex={panePlacements.sequence === 'floating' ? -1 : undefined}
              onPointerDown={() => panePlacements.sequence === 'floating' && bringFloatingPaneToFront('sequence')}
              onFocusCapture={() => panePlacements.sequence === 'floating' && bringFloatingPaneToFront('sequence')}
              style={{
                '--motif-cs-sequence-pane-width': `${paneWidths.sequence}px`,
                '--motif-cs-stacked-sequence-pane-height': effectiveStackedSequenceHeight === null ? undefined : `${effectiveStackedSequenceHeight}px`,
                flexBasis: paneWidths.sequence,
                order: paneCssOrder('sequence'),
                ...floatingPaneStyle('sequence'),
              } as CSSProperties}
            >
            <div
              className="motif-cs-title-row motif-cs-sequence-title"
              tabIndex={panePlacements.sequence === 'floating' ? 0 : undefined}
              role={panePlacements.sequence === 'floating' ? 'group' : undefined}
              aria-label={panePlacements.sequence === 'floating' ? 'Move Sequence pane; use Alt plus arrow keys' : undefined}
              onPointerDown={(event) => beginFloatingPaneInteraction('sequence', 'move', event)}
              onKeyDown={(event) => moveFloatingPaneFromKeyboard('sequence', event)}
            >
              <div>
                {hasActiveRecord ? <EditableRecordTitle record={vector} onUpdate={updateRecordDetails} /> : <h1>No sequence loaded</h1>}
                <p title={vector.description ?? payload.inventory.description}>{vector.description ?? payload.inventory.description}</p>
              </div>
              {/* Same shape as the topbar pair above and found with them: a type
                  chip and a length chip rendered here every time and hidden by
                  `.motif-cs-sequence-title .motif-cs-title-actions .motif-cs-chip`
                  in the base block. Four dead chips in total, not the two filed.
                  Both facts survive in the inventory row's "dna · circular ·
                  2,578 bp" and the map header's "circular · 2,578 bp". */}
              <div className="motif-cs-title-actions">
                <PanePlacementControl
                  pane="sequence"
                  title="Sequence"
                  floating={panePlacements.sequence === 'floating'}
                  disabled={dockedContentPaneCount <= 1}
                  onPopOut={popOutPane}
                  onDock={dockPane}
                />
                <button
                  className="motif-cs-pane-collapse"
                  type="button"
                  disabled={!canHideContentPane('sequence')}
                  onClick={() => collapsePaneAndRestoreFocus('sequence')}
                  aria-label={canHideContentPane('sequence') ? 'Collapse sequence pane' : `Sequence pane cannot be collapsed; ${contentPaneHideBlockReason('sequence').toLowerCase()}`}
                  title={canHideContentPane('sequence') ? 'Collapse sequence pane' : contentPaneHideBlockReason('sequence')}
                >
                  {paneCollapsePointsRight('sequence') ? (
                    <ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" />
                  ) : (
                    <ChevronLeft size={14} strokeWidth={2.2} aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <section className="motif-cs-panel motif-cs-sequence-panel">
              <div className="motif-cs-panel-head">
                <span>Sequence</span>
                <span className="motif-cs-panel-meta">
                  {!hasActiveRecord ? 'empty' : selectedFeature ? featureRangeLabel(selectedFeature) : selectedMapRange ? mapRangeLabel(selectedMapRange, sequence.length) : sequenceType === 'protein' ? 'amino acid' : '5′ → 3′'}
                </span>
              </div>
              {hasActiveRecord ? (
              <>
              <div className="motif-cs-edit-toolbar" role="group" aria-label={isSequenceEditable ? 'Sequence editing' : 'Sequence display'}>
                <div className="motif-cs-edit-controls">
                  {isSequenceEditable ? (
                  <>
                    {canUndo ? (
                      <button className="motif-cs-mini-button motif-cs-icon-mini" type="button" onClick={undoEdit} title="Undo (Cmd/Ctrl+Z)" aria-label="Undo">
                        <Undo2 size={14} strokeWidth={2.2} aria-hidden="true" />
                      </button>
                    ) : null}
                    {canRedo ? (
                      <button className="motif-cs-mini-button motif-cs-icon-mini" type="button" onClick={redoEdit} title="Redo (Cmd/Ctrl+Shift+Z)" aria-label="Redo">
                        <Redo2 size={14} strokeWidth={2.2} aria-hidden="true" />
                      </button>
                    ) : null}
                    <div className="motif-cs-segmented motif-cs-edit-mode-toggle" role="group" aria-label="Typing mode">
                      <button
                        type="button"
                        data-active={!insertMode || undefined}
                        aria-pressed={!insertMode}
                        onClick={() => setInsertMode(false)}
                        title="Replace the base at the caret when typing"
                        aria-label="Replace typing mode"
                      >
                        <span className="motif-cs-label-full">Replace</span>
                        <span className="motif-cs-label-short">Repl</span>
                      </button>
                      <button
                        type="button"
                        data-active={insertMode || undefined}
                        aria-pressed={insertMode}
                        onClick={() => setInsertMode(true)}
                        title="Insert typed bases at the caret"
                        aria-label="Insert typing mode"
                      >
                        <span className="motif-cs-label-full">Insert</span>
                        <span className="motif-cs-label-short">Ins</span>
                      </button>
                    </div>
                    {caret !== null ? (
                      <span className="motif-cs-edit-hint">Caret {caret + 1}{canUndo ? ' · edited' : ''}</span>
                    ) : null}
                  </>
                ) : null}
                </div>
                <div className="motif-cs-display-toggles">
                  <div className="motif-cs-segmented motif-cs-view-toggle" role="group" aria-label="Sequence view">
                    <button
                      type="button"
                      data-active={effectiveSequenceViewMode === 'standard' || undefined}
                      aria-pressed={effectiveSequenceViewMode === 'standard'}
                      aria-label="Standard sequence view"
                      onClick={() => setSequenceViewMode('standard')}
                    >
                      <span className="motif-cs-label-full">Standard</span>
                      <span className="motif-cs-label-short">Std</span>
                    </button>
                    <button
                      type="button"
                      data-active={effectiveSequenceViewMode === 'detail' || undefined}
                      aria-pressed={effectiveSequenceViewMode === 'detail'}
                      aria-label="Detail sequence view"
                      disabled={usesLargeSequenceViewer}
                      onClick={() => setSequenceViewMode('detail')}
                      title={usesLargeSequenceViewer ? `Detail view is available for records up to ${LARGE_SEQUENCE_DETAIL_THRESHOLD.toLocaleString()} residues` : undefined}
                    >
                      Detail
                    </button>
                  </div>
                  {isNucleotideRecord ? (
                    <button
                      className="motif-cs-mini-button motif-cs-display-switch motif-cs-ds-toggle"
                      type="button"
                      data-active={showComplement || undefined}
                      aria-pressed={showComplement}
                      aria-label="Complement strand"
                      disabled={usesLargeSequenceViewer}
                      onClick={() => setShowComplement((value) => !value)}
                      title={usesLargeSequenceViewer ? 'Complement display is unavailable in the large-record density view' : 'Show the complementary strand under each line (double-stranded view)'}
                    >
                      <span className="motif-cs-label-full">Complement</span>
                      <span className="motif-cs-label-short">Comp</span>
                      <span className="motif-cs-switch-track" aria-hidden="true"><span /></span>
                    </button>
                  ) : null}
                </div>
              </div>
              {/* Always mounted so range-selection actions have a stable dock;
                  the empty state is visually quiet to keep the sequence canvas dense. */}
              <div className="motif-cs-selection-bar" role="group" aria-label="Selection actions" data-empty={!(selectedFeature || selectedMapRange) || undefined}>
                <span className="motif-cs-selection-label" title={selectionSummary?.label ?? (selectedRestriction ? 'Restriction tick selected; drag a sequence range for sequence actions.' : undefined)}>
                  <span className="motif-cs-selection-name">{selectionBarLabel}</span>
                  {inspectorSelectionSeq ? (
                    <span className="motif-cs-chip">{inspectorSelectionSeq.length} {sequenceUnitLabel(sequenceType)}</span>
                  ) : null}
                </span>
                <div className="motif-cs-selection-actions">
                  <button className="motif-cs-mini-button" type="button" disabled={!inspectorSelectionSeq} onClick={() => copyText('Selection', inspectorSelectionSeq)} title="Copy the selected sequence">Copy</button>
                  <button
                    className="motif-cs-mini-button"
                    type="button"
                    disabled={!selectedInlineTranslationTrack && (!selectionActionTranslation || !canPinPreviewTranslation)}
                    onClick={() => {
                      if (selectedInlineTranslationTrack) deleteTranslationLayer(selectedInlineTranslationTrack.id);
                      else translateSelectionInline();
                    }}
                    title={selectedInlineTranslationTrack
                      ? 'Remove the selected amino-acid translation track'
                      : multipartTranslateFeature
                        ? 'Multipart translation is available in the Translation panel, but cannot be pinned as one contiguous track'
                        : 'Add this selection as an inline amino-acid translation track'}
                  >
                    {selectedInlineTranslationTrack ? 'Del AA' : 'Add AA'}
                  </button>
                  <button
                    className="motif-cs-mini-button"
                    type="button"
                    disabled={!canAnnotateSelectedMapRange}
                    onClick={handleAnnotateRange}
                    title={selectedMapRange ? 'Annotate this range as a new feature' : 'Drag-select a range on the sequence to add a feature'}
                  >
                    + Feature
                  </button>
                  {/* Everything above acts on the record you are looking at;
                      everything below adds a NEW one to the inventory. The two
                      were spelled the same, so "Rev comp" read like the "Copy"
                      beside it and quietly took the session from 13 records to
                      14 with a new Derived group. Worse, with nothing selected
                      it is the ONLY enabled control in this bar, so the one
                      thing the resting state invites you to press was the
                      heaviest thing in it. Both record-makers now carry the
                      "New" the Export panel already uses to separate "Copy rev
                      comp" from "New rev comp", and the rule marks where the
                      weight changes. The behaviour is deliberately untouched:
                      additive and non-destructive is the right semantics. */}
                  <span className="motif-cs-selection-action-rule" aria-hidden="true" />
                  <button className="motif-cs-mini-button" type="button" disabled={!isNucleotideRecord || (!!selectionSummary && !hasMaterializableSequenceSelection)} onClick={addContextReverseComplementRecord} aria-label="New rev comp record" title={selectionSummary ? hasMaterializableSequenceSelection ? 'Create a reverse-complement record from this selection' : 'This ordered location cannot be materialized as one sequence' : 'Create a reverse-complement record from the whole sequence'}>
                    <span className="motif-cs-label-full">New rev comp</span>
                    {/* Below a 360px pane the bar is already a scroller, and
                        spelling "New" twice more pushed it 6px past its own
                        clip. "+" is the same promise in one character and the
                        "+ Feature" two buttons left already teaches it here. */}
                    <span className="motif-cs-label-short">+ RC</span>
                  </button>
                  <button className="motif-cs-mini-button" type="button" disabled={!selectionActionTranslation} onClick={addSelectionTranslationRecord} aria-label="New protein record" title="Create a new protein record from this selection's translation">
                    <span className="motif-cs-label-full">New protein</span>
                    <span className="motif-cs-label-short">+ Prot</span>
                  </button>
                </div>
              </div>
              </>
              ) : (
                <div className="motif-cs-empty-sequence-state">
                  <strong>No records yet</strong>
                  <span>Use Add Entry or drop a FASTA, GenBank, AB1/ABI, raw sequence, or Database JSON file.</span>
                  <button className="motif-cs-mini-button" type="button" onClick={() => setImportPanelOpen(true)}>Add entry</button>
                </div>
              )}
              {!hasActiveRecord ? null : usesLargeSequenceViewer ? (
                <LargeSequenceViewer
                  sequence={sequence}
                  threshold={LARGE_SEQUENCE_DETAIL_THRESHOLD}
                  selectedRange={selectedFeatureSpans[0] ?? visibleMapRanges[0] ?? null}
                  focusRequest={sequenceFocusRequest}
                />
              ) : (
                <SequenceText
                sequence={sequence}
                sequenceType={sequenceType}
                topology={topology}
                features={features}
                selectedFeature={selectedFeature}
                selectedMapRange={selectedMapRange}
                focusRequest={sequenceFocusRequest}
                motifHits={motifHits}
                motifLength={cleanedMotifLength}
                restrictionSites={visibleRestrictionSites}
                restrictionEnzymes={scanEnzymes}
                selectedRestrictionTickIds={selectedRestrictionTickIds}
                translationTracks={effectiveSequenceViewMode === 'detail' ? inlineTranslationTracks : emptyTracks}
                showComplement={showComplement && isNucleotideType(sequenceType)}
                detailMode={effectiveSequenceViewMode === 'detail'}
                caret={caret}
                editable={isSequenceEditable}
                onFeatureSelect={handleFeatureClick}
                onRestrictionSelect={handleSequenceRestrictionClick}
                onTranslationTrackSelect={handleTranslationTrackSelectAndReveal}
                onTranslationCodonSelect={selectTranslationCodonAndReveal}
                onRangeSelect={selectSequenceRange}
                onPlaceCaret={handlePlaceCaret}
                onEditKeyDown={handleSequenceEditKey}
                onPaste={handleSequencePaste}
                />
              )}
            </section>

            <SequenceToolsPanel
              records={payload.records}
              record={vector}
              schema={payload.schema}
              inventory={payload.inventory}
              selectedRecordId={selectedRecordId}
              defaultMotif={payload.defaultMotif}
              alignments={payload.alignments}
              notes={payload.notes}
              workflowResults={payload.workflowResults}
              analysisResults={payload.analysisResults}
              analysisAssets={payload.analysisAssets}
              artifactState={artifactState}
              sequenceType={sequenceType}
              topology={topology}
              enzymeSourcesByRecord={enzymeSourcesByRecord}
              customEnzymes={customEnzymes}
              selectedFeature={selectedFeature}
              selectedMapRange={selectedMapRange}
              copyStatus={copyStatus}
              hasUnsavedChanges={hasUnsavedChanges}
              hasSessionCheckpoint={hasSessionCheckpoint}
              onCopy={copyText}
              onCopySummary={handleCopySummary}
              onAddReverseComplement={addContextReverseComplementRecord}
              onAnnotateRange={handleAnnotateRange}
              canAnnotateRange={canAnnotateSelectedMapRange}
            />
            {panePlacements.sequence === 'floating' ? (
              <FloatingPaneResizeHandle pane="sequence" title="Sequence" onPointerDown={beginFloatingPaneInteraction} onKeyDown={resizeFloatingPaneFromKeyboard} />
            ) : null}
            </section>
            {panePlacements.sequence === 'docked' ? <StackedPaneResizeHandle
              pane="sequence"
              label="Sequence"
              height={renderedStackedSequenceHeight}
              min={stackedSequenceBounds.min}
              max={stackedSequenceBounds.max}
              onPointerDown={startStackedPaneResize}
              onKeyDown={resizeStackedPaneFromKeyboard}
              onReset={(pane) => setStackedPaneHeights((current) => ({ ...current, [pane]: null }))}
              style={{ order: paneCssOrder('sequence', 'after') }}
            /> : null}
          </>
        ) : null}

        {paneVisibility.tools ? (
          <>
            {showToolsResizeHandle ? <PaneResizeHandle pane="tools" label="Resize tools pane" width={paneWidths.tools} limits={paneWidthLimitsForCurrentLayout('tools')} edge="before" onPointerDown={startPaneResize} onKeyDown={resizePaneFromKeyboard} style={{ order: paneCssOrder('tools', 'before') }} /> : null}
            <aside
              key="tools-pane"
              ref={toolsInspectorRef}
              className="motif-cs-inspector motif-cs-pane"
              data-pane-key="tools"
              data-pane-placement={panePlacements.tools}
              data-tools-pinned={toolsDocked || toolsFloating ? 'true' : 'false'}
              role={toolsFloating ? 'dialog' : undefined}
              aria-label={toolsFloating ? 'Tools pane' : 'Tools'}
              // "Skip to tools" lands here, so the pane has to be a focus
              // target in every placement, not only while floating: an href
              // jump moves focus only if its target is focusable. -1 keeps it
              // out of the sequential order it exists to let you skip.
              id="motif-cs-tools-pane"
              tabIndex={-1}
              onPointerDown={() => toolsFloating && bringFloatingPaneToFront('tools')}
              onFocusCapture={() => toolsFloating && bringFloatingPaneToFront('tools')}
              style={{
                '--motif-cs-tools-pane-width': `${paneWidths.tools}px`,
                flexBasis: paneWidths.tools,
                order: paneCssOrder('tools'),
                ...floatingPaneStyle('tools'),
              } as CSSProperties}
            >
              <div
                className="motif-cs-pane-title"
                tabIndex={toolsFloating ? 0 : undefined}
                role={toolsFloating ? 'group' : undefined}
                aria-label={toolsFloating ? 'Move Tools pane; use Alt plus arrow keys' : undefined}
                onPointerDown={(event) => beginFloatingPaneInteraction('tools', 'move', event)}
                onKeyDown={(event) => moveFloatingPaneFromKeyboard('tools', event)}
              >
                <div>
                  <span>Tools</span>
                  <small>selection + analysis</small>
                </div>
                {toolsDocked || toolsFloating ? (
                  <PanePlacementControl
                    pane="tools"
                    title="Tools"
                    floating={toolsFloating}
                    onPopOut={popOutPane}
                    onDock={dockPane}
                  />
                ) : null}
                <button
                  className="motif-cs-pane-collapse"
                  type="button"
                  onClick={() => collapsePaneAndRestoreFocus('tools')}
                  aria-label={toolsDocked || toolsFloating ? 'Minimize tools panel to rail' : 'Expand tools panel'}
                  title={toolsDocked || toolsFloating ? 'Minimize tools panel to rail' : 'Expand tools panel'}
                >
                  {toolsDocked || toolsFloating ? (
                    <ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" />
                  ) : (
                    <ChevronLeft size={14} strokeWidth={2.2} aria-hidden="true" />
                  )}
                </button>
              </div>
          {hasActiveRecord ? (
          <>
          <EntryDetailsPanel
            record={vector}
            onUpdate={updateRecordDetails}
            onConvertTopology={convertRecordTopology}
            canConvertTopology={canToggleTopology}
            onDelete={deleteActiveRecord}
          />
          <FeatureList
            recordId={recordId}
            sequenceLength={sequence.length}
            features={features}
            selectedFeatureId={selectedFeatureId}
            translationTracks={inlineTranslationTracks}
            selectedTranslationLayerId={selectedTranslationLayerId}
            defaultOpen={toolsDocked || toolsFloating}
            editorRequest={featureEditorRequest}
            editorLabel={
              selectedTranslationLayer
                ? 'Edit translation'
                : selectedFeature && isNucleotideType(sequenceType) && CODING_FEATURE_TYPES.has(selectedFeature.type)
                  ? 'Edit feature translation'
                  : selectedFeature
                    ? 'Edit feature'
                    : selectedMapRange
                      ? 'Add feature from range'
                      : 'Add feature'
            }
            editorChip={selectedTranslationLayer ? 'translation' : selectedFeature ? 'selected' : selectedMapRange ? 'range' : 'new'}
            onSelect={handleFeatureClickAndReveal}
            onSelectTranslationTrack={handleTranslationTrackSelectAndReveal}
            onDeleteTranslationTrack={deleteTranslationLayer}
          >
            {selectedTranslationLayer ? (
              <TranslationLayerEditor
                sequenceLength={sequence.length}
                topology={topology}
                track={selectedTranslationLayer}
                onUpdate={updateTranslationLayer}
                onDelete={deleteTranslationLayer}
                onAddRecord={() => addTranslationTrackRecord(selectedTranslationLayer)}
              />
            ) : (
              <QuickFeatureEditor
                embedded
                sequenceLength={sequence.length}
                sequenceType={sequenceType}
                recordTranslationTableId={vector.translationTableId}
                topology={topology}
                featureCount={features.length}
                selectedFeature={selectedFeature}
                selectedMapRange={selectedMapRange}
                motifStart={motifHits[0]}
                motifLength={cleanedMotifLength}
                onAddFeature={addFeature}
                onUpdateFeature={updateFeature}
                onDeleteFeature={deleteFeature}
                onCreateRecord={addSelectedFeatureRecord}
                onCreateProteinRecord={
                  selectedFeature
                  && CODING_FEATURE_TYPES.has(selectedFeature.type)
                  && previewProtein
                    ? addSelectionTranslationRecord
                    : undefined
                }
              />
            )}
          </FeatureList>
          </>
          ) : (
            <div className="motif-cs-panel motif-cs-empty-tools-state">
              <strong>No active record</strong>
              <span>Add an entry to enable annotations and analysis.</span>
            </div>
          )}
          <details className="motif-cs-panel" name="motif-cs-tools" data-rail-tool="notes">
            <summary className="motif-cs-panel-head" data-rail-label="N" title="Notes">
              <NotebookPen className="motif-cs-panel-icon" size={14} strokeWidth={2.2} aria-hidden="true" />
              <span>Notes</span>
              <span className="motif-cs-chip">{payload.notes.length}</span>
            </summary>
            <div className="motif-cs-tool-panel-body motif-cs-notes-tool-body">
              <RailPopoverTitle title="Notes" meta={`${payload.notes.length} saved`} />
              <ClaudeScienceNotesPanel
                notes={payload.notes}
                activeRecordId={hasActiveRecord ? recordId : null}
                activeRecordName={hasActiveRecord ? vector.name : null}
                selectedRange={selectedMapRange && selectedMapRange.end <= sequence.length
                  ? { ...selectedMapRange }
                  : null}
                onAdd={addWorkspaceNote}
                onUpdate={updateWorkspaceNote}
                onConfirmAnchor={confirmWorkspaceNoteAnchor}
                onRemove={removeWorkspaceNote}
                onReveal={revealWorkspaceNote}
              />
            </div>
          </details>
          <details className="motif-cs-panel" name="motif-cs-tools" data-rail-tool="inspector">
            <summary className="motif-cs-panel-head" data-rail-label="I" title="Inspector">
              <Info className="motif-cs-panel-icon" size={14} strokeWidth={2.2} aria-hidden="true" />
              <span>Inspector</span>
              <span className="motif-cs-chip">live</span>
            </summary>
            <div className="motif-cs-inspector-body motif-cs-tool-panel-body">
              <RailPopoverTitle title="Inspector" meta="live" />
              {selectedFeature ? (
                <>
                  <strong>{selectedFeature.name}</strong>
                  <span>{selectedFeature.type} · {featureRangeLabel(selectedFeature)} · {featureStrandLabel(selectedFeature)}</span>
                  {isOrderedFeatureLocation(selectedFeature) ? (
                    <span>Ordered segments are not implicitly joined; export preserves the INSDC order(...) location.</span>
                  ) : null}
                  {isAmbiguousFeatureLocation(selectedFeature) ? (
                    <span>Segment order is ambiguous in this legacy reverse multipart location; Motif preserves the coordinates but blocks sequence-derived actions.</span>
                  ) : null}
                  {isEditable && inspectorSelectionSeq ? (
                    <div className="motif-cs-inspector-stats">
                      <span>{inspectorSelectionSeq.length} {sequenceUnitLabel(sequenceType)}</span>
                      {inspectorGc !== null ? <span>GC {formatPercent(inspectorGc)}</span> : null}
                      {inspectorTm != null ? <span>Tm {inspectorTm.toFixed(1)} C</span> : null}
                    </div>
                  ) : null}
                </>
              ) : selectedRestriction || selectedRestrictionSites.length > 0 ? (
                <>
                  <strong>{selection?.kind === 'restriction' && selection.enzyme ? selection.enzyme : selectedRestriction?.label?.text ?? selectedRestrictionSites[0]?.enzyme ?? 'Restriction site'}</strong>
                  <span>
                    {selectedRestrictionSites.length > 0
                      ? selectedRestrictionSites.map((site) => site.position + 1).join(', ')
                      : selectedRestriction?.positions.map((pos) => pos + 1).join(', ')} bp · {selectedRestrictionSites.length || (selection?.kind === 'restriction' ? selection.tickIds.length : 0)} hit(s)
                  </span>
                </>
              ) : selectedMapRange ? (
                <>
                  <strong>Map range</strong>
                  <span>{mapRangeLabel(selectedMapRange, sequence.length)} {sequenceUnitLabel(sequenceType)}</span>
                  {isEditable && inspectorSelectionSeq ? (
                    <div className="motif-cs-inspector-stats">
                      <span>{inspectorSelectionSeq.length} {sequenceUnitLabel(sequenceType)}</span>
                      {inspectorGc !== null ? <span>GC {formatPercent(inspectorGc)}</span> : null}
                      {inspectorTm != null ? <span>Tm {inspectorTm.toFixed(1)} C</span> : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <span>Select a feature or restriction tick.</span>
              )}
            </div>
          </details>

          <details className="motif-cs-panel" name="motif-cs-tools" data-rail-tool="pattern-search">
            <summary className="motif-cs-panel-head" data-rail-label="F" title="Pattern search">
              <Search className="motif-cs-panel-icon" size={14} strokeWidth={2.2} aria-hidden="true" />
              <span>Pattern Search</span>
              <span className="motif-cs-chip">{motifHits.length} hit{motifHits.length === 1 ? '' : 's'}</span>
            </summary>
            <div className="motif-cs-tool-panel-body motif-cs-motif-body">
              <RailPopoverTitle title="Pattern Search" meta={`${motifHits.length} hit${motifHits.length === 1 ? '' : 's'}`} />
              <input
                className="motif-cs-input"
                name="motif-search"
                autoComplete="off"
                maxLength={MAX_MOTIF_LENGTH}
                value={motif}
                spellCheck={false}
                disabled={!hasActiveRecord}
                onChange={(event) => handleMotifChange(event.target.value)}
                aria-label="Pattern search"
                placeholder={sequenceType === 'protein' ? 'Find residues, e.g. HHHHHH…' : 'Find sequence, e.g. GAATTC…'}
              />
              {motifHits.length > 0 ? (
                <div className="motif-cs-motif-hit-list" aria-label="Pattern hits">
                  {motifHits.slice(0, 12).map((hit) => {
                    const context = motifHitContext(sequence, hit, cleanedMotifLength, 10, topology);
                    const contextLabel = `${context.left}${context.match}${context.right}`;
                    return (
                      <button
                        key={hit}
                        className="motif-cs-motif-hit-row"
                        type="button"
                        aria-label={`Jump to motif hit at ${hit + 1}: ${contextLabel}`}
                        onClick={() => selectSequenceRangeAndReveal(hit, hit + cleanedMotifLength)}
                      >
                        <span className="motif-cs-motif-hit-position">{hit + 1}</span>
                        <span className="motif-cs-motif-hit-context" aria-hidden="true">
                          {context.clippedLeft ? <span className="motif-cs-motif-hit-ellipsis">…</span> : null}
                          <span>{context.left}</span>
                          <mark>{context.match}</mark>
                          <span>{context.right}</span>
                          {context.clippedRight ? <span className="motif-cs-motif-hit-ellipsis">…</span> : null}
                        </span>
                      </button>
                    );
                  })}
                  {motifHits.length > 12 ? (
                    <span className="motif-cs-motif-hit-overflow">+{motifHits.length - 12} more hits</span>
                  ) : null}
                </div>
              ) : (
                <p className="motif-cs-muted">{motif.trim() ? 'No hits on either strand' : 'Type a sequence to find and jump to every match (both strands).'}</p>
              )}
            </div>
          </details>

          <details
            className="motif-cs-panel"
            name="motif-cs-tools"
            data-rail-tool="translation"
            onToggle={(event) => {
              const open = (event.currentTarget as HTMLDetailsElement).open;
              setTranslationPanelOpen(open);
              if (open) setShowTranslations(false);
            }}
          >
            <summary className="motif-cs-panel-head" data-rail-label="T" title="Translation">
              <Languages className="motif-cs-panel-icon" size={14} strokeWidth={2.2} aria-hidden="true" />
              <span>Translation</span>
              <span className="motif-cs-chip">+{translateFrame + 1}</span>
            </summary>
            <div className="motif-cs-tool-panel-body motif-cs-translation-tool-body">
              <RailPopoverTitle title="Translation" meta={`+${translateFrame + 1}`} />
              <TranslationPanel
                canTranslate={isEditable}
                targetLabel={translateTarget.label}
                isWhole={translateTarget.whole}
                translationCode={translationCode}
                translationCodeContext={translationCodeContext}
                strand={translateStrand}
                frame={translateFrame}
                residues={previewResidues}
                protein={previewProtein}
                unavailableReason={translationUnavailableReason}
                canAddToSequence={canPinPreviewTranslation}
                layerCount={translationLayers.length}
                onStrandChange={setTranslateStrand}
                onFrameChange={setTranslateFrame}
                onTranslationCodeChange={updateTranslationCodeForTarget}
                onSelectCodon={(start, end) => selectTranslationCodonAndReveal(
                  start,
                  end,
                  previewTrack?.strand,
                  translationCode.supported ? translationCode.id : undefined,
                  translateTargetFeature?.id,
                )}
                onCopy={copyText}
                onAddToSequence={addTranslationLayer}
                onAddRecord={addPreviewTranslationRecord}
                onClearLayers={clearTranslationLayers}
                onOpenFloating={openTranslationsWindow}
              />
            </div>
          </details>

          <details className="motif-cs-panel" name="motif-cs-tools" data-rail-tool="primer-design">
            <summary ref={primerToggleRef} className="motif-cs-panel-head" data-rail-label="P" title="Primer design">
              <Dna className="motif-cs-panel-icon" size={14} strokeWidth={2.2} aria-hidden="true" />
              <span>Primer Design</span>
              <span className="motif-cs-chip">{guideScopeRange ? `${Math.max(0, guideScopeRange.end - guideScopeRange.start).toLocaleString()} bp` : 'PCR'}</span>
            </summary>
            <div className="motif-cs-tool-panel-body motif-cs-cloning-launcher">
              <RailPopoverTitle title="Primer Design" meta={guideScopeRange ? 'current target' : 'whole record'} />
              <div className="motif-cs-cloning-launcher-copy">
                <strong>Ranked primer workspace</strong>
                <span>Set the target and conditions, inspect Tm, GC, hairpin and dimer evidence, then save or hand the pair to PCR and cloning.</span>
              </div>
              <button
                className="motif-cs-mini-button motif-cs-mini-button-accent"
                type="button"
                onClick={openPrimerWorkspace}
                disabled={!isEditable}
                data-testid="open-primer-workspace"
              >
                Open primer workspace
              </button>
            </div>
          </details>

          <GuideSearchPanel
            sequence={sequence}
            sequenceType={sequenceType}
            topology={topology}
            scopeRange={guideScopeRange}
            onSelectRange={selectSequenceRangeAndReveal}
            onCopy={async (label, value) => {
              await copyText(label, value);
            }}
          />

          <AnalysisPanel
            record={vector}
            sequenceType={sequenceType}
            topology={topology}
            onCopy={copyText}
            onAddFeature={addFeature}
            onSelectRange={selectSequenceRangeAndReveal}
            onTranslationCodeChange={updateRecordTranslationTableId}
          />

          <details className="motif-cs-panel" name="motif-cs-tools" data-rail-tool="cloning">
            <summary ref={cloningToggleRef} className="motif-cs-panel-head" data-rail-label="C" title="Cloning workflows">
              <Workflow className="motif-cs-panel-icon" size={14} strokeWidth={2.2} aria-hidden="true" />
              <span>Cloning</span>
              <span className="motif-cs-chip">design</span>
            </summary>
            <div className="motif-cs-tool-panel-body motif-cs-cloning-launcher">
              <RailPopoverTitle title="Cloning" meta="design + validate" />
              <div className="motif-cs-cloning-launcher-copy">
                <strong>Guided design workspace</strong>
                <span>Choose a Golden Gate profile or Gibson, order parts, resolve preparation, and save a provenance-linked plan or product.</span>
              </div>
              <button
                className="motif-cs-mini-button motif-cs-mini-button-accent"
                type="button"
                onClick={() => openCloningDesignWorkspace()}
                disabled={assemblyRecords.length < 2}
                data-testid="open-cloning-design-workspace"
              >
                Open design workspace
              </button>
              <div className="motif-cs-cloning-launcher-copy">
                <strong>Restriction / ligation bench</strong>
                <span>Use the bounded quick workspace for pre-flanked Golden Gate parts or explicit sticky/blunt-end ligation.</span>
              </div>
              <button
                className="motif-cs-mini-button"
                type="button"
                onClick={openAssemblyWorkspace}
                disabled={assemblyRecords.length < 2}
                data-testid="open-assembly-workspace"
              >
                Open quick assembly
              </button>
              <div className="motif-cs-cloning-launcher-copy">
                <strong>Gel preview</strong>
                <span>Compare saved digests and linear DNA with a qualitative 1 kb or 100 bp ladder.</span>
              </div>
              <button
                className="motif-cs-mini-button"
                type="button"
                onClick={openGelWorkspace}
                disabled={gelLaneCandidates.length === 0}
                data-testid="open-gel-workspace"
              >
                Open gel workspace
              </button>
              <p className="motif-cs-form-note">
                {assemblyRecords.length} DNA record{assemblyRecords.length === 1 ? '' : 's'} · {gelLaneCandidates.length} gel lane source{gelLaneCandidates.length === 1 ? '' : 's'}
              </p>
            </div>
          </details>

          <details className="motif-cs-panel" name="motif-cs-tools" data-rail-tool="construct-verification">
            <summary ref={constructVerificationToggleRef} className="motif-cs-panel-head" data-rail-label="V" title="Construct verification">
              <ShieldCheck className="motif-cs-panel-icon" size={14} strokeWidth={2.2} aria-hidden="true" />
              <span>Construct Verification</span>
              <span className="motif-cs-chip">{constructVerificationReadCount} read{constructVerificationReadCount === 1 ? '' : 's'}</span>
            </summary>
            <div className="motif-cs-tool-panel-body motif-cs-cloning-launcher">
              <RailPopoverTitle title="Construct Verification" meta="predicted vs observed" />
              <div className="motif-cs-cloning-launcher-copy">
                <strong>Sanger evidence review</strong>
                <span>Compare imported trace-backed reads with a predicted DNA construct, review coverage and variants, then save a provenance-linked report.</span>
              </div>
              <button
                className="motif-cs-mini-button motif-cs-mini-button-accent"
                type="button"
                onClick={openConstructVerificationWorkspace}
                disabled={constructVerificationReferenceCount === 0 || constructVerificationReadCount === 0}
                data-testid="open-construct-verification"
              >
                Open verification workspace
              </button>
              <p className="motif-cs-form-note">
                {constructVerificationReferenceCount} predicted reference{constructVerificationReferenceCount === 1 ? '' : 's'} · {constructVerificationReadCount} eligible Sanger read{constructVerificationReadCount === 1 ? '' : 's'}{constructVerificationExcludedCount > 0 ? ` · ${constructVerificationExcludedCount} excluded by verifier limits` : ''}. Verification only runs after explicit review.
              </p>
            </div>
          </details>

          <details className="motif-cs-panel" name="motif-cs-tools" data-rail-tool="analysis-results">
            <summary className="motif-cs-panel-head" data-rail-label="R" title="Agent and analysis results">
              <Beaker className="motif-cs-panel-icon" size={14} strokeWidth={2.2} aria-hidden="true" />
              <span>Results</span>
              <span className="motif-cs-chip">{payload.analysisResults.length}</span>
            </summary>
            <div className="motif-cs-tool-panel-body motif-cs-workflow-tool-body">
              <RailPopoverTitle title="Results" meta={`${payload.analysisResults.length} saved`} />
              <ClaudeScienceAgentResultsPanel
                results={payload.analysisResults}
                assets={payload.analysisAssets}
                recordNames={recordNamesById}
                freshnessByResultId={analysisFreshnessByResultId}
                onRevealRecord={revealWorkspaceRecord}
                onRemove={removeWorkspaceAnalysisResult}
              />
            </div>
          </details>

          <details className="motif-cs-panel" name="motif-cs-tools" data-rail-tool="workflows">
            <summary className="motif-cs-panel-head" data-rail-label="W" title="Saved workflow results">
              <History className="motif-cs-panel-icon" size={14} strokeWidth={2.2} aria-hidden="true" />
              <span>Workflow Results</span>
              <span className="motif-cs-chip">{payload.workflowResults.length}</span>
            </summary>
            <div className="motif-cs-tool-panel-body motif-cs-workflow-tool-body">
              <RailPopoverTitle title="Workflow Results" meta={`${payload.workflowResults.length} saved`} />
              <ClaudeScienceWorkflowHistoryPanel
                results={payload.workflowResults}
                recordNames={recordNamesById}
                freshnessByResultId={workflowFreshnessByResultId}
                onRevealRecord={revealWorkspaceRecord}
                onRemove={removeWorkspaceWorkflowResult}
              />
            </div>
          </details>

          <details className="motif-cs-panel" name="motif-cs-tools" data-rail-tool="alignment">
            {/* data-rail-count is the collapsed rail's only view of the chip beside
                it. The rail hides `.motif-cs-chip` outright, and of the fifteen tool
                heads this is the one whose chip reports session content rather than a
                static label, so hiding it made the rail identical whether the session
                held no alignments or twenty. The attribute is absent at zero so a
                session that never aligns anything gains no mark. */}
            <summary
              ref={alignmentToggleRef}
              className="motif-cs-panel-head"
              data-rail-label="M"
              data-rail-count={payload.alignments.length || undefined}
              title={payload.alignments.length
                ? `Multiple sequence alignment — ${payload.alignments.length} in session`
                : 'Multiple sequence alignment'}
            >
              <AlignCenter className="motif-cs-panel-icon" size={14} strokeWidth={2.2} aria-hidden="true" />
              <span>Alignment</span>
              <span className="motif-cs-chip">{payload.alignments.length ? `${payload.alignments.length} MSA` : 'MSA'}</span>
            </summary>
            <div className="motif-cs-tool-panel-body motif-cs-alignment-tool-body">
              <RailPopoverTitle
                title="Alignment"
                meta={payload.alignments.length
                  ? `${payload.alignments.length} in session${alignmentsNeedingReview.length ? ` · ${alignmentsNeedingReview.length} review` : ''}`
                  : 'MSA'}
              />
              <p className="motif-cs-alignment-tool-intro">
                Compare 2–10 compatible records locally, or review aligned output from MAFFT, MUSCLE, or Clustal Omega.
              </p>
              {representativeAlignmentFreshness ? (
                <div className="motif-cs-alignment-freshness-summary" data-testid="alignment-freshness-summary">
                  <ClaudeScienceFreshnessBadge
                    evaluation={representativeAlignmentFreshness}
                    recordNames={recordNamesById}
                    showReason
                  />
                  <span>{alignmentsNeedingReview.length.toLocaleString()} alignment{alignmentsNeedingReview.length === 1 ? '' : 's'} need lineage review.</span>
                </div>
              ) : null}
              <button className="motif-cs-mini-button motif-cs-alignment-launch" type="button" data-testid="msa-open-button" aria-label="Open alignment workspace" onClick={openAlignmentWindow}>
                <AlignCenter size={17} strokeWidth={2.1} aria-hidden="true" />
                <span className="motif-cs-alignment-launch-copy">
                  <strong>Open alignment workspace</strong>
                  <small>{payload.alignments.length
                    ? `${payload.alignments.length} alignment${payload.alignments.length === 1 ? '' : 's'} in session · review or create another`
                    : 'Choose inputs, import an alignment, or inspect Sanger traces'}</small>
                </span>
                <ChevronRight size={15} strokeWidth={2.2} aria-hidden="true" />
              </button>
              <div className="motif-cs-alignment-boundary" role="note">
                <Info size={13} strokeWidth={2} aria-hidden="true" />
                <span><strong>External engines</strong> run outside this HTML; imported results retain their actual provenance.</span>
              </div>
            </div>
          </details>

          <details className="motif-cs-panel" name="motif-cs-tools" data-rail-tool="settings">
            <summary className="motif-cs-panel-head" data-rail-label="S" title="Settings and about">
              <Settings className="motif-cs-panel-icon" size={14} strokeWidth={2.2} aria-hidden="true" />
              <span>Settings</span>
              <span className="motif-cs-chip">{activeThemeLabel}</span>
            </summary>
            <div className="motif-cs-tool-panel-body motif-cs-settings-body">
              <RailPopoverTitle title="Settings" meta={activeThemeLabel} />
              <div className="motif-cs-settings-section">
                <fieldset className="motif-cs-theme-fieldset">
                  <legend>Appearance</legend>
                  <div className="motif-cs-theme-grid">
                    {THEME_OPTIONS.map((option) => (
                      <label
                        key={option.id}
                        className="motif-cs-theme-choice"
                        data-active={theme === option.id || undefined}
                        data-theme-choice={option.id}
                      >
                        <input
                          type="radio"
                          name="settings-theme"
                          value={option.id}
                          checked={theme === option.id}
                          onChange={() => {
                            setTheme(option.id);
                          }}
                        />
                        <span className="motif-cs-theme-swatches" aria-hidden="true">
                          <span data-swatch="surface" />
                          <span data-swatch="ink" />
                          <span data-swatch="accent" />
                        </span>
                        <span className="motif-cs-theme-choice-copy">
                          <strong translate="no">{option.label}</strong>
                          <small>{option.description}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
              <ClaudeScienceDataSettings
                recordCount={payload.records.length}
                alignmentCount={payload.alignments.length}
                noteCount={payload.notes.length}
                workflowCount={payload.workflowResults.length}
                analysisResultCount={payload.analysisResults.length}
                sessionOnly
                hasUnsavedChanges={hasUnsavedChanges}
                onDownloadBackup={downloadWorkspaceBackup}
                onRestoreFile={restoreWorkspaceBackupFile}
                onClearWorkspace={clearWorkspaceData}
                onResetDisplayPreferences={resetDisplayPreferences}
              />
              <div className="motif-cs-about-block">
                <strong>Motif for Claude Science</strong>
                <span title={`Runtime build ${MOTIF_ARTIFACT_BUILD_ID}`}>Version {MOTIF_ARTIFACT_VERSION} · Build {MOTIF_ARTIFACT_BUILD_LABEL}</span>
                <p>Motif is an open-source, AI-native molecular biology suite for researchers.</p>
                <p className="motif-cs-share-note">Share the generated HTML for local browser review. Download a workspace backup to carry records, alignments, notes, results, and display-independent session state to another copy.</p>
                <span>By Jacob Vogan</span>
              </div>
            </div>
          </details>
            {toolsFloating ? (
              <FloatingPaneResizeHandle pane="tools" title="Tools" onPointerDown={beginFloatingPaneInteraction} onKeyDown={resizeFloatingPaneFromKeyboard} />
            ) : null}
            </aside>
          </>
        ) : null}
      </main>

      {showTranslations ? (
        <FloatingWindow
          title="Translations"
          subtitle={vector.name}
          initial={translationsWin}
          resetSignal={windowResetSignal}
          rightInset={toolsRail ? TOOLS_RAIL_WIDTH : 0}
          onClose={() => setShowTranslations(false)}
          onCommit={setTranslationsWin}
          returnFocusRef={translationsToggleRef}
        >
          <TranslationPanel
            canTranslate={isEditable}
            targetLabel={translateTarget.label}
            isWhole={translateTarget.whole}
            translationCode={translationCode}
            translationCodeContext={translationCodeContext}
            strand={translateStrand}
            frame={translateFrame}
            residues={previewResidues}
            protein={previewProtein}
            unavailableReason={translationUnavailableReason}
            canAddToSequence={canPinPreviewTranslation}
            layerCount={translationLayers.length}
            onStrandChange={setTranslateStrand}
            onFrameChange={setTranslateFrame}
            onTranslationCodeChange={updateTranslationCodeForTarget}
            onSelectCodon={(start, end) => selectTranslationCodonAndReveal(
              start,
              end,
              previewTrack?.strand,
              translationCode.supported ? translationCode.id : undefined,
              translateTargetFeature?.id,
            )}
            onCopy={copyText}
            onAddToSequence={addTranslationLayer}
            onAddRecord={addPreviewTranslationRecord}
            onClearLayers={clearTranslationLayers}
          />
        </FloatingWindow>
      ) : null}
      {showGel ? (
        <FloatingWindow
          title="Gel Preview"
          subtitle="qualitative agarose"
          initial={gelWin}
          resetSignal={windowResetSignal}
          rightInset={toolsRail ? TOOLS_RAIL_WIDTH : 0}
          onClose={() => setShowGel(false)}
          onCommit={setGelWin}
          returnFocusRef={gelReturnFocusRef}
          maximizable
        >
          <ClaudeScienceGelWorkspace
            embedded
            candidates={gelLaneCandidates}
            selectedCandidateIds={gelSelectedCandidateIds}
            ladderPreset={gelLadderPreset}
            agarosePercent={gelAgarosePercent}
            workflowName={gelWorkflowName}
            resultIdentity={gelResultIdentity}
            isSaved={gelSaved}
            statusMessage={gelStatus}
            errorMessage={gelError}
            onSelectedCandidateIdsChange={(ids) => {
              setGelSelectedCandidateIds(ids);
              renewGelDraft();
            }}
            onLadderPresetChange={(preset) => {
              setGelLadderPreset(preset);
              renewGelDraft();
            }}
            onAgarosePercentChange={(percent) => {
              setGelAgarosePercent(percent);
              renewGelDraft();
            }}
            onWorkflowNameChange={(name) => {
              setGelWorkflowName(name);
              renewGelDraft();
            }}
            onSaveResult={saveGelResult}
            onClose={() => setShowGel(false)}
          />
        </FloatingWindow>
      ) : null}
      {showPrimerDesign && isEditable ? (
        <FloatingWindow
          title="Primer Design"
          subtitle={cloningPrimerRequest ? `${vector.name} · cloning preparation` : vector.name}
          initial={primerWin}
          resetSignal={windowResetSignal}
          rightInset={toolsRail ? TOOLS_RAIL_WIDTH : 0}
          onClose={closePrimerWorkspace}
          onCommit={setPrimerWin}
          returnFocusRef={primerToggleRef}
          maximizable
          >
          <ClaudeSciencePrimerWorkspace
            key={cloningPrimerRequest
              ? `primer-workspace:cloning:${cloningPrimerRequest.plan.provenance?.requestSha256 ?? 'unverified'}`
              : `primer-workspace:general:${recordId}`}
            embedded
            record={{
              id: recordId,
              name: vector.name,
              sequence,
              molecule: sequenceType === 'rna' ? 'rna' : 'dna',
            }}
            selectedRange={cloningPrimerRequest ? null : guideScopeRange}
            initialIntent={cloningPrimerRequest ? 'cloning' : 'pcr'}
            preparationContext={cloningPrimerContext}
            initialForwardTail={cloningPrimerInitialTails.forward}
            initialReverseTail={cloningPrimerInitialTails.reverse}
            preparationProgress={cloningPrimerRequest && activeCloningPrimerItem ? {
              current: cloningPrimerRecordIndex + 1,
              total: cloningPrimerWorklist.length,
              completed: completedCloningPrimerActionCount,
              remaining: cloningPrimerWorklist.length - completedCloningPrimerActionCount,
            } : null}
            onPreviousPreparation={cloningPrimerRequest && cloningPrimerRecordIndex > 0
              ? () => navigateCloningPrimerRecord(cloningPrimerRecordIndex - 1)
              : undefined}
            onNextPreparation={cloningPrimerRequest && cloningPrimerRecordIndex < cloningPrimerWorklist.length - 1
              ? () => navigateCloningPrimerRecord(cloningPrimerRecordIndex + 1)
              : undefined}
            onClose={closePrimerWorkspace}
            onSelectRange={selectSequenceRangeAndReveal}
            onCopy={async (label, value) => {
              await copyText(label, value);
            }}
            onExport={(payload: ClaudeSciencePrimerExport) => {
              downloadTextFile(payload.filename, payload.text, 'text/x-fasta');
            }}
            onSaveDesign={(handoff) => {
              savePrimerDesignResult(handoff);
            }}
            onAddAnnotations={(nextFeatures, handoff) => {
              addFeatures(nextFeatures);
              savePrimerDesignResult(handoff);
            }}
            onSimulatePcr={simulatePrimerPcr}
            onCreateAmplicon={materializePrimerAmplicon}
            onUseForCloning={usePrimerDesignForCloning}
          />
        </FloatingWindow>
      ) : null}
      {showAssembly ? (
        <FloatingWindow
          title="Cloning Workspace"
          subtitle="Golden Gate + ligation"
          initial={assemblyWin}
          resetSignal={windowResetSignal}
          rightInset={toolsRail ? TOOLS_RAIL_WIDTH : 0}
          onClose={() => setShowAssembly(false)}
          onCommit={setAssemblyWin}
          returnFocusRef={cloningToggleRef}
          maximizable
        >
          <ClaudeScienceAssemblyWorkspace
            embedded
            records={assemblyRecords}
            initialRecordIds={assemblyInitialRecordIds}
            onClose={() => setShowAssembly(false)}
            onSave={saveAssemblyArtifacts}
          />
        </FloatingWindow>
      ) : null}
      {showCloningDesign ? (
        <FloatingWindow
          title="Cloning Design"
          subtitle="Golden Gate profiles + Gibson"
          initial={cloningDesignWin}
          resetSignal={windowResetSignal}
          rightInset={toolsRail ? TOOLS_RAIL_WIDTH : 0}
          onClose={() => setShowCloningDesign(false)}
          onCommit={setCloningDesignWin}
          returnFocusRef={cloningToggleRef}
          maximizable
          inactive={showPrimerDesign && cloningPrimerRequest !== null}
        >
          <ClaudeScienceCloningDesignWorkspace
            ref={cloningDesignWorkspaceRef}
            embedded
            records={cloningDesignRecords}
            initialRecordIds={cloningDesignInitialRecordIds}
            onClose={() => setShowCloningDesign(false)}
            onDesignPrimers={designCloningPreparationPrimers}
            onSave={saveCloningDesign}
          />
        </FloatingWindow>
      ) : null}
      {showConstructVerification ? (
        <FloatingWindow
          title="Construct Verification"
          subtitle={`${constructVerificationReadCount} eligible Sanger read${constructVerificationReadCount === 1 ? '' : 's'}`}
          initial={constructVerificationWin}
          resetSignal={windowResetSignal}
          rightInset={toolsRail ? TOOLS_RAIL_WIDTH : 0}
          onClose={() => setShowConstructVerification(false)}
          onCommit={setConstructVerificationWin}
          returnFocusRef={constructVerificationToggleRef}
          maximizable
        >
          <ClaudeScienceConstructVerificationWorkspace
            embedded
            records={constructVerificationRecords}
            initialReferenceId={constructVerificationInitialReferenceId}
            onVerify={runConstructVerification}
            onSave={saveConstructVerification}
            onClose={() => setShowConstructVerification(false)}
          />
        </FloatingWindow>
      ) : null}
      {showAlignment ? (
        <FloatingWindow
          title="Multiple Sequence Alignment"
          subtitle={payload.alignments.length ? `${payload.alignments.length} in session` : 'local + imported'}
          initial={alignmentWin}
          resetSignal={windowResetSignal}
          rightInset={toolsRail ? TOOLS_RAIL_WIDTH : 0}
          onClose={() => setShowAlignment(false)}
          onCommit={setAlignmentWin}
          returnFocusRef={alignmentToggleRef}
          maximizable
        >
          <ClaudeScienceMsaViewer
            records={payload.records}
            alignments={payload.alignments}
            activeRecordId={recordId}
            activeAlignmentId={activeAlignmentId}
            viewPreferences={msaViewPreferences}
            onActiveAlignmentChange={setActiveAlignmentId}
            onViewPreferencesChange={setMsaViewPreferences}
            onSaveAlignment={saveAlignment}
            onUpdateAlignmentTemplate={updateAlignmentTemplate}
            onDeleteAlignment={deleteAlignment}
            onImportRecords={importMsaRecords}
            onCopy={copyText}
            onDownload={downloadAlignmentText}
          />
        </FloatingWindow>
      ) : null}
    </div>
  );
}

function RestoreWorkspaceDialog({
  sourceLabel,
  incomingRecordCount,
  currentRecordCount,
  hasUnsavedChanges,
  onCancel,
  onConfirm,
}: {
  sourceLabel: string;
  incomingRecordCount: number;
  currentRecordCount: number;
  hasUnsavedChanges: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => cancelRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, [onCancel]);

  return (
    <div
      className="motif-cs-modal-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="motif-cs-modal motif-cs-restore-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="motif-cs-restore-title"
        aria-describedby="motif-cs-restore-description"
        data-testid="database-restore-dialog"
        onKeyDown={handleKeyDown}
      >
        <div className="motif-cs-modal-kicker">Database restore</div>
        <h2 id="motif-cs-restore-title">Replace this workspace?</h2>
        <p id="motif-cs-restore-description">
          <strong>{sourceLabel}</strong> contains {incomingRecordCount} record{incomingRecordCount === 1 ? '' : 's'}.
          {' '}Replacing will remove the current {currentRecordCount} record{currentRecordCount === 1 ? '' : 's'} and its workbench state.
        </p>
        {hasUnsavedChanges ? (
          <p className="motif-cs-restore-warning">The current workspace has unsaved changes. Export Database JSON or ZIP first if you may need them.</p>
        ) : null}
        <div className="motif-cs-modal-actions">
          <button ref={cancelRef} className="motif-cs-mini-button" type="button" onClick={onCancel}>Cancel</button>
          <button className="motif-cs-mini-button motif-cs-danger-button" type="button" onClick={onConfirm}>Replace workspace</button>
        </div>
      </div>
    </div>
  );
}

function PanePlacementControl({
  pane,
  title,
  floating,
  disabled = false,
  onPopOut,
  onDock,
}: {
  pane: PaneKey;
  title: string;
  floating: boolean;
  disabled?: boolean;
  onPopOut: (pane: PaneKey) => void;
  onDock: (pane: PaneKey) => void;
}) {
  return (
    <button
      className="motif-cs-pane-placement-button"
      type="button"
      data-pane-popout={!floating || undefined}
      data-pane-dock={floating || undefined}
      disabled={!floating && disabled}
      onClick={() => floating ? onDock(pane) : onPopOut(pane)}
      aria-label={floating ? `Dock ${title} pane` : `Pop out ${title} pane`}
      title={floating
        ? `Dock ${title} back into the workspace`
        : disabled
          ? 'Keep one content pane docked in the workspace'
          : `Open ${title} as a movable pane`}
    >
      {floating ? <Minimize2 size={14} strokeWidth={2.1} aria-hidden="true" /> : <Maximize2 size={14} strokeWidth={2.1} aria-hidden="true" />}
    </button>
  );
}

function FloatingPaneResizeHandle({
  pane,
  title,
  onPointerDown,
  onKeyDown,
}: {
  pane: PaneKey;
  title: string;
  onPointerDown: (pane: PaneKey, mode: 'move' | 'resize', event: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (pane: PaneKey, event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      className="motif-cs-floating-pane-resize"
      type="button"
      data-testid={`floating-pane-resize-${pane}`}
      onPointerDown={(event) => onPointerDown(pane, 'resize', event)}
      onKeyDown={(event) => onKeyDown(pane, event)}
      aria-label={`Resize ${title} pane in 2 dimensions`}
      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
      title={`Drag to resize ${title}; use arrow keys for precise control`}
    />
  );
}

function PaneResizeHandle({
  pane,
  label,
  width,
  limits = PANE_WIDTH_LIMITS[pane],
  edge = 'after',
  onPointerDown,
  onKeyDown,
  style,
}: {
  pane: ResizablePaneKey;
  label: string;
  width: number;
  limits?: { min: number; max: number };
  edge?: ResizeEdge;
  onPointerDown: (pane: ResizablePaneKey, event: ReactPointerEvent<HTMLDivElement>, edge?: ResizeEdge) => void;
  onKeyDown: (pane: ResizablePaneKey, event: ReactKeyboardEvent<HTMLDivElement>, edge?: ResizeEdge) => void;
  style?: CSSProperties;
}) {
  return (
    <div
      className="motif-cs-resize-handle"
      data-pane={pane}
      style={style}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={(event) => onPointerDown(pane, event, edge)}
      onKeyDown={(event) => onKeyDown(pane, event, edge)}
      title="Use Left and Right Arrow keys to resize"
    />
  );
}

function StackedPaneResizeHandle({
  pane,
  label,
  height,
  min,
  max,
  onPointerDown,
  onKeyDown,
  onReset,
  style,
}: {
  pane: StackedResizablePaneKey;
  label: string;
  height: number;
  min: number;
  max: number;
  onPointerDown: (pane: StackedResizablePaneKey, event: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyDown: (pane: StackedResizablePaneKey, event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onReset: (pane: StackedResizablePaneKey) => void;
  style?: CSSProperties;
}) {
  return (
    <div
      className="motif-cs-stacked-resize-handle"
      data-pane={pane}
      style={style}
      role="separator"
      aria-orientation="horizontal"
      aria-label={`Resize stacked ${label.toLowerCase()} pane`}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(height)}
      tabIndex={0}
      onPointerDown={(event) => onPointerDown(pane, event)}
      onKeyDown={(event) => onKeyDown(pane, event)}
      onDoubleClick={() => onReset(pane)}
      title={`Drag to resize ${label}; use Up and Down Arrow keys; double-click to fit`}
    />
  );
}

function inventorySystemGroupKey(record: ArtifactVector): InventorySystemGroupKey {
  const source = String(record.source ?? '').toLowerCase();
  const operation = String(record.provenance?.operation ?? '').toLowerCase();
  if (source.includes('paste') || source.includes('import')) return 'imported';
  if (operation || source.includes('claude science artifact')) return 'derived';
  if (record.type === 'protein') return 'protein';
  if (record.type === 'rna') return 'rna';
  return 'vectors';
}

function inventoryTagGroupLabel(tags: readonly string[] | undefined): string | undefined {
  for (const tag of tags ?? []) {
    const trimmed = tag.trim();
    const lower = trimmed.toLowerCase();
    for (const prefix of ['project:', 'folder:', 'group:', 'collection:']) {
      if (lower.startsWith(prefix)) return normalizeInventoryGroupLabel(trimmed.slice(prefix.length));
    }
  }
  return undefined;
}

function inventoryGroupDescriptor(record: ArtifactVector): { key: string; label: string; systemKey?: InventorySystemGroupKey } {
  const projectLabel = normalizeInventoryGroupLabel(record.group) ?? inventoryTagGroupLabel(record.tags);
  if (projectLabel) {
    return { key: `project:${projectLabel.toLowerCase()}`, label: projectLabel };
  }
  const systemKey = inventorySystemGroupKey(record);
  return { key: `system:${systemKey}`, label: INVENTORY_SYSTEM_GROUP_LABELS[systemKey], systemKey };
}

function groupInventoryRecords(records: readonly ArtifactVector[]): InventoryGroup[] {
  const groups = new Map<string, InventoryGroup>();
  for (const record of records) {
    const group = inventoryGroupDescriptor(record);
    const existing = groups.get(group.key);
    if (existing) {
      existing.records.push(record);
    } else {
      groups.set(group.key, { key: group.key, label: group.label, records: [record] });
    }
  }
  const projectGroups = Array.from(groups.values())
    .filter((group) => group.key.startsWith('project:'))
    .sort((left, right) => left.label.localeCompare(right.label));
  const systemGroups = INVENTORY_SYSTEM_GROUP_ORDER
    .map((key) => groups.get(`system:${key}`))
    .filter((group): group is InventoryGroup => Boolean(group));
  return [...projectGroups, ...systemGroups];
}

function InventoryList({
  records,
  selectedRecordId,
  onSelect,
}: {
  records: readonly ArtifactVector[];
  selectedRecordId: string;
  onSelect: (recordId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Partial<Record<string, boolean>>>({});
  const previousSelectedRecordId = useRef(selectedRecordId);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredRecords = useMemo(() => {
    if (!normalizedQuery) return records;
    return records.filter((record) => [
      record.id,
      record.name,
      record.description,
      record.type,
      record.topology,
      record.group,
      record.organism,
      record.source,
      ...(record.tags ?? []),
      record.sequence,
    ].some((value) => String(value ?? '').toLowerCase().includes(normalizedQuery)));
  }, [normalizedQuery, records]);
  const groupedRecords = useMemo(() => groupInventoryRecords(filteredRecords), [filteredRecords]);
  const selectedGroupKey = useMemo(() => {
    const selectedRecord = records.find((record) => record.id === selectedRecordId);
    return selectedRecord ? inventoryGroupDescriptor(selectedRecord).key : null;
  }, [records, selectedRecordId]);

  useEffect(() => {
    const selectedChanged = previousSelectedRecordId.current !== selectedRecordId;
    previousSelectedRecordId.current = selectedRecordId;
    if (!selectedChanged || !normalizedQuery) return;
    if (!filteredRecords.some((record) => record.id === selectedRecordId)) setQuery('');
  }, [filteredRecords, normalizedQuery, selectedRecordId]);

  useEffect(() => {
    if (!selectedGroupKey) return;
    setCollapsedGroups((current) => (
      current[selectedGroupKey] ? { ...current, [selectedGroupKey]: false } : current
    ));
  }, [selectedGroupKey]);

  const toggleGroup = useCallback((groupKey: string) => {
    setCollapsedGroups((current) => ({ ...current, [groupKey]: !current[groupKey] }));
  }, []);

  return (
    <section className="motif-cs-inventory-list-panel" aria-label="Inventory records">
      <div className="motif-cs-inventory-filter-row">
      <input
        className="motif-cs-field motif-cs-panel-search"
        name="inventory-filter"
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filter inventory…"
        aria-label="Filter inventory"
      />
        <span className="motif-cs-chip">{filteredRecords.length}/{records.length}</span>
      </div>
      <div className="motif-cs-list motif-cs-inventory-groups">
        {groupedRecords.length > 0 ? groupedRecords.map((group) => {
          const collapsed = !normalizedQuery && !!collapsedGroups[group.key];
          const selectedInGroup = group.records.some((record) => record.id === selectedRecordId);
          return (
            <section key={group.key} className="motif-cs-inventory-group" data-open={!collapsed || undefined}>
              <button
                className="motif-cs-inventory-group-head"
                type="button"
                data-active={(collapsed && selectedInGroup) || undefined}
                aria-expanded={!collapsed}
                onClick={() => toggleGroup(group.key)}
              >
                <span className="motif-cs-inventory-caret" aria-hidden="true">
                  <ChevronRight size={13} strokeWidth={2.2} />
                </span>
                <span title={group.label}>{group.label}</span>
                <small>{group.records.length}</small>
              </button>
              {!collapsed ? group.records.map((record) => (
                <button
                  key={record.id}
                  className="motif-cs-row motif-cs-row-compact motif-cs-inventory-record-row"
                  data-active={record.id === selectedRecordId || undefined}
                  type="button"
                  aria-current={record.id === selectedRecordId ? 'true' : undefined}
                  onClick={() => onSelect(record.id)}
                >
                  <span className="motif-cs-row-main">
                    {/* Constructs are told apart by their suffix — _clone12_Rep2,
                        -WPRE-hGHpA — and the suffix is the end the ellipsis eats
                        at the pane's 210px default. Every other truncating
                        control here carries the full string in a title; this row
                        was the one that did not. */}
                    <span translate="no" title={record.name}>{record.name}</span>
                    <small>{record.type} · {record.topology} · {sequenceLengthLabel(record.sequence.length, record.type)}</small>
                  </span>
                </button>
              )) : null}
            </section>
          );
        }) : (
          <p className="motif-cs-muted">{records.length === 0 && !normalizedQuery ? 'No records yet. Add or drop a sequence to begin.' : 'No records match this filter.'}</p>
        )}
      </div>
    </section>
  );
}

function ImportSequencePanel({
  defaults,
  open,
  confirmedRestoreCount,
  onDefaultsChange,
  onOpenChange,
  onAddRecords,
  onImportFiles,
  onRestoreDatabase,
}: {
  defaults: ImportDefaults;
  open: boolean;
  confirmedRestoreCount: number;
  onDefaultsChange: (defaults: ImportDefaults) => void;
  onOpenChange: (open: boolean) => void;
  onAddRecords: (records: ArtifactRecordInput[]) => number;
  onImportFiles: (files: FileList | File[]) => unknown;
  onRestoreDatabase: (database: Record<string, unknown>) => number;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('');
  const [statusError, setStatusError] = useState(false);
  const previewInput = useDeferredValue(input);

  const inputPreview = useMemo(() => {
    if (!previewInput.trim()) return null;
    try {
      const database = parseArtifactDatabaseJson(previewInput);
      if (database) {
        const count = Array.isArray(database.records) ? database.records.length : 0;
        return `${count.toLocaleString()} database record${count === 1 ? '' : 's'} detected · restore replaces this workspace`;
      }
      const records = parseImportedRecords(previewInput, defaults.name, defaults.type, defaults.topology);
      if (records.length === 0) return null;
      const lengths = records.map((record) => normalizeSequence(record.seq ?? record.sequence ?? '', record.molecule ?? record.type).length);
      const types = Array.from(new Set(records.map((record) => (
        normalizeSequenceType(record.molecule ?? record.type, normalizeSequence(record.seq ?? record.sequence ?? '', record.molecule ?? record.type))
      ))));
      const range = lengths.length > 0
        ? Math.min(...lengths) === Math.max(...lengths)
          ? `${lengths[0].toLocaleString()} ${types[0] === 'protein' ? 'aa' : 'bp'}`
          : `${Math.min(...lengths).toLocaleString()}–${Math.max(...lengths).toLocaleString()} ${types.every((type) => type === 'protein') ? 'aa' : 'bp'}`
        : '';
      return `${records.length.toLocaleString()} record${records.length === 1 ? '' : 's'} detected · ${types.map((type) => type.toUpperCase()).join(' + ')}${range ? ` · ${range}` : ''}`;
    } catch {
      return null;
    }
  }, [defaults.name, defaults.topology, defaults.type, previewInput]);

  useEffect(() => {
    if (confirmedRestoreCount === 0) return;
    setInput('');
    setStatus('');
    setStatusError(false);
  }, [confirmedRestoreCount]);

  useEffect(() => {
    if (!open) return;
    const panel = detailsRef.current;
    if (!panel) return;

    const closeFromOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      const trigger = document.querySelector<HTMLButtonElement>('.motif-cs-add-entry-button');
      if (panel.contains(event.target) || trigger?.contains(event.target)) return;
      onOpenChange(false);
    };
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onOpenChange(false);
      document.querySelector<HTMLButtonElement>('.motif-cs-add-entry-button')?.focus();
    };

    document.addEventListener('pointerdown', closeFromOutside, true);
    document.addEventListener('keydown', closeFromEscape);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside, true);
      document.removeEventListener('keydown', closeFromEscape);
    };
  }, [onOpenChange, open]);

  const updateDefaults = useCallback((patch: Partial<ImportDefaults>) => {
    onDefaultsChange({ ...defaults, ...patch });
  }, [defaults, onDefaultsChange]);

  const reportImportError = useCallback((message: string) => {
    setStatus(message);
    setStatusError(true);
    window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }, []);

  const addImportedRecords = useCallback(() => {
    try {
      const database = parseArtifactDatabaseJson(input);
      if (database) {
        const count = onRestoreDatabase(database);
        setStatus(`${count} record${count === 1 ? '' : 's'} ready to replace the workspace`);
        setStatusError(false);
        onDefaultsChange({ ...defaults, name: '' });
        onOpenChange(false);
        // Keep the pasted JSON until the user confirms. Cancelling is therefore
        // truly non-destructive and reopening Add Entry restores the staged input.
        // The confirmation dialog owns focus while it is open.
        return;
      }
    } catch (error) {
      reportImportError(actionableImportError(error));
      return;
    }

    let groupedRecords: ArtifactRecordInput[];
    try {
      const records = parseImportedRecords(input, defaults.name, defaults.type, defaults.topology);
      groupedRecords = applyImportDefaults(records, defaults);
    } catch (error) {
      reportImportError(actionableImportError(error));
      return;
    }
    if (groupedRecords.length === 0) {
      reportImportError('No usable sequence found. Choose the molecule type explicitly if this is a short or ambiguous protein sequence.');
      return;
    }
    const addedCount = onAddRecords(groupedRecords);
    setStatus(`${addedCount} record${addedCount === 1 ? '' : 's'} added`);
    setStatusError(addedCount === 0);
    if (addedCount === 0) {
      window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
      return;
    }
    onDefaultsChange({ ...defaults, name: '' });
    setInput('');
    onOpenChange(false);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('.motif-cs-add-entry-button')?.focus();
    });
  }, [defaults, input, onAddRecords, onDefaultsChange, onOpenChange, onRestoreDatabase, reportImportError]);

  return (
    <div className="motif-cs-import-slot">
      <details
        id="motif-cs-add-entry"
        className="motif-cs-panel motif-cs-import-panel"
        ref={detailsRef}
        open={open}
        onToggle={(event) => onOpenChange(event.currentTarget.open)}
      >
        <summary className="motif-cs-panel-head">
          <Plus className="motif-cs-panel-icon" size={14} strokeWidth={2.3} aria-hidden="true" />
          <span>Add entry</span>
        </summary>
        <div className="motif-cs-form-body motif-cs-import-form">
          <div className="motif-cs-form-grid">
            <label>
              <span>Name override</span>
              <input className="motif-cs-field" name="import-name" autoComplete="off" maxLength={MOTIF_MAX_SHORT_TEXT_LENGTH} value={defaults.name} onChange={(event) => updateDefaults({ name: event.target.value })} placeholder="Optional name…" />
            </label>
            <label>
              <span>Project / group</span>
              <input className="motif-cs-field" name="import-group" autoComplete="off" maxLength={MOTIF_MAX_SHORT_TEXT_LENGTH} value={defaults.group} onChange={(event) => updateDefaults({ group: event.target.value })} placeholder="Optional folder…" />
            </label>
          </div>
          <div className="motif-cs-form-grid">
            <label>
              <span>Molecule</span>
              <select className="motif-cs-field" name="import-molecule" value={defaults.type} onChange={(event) => updateDefaults({ type: event.target.value as SequenceType | 'auto' })}>
                <option value="auto">auto</option>
                <option value="dna">dna</option>
                <option value="rna">rna</option>
                <option value="protein">protein</option>
              </select>
            </label>
            <label>
              <span>Topology</span>
              <select className="motif-cs-field" name="import-topology" value={defaults.topology} onChange={(event) => updateDefaults({ topology: event.target.value as Topology })}>
                <option value="linear">linear</option>
                <option value="circular">circular</option>
              </select>
            </label>
          </div>
          <label>
            <span>Sequence input</span>
            <textarea
              ref={inputRef}
              className="motif-cs-textarea motif-cs-import-textarea"
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                if (statusError) setStatusError(false);
              }}
              name="import-sequence"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste FASTA, GenBank, raw sequence, or exported Database JSON…"
              aria-label="Sequence import input"
              aria-invalid={statusError || undefined}
              aria-describedby={[
                inputPreview ? 'motif-cs-import-preflight' : null,
                status ? 'motif-cs-import-status' : null,
              ].filter(Boolean).join(' ') || undefined}
            />
          </label>
          {inputPreview ? <p id="motif-cs-import-preflight" className="motif-cs-form-note" data-testid="import-preflight-summary">{inputPreview}</p> : null}
          <div className="motif-cs-layer-actions motif-cs-layer-actions-flush">
            <input
              ref={fileInputRef}
              className="motif-cs-visually-hidden"
              type="file"
              multiple
              accept=".fa,.fasta,.fas,.faa,.gb,.gbk,.genbank,.json,.ab1,.abi,text/plain,application/json"
              aria-label="Choose sequence or workspace files"
              onChange={(event) => {
                const files = event.target.files;
                if (files?.length) void onImportFiles(files);
                event.target.value = '';
              }}
            />
            <button className="motif-cs-mini-button" type="button" onClick={() => fileInputRef.current?.click()}>
              <FileText size={13} aria-hidden="true" /> Choose files
            </button>
            <button className="motif-cs-mini-button" type="button" onClick={addImportedRecords} disabled={!input.trim()}>Add / restore</button>
            <button className="motif-cs-mini-button" type="button" onClick={() => { setInput(''); setStatus('Cleared'); setStatusError(false); }} disabled={!input}>Clear</button>
          </div>
          {status ? (
            <p id="motif-cs-import-status" className="motif-cs-import-status" data-error={statusError || undefined} role={statusError ? 'alert' : 'status'} aria-live={statusError ? 'assertive' : 'polite'} aria-atomic="true">{status}</p>
          ) : null}
        </div>
      </details>
    </div>
  );
}

function FeatureList({
  recordId,
  sequenceLength,
  features,
  selectedFeatureId,
  translationTracks,
  selectedTranslationLayerId,
  defaultOpen = false,
  editorRequest = 0,
  editorLabel,
  editorChip,
  onSelect,
  onSelectTranslationTrack,
  onDeleteTranslationTrack,
  children,
}: {
  recordId: string;
  sequenceLength: number;
  features: readonly Feature[];
  selectedFeatureId: string | null;
  translationTracks: readonly InlineTranslationTrack[];
  selectedTranslationLayerId: string | null;
  defaultOpen?: boolean;
  editorRequest?: number;
  editorLabel: string;
  editorChip: string;
  onSelect: (featureId: string) => void;
  onSelectTranslationTrack: (track: InlineTranslationTrack) => void;
  onDeleteTranslationTrack: (trackId: string) => void;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [editorOpen, setEditorOpen] = useState(false);
  const [shownFeatureCount, setShownFeatureCount] = useState(ANNOTATION_LIST_PAGE_SIZE);
  const [shownTranslationCount, setShownTranslationCount] = useState(ANNOTATION_LIST_PAGE_SIZE);

  const selectedFeatureIndex = selectedFeatureId
    ? features.findIndex((feature) => feature.id === selectedFeatureId)
    : -1;
  const visibleFeatures = features.slice(0, shownFeatureCount);
  if (selectedFeatureIndex >= shownFeatureCount) {
    visibleFeatures.push(features[selectedFeatureIndex]);
  }

  const isTranslationTrackActive = (track: InlineTranslationTrack) => (
    track.id === selectedTranslationLayerId
    || (track.source === 'feature' && track.id === `feat:${selectedFeatureId}`)
  );
  const visibleTranslationTracks = translationTracks.slice(0, shownTranslationCount);
  translationTracks.slice(shownTranslationCount).forEach((track) => {
    if (isTranslationTrackActive(track)) visibleTranslationTracks.push(track);
  });

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  useEffect(() => {
    if (editorRequest <= 0) return;
    setOpen(true);
    setEditorOpen(true);
  }, [editorRequest]);

  useEffect(() => {
    if (!open || !editorOpen || editorRequest <= 0) return;
    const frame = window.requestAnimationFrame(() => {
      const editor = document.querySelector<HTMLElement>(
        'details[data-rail-tool="annotations"] .motif-cs-annotation-editor',
      );
      editor
        ?.querySelector<HTMLElement>('.motif-cs-layer-actions button:not(:disabled)')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      editor
        ?.querySelector<HTMLElement>('input[name="feature-name"]')
        ?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editorOpen, editorRequest, open]);

  useEffect(() => {
    setEditorOpen(false);
    setShownFeatureCount(ANNOTATION_LIST_PAGE_SIZE);
    setShownTranslationCount(ANNOTATION_LIST_PAGE_SIZE);
  }, [recordId]);

  useEffect(() => {
    if (!selectedFeatureId && !selectedTranslationLayerId && editorChip === 'new') setEditorOpen(false);
  }, [editorChip, selectedFeatureId, selectedTranslationLayerId]);

  return (
    <details
      className="motif-cs-panel"
      name="motif-cs-tools"
      data-rail-tool="annotations"
      open={open}
      onToggle={(event) => {
        if (event.currentTarget !== event.target) return;
        setOpen((event.target as HTMLDetailsElement).open);
      }}
    >
      <summary className="motif-cs-panel-head" data-rail-label="T" title="Annotations">
        <Tag className="motif-cs-panel-icon" size={14} strokeWidth={2.2} aria-hidden="true" />
        <span>Annotations</span>
        <span className="motif-cs-chip">{features.length + translationTracks.length}</span>
      </summary>
      {open ? (
      <div className="motif-cs-tool-panel-body motif-cs-annotation-panel-body">
        <RailPopoverTitle title="Annotations" meta={`${features.length} features · ${translationTracks.length} translations`} />
        <div className="motif-cs-annotation-section-label">Features</div>
        <div className="motif-cs-list motif-cs-annotation-list motif-cs-feature-annotation-list">
          {features.length > 0 ? visibleFeatures.map((feature) => (
            <button
              key={feature.id}
              className="motif-cs-row"
              data-active={feature.id === selectedFeatureId || undefined}
              type="button"
              aria-pressed={feature.id === selectedFeatureId}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                window.getSelection()?.removeAllRanges();
                onSelect(feature.id);
                setEditorOpen(true);
              }}
            >
              <span className="motif-cs-swatch" style={{ backgroundColor: feature.color }} />
              <span className="motif-cs-row-main" translate="no">{feature.name}</span>
              <span className="motif-cs-row-meta">{featureRangeLabel(feature)}</span>
            </button>
          )) : (
            <p className="motif-cs-muted">No annotated features.</p>
          )}
          {features.length > shownFeatureCount ? (
            <button className="motif-cs-mini-button motif-cs-list-more" type="button" onClick={() => setShownFeatureCount((count) => Math.min(features.length, count + ANNOTATION_LIST_PAGE_SIZE))}>
              Show {Math.min(ANNOTATION_LIST_PAGE_SIZE, features.length - shownFeatureCount)} more features
            </button>
          ) : null}
        </div>
        <div className="motif-cs-annotation-section-label">Translations</div>
        <div className="motif-cs-list motif-cs-annotation-list motif-cs-translation-annotation-list">
          {translationTracks.length > 0 ? visibleTranslationTracks.map((track) => {
            const active = isTranslationTrackActive(track);
            const canDelete = active;
            return (
              <div
                key={track.id}
                className="motif-cs-translation-row-shell"
                data-active={active || undefined}
                data-deletable={canDelete || undefined}
              >
                <button
                  className="motif-cs-row motif-cs-translation-row"
                  data-active={active || undefined}
                  type="button"
                  aria-pressed={active}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    window.getSelection()?.removeAllRanges();
                    onSelectTranslationTrack(track);
                    setEditorOpen(true);
                  }}
                  title="Show this translated region in the sequence pane"
                >
                  <span className="motif-cs-swatch" style={{ backgroundColor: track.color ?? 'var(--accent)' }} />
                  <span className="motif-cs-row-main" translate="no">{track.label}</span>
                  {track.needsReview ? <span className="motif-cs-chip">Review anchor</span> : null}
                  <span className="motif-cs-row-meta">{track.strand === -1 ? 'reverse' : 'forward'} · {mapRangeLabel({ start: track.start, end: track.end }, sequenceLength)}</span>
                </button>
                {canDelete ? (
                  <button
                    className="motif-cs-translation-row-delete"
                    type="button"
                    aria-label={`Delete pinned translation ${track.label}`}
                    title="Delete pinned translation"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      const shell = event.currentTarget.closest<HTMLElement>('.motif-cs-translation-row-shell');
                      const panel = event.currentTarget.closest<HTMLDetailsElement>('details[data-rail-tool="annotations"]');
                      const fallback = shell?.previousElementSibling?.querySelector<HTMLElement>('.motif-cs-translation-row')
                        ?? shell?.nextElementSibling?.querySelector<HTMLElement>('.motif-cs-translation-row')
                        ?? panel?.querySelector<HTMLElement>(':scope > summary');
                      onDeleteTranslationTrack(track.id);
                      setEditorOpen(false);
                      window.requestAnimationFrame(() => fallback?.focus({ preventScroll: true }));
                    }}
                  >
                    <Trash2 size={13} strokeWidth={2} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            );
          }) : (
            <p className="motif-cs-muted">No translated annotations yet.</p>
          )}
          {translationTracks.length > shownTranslationCount ? (
            <button className="motif-cs-mini-button motif-cs-list-more" type="button" onClick={() => setShownTranslationCount((count) => Math.min(translationTracks.length, count + ANNOTATION_LIST_PAGE_SIZE))}>
              Show {Math.min(ANNOTATION_LIST_PAGE_SIZE, translationTracks.length - shownTranslationCount)} more translations
            </button>
          ) : null}
        </div>
        {children ? (
          <details
            className="motif-cs-annotation-editor-drawer"
            open={editorOpen}
            onToggle={(event) => setEditorOpen((event.target as HTMLDetailsElement).open)}
          >
            <summary className="motif-cs-annotation-editor-summary">
              <span>{editorLabel}</span>
              <span className="motif-cs-chip">{editorChip}</span>
            </summary>
            {children}
          </details>
        ) : null}
      </div>
      ) : null}
    </details>
  );
}

type RailPopoverSize = { width: number; height: number };
type RailPopoverCorner = { left: number; top: number };

function cssPixelValue(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/* Only reached if the stylesheet stops positioning the popover at all; the real
   values are read back off the element so the two cannot drift apart. */
const RAIL_POPOVER_HOME_TOP_FALLBACK = 84;
const RAIL_POPOVER_BOTTOM_GUTTER_FALLBACK = 22;

function RailPopoverTitle({ title, meta }: { title: string; meta?: string }) {
  const [size, setSize] = useState<RailPopoverSize | null>(null);
  const [panelBody, setPanelBody] = useState<HTMLElement | null>(null);
  const [resizeCorner, setResizeCorner] = useState<RailPopoverCorner | null>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLButtonElement>(null);
  const panelBodyRef = useRef<HTMLElement | null>(null);
  const cssMetricsRef = useRef<{ key: string; homeTop: number; bottomGutter: number } | null>(null);
  const resizeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    base: RailPopoverSize;
    limits: { minWidth: number; maxWidth: number; minHeight: number; maxHeight: number };
  } | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const owner = titleRef.current?.closest<HTMLElement>('.motif-cs-tool-panel-body') ?? null;
    panelBodyRef.current = owner;
    setPanelBody(owner);
    return () => {
      owner?.style.removeProperty('--rail-popover-width');
      owner?.style.removeProperty('--rail-popover-height');
      delete owner?.dataset.railPopoverResized;
      panelBodyRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const panelBody = panelBodyRef.current;
    if (!panelBody) return;
    if (!size) {
      panelBody.style.removeProperty('--rail-popover-width');
      panelBody.style.removeProperty('--rail-popover-height');
      delete panelBody.dataset.railPopoverResized;
      return;
    }
    panelBody.style.setProperty('--rail-popover-width', `${size.width}px`);
    panelBody.style.setProperty('--rail-popover-height', `${size.height}px`);
    panelBody.dataset.railPopoverResized = 'true';
  }, [size]);

  /**
   * Keep the popover off the floating window's controls. The stylesheet gives it
   * a resting offset that knows nothing about what is underneath, which put all
   * 15 panels on top of Maximize / Collapse / Close — the one overlap with no
   * way out, because the control that would fix it is the control being hidden.
   * The solver moves it the smallest distance that clears those zones and hands
   * back the height cap that goes with wherever it landed.
   */
  useLayoutEffect(() => {
    if (!panelBody) return undefined;
    const panel = panelBody.closest<HTMLDetailsElement>('details.motif-cs-panel');
    if (!panel) return undefined;

    const clearPlacement = () => {
      panelBody.style.removeProperty('--rail-popover-fixed-top');
      panelBody.style.removeProperty('max-height');
      delete panelBody.dataset.railPopoverPlacement;
    };

    /**
     * The stylesheet owns both the resting offset and the bottom gutter baked
     * into its max-height. Read them back off the element with our own values
     * stripped rather than copying the numbers here, so a stylesheet edit cannot
     * leave a stale duplicate governing the popover. Cached per viewport size,
     * because a media query is allowed to change the offset.
     */
    const cssMetrics = () => {
      const key = `${window.innerWidth}x${window.innerHeight}`;
      const cached = cssMetricsRef.current;
      if (cached?.key === key) return cached;
      const ownTop = panelBody.style.getPropertyValue('--rail-popover-fixed-top');
      const ownMaxHeight = panelBody.style.maxHeight;
      panelBody.style.removeProperty('--rail-popover-fixed-top');
      panelBody.style.removeProperty('max-height');
      const computed = window.getComputedStyle(panelBody);
      const homeTop = cssPixelValue(computed.top, RAIL_POPOVER_HOME_TOP_FALLBACK);
      const cssMaxHeight = cssPixelValue(computed.maxHeight, window.innerHeight - homeTop - RAIL_POPOVER_BOTTOM_GUTTER_FALLBACK);
      if (ownTop) panelBody.style.setProperty('--rail-popover-fixed-top', ownTop);
      if (ownMaxHeight) panelBody.style.maxHeight = ownMaxHeight;
      const metrics = {
        key,
        homeTop,
        bottomGutter: Math.max(0, Math.round(window.innerHeight - homeTop - cssMaxHeight)),
      };
      cssMetricsRef.current = metrics;
      return metrics;
    };

    const place = () => {
      // Docked mode leaves the body in normal flow, where a fixed-position cap
      // would clamp a panel nothing is covering.
      if (!panel.open || window.getComputedStyle(panelBody).position !== 'fixed') {
        clearPlacement();
        return;
      }
      const { homeTop, bottomGutter } = cssMetrics();
      const rect = panelBody.getBoundingClientRect();
      const placement = chooseRailPopoverPlacement({
        column: { left: rect.left, right: rect.right },
        homeTop,
        bottomGutter,
        // Reported back as `hiddenHeight`; it does not move the panel. Content
        // height rather than rendered height, because the rendered height is
        // what the cap below produces and feeding that back in would let the
        // popover chase its own tail.
        desiredHeight: Math.max(
          panelBody.scrollHeight,
          cssPixelValue(panelBody.style.getPropertyValue('--rail-popover-height'), 0),
          RAIL_POPOVER_MIN_HEIGHT,
        ),
        viewportHeight: window.innerHeight,
        obstacles: collectRailPopoverObstacles(document),
      });
      const top = `${placement.top}px`;
      const maxHeight = `${placement.maxHeight}px`;
      if (panelBody.style.getPropertyValue('--rail-popover-fixed-top') !== top) {
        panelBody.style.setProperty('--rail-popover-fixed-top', top);
      }
      if (panelBody.style.maxHeight !== maxHeight) panelBody.style.maxHeight = maxHeight;
      if (panelBody.dataset.railPopoverPlacement !== placement.strategy) {
        panelBody.dataset.railPopoverPlacement = placement.strategy;
      }
    };

    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        place();
      });
    };

    // Windows move, resize, maximize and collapse under an open popover, and the
    // rail can be pinned out of popover mode entirely. Watching for that is only
    // worth the observer while this panel is the open one.
    const observedRoot = panelBody.closest<HTMLElement>('.motif-cs-shell') ?? document.body;
    let layoutObserver: MutationObserver | null = null;
    const syncLayoutObserver = () => {
      if (panel.open && !layoutObserver) {
        layoutObserver = new MutationObserver(schedule);
        layoutObserver.observe(observedRoot, {
          attributes: true,
          attributeFilter: ['style', 'class', 'data-maximized', 'data-collapsed', 'data-tools-pinned'],
          childList: true,
          subtree: true,
        });
      } else if (!panel.open && layoutObserver) {
        layoutObserver.disconnect();
        layoutObserver = null;
      }
    };

    // `open` flips inside the click that toggles the panel, and a mutation
    // callback runs at the microtask checkpoint straight after — before the
    // browser paints — so the popover never appears at the resting offset and
    // then jumps to the solved one.
    const openObserver = new MutationObserver(() => {
      syncLayoutObserver();
      place();
    });
    openObserver.observe(panel, { attributes: true, attributeFilter: ['open'] });
    window.addEventListener('resize', schedule);
    syncLayoutObserver();
    place();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      openObserver.disconnect();
      layoutObserver?.disconnect();
      clearPlacement();
    };
  }, [panelBody]);

  useLayoutEffect(() => {
    if (!panelBody) {
      setResizeCorner(null);
      return undefined;
    }
    const updateCorner = () => {
      const rect = panelBody.getBoundingClientRect();
      const next = rect.width > 0 && rect.height > 0
        ? { left: rect.left, top: rect.bottom - 28 }
        : null;
      setResizeCorner((current) => current?.left === next?.left && current?.top === next?.top ? current : next);
    };
    updateCorner();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateCorner);
    observer?.observe(panelBody);
    window.addEventListener('resize', updateCorner);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateCorner);
    };
  }, [panelBody, size]);

  const stopResize = useCallback(() => {
    resizeCleanupRef.current?.();
    resizeCleanupRef.current = null;
    resizeRef.current = null;
    delete document.body.dataset.motifCsRailPopoverResizing;
  }, []);

  useEffect(() => () => stopResize(), [stopResize]);

  const resizeLimits = useCallback((panelBody: HTMLElement) => {
    const computed = window.getComputedStyle(panelBody);
    const rect = panelBody.getBoundingClientRect();
    return {
      minWidth: cssPixelValue(computed.minWidth, Math.min(280, window.innerWidth - 16)),
      maxWidth: cssPixelValue(computed.maxWidth, Math.max(rect.width, window.innerWidth - 16)),
      minHeight: cssPixelValue(computed.minHeight, 96),
      maxHeight: cssPixelValue(computed.maxHeight, Math.max(rect.height, window.innerHeight - 16)),
    };
  }, []);

  const beginResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    const panelBody = panelBodyRef.current;
    if (!panelBody) return;
    event.preventDefault();
    event.stopPropagation();
    stopResize();

    const rect = panelBody.getBoundingClientRect();
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      base: { width: rect.width, height: rect.height },
      limits: resizeLimits(panelBody),
    };
    document.body.dataset.motifCsRailPopoverResizing = 'true';

    const handle = event.currentTarget;
    try {
      handle.setPointerCapture?.(event.pointerId);
    } catch {
      /* Window listeners keep the resize usable when capture is unavailable. */
    }

    const removeListeners = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', endPointerResize);
      window.removeEventListener('pointercancel', endPointerResize);
      window.removeEventListener('blur', endResizeFromBlur);
      handle.removeEventListener('lostpointercapture', endLostPointerCapture);
      if (resizeCleanupRef.current === removeListeners) resizeCleanupRef.current = null;
    };

    function handlePointerMove(moveEvent: PointerEvent) {
      const active = resizeRef.current;
      if (!active || moveEvent.pointerId !== active.pointerId) return;
      moveEvent.preventDefault();
      setSize({
        width: clamp(active.base.width - (moveEvent.clientX - active.startX), active.limits.minWidth, active.limits.maxWidth),
        height: clamp(active.base.height + (moveEvent.clientY - active.startY), active.limits.minHeight, active.limits.maxHeight),
      });
    }

    function endPointerResize(endEvent: PointerEvent) {
      if (endEvent.pointerId !== resizeRef.current?.pointerId) return;
      stopResize();
    }

    function endLostPointerCapture(lostEvent: PointerEvent) {
      if (lostEvent.pointerId !== resizeRef.current?.pointerId) return;
      stopResize();
    }

    function endResizeFromBlur() {
      stopResize();
    }

    resizeCleanupRef.current = removeListeners;
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', endPointerResize);
    window.addEventListener('pointercancel', endPointerResize);
    window.addEventListener('blur', endResizeFromBlur);
    handle.addEventListener('lostpointercapture', endLostPointerCapture);
  }, [resizeLimits, stopResize]);

  const resizeFromKeyboard = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const panelBody = panelBodyRef.current;
    if (!panelBody) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = panelBody.getBoundingClientRect();
    const limits = resizeLimits(panelBody);
    const step = event.shiftKey ? 24 : 10;
    const widthDelta = event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0;
    const heightDelta = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    setSize({
      width: clamp(rect.width + widthDelta, limits.minWidth, limits.maxWidth),
      height: clamp(rect.height + heightDelta, limits.minHeight, limits.maxHeight),
    });
  }, [resizeLimits]);

  const closePopover = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const panel = event.currentTarget.closest<HTMLDetailsElement>('details[name="motif-cs-tools"]');
    if (!panel) return;
    panel.open = false;
    window.requestAnimationFrame(() => {
      panel.querySelector<HTMLElement>(':scope > summary')?.focus({ preventScroll: true });
    });
  };

  return (
    <>
      <div ref={titleRef} className="motif-cs-rail-popover-title">
        <strong>{title}</strong>
        <div className="motif-cs-rail-popover-actions">
          {meta ? <span>{meta}</span> : null}
          <button
            className="motif-cs-rail-popover-close"
            type="button"
            onClick={closePopover}
            aria-label={`Close ${title}`}
            title={`Close ${title}`}
            data-testid="rail-popover-close"
          >
            <X size={14} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      </div>
      {panelBody && resizeCorner ? createPortal(
        <button
          ref={resizeHandleRef}
          className="motif-cs-rail-popover-resize"
          type="button"
          onPointerDown={beginResize}
          onKeyDown={resizeFromKeyboard}
          onDoubleClick={() => setSize(null)}
          aria-label={`Resize ${title} panel. Left Arrow grows width; Right Arrow shrinks width; Up and Down Arrow change height.`}
          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
          title={`Resize ${title}; double-click to reset`}
          data-testid="rail-popover-resize"
          style={{ left: resizeCorner.left, top: resizeCorner.top }}
        />,
        panelBody,
      ) : null}
    </>
  );
}

function defaultFeatureColor(type: FeatureType): string {
  switch (type) {
    case 'cds':
    case 'gene':
      return '#3ddc97';
    case 'promoter':
    case 'regulatory':
      return '#4aa3ff';
    case 'terminator':
    case 'polyA_signal':
      return '#f472b6';
    case 'origin':
      return '#ad7bf9';
    case 'resistance':
      return '#ef4444';
    case 'restriction_site':
    case 'primer_bind':
      return '#f7c948';
    default:
      return '#9aa3b5';
  }
}

function EntryDetailsPanel({
  record,
  onUpdate,
  onConvertTopology,
  canConvertTopology,
  onDelete,
}: {
  record: ArtifactVector;
  onUpdate: (details: { name: string; description?: string; group?: string }) => void;
  onConvertTopology: (next: Topology) => void;
  canConvertTopology: boolean;
  onDelete: () => void;
}) {
  const [name, setName] = useState(record.name);
  const [description, setDescription] = useState(record.description ?? '');
  const [group, setGroup] = useState(record.group ?? '');

  useEffect(() => {
    setName(record.name);
    setDescription(record.description ?? '');
    setGroup(record.group ?? '');
  }, [record.description, record.group, record.id, record.name]);

  const dirty = name !== record.name || description !== (record.description ?? '') || group !== (record.group ?? '');
  const canUpdate = name.trim().length > 0 && dirty;

  const submit = useCallback(() => {
    if (!canUpdate) return;
    onUpdate({ name, description, group });
  }, [canUpdate, description, group, name, onUpdate]);

  const handleNameKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submit();
  }, [submit]);

  const handleDescriptionKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    submit();
  }, [submit]);

  return (
    <details className="motif-cs-panel motif-cs-entry-panel" name="motif-cs-tools" data-rail-tool="entry">
      <summary className="motif-cs-panel-head" data-rail-label="D" title="Entry details">
        <FileText className="motif-cs-panel-icon" size={14} strokeWidth={2.2} aria-hidden="true" />
        <span>Entry Details</span>
        <span className="motif-cs-chip">{dirty ? 'edited' : 'record'}</span>
      </summary>
      <div className="motif-cs-entry-form motif-cs-tool-panel-body">
        <RailPopoverTitle title="Entry Details" meta={dirty ? 'edited' : 'record'} />
        <label>
          <span>Name</span>
          <div className="motif-cs-name-edit-row">
            <input
              className="motif-cs-field"
              name="record-name"
              autoComplete="off"
              maxLength={MOTIF_MAX_SHORT_TEXT_LENGTH}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={handleNameKeyDown}
              aria-label="Entry name"
            />
            <button className="motif-cs-mini-button motif-cs-mini-button-accent" type="button" onClick={submit} disabled={!canUpdate}>
              Update
            </button>
          </div>
        </label>
        <label>
          <span>Description</span>
          <textarea
            className="motif-cs-textarea motif-cs-entry-description"
            name="record-description"
            autoComplete="off"
            maxLength={MOTIF_MAX_DESCRIPTION_LENGTH}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            onKeyDown={handleDescriptionKeyDown}
            aria-label="Entry description"
            rows={2}
          />
        </label>
        <label>
          <span>Project / group</span>
          <input
            className="motif-cs-field"
            name="record-group"
            autoComplete="off"
            maxLength={MOTIF_MAX_SHORT_TEXT_LENGTH}
            value={group}
            onChange={(event) => setGroup(event.target.value)}
            aria-label="Entry project or group"
            placeholder="Optional folder…"
          />
        </label>
        {/* Converting the molecule belongs with the fields that describe it, not
            in a panel called Map Visibility among controls that change only the
            picture. This edits the record, so it sits beside the ends — the
            other statement about the molecule's physical shape — and says what
            it costs, in the same voice as "Exports use this name." above. */}
        {canConvertTopology ? (
          <label>
            <span>Topology</span>
            <div className="motif-cs-segmented" role="group" aria-label="Convert molecule topology">
              <button
                type="button"
                data-active={record.topology === 'circular' || undefined}
                aria-pressed={record.topology === 'circular'}
                onClick={() => { if (record.topology !== 'circular') onConvertTopology('circular'); }}
              >
                ◯ Circular
              </button>
              <button
                type="button"
                data-active={record.topology === 'linear' || undefined}
                aria-pressed={record.topology === 'linear'}
                onClick={() => { if (record.topology !== 'linear') onConvertTopology('linear'); }}
              >
                — Linear
              </button>
            </div>
            <p className="motif-cs-form-note">
              Converting changes which restriction sites are found and what exported files record.
              To read this entry as a line without converting it, use Draw as in Map Visibility.
            </p>
          </label>
        ) : null}
        {record.type === 'dna' && (record.overhang5 !== undefined || record.overhang3 !== undefined) ? (
          <dl className="motif-cs-record-ends" aria-label="Physical DNA ends">
            <div>
              <dt>Left end</dt>
              <dd>{recordEndLabel(record.overhang5, record.overhang5Type)}</dd>
            </div>
            <div>
              <dt>Right end</dt>
              <dd>{recordEndLabel(record.overhang3, record.overhang3Type)}</dd>
            </div>
          </dl>
        ) : null}
        <p className="motif-cs-form-note">Exports use this name.</p>
        <div className="motif-cs-entry-delete-row">
          <span>
            <strong>Delete entry</strong>
            <small>Also removes linked notes, alignments, and saved results.</small>
          </span>
          <ConfirmDeleteButton
            noun={`entry ${record.name}`}
            idleLabel="Delete…"
            confirmLabel="Delete entry"
            className="motif-cs-danger-button"
            onConfirm={onDelete}
          />
        </div>
      </div>
    </details>
  );
}

function EditableRecordTitle({
  record,
  onUpdate,
}: {
  record: ArtifactVector;
  onUpdate: (details: { name: string; description?: string; group?: string }) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(record.name);

  useEffect(() => {
    setDraft(record.name);
    setEditing(false);
  }, [record.id, record.name]);

  useEffect(() => {
    if (!editing) return;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editing]);

  const commit = useCallback(() => {
    const nextName = draft.trim();
    if (nextName && nextName !== record.name) {
      onUpdate({ name: nextName, description: record.description, group: record.group });
    } else {
      setDraft(record.name);
    }
    setEditing(false);
  }, [draft, onUpdate, record.description, record.group, record.name]);

  const cancel = useCallback(() => {
    setDraft(record.name);
    setEditing(false);
  }, [record.name]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="motif-cs-title-edit"
        name="record-title"
        autoComplete="off"
        maxLength={MOTIF_MAX_SHORT_TEXT_LENGTH}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
          }
        }}
        aria-label="Entry name"
      />
    );
  }

  return (
    <h1>
      <button
        className="motif-cs-title-edit-trigger"
        type="button"
        onDoubleClick={() => setEditing(true)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== 'F2') return;
          event.preventDefault();
          setEditing(true);
        }}
        title="Double-click to rename this entry"
        aria-label={`${record.name}. Double-click to rename this entry.`}
      >
        {record.name}
      </button>
    </h1>
  );
}

function ConfirmDeleteButton({
  noun,
  disabled = false,
  idleLabel = 'Delete',
  confirmLabel = 'Delete?',
  className = '',
  onConfirm,
}: {
  noun: string;
  disabled?: boolean;
  idleLabel?: string;
  confirmLabel?: string;
  className?: string;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (disabled) setArmed(false);
  }, [disabled]);

  const activate = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    const fallback = event.currentTarget.closest<HTMLDetailsElement>('.motif-cs-annotation-editor-drawer')?.querySelector<HTMLElement>(':scope > summary')
      ?? event.currentTarget.closest<HTMLDetailsElement>('details[data-rail-tool]')?.querySelector<HTMLElement>(':scope > summary')
      ?? event.currentTarget.closest<HTMLElement>('.motif-cs-window')?.querySelector<HTMLElement>('.motif-cs-window-head');
    setArmed(false);
    onConfirm();
    window.requestAnimationFrame(() => fallback?.focus({ preventScroll: true }));
  }, [armed, disabled, onConfirm]);

  return (
    <button
      className={`motif-cs-mini-button motif-cs-confirm-delete ${className}`.trim()}
      type="button"
      data-armed={armed || undefined}
      disabled={disabled}
      onClick={activate}
      onBlur={() => setArmed(false)}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !armed) return;
        event.preventDefault();
        event.stopPropagation();
        setArmed(false);
      }}
      aria-label={armed ? `Confirm delete ${noun}` : `Delete ${noun}`}
      title={armed ? `Click again to delete ${noun}` : `Delete ${noun}`}
    >
      {armed ? confirmLabel : idleLabel}
    </button>
  );
}

function QuickFeatureEditor({
  sequenceLength,
  sequenceType,
  recordTranslationTableId,
  topology,
  featureCount,
  selectedFeature,
  selectedMapRange,
  motifStart,
  motifLength,
  embedded = false,
  onAddFeature,
  onUpdateFeature,
  onDeleteFeature,
  onCreateRecord,
  onCreateProteinRecord,
}: {
  sequenceLength: number;
  sequenceType: SequenceType;
  recordTranslationTableId?: number;
  topology: Topology;
  featureCount: number;
  selectedFeature: Feature | null;
  selectedMapRange: MapSelectionRange | null;
  motifStart?: number;
  motifLength: number;
  embedded?: boolean;
  onAddFeature: (feature: ArtifactFeatureInput) => void;
  onUpdateFeature: (featureId: string, feature: ArtifactFeatureInput) => void;
  onDeleteFeature: (featureId: string) => void;
  onCreateRecord: () => void;
  onCreateProteinRecord?: () => void;
}) {
  const [name, setName] = useState(() => `misc_feature_${featureCount + 1}`);
  const [type, setType] = useState<FeatureType>('misc_feature');
  const [start, setStart] = useState('1');
  const [end, setEnd] = useState(String(Math.min(sequenceLength, 60)));
  const [strand, setStrand] = useState<FeatureStrand>(sequenceType === 'protein' ? 0 : 1);
  const [codonStart, setCodonStart] = useState<1 | 2 | 3>(1);
  const [translationTableValue, setTranslationTableValue] = useState('');
  const [color, setColor] = useState(defaultFeatureColor('misc_feature'));
  const [formError, setFormError] = useState<string | null>(null);
  const translationTableMessageId = useId();
  const selectedFeatureHasSegments = !!selectedFeature && isMultipartFeature(selectedFeature);
  const selectedFeatureIsOrdered = !!selectedFeature && isOrderedFeatureLocation(selectedFeature);
  const selectedFeatureCannotMaterialize = !!selectedFeature && !isMaterializableFeatureLocation(selectedFeature);

  useEffect(() => {
    if (selectedFeature) return;
    setName(`misc_feature_${featureCount + 1}`);
    setType('misc_feature');
    setStart('1');
    setEnd(String(Math.min(sequenceLength, 60)));
    setStrand(sequenceType === 'protein' ? 0 : 1);
    setCodonStart(1);
    setTranslationTableValue('');
    setColor(defaultFeatureColor('misc_feature'));
    setFormError(null);
  }, [featureCount, selectedFeature, sequenceLength, sequenceType]);

  const applyRange = useCallback((rangeStart: number, rangeEnd: number) => {
    setStart(String(Math.max(1, Math.min(sequenceLength, rangeStart))));
    setEnd(String(Math.max(1, Math.min(sequenceLength, rangeEnd))));
    setFormError(null);
  }, [sequenceLength]);

  const useSelectedFeature = useCallback(() => {
    if (!selectedFeature) return;
    setName(selectedFeature.name);
    setType(selectedFeature.type);
    setColor(selectedFeature.color);
    setStrand(sequenceType === 'protein' ? 0 : selectedFeature.strand);
    setCodonStart((codonStartFrame(selectedFeature.metadata) + 1) as 1 | 2 | 3);
    setTranslationTableValue(artifactFeatureTranslationTableValue(selectedFeature.metadata));
    applyRange(selectedFeature.start + 1, selectedFeature.end);
  }, [applyRange, selectedFeature, sequenceType]);

  useEffect(() => {
    if (!selectedFeature) return;
    setName(selectedFeature.name);
    setType(selectedFeature.type);
    setColor(selectedFeature.color);
    setStrand(sequenceType === 'protein' ? 0 : selectedFeature.strand);
    setCodonStart((codonStartFrame(selectedFeature.metadata) + 1) as 1 | 2 | 3);
    setTranslationTableValue(artifactFeatureTranslationTableValue(selectedFeature.metadata));
    applyRange(selectedFeature.start + 1, selectedFeature.end);
  }, [applyRange, selectedFeature, sequenceType]);

  useEffect(() => {
    if (selectedFeature || !selectedMapRange) return;
    const wrappedEnd = selectedMapRange.end > sequenceLength
      ? selectedMapRange.end - sequenceLength
      : selectedMapRange.end;
    applyRange(selectedMapRange.start + 1, wrappedEnd || sequenceLength);
  }, [applyRange, selectedFeature, selectedMapRange, sequenceLength]);

  const useMotifHit = useCallback(() => {
    if (motifStart === undefined || motifLength <= 0) return;
    applyRange(motifStart + 1, motifStart + motifLength);
  }, [applyRange, motifLength, motifStart]);

  const useMapRange = useCallback(() => {
    if (!selectedMapRange) return;
    const wrappedEnd = selectedMapRange.end > sequenceLength
      ? selectedMapRange.end - sequenceLength
      : selectedMapRange.end;
    applyRange(selectedMapRange.start + 1, wrappedEnd || sequenceLength);
  }, [applyRange, selectedMapRange, sequenceLength]);

  const handleTypeChange = useCallback((nextType: FeatureType) => {
    setType(nextType);
    setColor(defaultFeatureColor(nextType));
    if (name.startsWith('misc_feature_') || featureTypeOptions.some((option) => name.startsWith(`${option}_`))) {
      setName(`${nextType}_${featureCount + 1}`);
    }
  }, [featureCount, name]);

  const rangeValidation = useMemo(() => {
    const startNumber = Number(start);
    const endNumber = Number(end);
    if (!Number.isFinite(startNumber) || !Number.isFinite(endNumber)) {
      return { valid: false as const, message: 'Enter numeric start and end positions.' };
    }
    const startIndex1 = Math.floor(startNumber);
    const endIndex1 = Math.floor(endNumber);
    if (startIndex1 < 1 || endIndex1 < 1 || startIndex1 > sequenceLength || endIndex1 > sequenceLength) {
      return { valid: false as const, message: `Range must stay within 1-${sequenceLength}.` };
    }
    const wraps = topology === 'circular' && endIndex1 < startIndex1;
    if (endIndex1 < startIndex1 && !wraps) {
      return { valid: false as const, message: 'End must be greater than or equal to start.' };
    }
    if (wraps) {
      const subRanges = normalizeSpan(startIndex1 - 1, endIndex1, sequenceLength, topology);
      if (subRanges.length < 2) {
        return { valid: false as const, message: 'Wrapped range could not be resolved on this circular record.' };
      }
      return {
        valid: true as const,
        startIndex: Math.min(...subRanges.map((range) => range.start)),
        endIndex: Math.max(...subRanges.map((range) => range.end)),
        subRanges,
      };
    }
    return {
      valid: true as const,
      startIndex: startIndex1 - 1,
      endIndex: endIndex1,
      subRanges: undefined,
    };
  }, [end, sequenceLength, start, topology]);

  useEffect(() => {
    if (rangeValidation.valid && formError) setFormError(null);
  }, [formError, rangeValidation.valid]);

  const featureFromForm = useCallback((): ArtifactFeatureInput | null => {
    if (!rangeValidation.valid) return null;
    const metadata: Record<string, unknown> = selectedFeature?.metadata && typeof selectedFeature.metadata === 'object'
      ? { ...selectedFeature.metadata }
      : {};
    metadata.source = metadata.source ?? 'claude_science_artifact_manual';
    if (isNucleotideType(sequenceType) && CODING_FEATURE_TYPES.has(type)) {
      metadata.codon_start = codonStart;
      delete metadata.codonStart;
    } else {
      delete metadata.codon_start;
      delete metadata.codonStart;
    }
    if (isNucleotideType(sequenceType) && TRANSLATION_CODE_FEATURE_TYPES.has(type)) {
      if (translationTableValue === '') {
        delete metadata.transl_table;
        delete metadata.translTable;
        delete metadata.translationTableId;
      } else {
        const translationTableId = normalizeArtifactTranslationTableId(translationTableValue);
        if (translationTableId !== null) {
          metadata.transl_table = translationTableId;
          delete metadata.translTable;
          delete metadata.translationTableId;
        }
      }
    }
    if (rangeValidation.subRanges) {
      metadata.motifSubRangeOrder = 'biological';
      delete metadata.motifSubRangeOrderAmbiguous;
    }
    return {
      name: name.trim() || `${type}_${featureCount + 1}`,
      type,
      start: rangeValidation.startIndex,
      end: rangeValidation.endIndex,
      strand: sequenceType === 'protein' ? 0 : strand,
      color,
      metadata,
      subRanges: selectedFeatureHasSegments
        ? selectedFeature?.subRanges?.map((range) => ({ ...range }))
        : rangeValidation.subRanges
          ? (strand === -1 ? [...rangeValidation.subRanges].reverse() : rangeValidation.subRanges)
            .map((range) => ({ ...range, strand }))
          : undefined,
    };
  }, [codonStart, color, featureCount, name, rangeValidation, selectedFeature?.metadata, selectedFeature?.subRanges, selectedFeatureHasSegments, sequenceType, strand, translationTableValue, type]);

  const submit = useCallback(() => {
    if (!rangeValidation.valid) {
      setFormError(rangeValidation.message);
      return;
    }
    const feature = featureFromForm();
    if (!feature) return;
    onAddFeature(feature);
    const endIndex = Number(feature.end ?? 0);
    setFormError(null);
    setName(`${type}_${featureCount + 2}`);
    setStart(String(Math.min(sequenceLength, endIndex + 1)));
    setEnd(String(Math.min(sequenceLength, endIndex + 60)));
  }, [featureCount, featureFromForm, onAddFeature, rangeValidation, sequenceLength, type]);

  const updateSelected = useCallback(() => {
    if (!selectedFeature) return;
    if (!rangeValidation.valid) {
      setFormError(rangeValidation.message);
      return;
    }
    const feature = featureFromForm();
    if (!feature) return;
    setFormError(null);
    onUpdateFeature(selectedFeature.id, feature);
  }, [featureFromForm, onUpdateFeature, rangeValidation, selectedFeature]);

  const handleNameKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || !selectedFeature) return;
    event.preventDefault();
    updateSelected();
  }, [selectedFeature, updateSelected]);

  const deleteSelected = useCallback(() => {
    if (!selectedFeature) return;
    onDeleteFeature(selectedFeature.id);
  }, [onDeleteFeature, selectedFeature]);

  const canUseMotif = motifStart !== undefined && motifLength > 0;
  const canUseMapRange = !!selectedMapRange && !selectedFeatureHasSegments;
  const rangeErrorMessage = formError ?? (!rangeValidation.valid ? rangeValidation.message : null);
  const showTranslationMetadata = isNucleotideType(sequenceType) && CODING_FEATURE_TYPES.has(type);
  const supportsFeatureTranslationCode = isNucleotideType(sequenceType) && TRANSLATION_CODE_FEATURE_TYPES.has(type);
  const recordTranslationCode = resolveArtifactTranslationCode(recordTranslationTableId);
  const unsupportedTranslationTableValue = supportsFeatureTranslationCode && translationTableValue
    && normalizeArtifactTranslationTableId(translationTableValue) === null
      ? translationTableValue
      : null;

  const editor = (
    <div className="motif-cs-feature-form motif-cs-tool-panel-body">
        <label>
          <span>Name</span>
          <div className="motif-cs-name-edit-row">
            <input
              className="motif-cs-field"
              name="feature-name"
              autoComplete="off"
              maxLength={MOTIF_MAX_SHORT_TEXT_LENGTH}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={handleNameKeyDown}
            />
            {selectedFeature ? (
              <button className="motif-cs-mini-button motif-cs-mini-button-accent" type="button" onClick={updateSelected} disabled={!rangeValidation.valid} title="Update selected feature">Update</button>
            ) : null}
          </div>
        </label>
        <div className="motif-cs-form-grid">
          <label>
            <span>Type</span>
            <select className="motif-cs-field" name="feature-type" value={type} onChange={(event) => handleTypeChange(event.target.value as FeatureType)}>
              {featureTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label>
            <span>Strand</span>
            <select
              className="motif-cs-field"
              name="feature-strand"
              value={String(sequenceType === 'protein' ? 0 : strand)}
              onChange={(event) => setStrand(Number(event.target.value) as FeatureStrand)}
              disabled={sequenceType === 'protein' || selectedFeatureHasSegments}
            >
              {sequenceType === 'protein' ? (
                <option value="0">none</option>
              ) : (
                <>
                  <option value="1">forward</option>
                  <option value="-1">reverse</option>
                  <option value="0">none</option>
                </>
              )}
            </select>
          </label>
        </div>
        {showTranslationMetadata ? (
          <div className="motif-cs-feature-translation-meta">
            <label>
              <span>AA frame</span>
              <select
                className="motif-cs-field"
                name="feature-codon-start"
                value={String(codonStart)}
                onChange={(event) => setCodonStart(Number(event.target.value) as 1 | 2 | 3)}
                title="Set the codon_start metadata for this feature-derived amino-acid track"
              >
                <option value="1">+1</option>
                <option value="2">+2</option>
                <option value="3">+3</option>
              </select>
            </label>
            {supportsFeatureTranslationCode ? (
              <label>
                <span>Genetic code</span>
                <select
                  className="motif-cs-field"
                  name="feature-translation-table"
                  value={translationTableValue}
                  onChange={(event) => setTranslationTableValue(event.target.value)}
                  title="Set the feature /transl_table qualifier, or inherit the record default"
                  aria-invalid={!!unsupportedTranslationTableValue || undefined}
                  aria-describedby={translationTableMessageId}
                >
                  <option value="">
                    Inherit record ({recordTranslationCode.supported ? `table ${recordTranslationCode.id}` : 'unavailable'})
                  </option>
                  {unsupportedTranslationTableValue ? (
                    <option value={unsupportedTranslationTableValue} disabled>
                      {unsupportedTranslationTableValue === '__invalid__'
                        ? 'Malformed imported qualifier (preserved)'
                        : `Table ${unsupportedTranslationTableValue} unsupported (preserved)`}
                    </option>
                  ) : null}
                  {ARTIFACT_TRANSLATION_CODE_OPTIONS.map((option) => (
                    <option key={option.id} value={String(option.id)}>{option.id} — {option.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <span id={translationTableMessageId} role={unsupportedTranslationTableValue ? 'alert' : undefined}>
              feature translation · codon_start {codonStart}{supportsFeatureTranslationCode
                ? ` · ${translationTableValue
                    ? `feature table ${translationTableValue === '__invalid__' ? 'invalid' : translationTableValue}`
                    : `record table ${recordTranslationCode.supported ? recordTranslationCode.id : 'unavailable'}`}`
                : ' · record genetic code'}
            </span>
          </div>
        ) : null}
        <div className="motif-cs-form-grid motif-cs-form-grid-compact">
          <label>
            <span>Start</span>
            <input className="motif-cs-field" name="feature-start" type="number" inputMode="numeric" autoComplete="off" min="1" max={sequenceLength} value={start} onChange={(event) => setStart(event.target.value)} disabled={selectedFeatureHasSegments} aria-invalid={!rangeValidation.valid || undefined} aria-describedby={!rangeValidation.valid ? 'motif-cs-feature-range-error' : undefined} />
          </label>
          <label>
            <span>End</span>
            <input className="motif-cs-field" name="feature-end" type="number" inputMode="numeric" autoComplete="off" min="1" max={sequenceLength} value={end} onChange={(event) => setEnd(event.target.value)} disabled={selectedFeatureHasSegments} aria-invalid={!rangeValidation.valid || undefined} aria-describedby={!rangeValidation.valid ? 'motif-cs-feature-range-error' : undefined} />
          </label>
          <label>
            <span>Color</span>
            <input className="motif-cs-color-field" name="feature-color" type="color" value={color} onChange={(event) => setColor(event.target.value)} aria-label="Feature color" />
          </label>
        </div>
        <div className="motif-cs-layer-actions motif-cs-layer-actions-flush">
          {selectedFeature ? (
            <button className="motif-cs-mini-button" type="button" onClick={submit} disabled={!rangeValidation.valid} title="Create a new feature from the current form values">Add copy</button>
          ) : (
            <button className="motif-cs-mini-button" type="button" onClick={submit} disabled={!rangeValidation.valid}>Add</button>
          )}
          <button className="motif-cs-mini-button" type="button" onClick={useSelectedFeature} disabled={!selectedFeature} title="Reload selected feature into the editor">Reload</button>
          <ConfirmDeleteButton
            key={selectedFeature?.id ?? 'no-feature'}
            noun="selected feature"
            disabled={!selectedFeature}
            onConfirm={deleteSelected}
          />
          <button
            className="motif-cs-mini-button"
            type="button"
            onClick={onCreateRecord}
            disabled={!selectedFeature || selectedFeatureCannotMaterialize}
            title={selectedFeatureIsOrdered
              ? 'INSDC order(...) does not imply that segments can be joined into one sequence'
              : selectedFeature && isAmbiguousFeatureLocation(selectedFeature)
                ? 'Confirm the biological order of this legacy reverse multipart location before extracting it'
                : 'Extract the selected feature as a new inventory entry'}
          >New record</button>
          {onCreateProteinRecord ? <button className="motif-cs-mini-button" type="button" onClick={onCreateProteinRecord}>New protein</button> : null}
          <button className="motif-cs-mini-button" type="button" onClick={useMapRange} disabled={!canUseMapRange}>Use map</button>
          <button className="motif-cs-mini-button" type="button" onClick={useMotifHit} disabled={!canUseMotif}>Use pattern</button>
        </div>
        {rangeErrorMessage ? (
          <p id="motif-cs-feature-range-error" className="motif-cs-form-note" role="alert">{rangeErrorMessage}</p>
        ) : null}
        {selectedFeatureHasSegments && selectedFeature ? (
          <p className="motif-cs-form-note">
            Multipart location · {featureRangeLabel(selectedFeature)} · {featureLocationLength(selectedFeature).toLocaleString()} {sequenceUnitLabel(sequenceType)}. Update preserves its segment coordinates and orientation; create a new contiguous feature to replace them.
            {isAmbiguousFeatureLocation(selectedFeature) ? ' This legacy reverse location has no reliable segment-order marker, so sequence extraction and translation remain unavailable.' : ''}
          </p>
        ) : selectedMapRange && selectedMapRange.end > sequenceLength ? (
          <p className="motif-cs-form-note">This range wraps the origin. Motif will save it as two joined segments in biological order.</p>
        ) : topology === 'circular' ? (
          <p className="motif-cs-form-note">For an origin-wrapping feature, enter an End position lower than Start.</p>
        ) : null}
      </div>
  );

  if (embedded) {
    return (
      <div className="motif-cs-annotation-editor">
        <div className="motif-cs-annotation-section-label">
          {selectedFeature && showTranslationMetadata ? 'Edit feature translation' : selectedFeature ? 'Edit selected feature' : selectedMapRange ? 'Add feature from range' : 'Add feature'}
        </div>
        {editor}
      </div>
    );
  }

  return (
    <details className="motif-cs-panel" name="motif-cs-tools" data-rail-tool="feature-editor">
      <summary className="motif-cs-panel-head" data-rail-label="+" title="Add or edit feature">
        <Plus className="motif-cs-panel-icon" size={14} strokeWidth={2.3} aria-hidden="true" />
        <span>Add / Edit Feature</span>
        <span className="motif-cs-chip">{selectedFeature ? 'selected' : selectedMapRange ? 'range' : 'local'}</span>
      </summary>
      {editor}
    </details>
  );
}

function TranslationLayerEditor({
  sequenceLength,
  topology,
  track,
  onUpdate,
  onDelete,
  onAddRecord,
}: {
  sequenceLength: number;
  topology: Topology;
  track: InlineTranslationTrack;
  onUpdate: (trackId: string, patch: Partial<Omit<InlineTranslationTrack, 'id' | 'source'>>) => void;
  onDelete: (trackId: string) => void;
  onAddRecord: () => void;
}) {
  const [label, setLabel] = useState(track.label);
  const [strand, setStrand] = useState<1 | -1>(track.strand);
  const [frame, setFrame] = useState<0 | 1 | 2>(track.frame);
  const [translationTableId, setTranslationTableId] = useState(track.translationTableId);
  const [start, setStart] = useState(String(track.start + 1));
  const [end, setEnd] = useState(String(track.end > sequenceLength ? ((track.end - 1) % sequenceLength) + 1 : track.end));
  const [color, setColor] = useState(track.color ?? (track.strand === -1 ? '#c6737b' : '#7e9bbf'));

  useEffect(() => {
    setLabel(track.label);
    setStrand(track.strand);
    setFrame(track.frame);
    setTranslationTableId(track.translationTableId);
    setStart(String(track.start + 1));
    setEnd(String(track.end > sequenceLength ? ((track.end - 1) % sequenceLength) + 1 : track.end));
    setColor(track.color ?? (track.strand === -1 ? '#c6737b' : '#7e9bbf'));
  }, [sequenceLength, track]);

  const rangeValidation = useMemo(() => {
    const startNumber = Number(start);
    const endNumber = Number(end);
    if (!Number.isFinite(startNumber) || !Number.isFinite(endNumber)) {
      return { valid: false as const, message: 'Enter numeric start and end positions.' };
    }
    const startIndex1 = Math.floor(startNumber);
    const endIndex1 = Math.floor(endNumber);
    if (startIndex1 < 1 || endIndex1 < 1 || startIndex1 > sequenceLength || endIndex1 > sequenceLength) {
      return { valid: false as const, message: `Range must stay within 1-${sequenceLength}.` };
    }
    if (endIndex1 < startIndex1 && topology !== 'circular') {
      return { valid: false as const, message: 'End must be greater than or equal to start.' };
    }
    const internalEndIndex = endIndex1 < startIndex1 ? sequenceLength + endIndex1 : endIndex1;
    if (internalEndIndex - (startIndex1 - 1) < 3) {
      return { valid: false as const, message: 'Translation layers need at least 3 bases.' };
    }
    return {
      valid: true as const,
      startIndex: startIndex1 - 1,
      endIndex: internalEndIndex,
    };
  }, [end, sequenceLength, start, topology]);

  const update = useCallback(() => {
    if (!rangeValidation.valid) return;
    const translationAnchorChanged = track.start !== rangeValidation.startIndex
      || track.end !== rangeValidation.endIndex
      || track.strand !== strand
      || track.frame !== frame;
    const resetCapturedFeatureSemantics = track.needsReview || translationAnchorChanged;
    onUpdate(track.id, {
      label: label.trim() || track.label,
      strand,
      frame,
      translationTableId,
      start: rangeValidation.startIndex,
      end: rangeValidation.endIndex,
      color,
      ...(resetCapturedFeatureSemantics ? { completeCds: false, featureId: undefined } : {}),
    });
  }, [color, frame, label, onUpdate, rangeValidation, strand, track.end, track.frame, track.id, track.label, track.needsReview, track.start, track.strand, translationTableId]);

  const handleLabelKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    update();
  }, [update]);

  return (
    <div className="motif-cs-annotation-editor">
      <div className="motif-cs-annotation-section-label">Edit translation</div>
      <div className="motif-cs-feature-form motif-cs-tool-panel-body">
        {track.needsReview ? (
          <p className="motif-cs-form-note" role="status">
            Its source sequence or feature semantics changed. Review the range, strand, and frame; Update converts it to an independent range translation.
          </p>
        ) : null}
        <label>
          <span>Label</span>
          <div className="motif-cs-name-edit-row">
            <input
              className="motif-cs-field"
              name="translation-label"
              autoComplete="off"
              maxLength={MAX_TRANSLATION_LAYER_TEXT_LENGTH}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              onKeyDown={handleLabelKeyDown}
            />
            <button className="motif-cs-mini-button motif-cs-mini-button-accent" type="button" onClick={update} disabled={!rangeValidation.valid}>Update</button>
          </div>
        </label>
        <div className="motif-cs-form-grid">
          <label>
            <span>Strand</span>
            <select className="motif-cs-field" name="translation-strand" value={String(strand)} onChange={(event) => setStrand(Number(event.target.value) === -1 ? -1 : 1)}>
              <option value="1">sense</option>
              <option value="-1">antisense</option>
            </select>
          </label>
          <label>
            <span>Frame</span>
            <select className="motif-cs-field" name="translation-frame" value={String(frame)} onChange={(event) => setFrame(Number(event.target.value) as 0 | 1 | 2)}>
              <option value="0">+1</option>
              <option value="1">+2</option>
              <option value="2">+3</option>
            </select>
          </label>
          <label>
            <span>Genetic code</span>
            <select
              className="motif-cs-field"
              name="translation-layer-table"
              value={String(translationTableId)}
              onChange={(event) => setTranslationTableId(Number(event.target.value))}
            >
              {ARTIFACT_TRANSLATION_CODE_OPTIONS.map((option) => (
                <option key={option.id} value={String(option.id)}>{option.id} — {option.name}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="motif-cs-form-grid motif-cs-form-grid-compact">
          <label>
            <span>Start</span>
            <input className="motif-cs-field" name="translation-start" type="number" inputMode="numeric" autoComplete="off" min="1" max={sequenceLength} value={start} onChange={(event) => setStart(event.target.value)} aria-invalid={!rangeValidation.valid || undefined} aria-describedby={!rangeValidation.valid ? 'motif-cs-translation-range-error' : undefined} />
          </label>
          <label>
            <span>End</span>
            <input className="motif-cs-field" name="translation-end" type="number" inputMode="numeric" autoComplete="off" min="1" max={sequenceLength} value={end} onChange={(event) => setEnd(event.target.value)} aria-invalid={!rangeValidation.valid || undefined} aria-describedby={!rangeValidation.valid ? 'motif-cs-translation-range-error' : undefined} />
          </label>
          <label>
            <span>Color</span>
            <input className="motif-cs-color-field" name="translation-color" type="color" value={color} onChange={(event) => setColor(event.target.value)} aria-label="Translation color" />
          </label>
        </div>
        <div className="motif-cs-layer-actions motif-cs-layer-actions-flush">
          <button className="motif-cs-mini-button motif-cs-mini-button-accent" type="button" onClick={update} disabled={!rangeValidation.valid}>Update</button>
          <ConfirmDeleteButton
            key={track.id}
            noun="translation layer"
            onConfirm={() => onDelete(track.id)}
          />
          <button className="motif-cs-mini-button" type="button" onClick={onAddRecord} disabled={!!track.needsReview}>New protein</button>
        </div>
        {!rangeValidation.valid ? (
          <p id="motif-cs-translation-range-error" className="motif-cs-form-note" role="alert">{rangeValidation.message}</p>
        ) : (
          <p className="motif-cs-form-note">Pinned amino-acid layer · {strand === -1 ? 'antisense' : 'sense'} frame {frame + 1} · NCBI table {translationTableId}</p>
        )}
      </div>
    </div>
  );
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMass(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} MDa`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)} kDa`;
  return `${value.toFixed(2)} Da`;
}

function orfRangeLabel(orf: ORF, sequenceLength: number): string {
  const wraps = orf.end > sequenceLength;
  const end = wraps ? ((orf.end - 1) % sequenceLength) + 1 : orf.end;
  return `${orf.start + 1}-${end}${wraps ? ' wrap' : ''}`;
}

function AnalysisPanel({
  record,
  sequenceType,
  topology,
  onCopy,
  onAddFeature,
  onSelectRange,
  onTranslationCodeChange,
}: {
  record: ArtifactVector;
  sequenceType: SequenceType;
  topology: Topology;
  onCopy: (label: string, value: string) => void;
  onAddFeature: (feature: ArtifactFeatureInput) => void;
  onSelectRange: (start: number, end: number) => void;
  onTranslationCodeChange: (translationTableId: number) => void;
}) {
  const isNucleotide = isNucleotideType(sequenceType);
  const translationCode = useMemo(
    () => resolveArtifactTranslationCode(record.translationTableId),
    [record.translationTableId],
  );
  const composition = useMemo(() => isNucleotide ? nucleotideComposition(record.sequence) : null, [isNucleotide, record.sequence]);
  const allOrfs = useMemo(
    () => isNucleotide && translationCode.supported
      ? findORFs(record.sequence, ANALYSIS_ORF_MIN_AA, translationCode.table, { topology })
      : [],
    [isNucleotide, record.sequence, topology, translationCode],
  );
  const visibleOrfs = useMemo(() => allOrfs.slice(0, 8), [allOrfs]);
  // findORFs emits one entry per START codon, so every in-frame start upstream
  // of the same stop is counted again. On pUC19 that is 221 entries over 159
  // distinct (strand, stop) reading frames — and four of the eight rows this
  // panel lists are the same reverse-strand frame entered at four different
  // starts. Read off the SAME array the list renders from, so the note and the
  // rows cannot drift into disagreeing about one quantity.
  const orfReadingFrameCount = useMemo(
    () => new Set(allOrfs.map((orf) => `${orf.strand}:${orf.end}`)).size,
    [allOrfs],
  );
  // Read the start codons off the table the scan actually used. This panel has
  // a "Record genetic code" select right below it, and the tables disagree —
  // the standard one initiates at ATG/TTG/CTG, vertebrate mitochondrial at
  // ATT/ATC/ATA/ATG/GTG — so naming a fixed set here would have been one more
  // readout that is true of some other configuration than the one on screen.
  const orfStartCodons = useMemo(
    () => (translationCode.supported ? [...translationCode.table.starts].sort().join(', ') : ''),
    [translationCode],
  );
  const mw = useMemo(
    () => sequenceType === 'protein' ? proteinMolecularWeight(record.sequence) : molecularWeight(record.sequence),
    [record.sequence, sequenceType],
  );
  const tm = useMemo(() => isNucleotide ? meltingTemperature(record.sequence) : null, [isNucleotide, record.sequence]);
  const gc = useMemo(() => isNucleotide ? gcContent(record.sequence) : 0, [isNucleotide, record.sequence]);
  const statsText = useMemo(() => JSON.stringify({
    id: record.id,
    name: record.name,
    molecule: sequenceType,
    topology,
    length: record.sequence.length,
    gc: isNucleotide ? gc : undefined,
    tm,
    molecularWeight: mw,
    composition,
    orfCount: allOrfs.length,
    translationTable: isNucleotide && translationCode.supported
      ? { id: translationCode.id, name: translationCode.name }
      : undefined,
    orfsShown: visibleOrfs.map((orf) => ({
      start: orf.start,
      end: orf.end,
      frame: orf.frame,
      strand: orf.strand,
      aminoAcids: orf.aminoAcids,
    })),
  }, null, 2), [allOrfs.length, composition, gc, isNucleotide, mw, record.id, record.name, record.sequence.length, sequenceType, tm, topology, translationCode, visibleOrfs]);

  return (
    <details className="motif-cs-panel" name="motif-cs-tools" data-rail-tool="analysis">
      <summary className="motif-cs-panel-head" data-rail-label="A" title="Analysis">
        <Activity className="motif-cs-panel-icon" size={14} strokeWidth={2.2} aria-hidden="true" />
        <span>Analysis</span>
        <span className="motif-cs-chip">{isNucleotide ? `${allOrfs.length} ORFs ≥${ANALYSIS_ORF_MIN_AA} aa` : 'protein'}</span>
      </summary>
      <div className="motif-cs-tool-panel-body">
        <RailPopoverTitle title="Analysis" meta={isNucleotide ? `${allOrfs.length} ORFs ≥${ANALYSIS_ORF_MIN_AA} aa` : 'protein'} />
        <div className="motif-cs-stat-grid">
          <div className="motif-cs-stat"><span>Length</span><strong>{sequenceLengthLabel(record.sequence.length, sequenceType)}</strong></div>
          <div className="motif-cs-stat"><span>Mass</span><strong>{formatMass(mw)}</strong></div>
          {isNucleotide ? (
            <>
              <div className="motif-cs-stat"><span>GC</span><strong>{formatPercent(gc)}</strong></div>
              <div className="motif-cs-stat"><span>Tm</span><strong>{tm === null ? 'n/a' : `${tm.toFixed(1)} C`}</strong></div>
            </>
          ) : null}
        </div>
        <div className="motif-cs-layer-actions">
          <button className="motif-cs-mini-button" type="button" onClick={() => onCopy('Analysis JSON', statsText)}>Copy stats</button>
          {composition ? (
            <span className="motif-cs-muted">A {composition.A} · C {composition.C} · G {composition.G} · T {composition.T + (composition.U ?? 0)} · N {composition.N}</span>
          ) : null}
        </div>
        {isNucleotide ? (
          <>
          <label className="motif-cs-analysis-code-field">
            <span>Record genetic code</span>
            <select
              className="motif-cs-field"
              name="analysis-translation-table"
              value={translationCode.supported ? String(translationCode.id) : ''}
              onChange={(event) => onTranslationCodeChange(Number(event.target.value))}
            >
              {ARTIFACT_TRANSLATION_CODE_OPTIONS.map((option) => (
                <option key={option.id} value={String(option.id)}>{option.id} — {option.name}</option>
              ))}
            </select>
          </label>
          <div className="motif-cs-list">
            {allOrfs.length > visibleOrfs.length ? (
              /* The chip can only carry the floor; this is where the count's
                 definition fits, and it is the number's whole meaning. "221
                 ORFs" on a 2.6 kb vector reads as a result about the molecule
                 when it is a result about the scan: a 10 aa floor, six frames,
                 and the standard table's near-cognate starts, of which only 76
                 of the 221 are ATG. The reading-frame figure is the honest
                 denominator — entering one stop from several in-frame starts
                 makes several entries, which is why the eight rows below
                 include the same reverse-strand frame four times. */
              <p className="motif-cs-form-note">
                Showing the 8 longest of {allOrfs.length} start-to-stop intervals ≥{ANALYSIS_ORF_MIN_AA} aa
                across {orfReadingFrameCount} distinct reading frames — six frames, both strands,
                starting at {orfStartCodons}, so one frame entered at several starts appears more
                than once.
              </p>
            ) : null}
            {visibleOrfs.length > 0 ? visibleOrfs.map((orf, index) => {
              const wraps = orf.end > record.sequence.length;
              const spans = normalizeSpan(orf.start, orf.end, record.sequence.length, topology);
              const featureStart = spans.length > 0 ? Math.min(...spans.map((span) => span.start)) : orf.start;
              const featureEnd = spans.length > 0 ? Math.max(...spans.map((span) => span.end)) : Math.min(orf.end, record.sequence.length);
              return (
                <div key={`${orf.strand}:${orf.frame}:${orf.start}:${orf.end}`} className="motif-cs-analysis-row">
                  <button
                    className="motif-cs-row-main motif-cs-orf-select"
                    type="button"
                    title={wraps ? 'Wrap-spanning ORF' : 'Highlight this ORF on the sequence and map'}
                    onClick={() => onSelectRange(orf.start, orf.end)}
                  >
                    ORF {index + 1} · {orf.strand === -1 ? '-' : '+'}{orf.frame}
                    <small>{orfRangeLabel(orf, record.sequence.length)} · {orf.aminoAcids} aa · {orf.startCodon} to {orf.stopCodon}</small>
                  </button>
                  <button
                    className="motif-cs-mini-button"
                    type="button"
                    title={wraps ? 'Add origin-spanning ORF as a two-segment feature' : 'Add ORF as feature'}
                    onClick={() => onAddFeature({
                      name: `ORF ${index + 1}`,
                      type: 'orf',
                      start: featureStart,
                      end: featureEnd,
                      strand: orf.strand,
                      subRanges: spans.length > 1
                        ? (orf.strand === -1 ? [...spans].reverse() : spans)
                          .map((span) => ({ ...span, strand: orf.strand }))
                        : undefined,
                      color: defaultFeatureColor('orf'),
                      metadata: {
                        source: 'motif_orf_detection',
                        frame: orf.frame,
                        codon_start: 1,
                        ...(translationCode.supported ? { transl_table: translationCode.id } : {}),
                        aminoAcids: orf.aminoAcids,
                        ...(spans.length > 1 ? { motifSubRangeOrder: 'biological' } : {}),
                      },
                    })}
                  >
                    Add
                  </button>
                </div>
              );
            }) : (
              <p className="motif-cs-muted">No ORFs above the artifact threshold.</p>
            )}
          </div>
          </>
        ) : (
          <p className="motif-cs-muted">Protein records show chain-level stats here; translation is available from nucleotide records.</p>
        )}
      </div>
    </details>
  );
}

function digestFragmentRangeLabel(fragment: DigestFragment, sequenceLength: number): string {
  const start = fragment.startInOriginal + 1;
  if (fragment.endInOriginal <= sequenceLength) return `${start}-${fragment.endInOriginal}`;
  const wrappedEnd = fragment.endInOriginal - sequenceLength;
  return `${start}-${sequenceLength} / 1-${wrappedEnd} (wrap)`;
}

function digestRows(fragments: readonly DigestFragment[], sequenceLength: number): string {
  return [
    ['index', 'length', 'range', 'leftEnzyme', 'rightEnzyme', 'overhang5', 'overhang3'].join('\t'),
    ...fragments.map((fragment, index) => [
      index + 1,
      fragment.length,
      digestFragmentRangeLabel(fragment, sequenceLength),
      fragment.leftEnzyme ?? '',
      fragment.rightEnzyme ?? '',
      fragment.overhang5,
      fragment.overhang3,
    ].join('\t')),
  ].join('\n');
}

function downloadTextFile(filename: string, content: string, mime = 'text/plain'): BrowserDownloadReceipt {
  return requestBrowserTextDownload(filename, content, mime);
}

function downloadBlobFile(filename: string, blob: Blob): BrowserDownloadReceipt {
  return requestBrowserBlobDownload(filename, blob);
}

function printHtmlReport(html: string): void {
  const fallbackDownload = () => downloadTextFile('motif-inventory-report.html', html, 'text/html');
  try {
    const frame = document.createElement('iframe');
    frame.title = 'Motif printable inventory report';
    // Keep report content script-disabled. `allow-same-origin` lets this parent
    // invoke print() on the srcdoc frame; without it the opaque-origin Window
    // blocks access and the Print / PDF action silently degrades to a download.
    frame.setAttribute('sandbox', 'allow-modals allow-same-origin');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.style.opacity = '0';
    frame.setAttribute('aria-hidden', 'true');
    let loaded = false;
    frame.addEventListener('load', () => {
      loaded = true;
      const printWindow = frame.contentWindow;
      if (!printWindow) {
        frame.remove();
        fallbackDownload();
        return;
      }
      window.setTimeout(() => {
        try {
          printWindow.focus();
          printWindow.print();
          window.setTimeout(() => frame.remove(), 1000);
        } catch {
          frame.remove();
          fallbackDownload();
        }
      }, 150);
    }, { once: true });
    frame.srcdoc = html;
    document.body.appendChild(frame);
    window.setTimeout(() => {
      if (!loaded && frame.isConnected) {
        frame.remove();
        fallbackDownload();
      }
    }, 3000);
  } catch {
    fallbackDownload();
  }
}

function DigestPanel({
  record,
  sequenceType,
  topology,
  enzymeCatalog,
  visibleMapEnzymes,
  workflowResults,
  inputSha256,
  onOpen,
  onCopy,
  onSave,
  onOpenGel,
  onSelectRange,
}: {
  record: ArtifactVector;
  sequenceType: SequenceType;
  topology: Topology;
  enzymeCatalog: readonly RestrictionEnzyme[];
  visibleMapEnzymes: readonly RestrictionEnzyme[];
  workflowResults: readonly ArtifactWorkflowResult[];
  inputSha256?: string;
  onOpen?: () => void;
  onCopy: (label: string, value: string) => void;
  onSave: (recipe: DigestRecipe) => DigestSaveReceipt | null;
  onOpenGel: (digestWorkflowResultId: string) => void;
  onSelectRange: (start: number, end: number) => void;
}) {
  const isDna = sequenceType === 'dna';
  const defaultEnzymes = useMemo(() => {
    const injected = Array.from(new Set(record.sites.map((site) => site.enzyme))).slice(0, 3);
    if (injected.length > 0) return injected.join(', ');
    const available = visibleMapEnzymes.slice(0, 3).map((enzyme) => enzyme.name);
    return available.length > 0 ? available.join(', ') : 'EcoRI, BamHI, HindIII';
  }, [record.sites, visibleMapEnzymes]);
  const [enzymeText, setEnzymeText] = useState(defaultEnzymes);
  const [saveStatus, setSaveStatus] = useState('');
  const draftByRecordRef = useRef<Record<string, string>>({});
  const previousRecordIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (previousRecordIdRef.current === record.id) return;
    previousRecordIdRef.current = record.id;
    setEnzymeText(draftByRecordRef.current[record.id] ?? defaultEnzymes);
    setSaveStatus('');
  }, [defaultEnzymes, record.id]);

  useEffect(() => {
    setSaveStatus('');
  }, [enzymeText]);

  const recipe = useMemo(() => buildDigestRecipe({
    sequence: record.sequence,
    sequenceType,
    topology,
    enzymeText,
    enzymeCatalog,
    features: record.features,
  }), [enzymeCatalog, enzymeText, record.features, record.sequence, sequenceType, topology]);
  const fragments = recipe.fragments;
  const recipeEnzymes = recipe.enzymes.map((entry) => entry.name.toLocaleLowerCase()).sort();
  const savedRecipe = recipe.isValid ? workflowResults.find((result) => {
    if (result.kind !== 'digest' || result.inputRecordIds.length !== 1 || result.inputRecordIds[0] !== record.id) return false;
    if (inputSha256 !== undefined) {
      if (result.inputSha256s?.length !== 1 || result.inputSha256s[0] !== inputSha256) return false;
    } else if (result.inputSha256s !== undefined) {
      return false;
    }
    const savedEnzymes = Array.isArray(result.parameters.enzymes)
      ? result.parameters.enzymes.filter((value): value is string => typeof value === 'string').map((value) => value.toLocaleLowerCase()).sort()
      : [];
    return result.parameters.topology === topology
      && result.parameters.outcome === recipe.outcome
      && result.parameters.cutCount === recipe.cutCount
      && savedEnzymes.length === recipeEnzymes.length
      && savedEnzymes.every((value, index) => value === recipeEnzymes[index]);
  }) : undefined;
  const recipeAlreadySaved = Boolean(savedRecipe);
  useEffect(() => {
    if (!savedRecipe) setSaveStatus('');
  }, [savedRecipe]);
  const recipeMeta = !isDna
    ? { full: 'DNA only', compact: 'n/a' }
    : !recipe.isValid
      ? { full: 'Check recipe', compact: 'check' }
      : recipe.outcome === 'uncut'
        ? { full: '0 cuts · uncut', compact: '0 cuts' }
        : recipe.outcome === 'linearized'
          ? { full: '1 cut · linearized', compact: '1 cut' }
          : {
            full: `${recipe.cutCount} cuts · ${fragments.length} fragments`,
            compact: `${fragments.length} frag`,
          };
  const issueId = `motif-cs-digest-issue-${record.id}`;
  const saveLabel = recipeAlreadySaved
    ? 'Saved'
    : recipe.outcome === 'uncut'
      ? 'Save result'
      : recipe.outcome === 'linearized'
        ? 'Save linearized copy'
        : `Save ${fragments.length} fragments`;
  const saveCurrentRecipe = (): DigestSaveReceipt | null => {
    if (recipeAlreadySaved && savedRecipe) {
      return { workflowResultId: savedRecipe.id, recordCount: savedRecipe.outputRecordIds.length };
    }
    const receipt = onSave(recipe);
    if (!receipt) return null;
    setSaveStatus(receipt.recordCount === 0
      ? 'Saved result · no derived record'
      : `Saved ${receipt.recordCount} fragment${receipt.recordCount === 1 ? '' : 's'} · see Inventory or Workflow Results`);
    return receipt;
  };

  return (
    <details className="motif-cs-panel" name="motif-cs-map-dock">
      <summary className="motif-cs-panel-head" onClick={onOpen}>
        <span>
          <span className="motif-cs-full-label">Digest Preview</span>
          <span className="motif-cs-compact-label">Digest</span>
        </span>
        <span className="motif-cs-chip">
          <span className="motif-cs-full-label">{recipeMeta.full}</span>
          <span className="motif-cs-compact-label">{recipeMeta.compact}</span>
        </span>
      </summary>
      {isDna ? (
        <>
          <div className="motif-cs-layer-actions motif-cs-digest-recipe-row">
            <span className="motif-cs-digest-scope"><strong>Whole record</strong> · {record.name}</span>
            <input
              className="motif-cs-field motif-cs-digest-input"
              name="digest-enzymes"
              autoComplete="off"
              maxLength={MOTIF_MAX_SHORT_TEXT_LENGTH}
              spellCheck={false}
              value={enzymeText}
              onChange={(event) => {
                const next = event.target.value;
                draftByRecordRef.current[record.id] = next;
                setEnzymeText(next);
              }}
              aria-label="Digest enzymes"
              aria-invalid={!recipe.isValid}
              aria-describedby={!recipe.isValid ? issueId : undefined}
              placeholder="EcoRI, BamHI…"
              list="motif-cs-digest-enzymes"
            />
            <datalist id="motif-cs-digest-enzymes">
              {enzymeCatalog.map((enzyme) => <option key={enzyme.name} value={enzyme.name} />)}
            </datalist>
            <button
              className="motif-cs-mini-button"
              type="button"
              onClick={() => {
                const next = visibleMapEnzymes.slice(0, 12).map((enzyme) => enzyme.name).join(', ');
                draftByRecordRef.current[record.id] = next;
                setEnzymeText(next);
              }}
              disabled={visibleMapEnzymes.length === 0}
              title="Replace this recipe with the first visible cutters from Map Visibility"
            >
              Use visible cutters
            </button>
            <button className="motif-cs-mini-button" type="button" disabled={!recipe.isValid} onClick={() => onCopy('Digest fragments', digestRows(fragments, record.sequence.length))}>Copy table</button>
            <button
              className="motif-cs-mini-button motif-cs-mini-button-accent"
              data-testid="digest-save"
              type="button"
              disabled={!recipe.isValid || recipeAlreadySaved}
              title={recipeAlreadySaved ? 'This exact digest recipe is already saved.' : undefined}
              onClick={() => {
                saveCurrentRecipe();
              }}
            >
              {saveLabel}
            </button>
            <button
              className="motif-cs-mini-button"
              data-testid="digest-open-gel"
              type="button"
              disabled={!recipe.isValid || recipe.outcome === 'uncut'}
              onClick={() => {
                const receipt = saveCurrentRecipe();
                if (receipt) onOpenGel(receipt.workflowResultId);
              }}
            >
              {recipeAlreadySaved ? 'Open gel' : 'Save & open gel'}
            </button>
          </div>
          {!recipe.isValid ? (
            <p id={issueId} className="motif-cs-inline-error" role="alert">
              {recipe.issues.map((issue) => issue.message).join(' ')}
            </p>
          ) : null}
          {recipe.enzymes.length > 0 ? (
            <div className="motif-cs-digest-enzyme-chips" aria-label="Resolved restriction cutters">
              {recipe.enzymes.map((entry) => (
                <span className="motif-cs-digest-enzyme-chip" key={entry.name} data-type={entry.type}>
                  <strong translate="no">{entry.name}</strong>
                  <span>{entry.cutCount} cut{entry.cutCount === 1 ? '' : 's'}</span>
                  {entry.type === 'type-iis' ? <small>Type IIS</small> : null}
                </span>
              ))}
            </div>
          ) : null}
          {recipe.isValid && recipe.outcome === 'uncut' ? (
            <p className="motif-cs-digest-outcome" role="status">
              <strong>No cut sites found.</strong> The {topology} DNA molecule remains uncut; no derived fragments were produced.
            </p>
          ) : recipe.isValid ? (
            <p className="motif-cs-digest-outcome" role="status">
              <strong>{recipe.outcome === 'linearized' ? 'Circular molecule linearized.' : `${fragments.length} fragments predicted.`}</strong>{' '}
              {recipe.recognitionSiteCount} recognition site{recipe.recognitionSiteCount === 1 ? '' : 's'} across {recipe.enzymes.length} enzyme{recipe.enzymes.length === 1 ? '' : 's'}.
            </p>
          ) : null}
          {saveStatus ? <p className="motif-cs-digest-save-status" role="status">{saveStatus}</p> : null}
          {recipe.isValid && recipe.outcome !== 'uncut' ? (
            <div className="motif-cs-list motif-cs-digest-fragment-list">
              {fragments.slice(0, 8).map((fragment, index) => (
                <button
                  key={`${fragment.startInOriginal}:${fragment.endInOriginal}:${index}`}
                  type="button"
                  className="motif-cs-analysis-row motif-cs-analysis-row-button"
                  onClick={() => onSelectRange(fragment.startInOriginal, fragment.endInOriginal)}
                  title="Show this fragment on the map and sequence"
                >
                  <span className="motif-cs-row-main">
                    Fragment {index + 1}
                    <small>
                      {sequenceLengthLabel(fragment.length, sequenceType)} · {digestFragmentRangeLabel(fragment, record.sequence.length)}
                      {fragment.leftEnzyme || fragment.rightEnzyme ? ` · ${fragment.leftEnzyme ?? 'end'} to ${fragment.rightEnzyme ?? 'end'}` : ''}
                    </small>
                  </span>
                  <span className="motif-cs-row-meta motif-cs-digest-end-labels">
                    <span>Left {fragment.overhang5Type === 'blunt' ? 'Blunt' : `${fragment.overhang5Type === '5prime' ? '5′' : '3′'} ${fragment.overhang5}`}</span>
                    <span>Right {fragment.overhang3Type === 'blunt' ? 'Blunt' : `${fragment.overhang3Type === '5prime' ? '5′' : '3′'} ${fragment.overhang3}`}</span>
                  </span>
                </button>
              ))}
              {fragments.length > 8 ? <p className="motif-cs-muted">Showing first 8 of {fragments.length} fragments.</p> : null}
            </div>
          ) : null}
        </>
      ) : (
        <p className="motif-cs-muted">Restriction digest is available for DNA records only. RNA and protein records are not converted implicitly.</p>
      )}
    </details>
  );
}

function SequenceToolsPanel({
  records,
  record,
  schema,
  inventory,
  selectedRecordId,
  defaultMotif,
  alignments,
  notes,
  workflowResults,
  analysisResults,
  analysisAssets,
  artifactState,
  sequenceType,
  topology,
  enzymeSourcesByRecord,
  customEnzymes,
  selectedFeature,
  selectedMapRange,
  copyStatus,
  hasUnsavedChanges,
  hasSessionCheckpoint,
  onCopy,
  onCopySummary,
  onAddReverseComplement,
  onAnnotateRange,
  canAnnotateRange,
}: {
  records: readonly ArtifactVector[];
  record: ArtifactVector;
  schema: string;
  inventory: LoadedPayload['inventory'];
  selectedRecordId: string;
  defaultMotif: string;
  alignments: readonly ArtifactAlignment[];
  notes: readonly ArtifactNote[];
  workflowResults: readonly ArtifactWorkflowResult[];
  analysisResults: readonly ArtifactAnalysisResult[];
  analysisAssets: readonly ArtifactAnalysisAsset[];
  artifactState: ArtifactDurableState;
  sequenceType: SequenceType;
  topology: Topology;
  enzymeSourcesByRecord: Readonly<Record<string, readonly RestrictionEnzymeSourceId[]>>;
  customEnzymes: readonly RestrictionEnzyme[];
  selectedFeature: Feature | null;
  selectedMapRange: MapSelectionRange | null;
  copyStatus: string | null;
  hasUnsavedChanges: boolean;
  hasSessionCheckpoint: boolean;
  onCopy: (label: string, value: string) => void;
  onCopySummary: () => void;
  onAddReverseComplement: () => void;
  onAnnotateRange: () => void;
  canAnnotateRange: boolean;
}) {
  const exportPanelRef = useRef<HTMLDetailsElement>(null);
  const [exportPanelOpen, setExportPanelOpen] = useState(false);
  const [exportPanelHeight, setExportPanelHeight] = useState<number | null>(null);
  const [exportChoiceId, setExportChoiceId] = useState('record-sequence');
  const [downloadStatus, setDownloadStatus] = useState('');
  const hasActiveRecord = records.length > 0 && record.id !== EMPTY_ARTIFACT_VECTOR.id;
  const needsInventoryExport = exportPanelOpen && !exportChoiceId.startsWith('record-');
  const needsZipExport = exportPanelOpen && exportChoiceId === 'inventory-zip';
  const needsInventoryJson = exportPanelOpen && (exportChoiceId === 'inventory-json' || needsZipExport);

  const exportPanelHeightBounds = useCallback(() => {
    const panel = exportPanelRef.current;
    const column = panel?.closest<HTMLElement>('.motif-cs-sequence-column');
    const sequencePanel = column?.querySelector<HTMLElement>('.motif-cs-sequence-panel');
    const sequenceViewport = sequencePanel?.querySelector<HTMLElement>(
      ':scope > .motif-cs-sequence, :scope > .motif-cs-large-sequence',
    );
    if (!column || !panel || !sequencePanel || !sequenceViewport) return { min: 180, max: 220 };

    const columnRect = column.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const sequencePanelRect = sequencePanel.getBoundingClientRect();
    const sequenceViewportRect = sequenceViewport.getBoundingClientRect();
    const topReserve = Math.max(0, sequencePanelRect.top - columnRect.top);
    const bottomReserve = Math.max(0, columnRect.bottom - panelRect.bottom);
    const sequenceChromeHeight = Math.max(0, sequenceViewportRect.top - sequencePanelRect.top);
    // Reserve the real sequence toolbar/selection chrome plus a usable 160px
    // canvas. This ceiling remains stable as the Export panel itself changes.
    const available = columnRect.height - topReserve - bottomReserve - sequenceChromeHeight - 160;
    const max = Math.max(180, Math.min(columnRect.height, available));
    return { min: Math.min(220, max), max };
  }, []);

  const resizeExportPanelTo = useCallback((height: number) => {
    const { min, max } = exportPanelHeightBounds();
    setExportPanelHeight(clamp(height, min, max));
  }, [exportPanelHeightBounds]);

  useLayoutEffect(() => {
    if (!exportPanelOpen) return;

    const syncExportPanelHeight = () => {
      const bounds = exportPanelHeightBounds();
      setExportPanelHeight((current) => {
        // Compact workspaces already give Sequence its own scroll owner. Let
        // Export flow at its natural height there so a second 180px scroller
        // cannot leave a partly visible, non-interactive action row. Wide
        // desktop retains the independently resizable Export viewport.
        if (window.matchMedia(OVERLAY_TOOLS_LAYOUT_MEDIA).matches) return null;
        const next = clamp(current ?? 340, bounds.min, bounds.max);
        return current === next ? current : next;
      });
    };

    syncExportPanelHeight();
    window.addEventListener('resize', syncExportPanelHeight);
    return () => window.removeEventListener('resize', syncExportPanelHeight);
  }, [exportPanelHeightBounds, exportPanelOpen]);

  useLayoutEffect(() => {
    if (!exportPanelOpen) return;
    const frame = window.requestAnimationFrame(() => {
      const panel = exportPanelRef.current;
      const column = panel?.closest<HTMLElement>('.motif-cs-sequence-column');
      if (!panel || !column) return;

      const panelRect = panel.getBoundingClientRect();
      const columnRect = column.getBoundingClientRect();
      if (exportPanelHeight === null) {
        // Natural-height compact panels use the Sequence pane as their only
        // scroll owner. Reveal the Export heading first, then let ordinary
        // scrolling move through every action and preview in document order.
        column.scrollTo({
          top: column.scrollTop + panelRect.top - columnRect.top,
          behavior: 'auto',
        });
        return;
      }
      const overflowBelow = panelRect.bottom - columnRect.bottom;
      if (overflowBelow > 0) {
        column.scrollTo({ top: column.scrollTop + overflowBelow, behavior: 'auto' });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [exportPanelHeight, exportPanelOpen]);

  const startExportPanelResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const panel = exportPanelRef.current;
    if (!panel) return;
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startHeight = panel.getBoundingClientRect().height;
    document.body.dataset.motifCsExportResizing = 'true';

    const handlePointerMove = (moveEvent: PointerEvent) => {
      resizeExportPanelTo(startHeight + startY - moveEvent.clientY);
    };
    const stopResize = () => {
      delete document.body.dataset.motifCsExportResizing;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize, { once: true });
    window.addEventListener('pointercancel', stopResize, { once: true });
  }, [resizeExportPanelTo]);

  const resizeExportPanelFromKeyboard = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const current = exportPanelRef.current?.getBoundingClientRect().height ?? exportPanelHeight ?? 340;
    const step = event.shiftKey ? 32 : 16;
    resizeExportPanelTo(current + (event.key === 'ArrowUp' ? step : -step));
  }, [exportPanelHeight, resizeExportPanelTo]);

  const exportRecords = useMemo(
    () => records.map((item) => (item.id === record.id && item.topology !== topology ? { ...item, topology } : item)),
    [record.id, records, topology],
  );
  const exportRecordsWithSites = useMemo(
    () => needsInventoryExport ? exportRecords.map((item) => {
      const itemSources = enzymeSourcesByRecord[item.id] ?? DEFAULT_ENZYME_SOURCES;
      // Resolve through the shared helper rather than a second inline copy of it.
      // The copy called resolveEnzymeUnion directly, which falls back to the
      // Common working set for an empty list, so a record with no sources
      // selected exported Common's sites while every on-screen surface showed
      // none — the export disagreeing with the app about which enzymes were even
      // in play. The helper's own empty check keeps the two answers the same.
      return { ...item, sites: recordSitesForExport(item, restrictionEnzymesForSources(itemSources, customEnzymes)) };
    }) : [],
    [customEnzymes, enzymeSourcesByRecord, exportRecords, needsInventoryExport],
  );
  const selectedSequence = exportPanelOpen ? sequenceForFeature(record.sequence, selectedFeature, sequenceType) : '';
  const selectedRangeSequence = exportPanelOpen ? sequenceForRange(record.sequence, selectedMapRange, topology) : '';
  const isNucleotide = isNucleotideType(sequenceType);
  const isRna = sequenceType === 'rna';
  const selectedFeatureIsReverse = Boolean(selectedFeature && selectedFeature.strand === -1 && isNucleotide);
  const selectedFeatureIsOrdered = Boolean(selectedFeature && isOrderedFeatureLocation(selectedFeature));
  const selectedFeatureCannotMaterialize = Boolean(selectedFeature && !isMaterializableFeatureLocation(selectedFeature));
  const targetSequence = !exportPanelOpen ? '' : selectedFeature ? selectedSequence : selectedMapRange ? selectedRangeSequence : record.sequence;
  const reverseComplementSequence = exportPanelOpen && isNucleotide ? reverseComplement(targetSequence, isRna) : '';
  const complementSequence = exportPanelOpen && isNucleotide ? complement(targetSequence, isRna) : '';
  const fasta = exportPanelOpen ? toFasta(record.name, record.sequence) : '';
  const exportRecord = record.topology === topology ? record : { ...record, topology };
  const genbank = exportPanelOpen ? toGenBankLite(exportRecord, topology) : '';
  const gff3 = exportPanelOpen && exportChoiceId === 'record-gff3' ? toGff3Lite(record) : '';
  const recordJson = exportPanelOpen && exportChoiceId === 'record-json' ? JSON.stringify(serializeRecord(exportRecord), null, 2) : '';
  const inventoryJson = useMemo(() => (
    needsInventoryJson
      ? JSON.stringify(createArtifactDatabaseSnapshot({
        schema,
        inventory,
        records: [...exportRecordsWithSites],
        selectedRecordId,
        defaultMotif,
        alignments: [...alignments],
        notes: [...notes],
        workflowResults: [...workflowResults],
        analysisResults: [...analysisResults],
        analysisAssets: [...analysisAssets],
      }, artifactState, exportRecordsWithSites))
      : ''
  ), [alignments, analysisAssets, analysisResults, artifactState, defaultMotif, exportRecordsWithSites, inventory, needsInventoryJson, notes, schema, selectedRecordId, workflowResults]);
  const inventoryCsv = exportChoiceId === 'inventory-csv' || needsZipExport ? inventoryToCsv(exportRecordsWithSites) : '';
  const featureCsv = exportChoiceId === 'features-csv' || needsZipExport ? featuresToCsv(exportRecordsWithSites) : '';
  const siteCsv = exportChoiceId === 'sites-csv' || needsZipExport ? sitesToCsv(exportRecordsWithSites) : '';
  const multiFasta = exportChoiceId === 'multi-fasta' || needsZipExport ? toMultiFasta(exportRecordsWithSites) : '';
  const multiGenbank = exportChoiceId === 'multi-genbank' || needsZipExport ? toMultiGenBank(exportRecordsWithSites) : '';
  const reportMarkdown = exportChoiceId === 'report-md' || needsZipExport ? inventoryReportMarkdown(exportRecordsWithSites) : '';
  const reportHtml = ['report-html', 'report-print'].includes(exportChoiceId) || needsZipExport ? inventoryReportHtml(exportRecordsWithSites) : '';
  const zipFiles = useMemo(() => {
    if (!needsZipExport) return [];
    const usedNames = new Set<string>();
    const file = (name: string, content: string): ZipTextFile => ({
      name: uniqueArchiveName(name, usedNames),
      content,
    });
    return [
      file('inventory.json', inventoryJson),
      file('inventory.csv', inventoryCsv),
      file('features.csv', featureCsv),
      file('restriction-sites.csv', siteCsv),
      file('records.fasta', multiFasta),
      file('records.gb', multiGenbank),
      ...alignments.flatMap((alignment) => [
        file(`alignments/${safeAlignmentFilename(alignment, 'aligned.fasta')}`, formatAlignedFasta(alignment)),
        file(`alignments/${safeAlignmentFilename(alignment, 'aln')}`, formatClustal(alignment)),
      ]),
      file('report.md', reportMarkdown),
      file('report.html', reportHtml),
      ...exportRecordsWithSites.flatMap((item) => [
        file(`records/${safeSlug(item.name)}.fasta`, toFasta(item.name, item.sequence)),
        file(`records/${safeSlug(item.name)}.gb`, toGenBankLite(item, item.topology)),
      ]),
    ];
  }, [alignments, exportRecordsWithSites, featureCsv, inventoryCsv, inventoryJson, multiFasta, multiGenbank, needsZipExport, reportHtml, reportMarkdown, siteCsv]);
  const preview = selectedFeature
    ? `${selectedFeature.name} (${featureRangeLabel(selectedFeature)})\n${selectedSequence}`
    : selectedMapRange
      ? `Map range ${mapRangeLabel(selectedMapRange, record.sequence.length)}\n${selectedRangeSequence}`
      : record.sequence;
  type ExportChoice = {
    id: string;
    group: 'Active record' | 'Whole inventory' | 'Report';
    label: string;
    copyLabel?: string;
    content?: string;
    downloadName?: string;
    mime?: string;
    download?: () => BrowserDownloadReceipt;
    print?: () => void;
  };
  const exportChoices = useMemo<ExportChoice[]>(() => [
    ...(hasActiveRecord ? [
      { id: 'record-sequence', group: 'Active record' as const, label: 'Raw sequence', copyLabel: 'Sequence', content: record.sequence, downloadName: `${safeSlug(record.name)}.txt`, mime: 'text/plain' },
      { id: 'record-fasta', group: 'Active record' as const, label: 'FASTA', copyLabel: 'FASTA', content: fasta, downloadName: `${safeSlug(record.name)}.fasta`, mime: 'text/x-fasta' },
      { id: 'record-genbank', group: 'Active record' as const, label: 'Basic GenBank', copyLabel: 'Basic GenBank', content: genbank, downloadName: `${safeSlug(record.name)}.gb`, mime: 'chemical/x-genbank' },
      { id: 'record-gff3', group: 'Active record' as const, label: 'Basic GFF3 features', copyLabel: 'Basic GFF3', content: gff3, downloadName: `${safeSlug(record.name)}.gff3`, mime: 'text/gff3' },
      { id: 'record-json', group: 'Active record' as const, label: 'Record JSON', copyLabel: 'Record JSON', content: recordJson, downloadName: `${safeSlug(record.name)}.json`, mime: 'application/json' },
    ] : []),
    { id: 'inventory-json', group: 'Whole inventory', label: 'Database JSON', copyLabel: 'Inventory JSON', content: inventoryJson, downloadName: 'motif-inventory.json', mime: 'application/json' },
    { id: 'inventory-csv', group: 'Whole inventory', label: 'Inventory CSV', copyLabel: 'Inventory CSV', content: inventoryCsv, downloadName: 'motif-inventory.csv', mime: 'text/csv' },
    { id: 'features-csv', group: 'Whole inventory', label: 'Feature CSV', copyLabel: 'Feature CSV', content: featureCsv, downloadName: 'motif-features.csv', mime: 'text/csv' },
    { id: 'sites-csv', group: 'Whole inventory', label: 'Restriction-site CSV', copyLabel: 'Restriction-site CSV', content: siteCsv, downloadName: 'motif-restriction-sites.csv', mime: 'text/csv' },
    { id: 'multi-fasta', group: 'Whole inventory', label: 'Multi-FASTA', copyLabel: 'Multi FASTA', content: multiFasta, downloadName: 'motif-records.fasta', mime: 'text/x-fasta' },
    { id: 'multi-genbank', group: 'Whole inventory', label: 'Basic multi-GenBank', copyLabel: 'Basic multi-GenBank', content: multiGenbank, downloadName: 'motif-records.gb', mime: 'chemical/x-genbank' },
    { id: 'report-md', group: 'Report', label: 'Pretty report Markdown', copyLabel: 'Report Markdown', content: reportMarkdown, downloadName: 'motif-inventory-report.md', mime: 'text/markdown' },
    { id: 'report-html', group: 'Report', label: 'Pretty report HTML', copyLabel: 'Report HTML', content: reportHtml, downloadName: 'motif-inventory-report.html', mime: 'text/html' },
    { id: 'report-print', group: 'Report', label: 'Pretty print / PDF', print: () => printHtmlReport(reportHtml) },
    { id: 'inventory-zip', group: 'Whole inventory', label: 'ZIP package', download: () => downloadBlobFile('motif-inventory-export.zip', createZipBlob(zipFiles)) },
  ], [fasta, featureCsv, genbank, gff3, hasActiveRecord, inventoryCsv, inventoryJson, multiFasta, multiGenbank, record.name, record.sequence, recordJson, reportHtml, reportMarkdown, siteCsv, zipFiles]);
  const exportChoice = exportChoices.find((choice) => choice.id === exportChoiceId) ?? exportChoices[0];
  const exportPreview = exportChoice?.content
    ?? (exportChoice?.id === 'inventory-zip'
      ? `ZIP package · ${zipFiles.length} files\n\n${zipFiles.map((file) => file.name).join('\n')}`
      : exportChoice?.id === 'report-print'
        ? `Printable inventory report · ${exportRecordsWithSites.length} records\n\nUse Print / PDF to open the system print dialog.`
        : preview);

  useEffect(() => {
    if (exportChoices.some((choice) => choice.id === exportChoiceId)) return;
    setExportChoiceId(exportChoices[0]?.id ?? 'inventory-json');
  }, [exportChoiceId, exportChoices]);

  const copySelectedExport = useCallback(() => {
    if (!exportChoice?.content) return;
    onCopy(exportChoice.copyLabel ?? exportChoice.label, exportChoice.content);
  }, [exportChoice, onCopy]);
  const downloadSelectedExport = useCallback(() => {
    if (!exportChoice) return;
    let receipt: BrowserDownloadReceipt;
    if (exportChoice.download) {
      receipt = exportChoice.download();
    } else {
      if (!exportChoice.content || !exportChoice.downloadName) return;
      receipt = downloadTextFile(exportChoice.downloadName, exportChoice.content, exportChoice.mime);
    }
    setDownloadStatus(receipt.message);
  }, [exportChoice]);
  const selectedTargetLabel = selectedFeature
    ? selectedFeature.name
    : selectedMapRange
      ? `Range ${mapRangeLabel(selectedMapRange, record.sequence.length)}`
      : null;
  const durabilityStatus = hasUnsavedChanges
    ? 'unsaved changes'
    : hasSessionCheckpoint
      ? 'restored checkpoint'
      : 'session only';

  const exportPanelBounds = exportPanelHeightBounds();

  return (
    <details
      ref={exportPanelRef}
      className="motif-cs-panel motif-cs-sequence-tools-panel"
      data-resized={exportPanelHeight !== null || undefined}
      style={exportPanelHeight !== null ? { '--motif-cs-export-panel-height': `${exportPanelHeight}px` } as CSSProperties : undefined}
      onToggle={(event) => {
        const panel = event.currentTarget;
        const open = panel.open;
        setExportPanelOpen(open);
      }}
    >
      <summary className="motif-cs-panel-head">
        <span>Export & Copy</span>
        <span
          className="motif-cs-chip"
          role="status"
          data-testid="session-durability-status"
          title={hasUnsavedChanges
            ? 'This session changed since its last complete Database JSON or ZIP checkpoint.'
            : hasSessionCheckpoint
              ? 'The current session matches a complete JSON file restored from disk.'
              : 'Records are kept in this artifact session. Export Database JSON or ZIP before reloading.'}
        >
          {copyStatus ?? durabilityStatus}
        </span>
      </summary>
      {exportPanelOpen && exportPanelBounds.max > 220 ? (
        <div
          className="motif-cs-export-resize-handle"
          role="separator"
          aria-label="Resize Export and Copy panel"
          aria-orientation="horizontal"
          aria-valuemin={Math.round(exportPanelBounds.min)}
          aria-valuemax={Math.round(exportPanelBounds.max)}
          aria-valuenow={Math.round(exportPanelHeight ?? exportPanelBounds.min)}
          tabIndex={0}
          title="Drag to resize; use Up and Down Arrow keys; double-click to fit"
          onPointerDown={startExportPanelResize}
          onKeyDown={resizeExportPanelFromKeyboard}
          onDoubleClick={() => resizeExportPanelTo(340)}
        />
      ) : null}
      {exportPanelOpen ? (
      <div className="motif-cs-export-body">
        <p className="motif-cs-form-note">Session data is not durable across reloads. Database JSON restores directly; ZIP contains the same inventory.json plus interchange exports, so extract inventory.json before using Add Entry. Basic GenBank preserves joined, ordered, and origin-spanning locations; ambiguous legacy reverse locations export conservatively as non-materializable order(...). GFF3 emits discontinuous rows with Motif part-order attributes. Use Database JSON for full Motif metadata.</p>
        <div className="motif-cs-export-row">
          <span className="motif-cs-export-label">Copy</span>
          <div className="motif-cs-export-actions">
            <button className="motif-cs-mini-button motif-cs-mini-button-accent" type="button" onClick={onCopySummary} disabled={!hasActiveRecord} title="Copy a plain-language summary of this record and selection to paste into the conversation">Summary</button>
            <button className="motif-cs-mini-button" type="button" onClick={() => onCopy('Sequence', record.sequence)} disabled={!hasActiveRecord}>Sequence</button>
            <button className="motif-cs-mini-button" type="button" onClick={() => onCopy('FASTA', fasta)} disabled={!hasActiveRecord}>FASTA</button>
            <button
              className="motif-cs-mini-button"
              type="button"
              title="Copy basic GenBank with preserved feature locations"
              onClick={() => onCopy('Basic GenBank', genbank)}
              disabled={!hasActiveRecord}
            >
              GenBank
            </button>
          </div>
        </div>
        {selectedTargetLabel ? (
          <div className="motif-cs-export-row">
            <span className="motif-cs-export-label" title={selectedTargetLabel}>Selection</span>
            <div className="motif-cs-export-actions">
              <button
                className="motif-cs-mini-button"
                type="button"
                onClick={() => onCopy(selectedFeature ? 'Feature sequence' : 'Map range', selectedFeature ? selectedSequence : selectedRangeSequence)}
                disabled={selectedFeature ? !selectedSequence : !selectedRangeSequence}
                title={selectedFeatureIsReverse ? 'Copies the reverse feature in feature orientation.' : `Copy ${selectedTargetLabel}`}
              >
                Copy
              </button>
              <button
                className="motif-cs-mini-button"
                type="button"
                onClick={() => onAnnotateRange()}
                disabled={!canAnnotateRange}
                title={selectedMapRange ? 'Annotate this range as a new feature' : undefined}
              >
                Annotate
              </button>
            </div>
          </div>
        ) : null}
        <div className="motif-cs-export-row">
          <span className="motif-cs-export-label">DNA/RNA</span>
          <div className="motif-cs-export-actions">
            <button className="motif-cs-mini-button" type="button" onClick={() => onCopy('Complement', complementSequence)} disabled={!hasActiveRecord || !isNucleotide || selectedFeatureCannotMaterialize}>Complement</button>
            <button
              className="motif-cs-mini-button"
              type="button"
              onClick={() => onCopy('Reverse complement', reverseComplementSequence)}
              disabled={!hasActiveRecord || !isNucleotide || selectedFeatureCannotMaterialize}
              title={selectedFeatureIsReverse ? 'Return the opposite orientation of the assembled reverse-feature sequence.' : 'Copy the reverse complement of the current target'}
            >
              Copy rev comp
            </button>
            <button className="motif-cs-mini-button" type="button" onClick={onAddReverseComplement} disabled={!hasActiveRecord || !isNucleotide || selectedFeatureCannotMaterialize}>New rev comp</button>
          </div>
        </div>
        {selectedFeatureIsReverse ? (
          <p className="motif-cs-form-note">Reverse feature: Copy uses biological feature orientation; Copy rev comp returns the opposite orientation of the assembled feature sequence.</p>
        ) : null}
        {selectedFeatureIsOrdered ? (
          <p className="motif-cs-form-note">INSDC order(...) records segment order but does not assert that the pieces form one materializable sequence. Sequence copy, complement, translation, and derived-record actions stay unavailable.</p>
        ) : null}
        {selectedFeature && isAmbiguousFeatureLocation(selectedFeature) ? (
          <p className="motif-cs-form-note">This legacy reverse multipart location has no reliable biological-order marker. Database JSON preserves it exactly; Basic GenBank and GFF3 label it non-materializable. Sequence copy, complement, translation, and derived-record actions stay unavailable until the source order is confirmed.</p>
        ) : null}
        <div className="motif-cs-export-picker">
          <label>
            <span>Format</span>
            <select className="motif-cs-field" name="export-format" value={exportChoice?.id ?? ''} onChange={(event) => setExportChoiceId(event.target.value)}>
              {exportChoices.map((choice) => (
                <option key={choice.id} value={choice.id}>{choice.group} - {choice.label}</option>
              ))}
            </select>
          </label>
          <div className="motif-cs-export-picker-actions">
            <button className="motif-cs-mini-button" type="button" onClick={copySelectedExport} disabled={!exportChoice?.content}>Copy</button>
            <button className="motif-cs-mini-button" type="button" onClick={downloadSelectedExport} disabled={!(exportChoice?.download || (exportChoice?.content && exportChoice.downloadName))}>Download</button>
            <button className="motif-cs-mini-button motif-cs-mini-button-accent" type="button" onClick={exportChoice?.print} disabled={!exportChoice?.print}>Print / PDF</button>
          </div>
        </div>
        <p className="motif-cs-form-note" role="status" aria-live="polite" data-empty={!downloadStatus || undefined}>
          {downloadStatus}
        </p>
        <textarea className="motif-cs-textarea motif-cs-sequence-preview" name="sequence-preview" autoComplete="off" readOnly value={exportPreview} aria-label="Selected export preview" />
      </div>
      ) : null}
    </details>
  );
}

/**
 * A floating, draggable, resizable, closable window ("dynamic window"). Position
 * and size live locally for smooth dragging; the final rect is committed to the
 * parent on pointer-up so the window reopens where the user left it.
 */
function FloatingWindow({
  title,
  subtitle,
  initial,
  rightInset = 0,
  onClose,
  onCommit,
  returnFocusRef,
  maximizable = false,
  inactive = false,
  resetSignal,
  children,
}: {
  title: string;
  subtitle?: string;
  initial: WindowRect;
  /** Keeps the permanent right rail outside the movable window's geometry. */
  rightInset?: number;
  onClose: () => void;
  onCommit?: (rect: WindowRect) => void;
  /**
   * Bumped by "Reset display" to make an ALREADY OPEN window adopt `initial`
   * again. Without it that button cannot reach these windows at all: `initial`
   * is read once, at mount.
   */
  resetSignal?: number;
  returnFocusRef?: RefObject<HTMLElement | null>;
  maximizable?: boolean;
  /** Keeps a draft mounted beneath a temporarily active child workflow. */
  inactive?: boolean;
  children: ReactNode;
}) {
  const [rect, setRect] = useState<WindowRect>(() => clampWindowRect(initial, window.innerWidth, window.innerHeight, rightInset));
  const [collapsed, setCollapsed] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const dragRef = useRef<{
    mode: 'move' | 'resize';
    pointerId: number;
    startX: number;
    startY: number;
    base: WindowRect;
  } | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const rectRef = useRef(rect);
  // Keep the user's preferred normal rect separate from the temporarily
  // clamped rect rendered in a narrow viewport. Otherwise shrinking to a
  // phone-sized window permanently destroys the desktop size and leaves
  // controls clipped even after the viewport grows again.
  const restoreRectRef = useRef(initial);
  const onCommitRef = useRef(onCommit);
  const windowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    rectRef.current = rect;
  }, [rect]);

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => {
    if (inactive) return;
    window.requestAnimationFrame(() => windowRef.current?.focus({ preventScroll: true }));
  }, [inactive]);

  const stopActiveDrag = useCallback((commit: boolean) => {
    const hadActiveDrag = !!dragRef.current;
    dragCleanupRef.current?.();
    dragCleanupRef.current = null;
    dragRef.current = null;
    delete document.body.dataset.motifCsWindowDragging;
    if (commit && hadActiveDrag) {
      restoreRectRef.current = rectRef.current;
      onCommitRef.current?.(rectRef.current);
    }
  }, []);

  const closeWindow = useCallback(() => {
    stopActiveDrag(true);
    onClose();
    window.requestAnimationFrame(() => returnFocusRef?.current?.focus({ preventScroll: true }));
  }, [onClose, returnFocusRef, stopActiveDrag]);

  useEffect(() => () => stopActiveDrag(false), [stopActiveDrag]);

  useEffect(() => {
    const closeFromEscape = (event: KeyboardEvent) => {
      if (inactive) return;
      if (event.key !== 'Escape') return;
      if (event.defaultPrevented) return;
      if ((event.target as HTMLElement | null)?.closest('[data-motif-cs-escape-scope="true"]')) return;
      // Some engines (notably WebKit) can move focus back to the page after a
      // native checkbox click. An open child menu still owns the first Escape
      // even when the key target is no longer inside that menu.
      if (windowRef.current?.querySelector('[data-motif-cs-escape-scope="true"]')) return;
      // That attribute is rendered from React state, and for a native <details>
      // menu the state arrives late: the browser opens the menu during the click,
      // but React only hears about it from the `toggle` event, measured here at
      // ~52ms after the click. For that whole interval the menu is open on screen
      // while the check above sees nothing, so an Escape aimed at the menu closed
      // the window instead. A disclosure's own `open` property is true the instant
      // it opens, so that is the signal to read. Opt-in through the attribute
      // rather than matching every `details[open]`: an ordinary accordion left
      // open inside a window would otherwise swallow Escape for good, because
      // nothing would ever close it.
      if (windowRef.current?.querySelector('details[data-motif-cs-escape-scope-when-open][open]')) return;
      // A tools-rail popover renders outside this window's subtree, so the check
      // above cannot see it. This listener is in capture on window and stops
      // propagation, so without this the window closes out from under a panel
      // that is sitting on top of it — and the panel survives. Same selector the
      // popover's own handler uses, so the two cannot disagree about what is open.
      // Keyed on data-tools-pinned="false" because that is the same condition the
      // stylesheet uses to float the panel: the guard then fires exactly when an
      // overlay actually exists. Docked mode has the same markup but sits beside
      // the window rather than over it, and its handler is not registered — so
      // matching there would leave Escape doing nothing at all.
      if (document.querySelector('.motif-cs-inspector[data-tools-pinned="false"] details[name="motif-cs-tools"][open]')) return;
      event.preventDefault();
      event.stopPropagation();
      closeWindow();
    };
    window.addEventListener('keydown', closeFromEscape, true);
    return () => window.removeEventListener('keydown', closeFromEscape, true);
  }, [closeWindow, inactive]);

  useEffect(() => {
    const handleResize = () => setRect(() => {
      const next = maximized
        ? clampWindowRect({ x: 8, y: 8, w: window.innerWidth - rightInset - 16, h: window.innerHeight - 16 }, window.innerWidth, window.innerHeight, rightInset)
        : clampWindowRect(restoreRectRef.current, window.innerWidth, window.innerHeight, rightInset);
      rectRef.current = next;
      return next;
    });
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [maximized, rightInset]);

  // "Reset display" has to reach a window that is open right now. `initial` is
  // read once, in the useState initialiser above, so a parent handing back a
  // fresh default rect moves nothing on screen — the user keeps staring at the
  // 280x180 window they are trying to escape and the button reads as broken.
  // Driven by an explicit counter rather than by `initial` changing identity,
  // because `onCommit` writes every finished drag back into that same prop:
  // adopting on identity would re-apply mid-interaction, against the very
  // gesture that produced it. Maximize and collapse are cleared too — a reset
  // that restored the size but left the window maximized would not show it.
  const lastResetSignalRef = useRef(resetSignal);
  useEffect(() => {
    if (resetSignal === lastResetSignalRef.current) return;
    lastResetSignalRef.current = resetSignal;
    stopActiveDrag(false);
    const next = clampWindowRect(initial, window.innerWidth, window.innerHeight, rightInset);
    restoreRectRef.current = next;
    rectRef.current = next;
    setCollapsed(false);
    setMaximized(false);
    setRect(next);
  }, [initial, resetSignal, rightInset, stopActiveDrag]);

  const restoreWindow = useCallback(() => {
    const next = clampWindowRect(restoreRectRef.current, window.innerWidth, window.innerHeight, rightInset);
    rectRef.current = next;
    setRect(next);
    setMaximized(false);
  }, [rightInset]);

  const toggleMaximized = useCallback(() => {
    stopActiveDrag(false);
    if (maximized) {
      restoreWindow();
      return;
    }
    const next = clampWindowRect({ x: 8, y: 8, w: window.innerWidth - rightInset - 16, h: window.innerHeight - 16 }, window.innerWidth, window.innerHeight, rightInset);
    rectRef.current = next;
    setCollapsed(false);
    setMaximized(true);
    setRect(next);
  }, [maximized, restoreWindow, rightInset, stopActiveDrag]);

  const toggleCollapsed = useCallback(() => {
    if (maximized) {
      const next = clampWindowRect(restoreRectRef.current, window.innerWidth, window.innerHeight, rightInset);
      rectRef.current = next;
      setRect(next);
      setMaximized(false);
      setCollapsed(true);
      return;
    }
    setCollapsed((value) => !value);
  }, [maximized, rightInset]);

  const beginDrag = (mode: 'move' | 'resize') => (event: ReactPointerEvent) => {
    // Ignore drags that start on the header buttons (collapse / close) so a single
    // press still fires their onClick. Starting a move-drag here would call
    // setPointerCapture on the header, which retargets pointerup and swallows the
    // button click — that was the "takes several clicks to collapse" bug.
    if (maximized || (event.target as HTMLElement).closest('.motif-cs-window-head-actions')) return;
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    stopActiveDrag(false);
    const dragSurface = event.currentTarget as HTMLElement;
    // Set drag state first; pointer capture is best-effort (it can throw for
    // synthetic/invalid pointer ids) and must never abort the drag.
    dragRef.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      base: rectRef.current,
    };
    document.body.dataset.motifCsWindowDragging = mode;
    try {
      dragSurface.setPointerCapture?.(event.pointerId);
    } catch {
      /* capture unavailable — window listeners below still keep the drag alive */
    }

    const applyDrag = (clientX: number, clientY: number) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = clientX - drag.startX;
      const dy = clientY - drag.startY;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const raw = drag.mode === 'move' ? {
        ...drag.base,
        x: drag.base.x + dx,
        y: drag.base.y + dy,
      } : {
        ...drag.base,
        w: clamp(drag.base.w + dx, 280, Math.max(280, vw - rightInset - drag.base.x - 8)),
        h: clamp(drag.base.h + dy, 180, Math.max(180, vh - drag.base.y - 8)),
      };
      const next = clampWindowRect(raw, vw, vh, rightInset);
      rectRef.current = next;
      setRect(next);
    };

    const removeDragListeners = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      window.removeEventListener('blur', endDragFromBlur);
      dragSurface.removeEventListener('lostpointercapture', endLostPointerCapture);
      if (dragCleanupRef.current === removeDragListeners) dragCleanupRef.current = null;
      try {
        if (dragSurface.hasPointerCapture?.(event.pointerId)) dragSurface.releasePointerCapture?.(event.pointerId);
      } catch {
        /* Capture may already be gone after blur or DOM removal. */
      }
    };

    function handlePointerMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== dragRef.current?.pointerId) return;
      moveEvent.preventDefault();
      applyDrag(moveEvent.clientX, moveEvent.clientY);
    }

    function endDrag(endEvent: PointerEvent) {
      if (endEvent.pointerId !== dragRef.current?.pointerId) return;
      stopActiveDrag(true);
    }

    function endLostPointerCapture(lostEvent: PointerEvent) {
      if (lostEvent.pointerId !== dragRef.current?.pointerId) return;
      stopActiveDrag(true);
    }

    function endDragFromBlur() {
      stopActiveDrag(true);
    }

    dragCleanupRef.current = removeDragListeners;
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    window.addEventListener('blur', endDragFromBlur);
    dragSurface.addEventListener('lostpointercapture', endLostPointerCapture);
  };

  const commitKeyboardRect = useCallback((next: WindowRect) => {
    if (maximized) return;
    const clamped = clampWindowRect(next, window.innerWidth, window.innerHeight, rightInset);
    rectRef.current = clamped;
    restoreRectRef.current = clamped;
    setRect(clamped);
    onCommit?.(clamped);
  }, [maximized, onCommit, rightInset]);

  const moveFromKeyboard = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 24 : 10;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    commitKeyboardRect({ ...rectRef.current, x: rectRef.current.x + dx, y: rectRef.current.y + dy });
  }, [commitKeyboardRect]);

  const resizeFromKeyboard = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 24 : 10;
    const dw = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dh = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    commitKeyboardRect({ ...rectRef.current, w: rectRef.current.w + dw, h: rectRef.current.h + dh });
  }, [commitKeyboardRect]);

  return (
    <div
      ref={windowRef}
      className="motif-cs-window"
      role="dialog"
      aria-label={title}
      aria-hidden={inactive || undefined}
      inert={inactive || undefined}
      tabIndex={-1}
      data-collapsed={collapsed || undefined}
      data-maximized={maximized || undefined}
      data-inactive={inactive || undefined}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: collapsed ? undefined : rect.h,
        '--motif-cs-floating-right-inset': `${rightInset}px`,
        // Anything anchored inside this window has to bound itself against the
        // window, not the browser viewport — a 240px window on a 1400px screen
        // is the case where the two disagree, and where a viewport-sized popover
        // is clipped by the body with nothing able to scroll it into reach.
        // Left unset while maximized, where the viewport IS the right bound.
        '--motif-cs-window-height': maximized || collapsed ? undefined : `${rect.h}px`,
      } as CSSProperties}
    >
      <div
        className="motif-cs-window-head"
        role="group"
        aria-label={maximized ? `${title} window maximized` : `Move ${title} window; use Alt plus arrow keys`}
        tabIndex={0}
        onPointerDown={beginDrag('move')}
        onKeyDown={moveFromKeyboard}
        onDoubleClick={toggleCollapsed}
      >
        <div className="motif-cs-window-title">
          <strong>{title}</strong>
          {subtitle ? <small>{subtitle}</small> : null}
        </div>
        <div className="motif-cs-window-head-actions">
          {maximizable && !collapsed ? (
            <button
              className="motif-cs-window-icon"
              type="button"
              onClick={toggleMaximized}
              aria-label={maximized ? `Restore ${title}` : `Maximize ${title}`}
              aria-pressed={maximized}
              title={maximized ? 'Restore' : 'Maximize'}
            >
              {maximized ? <Minimize2 size={13} strokeWidth={2.1} aria-hidden="true" /> : <Maximize2 size={13} strokeWidth={2.1} aria-hidden="true" />}
            </button>
          ) : null}
          <button
            className="motif-cs-window-icon"
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? (
              <ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" />
            ) : (
              <ChevronDown size={14} strokeWidth={2.2} aria-hidden="true" />
            )}
          </button>
          <button className="motif-cs-window-icon motif-cs-window-close" type="button" onClick={closeWindow} aria-label={`Close ${title}`}>
            <X size={14} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      </div>
      {collapsed ? null : (
        <>
          <div className="motif-cs-window-body">{children}</div>
          {!maximized ? <button
            type="button"
            className="motif-cs-window-resize"
            onPointerDown={beginDrag('resize')}
            onKeyDown={resizeFromKeyboard}
            aria-label={`Resize ${title} window in 2 dimensions. Left and Right Arrow change width; Up and Down Arrow change height.`}
            aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
            title={`Resize ${title}; arrow keys change width and height`}
          /> : null}
        </>
      )}
    </div>
  );
}

// One stable Translate panel: the SAME controls whether you have a selection or
// not — only the target chip + readout change. Reading frames aren't a separate
// section; you pick strand + frame here and the protein updates in place. Each
// residue is clickable → selects its codon on the sequence.
function TranslationPanel({
  canTranslate,
  targetLabel,
  isWhole,
  translationCode,
  translationCodeContext,
  strand,
  frame,
  residues,
  protein,
  unavailableReason,
  canAddToSequence,
  layerCount,
  onStrandChange,
  onFrameChange,
  onTranslationCodeChange,
  onSelectCodon,
  onCopy,
  onAddToSequence,
  onAddRecord,
  onClearLayers,
  onOpenFloating,
}: {
  canTranslate: boolean;
  targetLabel: string;
  isWhole: boolean;
  translationCode: ArtifactTranslationCodeResolution;
  translationCodeContext: string;
  strand: 'sense' | 'antisense';
  frame: 0 | 1 | 2;
  residues: readonly TrackResidue[];
  protein: string;
  unavailableReason?: string;
  canAddToSequence: boolean;
  layerCount: number;
  onStrandChange: (strand: 'sense' | 'antisense') => void;
  onFrameChange: (frame: 0 | 1 | 2) => void;
  onTranslationCodeChange: (translationTableId: number) => void;
  onSelectCodon: (start: number, end: number) => void;
  onCopy: (label: string, value: string) => void;
  onAddToSequence: () => void;
  onAddRecord: () => void;
  onClearLayers: () => void;
  onOpenFloating?: () => void;
}) {
  const proteinPointerRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  const translationCodeMessageId = useId();
  const translationCodeValue = translationCode.supported
    ? String(translationCode.id)
    : translationCode.requestedId === null
      ? '__invalid__'
      : String(translationCode.requestedId);
  const unsupportedTranslationCode = translationCode.supported ? null : translationCode;
  const handleProteinClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const origin = proteinPointerRef.current;
    proteinPointerRef.current = null;
    if (origin && (origin.moved || Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 3)) return;
    if (hasNativeTextSelection()) return;

    const target = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>('[data-residue-index]')
      : null;
    if (!target) return;

    const residueIndex = Number(target.dataset.residueIndex);
    const residue = Number.isInteger(residueIndex) ? residues[residueIndex] : null;
    if (!residue) return;
    onSelectCodon(residue.start, residue.end);
  }, [onSelectCodon, residues]);
  const handleCopyProtein = useCallback(() => {
    const nativeSelection = window.getSelection?.();
    const selectionNodeInReadout = (node: Node | null) => {
      const element = node instanceof Element ? node : node?.parentElement;
      return Boolean(element?.closest('.motif-cs-protein-readout'));
    };
    const selectedProtein = nativeSelection
      && selectionNodeInReadout(nativeSelection.anchorNode)
      && selectionNodeInReadout(nativeSelection.focusNode)
      ? nativeSelection.toString().replace(/\s+/g, '')
      : '';
    if (selectedProtein && /^[A-Za-z*]+$/.test(selectedProtein)) {
      onCopy('Selected protein', selectedProtein);
      return;
    }
    onCopy('Protein', protein);
  }, [onCopy, protein]);
  const handleResidueKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>, residueIndex: number) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      const readout = event.currentTarget.closest<HTMLElement>('.motif-cs-protein-readout');
      const nodes = Array.from(readout?.querySelectorAll<HTMLElement>('[data-residue-index]') ?? []);
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? nodes.length - 1
          : clamp(residueIndex + (event.key === 'ArrowRight' ? 1 : -1), 0, nodes.length - 1);
      const next = nodes[nextIndex];
      if (!next) return;
      event.preventDefault();
      nodes.forEach((node) => { node.tabIndex = node === next ? 0 : -1; });
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const residue = residues[residueIndex];
    if (!residue) return;
    event.preventDefault();
    onSelectCodon(residue.start, residue.end);
  }, [onSelectCodon, residues]);

  if (!canTranslate) {
    return (
      <div className="motif-cs-translation-body">
        <p className="motif-cs-muted">Translations are available for DNA and RNA records.</p>
      </div>
    );
  }

  return (
    <div className="motif-cs-translation-body">
      <div className="motif-cs-translate-target">
        <span className="motif-cs-pane-title">{isWhole ? 'Whole sequence' : 'Selection'}</span>
        <span className="motif-cs-chip" title={targetLabel}>{targetLabel}</span>
      </div>

      <div className="motif-cs-translation-code-control">
        <label>
          <span>Genetic code</span>
          <select
            className="motif-cs-field"
            name="translation-table"
            value={translationCodeValue}
            onChange={(event) => onTranslationCodeChange(Number(event.target.value))}
            aria-invalid={!!unsupportedTranslationCode || undefined}
            aria-describedby={translationCodeMessageId}
          >
            {unsupportedTranslationCode ? (
              <option value={translationCodeValue} disabled>
                {unsupportedTranslationCode.requestedId === null
                  ? 'Malformed feature qualifier'
                  : `Table ${unsupportedTranslationCode.requestedId} unsupported`}
              </option>
            ) : null}
            {ARTIFACT_TRANSLATION_CODE_OPTIONS.map((option) => (
              <option key={option.id} value={String(option.id)}>{option.id} — {option.name}</option>
            ))}
          </select>
        </label>
        <span
          className="motif-cs-form-note"
          id={translationCodeMessageId}
        >
          {translationCodeContext}
        </span>
      </div>

      <div className="motif-cs-translate-controls">
        <div className="motif-cs-segmented" role="group" aria-label="Strand">
          <button type="button" disabled={!!unavailableReason} data-active={strand === 'sense' || undefined} aria-pressed={strand === 'sense'} onClick={() => onStrandChange('sense')}>Sense</button>
          <button type="button" disabled={!!unavailableReason} data-active={strand === 'antisense' || undefined} aria-pressed={strand === 'antisense'} onClick={() => onStrandChange('antisense')}>Antisense</button>
        </div>
        <div className="motif-cs-segmented" role="group" aria-label="Reading frame">
          {([0, 1, 2] as const).map((value) => (
            <button key={value} type="button" disabled={!!unavailableReason} data-active={frame === value || undefined} aria-pressed={frame === value} onClick={() => onFrameChange(value)}>+{value + 1}</button>
          ))}
        </div>
      </div>

      <div className="motif-cs-translate-actions">
        <button className="motif-cs-mini-button" type="button" disabled={!protein} onClick={handleCopyProtein}>Copy</button>
        <button className="motif-cs-mini-button" type="button" disabled={!canAddToSequence || !protein} onClick={onAddToSequence} title={isWhole ? 'Select a region to pin its translation to the sequence' : !canAddToSequence ? 'Multipart translations cannot be represented as one contiguous amino-acid track' : 'Pin this translation to the sequence (above if sense, below if antisense)'}>Add AA track</button>
        <button className="motif-cs-mini-button motif-cs-mini-button-accent" type="button" disabled={!protein} onClick={onAddRecord}>New protein</button>
        {onOpenFloating ? <button className="motif-cs-mini-button" type="button" onClick={onOpenFloating}>Pop out</button> : null}
      </div>

      {protein && residues.length === 0 ? (
        <>
          <div
            className="motif-cs-protein-readout motif-cs-protein-readout-dense"
            aria-label={`Multipart translation, ${protein.length.toLocaleString()} amino acids. Use native text selection or Copy.`}
            translate="no"
          >
            {protein}
          </div>
          <p className="motif-cs-form-note">Multipart feature pieces were stitched in biological order before translation. Codon clicks and a contiguous AA track are unavailable across junctions.</p>
        </>
      ) : protein && residues.length > MAX_INTERACTIVE_TRANSLATION_RESIDUES ? (
        <>
          <div
            className="motif-cs-protein-readout motif-cs-protein-readout-dense"
            aria-label={`Translation, ${protein.length.toLocaleString()} amino acids. Use native text selection or Copy.`}
            translate="no"
          >
            {protein}
          </div>
          <p className="motif-cs-form-note">Large translation shown as selectable text; codon-by-codon buttons are limited to {MAX_INTERACTIVE_TRANSLATION_RESIDUES.toLocaleString()} residues.</p>
        </>
      ) : protein ? (
        <div
          className="motif-cs-protein-readout"
          aria-label="Translation. Drag to select text, or click a residue to select its codon."
          translate="no"
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0) return;
            proteinPointerRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
          }}
          onPointerMove={(event) => {
            const origin = proteinPointerRef.current;
            if (!origin || origin.pointerId !== event.pointerId || origin.moved) return;
            if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 3) origin.moved = true;
          }}
          onPointerUp={(event) => {
            if (event.pointerId !== proteinPointerRef.current?.pointerId) return;
            window.setTimeout(() => {
              proteinPointerRef.current = null;
            }, 0);
          }}
          onPointerCancel={(event) => {
            if (event.pointerId !== proteinPointerRef.current?.pointerId) return;
            proteinPointerRef.current = null;
          }}
          onClick={handleProteinClick}
        >
          {residues.map((residue, residueIndex) => (
            <span
              key={residue.start}
              className="motif-cs-protein-aa"
              role="button"
              tabIndex={residueIndex === 0 ? 0 : -1}
              data-residue-index={residueIndex}
              data-stop={residue.aa === '*' || undefined}
              data-start={residue.aa === 'M' || undefined}
              aria-label={`${residue.aa}, codon ${residue.start + 1}-${residue.end}`}
              onKeyDown={(event) => handleResidueKeyDown(event, residueIndex)}
              title={`${residue.aa} · codon ${residue.start + 1}-${residue.end}`}
            >
              {residue.aa}
            </span>
          ))}
        </div>
      ) : (
        <p className="motif-cs-muted" role={unavailableReason ? 'alert' : undefined}>
          {unavailableReason ?? 'Region is shorter than one codon.'}
        </p>
      )}

      {layerCount > 0 ? (
        <ConfirmDeleteButton
          noun={`${layerCount} pinned translation${layerCount === 1 ? '' : 's'}`}
          idleLabel={`Clear ${layerCount} pinned translation${layerCount === 1 ? '' : 's'}`}
          confirmLabel="Clear all?"
          className="motif-cs-clear-layers"
          onConfirm={onClearLayers}
        />
      ) : null}
    </div>
  );
}

// CRISPR guide-RNA finder: pick a nuclease, scan both strands for PAMs, list
// candidate protospacers. Click a guide to select its protospacer on the sequence;
// copy the spacer. Computed lazily (only when the panel is open) so large records
const GUIDE_GC_LOW = 0.4;
const GUIDE_GC_HIGH = 0.8;
function GuideSearchPanel({
  sequence,
  sequenceType,
  topology,
  scopeRange,
  onSelectRange,
  onCopy,
}: {
  sequence: string;
  sequenceType: SequenceType;
  topology: Topology;
  scopeRange: MapSelectionRange | null;
  onSelectRange: (start: number, end: number) => void;
  onCopy: (label: string, value: string) => void;
}) {
  const [hasOpened, setHasOpened] = useState(false);
  const [nucleaseId, setNucleaseId] = useState<NucleaseId>('spcas9');
  const [shown, setShown] = useState(30);
  const [rnaCopy, setRnaCopy] = useState(true);
  const [activeScopeRange, setActiveScopeRange] = useState<MapSelectionRange | null>(scopeRange);
  const previewSelectionRef = useRef<string | null>(null);
  const scopeStart = scopeRange?.start ?? null;
  const scopeEnd = scopeRange?.end ?? null;
  const scopeKey = scopeStart !== null && scopeEnd !== null ? `${scopeStart}:${scopeEnd}` : 'whole';
  const nuclease = GUIDE_NUCLEASES.find((entry) => entry.id === nucleaseId) ?? GUIDE_NUCLEASES[0];
  const guides = useMemo(
    () => hasOpened ? findGuidesInRange(sequence, sequenceType, nuclease, activeScopeRange, topology) : [],
    [activeScopeRange, hasOpened, sequence, sequenceType, nuclease, topology],
  );
  const isNucleotide = isNucleotideType(sequenceType);
  const asGuide = (spacer: string) => (rnaCopy ? spacer.replace(/T/g, 'U') : spacer);
  const guideChip = isNucleotide ? `${guides.length}${guides.length >= 500 ? '+' : ''}` : 'n/a';
  const scopeLabel = activeScopeRange
    ? `${mapRangeLabel(activeScopeRange, sequence.length)} ${sequenceUnitLabel(sequenceType)}`
    : sequenceLengthLabel(sequence.length, sequenceType);

  useEffect(() => {
    if (previewSelectionRef.current === scopeKey) {
      previewSelectionRef.current = null;
      return;
    }
    setActiveScopeRange(scopeStart !== null && scopeEnd !== null ? { start: scopeStart, end: scopeEnd } : null);
    setShown(30);
  }, [scopeEnd, scopeKey, scopeStart]);

  const revealGuide = useCallback((start: number, end: number) => {
    previewSelectionRef.current = `${start}:${end}`;
    onSelectRange(start, end);
  }, [onSelectRange]);

  return (
    <details
      className="motif-cs-panel"
      name="motif-cs-tools"
      data-rail-tool="guide"
      onToggle={(event) => {
        if ((event.target as HTMLDetailsElement).open) setHasOpened(true);
      }}
    >
      <summary className="motif-cs-panel-head" data-rail-label="G" title="Guide RNA">
        <Crosshair className="motif-cs-panel-icon" size={14} strokeWidth={2.2} aria-hidden="true" />
        <span>Guide RNA (CRISPR)</span>
        <span className="motif-cs-chip">{guideChip}</span>
      </summary>
      <div className="motif-cs-tool-panel-body">
        <RailPopoverTitle title="Guide RNA" meta={guideChip} />
        {!isNucleotide ? (
          <p className="motif-cs-muted">Guide design is available for DNA and RNA records.</p>
        ) : (
          <>
            <div className="motif-cs-guide-controls">
              <select
                className="motif-cs-field"
                name="guide-nuclease"
                value={nucleaseId}
                onChange={(event) => { setNucleaseId(event.target.value as NucleaseId); setShown(30); }}
                aria-label="Nuclease"
              >
                {GUIDE_NUCLEASES.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.name} · {entry.pam || 'no PAM'}</option>
                ))}
              </select>
              <label className="motif-cs-toggle-inline" title="Copy spacers as RNA (U) or DNA (T)">
                <input type="checkbox" name="guide-rna-copy" checked={rnaCopy} onChange={(event) => setRnaCopy(event.target.checked)} />
                <span>RNA</span>
              </label>
            </div>
            <div className="motif-cs-guide-scope" data-scoped={!!activeScopeRange || undefined}>
              <span>{activeScopeRange ? 'Selected range' : 'Whole record'}</span>
              <strong>{scopeLabel}</strong>
            </div>
            <p className="motif-cs-muted motif-cs-guide-note">{nuclease.note}</p>
            {guides.length > 0 ? (
              <>
                <div className="motif-cs-guide-list">
                  {guides.slice(0, shown).map((guide) => {
                    const gcPct = Math.round(guide.gc * 100);
                    const gcOk = guide.gc >= GUIDE_GC_LOW && guide.gc <= GUIDE_GC_HIGH;
                    return (
                      <div className="motif-cs-guide-row" key={guide.id}>
                        <button
                          className="motif-cs-guide-select"
                          type="button"
                          onClick={() => revealGuide(guide.start, guide.end)}
                          title={`Protospacer ${guide.start + 1}-${guide.end} (${guide.strand === 1 ? 'forward' : 'reverse'} strand)${guide.pam ? ` · PAM ${guide.pam}` : ''}`}
                        >
                          <span className="motif-cs-guide-strand" data-strand={guide.strand}>{guide.strand === 1 ? '▶' : '◀'}</span>
                          <span className="motif-cs-guide-pos">{guide.start + 1}</span>
                          <span className="motif-cs-guide-spacer">
                            {nuclease.pamSide === 5 && guide.pam ? <span className="motif-cs-guide-pam">{guide.pam}</span> : null}
                            {guide.spacer}
                            {nuclease.pamSide === 3 && guide.pam ? <span className="motif-cs-guide-pam">{guide.pam}</span> : null}
                          </span>
                          <span
                            className="motif-cs-guide-gc"
                            data-ok={gcOk || undefined}
                            title={`${gcPct}% spacer GC`}
                          >
                            GC {gcPct}%
                          </span>
                        </button>
                        <button
                          className="motif-cs-mini-button motif-cs-guide-copy"
                          type="button"
                          onClick={() => onCopy(`${nuclease.name} spacer`, asGuide(guide.spacer))}
                          title="Copy spacer"
                        >
                          copy
                        </button>
                      </div>
                    );
                  })}
                </div>
                {guides.length > shown ? (
                  <button className="motif-cs-mini-button motif-cs-guide-more" type="button" onClick={() => setShown((value) => value + 30)}>
                    Show more ({guides.length - shown})
                  </button>
                ) : null}
              </>
            ) : (
              <p className="motif-cs-muted">No {nuclease.name} sites found.</p>
            )}
          </>
        )}
      </div>
    </details>
  );
}

function AddEnzymeForm({
  onAdd,
  knownEnzymes,
}: {
  onAdd: (name: string, recognition: string) => string | null;
  knownEnzymes: readonly RestrictionEnzyme[];
}) {
  const [name, setName] = useState('');
  const [recognition, setRecognition] = useState('');
  const [status, setStatus] = useState('');
  const [hasError, setHasError] = useState(false);

  const submit = () => {
    const result = onAdd(name, recognition);
    if (result) {
      setStatus(result);
      setHasError(true);
      return;
    }
    setStatus(`Added ${name.trim() || recognition.toUpperCase()}`);
    setHasError(false);
    setName('');
    setRecognition('');
  };

  return (
    <div className="motif-cs-add-enzyme">
      <div className="motif-cs-add-enzyme-head">
        <span className="motif-cs-add-enzyme-title">Add enzyme / site</span>
        {status ? <span className="motif-cs-chip" role="status" aria-live="polite" aria-atomic="true" id="motif-cs-add-enzyme-status">{status}</span> : null}
      </div>
      <div className="motif-cs-add-enzyme-row">
        <input
          className="motif-cs-field"
          name="custom-enzyme-name"
          autoComplete="off"
          maxLength={MAX_CUSTOM_ENZYME_NAME_LENGTH}
          value={name}
          onChange={(event) => { setName(event.target.value); setHasError(false); setStatus(''); }}
          placeholder="Known enzyme, e.g. EcoRV…"
          aria-label="Known or custom enzyme name"
          aria-invalid={hasError || undefined}
          aria-describedby={status ? 'motif-cs-add-enzyme-status' : undefined}
          list="motif-cs-known-enzymes"
        />
        <datalist id="motif-cs-known-enzymes">
          {knownEnzymes.map((enzyme) => <option key={enzyme.name} value={enzyme.name} />)}
        </datalist>
        <input
          className="motif-cs-field motif-cs-mono-field"
          name="custom-enzyme-recognition"
          autoComplete="off"
          maxLength={MAX_CUSTOM_ENZYME_RECOGNITION_LENGTH}
          value={recognition}
          onChange={(event) => { setRecognition(event.target.value); setHasError(false); setStatus(''); }}
          onKeyDown={(event) => { if (event.key === 'Enter') submit(); }}
          placeholder="Custom motif, e.g. GGTACC…"
          aria-label="Custom enzyme recognition sequence"
          aria-invalid={hasError || undefined}
          aria-describedby={status ? 'motif-cs-add-enzyme-status' : undefined}
          translate="no"
          spellCheck={false}
        />
        <button className="motif-cs-mini-button" type="button" onClick={submit} disabled={!recognition.trim() && !name.trim()}>Add</button>
      </div>
    </div>
  );
}

function RestrictionSourceControls({
  sources,
  enzymeCount,
  onToggle,
}: {
  sources: readonly RestrictionEnzymeSourceId[];
  enzymeCount: number;
  onToggle: (source: RestrictionEnzymeSourceId, enabled: boolean) => void;
}) {
  return (
    <div className="motif-cs-restriction-sources">
      <div className="motif-cs-restriction-sources-head">
        <span>Enzyme Sources</span>
        <span className="motif-cs-panel-meta">{enzymeCount} enzymes</span>
      </div>
      <div className="motif-cs-restriction-source-grid" role="group" aria-label="Restriction enzyme source groups">
        {RESTRICTION_SOURCE_OPTIONS.map((option) => {
          const active = sources.includes(option.id);
          return (
            <button
              key={option.id}
              className="motif-cs-restriction-source"
              type="button"
              data-active={active || undefined}
              aria-pressed={active}
              onClick={() => onToggle(option.id, !active)}
              title={option.description}
            >
              <span className="motif-cs-source-label">{option.label}</span>
              <span className="motif-cs-source-state" data-state={active ? 'on' : 'off'}>{active ? 'On' : 'Off'} · {option.enzymeCount} enz</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RestrictionList({
  sites,
  enzymes,
  sequenceLength,
  topology,
  layout,
  hiddenEnzymes,
  selectedClusterId,
  selectedTickIds,
  onSelect,
  onToggle,
}: {
  sites: readonly RestrictionSite[];
  enzymes: readonly RestrictionEnzyme[];
  sequenceLength: number;
  topology: Topology;
  layout: readonly { clusterId: string; tickIds: readonly string[]; label: { text: string } | null }[];
  hiddenEnzymes: ReadonlySet<string>;
  selectedClusterId: string | null;
  selectedTickIds: readonly string[];
  onSelect: (clusterId: string, tickIds: readonly string[], enzyme?: string) => void;
  onToggle: (enzyme: string, visible: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const counts = new Map<string, number>();
  const enzymeByName = new Map(enzymes.map((enzyme) => [enzyme.name.toLowerCase(), enzyme]));
  for (const site of sites) counts.set(site.enzyme, (counts.get(site.enzyme) ?? 0) + 1);
  const clustersByName = new Map<string, { clusterId: string; tickIds: readonly string[] }>();
  const clustersByTickId = new Map<string, { clusterId: string; tickIds: readonly string[] }>();
  for (const cluster of layout) {
    for (const tickId of cluster.tickIds) {
      const enzyme = tickId.split('@')[0];
      if (enzyme && !clustersByName.has(enzyme)) clustersByName.set(enzyme, cluster);
      clustersByTickId.set(tickId, cluster);
    }
  }

  const rows = Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b));
  const selectedTickSet = new Set(selectedTickIds);
  const visibleSites = sites
    .filter((site) => !hiddenEnzymes.has(site.enzyme))
    .sort((a, b) => (a.position - b.position) || a.enzyme.localeCompare(b.enzyme));
  const normalizedQuery = query.trim().toLowerCase();
  const siteMatchesQuery = (site: RestrictionSite) => {
    if (!normalizedQuery) return true;
    return site.enzyme.toLowerCase().includes(normalizedQuery)
      || site.recognitionSequence.toLowerCase().includes(normalizedQuery)
      || String(site.position + 1).includes(normalizedQuery);
  };
  const filteredVisibleSites = visibleSites.filter(siteMatchesQuery);
  const filteredRows = rows.filter(([enzyme]) => {
    if (!normalizedQuery) return true;
    const definition = enzymeByName.get(enzyme.toLowerCase());
    return enzyme.toLowerCase().includes(normalizedQuery)
      || definition?.recognitionSequence.toLowerCase().includes(normalizedQuery)
      || sites.some((site) => site.enzyme === enzyme && siteMatchesQuery(site));
  });
  const shownSites = filteredVisibleSites.slice(0, 160);
  const visibleEnzymeCount = filteredRows.filter(([enzyme]) => !hiddenEnzymes.has(enzyme)).length;

  return (
    <div className="motif-cs-list motif-cs-restriction-list">
      <label className="motif-cs-restriction-filter">
        <span className="motif-cs-visually-hidden">Filter restriction sites and enzymes</span>
        <input
          className="motif-cs-field"
          type="search"
          name="restriction-filter"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter enzyme, motif, or position…"
          aria-label="Filter restriction sites and enzymes"
        />
      </label>
      {shownSites.length > 0 ? (
        <div className="motif-cs-restriction-site-list" aria-label="Selectable restriction sites">
          <div className="motif-cs-restriction-site-head" aria-label={`Sites ${shownSites.length}${filteredVisibleSites.length > shownSites.length ? ` of ${filteredVisibleSites.length}` : ''}`}>
            <span>Sites </span>
            <small>{shownSites.length}{filteredVisibleSites.length > shownSites.length ? ` of ${filteredVisibleSites.length}` : ''}</small>
          </div>
          {shownSites.map((site) => {
            const tickId = restrictionSiteTickId(site);
            const layoutTickId = restrictionSiteLayoutTickId(site);
            const cluster = clustersByTickId.get(layoutTickId);
            const active = restrictionSelectionHasSite(selectedTickSet, site);
            const enzyme = enzymeByName.get(site.enzyme.toLowerCase());
            const typeIIS = restrictionEnzymeIsTypeIIS(enzyme);
            const geometry = enzyme ? restrictionCutGeometry(site, enzyme, sequenceLength, topology) : null;
            const cutLabel = geometry
              ? geometry.senseCut === geometry.antisenseCut
                ? `cut ${geometry.senseCut + 1}`
                : `cuts ${geometry.senseCut + 1}/${geometry.antisenseCut + 1}`
              : `cut ${site.cutPosition + 1}`;
            const overhang = site.overhang ?? enzyme?.overhang ?? 'blunt';
            const overhangLabel = overhang === '5prime' ? "5′" : overhang === '3prime' ? "3′" : 'blunt';
            return (
              <button
                key={tickId}
                type="button"
                className="motif-cs-restriction-site-row"
                data-active={active || undefined}
                aria-pressed={active}
                onClick={() => cluster && onSelect(cluster.clusterId, [tickId], site.enzyme)}
                disabled={!cluster}
                title={`${site.enzyme} ${site.recognitionSequence} at ${site.position + 1}, ${cutLabel}, ${overhangLabel} overhang, ${site.strand === -1 ? 'reverse' : 'forward'} strand`}
              >
                <span className="motif-cs-row-main" translate="no">
                  {site.enzyme}
                  <small>{site.recognitionSequence}{typeIIS ? ' · Type IIS' : ''}</small>
                </span>
                <span className="motif-cs-row-meta">
                  {site.position + 1} · {cutLabel} · {overhangLabel}
                </span>
              </button>
            );
          })}
          {filteredVisibleSites.length > shownSites.length ? (
            <p className="motif-cs-muted">Showing first {shownSites.length} visible sites. Hide enzymes or use narrower sources to reduce the list.</p>
          ) : null}
        </div>
      ) : (
        <p className="motif-cs-muted motif-cs-restriction-empty">
          {normalizedQuery ? 'No visible sites match this filter.' : 'No visible sites. Enable a source group or add a custom enzyme below.'}
        </p>
      )}
      <div className="motif-cs-restriction-enzyme-list" aria-label="Enzyme visibility controls">
        <div className="motif-cs-restriction-enzyme-head" aria-label={`Enzymes ${visibleEnzymeCount} of ${filteredRows.length} visible`}>
          <span>Enzymes </span>
          <small>{visibleEnzymeCount}/{filteredRows.length} visible</small>
        </div>
        {filteredRows.length > 0 ? filteredRows.map(([enzyme, count]) => {
          const cluster = clustersByName.get(enzyme);
          const visible = !hiddenEnzymes.has(enzyme);
          const enzymeSelected = visibleSites.some((site) => site.enzyme === enzyme && restrictionSelectionHasSite(selectedTickSet, site));
          return (
            <div
              key={enzyme}
              className="motif-cs-restriction-row"
              data-active={(cluster?.clusterId === selectedClusterId || enzymeSelected) || undefined}
              data-hidden={!visible || undefined}
            >
              <label className="motif-cs-toggle">
                <input
                  type="checkbox"
                  name={`restriction-visible-${enzyme}`}
                  checked={visible}
                  onChange={(event) => onToggle(enzyme, event.target.checked)}
                  aria-label={`${visible ? 'Hide' : 'Show'} ${enzyme}`}
                />
                <span className="motif-cs-cut-dot" />
              </label>
              <button
                className="motif-cs-restriction-select"
                type="button"
                aria-pressed={cluster?.clusterId === selectedClusterId || enzymeSelected}
                onClick={() => visible && cluster && onSelect(cluster.clusterId, cluster.tickIds, enzyme)}
                disabled={!visible || !cluster}
              >
                <span className="motif-cs-row-main" translate="no">{enzyme}</span>
                <span className="motif-cs-row-meta">{count} cut{count === 1 ? '' : 's'}</span>
              </button>
            </div>
          );
        }) : (
          <p className="motif-cs-muted">{normalizedQuery ? 'No enzymes match this filter.' : 'No sites for the selected enzyme sources.'}</p>
        )}
      </div>
      {filteredRows.length > 0 ? (
        <p className="motif-cs-muted motif-cs-restriction-note">Checkboxes show or hide all cuts from an enzyme. Site rows select one cut position.</p>
      ) : null}
    </div>
  );
}

// An inline amino-acid track: one contiguous translated region shown aligned to
// the bases, NOT a whole-entry frame. Forward tracks render
// above the bases, reverse tracks below.
type InlineTranslationTrack = {
  id: string;
  label: string;
  start: number; // plus-strand, inclusive
  end: number;   // plus-strand, exclusive
  strand: 1 | -1;
  frame: 0 | 1 | 2;
  translationTableId: number;
  source: 'feature' | 'layer';
  color?: string;
  needsReview?: boolean;
  completeCds?: boolean;
  featureId?: string;
};

// One residue placed in PLUS-STRAND codon coordinates so it aligns to the bases
// and hit-tests as a normal range regardless of strand.
type TrackResidue = { aa: string; start: number; end: number };

// Coding feature types whose annotation already implies a translated product —
// only these get an inline amino-acid track. A plain DNA entry therefore shows no
// translation until the user selects a region (or a CDS/gene is annotated), which
// is the point: no arbitrary whole-entry frame smeared under every line.
const CODING_FEATURE_TYPES: ReadonlySet<FeatureType> = new Set<FeatureType>([
  'cds', 'gene', 'orf', 'resistance', 'mat_peptide', 'sig_peptide', 'transit_peptide', 'exon',
]);

// INSDC /transl_table is meaningful for CDS-like annotations. Other feature
// types can still display an amino-acid track, but they inherit the record code.
const TRANSLATION_CODE_FEATURE_TYPES: ReadonlySet<FeatureType> = new Set<FeatureType>(['cds', 'orf']);

// /codon_start (1|2|3) → 0-based frame offset from the feature's 5' end.
function codonStartFrame(metadata: Record<string, unknown> | undefined): 0 | 1 | 2 {
  const raw = Number(metadata?.codon_start ?? (metadata as Record<string, unknown> | undefined)?.codonStart);
  if (raw === 2) return 1;
  if (raw === 3) return 2;
  return 0;
}

function featureTranslationSignature(feature: Feature): string {
  return JSON.stringify({
    type: feature.type,
    strand: feature.strand,
    location: featureLocationCoordinateSignature(feature),
    frame: codonStartFrame(feature.metadata),
    translationTable: TRANSLATION_CODE_FEATURE_TYPES.has(feature.type)
      ? artifactFeatureTranslationTableValue(feature.metadata)
      : '',
    completeCds: isCompleteCodingFeature(feature),
  });
}

function isCompleteCodingFeature(feature: Feature): boolean {
  if (feature.type !== 'cds' && feature.type !== 'orf') return false;
  if (feature.strand !== 1 && feature.strand !== -1) return false;
  if (codonStartFrame(feature.metadata) !== 0) return false;
  if (feature.metadata.partial === true || feature.metadata.pseudo === true) return false;
  const originalLocation = feature.metadata.motifOriginalLocation;
  return typeof originalLocation !== 'string' || !/[<>]/.test(originalLocation);
}

// Residues of one track in plus-strand codon coordinates. Reverse tracks read the
// reverse-complement of the region from its 3' end; every returned codon is still
// expressed in plus-strand coordinates.
function inlineTrackResidues(
  sequence: string,
  sequenceType: SequenceType,
  track: InlineTranslationTrack,
  topology: Topology,
): TrackResidue[] {
  if (!isNucleotideType(sequenceType)) return [];
  const spans = normalizeSpan(track.start, track.end, sequence.length, topology);
  if (spans.length === 0) return [];
  const region = spans.map((span) => sequence.slice(span.start, span.end)).join('');
  if (region.length < 3) return [];
  const source = track.strand === -1 ? reverseComplement(region, sequenceType === 'rna') : region;
  const table = resolveArtifactTranslationCode(track.translationTableId);
  if (!table.supported) return [];
  const aminoAcids = track.completeCds
    ? translateCompleteCds(source, track.frame, table.table)
    : translate(source, track.frame, table.table);
  const residues: TrackResidue[] = [];
  for (let i = 0; i < aminoAcids.length; i += 1) {
    const off = track.frame + i * 3;
    if (off + 3 > region.length) break;
    const rangeOffset = track.strand === -1 ? region.length - off - 3 : off;
    residues.push({ aa: aminoAcids[i], ...codonRangeFromRangeOffset(spans, rangeOffset, sequence.length) });
  }
  return residues;
}

type LineFeatureBlock = {
  feature: Feature;
  start: number;
  end: number;
  segmentStart: number;
  segmentEnd: number;
  segmentIndex: number;
  isStart: boolean;
  isEnd: boolean;
};

type RestrictionCutGeometry = {
  site: RestrictionSite;
  enzyme: RestrictionEnzyme;
  senseCut: number;
  antisenseCut: number;
};

type LineRestrictionLabel = {
  key: string;
  sites: RestrictionSite[];
  label: string;
  start: number;
  end: number;
};

function normalizeRestrictionCut(cut: number, sequenceLength: number, topology: Topology): number | null {
  if (sequenceLength <= 0) return null;
  if (topology === 'circular') return ((cut % sequenceLength) + sequenceLength) % sequenceLength;
  return cut >= 0 && cut <= sequenceLength ? cut : null;
}

function restrictionCutGeometry(
  site: RestrictionSite,
  enzyme: RestrictionEnzyme,
  sequenceLength: number,
  topology: Topology,
): RestrictionCutGeometry | null {
  const recognitionLength = enzyme.recognitionSequence.length;
  const senseRaw = site.strand === -1
    ? site.position + recognitionLength - enzyme.complementCutOffset
    : site.position + enzyme.cutOffset;
  const antisenseRaw = site.strand === -1
    ? site.position + recognitionLength - enzyme.cutOffset
    : site.position + enzyme.complementCutOffset;
  const senseCut = normalizeRestrictionCut(senseRaw, sequenceLength, topology);
  const antisenseCut = normalizeRestrictionCut(antisenseRaw, sequenceLength, topology);
  if (senseCut === null || antisenseCut === null) return null;
  return { site, enzyme, senseCut, antisenseCut };
}

function restrictionCutBelongsToLine(cut: number, lineStart: number, lineEnd: number, sequenceLength: number): boolean {
  return (cut >= lineStart && cut < lineEnd) || (cut === sequenceLength && lineEnd === sequenceLength);
}

function restrictionLabelLanesForLine(
  sites: readonly RestrictionSite[],
  lineStart: number,
  lineEnd: number,
): { lanes: LineRestrictionLabel[][]; hidden: number } {
  const grouped = new Map<string, RestrictionSite[]>();
  for (const site of sites) {
    if (site.position < lineStart || site.position >= lineEnd) continue;
    const key = `${site.position}:${site.recognitionSequence}:${site.strand === -1 ? -1 : 1}`;
    const group = grouped.get(key) ?? [];
    group.push(site);
    grouped.set(key, group);
  }
  const labels = Array.from(grouped.entries()).map(([key, group]) => {
    const label = group.map((site) => site.enzyme).sort((a, b) => a.localeCompare(b)).join('/');
    const start = group[0].position;
    // Labels use a slightly smaller mono face than bases, but reserving one full
    // base cell per character keeps dense loci collision-free across fonts.
    const estimatedWidth = Math.max(group[0].recognitionSequence.length, Math.min(20, label.length + 3));
    return { key, sites: group, label, start, end: start + estimatedWidth };
  }).sort((a, b) => a.start - b.start || a.label.localeCompare(b.label));

  const lanes: LineRestrictionLabel[][] = [];
  let hidden = 0;
  for (const label of labels) {
    let placed = false;
    for (const lane of lanes) {
      const previous = lane[lane.length - 1];
      if (!previous || previous.end + 1 <= label.start) {
        lane.push(label);
        placed = true;
        break;
      }
    }
    if (!placed && lanes.length < 4) lanes.push([label]);
    else if (!placed) hidden += 1;
  }
  return { lanes, hidden };
}

function featureLanesForLine(
  features: readonly Feature[],
  lineStart: number,
  lineEnd: number,
  sequenceLength: number,
  topology: Topology,
): LineFeatureBlock[][] {
  const blocks = features
    .flatMap((feature) => mapFeatureSegments(feature, sequenceLength, topology).map((segment, segmentIndex) => ({
      feature,
      start: Math.max(lineStart, segment.start),
      end: Math.min(lineEnd, segment.end),
      segmentStart: segment.start,
      segmentEnd: segment.end,
      segmentIndex,
      isStart: segment.isStart,
      isEnd: segment.isEnd,
    })))
    .filter((block) => block.end > block.start)
    .sort((a, b) => a.start - b.start || b.end - a.end || a.feature.name.localeCompare(b.feature.name));

  const lanes: LineFeatureBlock[][] = [];
  for (const block of blocks) {
    let placed = false;
    for (const lane of lanes) {
      const previous = lane[lane.length - 1];
      if (!previous || previous.end <= block.start) {
        lane.push(block);
        placed = true;
        break;
      }
    }
    if (!placed && lanes.length < 4) lanes.push([block]);
  }
  return lanes;
}

// One inline amino-acid track on one line. Residues are absolutely positioned in
// `ch` over their codon (3 ch wide, centered) so each letter sits above/below its
// three bases, and clicking a residue selects that codon. Rendered inside a memo
// (via translationByLine) so a selection drag never rebuilds these spans.
type LineResidue = TrackResidue & { left: number };
function TranslationTrackRow({
  trackId,
  label,
  color,
  residues,
  keyboardAnchorStart,
  selected,
  onSelectTrack,
  onSelectCodon,
}: {
  trackId: string;
  label: string;
  color?: string;
  residues: readonly LineResidue[];
  keyboardAnchorStart: number;
  selected: boolean;
  onSelectTrack: () => void;
  onSelectCodon: (start: number, end: number) => void;
}) {
  const selectTrackText = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (residues.length === 0) return;
    onSelectTrack();
  }, [onSelectTrack, residues.length]);

  const moveResidueFocus = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return false;
    const sequence = event.currentTarget.closest<HTMLElement>('.motif-cs-sequence');
    const nodes = Array.from(sequence?.querySelectorAll<HTMLElement>('.motif-cs-seq-aa[data-aa-track-id]') ?? [])
      .filter((node) => node.dataset.aaTrackId === trackId)
      .sort((a, b) => Number(a.dataset.codonStart) - Number(b.dataset.codonStart));
    const index = nodes.indexOf(event.currentTarget);
    if (index < 0 || nodes.length === 0) return false;
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? nodes.length - 1
        : clamp(index + (event.key === 'ArrowRight' ? 1 : -1), 0, nodes.length - 1);
    const next = nodes[nextIndex];
    event.preventDefault();
    nodes.forEach((node) => { node.tabIndex = node === next ? 0 : -1; });
    next.focus({ preventScroll: true });
    const scroller = next.closest<HTMLElement>('.motif-cs-sequence');
    if (scroller) {
      const scrollerRect = scroller.getBoundingClientRect();
      const nextRect = next.getBoundingClientRect();
      if (nextRect.top < scrollerRect.top + 24 || nextRect.bottom > scrollerRect.bottom - 24) {
        scroller.scrollBy({ top: nextRect.top - scrollerRect.top - scrollerRect.height / 2, behavior: 'auto' });
      }
    }
    return true;
  }, [trackId]);

  const keyboardAnchorOnLine = residues.some((residue) => residue.start === keyboardAnchorStart);

  return (
    <div className="motif-cs-seq-aa-row" data-aa-track-selected={selected || undefined}>
      <button
        type="button"
        className="motif-cs-seq-index motif-cs-aa-row-label"
        title={`${label} · click to select amino acids for copy`}
        aria-label={`${label} translation. Select amino acids for copy.`}
        aria-pressed={selected}
        tabIndex={keyboardAnchorOnLine ? 0 : -1}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={selectTrackText}
      >
        {color ? <span className="motif-cs-aa-row-dot" style={{ background: color }} aria-hidden="true" /> : null}
        {label}
      </button>
      <div className="motif-cs-aa-track">
        {residues.map((residue) => (
          <span
            key={residue.start}
            role="button"
            tabIndex={residue.start === keyboardAnchorStart ? 0 : -1}
            className="motif-cs-seq-aa"
            data-aa-track-id={trackId}
            data-codon-start={residue.start}
            data-stop={residue.aa === '*' || undefined}
            data-start={residue.aa === 'M' || undefined}
            style={{ left: `${residue.left}ch` }}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (selected) window.getSelection?.()?.removeAllRanges();
            }}
            onClick={(event) => {
              if (hasNativeTextSelection()) return;
              event.stopPropagation();
              onSelectCodon(residue.start, residue.end);
            }}
            onKeyDown={(event) => {
              if (moveResidueFocus(event)) return;
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              onSelectCodon(residue.start, residue.end);
            }}
            aria-label={`${residue.aa}, codon ${residue.start + 1}-${residue.end}`}
            title={`${residue.aa} · codon ${residue.start + 1}-${residue.end}`}
          >
            {residue.aa}
          </span>
        ))}
      </div>
    </div>
  );
}

const SequenceText = memo(function SequenceText({
  sequence,
  sequenceType,
  topology,
  features,
  selectedFeature,
  selectedMapRange,
  focusRequest,
  motifHits,
  motifLength,
  restrictionSites,
  restrictionEnzymes,
  selectedRestrictionTickIds,
  translationTracks,
  showComplement,
  detailMode,
  caret,
  editable,
  onFeatureSelect,
  onRestrictionSelect,
  onTranslationTrackSelect,
  onTranslationCodonSelect,
  onRangeSelect,
  onPlaceCaret,
  onEditKeyDown,
  onPaste,
}: {
  sequence: string;
  sequenceType: SequenceType;
  topology: Topology;
  features: readonly Feature[];
  selectedFeature: Feature | null;
  selectedMapRange: MapSelectionRange | null;
  focusRequest: number;
  motifHits: readonly number[];
  motifLength: number;
  restrictionSites: readonly RestrictionSite[];
  restrictionEnzymes: readonly RestrictionEnzyme[];
  selectedRestrictionTickIds: readonly string[];
  translationTracks: readonly InlineTranslationTrack[];
  showComplement: boolean;
  detailMode: boolean;
  caret: number | null;
  editable: boolean;
  onFeatureSelect: (featureId: string) => void;
  onRestrictionSelect: (site: RestrictionSite) => void;
  onTranslationTrackSelect: (track: InlineTranslationTrack) => void;
  onTranslationCodonSelect: (
    start: number,
    end: number,
    strand: 1 | -1,
    translationTableId?: number,
    featureId?: string,
    translationSource?: 'feature' | 'layer',
  ) => void;
  onRangeSelect: (start: number, end: number) => void;
  onPlaceCaret: (index: number) => void;
  onEditKeyDown: (event: ReactKeyboardEvent) => void;
  onPaste: (event: ReactClipboardEvent) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLSpanElement>(null);
  const charWidthRef = useRef<number>(0);
  const dragAnchorRef = useRef<number | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const lastIdxRef = useRef<number>(-1);
  const didDragRef = useRef<boolean>(false);
  const suppressNextFocusScrollRef = useRef(false);
  // Coalesce pointermove → at most one selection update per animation frame.
  const rafRef = useRef<number | null>(null);
  const pendingPointRef = useRef<{ x: number; y: number } | null>(null);
  const aaCopyBufferRef = useRef<HTMLSpanElement>(null);
  const keyboardSelectionAnchorRef = useRef<number | null>(null);
  const keyboardSelectionFocusRef = useRef<number | null>(null);
  const [selectedAaTrackId, setSelectedAaTrackId] = useState<string | null>(null);
  const [selectedAaTrackText, setSelectedAaTrackText] = useState('');
  const [hoveredRestrictionTickIds, setHoveredRestrictionTickIds] = useState<readonly string[]>([]);

  const selectLocalRange = useCallback((start: number, end: number) => {
    setSelectedAaTrackId(null);
    setSelectedAaTrackText('');
    suppressNextFocusScrollRef.current = true;
    onRangeSelect(start, end);
  }, [onRangeSelect]);

  const selectInlineTranslationTrack = useCallback((trackId: string, protein: string) => {
    if (!protein) return;
    const track = translationTracks.find((candidate) => candidate.id === trackId);
    if (!track) return;
    suppressNextFocusScrollRef.current = true;
    setSelectedAaTrackId(trackId);
    setSelectedAaTrackText(protein);
    onTranslationTrackSelect(track);
  }, [onTranslationTrackSelect, translationTracks]);

  useEffect(() => {
    if (!selectedAaTrackId) return;
    const stillPresent = translationTracks.some((track) => track.id === selectedAaTrackId);
    if (stillPresent) return;
    setSelectedAaTrackId(null);
    setSelectedAaTrackText('');
  }, [selectedAaTrackId, translationTracks]);

  useLayoutEffect(() => {
    if (!selectedAaTrackId || !selectedAaTrackText) return;
    const node = aaCopyBufferRef.current;
    const selection = window.getSelection?.();
    if (!node || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  }, [selectedAaTrackId, selectedAaTrackText]);

  const aaCopyBufferIsSelected = useCallback(() => {
    const node = aaCopyBufferRef.current;
    const selection = window.getSelection?.();
    if (!node || !selection || selection.rangeCount === 0) return false;
    const { anchorNode, focusNode } = selection;
    return Boolean(anchorNode && focusNode && node.contains(anchorNode) && node.contains(focusNode));
  }, []);

  const writeSelectedAaToClipboard = useCallback((clipboardData: DataTransfer | null) => {
    if (!selectedAaTrackText || !clipboardData || !aaCopyBufferIsSelected()) return false;
    clipboardData.setData('text/plain', selectedAaTrackText);
    return true;
  }, [aaCopyBufferIsSelected, selectedAaTrackText]);

  useEffect(() => {
    if (!selectedAaTrackText) return undefined;
    const handleDocumentCopy = (event: ClipboardEvent) => {
      if (!writeSelectedAaToClipboard(event.clipboardData)) return;
      event.preventDefault();
    };
    document.addEventListener('copy', handleDocumentCopy);
    return () => document.removeEventListener('copy', handleDocumentCopy);
  }, [selectedAaTrackText, writeSelectedAaToClipboard]);

  const handleCopy = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    if (selectedAaTrackText && writeSelectedAaToClipboard(event.clipboardData)) {
      event.preventDefault();
      return;
    }

    const container = containerRef.current;
    const nativeSelection = window.getSelection?.();
    const anchorNode = nativeSelection?.anchorNode;
    const focusNode = nativeSelection?.focusNode;
    const selectionIsInsideSequence = Boolean(
      container
      && nativeSelection
      && nativeSelection.rangeCount > 0
      && anchorNode
      && focusNode
      && container.contains(anchorNode)
      && container.contains(focusNode),
    );
    if (!selectedMapRange || !selectionIsInsideSequence) return;
    event.clipboardData.setData('text/plain', sequenceForRange(sequence, selectedMapRange, topology));
    event.preventDefault();
  }, [selectedAaTrackText, selectedMapRange, sequence, topology, writeSelectedAaToClipboard]);

  // Bases per line adapt to the pane width so the sequence fills the available
  // space instead of leaving a fixed 60-char column with dead space to the right.
  // Rounded down to a multiple of 5: line starts remain easy to scan while narrow
  // panes no longer waste nearly ten characters of usable width. Ribbons and the
  // translation track are positioned per-line in `ch`, so any width stays locked.
  const [basesPerLine, setBasesPerLine] = useState(60);
  useLayoutEffect(() => {
    const container = containerRef.current;
    const ruler = rulerRef.current;
    if (!container || !ruler) return undefined;
    const RULER_CHARS = 100;
    const measure = () => {
      const charW = ruler.getBoundingClientRect().width / RULER_CHARS;
      if (!(charW > 0)) return;
      charWidthRef.current = charW; // reused for geometric (exact) hit-testing
      const cs = window.getComputedStyle(container);
      const padX = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');
      // 48px line-number gutter + 10px grid gap (see .motif-cs-seq-line), with a
      // small rounding reserve so narrow panes never gain a horizontal scrollbar.
      const basesWidth = container.clientWidth - padX - 48 - 10 - 10;
      const fit = Math.floor(basesWidth / charW);
      const next = clamp(Math.floor(fit / 5) * 5, 15, 300);
      setBasesPerLine((prev) => (prev === next ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Geometric hit-testing: map a pointer to a base index from the row's left edge
  // and the measured monospace char width. This is exact to the base under the
  // cursor (no per-span DOM), and O(1) via elementFromPoint; it only scans rows
  // when the pointer is over a gap (ribbons / translation line) so a vertical drag
  // still tracks the nearest bases row instead of stalling.
  const baseIndexFromPoint = useCallback((clientX: number, clientY: number): number | null => {
    const container = containerRef.current;
    const charW = charWidthRef.current;
    if (!container || !(charW > 0)) return null;
    let row = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-line-start]') ?? null;
    if (!row || !container.contains(row)) {
      let best: HTMLElement | null = null;
      let bestDist = Infinity;
      container.querySelectorAll<HTMLElement>('[data-line-start]').forEach((candidate) => {
        const r = candidate.getBoundingClientRect();
        const dist = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
        if (dist < bestDist) {
          bestDist = dist;
          best = candidate;
        }
      });
      row = best;
    }
    if (!row) return null;
    const lineStart = Number(row.dataset.lineStart);
    const lineLen = Number(row.dataset.lineLen);
    if (!Number.isFinite(lineStart) || !Number.isFinite(lineLen)) return null;
    const rect = row.getBoundingClientRect();
    const offset = clamp(Math.floor((clientX - rect.left) / charW), 0, Math.max(0, lineLen - 1));
    return lineStart + offset;
  }, []);

  const applyDragToPoint = useCallback((clientX: number, clientY: number) => {
    const anchor = dragAnchorRef.current;
    if (anchor === null) return;
    const idx = baseIndexFromPoint(clientX, clientY);
    if (idx === null || idx === lastIdxRef.current) return;
    lastIdxRef.current = idx;
    if (idx !== anchor) didDragRef.current = true;
    if (didDragRef.current) selectLocalRange(Math.min(anchor, idx), Math.max(anchor, idx) + 1);
  }, [baseIndexFromPoint, selectLocalRange]);

  const handleBasesPointerDown = useCallback((event: ReactPointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    const idx = baseIndexFromPoint(event.clientX, event.clientY);
    if (idx === null) return;
    dragAnchorRef.current = idx;
    dragPointerIdRef.current = event.pointerId;
    dragStartPointRef.current = { x: event.clientX, y: event.clientY };
    keyboardSelectionAnchorRef.current = null;
    keyboardSelectionFocusRef.current = null;
    lastIdxRef.current = idx;
    didDragRef.current = false;
    containerRef.current?.focus({ preventScroll: true });
    try {
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    } catch {
      /* capture is best-effort; pointermove still fires on the container */
    }
  }, [baseIndexFromPoint]);

  const handleBasesPointerMove = useCallback((event: ReactPointerEvent) => {
    if (dragAnchorRef.current === null || event.pointerId !== dragPointerIdRef.current) return;
    // Coalesce: remember the latest point, process once per frame.
    pendingPointRef.current = { x: event.clientX, y: event.clientY };
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const point = pendingPointRef.current;
      if (point) applyDragToPoint(point.x, point.y);
    });
  }, [applyDragToPoint]);

  const handleBasesPointerUp = useCallback((event: ReactPointerEvent) => {
    const anchor = dragAnchorRef.current;
    if (anchor === null || event.pointerId !== dragPointerIdRef.current) return;
    const startPoint = dragStartPointRef.current;
    if ((event.currentTarget as HTMLElement).hasPointerCapture?.(event.pointerId)) {
      (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    }
    dragAnchorRef.current = null;
    dragPointerIdRef.current = null;
    dragStartPointRef.current = null;
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingPointRef.current = null;
    const idx = baseIndexFromPoint(event.clientX, event.clientY) ?? anchor;
    // Authoritative at release, but only when the pointer actually moved. On a
    // plain click, browser hit-testing can resolve pointerdown/up to neighboring
    // line boxes; treating that index mismatch as a drag makes editing impossible
    // because every click becomes a range selection.
    const moved = startPoint ? Math.hypot(event.clientX - startPoint.x, event.clientY - startPoint.y) > 3 : false;
    const dragged = didDragRef.current || (moved && idx !== anchor);
    if (dragged && idx !== anchor) {
      selectLocalRange(Math.min(anchor, idx), Math.max(anchor, idx) + 1);
    } else if (editable) {
      onPlaceCaret(anchor);
    } else {
      selectLocalRange(anchor, anchor + 1);
    }
    didDragRef.current = false;
  }, [baseIndexFromPoint, selectLocalRange, onPlaceCaret, editable]);

  const handleBasesPointerCancel = useCallback((event: ReactPointerEvent) => {
    if (event.pointerId !== dragPointerIdRef.current) return;
    if ((event.currentTarget as HTMLElement).hasPointerCapture?.(event.pointerId)) {
      (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    }
    dragAnchorRef.current = null;
    dragPointerIdRef.current = null;
    dragStartPointRef.current = null;
    pendingPointRef.current = null;
    didDragRef.current = false;
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const handleSequenceKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const selectionKeys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && selectionKeys.includes(event.key)) {
      let anchor = keyboardSelectionAnchorRef.current;
      let focus = keyboardSelectionFocusRef.current;
      if (anchor === null || focus === null) {
        if (caret !== null) {
          anchor = caret;
          focus = caret;
        } else if (selectedMapRange) {
          anchor = clamp(selectedMapRange.start, 0, sequence.length);
          focus = clamp(selectedMapRange.end, 0, sequence.length);
        } else {
          anchor = 0;
          focus = 0;
        }
      }
      const nextFocus = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? sequence.length
          : clamp(focus + (event.key === 'ArrowRight' ? 1 : -1), 0, sequence.length);
      event.preventDefault();
      keyboardSelectionAnchorRef.current = anchor;
      keyboardSelectionFocusRef.current = nextFocus;
      if (nextFocus === anchor) {
        if (editable) onPlaceCaret(anchor);
        else if (sequence.length > 0) selectLocalRange(Math.max(0, anchor - 1), Math.max(1, anchor));
      } else {
        selectLocalRange(Math.min(anchor, nextFocus), Math.max(anchor, nextFocus));
      }
      return;
    }
    if (selectionKeys.includes(event.key) && !event.shiftKey) {
      keyboardSelectionAnchorRef.current = null;
      keyboardSelectionFocusRef.current = null;
    }
    onEditKeyDown(event);
  }, [caret, editable, onEditKeyDown, onPlaceCaret, selectLocalRange, selectedMapRange, sequence.length]);

  useEffect(() => () => {
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
  }, []);
  const selectedRanges = selectedFeature
    ? featureSpans(selectedFeature, sequence.length, topology)
    : selectedMapRange
      ? normalizeSpan(selectedMapRange.start, selectedMapRange.end, sequence.length, topology)
      : [];
  const motifRanges = motifLength > 0
    ? motifHits.flatMap((hit) => normalizeSpan(hit, hit + motifLength, sequence.length, topology))
    : [];
  const selectedRestrictionTickSet = useMemo(
    () => new Set(selectedRestrictionTickIds),
    [selectedRestrictionTickIds],
  );
  const activeRestrictionTickSet = useMemo(
    () => new Set([...selectedRestrictionTickIds, ...hoveredRestrictionTickIds]),
    [hoveredRestrictionTickIds, selectedRestrictionTickIds],
  );
  const activeRestrictionRanges = detailMode
    ? restrictionSites
      .filter((site) => restrictionSelectionHasSite(activeRestrictionTickSet, site))
      .flatMap((site) => normalizeSpan(site.position, site.position + site.recognitionSequence.length, sequence.length, topology))
    : [];
  const restrictionGeometry = useMemo(() => {
    if (!detailMode || !isNucleotideType(sequenceType) || restrictionSites.length === 0) return [];
    const enzymeByName = new Map(restrictionEnzymes.map((enzyme) => [enzyme.name.toLowerCase(), enzyme]));
    return restrictionSites.flatMap((site) => {
      const enzyme = enzymeByName.get(site.enzyme.toLowerCase());
      if (!enzyme) return [];
      const geometry = restrictionCutGeometry(site, enzyme, sequence.length, topology);
      return geometry ? [geometry] : [];
    });
  }, [detailMode, restrictionEnzymes, restrictionSites, sequence.length, sequenceType, topology]);
  const restrictionLabelsByLine = useMemo(() => {
    const labels = new Map<number, ReturnType<typeof restrictionLabelLanesForLine>>();
    if (!detailMode || restrictionSites.length === 0) return labels;
    for (let lineStart = 0; lineStart < sequence.length; lineStart += basesPerLine) {
      const lineEnd = Math.min(sequence.length, lineStart + basesPerLine);
      const lineLabels = restrictionLabelLanesForLine(restrictionSites, lineStart, lineEnd);
      if (lineLabels.lanes.length > 0 || lineLabels.hidden > 0) labels.set(lineStart, lineLabels);
    }
    return labels;
  }, [basesPerLine, detailMode, restrictionSites, sequence.length]);
  const restrictionKeyboardKeys = useMemo(() => {
    const keys: string[] = [];
    for (const lineLabels of restrictionLabelsByLine.values()) {
      for (const lane of lineLabels.lanes) {
        for (const label of lane) keys.push(label.key);
      }
    }
    return keys;
  }, [restrictionLabelsByLine]);
  const restrictionKeyboardKeySet = useMemo(
    () => new Set(restrictionKeyboardKeys),
    [restrictionKeyboardKeys],
  );
  const selectedRestrictionKey = useMemo(() => {
    if (selectedRestrictionTickSet.size === 0) return null;
    for (const lineLabels of restrictionLabelsByLine.values()) {
      for (const lane of lineLabels.lanes) {
        const selected = lane.find((label) => (
          label.sites.some((site) => restrictionSelectionHasSite(selectedRestrictionTickSet, site))
        ));
        if (selected) return selected.key;
      }
    }
    return null;
  }, [restrictionLabelsByLine, selectedRestrictionTickSet]);
  const [rovingRestrictionKey, setRovingRestrictionKey] = useState<string | null>(null);
  const effectiveRovingRestrictionKey = rovingRestrictionKey && restrictionKeyboardKeySet.has(rovingRestrictionKey)
    ? rovingRestrictionKey
    : selectedRestrictionKey && restrictionKeyboardKeySet.has(selectedRestrictionKey)
      ? selectedRestrictionKey
      : restrictionKeyboardKeys[0] ?? null;
  useEffect(() => {
    if (selectedRestrictionKey) setRovingRestrictionKey(selectedRestrictionKey);
  }, [selectedRestrictionKey]);
  const handleRestrictionLabelKeyDown = useCallback((
    event: ReactKeyboardEvent<HTMLButtonElement>,
    key: string,
  ) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const index = restrictionKeyboardKeys.indexOf(key);
    if (index < 0 || restrictionKeyboardKeys.length === 0) return;
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? restrictionKeyboardKeys.length - 1
        : clamp(
            index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1),
            0,
            restrictionKeyboardKeys.length - 1,
          );
    const nextKey = restrictionKeyboardKeys[nextIndex];
    const sequenceElement = event.currentTarget.closest<HTMLElement>('.motif-cs-sequence');
    event.preventDefault();
    setRovingRestrictionKey(nextKey);
    window.requestAnimationFrame(() => {
      const next = Array.from(
        sequenceElement?.querySelectorAll<HTMLButtonElement>('.motif-cs-restriction-label[data-restriction-key]') ?? [],
      ).find((candidate) => candidate.dataset.restrictionKey === nextKey);
      if (!sequenceElement || !next) return;
      next.focus({ preventScroll: true });
      const scroller = effectiveSequenceScroller(sequenceElement);
      const scrollerRect = scroller.getBoundingClientRect();
      const nextRect = next.getBoundingClientRect();
      if (nextRect.top < scrollerRect.top + 24 || nextRect.bottom > scrollerRect.bottom - 24) {
        scroller.scrollBy({ top: nextRect.top - scrollerRect.top - scrollerRect.height / 2, behavior: 'auto' });
      }
    });
  }, [restrictionKeyboardKeys]);
  const focusStart = selectedRanges[0]?.start ?? null;
  const focusKey = selectedFeature?.id ?? (selectedMapRange ? `${selectedMapRange.start}:${selectedMapRange.end}` : 'none');
  // Pre-build the inline amino-acid rows per line, memoized on the tracks (NOT the
  // selection). The rows are React elements with stable identity, so a selection
  // drag — which re-renders SequenceText every frame — reuses these exact nodes and
  // React skips reconciling them entirely. Forward tracks render above the bases,
  // reverse below.
  const translationByLine = useMemo(() => {
    const map = new Map<number, { above: ReactNode[]; below: ReactNode[] }>();
    if (!isNucleotideType(sequenceType) || translationTracks.length === 0) return map;
    const perTrack = translationTracks.map((track) => ({
      track,
      residues: inlineTrackResidues(sequence, sequenceType, track, topology),
    })).map(({ track, residues }) => ({
      track,
      residues,
      protein: residues.map((residue) => residue.aa).join(''),
      keyboardAnchorStart: residues.reduce((minimum, residue) => Math.min(minimum, residue.start), Number.POSITIVE_INFINITY),
    }));
    for (let lineStart = 0; lineStart < sequence.length; lineStart += basesPerLine) {
      const lineEnd = Math.min(sequence.length, lineStart + basesPerLine);
      const above: ReactNode[] = [];
      const below: ReactNode[] = [];
      for (const { track, residues, protein, keyboardAnchorStart } of perTrack) {
        const onLine: LineResidue[] = [];
        for (const residue of residues) {
          if (residue.start >= lineStart && residue.start < lineEnd) {
            onLine.push({ ...residue, left: residue.start - lineStart });
          }
        }
        if (onLine.length === 0) continue;
        const row = (
          <TranslationTrackRow
            key={track.id}
            trackId={track.id}
            label={track.label}
            color={track.color}
            residues={onLine}
            keyboardAnchorStart={keyboardAnchorStart}
            selected={track.id === selectedAaTrackId}
            onSelectTrack={() => selectInlineTranslationTrack(track.id, protein)}
            onSelectCodon={(start, end) => {
              setSelectedAaTrackId(null);
              setSelectedAaTrackText('');
              suppressNextFocusScrollRef.current = true;
              onTranslationCodonSelect(
                start,
                end,
                track.strand,
                track.translationTableId,
                track.featureId,
                track.source,
              );
            }}
          />
        );
        (track.strand === -1 ? below : above).push(row);
      }
      if (above.length > 0 || below.length > 0) map.set(lineStart, { above, below });
    }
    return map;
  }, [sequence, sequenceType, topology, translationTracks, basesPerLine, selectedAaTrackId, selectInlineTranslationTrack, onTranslationCodonSelect]);

  useEffect(() => {
    if (focusStart === null) return;
    if (suppressNextFocusScrollRef.current) {
      suppressNextFocusScrollRef.current = false;
      return;
    }
    const container = containerRef.current;
    const node = container?.querySelector<HTMLElement>('[data-seq-focus="true"]');
    if (!container || !node) return;
    window.requestAnimationFrame(() => {
      const scroller = effectiveSequenceScroller(container);
      const containerRect = scroller.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      const margin = 32;
      if (nodeRect.top >= containerRect.top + margin && nodeRect.bottom <= containerRect.bottom - margin) {
        return;
      }
      const top = scroller.scrollTop
        + nodeRect.top
        - containerRect.top
        - scroller.clientHeight / 2
        + node.clientHeight / 2;
      scroller.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
    });
  }, [basesPerLine, detailMode, focusKey, focusRequest, focusStart, sequence.length, showComplement]);

  // Clip a [start,end) range to a line, returning its ch offset+width or null.
  const clipRangeToLine = (range: { start: number; end: number }, lineStart: number, lineEnd: number) => {
    const start = Math.max(range.start, lineStart);
    const end = Math.min(range.end, lineEnd);
    return end > start ? { left: start - lineStart, width: end - start } : null;
  };
  type LineRect = { left: number; width: number };
  const isRect = (rect: LineRect | null): rect is LineRect => rect !== null;

  const grouped = [];
  for (let lineStart = 0; lineStart < sequence.length; lineStart += basesPerLine) {
    const lineEnd = Math.min(sequence.length, lineStart + basesPerLine);
    const lineLen = lineEnd - lineStart;
    const lineSequence = sequence.slice(lineStart, lineEnd);
    const lineFeatureLanes = detailMode ? featureLanesForLine(features, lineStart, lineEnd, sequence.length, topology) : [];
    const lineRestrictionLabels = restrictionLabelsByLine.get(lineStart) ?? { lanes: [], hidden: 0 };
    const lineRestrictionCuts = restrictionGeometry.filter(({ site, senseCut, antisenseCut }) => (
      restrictionSelectionHasSite(activeRestrictionTickSet, site)
      && (
        restrictionCutBelongsToLine(senseCut, lineStart, lineEnd, sequence.length)
        || restrictionCutBelongsToLine(antisenseCut, lineStart, lineEnd, sequence.length)
      )
    ));
    const isFocusLine = focusStart !== null && focusStart >= lineStart && focusStart < lineEnd;
    const lineTranslations = translationByLine.get(lineStart);
    // Selection + motif render as flat overlay rects behind static base text, so a
    // drag only updates a few rectangles per line instead of rebuilding every base.
    const selectionRects = selectedRanges.map((range) => clipRangeToLine(range, lineStart, lineEnd)).filter(isRect);
    const motifRectsLine = motifRanges.map((range) => clipRangeToLine(range, lineStart, lineEnd)).filter(isRect);
    const activeRestrictionRects = activeRestrictionRanges
      .map((range) => clipRangeToLine(range, lineStart, lineEnd))
      .filter(isRect);
    const caretInLine = editable && caret !== null
      && ((caret >= lineStart && caret < lineEnd) || (caret === sequence.length && lineEnd === sequence.length));
    const caretOffset = caretInLine && caret !== null ? Math.min(caret - lineStart, lineLen) : -1;

    grouped.push(
      <div className="motif-cs-seq-block" key={lineStart} data-seq-focus={isFocusLine || undefined}>
        {lineRestrictionLabels.lanes.length > 0 ? (
          <div className="motif-cs-restriction-tracks" aria-label={`Restriction sites for ${lineStart + 1}-${lineEnd}`}>
            {lineRestrictionLabels.lanes.map((lane, laneIndex) => (
              <div className="motif-cs-restriction-track-lane" key={laneIndex}>
                {lane.map((label) => {
                  const primary = label.sites[0];
                  const selected = label.sites.some((site) => restrictionSelectionHasSite(selectedRestrictionTickSet, site));
                  const primaryEnzyme = restrictionEnzymes.find((candidate) => candidate.name.toLowerCase() === primary.enzyme.toLowerCase());
                  const primaryGeometry = primaryEnzyme
                    ? restrictionCutGeometry(primary, primaryEnzyme, sequence.length, topology)
                    : null;
                  const primaryCutLabel = primaryGeometry
                    ? primaryGeometry.senseCut === primaryGeometry.antisenseCut
                      ? `cut ${primaryGeometry.senseCut + 1}`
                      : `cuts ${primaryGeometry.senseCut + 1} and ${primaryGeometry.antisenseCut + 1}`
                    : `cut ${primary.cutPosition + 1}`;
                  const typeIIS = label.sites.some((site) => {
                    const enzyme = restrictionEnzymes.find((candidate) => candidate.name.toLowerCase() === site.enzyme.toLowerCase());
                    return restrictionEnzymeIsTypeIIS(enzyme);
                  });
                  return (
                    <span
                      key={label.key}
                      className="motif-cs-restriction-label-anchor"
                      style={{ left: `${label.start - lineStart}ch` }}
                    >
                      <button
                        type="button"
                        className="motif-cs-restriction-label"
                        data-selected={selected || undefined}
                        data-restriction-key={label.key}
                        aria-pressed={selected}
                        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End"
                        aria-label={`${label.label}, restriction ${label.sites.length === 1 ? 'site' : 'cluster'} at ${primary.position + 1} bp, ${primaryCutLabel}, ${primary.overhang === 'blunt' ? 'blunt' : `${primary.overhang === '5prime' ? "5 prime" : "3 prime"} overhang`}, ${primary.strand === -1 ? 'reverse' : 'forward'} strand`}
                        tabIndex={label.key === effectiveRovingRestrictionKey ? 0 : -1}
                        data-type-iis={typeIIS || undefined}
                        data-site-position={primary.position}
                        data-recognition-length={primary.recognitionSequence.length}
                        data-site-strand={primary.strand === -1 ? -1 : 1}
                        onPointerDown={(event) => event.stopPropagation()}
                        onPointerEnter={() => setHoveredRestrictionTickIds(label.sites.map(restrictionSiteTickId))}
                        onPointerLeave={() => setHoveredRestrictionTickIds([])}
                        onFocus={() => {
                          setRovingRestrictionKey(label.key);
                          setHoveredRestrictionTickIds(label.sites.map(restrictionSiteTickId));
                        }}
                        onBlur={() => setHoveredRestrictionTickIds([])}
                        onKeyDown={(event) => handleRestrictionLabelKeyDown(event, label.key)}
                        onClick={(event) => {
                          event.stopPropagation();
                          suppressNextFocusScrollRef.current = true;
                          onRestrictionSelect(primary);
                        }}
                        title={`${label.label} · ${primary.recognitionSequence} · ${primary.overhang === 'blunt' ? 'blunt' : `${primary.overhang === '5prime' ? "5′" : "3′"} overhang`}`}
                      >
                        <span translate="no">{label.label}</span>
                      </button>
                    </span>
                  );
                })}
              </div>
            ))}
            {lineRestrictionLabels.hidden > 0 ? <span className="motif-cs-restriction-overflow">+{lineRestrictionLabels.hidden}</span> : null}
          </div>
        ) : null}
        {lineFeatureLanes.length > 0 ? (
          <div className="motif-cs-feature-tracks" aria-label={`Feature annotations for ${lineStart + 1}-${lineEnd}`}>
            {lineFeatureLanes.map((lane, laneIndex) => (
              <div className="motif-cs-feature-track-lane" key={laneIndex}>
                {lane.map(({ feature, start, end, segmentStart, segmentEnd, segmentIndex, isStart, isEnd }) => {
                  // Position ribbons in character (ch) units so they lock to the
                  // monospace bases below — one base == one ch. (A % of the full
                  // track width does NOT match, because the 60 bases only fill
                  // part of that width, so ribbons used to overshoot the bases.)
                  const leftCh = start - lineStart;
                  const widthCh = Math.max(1, end - start);
                  // Only the segment holding the true 3' terminus gets the arrowhead,
                  // so a feature wrapping across lines doesn't look like many arrows.
                  const showHead = isEnd && (
                    (feature.strand === 1 && end === segmentEnd)
                    || (feature.strand === -1 && start === segmentStart)
                  );
                  return (
                    <button
                      key={`${feature.id}:${segmentIndex}:${start}:${end}`}
                      className="motif-cs-feature-block"
                      data-selected={selectedFeature?.id === feature.id || undefined}
                      aria-pressed={selectedFeature?.id === feature.id}
                      aria-label={`${feature.name}, ${feature.type}, full location ${featureRangeLabel(feature)}, segment ${formatRange(start, end)}, ${featureStrandLabel(feature)} strand`}
                      data-strand={feature.strand}
                      data-head={showHead || undefined}
                      type="button"
                      tabIndex={isStart && start === segmentStart ? 0 : -1}
                      style={{ left: `${leftCh}ch`, width: `${widthCh}ch`, '--feature-color': feature.color } as CSSProperties}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        suppressNextFocusScrollRef.current = true;
                        onFeatureSelect(feature.id);
                      }}
                      title={`${feature.name} · ${feature.type} · ${featureRangeLabel(feature)}`}
                    >
                      <span translate="no">{feature.name}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ) : null}
        {lineTranslations && lineTranslations.above.length > 0 ? (
          <div className="motif-cs-aa-stack motif-cs-aa-stack-above">{lineTranslations.above}</div>
        ) : null}
        <div className="motif-cs-seq-line">
          <span className="motif-cs-seq-index">{lineStart + 1}</span>
          <div className="motif-cs-seq-bases" data-line-start={lineStart} data-line-len={lineLen}>
            <div className="motif-cs-seq-overlay" aria-hidden="true">
              {selectionRects.map((rect, i) => (
                <div key={`s${i}`} className="motif-cs-seq-hl" style={{ left: `${rect.left}ch`, width: `${rect.width}ch` }} />
              ))}
              {motifRectsLine.map((rect, i) => (
                <div key={`m${i}`} className="motif-cs-seq-hl motif-cs-seq-hl-motif" style={{ left: `${rect.left}ch`, width: `${rect.width}ch` }} />
              ))}
              {activeRestrictionRects.map((rect, i) => (
                <div key={`r${i}`} className="motif-cs-seq-hl motif-cs-seq-hl-restriction" style={{ left: `${rect.left}ch`, width: `${rect.width}ch` }} />
              ))}
              {lineRestrictionCuts.flatMap(({ site, senseCut, antisenseCut }) => {
                const selected = restrictionSelectionHasSite(selectedRestrictionTickSet, site);
                const markers: ReactNode[] = [];
                if (restrictionCutBelongsToLine(senseCut, lineStart, lineEnd, sequence.length)) {
                  markers.push(
                    <div
                      key={`${restrictionSiteTickId(site)}:sense`}
                      className="motif-cs-seq-cut"
                      data-strand="sense"
                      data-selected={selected || undefined}
                      data-enzyme={site.enzyme}
                      data-cut-bond={senseCut}
                      style={{ left: `${Math.min(senseCut - lineStart, lineLen)}ch` }}
                    />,
                  );
                }
                if (restrictionCutBelongsToLine(antisenseCut, lineStart, lineEnd, sequence.length)) {
                  markers.push(
                    <div
                      key={`${restrictionSiteTickId(site)}:antisense`}
                      className="motif-cs-seq-cut"
                      data-strand="antisense"
                      data-selected={selected || undefined}
                      data-complement-visible={showComplement || undefined}
                      data-enzyme={site.enzyme}
                      data-cut-bond={antisenseCut}
                      style={{ left: `${Math.min(antisenseCut - lineStart, lineLen)}ch` }}
                    />,
                  );
                }
                return markers;
              })}
              {caretInLine ? <div className="motif-cs-seq-caret" style={{ left: `${caretOffset}ch` }} /> : null}
            </div>
            <span className="motif-cs-seq-glyphs">{lineSequence}</span>
            {showComplement ? (
              // Antiparallel bottom strand: the complement base sits directly under
              // each top base (reads 3'→5' left-to-right), so it renders as dsDNA.
              <span className="motif-cs-seq-glyphs motif-cs-seq-complement" aria-hidden="true">{complement(lineSequence, sequenceType === 'rna')}</span>
            ) : null}
          </div>
        </div>
        {lineTranslations && lineTranslations.below.length > 0 ? (
          <div className="motif-cs-aa-stack motif-cs-aa-stack-below">{lineTranslations.below}</div>
        ) : null}
      </div>,
    );
  }
  return (
    <div
      ref={containerRef}
      className="motif-cs-sequence"
      tabIndex={0}
      data-editable={editable || undefined}
      role="textbox"
      aria-label={`${editable ? 'Editable' : 'Read-only'} sequence. Use Shift plus Arrow keys to select residues.`}
      aria-multiline="true"
      aria-readonly={!editable}
      aria-keyshortcuts="Shift+ArrowLeft Shift+ArrowRight Shift+Home Shift+End"
      translate="no"
      spellCheck={false}
      onKeyDown={handleSequenceKeyDown}
      onCopy={handleCopy}
      onPaste={onPaste}
      onPointerDown={handleBasesPointerDown}
      onPointerMove={handleBasesPointerMove}
      onPointerUp={handleBasesPointerUp}
      onPointerCancel={handleBasesPointerCancel}
    >
      {/* Off-screen ruler: 100 monospace chars → exact px-per-base for the
          responsive line-width measurement above (matches .motif-cs-seq-bases font).
          The fixed-position span keeps the wide ruler measurable without adding scroll. */}
      <div className="motif-cs-seq-ruler-clip" aria-hidden="true">
        <span ref={rulerRef} className="motif-cs-seq-ruler">0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000</span>
      </div>
      <span ref={aaCopyBufferRef} className="motif-cs-aa-copy-buffer" aria-hidden="true">{selectedAaTrackText}</span>
      {grouped}
    </div>
  );
});

if (typeof document !== 'undefined') {
  const rootElement = document.getElementById('root');
  if (rootElement) {
    // Apply a persisted palette before React's first commit so dark themes never
    // flash light controls while the artifact mounts inside Claude Science.
    applyArtifactTheme(loadWorkspaceLayoutPrefs().theme);
    createRoot(rootElement).render(
      <ArtifactRuntimeErrorBoundary>
        <App />
      </ArtifactRuntimeErrorBoundary>,
    );
  }
}
