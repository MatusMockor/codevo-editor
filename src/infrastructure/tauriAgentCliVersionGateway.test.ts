import { describe, expect, it, vi } from "vitest";
import type { AgentCliVersionProbeRequest } from "../domain/agentCliVersion";
import {
  TauriAgentCliVersionGateway,
  type AgentCliVersionRuntimeDetector,
} from "./tauriAgentCliVersionGateway";
import type { InvokeAgentCliVersionCommand } from "./tauriAgentCliVersionIpcContract";

const available: AgentCliVersionRuntimeDetector = () => true;
const unavailable: AgentCliVersionRuntimeDetector = () => false;

const REQUEST: AgentCliVersionProbeRequest = {
  agentCliPath: "/usr/local/bin/claude",
  agentCliKind: "claudeCode",
};

const RESULT = {
  version: "2.1.245",
  probedAtEpochMs: 1_700_000_000_000,
  binaryFingerprint: { sizeBytes: 1_024, modifiedEpochMs: 1_699_000_000_000 },
} as const;

describe("TauriAgentCliVersionGateway", () => {
  it("forwards the typed probe request and returns the parsed result", async () => {
    const invokeCommand = vi.fn<InvokeAgentCliVersionCommand>().mockResolvedValue(RESULT);
    const gateway = new TauriAgentCliVersionGateway(invokeCommand, available);

    await expect(gateway.probeAgentCliVersion(REQUEST)).resolves.toEqual(RESULT);
    expect(invokeCommand.mock.calls).toEqual([["probe_agent_cli_version", { request: REQUEST }]]);
  });

  it("throws without the native runtime", async () => {
    const invokeCommand = vi.fn<InvokeAgentCliVersionCommand>();
    const gateway = new TauriAgentCliVersionGateway(invokeCommand, unavailable);

    await expect(gateway.probeAgentCliVersion(REQUEST)).rejects.toThrow(
      "Agent CLI version probes require the native runtime.",
    );
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects an invalid request before reaching the transport", async () => {
    const invokeCommand = vi.fn<InvokeAgentCliVersionCommand>();
    const gateway = new TauriAgentCliVersionGateway(invokeCommand, available);

    await expect(
      gateway.probeAgentCliVersion({ ...REQUEST, agentCliPath: "claude" }),
    ).rejects.toThrow(TypeError);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects a malformed transport result", async () => {
    const invokeCommand = vi.fn<InvokeAgentCliVersionCommand>().mockResolvedValue({});
    const gateway = new TauriAgentCliVersionGateway(invokeCommand, available);

    await expect(gateway.probeAgentCliVersion(REQUEST)).rejects.toThrow(TypeError);
  });
});
