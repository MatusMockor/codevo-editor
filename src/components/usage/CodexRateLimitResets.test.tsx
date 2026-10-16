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

const DAY_MS = 86_400_000;

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
    const now = Date.now();
    snapshot = {
      accountIdentity: "private-account",
      pendingOperationId: null,
      availableCount: 3,
      credits: [
        credit("credit-later", "Later reset", now + 21 * DAY_MS),
        credit("credit-forever", "Forever reset", null),
        credit("credit-soon", "Soon reset", now + 13 * DAY_MS),
      ],
      history: [],
      historyTruncated: false,
    };
    gateway = {
      read: vi.fn(async () => snapshot),
      prepare: vi.fn(async () => ({ confirmationToken: "private-token" })),
      consume: vi.fn(async () => {
        snapshot = {
          ...snapshot,
          availableCount: 2,
          credits: snapshot.credits?.filter((entry) => entry.id !== "credit-later") ?? null,
          history: [
            {
              operationId: "private-operation",
              usedAtEpochMs: Date.now(),
              creditTitle: "Later reset",
            },
          ],
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
  function credit(id: string, title: string | null, expiresAtEpochMs: number | null) {
    return {
      id,
      title,
      description: `${title ?? "Reset"} details`,
      grantedAtEpochMs: 1,
      expiresAtEpochMs,
    };
  }
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
  function buttons(label: string) {
    return [...host.querySelectorAll("button")].filter((node) => node.textContent === label);
  }
  function button(label: string) {
    const found = buttons(label)[0];
    expect(found).toBeDefined();
    return found!;
  }
  function items() {
    return [...host.querySelectorAll(".cv-codex-resets__list > li")];
  }
  function confirmation() {
    return host.querySelector('[role="group"][aria-label="Confirm Codex limit reset"]');
  }
  async function showHistory() {
    const tab = [...host.querySelectorAll('[role="radio"]')].find(
      (node) => node.textContent === "History",
    ) as HTMLButtonElement | undefined;
    expect(tab).toBeDefined();
    await act(async () => tab!.click());
  }

  it("lists credits by soonest expiry with their expiry labels", async () => {
    await render();
    expect(host.textContent).toContain("Limit resets");
    expect(host.textContent).not.toContain("Local Codex account");
    expect(host.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe(
      "Available 3",
    );
    expect(
      items().map((item) => item.querySelector(".cv-codex-resets__name")?.textContent),
    ).toEqual(["Soon reset", "Later reset", "Forever reset"]);
    expect(items()[0]?.textContent).toContain("Expires");
    expect(items()[0]?.querySelector("time")?.getAttribute("dateTime")).toMatch(/Z$/);
    expect(items()[0]?.getAttribute("title")).toBe("Soon reset details");
    expect(items()[2]?.textContent).toContain("Doesn't expire");
    expect(buttons("Use reset").every((node) => !node.disabled)).toBe(true);
    expect(host.querySelector('button[aria-label="Check resets again"]')).not.toBeNull();
  });
  it("confirms the chosen credit inline and cancels without spending it", async () => {
    await render();
    await act(async () => buttons("Use reset")[1]!.click());
    expect(gateway.prepare).toHaveBeenCalledOnce();
    expect(gateway.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ creditId: "credit-later" }),
    );
    expect(gateway.consume).not.toHaveBeenCalled();
    expect(items()[1]?.querySelector('[aria-label="Confirm Codex limit reset"]')).not.toBeNull();
    expect(confirmation()?.textContent).toContain("Use this Later reset now?");
    expect(confirmation()?.textContent).toContain("This can't be undone.");
    expect(document.activeElement?.textContent).toBe("Cancel");
    const others = buttons("Use reset").filter((node) => !confirmation()?.contains(node));
    expect(others).toHaveLength(2);
    expect(others.every((node) => node.disabled)).toBe(true);
    await act(async () => button("Cancel").click());
    expect(gateway.consume).not.toHaveBeenCalled();
    expect(confirmation()).toBeNull();
    expect(items()).toHaveLength(3);
    expect(buttons("Use reset").every((node) => !node.disabled)).toBe(true);
  });
  it("spends the credit only after the explicit confirmation", async () => {
    await render();
    await act(async () => buttons("Use reset")[1]!.click());
    const confirm = [...(confirmation()?.querySelectorAll("button") ?? [])].find(
      (node) => node.textContent === "Use reset",
    );
    await act(async () => confirm!.click());
    expect(gateway.consume).toHaveBeenCalledOnce();
    expect(activity.refreshAccountUsage).toHaveBeenCalledWith("codex");
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Codex usage limits were reset.",
    );
    expect(host.querySelector('[role="radio"]')?.textContent).toBe("Available 2");
    expect(items()).toHaveLength(2);
    await showHistory();
    expect(items()[0]?.textContent).toContain("Later reset");
    expect(items()[0]?.textContent).toContain("Used today");
    expect(host.innerHTML).not.toContain("private-");
  });
  it("uses a count-only row and lets Codex pick the credit when details are missing", async () => {
    snapshot = { ...snapshot, availableCount: 2, credits: null };
    await render();
    expect(items()).toHaveLength(1);
    expect(items()[0]?.textContent).toContain("2 resets available");
    expect(items()[0]?.textContent).toContain("Expiry dates unavailable");
    await act(async () => button("Use reset").click());
    expect(gateway.prepare).toHaveBeenCalledWith(expect.objectContaining({ creditId: null }));
    expect(items()[0]?.querySelector('[aria-label="Confirm Codex limit reset"]')).not.toBeNull();
    expect(confirmation()?.textContent).toContain("Use a limit reset now?");
  });
  it("words the count-only confirmation as a retry when Codex reports a pending reset", async () => {
    snapshot = { ...snapshot, availableCount: 2, credits: null };
    await render();
    snapshot = { ...snapshot, pendingOperationId: "private-pending" };
    await act(async () => button("Use reset").click());
    expect(gateway.prepare).toHaveBeenCalledWith(expect.objectContaining({ creditId: null }));
    expect(confirmation()?.textContent).toContain("Check the result of the last reset?");
    expect(confirmation()?.textContent).not.toContain("Use a limit reset now?");
    expect(button("Retry reset").disabled).toBe(false);
    expect(host.innerHTML).not.toContain("private-");
  });
  it("says how many reported resets came without details", async () => {
    snapshot = { ...snapshot, availableCount: 4 };
    await render();
    expect(host.textContent).toContain("1 more reset available - Codex didn't send its details.");
  });
  it.each([
    [null, "This account does not provide reset availability."],
    [0, "No resets available."],
  ])("shows no reset action when availability is %s", async (availableCount, message) => {
    snapshot = { ...snapshot, availableCount, credits: availableCount === null ? null : [] };
    await render();
    expect(host.textContent).toContain(message);
    expect(buttons("Use reset")).toHaveLength(0);
    expect(gateway.prepare).not.toHaveBeenCalled();
  });
  it("lists Codevo history newest first and explains its scope", async () => {
    snapshot = {
      ...snapshot,
      history: [
        { operationId: "op-old", usedAtEpochMs: Date.now() - 3 * DAY_MS, creditTitle: "Old reset" },
        { operationId: "op-new", usedAtEpochMs: Date.now() - 60_000, creditTitle: null },
      ],
      historyTruncated: true,
    };
    await render();
    await showHistory();
    expect(
      items().map((item) => item.querySelector(".cv-codex-resets__name")?.textContent),
    ).toEqual(["Limit reset", "Old reset"]);
    expect(buttons("Use reset")).toHaveLength(0);
    expect(host.textContent).toContain("Only resets used through Codevo are listed.");
    expect(host.textContent).toContain("Older Codevo reset records are no longer retained.");
  });
  it("shows an empty Codevo history", async () => {
    await render();
    await showHistory();
    expect(items()).toHaveLength(0);
    expect(host.textContent).toContain("No resets used through Codevo yet.");
    expect(host.textContent).not.toContain("no longer retained");
  });
  it("does not read or display the local account while remote limits are selected", async () => {
    await render({ agentActivity: { ...activity, accountUsageSource: "remote" } });
    expect(host.innerHTML).toBe("");
    expect(gateway.read).not.toHaveBeenCalled();
  });
  it("does not read or offer a reset before provider registration is ready", async () => {
    await render({ providerManagement: unconfiguredAgentProviderManagement() });
    expect(host.textContent).toContain(
      "Sign in and wait for the local Codex provider to be ready to view resets.",
    );
    expect(buttons("Use reset")).toHaveLength(0);
    expect(
      host.querySelector<HTMLButtonElement>('button[aria-label="Check resets again"]')?.disabled,
    ).toBe(true);
    expect(gateway.read).not.toHaveBeenCalled();
  });
  async function loseConsumeReceipt() {
    gateway.consume = vi.fn(async () => {
      throw new Error("network lost");
    });
    await render();
    await act(async () => buttons("Use reset")[0]!.click());
    const confirm = [...(confirmation()?.querySelectorAll("button") ?? [])].find(
      (node) => node.textContent === "Use reset",
    );
    await act(async () => confirm!.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("result is unknown");
    expect(buttons("Use reset").every((node) => node.disabled)).toBe(true);
    expect(button("Check reset status").disabled).toBe(false);
    return vi.mocked(gateway.consume).mock.calls[0]![0].idempotencyKey;
  }
  it("reports an unknown consume result and settles it when it never went through", async () => {
    await loseConsumeReceipt();
    await act(async () => button("Check reset status").click());
    expect(gateway.prepare).toHaveBeenCalledOnce();
    expect(gateway.consume).toHaveBeenCalledOnce();
    expect(confirmation()).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Codevo has no record that the last reset went through. Check your usage limits above.",
    );
    expect(buttons("Use reset").every((node) => !node.disabled)).toBe(true);
  });
  it("settles an unknown consume result that Codevo recorded as used", async () => {
    const key = await loseConsumeReceipt();
    snapshot = {
      ...snapshot,
      availableCount: 2,
      credits: snapshot.credits?.filter((entry) => entry.id !== "credit-soon") ?? null,
      history: [{ operationId: key, usedAtEpochMs: Date.now(), creditTitle: "Soon reset" }],
    };
    await act(async () => button("Check reset status").click());
    expect(gateway.prepare).toHaveBeenCalledOnce();
    expect(gateway.consume).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Codex usage limits were reset.",
    );
    expect(activity.refreshAccountUsage).toHaveBeenCalledWith("codex");
    expect(items()).toHaveLength(2);
    expect(host.innerHTML).not.toContain(key);
  });
  it.each([
    [0, [] as const],
    [null, null],
  ])(
    "completes a retry of an unknown reset when availability is %s",
    async (availableCount, credits) => {
      snapshot = { ...snapshot, pendingOperationId: "private-pending", availableCount, credits };
      gateway.consume = vi.fn(async () => {
        snapshot = { ...snapshot, pendingOperationId: null };
        return { outcome: "alreadyRedeemed" } as const;
      });
      await render();
      await showHistory();
      expect(host.querySelector('[role="alert"]')?.textContent).toContain("result is unknown");
      await act(async () => button("Check reset status").click());
      expect(gateway.prepare).toHaveBeenLastCalledWith(expect.objectContaining({ creditId: null }));
      expect(host.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe(
        availableCount === null ? "Available" : "Available 0",
      );
      expect(confirmation()?.textContent).toContain("Check the result of the last reset?");
      expect(confirmation()?.textContent).toContain("No additional credit is used");
      expect(document.activeElement?.textContent).toBe("Cancel");
      await act(async () => button("Cancel").click());
      expect(confirmation()).toBeNull();
      expect(gateway.consume).not.toHaveBeenCalled();
      expect(button("Check reset status").disabled).toBe(false);
      await act(async () => button("Check reset status").click());
      expect(gateway.prepare).toHaveBeenCalledTimes(2);
      await act(async () => button("Retry reset").click());
      expect(gateway.consume).toHaveBeenCalledOnce();
      expect(confirmation()).toBeNull();
      expect(host.querySelector('[role="status"]')?.textContent).toBe(
        "This reset was already applied. No additional credit was used.",
      );
      expect(host.innerHTML).not.toContain("private-");
    },
  );
});
