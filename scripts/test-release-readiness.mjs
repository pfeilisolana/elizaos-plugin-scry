import assert from "node:assert/strict";
import {
  buildReceipt,
  loadInputs,
  registryErrors,
  registrySubmissionFilename,
} from "./release-readiness.mjs";

const stagedInputs = await loadInputs("staged", {});
const staged = buildReceipt(stagedInputs);
assert.equal(staged.ok, true);
assert.equal(staged.status, "staged_private_not_publishable");
assert.equal(staged.privateLock, true);
assert.equal(staged.publishReady, false);
assert.deepEqual(staged.externalBlockers, stagedInputs.policy.stagedExternalBlockers);

const publishPackage = structuredClone(stagedInputs.packageJson);
publishPackage.private = false;
Object.assign(publishPackage, structuredClone(stagedInputs.metadata));
const publish = buildReceipt({
  ...stagedInputs,
  mode: "publish",
  packageJson: publishPackage,
  env: {
    SCRY_PUBLISH_AUTHORITY: stagedInputs.policy.authorities.firstPublish,
    GITHUB_REPOSITORY: stagedInputs.policy.githubRepository,
    GITHUB_REF_TYPE: "tag",
    GITHUB_REF_NAME: stagedInputs.policy.gitTag,
    GITHUB_ACTIONS: "true",
  },
});
assert.equal(publish.ok, true);
assert.equal(publish.status, "publish_context_ready");
assert.equal(publish.publishReady, true);
assert.equal(publish.registryReady, false);

const noAuthority = buildReceipt({
  ...stagedInputs,
  mode: "publish",
  packageJson: publishPackage,
  env: {},
});
assert.equal(noAuthority.ok, false);
assert(noAuthority.localErrors.includes("publish_authority_missing"));
assert(noAuthority.localErrors.includes("github_actions_context_missing"));

const registry = buildReceipt({
  ...stagedInputs,
  mode: "registry",
  packageJson: publishPackage,
  env: {
    SCRY_REGISTRY_AUTHORITY: stagedInputs.policy.authorities.registryPullRequest,
    SCRY_PUBLISHED_PACKAGE: `${stagedInputs.policy.package}@${stagedInputs.policy.version}`,
    GITHUB_REPOSITORY: stagedInputs.policy.githubRepository,
  },
});
assert.equal(registry.ok, true);
assert.equal(registry.status, "registry_context_ready");
assert.equal(registry.registryReady, true);
assert.equal(registry.publishReady, false);

const registryWithoutAuthority = buildReceipt({
  ...stagedInputs,
  mode: "registry",
  packageJson: publishPackage,
  env: {},
});
assert.equal(registryWithoutAuthority.ok, false);
assert(registryWithoutAuthority.localErrors.includes("registry_authority_missing"));
assert(registryWithoutAuthority.localErrors.includes("published_package_attestation_missing"));

const invalidCandidate = { ...stagedInputs.candidate, unexpected: true };
assert(
  registryErrors(invalidCandidate, stagedInputs.schema).some((error) =>
    error.includes("additionalProperties"),
  ),
);

const tamperedSchema = buildReceipt({
  ...stagedInputs,
  schemaBytes: Buffer.concat([stagedInputs.schemaBytes, Buffer.from("\n")]),
});
assert.equal(tamperedSchema.ok, false);
assert(tamperedSchema.localErrors.includes("registry_schema_sha256_mismatch"));
assert(tamperedSchema.localErrors.includes("registry_schema_git_blob_mismatch"));

const partialMetadata = {
  ...stagedInputs.packageJson,
  homepage: stagedInputs.metadata.homepage,
};
const partial = buildReceipt({ ...stagedInputs, packageJson: partialMetadata });
assert.equal(partial.ok, false);
assert(partial.localErrors.includes("package_metadata_overlay_partial_or_mismatched"));

assert.equal(registrySubmissionFilename("elizaos-plugin-scry"), "elizaos-plugin-scry.json");
assert.equal(registrySubmissionFilename("@scope/plugin"), "scope__plugin.json");

const wrongSubmissionPolicy = structuredClone(stagedInputs.policy);
wrongSubmissionPolicy.registryContract.submissionFilename = "wrong.json";
const wrongSubmission = buildReceipt({ ...stagedInputs, policy: wrongSubmissionPolicy });
assert.equal(wrongSubmission.ok, false);
assert(wrongSubmission.localErrors.includes("registry_submission_filename_mismatch"));

const wrongFetchPin = structuredClone(stagedInputs.packageJson);
wrongFetchPin.dependencies["@x402/fetch"] = "^2.19.0";
const fetchPin = buildReceipt({ ...stagedInputs, packageJson: wrongFetchPin });
assert.equal(fetchPin.ok, false);
assert(fetchPin.localErrors.includes("x402_fetch_pin_mismatch"));

const wrongEvmPin = structuredClone(stagedInputs.packageJson);
wrongEvmPin.dependencies["@x402/evm"] = "latest";
const evmPin = buildReceipt({ ...stagedInputs, packageJson: wrongEvmPin });
assert.equal(evmPin.ok, false);
assert(evmPin.localErrors.includes("x402_evm_pin_mismatch"));

const tamperedBootstrapWorkflow = buildReceipt({
  ...stagedInputs,
  bootstrapWorkflowBytes: Buffer.concat([stagedInputs.bootstrapWorkflowBytes, Buffer.from("\n")]),
});
assert.equal(tamperedBootstrapWorkflow.ok, false);
assert(tamperedBootstrapWorkflow.localErrors.includes("bootstrap_workflow_sha256_mismatch"));

const missingConsumerSmoke = structuredClone(stagedInputs.packageJson);
delete missingConsumerSmoke.scripts["release:consumer-smoke"];
missingConsumerSmoke.scripts["release:check"] = "npm run check";
missingConsumerSmoke.scripts["release:publish-gate"] = "npm run release:publish-check";
const consumerSmoke = buildReceipt({ ...stagedInputs, packageJson: missingConsumerSmoke });
assert.equal(consumerSmoke.ok, false);
assert(consumerSmoke.localErrors.includes("consumer_smoke_script_mismatch"));
assert(consumerSmoke.localErrors.includes("consumer_smoke_release_gate_missing"));
assert(consumerSmoke.localErrors.includes("consumer_smoke_publish_gate_missing"));

process.stdout.write(
  `${JSON.stringify({ schema: "scry.elizaos-release-readiness-test.v1", ok: true, tests: 13 })}\n`,
);
