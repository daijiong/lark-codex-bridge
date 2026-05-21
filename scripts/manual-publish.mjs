#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registry = 'https://registry.npmjs.org';
const npmCache = '.npm-cache';
const releaseTypes = new Set(['patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease']);

let publishSucceeded = false;

main().catch((err) => {
  console.error(`\nmanual publish failed: ${err instanceof Error ? err.message : String(err)}`);
  if (publishSucceeded) {
    console.error(
      'npm publish appears to have succeeded before the failure. Check npm before rerunning, then finish the git commit/tag/push steps manually if needed.',
    );
  }
  process.exit(1);
});

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  assertCleanWorktree();

  const before = readPackage();
  console.log(`Preparing manual release for ${before.name} from ${before.version} (${opts.versionArg})`);

  run('pnpm', ['version', opts.versionArg, '--no-git-tag-version']);

  const after = readPackage();
  const version = after.version;
  const tag = `v${version}`;
  if (version === before.version) {
    throw new Error(`version did not change (${version})`);
  }

  updateReleasePleaseManifest(version);
  updateChangelog(version, opts.notes);

  assertTagAvailable(tag);
  assertNpmVersionAvailable(after.name, version);

  console.log(`Publishing ${after.name}@${version}`);
  run('pnpm', ['verify']);
  run('npm', ['--cache', npmCache, 'publish', '--access', 'public', `--registry=${registry}`]);
  publishSucceeded = true;

  run('git', ['add', 'package.json', 'pnpm-lock.yaml', 'CHANGELOG.md', '.release-please-manifest.json']);
  run('git', ['commit', '-m', `chore: release ${version}`]);
  run('git', ['tag', tag]);
  run('git', ['push']);
  run('git', ['push', 'origin', tag]);

  console.log(`Manual release complete: ${after.name}@${version} (${tag})`);
}

function parseArgs(args) {
  const opts = {
    help: false,
    notes: process.env.RELEASE_NOTES?.trim() || 'Manual fallback release.',
    versionArg: 'patch',
  };

  for (const arg of args) {
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
      continue;
    }
    if (arg.startsWith('--notes=')) {
      opts.notes = arg.slice('--notes='.length).trim() || opts.notes;
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    }
    opts.versionArg = arg;
  }

  if (!releaseTypes.has(opts.versionArg) && !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(opts.versionArg)) {
    throw new Error(`invalid version argument: ${opts.versionArg}`);
  }
  return opts;
}

function printHelp() {
  console.log(`Usage:
  pnpm manual:publish
  pnpm manual:publish -- minor
  pnpm manual:publish -- 0.1.0
  RELEASE_NOTES="Fix npm bin path." pnpm manual:publish
  pnpm manual:publish -- --notes="Fix npm bin path."

The script:
  1. checks that the git worktree is clean
  2. runs pnpm version <arg> --no-git-tag-version
  3. updates .release-please-manifest.json
  4. prepends a CHANGELOG.md entry
  5. runs pnpm verify
  6. publishes to npm
  7. commits version files
  8. tags and pushes the release`);
}

function readPackage() {
  return JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
}

function assertCleanWorktree() {
  const status = capture('git', ['status', '--porcelain']).trim();
  if (status) {
    throw new Error(`git worktree is not clean:\n${status}`);
  }
}

function updateReleasePleaseManifest(version) {
  const path = resolve(repoRoot, '.release-please-manifest.json');
  if (!existsSync(path)) return;
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest['.'] = version;
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function updateChangelog(version, notes) {
  const path = resolve(repoRoot, 'CHANGELOG.md');
  const date = new Date().toISOString().slice(0, 10);
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '# Changelog\n';
  if (existing.includes(`## ${version} `)) return;

  const bulletNotes = notes
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith('- ') ? line : `- ${line}`))
    .join('\n');
  const entry = `## ${version} (${date})\n\n${bulletNotes}\n\n`;

  if (existing.startsWith('# Changelog')) {
    const rest = existing.slice('# Changelog'.length).replace(/^\s+/, '');
    writeFileSync(path, `# Changelog\n\n${entry}${rest}`, 'utf8');
    return;
  }
  writeFileSync(path, `# Changelog\n\n${entry}${existing}`, 'utf8');
}

function assertTagAvailable(tag) {
  const result = spawnSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status === 0) {
    throw new Error(`git tag already exists: ${tag}`);
  }
}

function assertNpmVersionAvailable(name, version) {
  const result = spawnSync('npm', ['--cache', npmCache, 'view', `${name}@${version}`, 'version', `--registry=${registry}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status === 0) {
    throw new Error(`npm version already exists: ${name}@${version}`);
  }
  const output = `${result.stdout}\n${result.stderr}`;
  if (!output.includes('E404')) {
    throw new Error(`could not verify npm version availability:\n${output.trim()}`);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}: ${result.stderr}`);
  }
  return result.stdout;
}
