import { isSolanaAddress } from "./address.js";
import { SCRY_ORIGIN } from "./catalog.js";
import { validateScryContract } from "./contracts.js";
import type {
  ScryBudgetState,
  ScryPluginOptions,
  ScryProductDefinition,
  ScryQueryResult,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TIMEOUT_MS = 120_000;
const HARD_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_PAYMENT_REQUIRED_HEADER_CHARS = 64 * 1024;
const MAX_QUOTE_NETWORKS = 8;
const MAX_NETWORK_IDENTIFIER_CHARS = 128;
const USD_MICROS = 1_000_000;

class ScryResponseError extends Error {}

interface ResolvedOptions {
  fetch: typeof fetch;
  paymentMode: "quote-only" | "x402";
  maxPaymentUsd: number;
  maxPaymentMicros: number;
  sessionBudgetUsd: number;
  sessionBudgetMicros: number;
  timeoutMs: number;
  maxResponseBytes: number;
}

function finitePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite number greater than zero`);
  }
  return value;
}

function boundedPositiveInteger(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${name} must be a positive integer no greater than ${maximum}`);
  }
  return value;
}

function usdMicros(value: number, name: string): number {
  finitePositive(value, name);
  const micros = Math.round(value * USD_MICROS);
  if (!Number.isSafeInteger(micros) || Math.abs(micros / USD_MICROS - value) > 1e-9) {
    throw new Error(`${name} must be representable with at most six decimal places`);
  }
  return micros;
}

function formatUsd(value: number): string {
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function resolveOptions(options: ScryPluginOptions): ResolvedOptions {
  const paymentMode = options.transport?.paymentMode ?? "quote-only";
  const maxPaymentUsd = options.maxPaymentUsd ?? 0;
  const sessionBudgetUsd = options.sessionBudgetUsd ?? 0;
  let maxPaymentMicros = 0;
  let sessionBudgetMicros = 0;

  if (paymentMode === "x402") {
    if (
      options.transport?.paymentMode !== "x402" ||
      options.transport.paymentPayloadResource !== "payment-required-resource-exact"
    ) {
      throw new Error(
        "x402 transport must attest exact PaymentRequired.resource to PaymentPayload.resource binding",
      );
    }
    maxPaymentMicros = usdMicros(maxPaymentUsd, "maxPaymentUsd");
    const transportCeiling = finitePositive(
      options.transport?.paymentMode === "x402"
        ? options.transport.enforcedMaxPaymentUsd
        : Number.NaN,
      "transport.enforcedMaxPaymentUsd",
    );
    if (transportCeiling !== maxPaymentUsd) {
      throw new Error("maxPaymentUsd must equal transport.enforcedMaxPaymentUsd in x402 mode");
    }
    sessionBudgetMicros = usdMicros(sessionBudgetUsd, "sessionBudgetUsd");
    if (sessionBudgetMicros < maxPaymentMicros) {
      throw new Error("sessionBudgetUsd must be greater than or equal to maxPaymentUsd");
    }
  } else if (maxPaymentUsd < 0 || !Number.isFinite(maxPaymentUsd)) {
    throw new Error("maxPaymentUsd cannot be negative or non-finite");
  } else if (sessionBudgetUsd !== 0) {
    throw new Error("sessionBudgetUsd is only valid in x402 mode");
  }

  return {
    fetch: options.transport?.fetch ?? globalThis.fetch,
    paymentMode,
    maxPaymentUsd,
    maxPaymentMicros,
    sessionBudgetUsd,
    sessionBudgetMicros,
    timeoutMs: boundedPositiveInteger(
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      "timeoutMs",
      MAX_TIMEOUT_MS,
    ),
    maxResponseBytes: boundedPositiveInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      "maxResponseBytes",
      HARD_MAX_RESPONSE_BYTES,
    ),
  };
}

