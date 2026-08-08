import { type ClientEvmSigner, ExactEvmScheme } from "@x402/evm";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { isSolanaAddress } from "./address.js";
import { SCRY_ORIGIN, SCRY_PRODUCT_LIST } from "./catalog.js";
import type { ScryFetchTransport, ScryProductDefinition } from "./types.js";

const BASE_MAINNET = "eip155:8453";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USD_MICROS = 1_000_000;
const MAX_PAYMENT_TIMEOUT_SECONDS = 900;
const MAX_HTTP_ATTEMPTS = 2;

export interface ScryBaseX402TransportOptions {
  /** A host-owned signer. This package never accepts or reads private key material. */
  signer: ClientEvmSigner;
  /** Independent Base-USDC ceiling for one x402 authorization. */
  maxPaymentUsd: number;
  /** Optional fetch implementation for hosts with an instrumented network layer. */
  fetch?: typeof globalThis.fetch;
}

function usdMicros(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("maxPaymentUsd must be a finite number greater than zero");
  }
  const micros = Math.round(value * USD_MICROS);
  if (!Number.isSafeInteger(micros) || Math.abs(micros / USD_MICROS - value) > 1e-9) {
    throw new Error("maxPaymentUsd must be representable with at most six decimal places");
  }
  return micros;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalProduct(url: URL): ScryProductDefinition | null {
  return (
    SCRY_PRODUCT_LIST.find((product) => {
      if (product.inputKind === "none") {
        return url.pathname === product.routeTemplate && url.search === "";
      }
      if (product.inputKind === "mint") {
        const mint = url.searchParams.get("mint");
        return (
          url.pathname === product.routeTemplate &&
          typeof mint === "string" &&
          isSolanaAddress(mint) &&
          url.search === `?mint=${mint}` &&
          [...url.searchParams.keys()].length === 1
        );
      }

      const marker = ":address";
      const markerIndex = product.routeTemplate.indexOf(marker);
      if (markerIndex < 0 || url.search !== "") return false;
      const prefix = product.routeTemplate.slice(0, markerIndex);
      const suffix = product.routeTemplate.slice(markerIndex + marker.length);
      if (!url.pathname.startsWith(prefix) || !url.pathname.endsWith(suffix)) return false;
      const address = url.pathname.slice(prefix.length, url.pathname.length - suffix.length);
      return isSolanaAddress(address) && url.pathname === `${prefix}${address}${suffix}`;
    }) ?? null
  );
}

function canonicalScryRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): { request: Request; product: ScryProductDefinition } {
  const incoming = new Request(input, init);
  const url = new URL(incoming.url);
  const product = canonicalProduct(url);

  if (
    incoming.method !== "GET" ||
    incoming.body !== null ||
    incoming.headers.has("payment-signature") ||
    incoming.headers.has("x-payment") ||
    url.origin !== SCRY_ORIGIN ||
    !product
  ) {
    throw new Error("Refusing a non-canonical Scry x402 request");
  }
  return {
    product,
    request: new Request(url, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: incoming.signal,
    }),
  };
}

function requirementMatchesPrice(
  requirement: {
    scheme: string;
    network: string;
    asset: string;
    amount: string;
    maxTimeoutSeconds: number;
  },
  ceilingMicros: number,
  expectedMicros: number,
): boolean {
  if (
    requirement.scheme !== "exact" ||
    requirement.network !== BASE_MAINNET ||
    requirement.asset.toLowerCase() !== BASE_USDC.toLowerCase() ||
    !Number.isSafeInteger(requirement.maxTimeoutSeconds) ||
    requirement.maxTimeoutSeconds <= 0 ||
    requirement.maxTimeoutSeconds > MAX_PAYMENT_TIMEOUT_SECONDS
  ) {
    return false;
  }
  try {
    const amount = BigInt(requirement.amount);
    return amount === BigInt(expectedMicros) && amount <= BigInt(ceilingMicros);
  } catch {
    return false;
  }
}

