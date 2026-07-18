import { describe, expect, it } from "vitest";
import { extractSolanaAddress, isSolanaAddress } from "./address.js";

const WALLET = "4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk";

describe("Solana address validation", () => {
  it("validates the decoded 32-byte public key instead of length alone", () => {
    expect(isSolanaAddress(WALLET)).toBe(true);
    expect(isSolanaAddress("1".repeat(32))).toBe(true);
    expect(isSolanaAddress("2".repeat(32))).toBe(false);
    expect(isSolanaAddress(`${WALLET.slice(0, -1)}0`)).toBe(false);
    expect(isSolanaAddress(`${WALLET}0`)).toBe(false);
    expect(isSolanaAddress("short")).toBe(false);
  });

  it("extracts only a standalone valid address", () => {
    expect(extractSolanaAddress(`Investigate ${WALLET}, please.`)).toBe(WALLET);
    expect(extractSolanaAddress(`x${WALLET}y`)).toBeUndefined();
    expect(extractSolanaAddress(`${"2".repeat(32)} then ${WALLET}`)).toBe(WALLET);
    expect(extractSolanaAddress("No wallet here")).toBeUndefined();
  });
});
