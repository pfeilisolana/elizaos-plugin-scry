import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkNodeSecurityFloor, NODE_SECURITY_FLOORS } from "./check-node-security-floor.mjs";

const guard = fileURLToPath(new URL("./check-node-security-floor.mjs", import.meta.url));

test("accepts every patched floor and later patch/minor in supported majors", () => {
  for (const version of [
    "v22.23.4",
    "22.23.5",
    "22.24.0",
    "v24.22.1",
    "24.22.2",
    "24.23.0",
    "26.12.1",
    "26.13.0",
  ]) {
    assert.equal(checkNodeSecurityFloor(version).ok, true, version);
  }
});

test("rejects earlier patches and minor releases in every supported major", () => {
  for (const version of ["22.23.3", "22.22.99", "24.22.0", "24.21.99", "26.12.0", "26.11.99"]) {
    assert.equal(checkNodeSecurityFloor(version).reason, "below_security_floor", version);
    assert.equal(checkNodeSecurityFloor(version).ok, false, version);
  }
});

test("rejects unsupported majors, malformed versions and prereleases", () => {
  for (const version of ["18.20.8", "20.20.0", "21.7.3", "23.11.0", "25.9.0", "27.0.0"]) {
    assert.equal(checkNodeSecurityFloor(version).reason, "unsupported_major", version);
    assert.equal(checkNodeSecurityFloor(version).ok, false, version);
  }
  for (const version of ["22", "22.23", "22.23.4-rc.1", "24.22.1+build", "garbage", ""]) {
    assert.equal(checkNodeSecurityFloor(version).reason, "invalid_or_prerelease_version", version);
    assert.equal(checkNodeSecurityFloor(version).ok, false, version);
  }
});

test("package and lockfile engines match the standalone guard", () => {
  const expected = Object.values(NODE_SECURITY_FLOORS)
    .map((version) => `^${version.join(".")}`)
    .join(" || ");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  assert.equal(pkg.engines.node, expected);
  assert.equal(lock.packages[""].engines.node, expected);
  assert.equal(
    readFileSync(new URL("../.node-version", import.meta.url), "utf8").trim(),
    "22.23.4",
  );
});

test("CLI accepts the current patched runner", () => {
  const result = spawnSync(process.execPath, [guard], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).reason, "patched_runtime");
});

test("CLI fails closed for unsafe runners without a production override", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "node-security-floor-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const preload = join(directory, "version-fixture.mjs");
  for (const [version, expectedStatus, expectedReason] of [
    ["v22.23.3", 1, "below_security_floor"],
    ["v24.22.0", 1, "below_security_floor"],
    ["v26.12.0", 1, "below_security_floor"],
    ["v20.20.0", 1, "unsupported_major"],
    ["v22.23.4-rc.1", 1, "invalid_or_prerelease_version"],
    ["v22.23.4", 0, "patched_runtime"],
    ["v24.22.1", 0, "patched_runtime"],
    ["v26.12.1", 0, "patched_runtime"],
  ]) {
    // Only this child fixture replaces process.version; the guard exposes no bypass.
    writeFileSync(
      preload,
      `Object.defineProperty(process, "version", { value: ${JSON.stringify(version)} });`,
    );
    const result = spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, guard], {
      encoding: "utf8",
    });
    assert.equal(result.status, expectedStatus, `${version}: ${result.stderr || result.stdout}`);
    assert.equal(JSON.parse(result.stdout).reason, expectedReason, version);
  }
});
