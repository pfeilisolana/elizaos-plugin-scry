import { describe, expect, it } from "vitest";
import { SCRY_PRODUCT_LIST, SCRY_PRODUCTS } from "./catalog.js";
import { SCRY_CONTRACTS_SHA256, validateScryContract } from "./contracts.js";
import { validEvidenceFor } from "./test-support/contract-samples.js";

const WALLET = "4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk";

describe("pinned Scry response contracts", () => {
  it("binds runtime validation to the deterministic manifest snapshot", () => {
    expect(SCRY_CONTRACTS_SHA256).toBe(
      "8fae66408cdfde9d15903dc80730dee09cb1506dbca7ed9151c4551cc000e904",
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

  it("accepts explicit bounded holdings without promoting the lower bound to an exact count", () => {
    const definition = SCRY_PRODUCTS.SCRY_WALLET_FORENSICS;
    const evidence = validEvidenceFor(definition, WALLET);
    evidence.holdings_snapshot = {
      snapshot_completeness: "bounded_lower_bound",
      token_count: null,
      token_count_lower_bound: 12_000,
      token_count_is_lower_bound: true,
      tokens: [],
      tokens_truncated: true,
    };

    expect(validateScryContract(definition.product, evidence)).toEqual({
      valid: true,
      contractsSha256: SCRY_CONTRACTS_SHA256,
    });
  });

  it("rejects contradictory exact and lower-bound holdings semantics", () => {
    const definition = SCRY_PRODUCTS.SCRY_WALLET_FORENSICS;
    const evidence = validEvidenceFor(definition, WALLET);
    evidence.holdings_snapshot = {
      snapshot_completeness: "bounded_lower_bound",
      token_count: 12_000,
      token_count_lower_bound: 12_000,
      token_count_is_lower_bound: false,
      tokens: [{ mint: "must-not-pass-as-complete" }],
      tokens_truncated: false,
    };

    const result = validateScryContract(definition.product, evidence);

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("Expected bounded-semantics rejection");
    expect(result.errors).toContain(
      "/holdings_snapshot/token_count must be null for bounded snapshots",
    );
    expect(result.errors).toContain(
      "/holdings_snapshot/token_count_is_lower_bound must be true for bounded snapshots",
    );
    expect(result.errors).toContain(
      "/holdings_snapshot/tokens must be empty for bounded snapshots",
    );
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
