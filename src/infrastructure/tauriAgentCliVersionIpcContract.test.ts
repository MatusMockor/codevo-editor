import { describe, expect, it, vi } from "vitest";
import type { AgentCliVersionProbeRequest } from "../domain/agentCliVersion";
import {
  invokeProbeAgentCliVersionIpc,
  PROBE_AGENT_CLI_VERSION_IPC_COMMAND,
  type InvokeAgentCliVersionCommand,
} from "./tauriAgentCliVersionIpcContract";

const REQUEST: AgentCliVersionProbeRequest = {
  agentCliPath: "/usr/local/bin/claude",
  agentCliKind: "claudeCode",
};

const RESULT = {
  version: "2.1.245",
  probedAtEpochMs: 1_700_000_000_000,
  binaryFingerprint: { sizeBytes: 1_024, modifiedEpochMs: 1_699_000_000_000 },
} as const;

describe("agent CLI version IPC command name", () => {
  it("pins the snake_case command", () => {
    expect(PROBE_AGENT_CLI_VERSION_IPC_COMMAND).toBe("probe_agent_cli_version");
  });
});

describe("invokeProbeAgentCliVersionIpc", () => {
  it("sends the validated request and parses the probe result", async () => {
    const invokeCommand = vi.fn<InvokeAgentCliVersionCommand>().mockResolvedValue(RESULT);

    await expect(invokeProbeAgentCliVersionIpc(invokeCommand, REQUEST)).resolves.toEqual(RESULT);
    expect(invokeCommand).toHaveBeenCalledWith("probe_agent_cli_version", { request: REQUEST });
  });

  it("accepts a probe that could not read a version", async () => {
    const wire = { ...RESULT, version: null };
    const invokeCommand = vi.fn<InvokeAgentCliVersionCommand>().mockResolvedValue(wire);

    await expect(invokeProbeAgentCliVersionIpc(invokeCommand, REQUEST)).resolves.toEqual(wire);
  });

  it("rejects malformed requests before touching the transport", async () => {
    const invokeCommand = vi.fn<InvokeAgentCliVersionCommand>();
    const rejected: readonly unknown[] = [
      {},
      { agentCliPath: "claude", agentCliKind: "claudeCode" },
      { agentCliPath: "", agentCliKind: "claudeCode" },
      { agentCliPath: "/usr/local/bin/gemini", agentCliKind: "gemini" },
      { ...REQUEST, extra: true },
    ];

    for (const request of rejected) {
      await expect(
        invokeProbeAgentCliVersionIpc(invokeCommand, request as AgentCliVersionProbeRequest),
      ).rejects.toThrow(TypeError);
    }
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects malformed probe results", async () => {
    const rejected: readonly unknown[] = [
      null,
      {},
      { ...RESULT, extra: true },
      { ...RESULT, version: "garbage" },
      { ...RESULT, version: " 2.1.245" },
      { ...RESULT, probedAtEpochMs: -1 },
      { ...RESULT, binaryFingerprint: { sizeBytes: -1, modifiedEpochMs: 1 } },
      { ...RESULT, binaryFingerprint: null },
    ];

    for (const result of rejected) {
      const invokeCommand = vi.fn<InvokeAgentCliVersionCommand>().mockResolvedValue(result);
      await expect(invokeProbeAgentCliVersionIpc(invokeCommand, REQUEST)).rejects.toThrow(
        TypeError,
      );
    }
  });
});
