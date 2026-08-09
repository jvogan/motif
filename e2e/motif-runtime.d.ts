type MotifE2eRecord = {
  id: string;
  name: string;
  seq: string;
  sequence?: string;
  type?: string;
  molecule?: string;
  topology?: string;
  features?: Array<Record<string, unknown>>;
  annotations?: Array<Record<string, unknown>>;
  provenance?: Record<string, unknown> & { parentRecordIds?: string[] };
  [key: string]: unknown;
};

type MotifE2eAlignmentRow = {
  id: string;
  name: string;
  aligned: string;
  sourceRecordId?: string;
  [key: string]: unknown;
};

type MotifE2eAlignmentEngine = {
  id: string;
  label?: string;
  version?: string;
  mode?: string;
  [key: string]: unknown;
};

type MotifE2eAlignment = {
  id: string;
  name: string;
  molecule?: string;
  rows: MotifE2eAlignmentRow[];
  engine: MotifE2eAlignmentEngine;
  [key: string]: unknown;
};

type MotifE2eNote = {
  id: string;
  body?: string;
  recordId?: string;
  [key: string]: unknown;
};

type MotifE2eWorkflowResult = {
  id: string;
  kind?: string;
  name?: string;
  [key: string]: unknown;
};

type MotifE2eAnalysisResult = Record<string, unknown> & {
  id: string;
  name?: string;
  kind: string;
  provenance: Record<string, unknown> & {
    operation?: string;
    metadata?: Record<string, unknown>;
  };
  parameters?: Record<string, unknown>;
  data: Record<string, unknown> & {
    verificationReportAssetId?: string;
    products?: Array<Record<string, unknown>>;
  };
};

type MotifE2eAnalysisAsset = Record<string, unknown> & {
  id: string;
  name: string;
  mediaType: string;
  content: string;
  sha256?: string;
};

type MotifE2eAnalysisWorkspace = {
  analysisResults: MotifE2eAnalysisResult[];
  analysisAssets: MotifE2eAnalysisAsset[];
};

type MotifE2eWorkspace = Record<string, unknown> & {
  records: MotifE2eRecord[];
  alignments: MotifE2eAlignment[];
  notes: MotifE2eNote[];
  workflowResults: MotifE2eWorkflowResult[];
  artifactState: Record<string, unknown> & {
    translationLayersByRecord: Record<string, Array<Record<string, unknown> & { id: string }>>;
  };
};

type MotifE2eDescription = Record<string, unknown> & {
  text: string;
  data: {
    selection?: unknown;
    features?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
};

declare global {
  interface Window {
    motifRenderInventory(value: unknown): void;
    motifAddRecords(value: unknown): number;
    motifGetInventory(): MotifE2eRecord[];
    motifGetActiveRecord(): MotifE2eRecord | null;
    motifRemoveRecords(value: string | string[]): number;
    motifAddAlignments(value: unknown): number;
    motifGetAlignments(): MotifE2eAlignment[];
    motifAddNotes(value: unknown): number;
    motifGetNotes(): MotifE2eNote[];
    motifAddWorkflowResults(value: unknown): number;
    motifGetWorkflowResults(): MotifE2eWorkflowResult[];
    motifRemoveWorkflowResults(value: string | string[]): number;
    motifAddAnalysisAssets(value: unknown): number;
    motifAddAnalysisResults(value: unknown): number;
    motifGetAnalysisWorkspace(): MotifE2eAnalysisWorkspace;
    motifGetWorkspace(): MotifE2eWorkspace;
    motifReplaceWorkspace(value: unknown, options?: { discardUnsavedChanges?: boolean }): number;
    motifDescribe(): MotifE2eDescription | null;
  }
}

export {};
