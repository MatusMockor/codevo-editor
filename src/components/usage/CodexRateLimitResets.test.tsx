// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexRateLimitResetGateway } from "../../application/codexRateLimitResetGateway";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type { CodexRateLimitResetSnapshot } from "../../domain/codexRateLimitResets";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { settingsPagePropsFixture } from "../settings/pages/settingsPageTestSupport";
import type { SettingsAgentActivity, SettingsEnvironment } from "../settings/settingsPageProps";
import { CodexRateLimitResets } from "./CodexRateLimitResets";

function readyManagement(): AgentProviderManagementSurface {
  const base = unconfiguredAgentProviderManagement();
  return {
    ...base,
    providers: {
      ...base.providers,
      codex: {
        ...base.providers.codex,
        policy: { kind: "registered", providerGeneration: 7, settingsRevision: 2 },
        health: {
          kind: "ready",
          auth: { kind: "signedIn", label: null },
          installedVersion: "1.0.0",
          checkedAtEpochMs: 1,
          update: { kind: "current", installedVersion: "1.0.0" },
        },
      },
    },
    admissionAuthority: () => ({
      provider: "codex",
      revision: 2,
      disposition: { kind: "ready" },
      providerGeneration: 7,
    }),
  };
}

describe("CodexRateLimitResets", () => {
  let host: HTMLDivElement;
  let root: Root;
  let snapshot: CodexRateLimitResetSnapshot;
  let gateway: CodexRateLimitResetGateway;
  let activity: SettingsAgentActivity;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    snapshot = {
      accountIdentity: "private-account",
      pendingOperationId: null,
      availableCount: 2,
      history: [],
      historyTruncated: false,
    };
    gateway = {
      read: vi.fn(async () => snapshot),
      prepare: vi.fn(async () => ({ confirmationToken: "private-token" })),
      consume: vi.fn(async () => {
        snapshot = {
          ...snapshot,
          availableCount: 1,
          history: [{ operationId: "private-operation", usedAtEpochMs: Date.now() }],
        };
        return { outcome: "reset" } as const;
      }),
    };
    activity = {
      accountUsageSource: "local",
      accountUsage: { claudeCode: { kind: "idle" }, codex: { kind: "idle" } },
      threads: [],
      turnLog: null,
      refreshAccountUsage: vi.fn(async () => ({ kind: "refreshed" }) as const),
      unarchive: vi.fn(),
    };
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  async function render(overrides: Partial<SettingsEnvironment> = {}) {
    const { env } = settingsPagePropsFixture({
      env: {
        agentActivity: activity,
        codexRateLimitResetGateway: gateway,
        providerManagement: readyManagement(),
        ...overrides,
      },
    });
    await act(async () => root.render(<CodexRateLimitResets env={env} />));
  }
  function button(label: string) {
    const found = [...host.querySelectorAll("button")].find((node) => node.textContent === label);
    expect(found).toBeDefined();
    return found!;
  }

  it("spends a reset only after a separate explicit confirmation and shows bounded local history", async () => {
    await render();
    expect(host.textContent).toContain("Available resets: 2");
    expect(host.textContent).toContain("Only resets recorded through Codevo");
    await act(async () => button("Use reset").click());
    expect(gateway.prepare).toHaveBeenCalledOnce();
    expect(gateway.consume).not.toHaveBeenCalled();
    expect(host.textContent).toContain("cannot be undone");
    await act(async () => button("Confirm · use 1 reset").click());
    expect(gateway.consume).toHaveBeenCalledOnce();
    expect(activity.refreshAccountUsage).toHaveBeenCalledWith("codex");
    expect(host.textContent).toContain("Available resets: 1");
    expect(host.textContent).toContain("1 reset used");
    expect(host.innerHTML).not.toContain("private-");
  });
  it("lets confirmation be canceled without spending a credit", async () => {
    await render();
    await act(async () => button("Use reset").click());
    await act(async () => button("Cancel").click());
    expect(gateway.consume).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="Confirm Codex limit reset"]')).toBeNull();
  });
  it.each([null, 0])("disables reset when availability is %s", async (availableCount) => {
    snapshot = { ...snapshot, availableCount };
    await render();
    expect(button("Use reset").disabled).toBe(true);
    expect(gateway.prepare).not.toHaveBeenCalled();
  });
  it("does not read or display the local account while remote limits are selected", async () => {
    await render({ agentActivity: { ...activity, accountUsageSource: "remote" } });
    expect(host.innerHTML).toBe("");
    expect(gateway.read).not.toHaveBeenCalled();
  });
  it("does not read or enable reset before provider registration is ready", async () => {
    await render({ providerManagement: unconfiguredAgentProviderManagement() });
    expect(button("Use reset").disabled).toBe(true);
    expect(gateway.read).not.toHaveBeenCalled();
  });
  it("reports an unknown consume result without enabling a new reset", async () => {
    gateway.consume = vi.fn(async () => {
      throw new Error("network lost");
    });
    await render();
    await act(async () => button("Use reset").click());
    await act(async () => button("Confirm · use 1 reset").click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("result is unknown");
    expect(button("Use reset").disabled).toBe(true);
    expect(button("Check reset status").disabled).toBe(false);
  });
});
