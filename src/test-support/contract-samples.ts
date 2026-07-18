import { readFileSync } from "node:fs";
import type { ScryProductDefinition, ScryProductId } from "../types.js";

interface JsonSchema {
  const?: unknown;
  enum?: unknown[];
  items?: JsonSchema;
  minimum?: number;
  minItems?: number;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  type?: string | string[];
}

interface ContractSnapshot {
  contracts: Array<{ product: ScryProductId; outputSchema: JsonSchema }>;
}

const snapshot = JSON.parse(
  readFileSync(new URL("../../contracts/scry-wallet-contracts.json", import.meta.url), "utf8"),
) as ContractSnapshot;

function sampleFromSchema(schema: JsonSchema): unknown {
  if (schema.const !== undefined) return schema.const;
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];
  const type = Array.isArray(schema.type)
    ? (schema.type.find((candidate) => candidate !== "null") ?? "null")
    : schema.type;

  if (type === "object") {
    return Object.fromEntries(
      (schema.required ?? []).map((key) => [key, sampleFromSchema(schema.properties?.[key] ?? {})]),
    );
  }
  if (type === "array") {
    const length = schema.minItems ?? 0;
    return Array.from({ length }, () => sampleFromSchema(schema.items ?? {}));
  }
  if (type === "string") return "example";
  if (type === "number" || type === "integer") return schema.minimum ?? 0;
  if (type === "boolean") return false;
  if (type === "null") return null;
  return {};
}

export function validEvidenceFor(
  definition: ScryProductDefinition,
  subject?: string,
): Record<string, unknown> {
  const contract = snapshot.contracts.find((candidate) => candidate.product === definition.product);
  if (!contract) throw new Error(`Missing test contract for ${definition.product}`);
  const sample = sampleFromSchema(contract.outputSchema);
  if (typeof sample !== "object" || sample === null || Array.isArray(sample)) {
    throw new Error(`Expected an object contract for ${definition.product}`);
  }
  return {
    ...sample,
    product: definition.product,
    ...(definition.subjectField && subject ? { [definition.subjectField]: subject } : {}),
  };
}
