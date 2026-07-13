import { getGoldenGatePartBoundary, type GoldenGatePart, type GoldenGatePartBoundary } from './golden-gate';

export type GoldenGateOrganizationMode = 'freeform' | 'golden_braid_tu' | 'golden_braid_binary';
export type GoldenBraidRole = 'promoter' | 'coding_sequence' | 'terminator' | 'transcription_unit' | 'unknown';

export interface GoldenBraidRoleDefinition {
  role: GoldenBraidRole;
  label: string;
  shortLabel: string;
  expectedLeft?: string;
  expectedRight?: string;
  expectedLeftLabel: string;
  expectedRightLabel: string;
  order: number;
}

export interface GoldenGateOrganizationPart {
  id: string;
  name: string;
  sequence: string;
}

export interface GoldenGateOrganizationAssignment {
  id: string;
  name: string;
  index: number;
  boundary: GoldenGatePartBoundary;
  role: GoldenBraidRole;
  roleLabel: string;
  expectedLeftLabel: string;
  expectedRightLabel: string;
  leftMatches: boolean | null;
  rightMatches: boolean | null;
  warnings: string[];
}

export interface GoldenGateOrganizationPlan {
  mode: GoldenGateOrganizationMode;
  title: string;
  nextLevel: 'none' | 'alpha' | 'omega';
  nextLevelLabel: string;
  enzyme: string;
  assignments: GoldenGateOrganizationAssignment[];
  suggestedOrderIds: string[];
  warnings: string[];
  metadata: Record<string, unknown>;
}

export const GOLDEN_GATE_ORGANIZATION_LABELS: Record<GoldenGateOrganizationMode, string> = {
  freeform: 'Freeform Golden Gate',
  golden_braid_tu: 'GoldenBraid transcription unit',
  golden_braid_binary: 'GoldenBraid alpha/omega stack',
};

export const GOLDEN_BRAID_TU_ROLES: GoldenBraidRoleDefinition[] = [
  {
    role: 'promoter',
    label: 'Promoter',
    shortLabel: 'PROM',
    expectedRight: 'GATG',
    expectedLeftLabel: 'site 1',
    expectedRightLabel: 'GATG',
    order: 10,
  },
  {
    role: 'coding_sequence',
    label: 'Coding sequence',
    shortLabel: 'CDS',
    expectedLeft: 'GATG',
    expectedRight: 'TGAG',
    expectedLeftLabel: 'GATG',
    expectedRightLabel: 'TGAG',
    order: 20,
  },
  {
    role: 'terminator',
    label: 'Terminator',
    shortLabel: 'TER',
    expectedLeft: 'TGAG',
    expectedLeftLabel: 'TGAG',
    expectedRightLabel: 'site 2',
    order: 30,
  },
];

const UNKNOWN_ROLE: GoldenBraidRoleDefinition = {
  role: 'unknown',
  label: 'Unassigned part',
  shortLabel: 'PART',
  expectedLeftLabel: 'custom',
  expectedRightLabel: 'custom',
  order: 1000,
};