/**
 * Creates a Base-mainnet x402 transport tied to Scry's canonical product routes.
 * The official x402 v2 client copies PaymentRequired.resource and extensions into
 * PaymentPayload; the hooks below verify both copies before a paid retry is sent.
 */
export function createScryBaseX402Transport(
  options: ScryBaseX402TransportOptions,
): Extract<ScryFetchTransport, { paymentMode: "x402" }> {
  const ceilingMicros = usdMicros(options.maxPaymentUsd);
  if (!/^0x[0-9a-fA-F]{40}$/.test(options.signer.address)) {
    throw new Error("signer.address must be a valid EVM address");
  }
  if (typeof options.signer.signTypedData !== "function") {
    throw new Error("signer.signTypedData must be a function");
  }
  const baseFetch = options.fetch ?? globalThis.fetch;
  if (typeof baseFetch !== "function") throw new Error("fetch must be a function");

  const paidFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const { request, product } = canonicalScryRequest(input, init);
    const expectedUrl = request.url;
    const expectedMicros = usdMicros(product.priceUsd);
    let attempts = 0;

    const guardedFetch = async (
      attemptInput: RequestInfo | URL,
      attemptInit?: RequestInit,
    ): Promise<Response> => {
      const attempt = new Request(attemptInput, attemptInit);
      attempts += 1;
      const paymentSignature = attempt.headers.get("payment-signature");
      const legacyPayment = attempt.headers.get("x-payment");
      const hasPayment = Boolean(paymentSignature || legacyPayment);
      if (
        attempts > MAX_HTTP_ATTEMPTS ||
        attempt.url !== expectedUrl ||
        attempt.method !== "GET" ||
        attempt.body !== null ||
        (attempts === 1 && hasPayment) ||
        (attempts === 2 && !hasPayment)
      ) {
        throw new Error("Refusing an unexpected x402 transport attempt");
      }
      const headers = new Headers({ accept: "application/json" });
      if (paymentSignature) headers.set("payment-signature", paymentSignature);
      if (legacyPayment) headers.set("x-payment", legacyPayment);
      return baseFetch(
        new Request(expectedUrl, {
          method: "GET",
          headers,
          redirect: "error",
          signal: attempt.signal,
        }),
      );
    };

    const client = new x402Client()
      .register(BASE_MAINNET, new ExactEvmScheme(options.signer))
      .registerPolicy((_version, requirements) =>
        requirements.filter((requirement) =>
          requirementMatchesPrice(requirement, ceilingMicros, expectedMicros),
        ),
      )
      .onBeforePaymentCreation(async ({ paymentRequired, selectedRequirements }) => {
        const bazaar = paymentRequired.extensions?.bazaar;
        if (
          paymentRequired.x402Version !== 2 ||
          paymentRequired.resource?.url !== expectedUrl ||
          !isRecord(bazaar) ||
          !requirementMatchesPrice(selectedRequirements, ceilingMicros, expectedMicros)
        ) {
          return { abort: true, reason: "Scry payment challenge failed local policy" };
        }
      })
      .onAfterPaymentCreation(async ({ paymentRequired, paymentPayload, selectedRequirements }) => {
        if (
          !sameJsonValue(paymentPayload.resource, paymentRequired.resource) ||
          !sameJsonValue(paymentPayload.extensions?.bazaar, paymentRequired.extensions?.bazaar) ||
          !sameJsonValue(paymentPayload.accepted, selectedRequirements)
        ) {
          throw new Error("x402 payload did not preserve Scry discovery metadata exactly");
        }
      });

    const wrapped = wrapFetchWithPayment(guardedFetch as typeof globalThis.fetch, client);
    return wrapped(request);
  };

  return {
    fetch: paidFetch as typeof globalThis.fetch,
    paymentMode: "x402",
    enforcedMaxPaymentUsd: options.maxPaymentUsd,
    paymentPayloadResource: "payment-required-resource-exact",
    paymentPriceBinding: "catalog-route-exact",
  };
}
