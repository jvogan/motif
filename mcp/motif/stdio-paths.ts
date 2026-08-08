import { resolve } from 'node:path';

const PACKAGED_ARTIFACT_RESOURCE = '../skills/motif-for-claude-science/resources/motif-artifact.html';

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