function buildUrl(definition: ScryProductDefinition, subject?: string): URL {
  if (definition.inputKind === "none") {
    if (subject !== undefined) throw new Error("This Scry product does not accept a subject");
    const url = new URL(definition.routeTemplate, SCRY_ORIGIN);
    if (url.origin !== SCRY_ORIGIN || url.pathname !== definition.routeTemplate || url.search) {
      throw new Error("Refusing a non-canonical Scry route");
    }
    return url;
  }

  if (!subject || !isSolanaAddress(subject)) {
    throw new Error(
      `Invalid Solana ${definition.inputKind === "mint" ? "token mint" : "wallet address"}`,
    );
  }

  if (definition.inputKind === "wallet") {
    const path = definition.routeTemplate.replace(":address", subject);
    if (path === definition.routeTemplate) throw new Error("Wallet route is missing :address");
    const url = new URL(path, SCRY_ORIGIN);
    if (url.origin !== SCRY_ORIGIN || url.pathname !== path || url.search) {
      throw new Error("Refusing a non-canonical Scry wallet route");
    }
    return url;
  }

  const url = new URL(definition.routeTemplate, SCRY_ORIGIN);
  url.searchParams.set("mint", subject);
  if (
    url.origin !== SCRY_ORIGIN ||
    url.pathname !== definition.routeTemplate ||
    url.searchParams.get("mint") !== subject ||
    [...url.searchParams.keys()].length !== 1
  ) {
    throw new Error("Refusing a non-canonical Scry mint route");
  }
  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePaymentQuote(response: Response, catalogPriceUsd: number) {
  const encoded = response.headers.get("payment-required");
  const fallback = { networks: [], catalogPriceUsd, challengePriceVerified: false as const };
  if (!encoded || encoded.length > MAX_PAYMENT_REQUIRED_HEADER_CHARS) return fallback;

  try {
    const decoded: unknown = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    if (!isRecord(decoded)) return fallback;
    const accepts = Array.isArray(decoded.accepts) ? decoded.accepts : [];
    const networks: string[] = [];
    for (const entry of accepts) {
      if (networks.length >= MAX_QUOTE_NETWORKS) break;
      const network = isRecord(entry) ? entry.network : undefined;
      if (
        typeof network === "string" &&
        network.length > 0 &&
        network.length <= MAX_NETWORK_IDENTIFIER_CHARS &&
        /^[\x21-\x7e]+$/.test(network) &&
        !networks.includes(network)
      ) {
        networks.push(network);
      }
    }
    const version = decoded.x402Version;
    return {
      ...(typeof version === "number" && Number.isSafeInteger(version) && version > 0
        ? { x402Version: version }
        : {}),
      networks,
      catalogPriceUsd,
      challengePriceVerified: false as const,
    };
  } catch {
    return fallback;
  }
}

function responseError(message: string): ScryResponseError {
  return new ScryResponseError(message);
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) throw responseError("Scry response timed out");

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      void reader.cancel().catch(() => undefined);
      reject(responseError("Scry response timed out"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    reader
      .read()
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function readBodyWithLimit(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await readChunk(reader, signal);
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw responseError("Scry response exceeds the configured size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function readJsonObject(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw responseError("Scry response is not JSON");
  }

  const rawLength = response.headers.get("content-length");
  if (rawLength !== null) {
    const declaredLength = Number(rawLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      throw responseError("Scry response has an invalid Content-Length");
    }
    if (declaredLength > maxBytes) {
      throw responseError("Scry response exceeds the configured size limit");
    }
  }

  const bytes = await readBodyWithLimit(response, maxBytes, signal);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw responseError("Scry response is not valid UTF-8");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw responseError("Scry returned malformed JSON");
  }
  if (!isRecord(parsed)) throw responseError("Scry response must be a JSON object");
  return parsed;
}

function validateEvidence(
  evidence: Record<string, unknown>,
  definition: ScryProductDefinition,
  subject?: string,
): void {
  if (evidence.product !== definition.product) {
    throw responseError("Scry response product does not match the requested product");
  }
  if (definition.subjectField && evidence[definition.subjectField] !== subject) {
    throw responseError(
      `Scry response ${definition.subjectField} does not match the requested ${definition.inputKind}`,
    );
  }
  const missing = definition.requiredFields.filter((field) => !(field in evidence));
  if (missing.length > 0) {
    throw responseError(`Scry response is missing required fields: ${missing.join(", ")}`);
  }
  const contract = validateScryContract(definition.product, evidence);
  if (!contract.valid) {
    throw responseError(`Scry response failed contract validation: ${contract.errors.join("; ")}`);
  }
}

export interface ScryClient {
  getBudgetState(): ScryBudgetState;
  query(definition: ScryProductDefinition, subject?: string): Promise<ScryQueryResult>;
}

export function createScryClient(options: ScryPluginOptions = {}): ScryClient {
  const resolved = resolveOptions(options);
  let reservedPaymentMicros = 0;

  return {
    getBudgetState() {
      return {
        paymentMode: resolved.paymentMode,
        perRequestCeilingUsd: resolved.maxPaymentUsd,
        sessionBudgetUsd: resolved.sessionBudgetUsd,
        reservedPaymentUsd: reservedPaymentMicros / USD_MICROS,
        remainingBudgetUsd:
          Math.max(0, resolved.sessionBudgetMicros - reservedPaymentMicros) / USD_MICROS,
      };
    },
    async query(definition, subject) {
      const url = buildUrl(definition, subject);
      const identity = {
        product: definition.product,
        inputKind: definition.inputKind,
        ...(subject ? { subject } : {}),
      };
      if (resolved.paymentMode === "x402") {
        const productPriceMicros = usdMicros(definition.priceUsd, "product price");
        if (productPriceMicros > resolved.maxPaymentMicros) {
          return {
            ok: false,
            status: "budget_exceeded",
            ...identity,
            message: `Local per-request ceiling $${formatUsd(resolved.maxPaymentUsd)} is below the $${formatUsd(definition.priceUsd)} product price`,
          };
        }
        if (reservedPaymentMicros + productPriceMicros > resolved.sessionBudgetMicros) {
          return {
            ok: false,
            status: "budget_exceeded",
            ...identity,
            message:
              "The conservative x402 session budget is exhausted; create a new client only after reviewing prior payment outcomes.",
          };
        }
        // Reserve synchronously before the opaque payment transport can run. Ambiguous failures
        // retain the reservation because the plugin cannot prove whether settlement occurred.
        reservedPaymentMicros += productPriceMicros;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), resolved.timeoutMs);
      try {
        let response: Response;
        try {
          response = await resolved.fetch(url, {
            method: "GET",
            headers: { accept: "application/json" },
            redirect: "error",
            signal: controller.signal,
          });
        } catch {
          return {
            ok: false,
            status: "transport_error",
            ...identity,
            message: controller.signal.aborted ? "Scry request timed out" : "Scry transport failed",
          };
        }

        if (response.status === 402) {
          void response.body?.cancel().catch(() => undefined);
          return {
            ok: false,
            status: "payment_required",
            ...identity,
            quote: parsePaymentQuote(response, definition.priceUsd),
            message: "Payment is required; no settlement was confirmed by this response.",
          };
        }
        if (response.status !== 200) {
          void response.body?.cancel().catch(() => undefined);
          return {
            ok: false,
            status: "http_error",
            ...identity,
            message: `Scry returned HTTP ${response.status}`,
          };
        }

        try {
          const evidence = await readJsonObject(
            response,
            resolved.maxResponseBytes,
            controller.signal,
          );
          validateEvidence(evidence, definition, subject);
          return { ok: true, status: 200, ...identity, evidence };
        } catch (error) {
          if (controller.signal.aborted) {
            return {
              ok: false,
              status: "transport_error",
              ...identity,
              message: "Scry request timed out",
            };
          }
          return {
            ok: false,
            status: "invalid_response",
            ...identity,
            message:
              error instanceof ScryResponseError
                ? error.message
                : "Scry response could not be read safely",
          };
        }
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
