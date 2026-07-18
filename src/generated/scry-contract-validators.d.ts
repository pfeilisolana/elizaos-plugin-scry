export interface ScrySchemaError {
  instancePath: string;
  keyword: string;
  message?: string;
  schemaPath: string;
}

export interface ScryStandaloneValidator {
  (data: unknown): boolean;
  errors: ScrySchemaError[] | null;
}

export const validateWalletQuickFlag: ScryStandaloneValidator;
export const validateWalletForensics: ScryStandaloneValidator;
export const validateWalletLineage: ScryStandaloneValidator;
export const validateLaunchWindowCluster: ScryStandaloneValidator;
export const validateFullContextPro: ScryStandaloneValidator;
export const validatePersistentWalletsWeekly: ScryStandaloneValidator;
export const validatePumpfunLaunchDossier: ScryStandaloneValidator;
export const SCRY_CONTRACTS_SHA256: string;
