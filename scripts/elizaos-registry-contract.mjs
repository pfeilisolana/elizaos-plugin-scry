import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 256 * 1024;

function digest(algorithm, value) {
  return createHash(algorithm).update(value).digest("hex");
}

function gitBlobSha(value) {
  return digest("sha1", Buffer.concat([Buffer.from(`blob ${value.byteLength}\0`), value]));
}

function decodeUtf8(bytes) {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function fetchBounded(
  url,
  { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json,text/plain;q=0.9" },
      redirect: "error",
      signal: controller.signal,
    });
    if (response.status !== 200) throw new Error("upstream_non_200");

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      await response.body?.cancel("body_too_large");
      throw new Error("upstream_body_too_large");
    }
    if (!response.body) throw new Error("upstream_body_missing");

    const chunks = [];
    let bytesRead = 0;
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel("body_too_large");
        throw new Error("upstream_body_too_large");
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, bytesRead);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("upstream_")) throw error;
    throw new Error("upstream_transport_failed");
  } finally {
    clearTimeout(timeout);
  }
}

function contractErrors({ policy, localSchemaBytes, remoteSchemaBytes, remoteReadmeBytes }) {
  const errors = [];
  const contract = policy.registryContract;

  if (digest("sha256", remoteSchemaBytes) !== contract.schema.sha256) {
    errors.push("upstream_schema_sha256_mismatch");
  }
  if (gitBlobSha(remoteSchemaBytes) !== contract.schema.blobSha) {
    errors.push("upstream_schema_git_blob_mismatch");
  }
  if (!remoteSchemaBytes.equals(localSchemaBytes))
    errors.push("local_schema_differs_from_upstream");
  if (digest("sha256", remoteReadmeBytes) !== contract.readme.sha256) {
    errors.push("upstream_readme_sha256_mismatch");
  }
  if (gitBlobSha(remoteReadmeBytes) !== contract.readme.blobSha) {
    errors.push("upstream_readme_git_blob_mismatch");
  }

  let readme = "";
  try {
    JSON.parse(decodeUtf8(remoteSchemaBytes));
  } catch {
    errors.push("upstream_schema_invalid_utf8_or_json");
  }
  try {
    readme = decodeUtf8(remoteReadmeBytes);
  } catch {
    errors.push("upstream_readme_invalid_utf8");
  }
  for (const fragment of contract.requiredReadmeFragments) {
    if (!readme.includes(fragment)) errors.push(`upstream_readme_missing:${fragment}`);
  }
  return [...new Set(errors)].sort();
}

function npmErrors(metadata, policy) {
  const errors = [];
  if (metadata?.name !== policy.package) errors.push("npm_package_name_mismatch");
  if (metadata?.version !== policy.version) errors.push("npm_package_version_mismatch");
  const expectedRepository = `github:${policy.githubRepository}`;
  const repository = metadata?.repository;
  const repositoryValue = typeof repository === "string" ? repository : repository?.url;
  if (
    repositoryValue !== expectedRepository &&
    repositoryValue !== `git+https://github.com/${policy.githubRepository}.git`
  ) {
    errors.push("npm_repository_mismatch");
  }
  return errors;
}

async function loadPolicy() {
  return JSON.parse(await readFile(resolve(ROOT, "release/release-policy.json"), "utf8"));
}

async function buildContractReceipt(options = {}) {
  const policy = options.policy ?? (await loadPolicy());
  const localSchemaBytes =
    options.localSchemaBytes ??
    (await readFile(resolve(ROOT, "release/registry-entry.schema.json")));
  const fetchImpl = options.fetchImpl ?? fetch;
  const requirePublished = options.requirePublished ?? false;
  const contract = policy.registryContract;
  const errors = [];
  let remoteSchemaBytes;
  let remoteReadmeBytes;
  let metadata;
  try {
    [remoteSchemaBytes, remoteReadmeBytes] = await Promise.all([
      fetchBounded(contract.schema.source, { fetchImpl }),
      fetchBounded(contract.readme.source, { fetchImpl }),
    ]);
    errors.push(
      ...contractErrors({ policy, localSchemaBytes, remoteSchemaBytes, remoteReadmeBytes }),
    );
    if (requirePublished) {
      const npmUrl = `https://registry.npmjs.org/${encodeURIComponent(policy.package)}/${encodeURIComponent(policy.version)}`;
      metadata = JSON.parse(decodeUtf8(await fetchBounded(npmUrl, { fetchImpl })));
      errors.push(...npmErrors(metadata, policy));
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "registry_contract_check_failed");
  }

  const uniqueErrors = [...new Set(errors)].sort();
  return {
    schema: "scry.elizaos-registry-contract.v1",
    ok: uniqueErrors.length === 0,
    status:
      uniqueErrors.length > 0
        ? "upstream_contract_failed"
        : requirePublished
          ? "published_registry_prerequisites_verified"
          : "upstream_contract_verified",
    package: `${policy.package}@${policy.version}`,
    repository: contract.repository,
    branch: contract.branch,
    submissionPath: `${contract.entryDirectory}/${contract.submissionFilename}`,
    schemaSha256: remoteSchemaBytes ? digest("sha256", remoteSchemaBytes) : null,
    readmeSha256: remoteReadmeBytes ? digest("sha256", remoteReadmeBytes) : null,
    publishedPackageVerified: requirePublished && uniqueErrors.length === 0,
    errors: uniqueErrors,
    network: true,
    writes: false,
  };
}

async function run(mode) {
  const receipt = await buildContractReceipt({ requirePublished: mode === "registry" });
  const output = `${JSON.stringify(receipt)}\n`;
  if (receipt.ok) process.stdout.write(output);
  else {
    process.stderr.write(output);
    process.exitCode = 1;
  }
}

export { buildContractReceipt, contractErrors, decodeUtf8, fetchBounded, gitBlobSha, npmErrors };

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  await run(process.argv[2] ?? "check");
}
