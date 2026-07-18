import { describe, expect, it } from "vitest";
import { SCRY_PRODUCT_LIST, SCRY_PRODUCTS } from "./catalog.js";
import { SCRY_CONTRACTS_SHA256, validateScryContract } from "./contracts.js";
import { validEvidenceFor } from "./test-support/contract-samples.js";

const WALLET = "4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk";

describe("pinned Scry response contracts", () => {
  it("binds runtime validation to the deterministic manifest snapshot", () => {
    expect(SCRY_CONTRACTS_SHA256).toBe(
      "1655aebb996853fe9491f6a2c7eb1714902e6168c3f680eddde37ceb22dd2782",
    );
  });

  it.each(SCRY_PRODUCT_LIST)("accepts a complete $product response", (definition) => {
    const result = validateScryContract(definition.product, validEvidenceFor(definition, WALLET));
    expect(result).toEqual({ valid: true, contractsSha256: SCRY_CONTRACTS_SHA256 });
  });

  it("rejects nested type corruption that top-level presence checks miss", () => {
    const definition = SCRY_PRODUCTS.SCRY_WALLET_FORENSICS;
    const evidence = validEvidenceFor(definition, WALLET);
    evidence.coverage = "not-an-object";

    const result = validateScryContract(definition.product, evidence);

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("Expected schema rejection");
    expect(result.errors).toContain("/coverage failed type");
  });

  it("enforces the evidence-only decision posture", () => {
    const definition = SCRY_PRODUCTS.SCRY_WALLET_FULL_CONTEXT_PRO;
    const evidence = validEvidenceFor(definition, WALLET);
    evidence.agent_decision_support = { posture: "trade_now" };

    const result = validateScryContract(definition.product, evidence);

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("Expected posture rejection");
    expect(result.errors).toContain("/agent_decision_support/posture failed const");
  });

  it("does not accept inherited properties as response evidence", () => {
    const definition = SCRY_PRODUCTS.SCRY_WALLET_LINEAGE;
    const inherited = validEvidenceFor(definition, WALLET);
    const evidence = Object.create(inherited) as Record<string, unknown>;

    const result = validateScryContract(definition.product, evidence);

    expect(result.valid).toBe(false);
  });

  it("bounds validation details returned to the agent", () => {
    const result = validateScryContract("scry_wallet_full_context_pro", {});

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("Expected empty-object rejection");
    expect(result.errors.length).toBeLessThanOrEqual(9);
    expect(result.errors.at(-1)).toMatch(/more errors$/);
  });
});
