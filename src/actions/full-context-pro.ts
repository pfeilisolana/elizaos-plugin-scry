import type { Action } from "@elizaos/core";
import { SCRY_PRODUCTS } from "../catalog.js";
import type { ScryClient } from "../client.js";
import { createScryAction } from "./create-scry-action.js";

export function createFullContextProAction(client: ScryClient): Action {
  return createScryAction(SCRY_PRODUCTS.SCRY_WALLET_FULL_CONTEXT_PRO, client);
}
