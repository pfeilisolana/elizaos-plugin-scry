import {
  SCRY_CONTRACTS_SHA256,
  type ScrySchemaError,
  type ScryStandaloneValidator,
  validateFullContextPro,
  validateLaunchWindowCluster,
  validatePersistentWalletsWeekly,
  validatePumpfunLaunchDossier,
  validateWalletForensics,
  validateWalletLineage,
  validateWalletQuickFlag,
} from "./generated/scry-contract-validators.js";
import type { ScryProductId } from "./types.js";

const VALIDATORS: Record<ScryProductId, ScryStandaloneValidator> = {
  scry_wallet_quick_flag: validateWalletQuickFlag,
  scry_wallet_forensics: validateWalletForensics,
  scry_wallet_lineage: validateWalletLineage,
  scry_launch_window_cluster: validateLaunchWindowCluster,
  scry_wallet_full_context_pro: validateFullContextPro,
  scry_weekly_persistent_wallets: validatePersistentWalletsWeekly,
  scry_pumpfun_launch_dossier: validatePumpfunLaunchDossier,
};

function boundedErrors(errors: ScrySchemaError[] | null): string[] {
  if (!errors || errors.length === 0) return ["schema validation failed without details"];
  const details = errors.slice(0, 8).map((error) => {
    const path = error.instancePath.length > 0 ? error.instancePath : "$";
    return `${path} failed ${error.keyword}`;
  });
  if (errors.length > details.length) details.push(`${errors.length - details.length} more errors`);
  return details;
}

export type ScryContractValidation =
  | { valid: true; contractsSha256: string }
  | { valid: false; contractsSha256: string; errors: string[] };

export function validateScryContract(
  product: ScryProductId,
  evidence: unknown,
): ScryContractValidation {
  const validator = VALIDATORS[product];
  if (validator(evidence)) return { valid: true, contractsSha256: SCRY_CONTRACTS_SHA256 };
  return {
    valid: false,
    contractsSha256: SCRY_CONTRACTS_SHA256,
    errors: boundedErrors(validator.errors),
  };
}

export { SCRY_CONTRACTS_SHA256 };
