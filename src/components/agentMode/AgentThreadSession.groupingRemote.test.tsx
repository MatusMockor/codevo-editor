// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentTurn, AgentTurnEvent, AgentTurnStatus } from "../../domain/agentThread";
import type { AgentCliKind } from "../../domain/agentTask";
import { AgentThreadSession } from "./AgentThreadSession";
import { waitForReact } from "../../test/reactTestLifecycle";

import {
  appendRemoteAgentTranscript,
  createRemoteAgentTranscript,
} from "../../domain/remoteAgentTranscript";
describe("remote grouped activity", () => {
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
  function render(
    events: readonly AgentTurnEvent[],
    status: AgentTurnStatus = { kind: "running" },
    prompt = "/compact",
    provider: AgentCliKind = "claudeCode",
  ) {
    const turn: AgentTurn = {
      turnId: "turn",
      prompt,
      status,
      events,
      startedAtEpochMs: Date.now() - 32000,
      endedAtEpochMs: null,
      eventsTruncated: false,
      lastStatusSequence: 0,
      lastOutputSequence: 0,
      launch: null,
      cliVersion: null,
    };
    const view: AgentThreadView = {
      thread: {
        threadId: "thread",
        owner: { rootKey: "/app", repositoryRoot: "/app", ownerId: "owner" },
        target: { isolation: "in-place", worktreePath: null },
        provider: { kind: provider, sessionId: "session" },
        title: "Compact",
        pinned: false,
        archived: false,
        createdAtEpochMs: 0,
        updatedAtEpochMs: 0,
        turns: [turn],
        turnsTruncated: false,
        integration: null,
        viewedAtEpochMs: null,
        externalOrigin: null,
      },
      ship: { kind: "idle", status: null, loadingStatus: false },
      editorAvailability: { kind: "available" },
      attention: "running",
      unread: false,
      lifecycle: "running",
      repositoryLabel: "app",
      projectOrigin: "active-tab",
      worktreeRemoved: false,
      worktreeMissing: false,
      changeSummary: null,
    };
    act(() =>
      root.render(
        <AgentThreadSession
          thread={view}
          composerRepositoryLabel="app"
          onReviewInDiff={() => {}}
        />,
      ),
    );
  }
  function remote(provider: "codex" | "claude", records: readonly object[]) {
    return appendRemoteAgentTranscript(
      createRemoteAgentTranscript("task", provider),
      [
        {
          taskId: "task",
          sequence: 1,
          type: "task.output",
          channel: "stdout",
          createdAt: "2026-09-17T12:00:00Z",
          text: records.map((record) => JSON.stringify(record) + "\n").join(""),
        },
      ],
      { complete: true, terminal: true },
    ).events;
  }
  it("groups replayed Linux Codex commands and reveals their real output", async () => {
    const events = remote(
      "codex",
      [1, 2, 3].map((id) => ({
        type: "item.completed",
        item: {
          id: `cmd-${id}`,
          type: "command_execution",
          command: `echo linux-${id}`,
          aggregated_output: `linux-${id}`,
          exit_code: 0,
          status: "completed",
        },
      })),
    );
    render(events, { kind: "exited", exitCode: 0 }, "Check server", "codex");
    const toggle = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Ran 3 commands"),
    );
    expect(toggle).toBeDefined();
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(
      host.querySelectorAll("button.agent-tool-row:not(.agent-activity-group__toggle)"),
    ).toHaveLength(0);
    await act(async () => toggle?.click());
    expect(
      host.querySelectorAll("button.agent-tool-row:not(.agent-activity-group__toggle)"),
    ).toHaveLength(3);
    await act(async () =>
      (
        host.querySelector(
          "button.agent-tool-row:not(.agent-activity-group__toggle)",
        ) as HTMLButtonElement
      ).click(),
    );
    expect(host.querySelector(".agent-tool-row__output")?.textContent).toBe("linux-1");
  });
  it("groups replayed Claude MCP calls by integration without crossing prose", async () => {
    function call(id: string, name: string) {
      return [
        {
          type: "assistant",
          message: {
            content: [{ type: "tool_use", id, name, input: { url: "https://example.com" } }],
          },
        },
        {
          type: "user",
          message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] },
        },
      ];
    }
    const events = remote("claude", [
      ...call("a", "mcp__chrome__navigate"),
      ...call("b", "mcp__chrome__snapshot"),
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "Now inspect the next page." }] },
      },
      ...call("c", "mcp__chrome__navigate"),
      ...call("d", "mcp__chrome__snapshot"),
    ]);
    render(events, { kind: "exited", exitCode: 0 }, "Inspect server", "claudeCode");
    const summaries = [...host.querySelectorAll("button")].filter((b) =>
      b.textContent?.includes("Used chrome"),
    );
    expect(summaries).toHaveLength(2);
    expect(summaries.every((b) => b.textContent?.includes("2 calls"))).toBe(true);
    await waitForReact(() => expect(host.textContent).toContain("Now inspect the next page."));
  });
  it("keeps a remote command failure counted in its group after successful turn settlement", () => {
    const events = remote("codex", [
      ...[0, 1, 2].map((id) => ({
        type: "item.completed",
        item: {
          id: `c-${id}`,
          type: "command_execution",
          command: `check-${id}`,
          aggregated_output: id === 2 ? "assertion failed" : "ok",
          exit_code: id === 2 ? 1 : 0,
          status: "completed",
        },
      })),
      {
        type: "item.completed",
        item: { id: "answer", type: "agent_message", text: "Review the failed check." },
      },
    ]);
    render(events, { kind: "exited", exitCode: 0 }, "Validate", "codex");
    expect((host.querySelector("details.agent-work") as HTMLDetailsElement)?.open).toBe(true);
    expect(host.querySelector(".agent-work__summary")?.textContent).toContain("need attention");
    const group = host.querySelector<HTMLButtonElement>(".agent-activity-group__toggle");
    expect(group?.querySelector(".cv-work-status__text")?.textContent).toBe("1 failed");
    act(() => group?.click());
    const failed = host.querySelector(".agent-tool-row--failed");
    expect(failed?.textContent).toContain("check-2");
    expect(failed?.closest(".agent-activity-group")).toBe(group?.closest(".agent-activity-group"));
  });
  it("hands focus from a pressed work summary to the transcript while it still toggles", () => {
    const events = remote("codex", [
      {
        type: "item.completed",
        item: {
          id: "c-sleep",
          type: "command_execution",
          command: "sleep 20",
          aggregated_output: "",
          exit_code: 0,
          status: "completed",
        },
      },
      {
        type: "item.completed",
        item: { id: "answer", type: "agent_message", text: "DONE" },
      },
    ]);
    render(events, { kind: "exited", exitCode: 0 }, "Sleep", "codex");
    const details = host.querySelector<HTMLDetailsElement>("details.agent-work");
    const summary = details?.querySelector<HTMLElement>(".agent-work__summary");
    expect(summary).not.toBeNull();
    const wasOpen = details?.open;
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });

    act(() => {
      summary?.dispatchEvent(press);
      summary?.focus();
      summary?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
      summary?.click();
    });

    expect(press.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(host.querySelector(".agent-session__scroll"));
    expect(details?.open).toBe(!wasOpen);
  });

  it("leaves keyboard focus on the work summary", () => {
    const events = remote("codex", [
      {
        type: "item.completed",
        item: {
          id: "c-ls",
          type: "command_execution",
          command: "ls",
          aggregated_output: "",
          exit_code: 0,
          status: "completed",
        },
      },
      {
        type: "item.completed",
        item: { id: "answer", type: "agent_message", text: "DONE" },
      },
    ]);
    render(events, { kind: "exited", exitCode: 0 }, "List", "codex");
    const summary = host.querySelector<HTMLElement>(".agent-work__summary");
    expect(summary).not.toBeNull();

    act(() => {
      summary?.focus();
      summary?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    });

    expect(document.activeElement).toBe(summary);
  });
  function renderMcpCalls(status: string | undefined): void {
    const events = remote(
      "codex",
      [1, 2].map((id) => ({
        type: "item.completed",
        item: {
          id: `mcp-${id}`,
          type: "mcp_tool_call",
          server: "chrome",
          tool: "snapshot",
          ...(status === undefined ? {} : { status }),
        },
      })),
    );
    render(events, { kind: "exited", exitCode: 0 }, "Inspect", "codex");
  }
  function mcpSummary(status: string | undefined): string | null | undefined {
    renderMcpCalls(status);
    const summary = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Used chrome"),
    );
    expect(summary).toBeDefined();
    return summary?.textContent;
  }

  it("counts remote MCP calls the provider reported as completed without an error", () => {
    expect(mcpSummary("completed")).toBe("Used chrome · 2 calls2 completed");
  });

  it.each([undefined, "in_progress"])(
    "does not count remote MCP calls with a missing or unknown status (%s) as success",
    (status) => {
      renderMcpCalls(status);
      const group = host.querySelector<HTMLButtonElement>(".agent-activity-group__toggle");
      expect(group?.querySelector(".cv-work-status__text")?.textContent).toBe("2 failed");
      act(() => group?.click());
      expect(host.querySelectorAll(".agent-tool-row--failed")).toHaveLength(2);
      expect(host.textContent).not.toMatch(/completed|passed/);
    },
  );
});
