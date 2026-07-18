import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import standaloneCode from "ajv/dist/standalone/index.js";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT_PATH), "..");
const SNAPSHOT_PATH = resolve(ROOT, "contracts/scry-wallet-contracts.json");
const GENERATED_PATH = resolve(ROOT, "src/generated/scry-contract-validators.js");
const SOURCE_URL = "https://scry.solanahub.de/.well-known/x402.json";
const SCHEMA_VERSION = 1;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

const EXPECTED = [
  {
    key: "walletQuickFlag",
    exportName: "validateWalletQuickFlag",
    path: "/x402/wallet/:address/quick-flag",
    product: "scry_wallet_quick_flag",
    priceUsd: 0.001,
  },
  {
    key: "walletForensics",
    exportName: "validateWalletForensics",
    path: "/x402/wallet/:address/forensics",
    product: "scry_wallet_forensics",
    priceUsd: 0.05,
  },
  {
    key: "walletLineage",
    exportName: "validateWalletLineage",
    path: "/x402/wallet/:address/lineage",
    product: "scry_wallet_lineage",
    priceUsd: 0.03,
  },
  {
    key: "launchWindowCluster",
    exportName: "validateLaunchWindowCluster",
    path: "/x402/wallet/:address/launch-window-cluster",
    product: "scry_launch_window_cluster",
    priceUsd: 0.05,
  },
  {
    key: "fullContextPro",
    exportName: "validateFullContextPro",
    path: "/x402/wallet/:address/full-context-pro",
    product: "scry_wallet_full_context_pro",
    priceUsd: 0.18,
  },
  {
    key: "persistentWalletsWeekly",
    exportName: "validatePersistentWalletsWeekly",
    path: "/x402/solana/persistent-wallets/weekly",
    product: "scry_weekly_persistent_wallets",
    priceUsd: 0.2,
  },
  {
    key: "pumpfunLaunchDossier",
    exportName: "validatePumpfunLaunchDossier",
    path: "/x402/pumpfun/launch-dossier",
    product: "scry_pumpfun_launch_dossier",
    priceUsd: 0.3,
  },
];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function stableJson(value, pretty = false) {
  return `${JSON.stringify(stableValue(value), null, pretty ? 2 : undefined)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parsePrice(value, path) {
  if (typeof value !== "string" || !/^\$\d+\.\d{1,6}$/.test(value)) {
    throw new Error(`${path} has a malformed USD price`);
  }
  const parsed = Number(value.slice(1));
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${path} has an invalid price`);
  return parsed;
}

function extractContracts(manifest) {
  if (!isRecord(manifest) || !Array.isArray(manifest.endpoints)) {
    throw new Error("Discovery manifest must contain an endpoints array");
  }

  return EXPECTED.map((expected) => {
    const matches = manifest.endpoints.filter(
      (endpoint) => isRecord(endpoint) && endpoint.path === expected.path,
    );
    if (matches.length !== 1) {
      throw new Error(`${expected.path} must occur exactly once; observed ${matches.length}`);
    }
    const endpoint = matches[0];
    if (!isRecord(endpoint.output_schema)) {
      throw new Error(`${expected.path} has no output_schema object`);
    }
    const product = endpoint.output_schema.properties?.product?.const;
    if (product !== expected.product) {
      throw new Error(`${expected.path} product const does not match ${expected.product}`);
    }
    const priceUsd = parsePrice(endpoint.price, expected.path);
    if (priceUsd !== expected.priceUsd) {
      throw new Error(`${expected.path} price changed from $${expected.priceUsd} to $${priceUsd}`);
    }
    return {
      ...expected,
      outputSchema: endpoint.output_schema,
    };
  });
}

function buildSnapshot(manifest) {
  const contracts = extractContracts(manifest);
  return {
    schemaVersion: SCHEMA_VERSION,
    sourceUrl: SOURCE_URL,
    contractsSha256: sha256(stableJson(contracts)),
    contracts,
  };
}

function validateSnapshot(snapshot) {
  if (!isRecord(snapshot) || snapshot.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Contract snapshot schemaVersion must be ${SCHEMA_VERSION}`);
  }
  if (snapshot.sourceUrl !== SOURCE_URL || !Array.isArray(snapshot.contracts)) {
    throw new Error("Contract snapshot source or contracts are invalid");
  }
  const expectedHash = sha256(stableJson(snapshot.contracts));
  if (snapshot.contractsSha256 !== expectedHash) {
    throw new Error("Contract snapshot hash does not match its contents");
  }
  for (const expected of EXPECTED) {
    const contract = snapshot.contracts.find((candidate) => candidate?.key === expected.key);
    if (!contract || contract.path !== expected.path || contract.product !== expected.product) {
      throw new Error(`Contract snapshot is missing the exact ${expected.key} identity`);
    }
    if (contract.priceUsd !== expected.priceUsd || !isRecord(contract.outputSchema)) {
      throw new Error(`Contract snapshot has invalid price or schema for ${expected.key}`);
    }
  }
  if (snapshot.contracts.length !== EXPECTED.length) {
    throw new Error(`Contract snapshot must contain exactly ${EXPECTED.length} contracts`);
  }
}

function generateValidators(snapshot) {
  validateSnapshot(snapshot);
  const ajv = new Ajv({
    allErrors: true,
    allowUnionTypes: true,
    code: { source: true, esm: true, optimize: 2 },
    ownProperties: true,
    strict: true,
  });
  const exports = {};
  for (const contract of snapshot.contracts) {
    const schemaId = `urn:scry:contract:${contract.key}:${snapshot.contractsSha256}`;
    ajv.addSchema({ ...contract.outputSchema, $id: schemaId }, schemaId);
    exports[contract.exportName] = schemaId;
  }
  const generated = standaloneCode(ajv, exports);
  return [
    "// Generated by scripts/scry-contracts.mjs. Do not edit.",
    `// contracts-sha256: ${snapshot.contractsSha256}`,
    generated,
    `export const SCRY_CONTRACTS_SHA256 = ${JSON.stringify(snapshot.contractsSha256)};`,
    "",
  ].join("\n");
}

