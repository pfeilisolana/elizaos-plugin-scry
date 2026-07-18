import type { Plugin } from "@elizaos/core";
import { createFullContextProAction } from "./actions/full-context-pro.js";
import { createLaunchWindowClusterAction } from "./actions/launch-window-cluster.js";
import { createPersistentWalletsWeeklyAction } from "./actions/persistent-wallets-weekly.js";
import { createPumpfunLaunchDossierAction } from "./actions/pumpfun-launch-dossier.js";
import { createWalletForensicsAction } from "./actions/wallet-forensics.js";
import { createWalletLineageAction } from "./actions/wallet-lineage.js";
import { createWalletQuickFlagAction } from "./actions/wallet-quick-flag.js";
import { createScryClient } from "./client.js";
import { scryCapabilitiesProvider } from "./providers/capabilities.js";
import type { ScryPluginOptions } from "./types.js";

export { extractSolanaAddress, isSolanaAddress } from "./address.js";
export type { ScryBaseX402TransportOptions } from "./base-x402-transport.js";
export { createScryBaseX402Transport } from "./base-x402-transport.js";
export {
  SCRY_BUDGET_PROFILES,
  SCRY_ORIGIN,
  SCRY_PRODUCT_LIST,
  SCRY_PRODUCTS,
} from "./catalog.js";
export { createScryClient } from "./client.js";
export { SCRY_CONTRACTS_SHA256, validateScryContract } from "./contracts.js";
export type {
  ScryActionName,
  ScryBudgetProfile,
  ScryBudgetState,
  ScryFetchTransport,
  ScryInputKind,
  ScryPaymentMode,
  ScryPaymentQuote,
  ScryPluginOptions,
  ScryProductDefinition,
  ScryProductId,
  ScryQueryResult,
  ScrySubjectField,
} from "./types.js";

export function createScryPlugin(options: ScryPluginOptions = {}): Plugin {
  const client = createScryClient(options);
  return {
    name: "scry-wallet-intelligence",
    description:
      "Neutral Solana wallet, mint, and cohort evidence from Scry with explicit x402 payment safety controls.",
    actions: [
      createWalletQuickFlagAction(client),
      createWalletForensicsAction(client),
      createWalletLineageAction(client),
      createLaunchWindowClusterAction(client),
      createFullContextProAction(client),
      createPersistentWalletsWeeklyAction(client),
      createPumpfunLaunchDossierAction(client),
    ],
    providers: [scryCapabilitiesProvider],
  };
}

const scryPlugin = createScryPlugin();

export { scryPlugin };
export default scryPlugin;
