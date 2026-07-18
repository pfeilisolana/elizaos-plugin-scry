# Release staging contract

These files prepare, but do not authorize, an npm publish or ElizaOS registry submission.

- `registry-entry.schema.json` is pinned to official ElizaOS blob
  `346e276709e2d97b0a59c05c18c9c14c78365584`.
- `registry-entry.candidate.json` is schema-valid but must not be submitted until both its npm
  package and public GitHub repository exist.
- The future submission path is pinned to
  `packages/registry/entries/third-party/elizaos-plugin-scry.json` in `elizaOS/eliza`.
- `package-metadata.candidate.json` is applied only after the public repository exists. Keeping it
  out of the active `package.json` avoids advertising a nonexistent source repository.
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

`npm run release:consumer-smoke` packs the built artifact, installs it with lifecycle scripts
disabled into an isolated temporary consumer project, imports it without network access, and runs
one fully offline challenge-to-validated-evidence flow through the packaged Base V2 transport. The
temporary project and tarball are deleted on success or failure. Both the general release check and
the publish gate require this buyer-boundary proof.

Publishing and registry submission are separate external writes and require separate explicit
authorization. A registry entry is not evidence of public listing, installation, selection,
payment, settlement, or external demand.
