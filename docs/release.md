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

### 2. Update local version files

```bash
pnpm version patch --no-git-tag-version
```

If using release-please later, keep the manifest in sync:

```bash
node -e "const fs=require('fs'); const pkg=require('./package.json'); const m=require('./.release-please-manifest.json'); m['.']=pkg.version; fs.writeFileSync('.release-please-manifest.json', JSON.stringify(m, null, 2)+'\n')"
```

Update `CHANGELOG.md` manually with the new version and release notes.

### 3. Verify and publish

```bash
pnpm install --frozen-lockfile
pnpm manual:publish
```

`manual:publish` runs:

- `pnpm verify`
- `npm --cache .npm-cache publish --access public --registry=https://registry.npmjs.org`

If npm asks for browser authentication or OTP, complete it and wait for publish to finish.

### 4. Verify npm

```bash
npm --cache .npm-cache view lark-codex-bridge version dist-tags bin --json --registry=https://registry.npmjs.org
```

Install and smoke test:

```bash
npm --cache .npm-cache --prefix /tmp/lark-codex-bridge-smoke install lark-codex-bridge@latest --registry=https://registry.npmjs.org
/tmp/lark-codex-bridge-smoke/node_modules/.bin/lark-codex-bridge --help
```

### 5. Commit and tag

```bash
version=$(node -p "require('./package.json').version")
git add package.json pnpm-lock.yaml CHANGELOG.md .release-please-manifest.json
git commit -m "chore: release ${version}"
git tag "v${version}"
git push
git push origin "v${version}"
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
