#!/usr/bin/env node
// Keep this independent of npm dependencies so CI rejects an unsafe runner first.
import { pathToFileURL } from "node:url";

export const NODE_SECURITY_FLOORS = Object.freeze({
  22: [22, 23, 4],
  24: [24, 22, 1],
  26: [26, 12, 1],
});

export function checkNodeSecurityFloor(version = process.version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
  if (!match) return { ok: false, reason: "invalid_or_prerelease_version", version };
  const actual = match.slice(1).map(Number);
  const minimum = NODE_SECURITY_FLOORS[actual[0]];
  if (!minimum) return { ok: false, reason: "unsupported_major", version };
  const ok = actual[1] > minimum[1] || (actual[1] === minimum[1] && actual[2] >= minimum[2]);
  return {
    ok,
    reason: ok ? "patched_runtime" : "below_security_floor",
    version,
    minimum: minimum.join("."),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const result = checkNodeSecurityFloor();
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}
