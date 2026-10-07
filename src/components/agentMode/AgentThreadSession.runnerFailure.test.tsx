// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentTurn, AgentTurnEvent, AgentTurnStatus } from "../../domain/agentThread";
import {
  agentProviderErrorHeadline,
  classifyAgentProviderError,
} from "../../domain/agentOutput/agentProviderError";
import { agentProviderErrorAdvice } from "./agentProviderErrorAdvice";
import { agentThreadErrorBannerModel } from "./agentThreadErrorBannerPresentation";
import { AgentThreadSession } from "./AgentThreadSession";

const RUNNER_CODES = [
  "process_cleanup_failed",
  "execution_timeout",
  "provider_unavailable",
  "provider_result_missing",
  "provider_reported_failure",
  "provider_input_failed",
  "output_persistence_failed",
  "output_limit_exceeded",
  "instruction_sync_failed",
  "execution_failed",
] as const;

describe("failed turn of a remote run that ended with a runner code", () => {
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

  it.each(RUNNER_CODES)("explains %s once and keeps the code in the collapsed details", (code) => {
    const error = classifyAgentProviderError(code, "claudeCode");
    const headline = agentProviderErrorHeadline(error, null);
    const hint = agentProviderErrorAdvice(error, "remote");
    render({ kind: "failed", message: code }, [{ kind: "error", message: code }]);

    const blocks = host.querySelectorAll(".agent-finale--bad");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.querySelector(".agent-microlabel--bad")?.textContent).toBe("error");
    expect(error.detail.kind).not.toBe("unknown");
    expect(hint).not.toBeNull();
    expect(blocks[0]?.querySelector(".agent-finale__body")?.textContent).toBe(headline);
    expect(blocks[0]?.querySelector(".agent-note")?.textContent).toBe(hint);
    expect(visibleText(blocks[0])).not.toContain(code);
    expect(visibleText(blocks[0])).not.toMatch(/[–—]/u);
    const raw = blocks[0]?.querySelector<HTMLDetailsElement>("details.agent-raw");
    expect(raw?.open).toBe(false);
    expect(raw?.querySelector("pre")?.textContent).toBe(code);
  });

  it("explains a failure the transcript recorded only as the turn status", () => {
    render({ kind: "failed", message: "process_cleanup_failed" }, []);

    const blocks = host.querySelectorAll(".agent-finale--bad");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.querySelector(".agent-microlabel--bad")?.textContent).toBe("run failed");
    expect(blocks[0]?.querySelector(".agent-finale__body")?.textContent).toBe(
      "The server could not keep track of this run's processes.",
    );
    expect(blocks[0]?.querySelector(".agent-note")?.textContent).toBe(
      "Processes from this run may still be running on that server. Check them before you try again. If it keeps happening, restart the runner on that server.",
    );
    expect(visibleText(blocks[0])).not.toContain("process_cleanup_failed");
  });

  it.each([
    "The tool printed process_cleanup_failed while cleaning up.",
    "process_cleanup_failed: could not signal pid 4242",
    "PROCESS_CLEANUP_FAILED",
  ])("shows provider text that only contains a runner code as it is (%j)", (message) => {
    render({ kind: "failed", message }, [{ kind: "error", message }]);

    const blocks = host.querySelectorAll(".agent-finale--bad");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.querySelector(".agent-finale__body")?.textContent).toBe(message);
    expect(blocks[0]?.querySelector(".agent-note")).toBeNull();
    expect(blocks[0]?.querySelector("details.agent-raw")).toBeNull();
  });

  it.each(["workspace_identity_invalid", "git_branch_not_found", "brand_new_runner_code"])(
    "shows the unmapped runner code %s unchanged",
    (code) => {
      render({ kind: "failed", message: code }, [{ kind: "error", message: code }]);

      const blocks = host.querySelectorAll(".agent-finale--bad");
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.querySelector(".agent-finale__body")?.textContent).toBe(code);
      expect(blocks[0]?.querySelector(".agent-note")).toBeNull();
    },
  );

  it.each([
    [[]],
    [[{ kind: "error", message: "provider_reported_failure" }]],
  ] satisfies ReadonlyArray<[ReadonlyArray<AgentTurnEvent>]>)(
    "names the generic failure in the turn and the banner when nothing else was reported (%j)",
    (events) => {
      const banner = agentThreadErrorBannerModel(
        render({ kind: "failed", message: "provider_reported_failure" }, events),
        null,
      );
      const blocks = host.querySelectorAll(".agent-finale--bad");

      expect(blocks).toHaveLength(1);
      expect(banner?.title).toBe(
        agentProviderErrorHeadline(
          classifyAgentProviderError("provider_reported_failure", "claudeCode"),
          null,
        ),
      );
      expect(blocks[0]?.querySelector(".agent-finale__body")?.textContent).toBe(banner?.title);
      expect(blocks[0]?.querySelector(".agent-note")?.textContent).toBe(banner?.detail);
      expect(visibleText(blocks[0])).not.toContain("provider_reported_failure");
    },
  );

  it("keeps a stopped remote run a neutral stop marker", () => {
    render({ kind: "stopped" }, []);

    expect(host.querySelector(".agent-finale--bad")).toBeNull();
    expect(host.querySelector(".agent-turn-end")?.textContent).toContain("Stopped");
  });

  function visibleText(block: Element | undefined): string {
    const copy = block?.cloneNode(true) as Element | undefined;
    copy?.querySelector("details.agent-raw")?.remove();
    return copy?.textContent ?? "";
  }

  function render(status: AgentTurnStatus, events: ReadonlyArray<AgentTurnEvent>): AgentThreadView {
    const turn: AgentTurn = {
      turnId: "turn",
      prompt: "Fix the router",
      status,
      events,
      startedAtEpochMs: Date.now() - 32_000,
      endedAtEpochMs: Date.now(),
      eventsTruncated: false,
      lastStatusSequence: 0,
      lastOutputSequence: 0,
      launch: null,
      cliVersion: null,
    };
    const view: AgentThreadView = {
      execution: {
        kind: "remote",
        serverId: "linux",
        runnerId: "runner",
        projectId: "project",
        conversationId: "conversation",
        latestTaskId: "task",
        resume: null,
      },
      thread: {
        threadId: "thread",
        owner: { rootKey: "/app", repositoryRoot: "/app", ownerId: "owner" },
        target: { isolation: "in-place", worktreePath: null },
        provider: { kind: "claudeCode", sessionId: "session" },
        title: "Router",
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
      attention: "settled",
      unread: false,
      lifecycle: "settled",
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
    return view;
  }
});
