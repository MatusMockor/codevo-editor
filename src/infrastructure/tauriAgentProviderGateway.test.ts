import { describe, expect, it, vi } from "vitest";
import type {
  AgentProviderGenerationRequest,
  AgentProviderPolicyRegistrationRequest,
  AgentProviderUpdateRequest,
} from "../domain/agentProviderHealth";
import {
  AGENT_PROVIDER_UPDATE_PROGRESS_EVENT,
  GET_AGENT_PROVIDER_POLICY_IPC_COMMAND,
  PROBE_AGENT_PROVIDER_HEALTH_IPC_COMMAND,
  READ_AGENT_PROVIDER_USAGE_IPC_COMMAND,
  REGISTER_AGENT_PROVIDER_POLICY_IPC_COMMAND,
  TauriAgentProviderGateway,
  UPDATE_AGENT_PROVIDER_IPC_COMMAND,
  type AgentProviderRuntimeDetector,
  type InvokeAgentProviderCommand,
  type ListenToAgentProviderUpdateProgress,
} from "./tauriAgentProviderGateway";

const available: AgentProviderRuntimeDetector = () => true;
const unavailable: AgentProviderRuntimeDetector = () => false;

const REGISTRATION: AgentProviderPolicyRegistrationRequest = {
  provider: "codex",
  settingsRevision: 7,
  expectedProviderGeneration: 2,
  enabled: true,
  cliPath: "/usr/local/bin/codex",
  checkForUpdates: true,
};

const GENERATION: AgentProviderGenerationRequest = {
  provider: "codex",
  providerGeneration: 3,
};

const UPDATE: AgentProviderUpdateRequest = {
  ...GENERATION,
  operationId: "provider-update-1234",
};

