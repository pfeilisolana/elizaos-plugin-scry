import { describe, expect, it, vi } from "vitest";
import { SCRY_ORIGIN, SCRY_PRODUCT_LIST, SCRY_PRODUCTS } from "./catalog.js";
import { createScryClient } from "./client.js";
import { validEvidenceFor } from "./test-support/contract-samples.js";

const WALLET = "4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk";
const MINT = "DezXAZ8z7PnrnRJjz3eeVQMCG1A2LFjU3vHHxh8Gpump";

function subjectFor(definition: (typeof SCRY_PRODUCT_LIST)[number]) {
  return definition.inputKind === "none"
    ? undefined
    : definition.inputKind === "mint"
      ? MINT
      : WALLET;
}

function expectedUrlFor(definition: (typeof SCRY_PRODUCT_LIST)[number], subject?: string) {
  if (definition.inputKind === "none") return `${SCRY_ORIGIN}${definition.routeTemplate}`;
  if (definition.inputKind === "mint") {
    return `${SCRY_ORIGIN}${definition.routeTemplate}?mint=${subject}`;
  }
  return `${SCRY_ORIGIN}${definition.routeTemplate.replace(":address", subject ?? "")}`;
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function transport(response: Response | (() => Promise<Response>)) {
  const mock = vi.fn(async () => (typeof response === "function" ? response() : response.clone()));
  return { mock, fetch: mock as unknown as typeof fetch };
}

function x402Transport(fetchImpl: typeof fetch, enforcedMaxPaymentUsd: number) {
  return {
    enforcedMaxPaymentUsd,
    fetch: fetchImpl,
    paymentMode: "x402" as const,
    paymentPayloadResource: "payment-required-resource-exact" as const,
  };
}

describe("Scry client", () => {
  it.each(SCRY_PRODUCT_LIST)("validates successful $product responses", async (definition) => {
    const subject = subjectFor(definition);
    const fake = transport(jsonResponse(validEvidenceFor(definition, subject), { status: 200 }));
    const client = createScryClient({
      transport: { fetch: fake.fetch, paymentMode: "quote-only" },
    });

    const result = await client.query(definition, subject);

    expect(result.ok).toBe(true);
    expect(fake.mock).toHaveBeenCalledOnce();
    const [url, init] = (fake.mock.mock.calls[0] ?? []) as unknown as [
      string | URL | Request,
      RequestInit,
    ];
    expect(String(url)).toBe(expectedUrlFor(definition, subject));
    expect(init).toMatchObject({ method: "GET", redirect: "error" });
  });

  it("treats a 402 as an unpaid quote, sanitizes it, and never retries", async () => {
    const challenge = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        accepts: [
          { network: "solana:mainnet", payTo: "sensitive-recipient" },
          { network: "eip155:8453", payTo: "another-recipient" },
        ],
      }),
    ).toString("base64");
    const fake = transport(
      new Response("payment required", {
        status: 402,
        headers: { "payment-required": challenge },
      }),
    );
    const client = createScryClient({
      transport: { fetch: fake.fetch, paymentMode: "quote-only" },
    });

    const result = await client.query(SCRY_PRODUCTS.SCRY_WALLET_FORENSICS, WALLET);

    expect(result).toMatchObject({
      ok: false,
      status: "payment_required",
      quote: {
        x402Version: 2,
        networks: ["solana:mainnet", "eip155:8453"],
        catalogPriceUsd: 0.05,
        challengePriceVerified: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain("sensitive-recipient");
    expect(JSON.stringify(result)).not.toContain("another-recipient");
    expect(fake.mock).toHaveBeenCalledOnce();
  });

  it.each([
    [undefined, {}],
    ["not-base64-json", {}],
    [Buffer.from("[]").toString("base64"), {}],
    [
      Buffer.from(
        JSON.stringify({
          x402Version: "2",
          accepts: [null, { network: 123 }, { network: "solana:mainnet" }],
        }),
      ).toString("base64"),
      { networks: ["solana:mainnet"] },
    ],
  ])("fails closed on incomplete or malformed payment metadata", async (header, quote) => {
    const headers = new Headers();
    if (header) headers.set("payment-required", header);
    const fake = transport(new Response("challenge", { status: 402, headers }));
    const result = await createScryClient({
      transport: { fetch: fake.fetch, paymentMode: "quote-only" },
    }).query(SCRY_PRODUCTS.SCRY_WALLET_FORENSICS, WALLET);

    expect(result).toMatchObject({
      ok: false,
      status: "payment_required",
      quote: {
        catalogPriceUsd: 0.05,
        challengePriceVerified: false,
        networks: [],
        ...quote,
      },
    });
  });

  it("bounds payment metadata before decoding and limits sanitized networks", async () => {
    const oversized = "A".repeat(64 * 1024 + 1);
    const oversizedResult = await createScryClient({
      transport: {
        fetch: transport(
          new Response("challenge", {
            status: 402,
            headers: { "payment-required": oversized },
          }),
        ).fetch,
        paymentMode: "quote-only",
      },
    }).query(SCRY_PRODUCTS.SCRY_WALLET_FORENSICS, WALLET);
    expect(oversizedResult).toMatchObject({
      ok: false,
      quote: { networks: [], challengePriceVerified: false },
    });

    const challenge = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        accepts: Array.from({ length: 12 }, (_, index) => ({ network: `test:${index}` })),
      }),
    ).toString("base64");
    const boundedResult = await createScryClient({
      transport: {
        fetch: transport(
          new Response("challenge", {
            status: 402,
            headers: { "payment-required": challenge },
          }),
        ).fetch,
        paymentMode: "quote-only",
      },
    }).query(SCRY_PRODUCTS.SCRY_WALLET_FORENSICS, WALLET);
    expect(boundedResult).toMatchObject({ ok: false, quote: { x402Version: 2 } });
    if (boundedResult.ok || boundedResult.status !== "payment_required") {
      throw new Error("Expected a bounded payment quote");
    }
    expect(boundedResult.quote.networks).toHaveLength(8);
  });

  it("requires an explicit positive ceiling for x402 mode", () => {
    const fake = transport(jsonResponse({}));
    expect(() =>
      createScryClient({
        transport: x402Transport(fake.fetch, 0.05),
      }),
    ).toThrow("maxPaymentUsd");
    expect(() =>
      createScryClient({
        transport: x402Transport(fake.fetch, 0.1),
        maxPaymentUsd: 0.05,
        sessionBudgetUsd: 0.1,
      }),
    ).toThrow("must equal");
    expect(() =>
      createScryClient({
        transport: x402Transport(fake.fetch, 0.05),
        maxPaymentUsd: 0.05,
      }),
    ).toThrow("sessionBudgetUsd");
    expect(() =>
      createScryClient({
        transport: x402Transport(fake.fetch, 0.05),
        maxPaymentUsd: 0.05,
        sessionBudgetUsd: 0.03,
      }),
    ).toThrow("greater than or equal");
  });

  it("rejects an x402 transport without exact discovery resource binding", () => {
    const fake = transport(jsonResponse({}));
    expect(() =>
      createScryClient({
        transport: {
          fetch: fake.fetch,
          paymentMode: "x402",
          enforcedMaxPaymentUsd: 0.05,
        } as never,
        maxPaymentUsd: 0.05,
        sessionBudgetUsd: 0.05,
      }),
    ).toThrow("PaymentRequired.resource to PaymentPayload.resource");
    expect(fake.mock).not.toHaveBeenCalled();
  });

  it("blocks an over-budget product before invoking an x402 transport", async () => {
    const fake = transport(jsonResponse({}));
    const client = createScryClient({
      transport: x402Transport(fake.fetch, 0.05),
      maxPaymentUsd: 0.05,
      sessionBudgetUsd: 0.05,
    });

    const result = await client.query(SCRY_PRODUCTS.SCRY_WALLET_FULL_CONTEXT_PRO, WALLET);

    expect(result).toMatchObject({ ok: false, status: "budget_exceeded" });
    expect(fake.mock).not.toHaveBeenCalled();
  });

  it("permits one paid-transport call when both ceilings match the product", async () => {
    const definition = SCRY_PRODUCTS.SCRY_WALLET_FORENSICS;
    const fake = transport(jsonResponse(validEvidenceFor(definition, WALLET)));
    const client = createScryClient({
      transport: x402Transport(fake.fetch, 0.05),
      maxPaymentUsd: 0.05,
      sessionBudgetUsd: 0.05,
    });

    const result = await client.query(definition, WALLET);

    expect(result.ok).toBe(true);
    expect(fake.mock).toHaveBeenCalledOnce();
    expect(client.getBudgetState()).toEqual({
      paymentMode: "x402",
      perRequestCeilingUsd: 0.05,
      sessionBudgetUsd: 0.05,
      reservedPaymentUsd: 0.05,
      remainingBudgetUsd: 0,
    });
  });

  it("accounts for sub-cent quick-flag calls without rounding the budget", async () => {
    const definition = SCRY_PRODUCTS.SCRY_WALLET_QUICK_FLAG;
    const fake = transport(jsonResponse(validEvidenceFor(definition, WALLET)));
    const client = createScryClient({
      transport: x402Transport(fake.fetch, 0.001),
      maxPaymentUsd: 0.001,
      sessionBudgetUsd: 0.002,
    });

    expect((await client.query(definition, WALLET)).ok).toBe(true);
    expect((await client.query(definition, WALLET)).ok).toBe(true);
    expect(await client.query(definition, WALLET)).toMatchObject({
      ok: false,
      status: "budget_exceeded",
    });
    expect(fake.mock).toHaveBeenCalledTimes(2);
    expect(client.getBudgetState()).toMatchObject({
      reservedPaymentUsd: 0.002,
      remainingBudgetUsd: 0,
    });
  });

  it("reserves the cumulative session budget before concurrent paid transport calls", async () => {
    let release: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      async () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const client = createScryClient({
      transport: {
        fetch: fetchMock as unknown as typeof fetch,
        paymentMode: "x402",
        enforcedMaxPaymentUsd: 0.05,
        paymentPayloadResource: "payment-required-resource-exact",
      },
      maxPaymentUsd: 0.05,
      sessionBudgetUsd: 0.05,
    });

    const first = client.query(SCRY_PRODUCTS.SCRY_WALLET_FORENSICS, WALLET);
    const second = await client.query(SCRY_PRODUCTS.SCRY_WALLET_FORENSICS, WALLET);

    expect(second).toMatchObject({ ok: false, status: "budget_exceeded" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(client.getBudgetState().remainingBudgetUsd).toBe(0);
    if (!release) throw new Error("Expected the first paid transport call to be pending");
    release(new Response("challenge", { status: 402 }));
    await expect(first).resolves.toMatchObject({ ok: false, status: "payment_required" });
  });

  it("retains a reservation after an ambiguous paid transport failure", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("payment outcome unknown");
    });
    const client = createScryClient({
      transport: {
        fetch: fetchMock as unknown as typeof fetch,
        paymentMode: "x402",
        enforcedMaxPaymentUsd: 0.05,
        paymentPayloadResource: "payment-required-resource-exact",
      },
      maxPaymentUsd: 0.05,
      sessionBudgetUsd: 0.05,
    });

    const first = await client.query(SCRY_PRODUCTS.SCRY_WALLET_FORENSICS, WALLET);
    const second = await client.query(SCRY_PRODUCTS.SCRY_WALLET_FORENSICS, WALLET);

    expect(first).toMatchObject({ ok: false, status: "transport_error" });
    expect(second).toMatchObject({ ok: false, status: "budget_exceeded" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ["wrong product", { product: "wrong" }, "product does not match"],
    ["wrong address", { address: "1".repeat(32) }, "address does not match"],
  ])("rejects a %s response", async (_name, overrides, message) => {
    const definition = SCRY_PRODUCTS.SCRY_WALLET_FORENSICS;
    const fake = transport(jsonResponse({ ...validEvidenceFor(definition, WALLET), ...overrides }));
    const client = createScryClient({
      transport: { fetch: fake.fetch, paymentMode: "quote-only" },
    });

    const result = await client.query(definition, WALLET);

    expect(result).toMatchObject({ ok: false, status: "invalid_response" });
    expect(result.ok ? "" : result.message).toContain(message);
  });

  it("rejects missing contract fields", async () => {
    const definition = SCRY_PRODUCTS.SCRY_WALLET_LINEAGE;
    const incomplete = validEvidenceFor(definition, WALLET);
    delete incomplete.methodology;
    const fake = transport(jsonResponse(incomplete));
    const client = createScryClient({
      transport: { fetch: fake.fetch, paymentMode: "quote-only" },
    });

    const result = await client.query(definition, WALLET);

    expect(result).toMatchObject({ ok: false, status: "invalid_response" });
    expect(result.ok ? "" : result.message).toContain("methodology");
  });

  it.each([
    [
      new Response("not json", { status: 200, headers: { "content-type": "text/plain" } }),
      "not JSON",
    ],
    [
      new Response("{", { status: 200, headers: { "content-type": "application/json" } }),
      "malformed JSON",
    ],
    [jsonResponse([], { status: 200 }), "JSON object"],
  ])("rejects malformed success responses", async (response, message) => {
    const fake = transport(response);
    const client = createScryClient({
      transport: { fetch: fake.fetch, paymentMode: "quote-only" },
    });

    const result = await client.query(SCRY_PRODUCTS.SCRY_WALLET_FORENSICS, WALLET);

    expect(result).toMatchObject({ ok: false, status: "invalid_response" });
    expect(result.ok ? "" : result.message).toContain(message);
  });

  it("enforces response size limits using actual bytes", async () => {
    const fake = transport(jsonResponse({ payload: "x".repeat(500) }));
    const client = createScryClient({
      transport: { fetch: fake.fetch, paymentMode: "quote-only" },
      maxResponseBytes: 100,
    });

    const result = await client.query(SCRY_PRODUCTS.SCRY_WALLET_FORENSICS, WALLET);

    expect(result).toMatchObject({ ok: false, status: "invalid_response" });
    expect(result.ok ? "" : result.message).toContain("size limit");
  });

  it("stops a chunked body as soon as the decoded byte limit is crossed", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(60));
        controller.enqueue(new Uint8Array(60));
        controller.enqueue(new Uint8Array(60));
      },
      cancel() {
        cancelled = true;
        throw new Error("cancellation failure is intentionally ignored");
      },
    });
    const fake = transport(
      async () => new Response(stream, { headers: { "content-type": "application/json" } }),
    );
    const result = await createScryClient({
      transport: { fetch: fake.fetch, paymentMode: "quote-only" },
      maxResponseBytes: 100,
    }).query(SCRY_PRODUCTS.SCRY_WALLET_FORENSICS, WALLET);

    expect(result).toMatchObject({ ok: false, status: "invalid_response" });
    expect(result.ok ? "" : result.message).toContain("size limit");
    expect(cancelled).toBe(true);
  });

  it("keeps the deadline active while reading a stalled response body", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => undefined),
      cancel() {
        cancelled = true;
      },
    });
    const fake = transport(
      async () => new Response(stream, { headers: { "content-type": "application/json" } }),
    );
    const result = await createScryClient({
      transport: { fetch: fake.fetch, paymentMode: "quote-only" },
      timeoutMs: 5,
    }).query(SCRY_PRODUCTS.SCRY_WALLET_FORENSICS, WALLET);

    expect(result).toMatchObject({
      ok: false,
      status: "transport_error",
      message: "Scry request timed out",
    });
    expect(cancelled).toBe(true);
  });

  it("rejects invalid UTF-8 before JSON parsing", async () => {
    const fake = transport(
      new Response(new Uint8Array([0xc3, 0x28]), {
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await createScryClient({
      transport: { fetch: fake.fetch, paymentMode: "quote-only" },
    }).query(SCRY_PRODUCTS.SCRY_WALLET_FORENSICS, WALLET);

    expect(result).toMatchObject({
      ok: false,
      status: "invalid_response",
      message: "Scry response is not valid UTF-8",
    });
  });

  it("rejects a response whose declared content length exceeds the limit", async () => {
    const fake = transport(
      new Response("{}", {
        headers: { "content-type": "application/json", "content-length": "500" },
      }),
    );
    const result = await createScryClient({
      transport: { fetch: fake.fetch, paymentMode: "quote-only" },
      maxResponseBytes: 100,
    }).query(SCRY_PRODUCTS.SCRY_WALLET_FORENSICS, WALLET);

    expect(result).toMatchObject({ ok: false, status: "invalid_response" });
  });

  it("rejects malformed Content-Length metadata", async () => {
    const fake = transport(
      new Response("{}", {
        headers: { "content-type": "application/json", "content-length": "not-a-number" },
      }),
    );
    const result = await createScryClient({
      transport: { fetch: fake.fetch, paymentMode: "quote-only" },
    }).query(SCRY_PRODUCTS.SCRY_WALLET_FORENSICS, WALLET);

    expect(result).toMatchObject({
      ok: false,
      status: "invalid_response",
      message: "Scry response has an invalid Content-Length",
    });
  });

  it("refuses an invalid address before transport", async () => {
    const fake = transport(jsonResponse({}));
    const client = createScryClient({
      transport: { fetch: fake.fetch, paymentMode: "quote-only" },
    });

    await expect(client.query(SCRY_PRODUCTS.SCRY_WALLET_FORENSICS, "not-a-wallet")).rejects.toThrow(
      "Invalid Solana wallet address",
    );
    expect(fake.mock).not.toHaveBeenCalled();
  });

  it("returns bounded HTTP and transport failures without response bodies", async () => {
    const http = transport(new Response("internal details", { status: 503 }));
    const httpResult = await createScryClient({
      transport: { fetch: http.fetch, paymentMode: "quote-only" },
    }).query(SCRY_PRODUCTS.SCRY_WALLET_FORENSICS, WALLET);
    expect(httpResult).toMatchObject({
      ok: false,
      status: "http_error",
      message: "Scry returned HTTP 503",
    });
    expect(JSON.stringify(httpResult)).not.toContain("internal details");

    const failure = transport(async () => {
      throw new Error("secret payment wrapper details");
    });
    const transportResult = await createScryClient({
      transport: { fetch: failure.fetch, paymentMode: "quote-only" },
    }).query(SCRY_PRODUCTS.SCRY_WALLET_FORENSICS, WALLET);
    expect(transportResult).toMatchObject({
      ok: false,
      status: "transport_error",
      message: "Scry transport failed",
    });
    expect(JSON.stringify(transportResult)).not.toContain("secret payment wrapper details");
  });

  it("does not expose arbitrary body-stream errors", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("secret upstream body detail"));
      },
    });
    const fake = transport(
      async () => new Response(stream, { headers: { "content-type": "application/json" } }),
    );
    const result = await createScryClient({
      transport: { fetch: fake.fetch, paymentMode: "quote-only" },
    }).query(SCRY_PRODUCTS.SCRY_WALLET_FORENSICS, WALLET);

    expect(result).toMatchObject({
      ok: false,
      status: "invalid_response",
      message: "Scry response could not be read safely",
    });
    expect(JSON.stringify(result)).not.toContain("secret upstream body detail");
  });

  it("requires exactly HTTP 200 for a successful GET contract", async () => {
    const definition = SCRY_PRODUCTS.SCRY_WALLET_FORENSICS;
    const fake = transport(jsonResponse(validEvidenceFor(definition, WALLET), { status: 201 }));
    const result = await createScryClient({
      transport: { fetch: fake.fetch, paymentMode: "quote-only" },
    }).query(definition, WALLET);

    expect(result).toMatchObject({
      ok: false,
      status: "http_error",
      message: "Scry returned HTTP 201",
    });
  });

  it("aborts a transport that exceeds the configured timeout", async () => {
    const mock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    const client = createScryClient({
      transport: { fetch: mock as unknown as typeof fetch, paymentMode: "quote-only" },
      timeoutMs: 5,
    });

    const result = await client.query(SCRY_PRODUCTS.SCRY_WALLET_FORENSICS, WALLET);

    expect(result).toMatchObject({ ok: false, status: "transport_error" });
    expect(mock).toHaveBeenCalledOnce();
  });

  it("rejects invalid local safety limits", () => {
    expect(() => createScryClient({ timeoutMs: 0 })).toThrow("timeoutMs");
    expect(() => createScryClient({ timeoutMs: 120_001 })).toThrow("timeoutMs");
    expect(() => createScryClient({ timeoutMs: 1.5 })).toThrow("timeoutMs");
    expect(() => createScryClient({ maxResponseBytes: Number.POSITIVE_INFINITY })).toThrow(
      "maxResponseBytes",
    );
    expect(() => createScryClient({ maxResponseBytes: 4 * 1024 * 1024 + 1 })).toThrow(
      "maxResponseBytes",
    );
    expect(() => createScryClient({ maxPaymentUsd: -1 })).toThrow("maxPaymentUsd");
    expect(() => createScryClient({ sessionBudgetUsd: 0.05 })).toThrow("only valid in x402 mode");
  });
});
