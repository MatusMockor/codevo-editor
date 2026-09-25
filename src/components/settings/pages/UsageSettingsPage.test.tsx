// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../../application/agentThreadPorts";
import type { AgentAccountUsageWindow } from "../../../domain/agentAccountUsage";
import type { AgentProjectDescriptor } from "../../../domain/agentProject";
import type { AgentThread } from "../../../domain/agentThread";
import type { SettingsAgentActivity } from "../settingsPageProps";
import { UsagePageActions, UsageSettingsPage } from "./UsageSettingsPage";
import { settingsPagePropsFixture } from "./settingsPageTestSupport";

const HOUR = 3_600_000;

function limitWindow(overrides: Partial<AgentAccountUsageWindow>): AgentAccountUsageWindow {
  return {
    id: "five_hour",
    label: "5-hour limit",
    usedPercent: 38,
    windowDurationMinutes: 300,
    resetsAtEpochMs: null,
    resetsLabel: "8pm",
    ...overrides,
  };
}

function savedThread(
  provider: AgentThread["provider"]["kind"],
  rootKey: string,
  turnCount: number,
): AgentThreadView {
  const startedAtEpochMs = Date.now() - 60_000;
  const thread: AgentThread = {
    threadId: `agt-${provider}-${rootKey}`.replace(/[^a-z0-9-]/giu, "-").toLowerCase(),
    owner: { rootKey, ownerId: `owner-${rootKey}`, repositoryRoot: rootKey },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: provider, sessionId: null },
    title: rootKey,
    pinned: false,
    archived: false,
    createdAtEpochMs: startedAtEpochMs,
    updatedAtEpochMs: startedAtEpochMs + 1_000,
    turns: Array.from({ length: turnCount }, (_, index) => ({
      turnId: `turn-${index}`,
      prompt: "test",
      status: { kind: "exited", exitCode: 0 } as const,
      startedAtEpochMs: startedAtEpochMs + index,
      endedAtEpochMs: startedAtEpochMs + index + 1_000,
      events: [
        {
          kind: "result" as const,
          text: "done",
          isError: false,
          usage: { inputTokens: 5, outputTokens: 7, contextTokens: 5 },
        },
      ],
      eventsTruncated: false,
      lastStatusSequence: 1,
      lastOutputSequence: 1,
      launch: null,
      cliVersion: null,
    })),
    turnsTruncated: false,
    integration: null,
    viewedAtEpochMs: null,
    externalOrigin: null,
  };
  return { thread, repositoryLabel: rootKey.split("/").pop() ?? rootKey } as AgentThreadView;
}