function normalizeOverhang(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function matchesExpected(actual: string | null, expected: string | undefined): boolean | null {
  if (!expected) return null;
  return actual === expected;
}

function definitionForRole(role: GoldenBraidRole): GoldenBraidRoleDefinition {
  return GOLDEN_BRAID_TU_ROLES.find((definition) => definition.role === role) ?? UNKNOWN_ROLE;
}

export function inferGoldenBraidRole(boundary: GoldenGatePartBoundary): GoldenBraidRole {
  const left = normalizeOverhang(boundary.leftOverhang);
  const right = normalizeOverhang(boundary.rightOverhang);

  if (left === 'GATG' && right === 'TGAG') return 'coding_sequence';
  if (right === 'GATG') return 'promoter';
  if (left === 'TGAG') return 'terminator';
  return 'unknown';
}

function assignmentWarnings(
  mode: GoldenGateOrganizationMode,
  roleDefinition: GoldenBraidRoleDefinition,
  boundary: GoldenGatePartBoundary,
  leftMatches: boolean | null,
  rightMatches: boolean | null,
): string[] {
  const warnings = [...boundary.errors];
  if (mode !== 'golden_braid_tu') return warnings;

  if (roleDefinition.role === 'unknown') {
    warnings.push('No GoldenBraid transcription-unit role inferred from GATG/TGAG boundaries.');
    return warnings;
  }
  if (leftMatches === false) {
    warnings.push(`Expected left boundary ${roleDefinition.expectedLeftLabel}; found ${boundary.leftOverhang ?? 'none'}.`);
  }
  if (rightMatches === false) {
    warnings.push(`Expected right boundary ${roleDefinition.expectedRightLabel}; found ${boundary.rightOverhang ?? 'none'}.`);
  }
  return warnings;
}

export function buildGoldenGateOrganizationPlan(
  parts: GoldenGateOrganizationPart[],
  enzyme = 'BsaI',
  mode: GoldenGateOrganizationMode = 'freeform',
): GoldenGateOrganizationPlan {
  const assignments = parts.map((part, index): GoldenGateOrganizationAssignment => {
    const boundary = getGoldenGatePartBoundary({ name: part.name, sequence: part.sequence } satisfies GoldenGatePart, enzyme);
    const role = mode === 'golden_braid_tu' ? inferGoldenBraidRole(boundary) : mode === 'golden_braid_binary' ? 'transcription_unit' : 'unknown';
    const roleDefinition = mode === 'golden_braid_binary'
      ? {
        role: 'transcription_unit' as const,
        label: 'Transcription unit',
        shortLabel: 'TU',
        expectedLeftLabel: index === 0 ? 'alpha left' : 'shared braid',
        expectedRightLabel: index === parts.length - 1 ? 'omega right' : 'shared braid',
        order: index,
      }
      : definitionForRole(role);
    const leftMatches = matchesExpected(boundary.leftOverhang, roleDefinition.expectedLeft);
    const rightMatches = matchesExpected(boundary.rightOverhang, roleDefinition.expectedRight);
    return {
      id: part.id,
      name: part.name,
      index,
      boundary,
      role,
      roleLabel: roleDefinition.shortLabel,
      expectedLeftLabel: roleDefinition.expectedLeftLabel,
      expectedRightLabel: roleDefinition.expectedRightLabel,
      leftMatches,
      rightMatches,
      warnings: assignmentWarnings(mode, roleDefinition, boundary, leftMatches, rightMatches),
    };
  });

  const sortedAssignments = [...assignments].sort((left, right) => {
    const leftDefinition = definitionForRole(left.role);
    const rightDefinition = definitionForRole(right.role);
    return leftDefinition.order - rightDefinition.order || left.index - right.index;
  });
  const suggestedOrderIds = mode === 'golden_braid_tu'
    ? sortedAssignments.map((assignment) => assignment.id)
    : assignments.map((assignment) => assignment.id);
  const warnings: string[] = [];

  if (mode === 'golden_braid_tu') {
    const roleCounts = new Map<GoldenBraidRole, number>();
    for (const assignment of assignments) {
      roleCounts.set(assignment.role, (roleCounts.get(assignment.role) ?? 0) + 1);
    }
    if ((roleCounts.get('promoter') ?? 0) === 0) warnings.push('No promoter-like part with a GATG right boundary was found.');
    if ((roleCounts.get('coding_sequence') ?? 0) === 0) warnings.push('No CDS-like part with GATG/TGAG boundaries was found.');
    if ((roleCounts.get('terminator') ?? 0) === 0) warnings.push('No terminator-like part with a TGAG left boundary was found.');
  }

  if (mode === 'golden_braid_binary' && parts.length > 2) {
    warnings.push('GoldenBraid stacking is usually planned as binary alpha/omega rounds; consider assembling pairs first.');
  }

  return {
    mode,
    title: GOLDEN_GATE_ORGANIZATION_LABELS[mode],
    nextLevel: mode === 'golden_braid_tu' ? 'alpha' : mode === 'golden_braid_binary' ? 'omega' : 'none',
    nextLevelLabel: mode === 'golden_braid_tu' ? 'Level alpha TU' : mode === 'golden_braid_binary' ? 'Next omega/alpha stack' : 'Custom product',
    enzyme,
    assignments,
    suggestedOrderIds,
    warnings,
    metadata: {
      organizationMode: mode,
      organizationLabel: GOLDEN_GATE_ORGANIZATION_LABELS[mode],
      nextLevel: mode === 'golden_braid_tu' ? 'alpha' : mode === 'golden_braid_binary' ? 'omega' : null,
      assignments: assignments.map((assignment) => ({
        blockId: assignment.id,
        name: assignment.name,
        role: assignment.role,
        roleLabel: assignment.roleLabel,
        leftOverhang: assignment.boundary.leftOverhang,
        rightOverhang: assignment.boundary.rightOverhang,
        expectedLeft: assignment.expectedLeftLabel,
        expectedRight: assignment.expectedRightLabel,
        warnings: assignment.warnings,
      })),
    },
  };
}
