# Release Process

This package is published to npm as `lark-codex-bridge`.

## First Release

The npm package name was checked with:

```bash
npm view lark-codex-bridge name version --registry=https://registry.npmjs.org
```

The registry returned `E404`, so the package name was not occupied at the time of setup.

For the first release:

1. Configure npm Trusted Publishing for this package:
   - Publisher: GitHub Actions
   - Owner: `xile611`
   - Repository: `lark-codex-bridge`
   - Workflow filename: `publish.yml`
   - Environment: `npm`
   - Allowed action: `npm publish`
2. Create and publish a GitHub Release tagged `v0.0.1`.
3. The `Publish to npm` workflow will verify the package and run `npm publish --access public`.

## Normal Releases

Use Conventional Commits on `main`.

- `fix: ...` creates a patch release.
- `feat: ...` creates a minor release.
- `feat!: ...` or `BREAKING CHANGE:` creates a major release.

The `Release Please` workflow opens or updates a release PR. Merging that PR creates the GitHub Release and tag. Publishing the GitHub Release triggers npm publishing.

## Manual Verification

Before publishing, the same checks can be run locally:

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
