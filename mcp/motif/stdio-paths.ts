import { basename, resolve } from 'node:path';

const PACKAGED_ARTIFACT_RESOURCE = '../skills/motif-for-claude-science/resources/motif-artifact.html';

export function inferredConnectorRoot(moduleDirectory: string): string {
  return basename(moduleDirectory) === 'server'
    ? resolve(moduleDirectory, '..')
    : resolve(moduleDirectory, '../..');
}

/**
 * Accept an explicitly configured development root only when it names the
 * same checkout inferred from this server module. A process-wide setting must
 * not redirect a packaged server to an unrelated checkout.
 */
export function trustedConfiguredRoot(
  configuredRoot: string | undefined,
  inferredRoot: string,
): string | undefined {
  if (!configuredRoot?.trim()) return undefined;
  const configured = resolve(configuredRoot);
  const inferred = resolve(inferredRoot);
  if (configured !== inferred) {
    throw new Error('MOTIF_ROOT must resolve to this connector root');
  }
  return configured;
}

export function artifactTemplateCandidates(
  moduleDirectory: string,
  configuredRoot: string | undefined,
  inferredRoot: string,
): string[] {
  const candidates = [
    ...(configuredRoot ? [resolve(configuredRoot, 'dist-motif/motif-template.html')] : []),
    resolve(moduleDirectory, 'motif-template.html'),
    resolve(moduleDirectory, PACKAGED_ARTIFACT_RESOURCE),
    resolve(inferredRoot, 'dist-motif/motif-template.html'),
  ];
  return [...new Set(candidates)];
}
