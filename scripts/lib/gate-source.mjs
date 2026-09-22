import { spawnSync } from 'node:child_process';

export function assertCleanGateSource(root, expectedCommit) {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (head.status !== 0 || !/^[0-9a-f]{40}\n?$/.test(head.stdout ?? '')) {
    throw new Error('Canonical gate requires a Git commit');
  }
  const commit = head.stdout.trim();
  if (expectedCommit && commit !== expectedCommit) throw new Error('Gate source commit changed during validation');
  const status = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: root, encoding: 'utf8',
  });
  if (status.status !== 0) throw new Error('Cannot verify gate source state');
  if (status.stdout.length) {
    throw new Error('Canonical gate requires clean committed source, including non-ignored untracked files');
  }
  return commit;
}