async function loadSnapshot() {
  const parsed = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8"));
  validateSnapshot(parsed);
  return parsed;
}

async function readJsonResponse(response, maxBytes = MAX_MANIFEST_BYTES) {
  const rawLength = response.headers.get("content-length");
  if (rawLength !== null) {
    const declaredLength = Number(rawLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      throw new Error("Manifest has an invalid Content-Length");
    }
    if (declaredLength > maxBytes) throw new Error("Manifest exceeds the response size limit");
  }

  if (!response.body) throw new Error("Manifest response body is missing");
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new Error("Manifest exceeds the response size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Manifest response is not valid UTF-8");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Manifest response is malformed JSON");
  }
  if (!isRecord(parsed)) throw new Error("Manifest response must be a JSON object");
  return parsed;
}

async function fetchManifest() {
  const response = await fetch(SOURCE_URL, {
    headers: { accept: "application/json", "user-agent": "elizaos-plugin-scry-contract-check/1" },
    redirect: "error",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status !== 200) throw new Error(`Manifest returned HTTP ${response.status}`);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) throw new Error("Manifest response is not JSON");
  return readJsonResponse(response);
}

async function verify() {
  const snapshot = await loadSnapshot();
  const expectedGenerated = generateValidators(snapshot);
  const actualGenerated = await readFile(GENERATED_PATH, "utf8");
  if (actualGenerated !== expectedGenerated) {
    throw new Error("Generated validators do not match the pinned contract snapshot");
  }
  return {
    mode: "verify",
    status: "green",
    network: false,
    writes: false,
    contracts: snapshot.contracts.length,
    contractsSha256: snapshot.contractsSha256,
  };
}

async function check() {
  const snapshot = await loadSnapshot();
  const live = buildSnapshot(await fetchManifest());
  const changedContracts = EXPECTED.filter((expected) => {
    const pinned = snapshot.contracts.find((contract) => contract.key === expected.key);
    const current = live.contracts.find((contract) => contract.key === expected.key);
    return stableJson(pinned) !== stableJson(current);
  }).map((expected) => expected.key);
  if (changedContracts.length > 0 || live.contractsSha256 !== snapshot.contractsSha256) {
    throw new Error(
      `Live contract drift detected: ${changedContracts.join(", ") || "hash mismatch"}`,
    );
  }
  return {
    mode: "check",
    status: "green",
    network: true,
    writes: false,
    sourceUrl: SOURCE_URL,
    contracts: live.contracts.length,
    contractsSha256: live.contractsSha256,
  };
}

async function sync() {
  const snapshot = JSON.parse(stableJson(buildSnapshot(await fetchManifest())));
  const generated = generateValidators(snapshot);
  await writeFile(SNAPSHOT_PATH, stableJson(snapshot, true), "utf8");
  await writeFile(GENERATED_PATH, generated, "utf8");
  return {
    mode: "sync",
    status: "green",
    network: true,
    writes: true,
    sourceUrl: SOURCE_URL,
    contracts: snapshot.contracts.length,
    contractsSha256: snapshot.contractsSha256,
    written: [SNAPSHOT_PATH, GENERATED_PATH],
  };
}

async function runCli(mode) {
  try {
    const result =
      mode === "verify"
        ? await verify()
        : mode === "check"
          ? await check()
          : mode === "sync"
            ? await sync()
            : undefined;
    if (!result) throw new Error(`Unknown mode: ${mode}`);
    process.stdout.write(
      `${JSON.stringify({ schema: "scry.contract-gate.v1", ok: true, ...result })}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown contract-gate failure";
    process.stderr.write(
      `${JSON.stringify({ schema: "scry.contract-gate.v1", ok: false, mode, status: "red", message })}\n`,
    );
    process.exitCode = 1;
  }
}

export {
  buildSnapshot,
  EXPECTED,
  extractContracts,
  generateValidators,
  readJsonResponse,
  sha256,
  stableJson,
  validateSnapshot,
};

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  await runCli(process.argv[2] ?? "verify");
}
