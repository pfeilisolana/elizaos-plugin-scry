import type { Content, IAgentRuntime, Memory, State } from "@elizaos/core";
import { describe, expect, it, vi } from "vitest";
import { createScryPlugin, SCRY_BUDGET_PROFILES, SCRY_PRODUCTS } from "./index.js";
import { validEvidenceFor } from "./test-support/contract-samples.js";

const WALLET = "4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk";
const MINT = "DezXAZ8z7PnrnRJjz3eeVQMCG1A2LFjU3vHHxh8Gpump";
const runtime = {} as IAgentRuntime;
const state = {} as State;

function message(text: string) {
  return { content: { text } } as Memory;
}

describe("ElizaOS plugin", () => {
  it("creates seven actions and one static provider without network access", async () => {
    const fetchMock = vi.fn();
    const plugin = createScryPlugin({
      transport: { fetch: fetchMock as unknown as typeof fetch, paymentMode: "quote-only" },
    });

    expect(plugin.actions?.map((action) => action.name)).toEqual(Object.keys(SCRY_PRODUCTS));
    expect(plugin.providers).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();

    const providerResult = await plugin.providers?.[0]?.get(
      runtime,
      message("capabilities"),
      state,
    );
    expect(providerResult).toMatchObject({
      values: {
        scryEvidenceOnly: true,
        scryDefaultPaymentMode: "quote-only",
        scryFullCatalogCeilingUsd: 0.3,
      },
    });
    expect(providerResult?.data?.products).toHaveLength(7);
    expect(providerResult?.data?.budgetProfiles).toEqual(SCRY_BUDGET_PROFILES);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exposes intent routing and explicit budget profiles without favoring expensive actions", async () => {
    const plugin = createScryPlugin();
    const providerResult = await plugin.providers?.[0]?.get(
      runtime,
      message("capabilities"),
      state,
    );
    const products = providerResult?.data?.products as Array<Record<string, unknown>>;

    expect(SCRY_BUDGET_PROFILES.PREFLIGHT).toMatchObject({
      perRequestCeilingUsd: 0.05,
      sessionBudgetUsd: 0.2,
    });
    expect(SCRY_BUDGET_PROFILES.PREFLIGHT.eligibleActions).toHaveLength(4);
    expect(SCRY_BUDGET_PROFILES.FULL_CATALOG).toMatchObject({
      perRequestCeilingUsd: 0.3,
      sessionBudgetUsd: 0.6,
    });
    expect(SCRY_BUDGET_PROFILES.FULL_CATALOG.eligibleActions).toHaveLength(7);

    for (const definition of Object.values(SCRY_PRODUCTS)) {
      const product = products.find((candidate) => candidate.actionName === definition.actionName);
      expect(product).toMatchObject({
        buyerIntent: definition.buyerIntent,
        notFor: definition.notFor,
        lowerCostAlternative: definition.lowerCostAlternative,
        moreCompleteAlternative: definition.moreCompleteAlternative,
      });
      const action = plugin.actions?.find((candidate) => candidate.name === definition.actionName);
      expect(action?.description).toContain(`Catalog price $${definition.priceUsd}`);
      expect(action?.description).toContain(`Use when: ${definition.buyerIntent}`);
      expect(action?.description).toContain(definition.notFor);
    }
  });

  it("validates and executes only messages containing a real Solana address", async () => {
    const fetchMock = vi.fn(async () => new Response("challenge", { status: 402 }));
    const plugin = createScryPlugin({
      transport: { fetch: fetchMock as unknown as typeof fetch, paymentMode: "quote-only" },
    });
    const action = plugin.actions?.[0];
    expect(action).toBeDefined();
    if (!action) throw new Error("Expected the first Scry action");

    expect(await action.validate(runtime, message("not a wallet"), state)).toBe(false);
    expect(await action.validate(runtime, message(`check ${WALLET}`), state)).toBe(true);

    const invalid = await action.handler(runtime, message("not a wallet"), state);
    expect(invalid).toMatchObject({ success: false, values: { scryStatus: "invalid_subject" } });
    expect(fetchMock).not.toHaveBeenCalled();

    const unpaid = await action.handler(runtime, message(`check ${WALLET}`), state);
    expect(unpaid).toMatchObject({
      success: false,
      values: { scryStatus: "payment_required", address: WALLET },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ["SCRY_WALLET_QUICK_FLAG", "quick-flag"],
    ["SCRY_WALLET_FORENSICS", "forensics"],
    ["SCRY_WALLET_LINEAGE", "lineage"],
    ["SCRY_LAUNCH_WINDOW_CLUSTER", "launch-window-cluster"],
    ["SCRY_WALLET_FULL_CONTEXT_PRO", "full-context-pro"],
  ])("wires %s to its own canonical route", async (actionName, pathSuffix) => {
    const fetchMock = vi.fn(async () => new Response("challenge", { status: 402 }));
    const plugin = createScryPlugin({
      transport: { fetch: fetchMock as unknown as typeof fetch, paymentMode: "quote-only" },
    });
    const action = plugin.actions?.find((candidate) => candidate.name === actionName);
    if (!action) throw new Error(`Expected action ${actionName}`);

    await action.handler(runtime, message(`check ${WALLET}`), state);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = (fetchMock.mock.calls[0] ?? []) as unknown as [string | URL | Request];
    expect(String(url)).toBe(`https://scry.solanahub.de/x402/wallet/${WALLET}/${pathSuffix}`);
  });

  it.each([
    [
      "SCRY_PERSISTENT_WALLETS_WEEKLY",
      "get the weekly persistent wallet cohort",
      "https://scry.solanahub.de/x402/solana/persistent-wallets/weekly",
    ],
    [
      "SCRY_PUMPFUN_LAUNCH_DOSSIER",
      `get a launch dossier for ${MINT}`,
      `https://scry.solanahub.de/x402/pumpfun/launch-dossier?mint=${MINT}`,
    ],
  ])("wires %s to its exact non-wallet route", async (actionName, request, expectedUrl) => {
    const fetchMock = vi.fn(async () => new Response("challenge", { status: 402 }));
    const plugin = createScryPlugin({
      transport: { fetch: fetchMock as unknown as typeof fetch, paymentMode: "quote-only" },
    });
    const action = plugin.actions?.find((candidate) => candidate.name === actionName);
    if (!action) throw new Error(`Expected action ${actionName}`);

    expect(await action.validate(runtime, message(request), state)).toBe(true);
    await action.handler(runtime, message(request), state);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = (fetchMock.mock.calls[0] ?? []) as unknown as [string | URL | Request];
    expect(String(url)).toBe(expectedUrl);
  });

  it("returns validated evidence through the action result", async () => {
    const definition = SCRY_PRODUCTS.SCRY_WALLET_QUICK_FLAG;
    const evidence = validEvidenceFor(definition, WALLET);
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(evidence), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const plugin = createScryPlugin({
      transport: { fetch: fetchMock as unknown as typeof fetch, paymentMode: "quote-only" },
    });
    const action = plugin.actions?.[0];
    if (!action) throw new Error("Expected the first Scry action");

    const result = await action.handler(runtime, message(`check ${WALLET}`), state);

    expect(result).toMatchObject({
      success: true,
      values: { scryStatus: "success", address: WALLET },
      data: { product: definition.product, address: WALLET },
    });
  });

  it("delivers exactly one bounded host callback while retaining structured evidence", async () => {
    const definition = SCRY_PRODUCTS.SCRY_WALLET_QUICK_FLAG;
    const evidence = validEvidenceFor(definition, WALLET);
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(evidence), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const callback = vi.fn(async (_content: Content): Promise<Memory[]> => []);
    const plugin = createScryPlugin({
      transport: { fetch: fetchMock as unknown as typeof fetch, paymentMode: "quote-only" },
    });
    const action = plugin.actions?.[0];
    if (!action) throw new Error("Expected the first Scry action");

    const result = await action.handler(
      runtime,
      message(`check ${WALLET}`),
      state,
      undefined,
      callback,
    );

    expect(result).toMatchObject({
      success: true,
      data: { product: definition.product, address: WALLET },
    });
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith({
      text: expect.stringContaining("neutral evidence"),
      actions: [definition.actionName],
      scryStatus: "success",
      scryProduct: definition.product,
    });
    expect(callback.mock.calls[0]?.[0]).not.toHaveProperty("data");
  });

  it("delivers bounded callbacks for invalid input and unpaid challenges", async () => {
    const definition = SCRY_PRODUCTS.SCRY_WALLET_QUICK_FLAG;
    const challenge = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        accepts: [{ network: "solana:mainnet" }, { network: "eip155:8453" }],
      }),
    ).toString("base64");
    const fetchMock = vi.fn(
      async () =>
        new Response("challenge", {
          status: 402,
          headers: { "payment-required": challenge },
        }),
    );
    const plugin = createScryPlugin({
      transport: { fetch: fetchMock as unknown as typeof fetch, paymentMode: "quote-only" },
    });
    const action = plugin.actions?.[0];
    if (!action) throw new Error("Expected the first Scry action");

    const invalidCallback = vi.fn(async (_content: Content): Promise<Memory[]> => []);
    const invalid = await action.handler(
      runtime,
      message("not a wallet"),
      state,
      undefined,
      invalidCallback,
    );

    expect(invalid).toMatchObject({ success: false, values: { scryStatus: "invalid_subject" } });
    expect(invalidCallback).toHaveBeenCalledOnce();
    expect(invalidCallback).toHaveBeenCalledWith({
      text: expect.stringContaining("valid 32-byte Solana wallet address"),
      actions: [definition.actionName],
      scryStatus: "invalid_subject",
    });
    expect(invalidCallback.mock.calls[0]?.[0]).not.toHaveProperty("data");
    expect(fetchMock).not.toHaveBeenCalled();

    const unpaidCallback = vi.fn(async (_content: Content): Promise<Memory[]> => []);
    const unpaid = await action.handler(
      runtime,
      message(`check ${WALLET}`),
      state,
      undefined,
      unpaidCallback,
    );

    expect(unpaid).toMatchObject({
      success: false,
      text: expect.stringContaining("catalog price of $0.001"),
      values: {
        scryStatus: "payment_required",
        scryProduct: definition.product,
        scryCatalogPriceUsd: 0.001,
        scryQuoteNetworks: ["solana:mainnet", "eip155:8453"],
        scryChallengePriceVerified: false,
        scryPaymentAttempted: false,
        scrySettlementConfirmed: false,
        scryPaidTransportSupported: true,
      },
    });
    if (!unpaid) throw new Error("Expected an unpaid action result");
    expect(unpaid.text).toContain("live challenge price was not independently verified");
    expect(unpaid.text).toContain("No payment was attempted and no settlement was confirmed");
    expect(unpaid.text).toContain("host-owned Base signer");
    expect(unpaidCallback).toHaveBeenCalledOnce();
    expect(unpaidCallback).toHaveBeenCalledWith({
      text: expect.stringContaining("catalog price of $0.001"),
      actions: [definition.actionName],
      scryStatus: "payment_required",
      scryProduct: definition.product,
      scryCatalogPriceUsd: 0.001,
      scryQuoteNetworks: ["solana:mainnet", "eip155:8453"],
      scryChallengePriceVerified: false,
      scryPaymentAttempted: false,
      scrySettlementConfirmed: false,
      scryPaidTransportSupported: true,
    });
    expect(unpaidCallback.mock.calls[0]?.[0]).not.toHaveProperty("data");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
