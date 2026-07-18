import { SCRY_PRODUCTS } from "../catalog.js";
import type { ScryClient } from "../client.js";
import { createScryAction } from "./create-scry-action.js";

export function createWalletQuickFlagAction(client: ScryClient) {
  return createScryAction(SCRY_PRODUCTS.SCRY_WALLET_QUICK_FLAG, client);
}
