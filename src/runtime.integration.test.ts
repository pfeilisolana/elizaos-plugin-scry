import { AgentRuntime, type Character, type Memory, type State } from "@elizaos/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createScryPlugin } from "./index.js";

const WALLET = "4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk";
const character: Character = {
  name: "Scry integration test",
  bio: "Exercises the real ElizaOS plugin registration surface without a database or model.",
};

function message(text: string): Memory {
  return { content: { text } } as Memory;
}

describe("real ElizaOS runtime integration", () => {
  const runtimes: AgentRuntime[] = [];

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.stop()));
  });

  it("registers the plugin through the public runtime without startup network access", async () => {
    const fetchMock = vi.fn(async () => new Response("challenge", { status: 402 }));
    const plugin = createScryPlugin({
      transport: { fetch: fetchMock as unknown as typeof fetch, paymentMode: "quote-only" },
    });

    const runtime = new AgentRuntime({ character, fetch: fetchMock as unknown as typeof fetch });
    runtimes.push(runtime);
    await runtime.registerPlugin(plugin);

    expect(runtime.plugins.map((candidate) => candidate.name)).toEqual([
      "scry-wallet-intelligence",
    ]);
    expect(runtime.actions).toHaveLength(7);
    expect(runtime.providers).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();

    await runtime.registerPlugin(plugin);
    expect(runtime.plugins).toHaveLength(1);
    expect(runtime.actions).toHaveLength(7);
    expect(runtime.providers).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();

    const provider = runtime.providers[0];
    if (!provider) throw new Error("Expected the registered Scry capability provider");
    const capabilities = await provider.get(runtime, message("capabilities"), {} as State);
    expect(capabilities).toMatchObject({
      values: { scryEvidenceOnly: true, scryDefaultPaymentMode: "quote-only" },
      data: { products: expect.any(Array) },
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const action = runtime.actions.find((candidate) => candidate.name === "SCRY_WALLET_FORENSICS");
    if (!action) throw new Error("Expected the registered Scry forensics action");
    const result = await action.handler(runtime, message(`check ${WALLET}`), {} as State);

    expect(result).toMatchObject({
      success: false,
      values: { scryStatus: "payment_required", address: WALLET },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
