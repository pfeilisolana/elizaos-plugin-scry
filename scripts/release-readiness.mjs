import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Ajv from "ajv";

const ROOT = resolve(import.meta.dirname, "..");

async function readJson(path) {
  return JSON.parse(await readFile(resolve(ROOT, path), "utf8"));
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
  const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);
  if (validate(candidate)) return [];
  return (validate.errors ?? []).map((error) => {
    const path = error.instancePath || "$";
    return `registry_entry${path}:${error.keyword}`;
  });
}

function registrySubmissionFilename(packageName) {
  return `${packageName.replace(/^@/, "").replaceAll("/", "__")}.json`;
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
  if (packageJson.version !== policy.version) errors.push("package_version_mismatch");
  if (candidate.package !== policy.package) errors.push("registry_package_mismatch");
  if (candidate.version !== policy.version) errors.push("registry_version_mismatch");
  if (candidate.repository !== `github:${policy.githubRepository}`) {
    errors.push("registry_repository_mismatch");
  }
  if (candidate.kind !== "plugin") errors.push("registry_kind_mismatch");
  if (policy.registryContract.submissionFilename !== registrySubmissionFilename(policy.package)) {
    errors.push("registry_submission_filename_mismatch");
  }
  if (policy.registryContract.entryDirectory !== "packages/registry/entries/third-party") {
    errors.push("registry_entry_directory_mismatch");
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
  return {
    mode,
    packageJson,
    metadata,
    candidate,
    policy,
    schema: JSON.parse(schemaBytes.toString("utf8")),
    schemaBytes,
    bootstrapWorkflowBytes,
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
  loadInputs,
  localErrors,
  registryErrors,
  registrySubmissionFilename,
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  await run(process.argv[2] ?? "staged");
}
