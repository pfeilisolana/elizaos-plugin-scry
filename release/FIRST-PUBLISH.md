# First publish bootstrap

The npm package must exist before npm can bind a trusted publisher to it. Version `0.1.0` therefore
uses a one-time GitHub Actions bootstrap; later versions must use npm trusted publishing through
OIDC without a long-lived publish token.

The bootstrap workflow is inert unless all of these conditions hold:

- the workflow is manually dispatched at the exact `v0.1.0` tag;
- the operator enters `@scrysolanahub/plugin-scry@0.1.0` exactly;
- the `npm-production` environment permits the job;
- environment secret `SCRY_PUBLISH_AUTHORITY` equals the separately approved first-publish token;
- environment secret `NPM_BOOTSTRAP_TOKEN` contains a narrowly scoped npm credential authorized for
  the first public publish;
- the tagged package metadata is exact and explicitly declares `private: false`;
- the full publish, consumer-delivery, contract, registry-drift, audit, and provenance gates pass.

After a successful first publish:

1. Verify `@scrysolanahub/plugin-scry@0.1.0`, its repository link, and provenance on npm.
2. Delete `NPM_BOOTSTRAP_TOKEN` and disable or remove `bootstrap-publish.yml`.
3. Configure npm trusted publishing for the public repository and the future release workflow.
4. Restrict traditional token publishing after the OIDC route is verified.

Repository creation, first publish, and registry submission remain separate authorities. A workflow
file, tag, 402 challenge, or npm page is not evidence of a buyer installation or settlement.

Primary contracts checked on 2026-07-18:

- https://docs.npmjs.com/trusted-publishers/
- https://docs.npmjs.com/generating-provenance-statements/
- https://docs.npmjs.com/cli/v11/commands/npm-trust/
