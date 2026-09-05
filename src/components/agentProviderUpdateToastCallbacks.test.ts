import { describe, expect, it, vi } from "vitest";
import type { AgentProviderUpdateState } from "../domain/agentProviderHealth";
import type { AgentCliKind } from "../domain/agentSettings";
import { unconfiguredAgentProviderManagement } from "../test/agentProviderManagementFixture";
import {
  createAgentProviderUpdateToastCallbacks,
  type AgentProviderUpdateToastPort,
} from "./agentProviderUpdateToastCallbacks";
import { createAgentProviderUpdateToastView } from "./agentProviderUpdateToastPresenter";

const CODEX = createAgentProviderUpdateToastView("codex", "0.153.4")!;
const CLAUDE = createAgentProviderUpdateToastView("claudeCode", "2.1.0")!;

describe("agent provider update toast callbacks", () => {
  it("persists the merged dismissal for every provider before dismissing locally", async () => {
    const port = portWith({
      dismissUpdate: vi.fn<Port["dismissUpdate"]>(async (provider) => provider === "codex"),
    });
    const callbacks = createAgentProviderUpdateToastCallbacks(dependencies(port));

    await expect(callbacks.onDismissAll([CODEX, CLAUDE])).resolves.toBe(true);

    expect(port.dismissUpdate).toHaveBeenCalledWith("codex", "0.153.4");
    expect(port.dismissUpdate).toHaveBeenCalledWith("claudeCode", "2.1.0");
    expect(port.save).toHaveBeenCalledTimes(1);
    expect(port.save).toHaveBeenCalledWith({
      provider: "claudeCode",
      preference: expect.objectContaining({ dismissedUpdateVersion: "2.1.0" }),
    });
    expect(port.dismissToast).not.toHaveBeenCalled();
  });

  it("falls back to a local toast dismissal only when nothing could be persisted", async () => {
    const port = portWith({
      authority: () => null,
      dismissUpdate: vi.fn<Port["dismissUpdate"]>(async () => false),
    });
    const callbacks = createAgentProviderUpdateToastCallbacks(dependencies(port));

    await expect(callbacks.onDismissAll([CODEX, CLAUDE])).resolves.toBe(true);

    expect(port.save).not.toHaveBeenCalled();
    expect(port.dismissToast).toHaveBeenCalledOnce();
  });

  it("stops update-all as soon as a provider does not end in a succeeded state", async () => {
    const states: Record<AgentCliKind, AgentProviderUpdateState> = {
      claudeCode: { kind: "idle" },
      codex: { kind: "idle" },
    };
    const port = portWith({
      update: vi.fn<Port["update"]>(async (provider) => {
        states[provider] =
          provider === "codex"
            ? { kind: "failed", reason: "exited", outputTail: "", outputTruncated: false }
            : { kind: "succeeded", previousVersion: "2.0.0", installedVersion: "2.1.0" };
        return null;
      }),
    });
    const readManagement = () => ({
      ...port,
      providers: {
        claudeCode: { ...port.providers.claudeCode, updateState: states.claudeCode },
        codex: { ...port.providers.codex, updateState: states.codex },
      },
    });
    const callbacks = createAgentProviderUpdateToastCallbacks({
      ...dependencies(port),
      readManagement,
    });

    await callbacks.onUpdateAll([CODEX, CLAUDE]);
    expect(port.update).toHaveBeenCalledTimes(1);
    expect(port.update).toHaveBeenCalledWith("codex", "0.153.4");

    port.update.mockClear();
    await callbacks.onUpdateAll([CLAUDE, CODEX]);
    expect(port.update.mock.calls).toEqual([
      ["claudeCode", "2.1.0"],
      ["codex", "0.153.4"],
    ]);
  });

  it("reports refusals instead of treating them as a started update", async () => {
    const port = portWith({ update: vi.fn<Port["update"]>(async () => "turnActive") });
    const onUpdateRefused = vi.fn();
    const callbacks = createAgentProviderUpdateToastCallbacks({
      ...dependencies(port),
      onUpdateRefused,
    });

    await expect(callbacks.onUpdate("codex", CODEX.availableVersion)).resolves.toBe(false);
    expect(onUpdateRefused).toHaveBeenCalledWith({
      provider: "codex",
      version: "0.153.4",
      refusal: "turnActive",
    });

    await callbacks.onUpdateAll([CODEX, CLAUDE]);
    expect(port.update).toHaveBeenCalledTimes(2);
  });

  it("clears the surface toast before opening settings", () => {
    const port = portWith({});
    const onOpenAgentSettings = vi.fn();
    const callbacks = createAgentProviderUpdateToastCallbacks({
      ...dependencies(port),
      onOpenAgentSettings,
    });

    callbacks.onOpenSettings();

    expect(port.dismissToast).toHaveBeenCalledOnce();
    expect(onOpenAgentSettings).toHaveBeenCalledOnce();
    expect(port.dismissToast.mock.invocationCallOrder[0]).toBeLessThan(
      onOpenAgentSettings.mock.invocationCallOrder[0],
    );
  });
});

type Port = AgentProviderUpdateToastPort;

interface PortMocks {
  readonly authority?: Port["authority"];
  readonly dismissUpdate?: ReturnType<typeof vi.fn<Port["dismissUpdate"]>>;
  readonly save?: ReturnType<typeof vi.fn<Port["save"]>>;
  readonly update?: ReturnType<typeof vi.fn<Port["update"]>>;
}

function portWith(mocks: PortMocks) {
  return {
    ...unconfiguredAgentProviderManagement(),
    authority: mocks.authority ?? registeredAuthority,
    dismissToast: vi.fn(),
    dismissUpdate: mocks.dismissUpdate ?? vi.fn<Port["dismissUpdate"]>(async () => true),
    save: mocks.save ?? vi.fn<Port["save"]>(async () => true),
    update: mocks.update ?? vi.fn<Port["update"]>(async () => null),
  };
}

function registeredAuthority(provider: AgentCliKind) {
  return {
    provider,
    settingsRevision: 1,
    preference: {
      enabled: true,
      healthCheckIntervalSeconds: 300,
      checkForUpdates: true,
      dismissedUpdateVersion: null,
    },
    cliPath: null,
  };
}

function dependencies(port: Port) {
  return {
    copyText: vi.fn(),
    onOpenAgentSettings: vi.fn(),
    onUpdateRefused: vi.fn(),
    readManagement: () => port,
  };
}
