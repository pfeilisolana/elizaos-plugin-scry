import type { Provider } from "@elizaos/core";
import { SCRY_BUDGET_PROFILES, SCRY_PRODUCT_LIST } from "../catalog.js";

export const scryCapabilitiesProvider: Provider = {
  name: "SCRY_CAPABILITIES",
  description: "Static Scry product, price, and payment-safety context; performs no network calls.",
  dynamic: false,
  position: -10,
  get: async () => {
    const products = SCRY_PRODUCT_LIST.map(
      ({
        actionName,
        product,
        label,
        priceUsd,
        buyerIntent,
        notFor,
        lowerCostAlternative,
        moreCompleteAlternative,
      }) => ({
        actionName,
        product,
        label,
        priceUsd,
        buyerIntent,
        notFor,
        lowerCostAlternative,
        moreCompleteAlternative,
      }),
    );
    return {
      text: [
        "Scry provides neutral Solana wallet, mint, and cohort evidence through seven x402 products, starting with a $0.001 prefilter.",
        "Choose the narrowest product that fully matches the caller's intent; use Full Context only when combined wallet evidence is explicitly required.",
        "The $0.05 preflight ceiling excludes the $0.18, $0.20, and $0.30 products; full-catalog access requires an explicit $0.30 per-request ceiling.",
        "A 402 response is a payment challenge, never proof of settlement.",
        "The default plugin mode is quote-only and cannot pay.",
        "Paid mode requires independent per-request and cumulative session budgets.",
      ].join(" "),
      values: {
        scryEvidenceOnly: true,
        scryDefaultPaymentMode: "quote-only",
        scryFullCatalogCeilingUsd: SCRY_BUDGET_PROFILES.FULL_CATALOG.perRequestCeilingUsd,
      },
      data: { products, budgetProfiles: SCRY_BUDGET_PROFILES },
    };
  },
};
