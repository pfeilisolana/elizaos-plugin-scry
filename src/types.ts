export type ScryProductId =
  | "scry_wallet_quick_flag"
  | "scry_wallet_forensics"
  | "scry_wallet_lineage"
  | "scry_launch_window_cluster"
  | "scry_wallet_full_context_pro"
  | "scry_weekly_persistent_wallets"
  | "scry_pumpfun_launch_dossier";

export type ScryActionName =
  | "SCRY_WALLET_QUICK_FLAG"
  | "SCRY_WALLET_FORENSICS"
  | "SCRY_WALLET_LINEAGE"
  | "SCRY_LAUNCH_WINDOW_CLUSTER"
  | "SCRY_WALLET_FULL_CONTEXT_PRO"
  | "SCRY_PERSISTENT_WALLETS_WEEKLY"
  | "SCRY_PUMPFUN_LAUNCH_DOSSIER";

export type ScryInputKind = "wallet" | "mint" | "none";
export type ScrySubjectField = "address" | "mint";

export type ScryPaymentMode = "quote-only" | "x402";

export type ScryFetchTransport =
  | {
      fetch: typeof fetch;
      paymentMode: "quote-only";
    }
  | {
      /** The injected payment transport must independently enforce this ceiling. */
      enforcedMaxPaymentUsd: number;
      fetch: typeof fetch;
      paymentMode: "x402";
      /** Host attestation: copy PaymentRequired.resource unchanged into PaymentPayload.resource. */
      paymentPayloadResource: "payment-required-resource-exact";
    };

export interface ScryPluginOptions {
  transport?: ScryFetchTransport;
  /** Required in x402 mode and must equal the transport's independently enforced ceiling. */
  maxPaymentUsd?: number;
  /** Required in x402 mode. Conservatively reserved across this client instance. */
  sessionBudgetUsd?: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface ScryBudgetState {
  paymentMode: ScryPaymentMode;
  perRequestCeilingUsd: number;
  sessionBudgetUsd: number;
  reservedPaymentUsd: number;
  remainingBudgetUsd: number;
}

export interface ScryProductDefinition {
  actionName: ScryActionName;
  product: ScryProductId;
  label: string;
  inputKind: ScryInputKind;
  routeTemplate: string;
  subjectField: ScrySubjectField | null;
  priceUsd: number;
  requiredFields: readonly string[];
  similes: readonly string[];
  description: string;
  buyerIntent: string;
  notFor: string;
  lowerCostAlternative: ScryActionName | null;
  moreCompleteAlternative: ScryActionName | null;
}

export interface ScryBudgetProfile {
  perRequestCeilingUsd: number;
  sessionBudgetUsd: number;
  eligibleActions: readonly ScryActionName[];
  purpose: string;
}

export interface ScryPaymentQuote {
  x402Version?: number;
  networks: string[];
  catalogPriceUsd: number;
  challengePriceVerified: false;
}

interface ScryQueryIdentity {
  product: ScryProductId;
  inputKind: ScryInputKind;
  subject?: string;
}

export type ScryQueryResult = ScryQueryIdentity &
  (
    | {
        ok: true;
        status: 200;
        evidence: Record<string, unknown>;
      }
    | {
        ok: false;
        status: "payment_required";
        quote: ScryPaymentQuote;
        message: string;
      }
    | {
        ok: false;
        status: "budget_exceeded" | "transport_error" | "invalid_response" | "http_error";
        message: string;
      }
  );
