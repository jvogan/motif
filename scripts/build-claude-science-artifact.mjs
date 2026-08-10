import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { validatePayload as validateArtifactPayload } from '../src/artifacts/motif-for-claude-science-plugin/skills/motif-for-claude-science/scripts/create-artifact.mjs';
import { stampMotifBuildIdentity } from './motif-build-identity.mjs';
import { createDeterministicSbom } from './generate-sbom.mjs';
import {
  RELEASE_ARCHIVE_FILENAME,
  RELEASE_MANIFEST_DIGEST_FILENAME,
  RELEASE_MANIFEST_FILENAME,
} from './lib/motif-release-bundle.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist-motif');
const distHtml = join(outDir, 'motif.html');
const templateHtml = join(outDir, 'motif-template.html');
const finalDistHtml = join(outDir, 'motif-artifact.html');
const standaloneSkillSourcePath = join(root, 'src/artifacts/motif-for-claude-science-skill/SKILL.md');
const standaloneSkillDistPath = join(outDir, 'motif-for-claude-science-skill/SKILL.md');
const pluginName = 'motif-for-claude-science';
const pluginSourcePath = join(root, 'src/artifacts/motif-for-claude-science-plugin');
const pluginDistPath = join(outDir, pluginName);
const pluginResourcePath = join(
  pluginDistPath,
  'skills',
  pluginName,
  'resources',
  'motif-artifact.html',
);
const pluginZipPath = join(outDir, `${pluginName}.zip`);
const pluginChecksumPath = join(outDir, `${pluginName}.checksums.json`);
const releaseDirectoryName = `${pluginName}-release`;
const releaseDistPath = join(outDir, releaseDirectoryName);
const releaseZipPath = join(outDir, RELEASE_ARCHIVE_FILENAME);
const releaseChecksumPath = join(releaseDistPath, `${releaseDirectoryName}.checksums.json`);
const releaseManifestPath = join(releaseDistPath, 'release-manifest.json');
const releaseManifestShaPath = join(outDir, RELEASE_MANIFEST_DIGEST_FILENAME);
const connectorDistPath = join(outDir, 'claude-science');
const connectorServerPath = join(connectorDistPath, 'motif-mcp-server.mjs');
const connectorAppPath = join(connectorDistPath, 'motif-mcp-app.html');
const connectorPluginPath = join(pluginDistPath, 'server');
const publicPluginDocs = [
  'CAPABILITIES.md',
  'CLAUDE_SCIENCE_QUICKSTART.md',
  'CLAUDE_SCIENCE_TROUBLESHOOTING.md',
];
const publicPluginExamples = [
  'README.md',
  'motif-demo.gb',
  'synthetic-proteins.fasta',
  'synthetic-proteins.aln',
  'synthetic-alignment-workspace.json',
];
const reviewedConnectorInventory = JSON.parse(readFileSync(join(root, 'security/connector-inventory.json'), 'utf8'));
const bundledConnectorLicenses = reviewedConnectorInventory.packages.map(({ packagePath, licenseFile }) => ({ packagePath, filename: licenseFile }));

const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const ZIP_DOS_TIME = 0;
const ZIP_DOS_DATE = (1 << 5) | 1; // 1980-01-01, the earliest ZIP timestamp.

function usage() {
  return `Build the standalone Motif for Claude Science artifact and plugin bundle.

Usage:
  node scripts/build-claude-science-artifact.mjs [options]

Options:
  --payload <json>   Preload the standalone HTML and plugin resource with JSON.
  --out <html>       Write an additional repo-local standalone HTML file.
  --handoff <html>   Explicitly copy the HTML and complete plugin bundle elsewhere.
  --help             Show this help.
`;
}

