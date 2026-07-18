import { describe, expect, it, vi } from "vitest";
import { createScryBaseX402Transport } from "./base-x402-transport.js";

const WALLET = "4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk";
const URL = `https://scry.solanahub.de/x402/wallet/${WALLET}/quick-flag`;
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAY_TO = "0xF4A904d8326786d90157cf791C281302F11b2036";
const SIGNER_ADDRESS = "0x1111111111111111111111111111111111111111";

function signer() {
  const signTypedData = vi.fn(async () => `0x${"11".repeat(65)}` as `0x${string}`);
  return { address: SIGNER_ADDRESS as `0x${string}`, signTypedData };
}

function paymentRequired(
  overrides: { amount?: string; resourceUrl?: string; withBazaar?: boolean } = {},
) {
  return {
    x402Version: 2,
    resource: {
      url: overrides.resourceUrl ?? URL,
      description: "Scry quick flag",
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
        amount: overrides.amount ?? "1000",
        asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        payTo: "CTKigV78yuErumvqm7Qor8j1hMK2oxNxdhwpVrAKV85d",
        maxTimeoutSeconds: 900,
        extra: { feePayer: "D6ZhtNQ5nT9ZnTHUbqXZsTx5MH2rPFiBBggX4hY1WePM" },
      },
      {
        scheme: "exact",
        network: "eip155:8453",
        amount: overrides.amount ?? "1000",
        asset: BASE_USDC,
        payTo: PAY_TO,
        maxTimeoutSeconds: 900,
        extra: { name: "USD Coin", version: "2" },
      },
    ],
    ...(overrides.withBazaar === false
      ? {}
      : { extensions: { bazaar: { info: { provider: "Scry" } } } }),
  };
}

function challenge(required: ReturnType<typeof paymentRequired>): Response {
  return new Response("payment required", {
    status: 402,
    headers: {
      "payment-required": Buffer.from(JSON.stringify(required)).toString("base64"),
    },
  });
}

function decodePayload(value: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as Record<string, unknown>;
}

