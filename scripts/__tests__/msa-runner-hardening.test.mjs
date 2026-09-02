import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  readBoundedInput,
  runExternalMsa,
} from '../../src/artifacts/motif-for-claude-science-plugin/skills/motif-for-claude-science/scripts/run-msa.mjs';

const temporaryDirectories = [];
const spawnedPids = [];

function temporaryDirectory(label) {
  const directory = mkdtempSync(join(tmpdir(), label));
  temporaryDirectories.push(directory);
  return directory;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

afterEach(() => {
  for (const pid of spawnedPids.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('external MSA runner hardening', () => {
  it('rejects symlinked and non-regular file input without following or blocking', () => {
    const directory = temporaryDirectory('motif-msa-input-types-');
    const target = join(directory, 'target.fasta');
    const linked = join(directory, 'linked.fasta');
    writeFileSync(target, '>One\nATGC\n>Two\nATGG\n');
    symlinkSync(target, linked);

    expect(() => readBoundedInput(linked)).toThrow(/must not be a symbolic link/i);

    if (process.platform !== 'win32') {
      const mkfifo = ['/usr/bin/mkfifo', '/bin/mkfifo'].find(existsSync);
      expect(mkfifo, 'A POSIX mkfifo utility is required for this adversarial test').toBeTruthy();
      const fifo = join(directory, 'input.fifo');
      const created = spawnSync(mkfifo, [fifo], { encoding: 'utf8' });
      expect(created.status, created.stderr).toBe(0);
      const startedAt = Date.now();
      expect(() => readBoundedInput(fifo)).toThrow(/must be a regular file/i);
      expect(Date.now() - startedAt).toBeLessThan(1_000);
      if (existsSync('/dev/null')) {
        expect(() => readBoundedInput('/dev/null')).toThrow(/must be a regular file/i);
      }
    }
  });

  it('continues reading the one opened descriptor when the path is swapped', () => {
    const directory = temporaryDirectory('motif-msa-input-swap-');
    const input = join(directory, 'input.fasta');
    const openedInode = join(directory, 'opened-inode.fasta');
    const replacement = join(directory, 'replacement.fasta');
    const originalText = '>Original one\nATGC\n>Original two\nATGG\n';
    const replacementText = '>Replacement one\nAAAA\n>Replacement two\nTTTT\n';
    writeFileSync(input, originalText);
    writeFileSync(replacement, replacementText);

    const actual = readBoundedInput(input, {
      afterOpen: () => {
        renameSync(input, openedInode);
        renameSync(replacement, input);
      },
    });

    expect(actual).toBe(originalText);
    expect(readFileSync(input, 'utf8')).toBe(replacementText);
  });

  it.skipIf(process.platform === 'win32')(
    'kills an engine process group after TERM is ignored',
    async () => {
      const directory = temporaryDirectory('motif-msa-process-tree-');
      const executable = join(directory, 'muscle');
      const grandchildPidPath = join(directory, 'grandchild.pid');
      writeFileSync(executable, `#!${process.execPath}\n${String.raw`
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args.includes('-version')) {
  process.stdout.write('MUSCLE v5.9.9\n');
  process.exit(0);
}
process.on('SIGTERM', () => {});
const grandchild = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], {
  stdio: 'ignore',
});
writeFileSync(process.env.MOTIF_TEST_GRANDCHILD_PID, String(grandchild.pid));
setInterval(() => {}, 1000);
`}`);
      chmodSync(executable, 0o755);

      const startedAt = Date.now();
      const engineTimeoutMs = 1_500;
      expect(() => runExternalMsa({
        engine: 'muscle',
        molecule: 'dna',
        inputText: '>One\nATGC\n>Two\nATGG\n',
        executablePath: executable,
        env: {},
        childEnv: { MOTIF_TEST_GRANDCHILD_PID: grandchildPidPath },
        temporaryRoot: directory,
        timeoutMs: engineTimeoutMs,
      })).toThrow(/timed out after 1500 ms/i);
      expect(Date.now() - startedAt).toBeLessThan(4_000);

      const grandchildPid = Number(readFileSync(grandchildPidPath, 'utf8'));
      expect(Number.isSafeInteger(grandchildPid)).toBe(true);
      spawnedPids.push(grandchildPid);
      const deadline = Date.now() + 2_000;
      while (processIsAlive(grandchildPid) && Date.now() < deadline) {
        await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
      }
      expect(processIsAlive(grandchildPid)).toBe(false);
    },
    10_000,
  );
});
