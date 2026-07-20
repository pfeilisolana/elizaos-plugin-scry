import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildContractReceipt,
  contractErrors,
  fetchBounded,
  gitBlobSha,
  npmErrors,
} from "./elizaos-registry-contract.mjs";

const schemaBytes = Buffer.from('{"type":"object"}\n');
const readmeBytes = Buffer.from(
  "registry source\nentry route\nsubmit dry-run\nauto discovery\nopen pr\n",
);
const generatorBytes = Buffer.from(
  'v1: { branch: null }\nv2: { branch: "main" }\nv1: null\nv2: entry.version ?? null\nsupports: { v0: false, v1: false, v2: true }\n',
);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const policy = {
  package: "@scrysolanahub/plugin-scry",
  version: "0.1.0",
  githubRepository: "pfeilisolana/elizaos-plugin-scry",
  registryContract: {
    repository: "elizaOS/eliza",
    branch: "develop",
    entryDirectory: "packages/registry/entries/third-party",
    submissionFilename: "scrysolanahub__plugin-scry.json",
    schema: {
      source: "https://example.test/schema",
      sha256: sha256(schemaBytes),
      blobSha: gitBlobSha(schemaBytes),
    },
    readme: {
      source: "https://example.test/readme",
      sha256: sha256(readmeBytes),
      blobSha: gitBlobSha(readmeBytes),
    },
    generator: {
      source: "https://example.test/generator",
      sha256: sha256(generatorBytes),
      blobSha: gitBlobSha(generatorBytes),
      requiredFragments: [
        "v1: { branch: null }",
        'v2: { branch: "main" }',
        "v1: null",
        "v2: entry.version ?? null",
        "supports: { v0: false, v1: false, v2: true }",
      ],
    },
    requiredReadmeFragments: [
      "registry source",
      "entry route",
      "submit dry-run",
      "auto discovery",
      "open pr",
    ],
  },
};

assert.deepEqual(
  contractErrors({
    policy,
    localSchemaBytes: schemaBytes,
    remoteSchemaBytes: schemaBytes,
    remoteReadmeBytes: readmeBytes,
    remoteGeneratorBytes: generatorBytes,
  }),
  [],
);

const drifted = contractErrors({
  policy,
  localSchemaBytes: schemaBytes,
  remoteSchemaBytes: Buffer.from('{"type":"array"}\n'),
  remoteReadmeBytes: readmeBytes,
  remoteGeneratorBytes: generatorBytes,
});
assert(drifted.includes("upstream_schema_sha256_mismatch"));
assert(drifted.includes("local_schema_differs_from_upstream"));

const missingSemantics = contractErrors({
  policy,
  localSchemaBytes: schemaBytes,
  remoteSchemaBytes: schemaBytes,
  remoteReadmeBytes: Buffer.from("registry source only\n"),
  remoteGeneratorBytes: Buffer.from("export const registry = {};\n"),
});
assert(missingSemantics.some((error) => error.startsWith("upstream_readme_missing:")));
assert(missingSemantics.some((error) => error.startsWith("upstream_generator_missing:")));

assert.deepEqual(
  npmErrors(
    {
      name: policy.package,
      version: policy.version,
      repository: { url: `git+https://github.com/${policy.githubRepository}.git` },
    },
    policy,
  ),
  [],
);
assert(npmErrors({}, policy).includes("npm_package_name_mismatch"));

await assert.rejects(
  () =>
    fetchBounded("https://example.test", {
      fetchImpl: async () => new Response("no", { status: 503 }),
    }),
  /upstream_non_200/,
);

await assert.rejects(
  () =>
    fetchBounded("https://example.test", {
      fetchImpl: async () => new Response("0123456789"),
      maxBytes: 4,
    }),
  /upstream_body_too_large/,
);

const fetchImpl = async (url) => {
  if (url.endsWith("/schema")) return new Response(schemaBytes);
  if (url.endsWith("/readme")) return new Response(readmeBytes);
  if (url.endsWith("/generator")) return new Response(generatorBytes);
  return new Response(
    JSON.stringify({
      name: policy.package,
      version: policy.version,
      repository: `github:${policy.githubRepository}`,
    }),
  );
};
const receipt = await buildContractReceipt({
  policy,
  localSchemaBytes: schemaBytes,
  fetchImpl,
  requirePublished: true,
});
assert.equal(receipt.ok, true);
assert.equal(receipt.publishedPackageVerified, true);

process.stdout.write(
  `${JSON.stringify({ schema: "scry.elizaos-registry-contract-test.v1", ok: true, tests: 10 })}\n`,
);