export function parseBuildArgs(args) {
  const options = {
    payloadPath: null,
    outPath: null,
    handoffPath: null,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--payload' || arg === '--out' || arg === '--handoff') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a path`);
      index += 1;
      if (arg === '--payload') options.payloadPath = value;
      if (arg === '--out') options.outPath = value;
      if (arg === '--handoff') options.handoffPath = value;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function pathIsInside(parentPath, candidatePath) {
  const physicalParent = realpathSync(parentPath);
  let existingAncestor = candidatePath;
  while (!existsSync(existingAncestor)) {
    const next = dirname(existingAncestor);
    if (next === existingAncestor) return false;
    existingAncestor = next;
  }
  const physicalCandidate = realpathSync(existingAncestor);
  const local = relative(physicalParent, physicalCandidate);
  return local === '' || (!local.startsWith(`..${sep}`) && local !== '..' && !isAbsolute(local));
}

function inlineAssetTags(html) {
  let inlined = html.replace(
    /<link rel="stylesheet" crossorigin href="([^"]+)">/g,
    (_match, href) => {
      const cssPath = join(outDir, href.replace(/^\.\//, ''));
      const css = readFileSync(cssPath, 'utf8');
      return `<style>\n${css}\n</style>`;
    },
  );

  inlined = inlined.replace(
    /<script type="module" crossorigin src="([^"]+)"><\/script>/g,
    (_match, src) => {
      const jsPath = join(outDir, src.replace(/^\.\//, ''));
      const js = readFileSync(jsPath, 'utf8');
      return `<script type="module">\n${js}\n</script>`;
    },
  );

  return inlined;
}

function jsonForScriptTag(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function injectPayload(html, payloadJson) {
  const dataTagPattern = /(<script type="application\/json" id="motif-artifact-data">)([\s\S]*?)(<\/script>)/;
  if (!dataTagPattern.test(html)) {
    throw new Error('Could not find motif-artifact-data script tag');
  }
  return html.replace(
    dataTagPattern,
    (_match, openTag, _existingPayload, closeTag) => `${openTag}${payloadJson}${closeTag}`,
  );
}

function writeStandaloneSkillCopy(skillPath) {
  mkdirSync(dirname(skillPath), { recursive: true });
  copyFileSync(standaloneSkillSourcePath, skillPath);
}

function runConnectorBuild() {
  for (const script of ['build-motif-mcp-server.mjs', 'build-motif-mcp-app.mjs']) {
    const result = spawnSync(process.execPath, [join(root, 'scripts', script)], {
      cwd: root,
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      throw new Error(`Motif Claude Science connector build failed in ${script}.`);
    }
  }
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function listFilesRecursively(directory, baseDirectory = directory) {
  const entries = readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  const files = [];

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(absolutePath, baseDirectory));
      continue;
    }
    if (!entry.isFile()) throw new Error(`Plugin bundles cannot contain special files: ${absolutePath}`);
    files.push({
      absolutePath,
      archivePath: relative(baseDirectory, absolutePath).split(sep).join('/'),
    });
  }

  return files;
}

export function createDeterministicZipBuffer(directory) {
  const files = listFilesRecursively(directory);
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const file of files) {
    const name = Buffer.from(file.archivePath, 'utf8');
    const data = readFileSync(file.absolutePath);
    const checksum = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6);
    localHeader.writeUInt16LE(ZIP_STORE_METHOD, 8);
    localHeader.writeUInt16LE(ZIP_DOS_TIME, 10);
    localHeader.writeUInt16LE(ZIP_DOS_DATE, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(ZIP_UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(ZIP_STORE_METHOD, 10);
    centralHeader.writeUInt16LE(ZIP_DOS_TIME, 12);
    centralHeader.writeUInt16LE(ZIP_DOS_DATE, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);

    localOffset += localHeader.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function readFrontmatterField(markdown, field) {
  const match = markdown.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? null;
}

export function validatePluginSource(pluginPath = pluginSourcePath) {
  const manifestPath = join(pluginPath, '.claude-plugin/plugin.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.name !== pluginName) {
    throw new Error(`Plugin manifest name must be ${pluginName}`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.name) || manifest.name.length > 64) {
    throw new Error('Plugin name must be lowercase kebab-case and at most 64 characters');
  }
  if (typeof manifest.description !== 'string' || !manifest.description.trim()) {
    throw new Error('Plugin manifest requires a description');
  }

  const skillDirectory = join(pluginPath, 'skills', pluginName);
  const skillPath = join(skillDirectory, 'SKILL.md');
  const skill = readFileSync(skillPath, 'utf8');
  const skillName = readFrontmatterField(skill, 'name');
  const skillDescription = readFrontmatterField(skill, 'description');
  if (skillName !== pluginName) throw new Error(`Skill name must match its directory: ${pluginName}`);
  if (!skillDescription || skillDescription.length > 200) {
    throw new Error('Skill description must contain 1-200 characters');
  }
  const macHomePrefix = ['', 'Users', ''].join('/');
  if (skill.includes(macHomePrefix)) throw new Error('Plugin skill must not contain machine-specific paths');
  if (!existsSync(join(skillDirectory, 'scripts/create-artifact.mjs'))) {
    throw new Error('Plugin is missing its artifact-generation helper');
  }
  if (!existsSync(join(skillDirectory, 'scripts/run-msa.mjs'))) {
    throw new Error('Plugin is missing its external MSA runner');
  }
  const generatedValidators = [
    {
      filename: 'analysis-validator.mjs',
      source: 'src/artifacts/claude-science-analysis-results.ts',
    },
    {
      filename: 'workspace-validator.mjs',
      source: 'src/artifacts/claude-science-workspace-envelope.ts',
    },
  ];
  for (const validator of generatedValidators) {
    const generatedPath = join(skillDirectory, 'scripts', validator.filename);
    if (!existsSync(generatedPath)) {
      throw new Error(`Plugin is missing its generated ${validator.filename}`);
    }
    const regenerated = buildSync({
      entryPoints: [join(root, validator.source)],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      write: false,
      banner: {
        js: `// Generated from ${validator.source}. Regenerate with the documented esbuild command; do not edit by hand.`,
      },
    }).outputFiles[0].text;
    if (readFileSync(generatedPath, 'utf8') !== regenerated) {
      throw new Error(`Plugin generated validator ${validator.filename} is stale; regenerate it from ${validator.source}`);
    }
  }
  const mcpConfig = JSON.parse(readFileSync(join(pluginPath, '.mcp.json'), 'utf8'));
  if (mcpConfig?.motif?.command !== 'node') {
    throw new Error('Plugin MCP config must register the Motif server with Node.js');
  }
  if (mcpConfig.motif.args?.[0] !== '${CLAUDE_PLUGIN_ROOT}/server/motif-mcp-server.mjs') {
    throw new Error('Plugin MCP config must resolve its server from CLAUDE_PLUGIN_ROOT');
  }
}

export function copyPublicPluginDocs(pluginPath) {
  const pluginDocsPath = join(pluginPath, 'docs');
  mkdirSync(pluginDocsPath, { recursive: true });
  for (const filename of publicPluginDocs) {
    copyFileSync(join(root, 'docs', filename), join(pluginDocsPath, filename));
  }
  const pluginExamplesPath = join(pluginPath, 'examples');
  mkdirSync(pluginExamplesPath, { recursive: true });
  for (const filename of publicPluginExamples) {
    copyFileSync(join(root, 'examples', filename), join(pluginExamplesPath, filename));
  }
}

export function copyBundledConnectorLicenses(pluginPath) {
  const licensesPath = join(pluginPath, 'licenses');
  mkdirSync(licensesPath, { recursive: true });
  for (const license of bundledConnectorLicenses) {
    copyFileSync(
      join(root, 'node_modules', ...license.packagePath, 'LICENSE'),
      join(licensesPath, license.filename),
    );
  }
}

function createReleaseConnectorInventory() {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const packages = reviewedConnectorInventory.packages.map((entry) => {
    const packageName = entry.name;
    const lockEntry = lock.packages?.[`node_modules/${packageName}`];
    if (!lockEntry) throw new Error(`Connector inventory package is missing from the lockfile: ${packageName}`);
    const packageManifestPath = join(root, 'node_modules', ...entry.packagePath, 'package.json');
    const packageManifest = JSON.parse(readFileSync(packageManifestPath, 'utf8'));
    const licensePath = join(root, 'node_modules', ...entry.packagePath, 'LICENSE');
    return {
      name: packageName,
      packagePath: entry.packagePath,
      version: lockEntry.version,
      resolved: lockEntry.resolved,
      integrity: lockEntry.integrity,
      license: packageManifest.license ?? null,
      licenseFile: `licenses/${entry.licenseFile}`,
      licenseSha256: sha256(readFileSync(licensePath)),
    };
  });
  return {
    schema: 'motif.release.connector-inventory.v1',
    product: 'Motif for Claude Science',
    packages: packages.sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function copyReleaseScript(filename, destination) {
  const target = join(releaseDistPath, destination ?? filename);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(root, 'scripts', filename), target);
  chmodSync(target, 0o755);
}

function writeReleaseBundle(runtimeBuildId) {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  rmSync(releaseDistPath, { recursive: true, force: true });
  rmSync(releaseZipPath, { force: true });
  rmSync(releaseManifestShaPath, { force: true });
  mkdirSync(releaseDistPath, { recursive: true });

  writeFileSync(
    join(releaseDistPath, 'package.json'),
    `${JSON.stringify({
      name: packageJson.name,
      version: packageJson.version,
      product: 'Motif for Claude Science',
      connectorName: 'motif-local',
      private: false,
    }, null, 2)}\n`,
  );
  mkdirSync(join(releaseDistPath, 'dist-motif', 'claude-science'), { recursive: true });
  mkdirSync(join(releaseDistPath, 'dist-motif'), { recursive: true });
  copyFileSync(connectorServerPath, join(releaseDistPath, 'dist-motif', 'claude-science', 'motif-mcp-server.mjs'));
  copyFileSync(connectorAppPath, join(releaseDistPath, 'dist-motif', 'claude-science', 'motif-mcp-app.html'));
  copyFileSync(templateHtml, join(releaseDistPath, 'dist-motif', 'motif-template.html'));

  copyReleaseScript('run-motif-claude-science-mcp.sh', 'scripts/run-motif-claude-science-mcp.sh');
  copyReleaseScript('install-motif-claude-science-release.mjs');
  copyReleaseScript('doctor-motif-claude-science-release.mjs');
  copyReleaseScript('rollback-motif-claude-science-release.mjs');
  mkdirSync(join(releaseDistPath, 'lib'), { recursive: true });
  copyFileSync(join(root, 'scripts', 'lib', 'motif-local-mcp-config.mjs'), join(releaseDistPath, 'lib', 'motif-local-mcp-config.mjs'));
  copyFileSync(join(root, 'scripts', 'lib', 'motif-release-bundle.mjs'), join(releaseDistPath, 'lib', 'motif-release-bundle.mjs'));
  copyFileSync(join(root, 'scripts', 'lib', 'direct-script.mjs'), join(releaseDistPath, 'lib', 'direct-script.mjs'));

  writeFileSync(
    join(releaseDistPath, 'sbom.json'),
    // Keep the complete deterministic SBOM, but avoid carrying indentation
    // overhead in the installed release bundle.
    `${JSON.stringify(createDeterministicSbom(root))}\n`,
  );
  writeFileSync(
    join(releaseDistPath, 'connector-inventory.json'),
    `${JSON.stringify(createReleaseConnectorInventory(), null, 2)}\n`,
  );
  copyBundledConnectorLicenses(releaseDistPath);

  const checksumFiles = listFilesRecursively(releaseDistPath);
  const files = Object.fromEntries(
    checksumFiles.map((file) => [file.archivePath, sha256(readFileSync(file.absolutePath))]),
  );
  const checksumManifest = {
    schema: 'motif.release.checksums.v1',
    algorithm: 'sha256',
    files,
  };
  writeFileSync(releaseChecksumPath, `${JSON.stringify(checksumManifest, null, 2)}\n`);
  const manifest = {
    schema: 'motif.release.manifest.v1',
    product: 'Motif for Claude Science',
    connectorName: 'motif-local',
    version: packageJson.version,
    runtimeBuildId,
    checksumsFile: `${releaseDirectoryName}.checksums.json`,
    checksumsSha256: sha256(readFileSync(releaseChecksumPath)),
    requiredFiles: checksumFiles.map((file) => file.archivePath),
    paths: {
      launcher: 'scripts/run-motif-claude-science-mcp.sh',
      server: 'dist-motif/claude-science/motif-mcp-server.mjs',
      app: 'dist-motif/claude-science/motif-mcp-app.html',
      template: 'dist-motif/motif-template.html',
    },
  };
  writeFileSync(releaseManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(releaseManifestShaPath, `${sha256(readFileSync(releaseManifestPath))}  ${RELEASE_MANIFEST_FILENAME}\n`);
  writeFileSync(releaseZipPath, createDeterministicZipBuffer(releaseDistPath));
}

function writePluginBundle(html) {
  validatePluginSource();
  rmSync(pluginDistPath, { recursive: true, force: true });
  cpSync(pluginSourcePath, pluginDistPath, { recursive: true });
  mkdirSync(dirname(pluginResourcePath), { recursive: true });
  writeFileSync(pluginResourcePath, html);
  mkdirSync(connectorPluginPath, { recursive: true });
  copyFileSync(connectorServerPath, join(connectorPluginPath, 'motif-mcp-server.mjs'));
  copyFileSync(connectorAppPath, join(connectorPluginPath, 'motif-mcp-app.html'));
  // The bundled server resolves the identical standalone resource from the
  // skill directory. Do not add a second 2 MB HTML copy to the plugin.
  copyPublicPluginDocs(pluginDistPath);
  copyBundledConnectorLicenses(connectorPluginPath);

  const zip = createDeterministicZipBuffer(pluginDistPath);
  writeFileSync(pluginZipPath, zip);

  const files = Object.fromEntries(
    listFilesRecursively(pluginDistPath).map((file) => [
      file.archivePath,
      sha256(readFileSync(file.absolutePath)),
    ]),
  );
  const checksumManifest = {
    schema: 'motif.claude-plugin-checksums.v1',
    algorithm: 'sha256',
    archive: `${pluginName}.zip`,
    archiveSha256: sha256(zip),
    files,
  };
  writeFileSync(pluginChecksumPath, `${JSON.stringify(checksumManifest, null, 2)}\n`);
}

function copyPluginHandoff(handoffDirectory) {
  if (resolve(handoffDirectory) === outDir) return;
  const handoffPluginPath = join(handoffDirectory, pluginName);
  rmSync(handoffPluginPath, { recursive: true, force: true });
  cpSync(pluginDistPath, handoffPluginPath, { recursive: true });
  copyFileSync(pluginZipPath, join(handoffDirectory, `${pluginName}.zip`));
  copyFileSync(pluginChecksumPath, join(handoffDirectory, `${pluginName}.checksums.json`));
}

export function runBuild(args = process.argv.slice(2)) {
  const options = parseBuildArgs(args);
  if (options.help) {
    console.log(usage());
    return;
  }

  const payloadPath = options.payloadPath ? resolve(options.payloadPath) : null;
  const requestedOutPath = options.outPath ? resolve(options.outPath) : null;
  const handoffPath = options.handoffPath ? resolve(options.handoffPath) : null;

  if (requestedOutPath && !pathIsInside(root, requestedOutPath)) {
    throw new Error('An --out path must stay inside the repository; use --handoff for an external copy');
  }
  const build = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'build', '--config', 'vite.claude-science.config.ts', '--configLoader', 'runner'],
    { cwd: root, stdio: 'inherit' },
  );

  if (build.status !== 0) {
    process.exitCode = build.status ?? 1;
    return;
  }

  const { html: template, runtimeBuildId } = stampMotifBuildIdentity(
    inlineAssetTags(readFileSync(distHtml, 'utf8')),
  );
  writeFileSync(templateHtml, template);
  runConnectorBuild();

  let html = template;
  if (payloadPath) {
    const payload = validateArtifactPayload(JSON.parse(readFileSync(payloadPath, 'utf8')));
    html = injectPayload(html, jsonForScriptTag(payload));
  }

  writeFileSync(finalDistHtml, html);
  const finalPath = requestedOutPath ?? finalDistHtml;
  if (finalPath !== finalDistHtml) {
    mkdirSync(dirname(finalPath), { recursive: true });
    writeFileSync(finalPath, html);
  }

  writeStandaloneSkillCopy(standaloneSkillDistPath);
  if (finalPath !== finalDistHtml) {
    writeStandaloneSkillCopy(join(dirname(finalPath), 'motif-for-claude-science-skill/SKILL.md'));
  }
  writePluginBundle(html);
  writeReleaseBundle(runtimeBuildId);

  if (handoffPath) {
    mkdirSync(dirname(handoffPath), { recursive: true });
    writeFileSync(handoffPath, html);
    writeStandaloneSkillCopy(join(dirname(handoffPath), 'motif-for-claude-science-skill/SKILL.md'));
    copyPluginHandoff(dirname(handoffPath));
  }

  console.log(`Wrote template ${templateHtml}`);
  console.log(`Wrote artifact ${finalPath}`);
  console.log(`Wrote standalone skill ${standaloneSkillDistPath}`);
  console.log(`Wrote plugin ${pluginDistPath}`);
  console.log(`Wrote Claude Science connector ${connectorDistPath}`);
  console.log(`Wrote plugin archive ${pluginZipPath}`);
  console.log(`Wrote checksums ${pluginChecksumPath}`);
  console.log(`Wrote release ${releaseDistPath}`);
  console.log(`Wrote release archive ${releaseZipPath}`);
  console.log(`Wrote release manifest checksum ${releaseManifestShaPath}`);
  console.log(`Runtime build ${runtimeBuildId}`);
  if (handoffPath) console.log(`Wrote explicit handoff ${handoffPath}`);
}

const isMain = process.argv[1]
  && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    runBuild();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
