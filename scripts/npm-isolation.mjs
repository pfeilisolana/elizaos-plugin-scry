import { join, resolve } from "node:path";

export function isolatedNpmEnvironmentFor(tempRoot) {
  if (typeof tempRoot !== "string" || tempRoot.trim() === "") {
    throw new TypeError("tempRoot must be a non-empty path");
  }
  const root = resolve(tempRoot);
  return {
    npm_config_userconfig: join(root, ".npmrc"),
    npm_config_cache: join(root, "npm-cache"),
    npm_config_logs_dir: join(root, "npm-logs"),
  };
}
