import { describe, expect, it, vi } from "vitest";
import type { AgentProviderSignInRequest } from "../domain/agentProviderSignIn";
import {
  START_AGENT_PROVIDER_SIGN_IN_IPC_COMMAND,
  TauriAgentProviderSignInGateway,
  type AgentProviderSignInRuntimeDetector,
  type InvokeAgentProviderSignInCommand,
} from "./tauriAgentProviderSignInGateway";

const available: AgentProviderSignInRuntimeDetector = () => true;
const unavailable: AgentProviderSignInRuntimeDetector = () => false;
const REQUEST: AgentProviderSignInRequest = {
  provider: "codex",
  providerGeneration: 4,
  size: { cols: 80, rows: 24 },
};

describe("TauriAgentProviderSignInGateway", () => {
  it("pins the semantic Rust command and sends no executable recipe", async () => {
    const result = {
      kind: "started",
      provider: "codex",
      providerGeneration: 4,
      sessionId: 12,
    } as const;
    const invokeCommand = vi.fn<InvokeAgentProviderSignInCommand>().mockResolvedValue(result);
    const gateway = new TauriAgentProviderSignInGateway(invokeCommand, available);

    expect(START_AGENT_PROVIDER_SIGN_IN_IPC_COMMAND).toBe("start_agent_provider_sign_in");
    await expect(gateway.startAgentProviderSignIn(REQUEST)).resolves.toEqual(result);
    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith(
      START_AGENT_PROVIDER_SIGN_IN_IPC_COMMAND,
      { request: REQUEST },
    );
  });

  it("rejects outbound extra fields before transport", async () => {
    const invokeCommand = vi.fn<InvokeAgentProviderSignInCommand>();
    const gateway = new TauriAgentProviderSignInGateway(invokeCommand, available);

    await expect(
      gateway.startAgentProviderSignIn({ ...REQUEST, argv: ["login"] } as never),
    ).rejects.toThrow(TypeError);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects foreign or stale response authority", async () => {
    const invokeCommand = vi
      .fn<InvokeAgentProviderSignInCommand>()
      .mockResolvedValueOnce({
        kind: "started",
        provider: "claudeCode",
        providerGeneration: 4,
        sessionId: 12,
      })
      .mockResolvedValueOnce({
        kind: "refused",
        provider: "codex",
        providerGeneration: 3,
        reason: "staleAuthority",
      });
    const gateway = new TauriAgentProviderSignInGateway(invokeCommand, available);

    await expect(gateway.startAgentProviderSignIn(REQUEST)).rejects.toThrow(/result\.provider/);
    await expect(gateway.startAgentProviderSignIn(REQUEST)).rejects.toThrow(
      /result\.providerGeneration/,
    );
  });

  it("rejects malformed inbound fields", async () => {
    const invokeCommand = vi.fn<InvokeAgentProviderSignInCommand>().mockResolvedValue({
      kind: "started",
      provider: "codex",
      providerGeneration: 4,
      sessionId: 12,
      credential: "secret",
    });
    const gateway = new TauriAgentProviderSignInGateway(invokeCommand, available);

    await expect(gateway.startAgentProviderSignIn(REQUEST)).rejects.toThrow(TypeError);
  });

  it("fails truthfully without the native runtime", async () => {
    const invokeCommand = vi.fn<InvokeAgentProviderSignInCommand>();
    const gateway = new TauriAgentProviderSignInGateway(invokeCommand, unavailable);

    await expect(gateway.startAgentProviderSignIn(REQUEST)).rejects.toThrow(
      "Agent provider sign-in requires the native runtime.",
    );
    expect(invokeCommand).not.toHaveBeenCalled();
  });
});
