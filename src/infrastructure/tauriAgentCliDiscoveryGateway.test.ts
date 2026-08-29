import { describe, expect, it, vi } from "vitest";
import {
  DISCOVER_AGENT_CLIS_IPC_COMMAND,
  type InvokeAgentCliDiscoveryCommand,
} from "./tauriAgentCliDiscoveryIpcContract";
import { TauriAgentCliDiscoveryGateway } from "./tauriAgentCliDiscoveryGateway";

describe("TauriAgentCliDiscoveryGateway", () => {
  it("uses the strict command and parses both closed provider states", async () => {
    const result = {
      claudeCode: {
        kind: "detected",
        path: "/Users/test/.local/bin/claude",
        version: "2.1.247",
      },
      codex: { kind: "notFound" },
    } as const;
    const invokeCommand = vi.fn<InvokeAgentCliDiscoveryCommand>().mockResolvedValue(result);
    const gateway = new TauriAgentCliDiscoveryGateway(invokeCommand, () => true);

    await expect(gateway.discoverAgentClis({ refresh: true })).resolves.toEqual(result);
    expect(invokeCommand).toHaveBeenCalledWith(DISCOVER_AGENT_CLIS_IPC_COMMAND, {
      request: { refresh: true },
    });
  });

  it("rejects malformed requests before transport", async () => {
    const invokeCommand = vi.fn<InvokeAgentCliDiscoveryCommand>();
    const gateway = new TauriAgentCliDiscoveryGateway(invokeCommand, () => true);

    await expect(gateway.discoverAgentClis({ refresh: "yes" } as never)).rejects.toThrow(
      /request\.refresh/,
    );
    await expect(
      gateway.discoverAgentClis({ refresh: true, path: "/tmp/claude" } as never),
    ).rejects.toThrow(/request\.path/);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects inherited and accessor-backed request fields", async () => {
    const invokeCommand = vi.fn<InvokeAgentCliDiscoveryCommand>();
    const gateway = new TauriAgentCliDiscoveryGateway(invokeCommand, () => true);
    const inherited = Object.create({ refresh: true }) as { readonly refresh: boolean };
    const accessor = Object.defineProperty({}, "refresh", {
      enumerable: true,
      get: () => true,
    }) as { readonly refresh: boolean };

    await expect(gateway.discoverAgentClis(inherited)).rejects.toThrow(/plain object/);
    await expect(gateway.discoverAgentClis(accessor)).rejects.toThrow(/data field/);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it.each([
    [{ claudeCode: { kind: "notFound" }, codex: { kind: "notFound" }, extra: true }],
    [
      {
        claudeCode: { kind: "detected", path: "bin/claude", version: null },
        codex: { kind: "notFound" },
      },
    ],
    [
      {
        claudeCode: { kind: "detected", path: "/bin/claude", version: "latest" },
        codex: { kind: "notFound" },
      },
    ],
    [{ claudeCode: { kind: "notFound", path: "/bin/claude" }, codex: { kind: "notFound" } }],
    [{ claudeCode: { kind: "unknown" }, codex: { kind: "notFound" } }],
  ])("rejects malformed or expanded discovery results", async (result) => {
    const gateway = new TauriAgentCliDiscoveryGateway(
      vi.fn<InvokeAgentCliDiscoveryCommand>().mockResolvedValue(result),
      () => true,
    );

    await expect(gateway.discoverAgentClis({ refresh: false })).rejects.toThrow(TypeError);
  });

  it("rejects inherited provider and state fields in results", async () => {
    const inheritedProvider = Object.create({ kind: "notFound" });
    const inheritedResult = Object.create({
      claudeCode: { kind: "notFound" },
      codex: { kind: "notFound" },
    });
    const invokeCommand = vi
      .fn<InvokeAgentCliDiscoveryCommand>()
      .mockResolvedValueOnce({ claudeCode: inheritedProvider, codex: { kind: "notFound" } })
      .mockResolvedValueOnce(inheritedResult);
    const gateway = new TauriAgentCliDiscoveryGateway(invokeCommand, () => true);

    await expect(gateway.discoverAgentClis({ refresh: false })).rejects.toThrow(/plain object/);
    await expect(gateway.discoverAgentClis({ refresh: false })).rejects.toThrow(/plain object/);
  });

  it("fails truthfully when the native runtime is unavailable", async () => {
    const invokeCommand = vi.fn<InvokeAgentCliDiscoveryCommand>();
    const gateway = new TauriAgentCliDiscoveryGateway(invokeCommand, () => false);

    await expect(gateway.discoverAgentClis({ refresh: false })).rejects.toThrow(
      "Agent CLI discovery requires the native runtime.",
    );
    expect(invokeCommand).not.toHaveBeenCalled();
  });
});
