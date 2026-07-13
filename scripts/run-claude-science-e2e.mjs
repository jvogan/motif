import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactPath = resolve(root, 'preview/motif-artifact.html');
const host = '127.0.0.1';
const requestedPort = Number(process.env.MOTIF_ARTIFACT_PORT ?? 0);

if (
  !Number.isInteger(requestedPort)
  || (requestedPort !== 0 && (requestedPort < 1024 || requestedPort > 65535))
) {
  console.error(
    `MOTIF_ARTIFACT_PORT must be 0 or an integer from 1024-65535; received ${requestedPort}`,
  );
  process.exit(1);
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const build = spawnSync(npmCommand, ['run', 'preview:claude-science'], {
  cwd: root,
  stdio: 'inherit',
});
if (build.status !== 0) process.exit(build.status ?? 1);

const artifact = readFileSync(artifactPath);
const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (pathname === '/') {
    response.writeHead(302, { location: '/motif-artifact.html' });
    response.end();
    return;
  }
  if (pathname !== '/motif-artifact.html') {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found\n');
    return;
  }
  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-length': artifact.length,
    'content-type': 'text/html; charset=utf-8',
  });
  response.end(artifact);
});

function listen() {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, host, () => {
      server.off('error', reject);
      resolveListen();
    });
  });
}

function closeServer() {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

try {
  await listen();
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  const target = requestedPort === 0 ? 'an available local port' : `http://${host}:${requestedPort}`;
  console.error(`Could not serve the artifact at ${target}: ${detail}`);
  process.exit(1);
}

const address = server.address();
if (!address || typeof address === 'string') {
  console.error('Could not determine the standalone artifact server address');
  await closeServer();
  process.exit(1);
}
const port = address.port;
const artifactUrl = `http://${host}:${port}/motif-artifact.html`;
console.log(`Standalone artifact audit URL: ${artifactUrl}`);

const test = spawn(
  npxCommand,
  ['playwright', 'test', '--config', 'scripts/playwright.claude-science.config.ts'],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, MOTIF_ARTIFACT_URL: artifactUrl },
  },
);

let interrupted = false;
const stop = (signal) => {
  interrupted = true;
  test.kill(signal);
};
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));

const result = await new Promise((resolveResult) => {
  test.once('error', (error) => resolveResult({ code: 1, error }));
  test.once('exit', (code, signal) => resolveResult({ code: code ?? 1, signal }));
});

await closeServer();

if ('error' in result) console.error(result.error);
if (interrupted && result.signal) console.error(`Playwright stopped by ${result.signal}`);
process.exitCode = result.code;
