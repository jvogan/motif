import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import {
  GOLDEN_GATE_ENZYME_NAMES,
  type GoldenGateEnzymeName,
} from '../bio/golden-gate';
import {
  GOLDEN_GATE_KITS,
} from '../bio/golden-gate-kits';
import type { GoldenGateOrganizationMode } from '../bio/golden-braid';
import {
  MAX_ARTIFACT_CLONING_INPUTS,
  planArtifactGibsonDesign,
  planArtifactGoldenGateDesign,
  type ArtifactCloningInput,
  type ArtifactCloningPlanProvenance,
  type ArtifactGoldenBraidDirection,
  type ArtifactGoldenBraidSlot,
  type ArtifactGoldenGatePartInput,
  type ArtifactGibsonDesignPlan,
  type ArtifactGoldenGateDesignPlan,
  type ArtifactPreparationAction,
} from './claude-science-cloning-design';
import './claude-science-cloning-design-workspace.css';

export type ClaudeScienceCloningDesignMethod = 'golden_gate' | 'gibson';
export type ClaudeScienceCloningDesignPlan = ArtifactGoldenGateDesignPlan | ArtifactGibsonDesignPlan;

export type ClaudeScienceCloningDesignRecord = {
  id: string;
  name: string;
  sequence: string;
  molecule: 'dna';
  sha256?: string;
  group?: string;
  tags?: readonly string[];
};

export type ClaudeScienceCloningPrimerRequest = {
  method: ClaudeScienceCloningDesignMethod;
  plan: ClaudeScienceCloningDesignPlan;
  actionIds: string[];
  recordIds: string[];
  junctionIndexes: number[];
};

export type ClaudeScienceCloningSavePayload = {
  intent: 'plan' | 'product';
  method: ClaudeScienceCloningDesignMethod;
  name: string;
  plan: ClaudeScienceCloningDesignPlan;
  provenance: ArtifactCloningPlanProvenance | null;
  product: NonNullable<ClaudeScienceCloningDesignPlan['product']> | null;
  orderedRecordIds: string[];
  requestedRecordIds: string[];
  requestedOrientations: Array<'forward' | 'reverse'>;
};

export type ClaudeScienceCloningDesignWorkspaceProps = {
  records: readonly ClaudeScienceCloningDesignRecord[];
  onClose: () => void;
  onDesignPrimers: (request: ClaudeScienceCloningPrimerRequest) => void | Promise<void>;
  onSave: (payload: ClaudeScienceCloningSavePayload) => void | Promise<void>;
  initialMethod?: ClaudeScienceCloningDesignMethod;
  initialRecordIds?: readonly string[];
  embedded?: boolean;
};

export type ClaudeSciencePreparedPartReplacement = {
  /** The reviewed plan identity captured when primer preparation opened. */
  expectedRequestSha256: string;
  /** The exact reviewed preparation action being satisfied. */
  actionId: string;
  sourceRecordId: string;
  productRecordId: string;
  productRecordName: string;
};

export type ClaudeScienceCloningDesignWorkspaceHandle = {
  /** Replaces a reviewed source part while retaining all other live draft choices. */
  replacePreparedPart: (replacement: ClaudeSciencePreparedPartReplacement) => boolean;
};

type PartOrientation = NonNullable<ArtifactCloningInput['orientation']>;
type OrderedPart = {
  key: string;
  recordId: string;
  orientation: PartOrientation;
  goldenBraidSlot: ArtifactGoldenBraidSlot;
  requestedLeftOverhang: string;
  requestedRightOverhang: string;
};
type SaveIntent = ClaudeScienceCloningSavePayload['intent'];
type GoldenGateSetupRoute = 'custom' | 'golden_braid_tu_alpha' | 'golden_braid_alpha_omega' | 'golden_braid_omega_alpha';

const CLONING_METHODS: readonly ClaudeScienceCloningDesignMethod[] = ['golden_gate', 'gibson'];

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'select:not([disabled])',
  'input:not([disabled])',
  'summary',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const SETUP_ROUTES: Array<{
  value: GoldenGateSetupRoute;
  label: string;
  detail: string;
}> = [
  {
    value: 'custom',
    label: 'Custom / Other Standard',
    detail: 'Choose a compatibility profile and reaction enzyme for a custom ordered assembly.',
  },
  {
    value: 'golden_braid_tu_alpha',
    label: 'GoldenBraid · Build TU → α',
    detail: 'Assemble ordered entry parts into an explicitly selected level α destination with BsaI.',
  },
  {
    value: 'golden_braid_alpha_omega',
    label: 'GoldenBraid · Stack α → Ω',
    detail: 'Join complementary α1/α2 modules in a level Ω destination with BsmBI (Esp3I compatible).',
  },
  {
    value: 'golden_braid_omega_alpha',
    label: 'GoldenBraid · Stack Ω → α',
    detail: 'Join complementary Ω1/Ω2 modules in a level α destination with BsaI.',
  },
];

function createKey(): string {
  return crypto.randomUUID();
}

function initialParts(
  records: readonly ClaudeScienceCloningDesignRecord[],
  initialRecordIds: readonly string[] | undefined,
): OrderedPart[] {
  const available = new Set(records.map((record) => record.id));
  const selected = initialRecordIds?.filter((id) => available.has(id))
    ?? records.slice(0, 2).map((record) => record.id);
  return [...new Set(selected)]
    .slice(0, MAX_ARTIFACT_CLONING_INPUTS)
    .map((recordId, index) => ({
      key: createKey(),
      recordId,
      orientation: 'forward',
      goldenBraidSlot: index === 1 ? '2' : '1',
      requestedLeftOverhang: '',
      requestedRightOverhang: '',
    }));
}

function toCloningInput(
  record: ClaudeScienceCloningDesignRecord,
  orientation: PartOrientation,
): ArtifactCloningInput {
  return {
    recordId: record.id,
    name: record.name,
    sequence: record.sequence,
    molecule: 'dna',
    orientation,
    ...(record.sha256 === undefined ? {} : { sha256: record.sha256 }),
  };
}

function routeOrganization(route: GoldenGateSetupRoute): GoldenGateOrganizationMode {
  if (route === 'golden_braid_tu_alpha') return 'golden_braid_tu';
  if (route === 'golden_braid_alpha_omega' || route === 'golden_braid_omega_alpha') return 'golden_braid_binary';
  return 'freeform';
}

function routeDirection(route: GoldenGateSetupRoute): ArtifactGoldenBraidDirection | null {
  if (route === 'golden_braid_alpha_omega') return 'alpha_to_omega';
  if (route === 'golden_braid_omega_alpha') return 'omega_to_alpha';
  return null;
}

function routeEnzyme(route: GoldenGateSetupRoute): GoldenGateEnzymeName | null {
  if (route === 'golden_braid_alpha_omega') return 'BsmBI';
  if (route === 'golden_braid_tu_alpha' || route === 'golden_braid_omega_alpha') return 'BsaI';
  return null;
}

