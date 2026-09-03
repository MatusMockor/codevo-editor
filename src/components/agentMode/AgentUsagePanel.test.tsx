// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentThread } from "../../domain/agentThread";
import { AgentUsagePanel } from "./AgentUsagePanel";

const NOW = new Date(2026, 7, 28, 12, 0, 0, 0).getTime();

describe("AgentUsagePanel", () => {
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

  it("renders saved-thread metrics with explicit CLI sources and no cost claim", () => {
    render([thread("claudeCode", "project-a", 5, 7), thread("codex", "project-b", 11, 13)]);

    expect(host.querySelector('[aria-label="Usage"]')).not.toBeNull();
    expect(host.textContent).toContain("Saved threads");
    expect(host.textContent).toContain("Claude Code stream-json result");
    expect(host.textContent).toContain("Codex JSONL turn.completed");
    expect(host.textContent).toContain("Project Alpha");
    expect(host.textContent).toContain("Output received by Codevo");
    expect(host.textContent).toContain("Unavailable for these saved turns");
    expect(host.textContent).toContain("Older saved turns may not include this measurement");
    expect(host.textContent?.toLowerCase()).not.toContain("cost");
  });

  it("renders provider account limits separately from local token activity", () => {
    act(() =>
      root.render(
        <AgentUsagePanel
          accountUsage={{
            claudeCode: {
              kind: "ready",
              snapshot: {
                provider: "claudeCode",
                fetchedAtEpochMs: NOW,
                windows: [
                  {
                    id: "claude-session",
                    label: "Current session",
                    usedPercent: 6,
                    windowDurationMinutes: null,
                    resetsAtEpochMs: null,
                    resetsLabel: "Sep 2 at 10:40pm",
                  },
                ],
              },
            },
            codex: {
              kind: "ready",
              snapshot: {
                provider: "codex",
                fetchedAtEpochMs: NOW,
                windows: [
                  {
                    id: "codex-weekly",
                    label: "Codex · Weekly limit",
                    usedPercent: 11,
                    windowDurationMinutes: 10_080,
                    resetsAtEpochMs: NOW + 60_000,
                    resetsLabel: null,
                  },
                ],
              },
            },
          }}
          nowEpochMs={NOW}
          projectLabels={new Map()}
          threads={[]}
        />,
      ),
    );

    expect(host.textContent).toContain("Subscription limits");
    expect(
      [...host.querySelectorAll(".agent-usage-panel__limit-provider")].map((element) =>
        element.getAttribute("aria-label"),
      ),
    ).toEqual(["Codex subscription limits", "Claude Code subscription limits"]);
    expect(host.textContent).toContain("Claude CodeUpdated just now");
    expect(host.textContent).toContain("Current session6%Resets Sep 2 at 10:40pm");
    expect(host.textContent).toContain("Codex · Weekly limit11%Resets in 1m");
    expect(host.textContent).toContain("Local activity");
    expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(2);
  });

  it("keeps empty local activity quiet and technical details collapsed", () => {
    render([]);

    expect(host.textContent).toContain("No saved turns in this period.");
    expect(host.textContent).not.toContain("0 started");
    expect(host.querySelector("details")).toBeNull();

    render([thread("claudeCode", "project-a", 5, 7)]);
    const details = host.querySelector<HTMLDetailsElement>("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
  });

  it("switches periods accessibly and excludes turns outside the selected window", () => {
    const old = thread("claudeCode", "project-a", 1, 2, NOW - 10 * 24 * 60 * 60 * 1_000);
    render([thread("claudeCode", "project-a", 5, 7), old]);

    const today = periodButton("Today");
    const thirtyDays = periodButton("30 days");
    expect(today.getAttribute("aria-selected")).toBe("true");
    expect(host.textContent).toContain("1 started");

    act(() => thirtyDays.click());
    expect(thirtyDays.getAttribute("aria-selected")).toBe("true");
    expect(host.textContent).toContain("2 started");
  });

  it("moves and activates period tabs with arrow, Home, and End keys", () => {
    render([thread("claudeCode", "project-a", 5, 7)]);
    const today = periodButton("Today");
    const sevenDays = periodButton("7 days");
    const thirtyDays = periodButton("30 days");

    act(() => today.dispatchEvent(key("ArrowLeft")));
    expect(thirtyDays.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(thirtyDays);

    act(() => thirtyDays.dispatchEvent(key("ArrowRight")));
    expect(today.getAttribute("aria-selected")).toBe("true");

    act(() => today.dispatchEvent(key("End")));
    expect(thirtyDays.getAttribute("aria-selected")).toBe("true");

    act(() => thirtyDays.dispatchEvent(key("Home")));
    expect(today.getAttribute("aria-selected")).toBe("true");
    expect(sevenDays.getAttribute("aria-selected")).toBe("false");
  });

  it("reports incomplete saved history and token coverage without inventing zero usage", () => {
    render([{ ...thread("claudeCode", "project-a", null, null), turnsTruncated: true }]);

    expect(host.textContent).toContain("Saved history is incomplete");
    expect(host.textContent).toContain("0 of 1 turns reported CLI usage");
    expect(host.textContent).not.toContain("0 input tokens");
  });

  it("shows known output received by Codevo with measured and complete coverage", () => {
    const measured = thread("claudeCode", "project-a", 5, 7);
    const legacy = thread("claudeCode", "project-a", null, null, NOW - 4_000);
    render([
      {
        ...measured,
        turns: measured.turns.map((turn) => ({
          ...turn,
          streamMetrics: { receivedUtf8Bytes: 12, complete: false },
        })),
      },
      legacy,
    ]);

    expect(host.textContent).toContain("Output received by Codevo: 12 B");
    expect(host.textContent).toContain("1 of 2 turns measured; 0 complete");
    expect(host.textContent).toContain("output coverage is incomplete");
    expect(host.textContent).not.toContain("Streamed output bytes");
  });

  function render(threads: ReadonlyArray<AgentThread>): void {
    act(() =>
      root.render(
        <AgentUsagePanel
          nowEpochMs={NOW}
          projectLabels={
            new Map([
              ["project-a", "Project Alpha"],
              ["project-b", "Project Beta"],
            ])
          }
          threads={threads}
        />,
      ),
    );
  }

  function periodButton(label: string): HTMLButtonElement {
    const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(button).not.toBeNull();
    return button ?? document.createElement("button");
  }

  function key(value: string): KeyboardEvent {
    return new KeyboardEvent("keydown", { bubbles: true, key: value });
  }
});

function thread(
  provider: AgentThread["provider"]["kind"],
  rootKey: string,
  inputTokens: number | null,
  outputTokens: number | null,
  startedAtEpochMs = NOW - 5_000,
): AgentThread {
  const usage =
    inputTokens === null || outputTokens === null ? null : { inputTokens, outputTokens };
  return {
    threadId: `agt-${provider}-${rootKey}-${startedAtEpochMs}`.toLowerCase(),
    owner: { rootKey, ownerId: `owner-${rootKey}`, repositoryRoot: `/repo/${rootKey}` },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: provider, sessionId: null },
    title: rootKey,
    pinned: false,
    archived: false,
    createdAtEpochMs: startedAtEpochMs,
    updatedAtEpochMs: startedAtEpochMs + 1_000,
    turns: [
      {
        turnId: `turn-${startedAtEpochMs}`,
        prompt: "test",
        status: { kind: "exited", exitCode: 0 },
        startedAtEpochMs,
        endedAtEpochMs: startedAtEpochMs + 1_000,
        events: [{ kind: "result", text: "done", isError: false, usage }],
        eventsTruncated: false,
        lastStatusSequence: 1,
        lastOutputSequence: 1,
        launch: null,
        cliVersion: null,
      },
    ],
    turnsTruncated: false,
    integration: null,
    viewedAtEpochMs: null,
    externalOrigin: null,
  };
}
