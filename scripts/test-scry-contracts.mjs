import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildSnapshot,
  EXPECTED,
  generateValidators,
  readJsonResponse,
  sha256,
  stableJson,
  validateSnapshot,
} from "./scry-contracts.mjs";

const root = resolve(import.meta.dirname, "..");
const snapshot = JSON.parse(
  await readFile(resolve(root, "contracts/scry-wallet-contracts.json"), "utf8"),
);
const generated = await readFile(
  resolve(root, "src/generated/scry-contract-validators.js"),
  "utf8",
);

function clone(value) {
  return structuredClone(value);
}

function manifestFromSnapshot(source = snapshot) {
  return {
    endpoints: source.contracts.map((contract) => ({
      path: contract.path,
      price: `$${contract.priceUsd}`,
      output_schema: clone(contract.outputSchema),
    })),
  };
}

function expectFailure(callback, pattern) {
  assert.throws(callback, pattern);
}

async function expectAsyncFailure(callback, pattern) {
  await assert.rejects(callback, pattern);
}

validateSnapshot(snapshot);
assert.equal(generateValidators(snapshot), generated, "validator generation must be byte-stable");
assert.equal(buildSnapshot(manifestFromSnapshot()).contractsSha256, snapshot.contractsSha256);
assert.deepEqual(
  snapshot.contracts.map((contract) => contract.key),
  EXPECTED.map((contract) => contract.key),
);

const badHash = clone(snapshot);
badHash.contractsSha256 = "0".repeat(64);
expectFailure(() => validateSnapshot(badHash), /hash does not match/);

const badPrice = clone(snapshot);
badPrice.contracts[0].priceUsd = 99;
badPrice.contractsSha256 = sha256(stableJson(badPrice.contracts));
expectFailure(() => validateSnapshot(badPrice), /invalid price or schema/);

const badIdentity = clone(snapshot);
badIdentity.contracts[0].product = "not-scry";
badIdentity.contractsSha256 = sha256(stableJson(badIdentity.contracts));
expectFailure(() => validateSnapshot(badIdentity), /exact walletQuickFlag identity/);

const duplicateManifest = manifestFromSnapshot();
duplicateManifest.endpoints.push(clone(duplicateManifest.endpoints[0]));
expectFailure(() => buildSnapshot(duplicateManifest), /must occur exactly once/);

const changedLivePrice = manifestFromSnapshot();
changedLivePrice.endpoints[0].price = "$0.06";
expectFailure(() => buildSnapshot(changedLivePrice), /price changed/);

const malformedLivePrice = manifestFromSnapshot();
malformedLivePrice.endpoints[0].price = "five cents";
expectFailure(() => buildSnapshot(malformedLivePrice), /malformed USD price/);

const changedProduct = manifestFromSnapshot();
changedProduct.endpoints[0].output_schema.properties.product.const = "wrong_product";
expectFailure(() => buildSnapshot(changedProduct), /product const does not match/);

const missingSchema = manifestFromSnapshot();
delete missingSchema.endpoints[0].output_schema;
expectFailure(() => buildSnapshot(missingSchema), /has no output_schema object/);

assert.equal(stableJson({ b: 2, a: 1 }), '{"a":1,"b":2}\n');

const manifestBytes = new TextEncoder().encode(JSON.stringify(manifestFromSnapshot()));
assert.deepEqual(
  await readJsonResponse(
    new Response(manifestBytes, {
      headers: { "content-length": String(manifestBytes.byteLength) },
    }),
  ),
  manifestFromSnapshot(),
);
await expectAsyncFailure(
  () =>
    readJsonResponse(
      new Response(new Uint8Array(120), {
        headers: { "content-length": "120" },
      }),
      100,
    ),
  /size limit/,
);
await expectAsyncFailure(
  () =>
    readJsonResponse(
      new Response(new Uint8Array([0xc3, 0x28]), {
        headers: { "content-length": "2" },
      }),
    ),
  /valid UTF-8/,
);
await expectAsyncFailure(
  () => readJsonResponse(new Response("[]", { headers: { "content-length": "2" } })),
  /JSON object/,
);

process.stdout.write(
  `${JSON.stringify({ schema: "scry.contract-gate-test.v1", ok: true, tests: 14 })}\n`,
);