describe("TauriAgentProviderGateway", () => {
  it("pins the exact synchronous Rust command names", () => {
    expect(REGISTER_AGENT_PROVIDER_POLICY_IPC_COMMAND).toBe("register_agent_provider_policy");
    expect(GET_AGENT_PROVIDER_POLICY_IPC_COMMAND).toBe("get_agent_provider_policy");
    expect(PROBE_AGENT_PROVIDER_HEALTH_IPC_COMMAND).toBe("probe_agent_provider_health");
    expect(READ_AGENT_PROVIDER_USAGE_IPC_COMMAND).toBe("read_agent_provider_usage");
    expect(UPDATE_AGENT_PROVIDER_IPC_COMMAND).toBe("update_agent_provider");
    expect(AGENT_PROVIDER_UPDATE_PROGRESS_EVENT).toBe("agent-provider-update://progress");
  });

  it("reads bounded account usage for the exact provider generation", async () => {
    const result = {
      provider: "codex",
      fetchedAtEpochMs: 1_700_000_000_000,
      windows: [
        {
          id: "codex-primary",
          label: "Codex · Weekly limit",
          usedPercent: 11,
          windowDurationMinutes: 10_080,
          resetsAtEpochMs: 1_700_100_000_000,
          resetsLabel: null,
        },
      ],
    } as const;
    const invokeCommand = vi.fn<InvokeAgentProviderCommand>().mockResolvedValue(result);
    const gateway = new TauriAgentProviderGateway(invokeCommand, available);

    await expect(gateway.readAgentProviderUsage(GENERATION)).resolves.toEqual(result);
    expect(invokeCommand).toHaveBeenCalledWith(READ_AGENT_PROVIDER_USAGE_IPC_COMMAND, {
      request: GENERATION,
    });
  });

  it("registers provider policy with exact compare-and-swap authority", async () => {
    const receipt = { provider: "codex", settingsRevision: 7, providerGeneration: 3 } as const;
    const invokeCommand = vi.fn<InvokeAgentProviderCommand>().mockResolvedValue(receipt);
    const gateway = new TauriAgentProviderGateway(invokeCommand, available);

    await expect(gateway.registerAgentProviderPolicy(REGISTRATION)).resolves.toEqual(receipt);
    expect(invokeCommand).toHaveBeenCalledWith(REGISTER_AGENT_PROVIDER_POLICY_IPC_COMMAND, {
      request: REGISTRATION,
    });
  });

  it("accepts a newer stored receipt for an idempotent reload reacquire", async () => {
    const receipt = { provider: "codex", settingsRevision: 11, providerGeneration: 5 } as const;
    const invokeCommand = vi.fn<InvokeAgentProviderCommand>().mockResolvedValue(receipt);
    const gateway = new TauriAgentProviderGateway(invokeCommand, available);

    await expect(
      gateway.registerAgentProviderPolicy({
        ...REGISTRATION,
        settingsRevision: 1,
        expectedProviderGeneration: 5,
      }),
    ).resolves.toEqual(receipt);
  });

  it("reads nested registered and exact unregistered provider snapshots", async () => {
    const invokeCommand = vi
      .fn<InvokeAgentProviderCommand>()
      .mockResolvedValueOnce({
        kind: "registered",
        receipt: { provider: "codex", settingsRevision: 7, providerGeneration: 3 },
        enabled: true,
        cliPath: "/usr/local/bin/codex",
        checkForUpdates: true,
      })
      .mockResolvedValueOnce({ kind: "unregistered" });
    const gateway = new TauriAgentProviderGateway(invokeCommand, available);

    await expect(gateway.currentAgentProviderPolicy({ provider: "codex" })).resolves.toMatchObject({
      kind: "registered",
      receipt: { providerGeneration: 3 },
    });
    await expect(gateway.currentAgentProviderPolicy({ provider: "claudeCode" })).resolves.toEqual({
      kind: "unregistered",
    });
    expect(invokeCommand.mock.calls).toEqual([
      [GET_AGENT_PROVIDER_POLICY_IPC_COMMAND, { request: { provider: "codex" } }],
      [GET_AGENT_PROVIDER_POLICY_IPC_COMMAND, { request: { provider: "claudeCode" } }],
    ]);
  });

  it("probes health with only exact registered provider authority", async () => {
    const result = {
      installedVersion: "0.150.1",
      auth: { kind: "signedIn", label: "ChatGPT Plus" },
      update: { kind: "current", installedVersion: "0.150.1" },
      checkedAtEpochMs: 1_700_000_000_000,
    } as const;
    const invokeCommand = vi.fn<InvokeAgentProviderCommand>().mockResolvedValue(result);
    const gateway = new TauriAgentProviderGateway(invokeCommand, available);

    await expect(gateway.probeAgentProviderHealth(GENERATION)).resolves.toEqual(result);
    expect(invokeCommand).toHaveBeenCalledWith(PROBE_AGENT_PROVIDER_HEALTH_IPC_COMMAND, {
      request: GENERATION,
    });
  });

  it("carries the native self-update installer and its version failure across the wire", async () => {
    const probe = {
      installedVersion: "0.150.1",
      auth: { kind: "signedIn", label: null },
      update: {
        kind: "available",
        installedVersion: "0.150.1",
        availableVersion: "0.151.0",
        installer: { kind: "selfUpdate", command: "codexUpdate" },
      },
      checkedAtEpochMs: 1_700_000_000_000,
    } as const;
    const failure = {
      kind: "failed",
      reason: "versionNotAdvanced",
      outputTail: "Installer output withheld (stdout: 24 bytes, stderr: 0 bytes).",
      outputTruncated: false,
    } as const;
    const invokeCommand = vi
      .fn<InvokeAgentProviderCommand>()
      .mockResolvedValueOnce(probe)
      .mockResolvedValueOnce(failure);
    const gateway = new TauriAgentProviderGateway(invokeCommand, available);

    await expect(gateway.probeAgentProviderHealth(GENERATION)).resolves.toEqual(probe);
    await expect(gateway.updateAgentProvider(UPDATE)).resolves.toEqual(failure);
  });

  it("rejects a foreign or unknown self-update installer from the backend", async () => {
    const invokeCommand = vi
      .fn<InvokeAgentProviderCommand>()
      .mockResolvedValueOnce({
        installedVersion: "0.150.1",
        auth: { kind: "signedOut" },
        update: {
          kind: "available",
          installedVersion: "0.150.1",
          availableVersion: "0.151.0",
          installer: { kind: "selfUpdate", command: "claudeUpdate" },
        },
        checkedAtEpochMs: 1,
      })
      .mockResolvedValueOnce({
        installedVersion: "0.150.1",
        auth: { kind: "signedOut" },
        update: {
          kind: "available",
          installedVersion: "0.150.1",
          availableVersion: "0.151.0",
          installer: { kind: "selfUpdate", command: "codexUpdate", argv: ["codex", "update"] },
        },
        checkedAtEpochMs: 1,
      });
    const gateway = new TauriAgentProviderGateway(invokeCommand, available);

    await expect(gateway.probeAgentProviderHealth(GENERATION)).rejects.toThrow(TypeError);
    await expect(gateway.probeAgentProviderHealth(GENERATION)).rejects.toThrow(TypeError);
  });

  it("returns the bounded synchronous update result", async () => {
    const result = {
      kind: "failed",
      reason: "outputLimitExceeded",
      outputTail: "Installer output withheld (stdout: 524288 bytes, stderr: 524288 bytes).",
      outputTruncated: true,
    } as const;
    const invokeCommand = vi.fn<InvokeAgentProviderCommand>().mockResolvedValue(result);
    const gateway = new TauriAgentProviderGateway(invokeCommand, available);

    await expect(gateway.updateAgentProvider(UPDATE)).resolves.toEqual(result);
    expect(invokeCommand).toHaveBeenCalledWith(UPDATE_AGENT_PROVIDER_IPC_COMMAND, {
      request: UPDATE,
    });
  });

  it("subscribes to strict progress and reports malformed payloads", async () => {
    let handler: ((event: { readonly payload: unknown }) => void) | undefined;
    const unlisten = vi.fn();
    const listenToProgress = vi.fn<ListenToAgentProviderUpdateProgress>(async (_event, next) => {
      handler = next;
      return unlisten;
    });
    const gateway = new TauriAgentProviderGateway(vi.fn(), available, listenToProgress);
    const listener = vi.fn();
    const onError = vi.fn();

    await expect(gateway.subscribeAgentProviderUpdateProgress(listener, onError)).resolves.toBe(
      unlisten,
    );
    expect(listenToProgress).toHaveBeenCalledWith(
      AGENT_PROVIDER_UPDATE_PROGRESS_EVENT,
      expect.any(Function),
    );
    handler?.({
      payload: {
        ...UPDATE,
        sequence: 1,
        stream: "stderr",
        data: "Installer stderr activity: 11 bytes.",
        truncated: false,
        redacted: true,
      },
    });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ sequence: 1 }));

    handler?.({
      payload: {
        ...UPDATE,
        sequence: 2,
        stream: "stdout",
        data: "password=hunter2",
        truncated: false,
        redacted: true,
      },
    });
    expect(onError).toHaveBeenCalledWith(expect.any(TypeError));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed outbound requests before transport", async () => {
    const invokeCommand = vi.fn<InvokeAgentProviderCommand>();
    const gateway = new TauriAgentProviderGateway(invokeCommand, available);

    await expect(
      gateway.registerAgentProviderPolicy({ ...REGISTRATION, token: "secret" } as never),
    ).rejects.toThrow(TypeError);
    await expect(
      gateway.currentAgentProviderPolicy({ provider: "cursor" } as never),
    ).rejects.toThrow(TypeError);
    await expect(
      gateway.probeAgentProviderHealth({ ...GENERATION, providerGeneration: -1 }),
    ).rejects.toThrow(TypeError);
    await expect(
      gateway.updateAgentProvider({ ...UPDATE, availableVersion: "0.151.0" } as never),
    ).rejects.toThrow(TypeError);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("rejects foreign or malformed transport results", async () => {
    const invokeCommand = vi
      .fn<InvokeAgentProviderCommand>()
      .mockResolvedValueOnce({ provider: "claudeCode", settingsRevision: 7, providerGeneration: 3 })
      .mockResolvedValueOnce({ provider: "codex", settingsRevision: 6, providerGeneration: 3 })
      .mockResolvedValueOnce({
        kind: "registered",
        receipt: { provider: "claudeCode", settingsRevision: 7, providerGeneration: 3 },
        enabled: true,
        cliPath: "/usr/local/bin/claude",
        checkForUpdates: false,
      })
      .mockResolvedValueOnce({
        installedVersion: "0.150.1",
        auth: { kind: "signedOut", token: "secret" },
        update: { kind: "current", installedVersion: "0.150.1" },
        checkedAtEpochMs: 1,
      })
      .mockResolvedValueOnce({
        kind: "failed",
        reason: "outputLimitExceeded",
        outputTail: "Installer output withheld (stdout: 1 bytes, stderr: 0 bytes).",
        outputTruncated: false,
      });
    const gateway = new TauriAgentProviderGateway(invokeCommand, available);

    await expect(gateway.registerAgentProviderPolicy(REGISTRATION)).rejects.toThrow(
      /receipt\.provider/,
    );
    await expect(gateway.registerAgentProviderPolicy(REGISTRATION)).rejects.toThrow(
      /receipt\.settingsRevision/,
    );
    await expect(gateway.currentAgentProviderPolicy({ provider: "codex" })).rejects.toThrow(
      /result\.receipt\.provider/,
    );
    await expect(gateway.probeAgentProviderHealth(GENERATION)).rejects.toThrow(TypeError);
    await expect(gateway.updateAgentProvider(UPDATE)).rejects.toThrow(TypeError);
  });

  it.each(["generationConflict", "revisionConflict", "staleRevision"])(
    "preserves the exact backend policy rejection: %s",
    async (rejection) => {
      const invokeCommand = vi.fn<InvokeAgentProviderCommand>().mockRejectedValue(rejection);
      const gateway = new TauriAgentProviderGateway(invokeCommand, available);

      await expect(gateway.registerAgentProviderPolicy(REGISTRATION)).rejects.toBe(rejection);
    },
  );

  it("fails truthfully without the native runtime", async () => {
    const invokeCommand = vi.fn<InvokeAgentProviderCommand>();
    const gateway = new TauriAgentProviderGateway(invokeCommand, unavailable);

    await expect(gateway.registerAgentProviderPolicy(REGISTRATION)).rejects.toThrow(
      "Agent provider operations require the native runtime.",
    );
    await expect(gateway.currentAgentProviderPolicy({ provider: "codex" })).rejects.toThrow(
      "Agent provider operations require the native runtime.",
    );
    await expect(gateway.probeAgentProviderHealth(GENERATION)).rejects.toThrow(
      "Agent provider operations require the native runtime.",
    );
    await expect(gateway.updateAgentProvider(UPDATE)).rejects.toThrow(
      "Agent provider operations require the native runtime.",
    );
    expect(invokeCommand).not.toHaveBeenCalled();
  });
});
