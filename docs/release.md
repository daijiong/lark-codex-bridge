# Release Process

This package is published to npm as `lark-codex-bridge`.

## Package Status

The npm package name was checked with:

```bash
npm view lark-codex-bridge name version --registry=https://registry.npmjs.org
```

The registry returned `E404` before the first release, so the package name was available.

`0.0.1` was published manually because GitHub Actions was blocked by a GitHub billing lock.

## Preferred Automated Release

Use Conventional Commits on `main`.

- `fix: ...` creates a patch release.
- `feat: ...` creates a minor release.
- `feat!: ...` or `BREAKING CHANGE:` creates a major release.

The `Release Please` workflow opens or updates a release PR. Merging that PR creates the GitHub Release and tag. Publishing the GitHub Release triggers npm publishing through GitHub Actions and npm Trusted Publishing.

Before relying on the automated workflow, configure npm Trusted Publishing:

- Publisher: GitHub Actions
- Owner: `xile611`
- Repository: `lark-codex-bridge`
- Workflow filename: `publish.yml`
- Environment: `npm`
- Allowed action: `npm publish`

The automated path should be used once GitHub Actions can run.

## Manual Release Fallback

Use this only when GitHub Actions cannot run, for example while the GitHub account is locked due to a billing issue.

### 1. Choose the next version

Check the published version:

```bash
npm --cache .npm-cache view lark-codex-bridge version --registry=https://registry.npmjs.org
```

Choose the next SemVer version. For example, if npm has `0.0.1`, use `0.0.2` for a patch release.

### 2. Run the full manual release script

The default is a patch release:

```bash
pnpm manual:publish
```

To choose a different bump:

```bash
pnpm manual:publish -- minor
pnpm manual:publish -- major
pnpm manual:publish -- 0.1.0
```

To customize the changelog entry:

```bash
RELEASE_NOTES="Fix npm bin path." pnpm manual:publish
pnpm manual:publish -- --notes="Fix npm bin path."
```

`manual:publish` runs the full fallback release flow:

1. Checks that the git worktree is clean.
2. Runs `pnpm version <arg> --no-git-tag-version`.
3. Updates `.release-please-manifest.json`.
4. Prepends a `CHANGELOG.md` entry.
5. Verifies the target npm version is not already published.
6. Runs `pnpm verify`.
7. Publishes with `npm --cache .npm-cache publish --access public --registry=https://registry.npmjs.org`.
8. Commits `package.json`, `pnpm-lock.yaml`, `CHANGELOG.md`, and `.release-please-manifest.json`.
9. Creates `v<version>`.
10. Pushes the commit and tag.

If npm asks for browser authentication or OTP, complete it and wait for publish to finish. If the script fails after npm publish succeeds, do not rerun it before checking npm; finish the git commit/tag/push steps manually if needed.

### 3. Verify npm

```bash
npm --cache .npm-cache view lark-codex-bridge version dist-tags bin --json --registry=https://registry.npmjs.org
```

Install and smoke test:

```bash
npm --cache .npm-cache --prefix /tmp/lark-codex-bridge-smoke install lark-codex-bridge@latest --registry=https://registry.npmjs.org
/tmp/lark-codex-bridge-smoke/node_modules/.bin/lark-codex-bridge --help
```

If GitHub Actions is still billing-locked, pushing the tag may create failed workflow runs. That is acceptable; do not rerun the publish workflow for a version that was already manually published.

## Manual Verification

Before any release:

```bash
pnpm install --frozen-lockfile
pnpm verify
```

After publishing:

```bash
npm view lark-codex-bridge version
npm install -g lark-codex-bridge
lark-codex-bridge --help
```
