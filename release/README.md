# Release staging contract

These files prepare, but do not authorize, an npm publish or ElizaOS registry submission.

- `registry-entry.schema.json` is pinned to official ElizaOS blob
  `346e276709e2d97b0a59c05c18c9c14c78365584`.
- The live registry gate also pins `packages/registry/src/generate.ts` at blob
  `9019732ee73b127fcc2ffee3a668c576c236325f`; generator drift stops submission before any write.
- `registry-entry.candidate.json` is schema-valid and byte-for-byte derived from the active
  `package.json` fields used by the current upstream submit command. It must not be submitted until
  both its npm package and public GitHub repository exist.
- The future submission path is pinned to
  `packages/registry/entries/third-party/scrysolanahub__plugin-scry.json` in `elizaOS/eliza`.
- `package-metadata.candidate.json` was applied after the public repository was created and remains
  the exact metadata contract for the first publish.
- `images/logo.jpg` and `images/banner.jpg` satisfy the stable CLI's registry dimensions and size
  limits; the staged gate binds their JPEG structure, dimensions, byte ceilings, and SHA-256.
- `release-policy.json` binds package, version, repository, tag, keywords, upstream contract, and
  separate exact authorities for repository creation, first publish, and registry PR.

`npm run release:staged-check` verifies the private local state and reports all external blockers.
`npm run release:publish-check` fails closed unless the metadata overlay is applied, `private` is
false, and the exact GitHub and first-publish authority environment is present. Neither command
performs a network request or write.

`npm run release:registry-check` performs a free read-only check against the mutable upstream
ElizaOS registry schema and README. It rejects byte drift, semantic route drift, invalid UTF-8,
non-200 responses, body stalls, and oversized responses. `npm run release:registry-gate` additionally
requires proof that the exact npm version exists plus the separate registry-PR authority. It never
publishes or opens a PR.

`npm run release:consumer-smoke` packs the built artifact and the exact installed
`@elizaos/core@1.7.2` peer into local tarballs, installs both with lifecycle scripts disabled into an
isolated temporary consumer project, imports the plugin without network access, and runs one fully
offline challenge-to-validated-evidence flow through the packaged Base V2 transport. Packing the
peer removes any dependency on ambient registry metadata while preserving npm's peer-resolution
check. The consumer process removes credential-shaped environment variables and uses an empty
temporary npm user config before package import or child-process execution. The temporary project
and tarballs are deleted on success or failure. Both the general release check and the publish gate
require this buyer-boundary proof.

Publishing and registry submission are separate external writes and require separate explicit
authorization. A registry entry is not evidence of public listing, installation, selection,
payment, settlement, or external demand.

The public repository's `npm-production` environment requires approval by `pfeilisolana` and
accepts only the exact `v0.1.0` tag. It stores no publish credential. The first bootstrap publish
still requires the separate authority and ephemeral token defined in `release-policy.json`.

The scoped package basename is `plugin-scry`, matching the stable CLI's mandatory `plugin-` rule;
the `@scrysolanahub` scope is controlled by the existing npm account. The GitHub repository name
does not need to mirror the npm basename because publication and registry submission use the
package identity from `package.json`.

The compatibility target is deliberately split by release line. Runtime and consumer tests pin the
current stable `@elizaos/core` and CLI at `1.7.2`; this package does not claim the separate 2.x/alpha
manifest contract. The current community-registry source of truth is the `develop` branch contract
under `elizaOS/eliza/packages/registry`, not the archived standalone registry.

The registry pull request must contain exactly two reviewed files: the new third-party entry and
the deterministically regenerated `packages/registry/generated-registry.json`. Submitting only the
entry is rejected by the local controller even though the entry is independently schema-valid.

The current generator marks every third-party entry as v2-only (`v1: false`, `v2: true`). This
`0.1.x` release is verified only against stable ElizaOS `1.7.2`, so registry submission is
fail-closed until a separate v2 compatibility line passes its own runtime and consumer gates or the
upstream wire contract changes. npm publication for stable v1 does not imply registry eligibility.

The upstream `elizaos plugins submit . --dry-run` command is documented on `develop` but is not
present in the published stable CLI `1.7.2`. The older stable `elizaos publish --dry-run` still
generates the retired registry format and rejects the now-documented unscoped
`plugin-*` convention for the package basename. It is therefore not used as release authority. The candidate entry is
validated directly against the pinned live schema and README until the replacement submit command
ships; its availability must be rechecked before the separately authorized registry PR.
