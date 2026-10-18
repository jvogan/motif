import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  readBoundedInput,
  runExternalMsa,
} from '../../src/artifacts/motif-for-claude-science-plugin/skills/motif-for-claude-science/scripts/run-msa.mjs';

const RUNNER_PATH = fileURLToPath(new URL(
  '../../src/artifacts/motif-for-claude-science-plugin/skills/motif-for-claude-science/scripts/run-msa.mjs',
  import.meta.url,
));
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

  describe.skipIf(process.platform === 'win32')('interruption cleanup', () => {
    const FAKE_ENGINE = String.raw`
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args.includes('-version')) {
  process.stdout.write('MUSCLE v5.9.9\n');
  process.exit(0);
}
if (existsSync(__HANG_FLAG__)) {
  process.on('SIGTERM', () => {});
  const grandchild = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  writeFileSync(__PIDS__, JSON.stringify({ engine: process.pid, grandchild: grandchild.pid }));
  setInterval(() => {}, 1000);
} else {
  copyFileSync(args[args.indexOf('-align') + 1], args[args.indexOf('-output') + 1]);
}
`;

    function prepareRunner(label, { hang = true } = {}) {
      const directory = temporaryDirectory(label);
      const tempRoot = join(directory, 'tmp');
      mkdirSync(tempRoot);
      const pidsPath = join(directory, 'pids.json');
      const executable = join(directory, 'muscle');
      const inputPath = join(directory, 'input.fasta');
      const hangFlagPath = join(directory, 'hang.flag');
      if (hang) writeFileSync(hangFlagPath, '');
      const source = FAKE_ENGINE
        .replace('__PIDS__', JSON.stringify(pidsPath))
        .replace('__HANG_FLAG__', JSON.stringify(hangFlagPath));
      writeFileSync(executable, `#!${process.execPath}\n${source}`);
      chmodSync(executable, 0o755);
      writeFileSync(inputPath, '>One\nATGC\n>Two\nATGG\n');
      return { directory, tempRoot, pidsPath, executable, inputPath };
    }

    function startRunner(fixture) {
      const child = spawn(process.execPath, [
        RUNNER_PATH,
        '--engine', 'muscle',
        '--molecule', 'dna',
        '--in', fixture.inputPath,
        '--executable', fixture.executable,
        '--timeout-ms', '60000',
      ], {
        env: { ...process.env, TMPDIR: fixture.tempRoot },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      spawnedPids.push(child.pid);
      const result = { stdout: '', stderr: '' };
      child.stdout.on('data', (chunk) => { result.stdout += chunk; });
      child.stderr.on('data', (chunk) => { result.stderr += chunk; });
      result.exited = new Promise((resolvePromise) => {
        child.once('exit', (code, signal) => resolvePromise({ code, signal }));
      });
      return { child, result };
    }

    async function waitFor(predicate, description, timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
      }
      throw new Error(`Timed out waiting for ${description}`);
    }

    const runnerTemporaryEntries = (tempRoot) => readdirSync(tempRoot)
      .filter(name => name.startsWith('motif-msa-'));

    it.each([
      ['SIGINT', 130],
      ['SIGTERM', 143],
    ])(
      'removes the engine tree and temporary directory when %s interrupts the runner',
      async (signal, conventionalStatus) => {
        const fixture = prepareRunner('motif-msa-interrupt-');
        const { child, result } = startRunner(fixture);
        await waitFor(() => existsSync(fixture.pidsPath), 'the engine to start');
        const pids = JSON.parse(readFileSync(fixture.pidsPath, 'utf8'));
        spawnedPids.push(pids.engine, pids.grandchild);
        expect(runnerTemporaryEntries(fixture.tempRoot)).toHaveLength(1);

        const startedAt = Date.now();
        child.kill(signal);
        const exit = await result.exited;

        expect(Date.now() - startedAt).toBeLessThan(5_000);
        expect(exit.signal === signal || exit.code === conventionalStatus, JSON.stringify(exit)).toBe(true);
        await waitFor(
          () => !processIsAlive(pids.engine) && !processIsAlive(pids.grandchild),
          'the engine process tree to exit',
          3_000,
        );
        expect(runnerTemporaryEntries(fixture.tempRoot)).toEqual([]);
        expect(result.stdout).toBe('');
      },
      20_000,
    );

    it('keeps the normal run output and leaves no temporary directory behind', async () => {
      const fixture = prepareRunner('motif-msa-normal-', { hang: false });
      const { result } = startRunner(fixture);
      const exit = await result.exited;
      expect(exit, result.stderr).toEqual({ code: 0, signal: null });
      expect(JSON.parse(result.stdout).alignments[0].engine.id).toBe('muscle');
      expect(runnerTemporaryEntries(fixture.tempRoot)).toEqual([]);
    }, 20_000);
  });
});
