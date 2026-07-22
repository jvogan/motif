import { createHash } from 'node:crypto';

const BUILD_ID_PLACEHOLDER = '__MOTIF_BUILD_ID__';
const BUILD_ID_META_PATTERN = new RegExp(
  `(<meta name="motif-build-id" content=")${BUILD_ID_PLACEHOLDER}("\\s*/?>)`,
  'u',
);

export function stampMotifBuildIdentity(html) {
  if (!BUILD_ID_META_PATTERN.test(html)) {
    throw new Error('Motif HTML is missing its build identity marker.');
  }
  const runtimeBuildId = createHash('sha256').update(html, 'utf8').digest('hex');
  return {
    html: html.replace(
      BUILD_ID_META_PATTERN,
      (_match, prefix, suffix) => `${prefix}${runtimeBuildId}${suffix}`,
    ),
    runtimeBuildId,
  };
}
