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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function holdingsSnapshotErrors(product: ScryProductId, evidence: unknown): string[] {
  if (product !== "scry_wallet_forensics" || !isRecord(evidence)) return [];
  const snapshot = evidence.holdings_snapshot;
  if (snapshot === null || snapshot === undefined || !isRecord(snapshot)) return [];

  const errors: string[] = [];
  const completeness = snapshot.snapshot_completeness;
  if (completeness === "complete") {
    if (!Number.isInteger(snapshot.token_count) || Number(snapshot.token_count) < 0) {
      errors.push("/holdings_snapshot/token_count must be exact for complete snapshots");
    }
    if (snapshot.token_count_lower_bound !== null) {
      errors.push("/holdings_snapshot/token_count_lower_bound must be null for complete snapshots");
    }
    if (snapshot.token_count_is_lower_bound !== false) {
      errors.push(
        "/holdings_snapshot/token_count_is_lower_bound must be false for complete snapshots",
      );
    }
  } else if (completeness === "bounded_lower_bound") {
    if (snapshot.token_count !== null) {
      errors.push("/holdings_snapshot/token_count must be null for bounded snapshots");
    }
    if (
      !Number.isInteger(snapshot.token_count_lower_bound) ||
      Number(snapshot.token_count_lower_bound) < 0
    ) {
      errors.push(
        "/holdings_snapshot/token_count_lower_bound must be present for bounded snapshots",
      );
    }
    if (snapshot.token_count_is_lower_bound !== true) {
      errors.push(
        "/holdings_snapshot/token_count_is_lower_bound must be true for bounded snapshots",
      );
    }
    if (!Array.isArray(snapshot.tokens) || snapshot.tokens.length !== 0) {
      errors.push("/holdings_snapshot/tokens must be empty for bounded snapshots");
    }
    if (snapshot.tokens_truncated !== true) {
      errors.push("/holdings_snapshot/tokens_truncated must be true for bounded snapshots");
    }
  } else if (completeness === "unverified") {
    if (snapshot.token_count !== null || snapshot.token_count_lower_bound !== null) {
      errors.push("/holdings_snapshot counts must be null for unverified snapshots");
    }
    if (snapshot.token_count_is_lower_bound !== false) {
      errors.push("/holdings_snapshot/token_count_is_lower_bound must be false when unverified");
    }
  }
  return errors;
}

export type ScryContractValidation =
  | { valid: true; contractsSha256: string }
  | { valid: false; contractsSha256: string; errors: string[] };

export function validateScryContract(
  product: ScryProductId,
  evidence: unknown,
): ScryContractValidation {
  const validator = VALIDATORS[product];
  if (validator(evidence)) {
    const semanticErrors = holdingsSnapshotErrors(product, evidence);
    if (semanticErrors.length === 0) {
      return { valid: true, contractsSha256: SCRY_CONTRACTS_SHA256 };
    }
    return {
      valid: false,
      contractsSha256: SCRY_CONTRACTS_SHA256,
      errors: semanticErrors,
    };
  }
  return {
    valid: false,
    contractsSha256: SCRY_CONTRACTS_SHA256,
    errors: boundedErrors(validator.errors),
  };
}

export { SCRY_CONTRACTS_SHA256 };