function goldenBraidLevelLabel(level: string | null | undefined): string {
  if (level === 'alpha') return 'α';
  if (level === 'omega') return 'Ω';
  if (level === 'entry') return 'Entry';
  return 'GB';
}

function methodLabel(method: ClaudeScienceCloningDesignMethod): string {
  return method === 'golden_gate' ? 'Golden Gate' : 'Gibson';
}

function stateLabel(state: ClaudeScienceCloningDesignPlan['status']): string {
  if (state === 'ready') return 'Ready to Save';
  if (state === 'needs_preparation') return 'Preparation Needed';
  return 'Blocked';
}

function prepStateLabel(state: ArtifactPreparationAction['status']): string {
  if (state === 'required') return 'Required';
  if (state === 'recommended') return 'Review';
  return 'Complete';
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isPrimerPreparation(action: ArtifactPreparationAction): boolean {
  return action.kind === 'add_type_iis_flanks' || action.kind === 'add_homology';
}

function primerPreparationBlocker(
  plan: ClaudeScienceCloningDesignPlan,
  action: ArtifactPreparationAction,
): string | null {
  if (plan.kind !== 'golden_gate_design' || action.kind !== 'add_type_iis_flanks') return null;
  const part = plan.parts.find((entry) => action.recordIds.includes(entry.recordId));
  if (part?.requestedLeftOverhang && part.requestedRightOverhang) return null;
  if (part?.goldenBraidRole === 'destination_vector') {
    return 'Choose a destination vector with verified Type IIS boundaries before designing primers.';
  }
  return 'Open “Set primer fusion sites” for this part and enter both boundaries before designing primers.';
}

function excerpt(sequence: string): string {
  if (sequence.length <= 72) return sequence;
  return `${sequence.slice(0, 36)}…${sequence.slice(-36)}`;
}

export const ClaudeScienceCloningDesignWorkspace = forwardRef<
  ClaudeScienceCloningDesignWorkspaceHandle,
  ClaudeScienceCloningDesignWorkspaceProps
>(function ClaudeScienceCloningDesignWorkspace({
  records,
  onClose,
  onDesignPrimers,
  onSave,
  initialMethod = 'golden_gate',
  initialRecordIds,
  embedded = false,
}, forwardedRef) {
  const titleId = useId();
  const tabPanelId = useId();
  const partHelpId = useId();
  const workspaceRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [method, setMethod] = useState<ClaudeScienceCloningDesignMethod>(initialMethod);
  const [parts, setParts] = useState<OrderedPart[]>(() => initialParts(records, initialRecordIds));
  const [setupRoute, setSetupRoute] = useState<GoldenGateSetupRoute>('custom');
  const [profileId, setProfileId] = useState('');
  const [enzyme, setEnzyme] = useState<GoldenGateEnzymeName>('BsaI');
  const [destinationRecordId, setDestinationRecordId] = useState('');
  const [destinationSlot, setDestinationSlot] = useState<ArtifactGoldenBraidSlot>('1');
  const [gibsonTopology, setGibsonTopology] = useState<'linear' | 'circular'>('linear');
  const [minOverlap, setMinOverlap] = useState(20);
  const [maxOverlap, setMaxOverlap] = useState(60);
  const [search, setSearch] = useState('');
  const [candidateId, setCandidateId] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [productNames, setProductNames] = useState<Record<ClaudeScienceCloningDesignMethod, string>>({
    golden_gate: 'Golden Gate design',
    gibson: 'Gibson design',
  });
  const [busy, setBusy] = useState<'primers' | SaveIntent | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [savedSignatures, setSavedSignatures] = useState<Record<SaveIntent, string>>({ plan: '', product: '' });

  const recordsById = useMemo(() => new Map(records.map((record) => [record.id, record])), [records]);
  const selectedIds = useMemo(() => new Set(parts.map((part) => part.recordId)), [parts]);
  const organizationMode = routeOrganization(setupRoute);
  const goldenBraidDirection = routeDirection(setupRoute);
  const guidedGoldenBraid = organizationMode !== 'freeform';
  const effectiveProfileId = guidedGoldenBraid ? 'goldenbraid-3' : profileId;
  const effectiveEnzyme = setupRoute === 'golden_braid_alpha_omega' && enzyme === 'Esp3I'
    ? 'Esp3I'
    : routeEnzyme(setupRoute) ?? enzyme;
  const selectedParts = useMemo(() => parts.flatMap((part) => {
    const record = recordsById.get(part.recordId);
    return record ? [{ part, record }] : [];
  }), [parts, recordsById]);
  const availableRecords = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return records.filter((record) => {
      if (selectedIds.has(record.id) || (guidedGoldenBraid && record.id === destinationRecordId)) return false;
      if (!query) return true;
      return [record.name, record.group ?? '', ...(record.tags ?? [])]
        .some((value) => value.toLocaleLowerCase().includes(query));
    });
  }, [destinationRecordId, guidedGoldenBraid, records, search, selectedIds]);

  useEffect(() => {
    const available = new Set(records.map((record) => record.id));
    setParts((current) => current.filter((part) => available.has(part.recordId)));
    setDestinationRecordId((current) => (current && !available.has(current) ? '' : current));
  }, [records]);

  useEffect(() => {
    setCandidateId((current) => (
      availableRecords.some((record) => record.id === current)
        ? current
        : availableRecords[0]?.id ?? ''
    ));
  }, [availableRecords]);

  useEffect(() => {
    if (embedded) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, [embedded]);

  useEffect(() => {
    if (embedded) return undefined;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || busy !== null) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [busy, embedded, onClose]);

  const plan = useMemo<ClaudeScienceCloningDesignPlan>(() => {
    const inputs = selectedParts.map(({ part, record }) => toCloningInput(record, part.orientation));
    if (method === 'golden_gate') {
      const sourceLevel = goldenBraidDirection === 'alpha_to_omega' ? 'alpha' : goldenBraidDirection === 'omega_to_alpha' ? 'omega' : 'entry';
      const destinationLevel = goldenBraidDirection === 'alpha_to_omega' ? 'omega' : 'alpha';
      const guidedSources: ArtifactGoldenGatePartInput[] = selectedParts.map(({ part, record }) => ({
        ...toCloningInput(record, part.orientation),
        ...(part.requestedLeftOverhang ? { requestedLeftOverhang: part.requestedLeftOverhang } : {}),
        ...(part.requestedRightOverhang ? { requestedRightOverhang: part.requestedRightOverhang } : {}),
        ...(guidedGoldenBraid ? {
          goldenBraidLevel: sourceLevel,
          goldenBraidRole: 'source_module' as const,
          ...(organizationMode === 'golden_braid_binary' ? { goldenBraidSlot: part.goldenBraidSlot } : {}),
        } : {}),
      }));
      const destination = guidedGoldenBraid ? recordsById.get(destinationRecordId) : null;
      const goldenGateParts: ArtifactGoldenGatePartInput[] = destination
        ? [...guidedSources, {
          ...toCloningInput(destination, 'forward'),
          goldenBraidLevel: destinationLevel,
          goldenBraidRole: 'destination_vector',
          goldenBraidSlot: destinationSlot,
        }]
        : guidedSources;
      return planArtifactGoldenGateDesign({
        parts: guidedGoldenBraid ? goldenGateParts : selectedParts.map(({ part, record }) => ({
          ...toCloningInput(record, part.orientation),
          ...(part.requestedLeftOverhang ? { requestedLeftOverhang: part.requestedLeftOverhang } : {}),
          ...(part.requestedRightOverhang ? { requestedRightOverhang: part.requestedRightOverhang } : {}),
        })),
        organizationMode,
        ...(effectiveProfileId ? { kitId: effectiveProfileId } : {}),
        enzyme: effectiveEnzyme,
        ...(goldenBraidDirection ? { goldenBraidDirection } : {}),
        ...(guidedGoldenBraid && destinationRecordId ? { destinationRecordId } : {}),
      });
    }
    return planArtifactGibsonDesign({
      fragments: inputs,
      topology: gibsonTopology,
      minOverlap,
      maxOverlap,
    });
  }, [destinationRecordId, destinationSlot, effectiveEnzyme, effectiveProfileId, gibsonTopology, goldenBraidDirection, guidedGoldenBraid, maxOverlap, method, minOverlap, organizationMode, recordsById, selectedParts]);

  const currentName = productNames[method];
  const currentSignature = `${method}:${currentName.trim()}:${plan.provenance?.requestSha256 ?? 'invalid'}:${plan.status}`;
  const selectedProfile = method === 'golden_gate' && plan.kind === 'golden_gate_design' ? plan.profile : null;
  const selectedKit = useMemo(
    () => GOLDEN_GATE_KITS.find((entry) => entry.id === effectiveProfileId) ?? null,
    [effectiveProfileId],
  );
  const setupOption = SETUP_ROUTES.find((entry) => entry.value === setupRoute) ?? SETUP_ROUTES[0];
  const availableEnzymes = useMemo<GoldenGateEnzymeName[]>(() => {
    if (!selectedKit) return [...GOLDEN_GATE_ENZYME_NAMES];
    return unique([selectedKit.enzyme, ...(selectedKit.upperLevelEnzyme ? [selectedKit.upperLevelEnzyme] : [])]) as GoldenGateEnzymeName[];
  }, [selectedKit]);
  const destinationRecord = guidedGoldenBraid ? recordsById.get(destinationRecordId) ?? null : null;
  const partLimit = organizationMode === 'golden_braid_binary' ? 2 : MAX_ARTIFACT_CLONING_INPUTS;
  const suggestedSourceOrderIds = useMemo(() => (plan.kind === 'golden_gate_design'
    ? plan.suggestedOrderRecordIds.filter((id) => id !== plan.destinationRecordId)
    : []), [plan]);
  const suggestedOrderDiffers = plan.kind === 'golden_gate_design'
    && suggestedSourceOrderIds.length === parts.length
    && suggestedSourceOrderIds.some((id, index) => id !== parts[index]?.recordId);
  const primerActions = plan.preparation.filter(isPrimerPreparation);
  const readyPrimerActions = primerActions.filter((action) => primerPreparationBlocker(plan, action) === null);
  const goldenGateNeedsAnotherInput = plan.kind === 'golden_gate_design' && plan.inputs.length < 2;

  useImperativeHandle(forwardedRef, () => ({
    replacePreparedPart(replacement) {
      const action = plan.preparation.find((item) => item.id === replacement.actionId);
      const requestMatches = plan.provenance?.requestSha256 === replacement.expectedRequestSha256;
      const actionMatches = action?.recordIds.includes(replacement.sourceRecordId) === true;
      const sourcePartExists = parts.some((part) => part.recordId === replacement.sourceRecordId);
      const sourceIsDestination = destinationRecordId === replacement.sourceRecordId;
      if (!requestMatches || !actionMatches || (!sourcePartExists && !sourceIsDestination)) {
        setError('The cloning draft changed after primer preparation opened. The amplicon was not inserted into this draft.');
        setStatus('');
        return false;
      }
      if (sourcePartExists) {
        setParts((current) => current.map((part) => (
          part.recordId === replacement.sourceRecordId
            ? { ...part, recordId: replacement.productRecordId }
            : part
        )));
      }
      if (sourceIsDestination) setDestinationRecordId(replacement.productRecordId);
      setSavedSignatures({ plan: '', product: '' });
      setError('');
      setStatus(`${replacement.productRecordName} replaced the prepared source; the cloning draft was rechecked.`);
      return true;
    },
  }), [destinationRecordId, parts, plan]);

  const movePart = useCallback((index: number, destination: number) => {
    if (destination < 0 || destination >= parts.length || destination === index) return;
    setParts((current) => {
      if (!current[index] || !current[destination]) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(destination, 0, moved);
      return next;
    });
    setStatus(`Part moved to position ${destination + 1}.`);
    setError('');
  }, [parts.length]);

  const handlePartKeyDown = useCallback((event: KeyboardEvent<HTMLElement>, index: number) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    movePart(index, index + (event.key === 'ArrowUp' ? -1 : 1));
  }, [movePart]);

  const handleDragStart = useCallback((event: DragEvent<HTMLElement>, index: number) => {
    setDragIndex(index);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  }, []);

  const handleDrop = useCallback((event: DragEvent<HTMLElement>, destination: number) => {
    event.preventDefault();
    const fromTransfer = Number.parseInt(event.dataTransfer.getData('text/plain'), 10);
    const source = Number.isInteger(fromTransfer) ? fromTransfer : dragIndex;
    if (source !== null) movePart(source, destination);
    setDragIndex(null);
  }, [dragIndex, movePart]);

  const addPart = useCallback(() => {
    if (!candidateId || parts.length >= partLimit) return;
    const record = recordsById.get(candidateId);
    if (!record || selectedIds.has(candidateId)) return;
    setParts((current) => [...current, {
      key: createKey(),
      recordId: candidateId,
      orientation: 'forward',
      goldenBraidSlot: current.length === 1 ? '2' : '1',
      requestedLeftOverhang: '',
      requestedRightOverhang: '',
    }]);
    setStatus(`${record.name} added at position ${parts.length + 1}.`);
    setSearch('');
    setError('');
  }, [candidateId, partLimit, parts.length, recordsById, selectedIds]);

  const removePart = useCallback((key: string, name: string) => {
    setParts((current) => current.filter((part) => part.key !== key));
    setStatus(`${name} removed from the design.`);
    setError('');
  }, []);

  const replacePart = useCallback((key: string, nextRecordId: string) => {
    if (selectedIds.has(nextRecordId)) return;
    setParts((current) => current.map((part) => (part.key === key ? {
      ...part,
      recordId: nextRecordId,
      requestedLeftOverhang: '',
      requestedRightOverhang: '',
    } : part)));
    setStatus(`Position updated to ${recordsById.get(nextRecordId)?.name ?? 'the selected record'}.`);
    setError('');
  }, [recordsById, selectedIds]);

  const changePartOrientation = useCallback((key: string, name: string, orientation: PartOrientation) => {
    setParts((current) => current.map((part) => (part.key === key ? { ...part, orientation } : part)));
    setStatus(`${name} set to ${orientation === 'reverse' ? 'reverse complement' : 'forward'} orientation.`);
    setError('');
  }, []);

  const changePartSlot = useCallback((key: string, name: string, slot: ArtifactGoldenBraidSlot) => {
    setParts((current) => current.map((part) => (part.key === key ? { ...part, goldenBraidSlot: slot } : part)));
    setStatus(`${name} identified as ${plan.kind === 'golden_gate_design' && plan.sourceLevel ? plan.sourceLevel : 'source'}${slot}.`);
    setError('');
  }, [plan]);

  const changeRequestedBoundary = useCallback((key: string, side: 'left' | 'right', value: string) => {
    const normalized = value.toUpperCase().replace(/[^ACGT]/g, '').slice(0, 4);
    setParts((current) => current.map((part) => (part.key === key
      ? { ...part, [side === 'left' ? 'requestedLeftOverhang' : 'requestedRightOverhang']: normalized }
      : part)));
    setStatus('');
    setError('');
  }, []);

  const applySuggestedOrder = useCallback(() => {
    if (plan.kind !== 'golden_gate_design' || !suggestedOrderDiffers) return;
    const currentById = new Map(parts.map((part) => [part.recordId, part]));
    setParts(suggestedSourceOrderIds.flatMap((recordId) => {
      const part = currentById.get(recordId);
      return part ? [part] : [];
    }));
    setStatus('Suggested biological order applied.');
    setError('');
  }, [parts, plan, suggestedOrderDiffers, suggestedSourceOrderIds]);

  const changeProfile = useCallback((nextProfileId: string) => {
    setProfileId(nextProfileId);
    const kit = GOLDEN_GATE_KITS.find((entry) => entry.id === nextProfileId);
    if (kit) setEnzyme(kit.enzyme);
    setStatus(nextProfileId ? `${kit?.name ?? 'Profile'} selected.` : 'Freeform profile selected.');
    setError('');
  }, []);

  const changeSetupRoute = useCallback((nextRoute: GoldenGateSetupRoute) => {
    setSetupRoute(nextRoute);
    const fixedEnzyme = routeEnzyme(nextRoute);
    if (fixedEnzyme) setEnzyme(fixedEnzyme);
    if (nextRoute === 'golden_braid_alpha_omega' || nextRoute === 'golden_braid_omega_alpha') {
      setParts((current) => current.map((part, index) => ({
        ...part,
        goldenBraidSlot: index === 1 ? '2' : part.goldenBraidSlot,
      })));
    }
    setStatus(`${SETUP_ROUTES.find((entry) => entry.value === nextRoute)?.label ?? 'Assembly setup'} selected.`);
    setError('');
  }, []);

  const changeDestination = useCallback((nextRecordId: string) => {
    const record = recordsById.get(nextRecordId);
    setDestinationRecordId(nextRecordId);
    if (nextRecordId) setParts((current) => current.filter((part) => part.recordId !== nextRecordId));
    setStatus(nextRecordId ? `${record?.name ?? 'Destination'} selected as the destination vector.` : 'Destination vector cleared.');
    setError('');
  }, [recordsById]);

  const requestPrimers = useCallback(async (actions: readonly ArtifactPreparationAction[]) => {
    if (actions.length === 0 || busy !== null) return;
    setBusy('primers');
    setStatus('');
    setError('');
    try {
      await onDesignPrimers({
        method,
        plan,
        actionIds: actions.map((action) => action.id),
        recordIds: unique(actions.flatMap((action) => action.recordIds)),
        junctionIndexes: unique(actions.flatMap((action) => (
          action.junctionIndex === undefined ? [] : [String(action.junctionIndex)]
        ))).map(Number),
      });
      setStatus(actions.length === 1
        ? 'Primer workspace opened for the selected preparation item.'
        : `Primer worklist started with ${actions.length} preparation items.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Primer design could not be opened. Try again.');
    } finally {
      setBusy(null);
    }
  }, [busy, method, onDesignPrimers, plan]);

  const save = useCallback(async (intent: SaveIntent) => {
    const name = currentName.trim();
    if (!name || busy !== null || plan.provenance === null || (intent === 'product' && plan.product === null)) return;
    setBusy(intent);
    setStatus('');
    setError('');
    try {
      const requestedRecordIds = plan.inputs.map((input) => input.recordId);
      const requestedOrientations = plan.inputs.map((input) => input.orientation);
      await onSave({
        intent,
        method,
        name,
        plan,
        provenance: plan.provenance,
        product: intent === 'product' ? plan.product : null,
        orderedRecordIds: intent === 'product' && plan.product
          ? [...plan.product.orderedRecordIds]
          : requestedRecordIds,
        requestedRecordIds,
        requestedOrientations,
      });
      setSavedSignatures((current) => ({ ...current, [intent]: currentSignature }));
      setStatus(intent === 'product' ? `${name} saved as a sequence product.` : `${name} plan saved for review.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `The ${intent} could not be saved. Try again.`);
    } finally {
      setBusy(null);
    }
  }, [busy, currentName, currentSignature, method, onSave, plan]);

  const selectMethod = useCallback((nextMethod: ClaudeScienceCloningDesignMethod) => {
    setMethod(nextMethod);
    setStatus(`${methodLabel(nextMethod)} design selected.`);
    setError('');
  }, []);

  const handleMethodTabKeyDown = useCallback((
    event: KeyboardEvent<HTMLButtonElement>,
    currentMethod: ClaudeScienceCloningDesignMethod,
  ) => {
    const currentIndex = CLONING_METHODS.indexOf(currentMethod);
    let nextIndex: number | null = null;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = CLONING_METHODS.length - 1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % CLONING_METHODS.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + CLONING_METHODS.length) % CLONING_METHODS.length;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextMethod = CLONING_METHODS[nextIndex];
    selectMethod(nextMethod);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`[data-method="${nextMethod}"]`)
      ?.focus();
  }, [selectMethod]);

  const handleWorkspaceKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (embedded || event.key !== 'Tab') return;
    const focusable = [...(workspaceRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])]
      .filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');
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
  }, [embedded]);

  return (
    <div className="motif-cs-cloning-design-overlay" data-embedded={embedded || undefined} data-testid="cloning-design-workspace">
      <section
        ref={workspaceRef}
        className="motif-cs-cloning-design"
        role={embedded ? undefined : 'dialog'}
        aria-modal={embedded ? undefined : true}
        aria-labelledby={titleId}
        onKeyDown={handleWorkspaceKeyDown}
      >
        {embedded ? null : (
          <header className="motif-cs-cloning-design-header">
            <div>
              <span className="motif-cs-cloning-design-kicker">Cloning Design</span>
              <h2 id={titleId}>Design Workspace</h2>
              <p>Order source records, resolve preparation work, and save a provenance-linked design.</p>
            </div>
            <button
              ref={closeRef}
              className="motif-cs-cloning-design-close"
              type="button"
              aria-label="Close cloning design workspace"
              onClick={onClose}
              disabled={busy !== null}
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>
        )}

        <div className="motif-cs-cloning-design-methods" role="tablist" aria-label="Cloning method">
          {CLONING_METHODS.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={method === value}
              aria-controls={tabPanelId}
              tabIndex={method === value ? 0 : -1}
              data-method={value}
              data-selected={method === value || undefined}
              onClick={() => selectMethod(value)}
              onKeyDown={(event) => handleMethodTabKeyDown(event, value)}
            >
              <strong>{methodLabel(value)}</strong>
              <small>{value === 'golden_gate' ? 'Type IIS & modular standards' : 'Overlap assembly'}</small>
            </button>
          ))}
        </div>

        <div id={tabPanelId} className="motif-cs-cloning-design-body" role="tabpanel">
          <main className="motif-cs-cloning-design-main">
            <section className="motif-cs-cloning-design-setup" aria-labelledby={`${titleId}-setup`}>
              <div className="motif-cs-cloning-design-section-head">
                <div>
                  <span>01</span>
                  <h3 id={`${titleId}-setup`}>{method === 'golden_gate' ? 'Assembly Setup' : 'Assembly Conditions'}</h3>
                </div>
                <small>{method === 'golden_gate'
                  ? 'Choose the task first; only relevant chemistry and identity fields appear.'
                  : 'Set the range used to detect exact overlaps. Missing overlaps can be supplied as editable 5′ primer tails in the primer workspace; source records are not rewritten here.'}</small>
              </div>

              {method === 'golden_gate' ? (
                <>
                  <div className="motif-cs-cloning-design-field-grid" data-guided={guidedGoldenBraid || undefined}>
                    <label>
                      <span>Assembly Route</span>
                      <select
                        aria-label="Assembly route"
                        name="golden-gate-setup"
                        autoComplete="off"
                        value={setupRoute}
                        onChange={(event) => changeSetupRoute(event.target.value as GoldenGateSetupRoute)}
                      >
                        {SETUP_ROUTES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    {!guidedGoldenBraid ? <>
                      <label>
                        <span>Compatibility Profile</span>
                        <select
                          aria-label="Golden Gate profile"
                          name="golden-gate-profile"
                          autoComplete="off"
                          value={profileId}
                          onChange={(event) => changeProfile(event.target.value)}
                        >
                          <option value="">Freeform / Custom</option>
                          {GOLDEN_GATE_KITS.map((kit) => <option key={kit.id} value={kit.id}>{kit.name}</option>)}
                        </select>
                      </label>
                      {availableEnzymes.length > 1 ? <label>
                        <span>Type IIS Enzyme</span>
                        <select
                          aria-label="Type IIS enzyme"
                          name="type-iis-enzyme"
                          autoComplete="off"
                          value={effectiveEnzyme}
                          onChange={(event) => {
                            setEnzyme(event.target.value as GoldenGateEnzymeName);
                            setStatus(`${event.target.value} selected for this design.`);
                            setError('');
                          }}
                        >
                          {availableEnzymes.map((name) => <option key={name} value={name}>{name}</option>)}
                        </select>
                      </label> : null}
                    </> : <>
                      <label>
                        <span>Destination Vector</span>
                        <select
                          aria-label="GoldenBraid destination vector"
                          name="golden-braid-destination"
                          autoComplete="off"
                          value={destinationRecordId}
                          onChange={(event) => changeDestination(event.target.value)}
                        >
                          <option value="">Choose a destination…</option>
                          {records.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>Destination Type</span>
                        <select
                          aria-label="GoldenBraid destination type"
                          name="golden-braid-destination-type"
                          autoComplete="off"
                          value={destinationSlot}
                          disabled={!destinationRecord}
                          onChange={(event) => setDestinationSlot(event.target.value as ArtifactGoldenBraidSlot)}
                        >
                          {(['1', '2', '1R', '2R'] as const).map((slot) => <option key={slot} value={slot}>{goldenBraidLevelLabel(plan.kind === 'golden_gate_design' ? plan.destinationLevel : null)}{slot}</option>)}
                        </select>
                      </label>
                    </>}
                  </div>
                  <p className="motif-cs-cloning-design-organization-help" data-testid="cloning-design-organization-help">
                    <strong>{setupOption.label}.</strong> {setupOption.detail}
                    {' '}<span className="motif-cs-cloning-design-reaction">Reaction: {effectiveEnzyme}{setupRoute === 'golden_braid_alpha_omega' ? effectiveEnzyme === 'Esp3I' ? ' · BsmBI-equivalent' : ' · Esp3I compatible' : ''}</span>
                  </p>
                  {setupRoute === 'golden_braid_alpha_omega' ? (
                    <details className="motif-cs-cloning-design-advanced">
                      <summary>Advanced reaction settings</summary>
                      <label>
                        <span>Reaction enzyme</span>
                        <select
                          aria-label="GoldenBraid reaction enzyme"
                          value={effectiveEnzyme}
                          onChange={(event) => setEnzyme(event.target.value as GoldenGateEnzymeName)}
                        >
                          <option value="BsmBI">BsmBI</option>
                          <option value="Esp3I">Esp3I (isoschizomer)</option>
                        </select>
                      </label>
                    </details>
                  ) : null}
                </>
              ) : (
                <div className="motif-cs-cloning-design-field-grid" data-method="gibson">
                  <fieldset className="motif-cs-cloning-design-segmented">
                    <legend>Product Topology</legend>
                    {(['linear', 'circular'] as const).map((value) => (
                      <label key={value} data-selected={gibsonTopology === value || undefined}>
                        <input
                          type="radio"
                          name="gibson-topology"
                          value={value}
                          checked={gibsonTopology === value}
                          onChange={() => setGibsonTopology(value)}
                        />
                        <span>{value === 'linear' ? 'Linear' : 'Circular'}</span>
                      </label>
                    ))}
                  </fieldset>
                  <label>
                    <span>Minimum Overlap</span>
                    <span className="motif-cs-cloning-design-number-field">
                      <input
                        aria-label="Minimum overlap"
                        name="gibson-min-overlap"
                        autoComplete="off"
                        type="number"
                        inputMode="numeric"
                        min={10}
                        max={120}
                        value={minOverlap}
                        onChange={(event) => setMinOverlap(Number(event.target.value))}
                      />
                      <small>bp</small>
                    </span>
                  </label>
                  <label>
                    <span>Maximum Overlap</span>
                    <span className="motif-cs-cloning-design-number-field">
                      <input
                        aria-label="Maximum overlap"
                        name="gibson-max-overlap"
                        autoComplete="off"
                        type="number"
                        inputMode="numeric"
                        min={10}
                        max={120}
                        value={maxOverlap}
                        onChange={(event) => setMaxOverlap(Number(event.target.value))}
                      />
                      <small>bp</small>
                    </span>
                  </label>
                </div>
              )}

              {selectedProfile ? (
                <details className="motif-cs-cloning-design-profile-note">
                  <summary>{selectedProfile.name} Reference</summary>
                  <p>{selectedProfile.description}</p>
                  {selectedProfile.fusionSites.length > 0 ? (
                    <div className="motif-cs-cloning-design-fusion-strip" aria-label="Canonical fusion sites">
                      {selectedProfile.fusionSites.map((site) => <code key={site}>{site}</code>)}
                    </div>
                  ) : <small>Recursive pDGB junctions are position-specific; no entry-part fusion catalog is assumed.</small>}
                  <a href={selectedProfile.citationUrl} target="_blank" rel="noreferrer">Open defining publication</a>
                </details>
              ) : null}
            </section>

            <section className="motif-cs-cloning-design-parts" aria-labelledby={`${titleId}-parts`}>
              <div className="motif-cs-cloning-design-section-head">
                <div>
                  <span>02</span>
                  <h3 id={`${titleId}-parts`}>{organizationMode === 'golden_braid_binary' ? 'Source Modules' : organizationMode === 'golden_braid_tu' ? 'Entry Parts' : 'Ordered Parts'}</h3>
                  <em>{parts.length}/{partLimit}</em>
                </div>
                <div className="motif-cs-cloning-design-section-actions">
                  {plan.kind === 'golden_gate_design' ? (
                    <button
                      type="button"
                      className="motif-cs-cloning-design-quiet-button"
                      disabled={!suggestedOrderDiffers}
                      onClick={applySuggestedOrder}
                    >
                      {suggestedOrderDiffers ? 'Apply Suggested Order' : 'Order Checked'}
                    </button>
                  ) : null}
                </div>
              </div>
              <p id={partHelpId} className="motif-cs-cloning-design-help">
                {organizationMode === 'golden_braid_binary' ? 'Choose exactly two complementary source modules. ' : ''}
                Drag rows or use the arrow buttons. With a row focused, Option/Alt + ↑/↓ also reorders it.
              </p>

              <div className="motif-cs-cloning-design-part-list" data-testid="cloning-design-part-list">
                {parts.length === 0 ? (
                  <div className="motif-cs-cloning-design-empty">
                    <strong>No Parts Selected</strong>
                    <span>Search the DNA inventory below and add at least 2 records.</span>
                  </div>
                ) : parts.map((part, index) => {
                  const record = recordsById.get(part.recordId);
                  if (!record) return null;
                  const ggPart = plan.kind === 'golden_gate_design'
                    ? plan.parts.find((entry) => entry.recordId === record.id)
                    : null;
                  const options = records.filter((entry) => entry.id === record.id || (
                    !selectedIds.has(entry.id) && (!guidedGoldenBraid || entry.id !== destinationRecordId)
                  ));
                  return (
                    <article
                      key={part.key}
                      className="motif-cs-cloning-design-part"
                      data-dragging={dragIndex === index || undefined}
                      data-testid={`cloning-design-part-${index + 1}`}
                      tabIndex={0}
                      aria-describedby={partHelpId}
                      onKeyDown={(event) => handlePartKeyDown(event, index)}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={(event) => handleDrop(event, index)}
                    >
                      <button
                        type="button"
                        className="motif-cs-cloning-design-part-order"
                        draggable
                        aria-label={`Drag ${record.name} to reorder`}
                        aria-describedby={partHelpId}
                        title={`Drag to reorder ${record.name}`}
                        onDragStart={(event) => handleDragStart(event, index)}
                        onDragEnd={() => setDragIndex(null)}
                      >
                        <span aria-hidden="true">⠿</span>
                        <strong aria-hidden="true">{String(index + 1).padStart(2, '0')}</strong>
                      </button>
                      <div className="motif-cs-cloning-design-part-identity">
                        <div className="motif-cs-cloning-design-part-identity-top">
                          <label>
                            <span className="motif-cs-visually-hidden">Part {index + 1}</span>
                            <select
                              aria-label={`Part ${index + 1}`}
                              name={`cloning-part-${index + 1}`}
                              autoComplete="off"
                              value={record.id}
                              onChange={(event) => replacePart(part.key, event.target.value)}
                            >
                              {options.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                            </select>
                          </label>
                          <fieldset className="motif-cs-cloning-design-orientation">
                            <legend className="motif-cs-visually-hidden">Orientation for {record.name}</legend>
                            {(['forward', 'reverse'] as const).map((orientation) => (
                              <button
                                key={orientation}
                                type="button"
                                aria-label={`Use ${record.name} in ${orientation === 'reverse' ? 'reverse complement' : 'forward'} orientation`}
                                aria-pressed={part.orientation === orientation}
                                data-selected={part.orientation === orientation || undefined}
                                title={orientation === 'reverse' ? 'Use reverse complement' : 'Use forward orientation'}
                                onClick={() => changePartOrientation(part.key, record.name, orientation)}
                              >
                                {orientation === 'reverse' ? 'RC' : 'Fwd'}
                              </button>
                            ))}
                          </fieldset>
                        </div>
                        <small>{record.group ?? 'DNA inventory'} · {record.sequence.length.toLocaleString()} bp</small>
                      </div>

                      {plan.kind === 'golden_gate_design' ? (
                        <div className="motif-cs-cloning-design-part-metrics">
                          {organizationMode === 'golden_braid_binary' ? (
                            <label className="motif-cs-cloning-design-source-identity">
                              <small>Source Type</small>
                              <select
                                aria-label={`GoldenBraid source type for ${record.name}`}
                                value={part.goldenBraidSlot}
                                onChange={(event) => changePartSlot(part.key, record.name, event.target.value as ArtifactGoldenBraidSlot)}
                              >
                                {(['1', '2', '1R', '2R'] as const).map((slot) => <option key={slot} value={slot}>{goldenBraidLevelLabel(plan.sourceLevel)}{slot}</option>)}
                              </select>
                            </label>
                          ) : <span><small>Role</small><strong>{ggPart?.roleLabel ?? 'Unassigned'}</strong></span>}
                          <span><small>Fusion</small><code>{ggPart?.leftOverhang ?? '—'} → {ggPart?.rightOverhang ?? '—'}</code></span>
                          <span><small>Internal</small><strong>{ggPart?.internalSiteCount ?? '—'}</strong></span>
                          <span className="motif-cs-cloning-design-state" data-state={ggPart?.status ?? 'unknown'}>
                            {ggPart?.status === 'ready' ? 'Ready' : ggPart?.status === 'needs_domestication' ? 'Domesticate' : 'Add Flanks'}
                          </span>
                        </div>
                      ) : (
                        <div className="motif-cs-cloning-design-part-metrics" data-method="gibson">
                          <span><small>5′ Neighbor</small><strong>{index === 0 && gibsonTopology === 'linear' ? 'Open end' : 'Junction'}</strong></span>
                          <span><small>3′ Neighbor</small><strong>{index === parts.length - 1 && gibsonTopology === 'linear' ? 'Open end' : 'Junction'}</strong></span>
                        </div>
                      )}

                      <div className="motif-cs-cloning-design-part-actions">
                        <button type="button" aria-label={`Move ${record.name} up`} disabled={index === 0} onClick={() => movePart(index, index - 1)}>↑</button>
                        <button type="button" aria-label={`Move ${record.name} down`} disabled={index === parts.length - 1} onClick={() => movePart(index, index + 1)}>↓</button>
                        <button type="button" aria-label={`Remove ${record.name}`} onClick={() => removePart(part.key, record.name)}>×</button>
                      </div>
                      {plan.kind === 'golden_gate_design' && (ggPart?.status === 'needs_flanks' || part.requestedLeftOverhang || part.requestedRightOverhang) ? (
                        <details className="motif-cs-cloning-design-fusion-editor">
                          <summary>{part.requestedLeftOverhang && part.requestedRightOverhang ? `Planned fusion ${part.requestedLeftOverhang} → ${part.requestedRightOverhang}` : 'Set primer fusion sites'}</summary>
                          <div>
                            <label>
                              <span>Left fusion</span>
                              <input
                                aria-label={`Left fusion site for ${record.name}`}
                                value={part.requestedLeftOverhang}
                                inputMode="text"
                                maxLength={selectedProfile?.fusionSiteLength ?? (effectiveEnzyme === 'SapI' || effectiveEnzyme === 'BspQI' ? 3 : 4)}
                                placeholder="e.g. GGAG"
                                onChange={(event) => changeRequestedBoundary(part.key, 'left', event.target.value)}
                              />
                            </label>
                            <span aria-hidden="true">→</span>
                            <label>
                              <span>Right fusion</span>
                              <input
                                aria-label={`Right fusion site for ${record.name}`}
                                value={part.requestedRightOverhang}
                                inputMode="text"
                                maxLength={selectedProfile?.fusionSiteLength ?? (effectiveEnzyme === 'SapI' || effectiveEnzyme === 'BspQI' ? 3 : 4)}
                                placeholder="e.g. GCTT"
                                onChange={(event) => changeRequestedBoundary(part.key, 'right', event.target.value)}
                              />
                            </label>
                          </div>
                          <small>Planning only. These boundaries seed the primer-preparation brief; the source record remains unchanged until a prepared product is created and validated.</small>
                        </details>
                      ) : null}
                    </article>
                  );
                })}
              </div>

              {organizationMode === 'golden_braid_binary' && parts.length >= partLimit ? (
                <p className="motif-cs-cloning-design-source-limit" role="status">Two source modules selected. Replace a row or remove one to choose another source.</p>
              ) : <div className="motif-cs-cloning-design-add">
                <label>
                  <span>Search Inventory</span>
                  <input
                    type="search"
                    name="cloning-record-search"
                    autoComplete="off"
                    placeholder="Name, group, or tag…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      addPart();
                    }}
                  />
                </label>
                <label>
                  <span>{organizationMode === 'golden_braid_binary' ? 'Source to Add' : 'Record to Add'}</span>
                  <select
                    aria-label="Record to add"
                    name="cloning-record-to-add"
                    autoComplete="off"
                    value={candidateId}
                    disabled={availableRecords.length === 0}
                    onChange={(event) => setCandidateId(event.target.value)}
                  >
                    {availableRecords.length === 0 ? <option value="">No matching records</option> : null}
                    {availableRecords.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}
                  </select>
                </label>
                <button
                  type="button"
                  className="motif-cs-cloning-design-primary-button"
                  data-testid="cloning-design-add-part"
                  disabled={!candidateId || parts.length >= partLimit}
                  onClick={addPart}
                >
                  {parts.length >= partLimit ? `${partLimit}-Part Limit` : 'Add Part'}
                </button>
              </div>}
            </section>

            {plan.kind === 'gibson_design' ? (
              <section className="motif-cs-cloning-design-junctions" aria-labelledby={`${titleId}-junctions`}>
                <div className="motif-cs-cloning-design-section-head">
                  <div><span>03</span><h3 id={`${titleId}-junctions`}>Junction Lanes</h3></div>
                  <small>{plan.junctions.length} checked</small>
                </div>
                <div className="motif-cs-cloning-design-lanes" data-testid="gibson-junction-lanes">
                  {plan.junctions.length === 0 ? <p>Add 2 valid fragments to inspect exact overlaps. Missing overlaps can then be supplied as 5′ tails in the primer workspace.</p> : plan.junctions.map((junction) => (
                    <div key={junction.index} className="motif-cs-cloning-design-lane" data-state={junction.status}>
                      <div>
                        <strong>{recordsById.get(junction.leftRecordId)?.name ?? junction.leftRecordId}</strong>
                        <span aria-hidden="true">→</span>
                        <strong>{recordsById.get(junction.rightRecordId)?.name ?? junction.rightRecordId}</strong>
                        {junction.closing ? <em>Closing</em> : null}
                      </div>
                      <code>{junction.overlapSequence ? excerpt(junction.overlapSequence) : 'No exact overlap detected'}</code>
                      <span>{junction.overlapSequence ? `${junction.overlapLength} bp · ${junction.overlapTm?.toFixed(1)} °C` : `${plan.minOverlap}–${plan.maxOverlap} bp required`}</span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="motif-cs-cloning-design-preview" aria-labelledby={`${titleId}-preview`}>
              <div className="motif-cs-cloning-design-section-head">
                <div><span>{plan.kind === 'gibson_design' ? '04' : '03'}</span><h3 id={`${titleId}-preview`}>Product Preview</h3></div>
                <span className="motif-cs-cloning-design-plan-badge" data-state={plan.status} data-testid="cloning-design-plan-status">{stateLabel(plan.status)}</span>
              </div>
              {plan.product ? (
                <div className="motif-cs-cloning-design-product" data-testid="cloning-design-product-preview">
                  <div className="motif-cs-cloning-design-product-chain" aria-label="Product part order">
                    {plan.product.orderedRecordIds.map((recordId, index) => (
                      <span key={`${recordId}-${index}`}>
                        {recordsById.get(recordId)?.name ?? recordId}
                        <small>{plan.inputs.find((input) => input.recordId === recordId)?.orientation === 'reverse' ? 'RC' : 'Fwd'}</small>
                        {index < plan.product!.orderedRecordIds.length - 1 ? <b aria-hidden="true">→</b> : null}
                      </span>
                    ))}
                  </div>
                  <dl>
                    <div><dt>Length</dt><dd>{plan.product.length.toLocaleString()} bp</dd></div>
                    <div><dt>Topology</dt><dd>{plan.product.topology}</dd></div>
                    <div><dt>SHA-256</dt><dd><code>{plan.product.sha256.slice(0, 16)}…</code></dd></div>
                  </dl>
                  <code className="motif-cs-cloning-design-sequence-preview">{excerpt(plan.product.sequence)}</code>
                </div>
              ) : goldenGateNeedsAnotherInput ? (
                <div className="motif-cs-cloning-design-empty" data-testid="cloning-design-product-empty">
                  <strong>Add Another DNA Input</strong>
                  <span>Golden Gate preparation is not evaluated until at least 2 DNA inputs are present.</span>
                </div>
              ) : plan.preparation.length === 0 ? (
                <div className="motif-cs-cloning-design-empty" data-testid="cloning-design-product-empty">
                  <strong>Review Blocking Issues</strong>
                  <span>No product can be previewed and no automated preparation step is available. Review Issues &amp; Warnings or adjust the inputs.</span>
                </div>
              ) : (
                <div className="motif-cs-cloning-design-empty" data-testid="cloning-design-product-empty">
                  <strong>Preview Waits for Preparation</strong>
                  <span>Resolve the required checklist items; no product sequence is invented while junctions remain unresolved.</span>
                </div>
              )}
            </section>
          </main>

          <aside className="motif-cs-cloning-design-review" aria-label="Design review">
            <section>
              <div className="motif-cs-cloning-design-review-head">
                <span>Design Review</span>
                <strong data-state={plan.status}>{stateLabel(plan.status)}</strong>
              </div>
              <dl className="motif-cs-cloning-design-summary">
                <div><dt>Method</dt><dd>{methodLabel(method)}</dd></div>
                <div><dt>Inputs</dt><dd>{plan.inputs.length}</dd></div>
                <div><dt>Required</dt><dd>{goldenGateNeedsAnotherInput ? 'Not checked' : plan.preparation.filter((item) => item.status === 'required').length}</dd></div>
                <div><dt>Warnings</dt><dd>{plan.warnings.length}</dd></div>
              </dl>
              {plan.kind === 'golden_gate_design' && plan.nextLevel !== 'none' ? (
                <p className="motif-cs-cloning-design-next-level"><strong>Next level:</strong> {plan.nextLevelLabel}{plan.recommendedNextLevelEnzyme ? ` with ${plan.recommendedNextLevelEnzyme}` : ''}</p>
              ) : null}
            </section>

            <section>
              <div className="motif-cs-cloning-design-review-head">
                <span>Preparation Checklist</span>
                <small>{goldenGateNeedsAnotherInput ? 'Not evaluated' : plan.preparation.length}</small>
              </div>
              <div className="motif-cs-cloning-design-checklist">
                {goldenGateNeedsAnotherInput ? (
                  <div className="motif-cs-cloning-design-check" data-state="required">
                    <span aria-hidden="true">!</span>
                    <div><strong>Add another DNA input</strong><small>Preparation has not been evaluated. Add at least 2 DNA inputs to check fusion boundaries and assembly order.</small></div>
                    <em>Required</em>
                  </div>
                ) : plan.preparation.length === 0 && plan.product ? (
                  <div className="motif-cs-cloning-design-check" data-state="complete">
                    <span aria-hidden="true">✓</span>
                    <div><strong>Preparation Complete</strong><small>All modeled boundaries and junctions are ready.</small></div>
                  </div>
                ) : plan.preparation.length === 0 ? (
                  <div className="motif-cs-cloning-design-check" data-state="required">
                    <span aria-hidden="true">!</span>
                    <div><strong>Review blocking issues</strong><small>No automated preparation action is available. Review Issues &amp; Warnings or adjust the design inputs.</small></div>
                    <em>Review</em>
                  </div>
                ) : plan.preparation.map((action) => {
                  const blocker = isPrimerPreparation(action) ? primerPreparationBlocker(plan, action) : null;
                  return (
                    <div key={action.id} className="motif-cs-cloning-design-check" data-state={action.status}>
                      <span aria-hidden="true">{action.status === 'required' ? '!' : action.status === 'recommended' ? '·' : '✓'}</span>
                      <div>
                        <strong>{action.label}</strong>
                        <small>{action.detail}</small>
                        {isPrimerPreparation(action) ? (
                          <>
                            <button
                              type="button"
                              disabled={busy !== null || blocker !== null}
                              onClick={() => void requestPrimers([action])}
                            >{blocker ? 'Set fusion sites first' : 'Open primer workspace'}</button>
                            {blocker ? <small role="note">{blocker}</small> : null}
                          </>
                        ) : null}
                      </div>
                      <em>{prepStateLabel(action.status)}</em>
                    </div>
                  );
                })}
              </div>
              {readyPrimerActions.length > 1 ? (
                <button
                  type="button"
                  className="motif-cs-cloning-design-wide-button"
                  disabled={busy !== null}
                  onClick={() => void requestPrimers(readyPrimerActions)}
                >
                  {busy === 'primers' ? 'Opening Primer Workspace…' : `Start ${readyPrimerActions.length}-action primer worklist`}
                </button>
              ) : null}
            </section>

            {plan.errors.length > 0 || plan.warnings.length > 0 ? (
              <details className="motif-cs-cloning-design-issues" open={plan.errors.length > 0}>
                <summary>Issues & Warnings ({plan.errors.length + plan.warnings.length})</summary>
                <ul>
                  {[...plan.errors, ...plan.warnings].map((issue, index) => (
                    <li key={`${issue.code}-${issue.recordId ?? ''}-${index}`} data-level={issue.severity}>{issue.message}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </aside>
        </div>

        <footer className="motif-cs-cloning-design-footer">
          <label>
            <span>Design Name</span>
            <input
              type="text"
              name="cloning-design-name"
              autoComplete="off"
              value={currentName}
              onChange={(event) => {
                setProductNames((current) => ({ ...current, [method]: event.target.value }));
                setError('');
              }}
            />
          </label>
          <div className="motif-cs-cloning-design-feedback">
            <p role="alert" data-empty={!error || undefined}>{error}</p>
            <p role="status" aria-live="polite" data-empty={!status || undefined}>{status}</p>
          </div>
          <div className="motif-cs-cloning-design-save-actions">
            <button
              type="button"
              className="motif-cs-cloning-design-secondary-button"
              disabled={!currentName.trim() || busy !== null || plan.provenance === null || savedSignatures.plan === currentSignature}
              onClick={() => void save('plan')}
            >
              {busy === 'plan' ? 'Saving Plan…' : savedSignatures.plan === currentSignature ? 'Plan Saved' : 'Save Plan'}
            </button>
            <button
              type="button"
              className="motif-cs-cloning-design-primary-button"
              disabled={!currentName.trim() || busy !== null || plan.provenance === null || plan.product === null || savedSignatures.product === currentSignature}
              onClick={() => void save('product')}
            >
              {busy === 'product' ? 'Saving Product…' : savedSignatures.product === currentSignature ? 'Product Saved' : 'Save Product'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
});