function project(rootKey: string, label: string): AgentProjectDescriptor {
  return { rootKey, label } as AgentProjectDescriptor;
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("UsageSettingsPage", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function activity(overrides: Partial<SettingsAgentActivity> = {}): SettingsAgentActivity {
    return {
      threads: [],
      accountUsage: {
        claudeCode: {
          kind: "ready",
          snapshot: {
            provider: "claudeCode",
            fetchedAtEpochMs: Date.now(),
            windows: [
              limitWindow({}),
              limitWindow({
                id: "seven_day",
                label: "Weekly limit",
                usedPercent: 92,
                windowDurationMinutes: 10_080,
                resetsLabel: "Sep 28",
              }),
            ],
          },
        },
        codex: { kind: "idle" },
      },
      turnLog: null,
      refreshAccountUsage: vi.fn(async () => ({ kind: "refreshed" }) as const),
      unarchive: vi.fn(),
      ...overrides,
    };
  }

  function render(
    agentActivity: SettingsAgentActivity | null,
    agentProjects: ReadonlyArray<AgentProjectDescriptor> = [],
  ) {
    const props = settingsPagePropsFixture({ env: { agentActivity, agentProjects } });
    act(() => root.render(<UsageSettingsPage {...props} />));
  }

  function sectionText(title: string): string {
    const section = [...host.querySelectorAll("section")].find(
      (node) => node.querySelector(".settings-section__title")?.textContent === title,
    );
    expect(section).toBeDefined();
    return section?.textContent ?? "";
  }

  it("renders one limits section per provider with bars or a reason", () => {
    render(activity());
    const titles = [...host.querySelectorAll(".settings-section__title")].map(
      (node) => node.textContent,
    );
    expect(titles).toEqual(["Claude Code", "Codex", "Local activity"]);
    expect(host.querySelectorAll(".cv-usage-bar").length).toBe(2);
    expect(host.querySelector('.cv-usage-bar__fill[data-hot="true"]')).not.toBeNull();
    expect(sectionText("Codex")).toContain("Available after the next provider turn.");
  });

  it("draws Claude windows without a reset time and without a pace line", () => {
    render(activity());
    expect(host.querySelector(".cv-usage-bar__pace")).toBeNull();
    expect(sectionText("Claude Code")).toContain("Resets 8pm");
    expect(sectionText("Claude Code")).toContain("Resets Sep 28");
    expect(host.querySelector(".cv-usage-bar")?.getAttribute("aria-label")).toBe(
      "5-hour limit: 38% used, resets 8pm",
    );
  });

  it("draws a pace line only for windows with a known reset time", () => {
    const now = Date.now();
    render(
      activity({
        accountUsage: {
          claudeCode: { kind: "idle" },
          codex: {
            kind: "ready",
            snapshot: {
              provider: "codex",
              fetchedAtEpochMs: now,
              windows: [
                limitWindow({ id: "primary", usedPercent: 0, resetsAtEpochMs: now + 2 * HOUR }),
                limitWindow({ id: "secondary", usedPercent: 100, resetsLabel: null }),
              ],
            },
          },
        },
      }),
    );
    const fills = [...host.querySelectorAll<HTMLElement>(".cv-usage-bar__fill")];
    expect(fills.map((fill) => fill.style.width)).toEqual(["0%", "100%"]);
    expect(fills.map((fill) => fill.dataset.hot ?? null)).toEqual([null, "true"]);
    expect(host.querySelectorAll(".cv-usage-bar__pace").length).toBe(1);
    expect(sectionText("Codex")).toContain("Reset unavailable");
  });

  it.each([
    [{ kind: "idle" } as const, "Available after the next provider turn."],
    [{ kind: "loading" } as const, "Updating…"],
    [{ kind: "unavailable" } as const, "No limits reported by the latest turn."],
    [
      {
        kind: "ready",
        snapshot: { provider: "codex", fetchedAtEpochMs: 1, windows: [] },
      } as const,
      "The provider reported no limit windows.",
    ],
  ])("says why a provider in state %j has no bars", (state, reason) => {
    render(activity({ accountUsage: { claudeCode: { kind: "idle" }, codex: state } }));
    expect(sectionText("Codex")).toContain(reason);
    expect(host.querySelectorAll(".cv-usage-bar").length).toBe(0);
  });

  it("lists every reported window", () => {
    const windows = Array.from({ length: 12 }, (_, index) =>
      limitWindow({ id: `window-${index}`, label: `Limit ${index}` }),
    );
    render(
      activity({
        accountUsage: {
          claudeCode: {
            kind: "ready",
            snapshot: { provider: "claudeCode", fetchedAtEpochMs: Date.now(), windows },
          },
          codex: { kind: "idle" },
        },
      }),
    );
    expect(host.querySelectorAll(".cv-usage-bar").length).toBe(12);
  });

  it("shows empty local activity without inventing numbers", () => {
    render(activity());
    const local = sectionText("Local activity");
    expect(local).toContain("Estimated cost—");
    expect(local).toContain("Processed tokens—");
    expect(local).toContain("Completed turns0");
    expect(local).toContain("Saved threads and turns on this device, not subscription billing.");
  });

  it("explains when agent data is not loaded and keeps the search anchors", () => {
    render(null);
    expect(host.textContent).toContain("Usage appears after agent mode has loaded.");
    expect(
      [...host.querySelectorAll("[data-settings-row]")].map((node) =>
        node.getAttribute("data-settings-row"),
      ),
    ).toEqual(["usage.limits", "usage.localActivity"]);
    expect(host.querySelectorAll(".cv-usage-bar").length).toBe(0);
  });

  it("refreshes both providers from the top bar action", async () => {
    const refreshAccountUsage = vi.fn(async () => ({ kind: "refreshed" }) as const);
    const { env } = settingsPagePropsFixture({
      env: { agentActivity: activity({ refreshAccountUsage }) },
    });
    act(() => root.render(<UsagePageActions env={env} />));
    expect(host.textContent).toContain("Updated just now");
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[aria-label="Refresh usage"]')?.click(),
    );
    expect(refreshAccountUsage.mock.calls).toEqual([["claudeCode"], ["codex"]]);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("reports a failed refresh and clears it after a successful retry", async () => {
    const refreshAccountUsage = vi.fn(
      async (provider: "claudeCode" | "codex") =>
        (provider === "codex" ? { kind: "failed" } : { kind: "refreshed" }) as
          { readonly kind: "failed" } | { readonly kind: "refreshed" },
    );
    const { env } = settingsPagePropsFixture({
      env: { agentActivity: activity({ refreshAccountUsage }) },
    });
    act(() => root.render(<UsagePageActions env={env} />));
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Refresh usage"]');
    await act(async () => button?.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not refresh Codex usage.",
    );
    refreshAccountUsage.mockImplementation(async () => ({ kind: "refreshed" }));
    await act(async () => button?.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("says which providers are not ready to refresh", async () => {
    const refreshAccountUsage = vi.fn(async () => ({ kind: "unavailable" }) as const);
    const { env } = settingsPagePropsFixture({
      env: { agentActivity: activity({ refreshAccountUsage }) },
    });
    act(() => root.render(<UsagePageActions env={env} />));
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[aria-label="Refresh usage"]')?.click(),
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not refresh Claude Code and Codex usage. Sign in and try again.",
    );
  });

  it("ignores a stale failure from an earlier refresh and superseded results", async () => {
    const first = deferred<{ readonly kind: "failed" }>();
    const refreshAccountUsage = vi
      .fn<SettingsAgentActivity["refreshAccountUsage"]>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async () => ({ kind: "refreshed" }));
    const { env } = settingsPagePropsFixture({
      env: { agentActivity: activity({ refreshAccountUsage }) },
    });
    act(() => root.render(<UsagePageActions env={env} />));
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Refresh usage"]');
    await act(async () => button?.click());
    await act(async () => button?.click());
    await act(async () => {
      first.resolve({ kind: "failed" });
      await first.promise;
    });
    expect(host.querySelector('[role="alert"]')).toBeNull();

    refreshAccountUsage.mockImplementation(async () => ({ kind: "superseded" }));
    await act(async () => button?.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("drops a pending refresh failure after the action unmounts", async () => {
    const pending = deferred<{ readonly kind: "failed" }>();
    const refreshAccountUsage = vi.fn(() => pending.promise);
    const { env } = settingsPagePropsFixture({
      env: { agentActivity: activity({ refreshAccountUsage }) },
    });
    act(() => root.render(<UsagePageActions env={env} />));
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[aria-label="Refresh usage"]')?.click(),
    );
    act(() => root.render(<></>));
    await act(async () => {
      pending.resolve({ kind: "failed" });
      await pending.promise;
    });
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("breaks local activity down per project with project labels", () => {
    render(
      activity({
        threads: [
          savedThread("claudeCode", "/work/orders-api", 3),
          savedThread("codex", "/work/billing", 1),
        ],
      }),
      [project("/work/orders-api", "Orders API")],
    );
    const rows = [...host.querySelectorAll('[aria-label="Projects"] .settings-row')];
    expect(rows.map((row) => row.querySelector(".settings-row__title")?.textContent)).toEqual([
      "Orders API",
      "billing",
    ]);
    expect(rows[0]?.textContent).toContain("3 turns");
    expect(rows[0]?.textContent).toContain("36 tokens");
    expect(rows[1]?.textContent).toContain("1 turn");
    expect(host.textContent).not.toContain("more project");
  });

  it("caps the project breakdown and reveals the rest on request", () => {
    const threads = Array.from({ length: 8 }, (_, index) =>
      savedThread("codex", `/work/project-${index}`, 8 - index),
    );
    render(activity({ threads }));
    const rowsOf = () => [...host.querySelectorAll('[aria-label="Projects"] .settings-row')];
    expect(rowsOf()).toHaveLength(5);
    expect(rowsOf()[0]?.querySelector(".settings-row__title")?.textContent).toBe("project-0");
    const more = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Show 3 more projects",
    );
    expect(more).toBeDefined();
    act(() => more?.click());
    expect(rowsOf()).toHaveLength(8);
    expect(host.textContent).not.toContain("Show 3 more projects");
  });

  it("omits the project breakdown when there is no saved activity", () => {
    render(activity());
    expect(host.querySelector('[aria-label="Projects"]')).toBeNull();
  });

  it("renders no top bar action without agent data", () => {
    const { env } = settingsPagePropsFixture();
    act(() => root.render(<UsagePageActions env={env} />));
    expect(host.querySelector("button")).toBeNull();
  });
});
