import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Ajv from "ajv";

const ROOT = resolve(import.meta.dirname, "..");

async function readJson(path) {
  return JSON.parse(await readFile(resolve(ROOT, path), "utf8"));
}

async function readOptionalBytes(path) {
  try {
    return await readFile(resolve(ROOT, path));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  }
}

function digest(algorithm, value) {
  return createHash(algorithm).update(value).digest("hex");
}

function gitBlobSha(value) {
  return digest("sha1", Buffer.concat([Buffer.from(`blob ${value.byteLength}\0`), value]));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function same(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function registryErrors(candidate, schema) {
  // The upstream elizaOS schema declares `app` at the root while requiring it
  // from an `allOf.then` subschema. Keep strict validation everywhere else,
  // but allow that valid cross-subschema required reference.
  const validate = new Ajv({ allErrors: true, strict: true, strictRequired: false }).compile(
    schema,
  );
  if (validate(candidate)) return [];
  return (validate.errors ?? []).map((error) => {
    const path = error.instancePath || "$";
    return `registry_entry${path}:${error.keyword}`;
  });
}

function registrySubmissionFilename(packageName) {
  return `${packageName.replace(/^@/, "").replaceAll("/", "__")}.json`;
}

function jpegDimensions(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda) return null;
    if (offset + 1 >= bytes.length) return null;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame) {
      if (segmentLength < 7) return null;
      return {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      };
    }
    offset += segmentLength;
  }
  return null;
}

function assetErrors(name, bytes, contract) {
  if (!Buffer.isBuffer(bytes)) return [`elizaos_${name}_missing`];
  const errors = [];
  const dimensions = jpegDimensions(bytes);
  if (!dimensions) errors.push(`elizaos_${name}_jpeg_invalid`);
  if (
    dimensions &&
    (dimensions.width !== contract.width || dimensions.height !== contract.height)
  ) {
    errors.push(`elizaos_${name}_dimensions_mismatch`);
  }
  if (bytes.byteLength > contract.maxBytes) errors.push(`elizaos_${name}_size_exceeded`);
  if (digest("sha256", bytes) !== contract.sha256) {
    errors.push(`elizaos_${name}_sha256_mismatch`);
  }
  return errors;
}

function normalizeGithubRepository(repository) {
  const raw = typeof repository === "string" ? repository : repository?.url;
  if (typeof raw !== "string") return null;
  const normalized = raw
    .trim()
    .replace(/^github:/, "")
    .replace(/^git\+/, "")
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/^ssh:\/\/git@github\.com[:/]/, "")
    .replace(/^git:\/\/github\.com\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/\.git$/, "")
    .replace(/#.*$/, "");
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized) ? normalized : null;
}

