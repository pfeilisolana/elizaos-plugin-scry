import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isolatedNpmEnvironmentFor } from "./npm-isolation.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const WALLET = "4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk";
const MINT = "DezXAZ8z7PnrnRJjz3eeVQMCG1A2LFjU3vHHxh8Gpump";
const URL = `https://scry.solanahub.de/x402/wallet/${WALLET}/quick-flag`;
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const CONTRACT_SNAPSHOT = JSON.parse(
  await readFile(resolve(ROOT, "contracts/scry-wallet-contracts.json"), "utf8"),
);
const CREDENTIAL_ENVIRONMENT_NAME =
  /(TOKEN|SECRET|PASSWORD|PASSPHRASE|PRIVATE|CREDENTIAL|AUTH|API_KEY|ACCESS_KEY|MNEMONIC|SEED)/i;

function scrubCredentialEnvironment() {
  const removed = [];
  for (const key of Object.keys(process.env)) {
    if (!CREDENTIAL_ENVIRONMENT_NAME.test(key)) continue;
    delete process.env[key];
    removed.push(key);
  }
  return removed.sort();
}

const SCRUBBED_CREDENTIAL_ENVIRONMENT = scrubCredentialEnvironment();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_update_notifier: "false",
      ...(options.env ?? {}),
    },
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status ?? "signal"})\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

function paymentRequired() {
  const resource = {
    url: URL,
    description: "Scry quick flag",
    mimeType: "application/json",
  };
  return {
    x402Version: 2,
    resource,
    accepts: [
      {
        scheme: "exact",
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
        amount: "1000",
        asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        payTo: "CTKigV78yuErumvqm7Qor8j1hMK2oxNxdhwpVrAKV85d",
        maxTimeoutSeconds: 900,
        extra: { feePayer: "D6ZhtNQ5nT9ZnTHUbqXZsTx5MH2rPFiBBggX4hY1WePM" },
      },
      {
        scheme: "exact",
        network: "eip155:8453",
        amount: "1000",
        asset: BASE_USDC,
        payTo: "0xF4A904d8326786d90157cf791C281302F11b2036",
        maxTimeoutSeconds: 900,
        extra: { name: "USD Coin", version: "2" },
      },
    ],
    extensions: { bazaar: { info: { provider: "Scry" } } },
  };
}

function challenge(required) {
  return new Response("payment required", {
    status: 402,
    headers: {
      "payment-required": Buffer.from(JSON.stringify(required)).toString("base64"),
    },
  });
}

function sampleFromSchema(schema = {}) {
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  const type = Array.isArray(schema.type)
    ? (schema.type.find((candidate) => candidate !== "null") ?? "null")
    : schema.type;
  if (type === "object") {
    return Object.fromEntries(
      (schema.required ?? []).map((key) => [key, sampleFromSchema(schema.properties?.[key])]),
    );
  }
  if (type === "array") {
    return Array.from({ length: schema.minItems ?? 0 }, () => sampleFromSchema(schema.items));
  }
  if (type === "string") return "example";
  if (type === "number" || type === "integer") return schema.minimum ?? 0;
  if (type === "boolean") return false;
  if (type === "null") return null;
  return {};
}

function subjectFor(definition) {
  if (definition.inputKind === "none") return undefined;
  return definition.inputKind === "mint" ? MINT : WALLET;
}

function expectedUrlFor(pluginPackage, definition, subject) {
  if (definition.inputKind === "none") {
    return `${pluginPackage.SCRY_ORIGIN}${definition.routeTemplate}`;
  }
  if (definition.inputKind === "mint") {
    return `${pluginPackage.SCRY_ORIGIN}${definition.routeTemplate}?mint=${subject}`;
  }
  return `${pluginPackage.SCRY_ORIGIN}${definition.routeTemplate.replace(":address", subject)}`;
}

function contractEvidenceFor(definition, subject) {
  const contract = CONTRACT_SNAPSHOT.contracts.find(
    (candidate) => candidate.product === definition.product,
  );
  assert.ok(contract, `contract snapshot must include ${definition.product}`);
  const sample = sampleFromSchema(contract.outputSchema);
  assert.ok(typeof sample === "object" && sample !== null && !Array.isArray(sample));
  return {
    ...sample,
    product: definition.product,
    ...(definition.subjectField && subject ? { [definition.subjectField]: subject } : {}),
  };
}

