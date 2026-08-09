import assert from "node:assert/strict";
import { isolatedNpmEnvironmentFor } from "./npm-isolation.mjs";
import {
  buildReceipt,
  jpegDimensions,
  loadInputs,
  registryCandidateFromPackage,
  registryErrors,
  registrySubmissionFilename,
} from "./release-readiness.mjs";

const stagedInputs = await loadInputs("staged", {});
const npmIsolation = isolatedNpmEnvironmentFor("/tmp/scry-consumer-smoke-test");
assert.deepEqual(npmIsolation, {
  npm_config_userconfig: "/tmp/scry-consumer-smoke-test/.npmrc",
  npm_config_cache: "/tmp/scry-consumer-smoke-test/npm-cache",
  npm_config_logs_dir: "/tmp/scry-consumer-smoke-test/npm-logs",
});
assert.throws(() => isolatedNpmEnvironmentFor(""), /non-empty path/);
const staged = buildReceipt(stagedInputs);
assert.equal(staged.ok, true);
assert.equal(staged.status, "published_release_trusted_publisher_pending");
assert.equal(staged.privateLock, false);
assert.equal(staged.publishReady, false);
assert.deepEqual(staged.externalBlockers, stagedInputs.policy.stagedExternalBlockers);

const publishPackage = structuredClone(stagedInputs.packageJson);
const publish = buildReceipt({
  ...stagedInputs,
  mode: "publish",
  packageJson: publishPackage,
  env: {
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

const noContext = buildReceipt({
  ...stagedInputs,
  mode: "publish",
  packageJson: publishPackage,
  env: {},
});
assert.equal(noContext.ok, false);
assert(noContext.localErrors.includes("github_actions_context_missing"));
assert(noContext.localErrors.includes("github_release_tag_mismatch"));

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
assert.equal(registry.ok, false);
assert.equal(registry.status, "local_contract_failed");
assert.equal(registry.registryReady, false);
assert.equal(registry.publishReady, false);
assert(registry.localErrors.includes("registry_v2_runtime_compatibility_not_proven"));

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

const pluginWithAppMetadata = {
  ...stagedInputs.candidate,
  app: {
    displayName: "Scry",
    category: "data",
    launchType: "external",
    launchUrl: null,
    icon: null,
    capabilities: [],
  },
};
assert(
  registryErrors(pluginWithAppMetadata, stagedInputs.schema).some((error) => error.includes("not")),
);

const appWithoutMetadata = { ...stagedInputs.candidate, kind: "app" };
assert(
  registryErrors(appWithoutMetadata, stagedInputs.schema).some((error) =>
    error.includes("required"),
  ),
);

const tamperedSchema = buildReceipt({
  ...stagedInputs,
  schemaBytes: Buffer.concat([stagedInputs.schemaBytes, Buffer.from("\n")]),
});
assert.equal(tamperedSchema.ok, false);
assert(tamperedSchema.localErrors.includes("registry_schema_sha256_mismatch"));
assert(tamperedSchema.localErrors.includes("registry_schema_git_blob_mismatch"));

const partialMetadata = structuredClone(stagedInputs.packageJson);
delete partialMetadata.repository;
delete partialMetadata.bugs;
partialMetadata.homepage = stagedInputs.metadata.homepage;
const partial = buildReceipt({ ...stagedInputs, packageJson: partialMetadata });
assert.equal(partial.ok, false);
assert(partial.localErrors.includes("package_metadata_mismatch"));

assert.equal(
  registrySubmissionFilename("@scrysolanahub/plugin-scry"),
  "scrysolanahub__plugin-scry.json",
);
assert.equal(registrySubmissionFilename("@scope/plugin"), "scope__plugin.json");
assert.deepEqual(registryCandidateFromPackage(stagedInputs.packageJson), stagedInputs.candidate);
assert.deepEqual(jpegDimensions(stagedInputs.logoBytes), { width: 400, height: 400 });
assert.deepEqual(jpegDimensions(stagedInputs.bannerBytes), { width: 1280, height: 640 });

const driftedCandidate = structuredClone(stagedInputs.candidate);
driftedCandidate.description = `${driftedCandidate.description}.`;
driftedCandidate.tags = [...driftedCandidate.tags].reverse();
const candidateDrift = buildReceipt({ ...stagedInputs, candidate: driftedCandidate });
assert.equal(candidateDrift.ok, false);
assert(candidateDrift.localErrors.includes("registry_candidate_package_projection_mismatch"));

const wrongSubmissionPolicy = structuredClone(stagedInputs.policy);
wrongSubmissionPolicy.registryContract.submissionFilename = "wrong.json";
const wrongSubmission = buildReceipt({ ...stagedInputs, policy: wrongSubmissionPolicy });
assert.equal(wrongSubmission.ok, false);
assert(wrongSubmission.localErrors.includes("registry_submission_filename_mismatch"));

const wrongGeneratedPathPolicy = structuredClone(stagedInputs.policy);
wrongGeneratedPathPolicy.registryContract.generatedRegistryPath = "generated-registry.json";
const wrongGeneratedPath = buildReceipt({ ...stagedInputs, policy: wrongGeneratedPathPolicy });
assert.equal(wrongGeneratedPath.ok, false);
assert(wrongGeneratedPath.localErrors.includes("registry_generated_output_path_mismatch"));

const wrongGeneratedWirePolicy = structuredClone(stagedInputs.policy);
wrongGeneratedWirePolicy.registryContract.generatedWireContract.supportsV1 = true;
const wrongGeneratedWire = buildReceipt({ ...stagedInputs, policy: wrongGeneratedWirePolicy });
assert.equal(wrongGeneratedWire.ok, false);
assert(wrongGeneratedWire.localErrors.includes("registry_generated_wire_contract_mismatch"));

const wrongGeneratorPolicy = structuredClone(stagedInputs.policy);
wrongGeneratorPolicy.registryContract.generator.sha256 = "0".repeat(64);
const wrongGenerator = buildReceipt({ ...stagedInputs, policy: wrongGeneratorPolicy });
assert.equal(wrongGenerator.ok, false);
assert(wrongGenerator.localErrors.includes("registry_generator_contract_mismatch"));

const wrongFetchPin = structuredClone(stagedInputs.packageJson);
wrongFetchPin.dependencies["@x402/fetch"] = "^2.20.0";
const fetchPin = buildReceipt({ ...stagedInputs, packageJson: wrongFetchPin });
assert.equal(fetchPin.ok, false);
assert(fetchPin.localErrors.includes("x402_fetch_pin_mismatch"));

const wrongEvmPin = structuredClone(stagedInputs.packageJson);
wrongEvmPin.dependencies["@x402/evm"] = "latest";
const evmPin = buildReceipt({ ...stagedInputs, packageJson: wrongEvmPin });
assert.equal(evmPin.ok, false);
assert(evmPin.localErrors.includes("x402_evm_pin_mismatch"));

const invalidElizaMetadata = structuredClone(stagedInputs.packageJson);
delete invalidElizaMetadata.elizaos.kind;
delete invalidElizaMetadata.exports["./package.json"];
invalidElizaMetadata.exports["."].import = "./dist/wrong.js";
invalidElizaMetadata.exports["."].default = "./dist/wrong.js";
invalidElizaMetadata.exports["."].require = "./dist/index.cjs";
delete invalidElizaMetadata.agentConfig;
delete invalidElizaMetadata.packageType;
delete invalidElizaMetadata.platform;
const elizaMetadata = buildReceipt({ ...stagedInputs, packageJson: invalidElizaMetadata });
assert.equal(elizaMetadata.ok, false);
assert(elizaMetadata.localErrors.includes("elizaos_kind_mismatch"));
assert(elizaMetadata.localErrors.includes("package_json_export_missing"));
assert(elizaMetadata.localErrors.includes("elizaos_esm_export_mismatch"));
assert(elizaMetadata.localErrors.includes("elizaos_cjs_export_must_be_absent"));
assert(elizaMetadata.localErrors.includes("elizaos_agent_config_type_mismatch"));
assert(elizaMetadata.localErrors.includes("elizaos_agent_config_parameters_mismatch"));
assert(elizaMetadata.localErrors.includes("elizaos_package_type_mismatch"));
assert(elizaMetadata.localErrors.includes("elizaos_platform_mismatch"));

const invalidElizaPolicy = structuredClone(stagedInputs.policy);
invalidElizaPolicy.elizaosContract.v2CompatibilityClaimed = true;
const elizaPolicy = buildReceipt({ ...stagedInputs, policy: invalidElizaPolicy });
assert.equal(elizaPolicy.ok, false);
assert(elizaPolicy.localErrors.includes("elizaos_release_line_contract_mismatch"));

const invalidPluginName = structuredClone(stagedInputs.packageJson);
invalidPluginName.name = "@scrysolanahub/scry";
const pluginName = buildReceipt({ ...stagedInputs, packageJson: invalidPluginName });
assert.equal(pluginName.ok, false);
assert(pluginName.localErrors.includes("elizaos_plugin_package_name_mismatch"));

const invalidPluginScope = structuredClone(stagedInputs.packageJson);
invalidPluginScope.name = "@unowned/plugin-scry";
const pluginScope = buildReceipt({ ...stagedInputs, packageJson: invalidPluginScope });
assert.equal(pluginScope.ok, false);
assert(pluginScope.localErrors.includes("elizaos_plugin_package_scope_mismatch"));

const missingLogo = buildReceipt({ ...stagedInputs, logoBytes: null });
assert.equal(missingLogo.ok, false);
assert(missingLogo.localErrors.includes("elizaos_logo_missing"));

const invalidBanner = buildReceipt({ ...stagedInputs, bannerBytes: Buffer.from("not-a-jpeg") });
assert.equal(invalidBanner.ok, false);
assert(invalidBanner.localErrors.includes("elizaos_banner_jpeg_invalid"));
assert(invalidBanner.localErrors.includes("elizaos_banner_sha256_mismatch"));

const tamperedLogo = buildReceipt({
  ...stagedInputs,
  logoBytes: Buffer.concat([stagedInputs.logoBytes, Buffer.from([0])]),
});
assert.equal(tamperedLogo.ok, false);
assert(tamperedLogo.localErrors.includes("elizaos_logo_sha256_mismatch"));

const tamperedTrustedWorkflow = buildReceipt({
  ...stagedInputs,
  trustedWorkflowBytes: Buffer.concat([stagedInputs.trustedWorkflowBytes, Buffer.from("\n")]),
});
assert.equal(tamperedTrustedWorkflow.ok, false);
assert(tamperedTrustedWorkflow.localErrors.includes("trusted_workflow_sha256_mismatch"));

const credentialedWorkflow = buildReceipt({
  ...stagedInputs,
  trustedWorkflowBytes: Buffer.concat([
    stagedInputs.trustedWorkflowBytes,
    Buffer.from("\n# NODE_AUTH_TOKEN\n"),
  ]),
});
assert.equal(credentialedWorkflow.ok, false);
assert(
  credentialedWorkflow.localErrors.includes(
    "trusted_workflow_forbidden_credential:NODE_AUTH_TOKEN",
  ),
);

const automaticWorkflow = buildReceipt({
  ...stagedInputs,
  trustedWorkflowBytes: Buffer.concat([
    stagedInputs.trustedWorkflowBytes,
    Buffer.from("\n  push:\n    tags: ['v*']\n"),
  ]),
});
assert.equal(automaticWorkflow.ok, false);
assert(automaticWorkflow.localErrors.includes("trusted_workflow_unexpected_trigger"));

const mismatchedPublisherState = structuredClone(stagedInputs.policy);
mismatchedPublisherState.trustedPublishContract.configurationStatus = "configured";
const publisherState = buildReceipt({ ...stagedInputs, policy: mismatchedPublisherState });
assert.equal(publisherState.ok, false);
assert(publisherState.localErrors.includes("trusted_publisher_status_blocker_mismatch"));

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
  `${JSON.stringify({ schema: "scry.elizaos-release-readiness-test.v1", ok: true, tests: 35 })}\n`,
);