function registryCandidateFromPackage(packageJson) {
  const repository = normalizeGithubRepository(packageJson.repository);
  const packageName = typeof packageJson.name === "string" ? packageJson.name.trim() : "";
  const declaredKind = packageJson.elizaos?.kind;
  const kind = ["plugin", "connector", "app"].includes(declaredKind)
    ? declaredKind
    : packageName.includes("/app-") || packageName.startsWith("app-")
      ? "app"
      : "plugin";
  const tags = Array.isArray(packageJson.keywords)
    ? [
        ...new Set(
          packageJson.keywords
            .filter((tag) => typeof tag === "string" && tag.trim())
            .map((tag) => tag.trim()),
        ),
      ]
    : [];
  return {
    package: packageName,
    ...(repository ? { repository: `github:${repository}` } : {}),
    kind,
    ...(typeof packageJson.description === "string" && packageJson.description.trim()
      ? { description: packageJson.description.trim() }
      : {}),
    ...(typeof packageJson.homepage === "string" && packageJson.homepage.trim()
      ? { homepage: packageJson.homepage.trim() }
      : {}),
    ...(typeof packageJson.version === "string" && packageJson.version.trim()
      ? { version: packageJson.version.trim() }
      : {}),
    ...(typeof packageJson.repository === "object" &&
    typeof packageJson.repository?.directory === "string" &&
    packageJson.repository.directory.trim()
      ? { directory: packageJson.repository.directory.trim() }
      : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

function localErrors({
  mode,
  packageJson,
  metadata,
  candidate,
  policy,
  schema,
  schemaBytes,
  bootstrapWorkflowBytes,
  logoBytes,
  bannerBytes,
  env = {},
}) {
  const errors = registryErrors(candidate, schema);
  if (digest("sha256", schemaBytes) !== policy.registryContract.schema.sha256) {
    errors.push("registry_schema_sha256_mismatch");
  }
  if (gitBlobSha(schemaBytes) !== policy.registryContract.schema.blobSha) {
    errors.push("registry_schema_git_blob_mismatch");
  }
  if (policy.bootstrapPublishContract?.workflow !== ".github/workflows/bootstrap-publish.yml") {
    errors.push("bootstrap_workflow_path_mismatch");
  }
  if (digest("sha256", bootstrapWorkflowBytes) !== policy.bootstrapPublishContract?.sha256) {
    errors.push("bootstrap_workflow_sha256_mismatch");
  }
  const bootstrapWorkflow = bootstrapWorkflowBytes.toString("utf8");
  for (const fragment of policy.bootstrapPublishContract?.requiredFragments ?? []) {
    if (!bootstrapWorkflow.includes(fragment))
      errors.push(`bootstrap_workflow_fragment_missing:${fragment}`);
  }
  if (
    policy.bootstrapPublishContract?.version !== policy.version ||
    policy.bootstrapPublishContract?.tag !== policy.gitTag ||
    policy.bootstrapPublishContract?.environment !== "npm-production" ||
    policy.bootstrapPublishContract?.node !== "24" ||
    policy.bootstrapPublishContract?.npm !== "11.5.1"
  ) {
    errors.push("bootstrap_workflow_contract_mismatch");
  }
  if (packageJson.name !== policy.package) errors.push("package_name_mismatch");
  const packageName = typeof packageJson.name === "string" ? packageJson.name.trim() : "";
  const packageBasename = packageName.split("/").at(-1) ?? "";
  if (!packageBasename.startsWith("plugin-")) {
    errors.push("elizaos_plugin_package_name_mismatch");
  }
  if (!packageName.startsWith("@scrysolanahub/")) {
    errors.push("elizaos_plugin_package_scope_mismatch");
  }
  const assetContract = policy.elizaosContract?.registryAssets;
  if (
    assetContract?.logo?.path !== "images/logo.jpg" ||
    assetContract?.logo?.width !== 400 ||
    assetContract?.logo?.height !== 400 ||
    assetContract?.logo?.maxBytes !== 500000 ||
    assetContract?.banner?.path !== "images/banner.jpg" ||
    assetContract?.banner?.width !== 1280 ||
    assetContract?.banner?.height !== 640 ||
    assetContract?.banner?.maxBytes !== 1000000
  ) {
    errors.push("elizaos_registry_asset_contract_mismatch");
  } else {
    errors.push(...assetErrors("logo", logoBytes, assetContract.logo));
    errors.push(...assetErrors("banner", bannerBytes, assetContract.banner));
  }
  if (packageJson.version !== policy.version) errors.push("package_version_mismatch");
  if (candidate.package !== policy.package) errors.push("registry_package_mismatch");
  if (candidate.version !== policy.version) errors.push("registry_version_mismatch");
  if (candidate.repository !== `github:${policy.githubRepository}`) {
    errors.push("registry_repository_mismatch");
  }
  if (candidate.kind !== "plugin") errors.push("registry_kind_mismatch");
  if (!same(candidate, registryCandidateFromPackage(packageJson))) {
    errors.push("registry_candidate_package_projection_mismatch");
  }
  if (policy.registryContract.submissionFilename !== registrySubmissionFilename(policy.package)) {
    errors.push("registry_submission_filename_mismatch");
  }
  if (policy.registryContract.entryDirectory !== "packages/registry/entries/third-party") {
    errors.push("registry_entry_directory_mismatch");
  }
  if (
    policy.registryContract.generatedRegistryPath !== "packages/registry/generated-registry.json"
  ) {
    errors.push("registry_generated_output_path_mismatch");
  }
  if (
    policy.registryContract.generatedWireContract?.supportsV0 !== false ||
    policy.registryContract.generatedWireContract?.supportsV1 !== false ||
    policy.registryContract.generatedWireContract?.supportsV2 !== true ||
    policy.registryContract.generatedWireContract?.currentReleaseEligible !== false
  ) {
    errors.push("registry_generated_wire_contract_mismatch");
  }
  if (
    policy.registryContract.generator?.source !==
      "https://raw.githubusercontent.com/elizaOS/eliza/develop/packages/registry/src/generate.ts" ||
    policy.registryContract.generator?.blobSha !== "cb9a27c2ece776bd1ba406e6210b7e74d7c069fd" ||
    policy.registryContract.generator?.sha256 !==
      "a8c81e5c6ee8534b64005ac29edc449e18ef27935dd97f865ff06d900e5602a2" ||
    !policy.registryContract.generator?.requiredFragments?.includes(
      "supports: { v0: false, v1: false, v2: true }",
    ) ||
    !policy.registryContract.generator?.requiredFragments?.includes("app: entry.app")
  ) {
    errors.push("registry_generator_contract_mismatch");
  }

  for (const keyword of policy.requiredKeywords) {
    if (!packageJson.keywords?.includes(keyword)) errors.push(`missing_keyword:${keyword}`);
  }
  if (packageJson.publishConfig?.access !== "public") errors.push("publish_access_not_public");
  if (packageJson.publishConfig?.provenance !== true) errors.push("provenance_not_enabled");
  if (packageJson.publishConfig?.registry !== "https://registry.npmjs.org/") {
    errors.push("publish_registry_mismatch");
  }
  if (packageJson.peerDependencies?.["@elizaos/core"] !== "^1.7.2") {
    errors.push("elizaos_peer_range_mismatch");
  }
  if (packageJson.devDependencies?.["@elizaos/core"] !== "1.7.2") {
    errors.push("elizaos_test_pin_mismatch");
  }
  if (
    policy.elizaosContract?.releaseLine !== "stable-v1" ||
    policy.elizaosContract?.core !== "1.7.2" ||
    policy.elizaosContract?.cli !== "1.7.2" ||
    policy.elizaosContract?.npmScope !== "@scrysolanahub" ||
    policy.elizaosContract?.packageNamePrefix !== "plugin-" ||
    policy.elizaosContract?.moduleFormat !== "esm-only" ||
    policy.elizaosContract?.rootExportDefault !== "./dist/index.js" ||
    policy.elizaosContract?.v2CompatibilityClaimed !== false
  ) {
    errors.push("elizaos_release_line_contract_mismatch");
  }
  if (
    packageJson.packageType !== policy.elizaosContract?.packageType ||
    packageJson.packageType !== "plugin"
  ) {
    errors.push("elizaos_package_type_mismatch");
  }
  if (
    packageJson.platform !== policy.elizaosContract?.platform ||
    packageJson.platform !== "node"
  ) {
    errors.push("elizaos_platform_mismatch");
  }
  if (
    packageJson.agentConfig?.pluginType !== policy.elizaosContract?.agentConfigPluginType ||
    packageJson.agentConfig?.pluginType !== "elizaos:plugin:1.0.0"
  ) {
    errors.push("elizaos_agent_config_type_mismatch");
  }
  const pluginParameters = packageJson.agentConfig?.pluginParameters;
  if (
    policy.elizaosContract?.pluginParameters !== "none" ||
    !pluginParameters ||
    typeof pluginParameters !== "object" ||
    Array.isArray(pluginParameters) ||
    Object.keys(pluginParameters).length !== 0
  ) {
    errors.push("elizaos_agent_config_parameters_mismatch");
  }
  if (packageJson.elizaos?.kind !== "plugin") errors.push("elizaos_kind_mismatch");
  if (packageJson.elizaos?.plugin?.displayName !== "Scry Wallet Intelligence") {
    errors.push("elizaos_display_name_mismatch");
  }
  if (packageJson.elizaos?.plugin?.category !== "data") {
    errors.push("elizaos_category_mismatch");
  }
  if (packageJson.exports?.["./package.json"] !== "./package.json") {
    errors.push("package_json_export_missing");
  }
  const rootExport = packageJson.exports?.["."];
  if (
    rootExport?.types !== "./dist/index.d.ts" ||
    rootExport?.import !== "./dist/index.js" ||
    rootExport?.default !== policy.elizaosContract?.rootExportDefault
  ) {
    errors.push("elizaos_esm_export_mismatch");
  }
  if (rootExport?.require !== undefined) {
    errors.push("elizaos_cjs_export_must_be_absent");
  }
  if (packageJson.dependencies?.["@x402/fetch"] !== "2.19.0") {
    errors.push("x402_fetch_pin_mismatch");
  }
  if (packageJson.dependencies?.["@x402/evm"] !== "2.19.0") {
    errors.push("x402_evm_pin_mismatch");
  }
  if (packageJson.scripts?.prepack !== "npm run build") errors.push("prepack_build_gate_missing");
  if (packageJson.scripts?.prepublishOnly !== "npm run release:publish-gate") {
    errors.push("prepublish_gate_missing");
  }
  if (packageJson.scripts?.["release:consumer-smoke"] !== "node scripts/consumer-smoke.mjs") {
    errors.push("consumer_smoke_script_mismatch");
  }
  if (!packageJson.scripts?.["release:check"]?.includes("npm run release:consumer-smoke")) {
    errors.push("consumer_smoke_release_gate_missing");
  }
  if (!packageJson.scripts?.["release:publish-gate"]?.includes("npm run release:consumer-smoke")) {
    errors.push("consumer_smoke_publish_gate_missing");
  }

  const metadataFields = ["repository", "homepage", "bugs"];
  const applied = metadataFields.filter((field) => packageJson[field] !== undefined);
  if (mode === "staged") {
    if (packageJson.private !== true) errors.push("staged_private_lock_missing");
    if (
      applied.length !== 0 &&
      !metadataFields.every((field) => same(packageJson[field], metadata[field]))
    ) {
      errors.push("package_metadata_overlay_partial_or_mismatched");
    }
  } else if (mode === "publish" || mode === "registry") {
    if (packageJson.private === true) errors.push("publish_private_lock_active");
    for (const field of metadataFields) {
      if (!same(packageJson[field], metadata[field]))
        errors.push(`package_metadata_mismatch:${field}`);
    }
    if (env.GITHUB_REPOSITORY !== policy.githubRepository) {
      errors.push("github_repository_context_mismatch");
    }
    if (mode === "publish") {
      if (env.SCRY_PUBLISH_AUTHORITY !== policy.authorities.firstPublish) {
        errors.push("publish_authority_missing");
      }
      if (env.GITHUB_REF_TYPE !== "tag" || env.GITHUB_REF_NAME !== policy.gitTag) {
        errors.push("github_release_tag_mismatch");
      }
      if (env.GITHUB_ACTIONS !== "true") errors.push("github_actions_context_missing");
    } else {
      if (policy.elizaosContract?.v2CompatibilityClaimed !== true) {
        errors.push("registry_v2_runtime_compatibility_not_proven");
      }
      if (env.SCRY_REGISTRY_AUTHORITY !== policy.authorities.registryPullRequest) {
        errors.push("registry_authority_missing");
      }
      if (env.SCRY_PUBLISHED_PACKAGE !== `${policy.package}@${policy.version}`) {
        errors.push("published_package_attestation_missing");
      }
    }
  } else {
    errors.push("unknown_release_mode");
  }
  return [...new Set(errors)].sort();
}

function buildReceipt(inputs) {
  const errors = localErrors(inputs);
  const staged = inputs.mode === "staged";
  const registry = inputs.mode === "registry";
  return {
    schema: "scry.elizaos-release-readiness.v1",
    ok: errors.length === 0,
    mode: inputs.mode,
    status:
      errors.length > 0
        ? "local_contract_failed"
        : staged
          ? "staged_private_not_publishable"
          : registry
            ? "registry_context_ready"
            : "publish_context_ready",
    package: `${inputs.policy.package}@${inputs.policy.version}`,
    registrySchemaBlobSha: inputs.policy.registryContract.schema.blobSha,
    registrySubmissionPath: `${inputs.policy.registryContract.entryDirectory}/${inputs.policy.registryContract.submissionFilename}`,
    privateLock: inputs.packageJson.private === true,
    publishReady: inputs.mode === "publish" && errors.length === 0,
    registryReady: registry && errors.length === 0,
    localErrors: errors,
    externalBlockers: staged ? inputs.policy.stagedExternalBlockers : [],
    network: false,
    writes: false,
  };
}

async function loadInputs(mode, env = process.env) {
  const [packageJson, metadata, candidate, policy, schemaBytes, bootstrapWorkflowBytes] =
    await Promise.all([
      readJson("package.json"),
      readJson("release/package-metadata.candidate.json"),
      readJson("release/registry-entry.candidate.json"),
      readJson("release/release-policy.json"),
      readFile(resolve(ROOT, "release/registry-entry.schema.json")),
      readFile(resolve(ROOT, ".github/workflows/bootstrap-publish.yml")),
    ]);
  const [logoBytes, bannerBytes] = await Promise.all([
    readOptionalBytes(policy.elizaosContract.registryAssets.logo.path),
    readOptionalBytes(policy.elizaosContract.registryAssets.banner.path),
  ]);
  return {
    mode,
    packageJson,
    metadata,
    candidate,
    policy,
    schema: JSON.parse(schemaBytes.toString("utf8")),
    schemaBytes,
    bootstrapWorkflowBytes,
    logoBytes,
    bannerBytes,
    env,
  };
}

async function run(mode) {
  const receipt = buildReceipt(await loadInputs(mode));
  const output = `${JSON.stringify(receipt)}\n`;
  if (receipt.ok) process.stdout.write(output);
  else {
    process.stderr.write(output);
    process.exitCode = 1;
  }
}

export {
  buildReceipt,
  digest,
  gitBlobSha,
  jpegDimensions,
  loadInputs,
  localErrors,
  registryCandidateFromPackage,
  registryErrors,
  registrySubmissionFilename,
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  await run(process.argv[2] ?? "staged");
}