describe("Scry Base x402 transport", () => {
  it("selects Base V2 and preserves resource plus Bazaar metadata", async () => {
    const wallet = signer();
    const required = paymentRequired();
    let payload: Record<string, unknown> | undefined;
    const network = vi.fn(async (input: RequestInfo | URL) => {
      const request = new Request(input);
      const signature = request.headers.get("payment-signature");
      if (!signature) return challenge(required);
      payload = decodePayload(signature);
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const transport = createScryBaseX402Transport({
      signer: wallet,
      maxPaymentUsd: 0.001,
      fetch: network as unknown as typeof fetch,
    });

    const response = await transport.fetch(URL, { method: "GET" });

    expect(response.status).toBe(200);
    expect(network).toHaveBeenCalledTimes(2);
    expect(wallet.signTypedData).toHaveBeenCalledOnce();
    expect(payload).toMatchObject({
      x402Version: 2,
      resource: required.resource,
      extensions: required.extensions,
      accepted: {
        scheme: "exact",
        network: "eip155:8453",
        amount: "1000",
        asset: BASE_USDC,
      },
    });
    expect(transport).toMatchObject({
      paymentMode: "x402",
      enforcedMaxPaymentUsd: 0.001,
      paymentPayloadResource: "payment-required-resource-exact",
    });
  });

  it("rejects a challenge above the independent ceiling before signing", async () => {
    const wallet = signer();
    const network = vi.fn(async () => challenge(paymentRequired({ amount: "50001" })));
    const transport = createScryBaseX402Transport({
      signer: wallet,
      maxPaymentUsd: 0.05,
      fetch: network as unknown as typeof fetch,
    });

    await expect(transport.fetch(URL)).rejects.toThrow("filtered out by policies");
    expect(network).toHaveBeenCalledOnce();
    expect(wallet.signTypedData).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong resource", paymentRequired({ resourceUrl: `${URL}/wrong` })],
    ["missing Bazaar declaration", paymentRequired({ withBazaar: false })],
  ])("rejects %s before signing", async (_name, required) => {
    const wallet = signer();
    const network = vi.fn(async () => challenge(required));
    const transport = createScryBaseX402Transport({
      signer: wallet,
      maxPaymentUsd: 0.001,
      fetch: network as unknown as typeof fetch,
    });

    await expect(transport.fetch(URL)).rejects.toThrow(
      "Scry payment challenge failed local policy",
    );
    expect(network).toHaveBeenCalledOnce();
    expect(wallet.signTypedData).not.toHaveBeenCalled();
  });

  it("allows no third HTTP attempt when a paid retry remains 402", async () => {
    const wallet = signer();
    const required = paymentRequired();
    const network = vi.fn(async () => challenge(required));
    const transport = createScryBaseX402Transport({
      signer: wallet,
      maxPaymentUsd: 0.001,
      fetch: network as unknown as typeof fetch,
    });

    const response = await transport.fetch(URL);

    expect(response.status).toBe(402);
    expect(network).toHaveBeenCalledTimes(2);
    expect(wallet.signTypedData).toHaveBeenCalledOnce();
  });

  it.each([
    "https://scry.solanahub.de/x402/solana/persistent-wallets/weekly",
    "https://scry.solanahub.de/x402/pumpfun/launch-dossier?mint=DezXAZ8z7PnrnRJjz3eeVQMCG1A2LFjU3vHHxh8Gpump",
  ])("accepts the canonical product route %s", async (url) => {
    const network = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const transport = createScryBaseX402Transport({
      signer: signer(),
      maxPaymentUsd: 0.3,
      fetch: network as unknown as typeof fetch,
    });

    const response = await transport.fetch(url);

    expect(response.status).toBe(200);
    expect(network).toHaveBeenCalledOnce();
  });

  it.each([
    ["external origin", "https://example.com/x402/wallet/test/quick-flag", {}],
    ["non-canonical suffix", `${URL}-copy`, {}],
    [
      "unexpected cohort query",
      "https://scry.solanahub.de/x402/solana/persistent-wallets/weekly?limit=1",
      {},
    ],
    ["missing mint", "https://scry.solanahub.de/x402/pumpfun/launch-dossier", {}],
    [
      "extra mint query",
      "https://scry.solanahub.de/x402/pumpfun/launch-dossier?mint=DezXAZ8z7PnrnRJjz3eeVQMCG1A2LFjU3vHHxh8Gpump&limit=1",
      {},
    ],
    [
      "non-canonical mint encoding",
      "https://scry.solanahub.de/x402/pumpfun/launch-dossier?mint=%44ezXAZ8z7PnrnRJjz3eeVQMCG1A2LFjU3vHHxh8Gpump",
      {},
    ],
    ["POST request", URL, { method: "POST" }],
    ["prepaid request", URL, { headers: { "payment-signature": "forbidden" } }],
  ])("rejects a %s without touching the network", async (_name, url, init) => {
    const network = vi.fn(async () => new Response());
    const transport = createScryBaseX402Transport({
      signer: signer(),
      maxPaymentUsd: 0.001,
      fetch: network as unknown as typeof fetch,
    });

    await expect(transport.fetch(url, init)).rejects.toThrow("non-canonical");
    expect(network).not.toHaveBeenCalled();
  });

  it("validates construction inputs", () => {
    expect(() => createScryBaseX402Transport({ signer: signer(), maxPaymentUsd: 0 })).toThrow(
      "greater than zero",
    );
    expect(() =>
      createScryBaseX402Transport({ signer: signer(), maxPaymentUsd: 0.0000001 }),
    ).toThrow("six decimal places");
    expect(() =>
      createScryBaseX402Transport({
        signer: { ...signer(), address: "0xinvalid" as `0x${string}` },
        maxPaymentUsd: 0.001,
      }),
    ).toThrow("valid EVM address");
  });
});