async function verifyInstalledPackage(consumerDir) {
  const installedPackageJson = JSON.parse(
    await readFile(
      join(consumerDir, "node_modules/@scrysolanahub/plugin-scry/package.json"),
      "utf8",
    ),
  );
  assert.equal(installedPackageJson.packageType, "plugin");
  assert.equal(installedPackageJson.platform, "node");
  assert.deepEqual(installedPackageJson.agentConfig, {
    pluginType: "elizaos:plugin:1.0.0",
    pluginParameters: {},
  });
  assert.equal(installedPackageJson.exports?.["./package.json"], "./package.json");
  assert.deepEqual(installedPackageJson.exports?.["."], {
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
    default: "./dist/index.js",
  });

  let importFetches = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    importFetches += 1;
    throw new Error("unexpected import-time fetch");
  };

  let pluginPackage;
  try {
    pluginPackage = await import(
      `${pathToFileURL(join(consumerDir, "node_modules/@scrysolanahub/plugin-scry/dist/index.js")).href}?smoke=${Date.now()}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(importFetches, 0, "package import must be network-free");
  assert.equal(pluginPackage.default.actions.length, 7, "default plugin must expose seven actions");

  const required = paymentRequired();
  let networkCalls = 0;
  let observedPayload;
  const fakeFetch = async (input) => {
    networkCalls += 1;
    const request = new Request(input);
    const signature = request.headers.get("payment-signature");
    if (!signature) return challenge(required);
    observedPayload = JSON.parse(Buffer.from(signature, "base64").toString("utf8"));
    return new Response(
      JSON.stringify(
        contractEvidenceFor(pluginPackage.SCRY_PRODUCTS.SCRY_WALLET_QUICK_FLAG, WALLET),
      ),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };
  const signer = {
    address: "0x1111111111111111111111111111111111111111",
    async signTypedData() {
      return `0x${"11".repeat(65)}`;
    },
  };
  const transport = pluginPackage.createScryBaseX402Transport({
    signer,
    maxPaymentUsd: 0.001,
    fetch: fakeFetch,
  });
  const client = pluginPackage.createScryClient({
    transport,
    maxPaymentUsd: 0.001,
    sessionBudgetUsd: 0.001,
  });
  const result = await client.query(pluginPackage.SCRY_PRODUCTS.SCRY_WALLET_QUICK_FLAG, WALLET);

  assert.equal(result.ok, true, "installed package must deliver validated evidence");
  assert.equal(networkCalls, 2, "installed transport must make challenge plus one paid retry");
  assert.deepEqual(observedPayload.resource, required.resource);
  assert.deepEqual(observedPayload.extensions, required.extensions);
  assert.equal(observedPayload.accepted.network, "eip155:8453");
  assert.equal(observedPayload.accepted.amount, "1000");
  assert.equal(observedPayload.accepted.asset, BASE_USDC);

  let contractDeliveryFetches = 0;
  let contractProductsDelivered = 0;
  for (const definition of pluginPackage.SCRY_PRODUCT_LIST) {
    const subject = subjectFor(definition);
    const expectedUrl = expectedUrlFor(pluginPackage, definition, subject);
    const evidence = contractEvidenceFor(definition, subject);
    const quoteClient = pluginPackage.createScryClient({
      transport: {
        paymentMode: "quote-only",
        fetch: async (input) => {
          contractDeliveryFetches += 1;
          assert.equal(new Request(input).url, expectedUrl);
          return new Response(JSON.stringify(evidence), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    });
    const delivery = await quoteClient.query(definition, subject);
    assert.equal(delivery.ok, true, `${definition.product} must deliver validated evidence`);
    contractProductsDelivered += 1;
  }
  assert.equal(contractProductsDelivered, 7);
  assert.equal(contractDeliveryFetches, 7);
  return { contractDeliveryFetches, contractProductsDelivered, metadataContract: true };
}

async function main() {
  const temp = await mkdtemp(join(tmpdir(), "scry-consumer-smoke-"));
  try {
    const isolatedNpmrc = join(temp, ".npmrc");
    await writeFile(isolatedNpmrc, "");
    const isolatedNpmEnvironment = isolatedNpmEnvironmentFor(temp);
    const packOutput = run(
      NPM,
      ["pack", "--json", "--ignore-scripts", "--pack-destination", temp],
      { env: isolatedNpmEnvironment },
    );
    const packed = JSON.parse(packOutput);
    assert.equal(packed.length, 1, "npm pack must produce exactly one tarball");
    const tarballName = packed[0]?.filename;
    assert.equal(typeof tarballName, "string");
    const tarball = join(temp, tarballName);
    const corePackOutput = run(
      NPM,
      [
        "pack",
        "--json",
        "--ignore-scripts",
        "--pack-destination",
        temp,
        resolve(ROOT, "node_modules/@elizaos/core"),
      ],
      { env: isolatedNpmEnvironment },
    );
    const packedCore = JSON.parse(corePackOutput);
    assert.equal(packedCore.length, 1, "npm pack must produce exactly one core tarball");
    assert.equal(packedCore[0]?.name, "@elizaos/core");
    assert.equal(packedCore[0]?.version, "1.7.2");
    const coreTarballName = packedCore[0]?.filename;
    assert.equal(typeof coreTarballName, "string");
    const coreTarball = join(temp, coreTarballName);
    await writeFile(
      join(temp, "package.json"),
      `${JSON.stringify({ name: "scry-consumer-smoke", private: true, type: "module" })}\n`,
    );
    run(
      NPM,
      [
        "install",
        "--prefer-offline",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        coreTarball,
        tarball,
      ],
      { cwd: temp, env: isolatedNpmEnvironment },
    );
    const delivery = await verifyInstalledPackage(temp);

    const tarballBytes = await readFile(tarball);
    const coreTarballBytes = await readFile(coreTarball);
    process.stdout.write(
      `${JSON.stringify({
        schema: "scry.elizaos-consumer-smoke.v1",
        ok: true,
        package: "@scrysolanahub/plugin-scry@0.1.0",
        tarballSha256: createHash("sha256").update(tarballBytes).digest("hex"),
        hostCore: "@elizaos/core@1.7.2",
        hostCoreTarballSha256: createHash("sha256").update(coreTarballBytes).digest("hex"),
        importFetches: 0,
        actions: 7,
        transportHttpAttempts: 2,
        deliveredEvidence: true,
        metadataContract: delivery.metadataContract,
        contractProductsDelivered: delivery.contractProductsDelivered,
        contractDeliveryFetches: delivery.contractDeliveryFetches,
        installMode: "isolated_prefer_offline_local_peer_tarballs_ignore_scripts",
        installNetworkPermitted: true,
        runtimeExternalNetworkRequests: 0,
        credentialEnvironmentSanitized: true,
        credentialEnvironmentKeysRemoved: SCRUBBED_CREDENTIAL_ENVIRONMENT.length,
        isolatedNpmUserConfig: true,
        isolatedNpmCache: true,
        isolatedNpmLogs: true,
        runtimeNetwork: false,
        workspacePersistentWrites: false,
        tempCleanup: true,
      })}\n`,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

await main();
