// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import type { AgentThread, AgentThreadAttention, AgentTurn } from "../../domain/agentThread";
import {
  AgentStatusBarHost,
  type AgentStatusBarAgents,
  type AgentStatusBarHostProps,
} from "./AgentStatusBarHost";

const ROOT = "/workspace/app";
const OTHER_ROOT = "/workspace/api";

describe("AgentStatusBarHost", () => {
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

  it("counts only the threads that need attention", () => {
    render({
      agents: agents({
        threads: [
          threadView({ threadId: "agt-1", attention: "attention" }),
          threadView({ threadId: "agt-2", attention: "attention" }),
          threadView({ threadId: "agt-3", attention: "running" }),
        ],
      }),
    });

    expect(host.querySelector(".status-agent-attention")?.textContent).toBe("2 need attention");
  });

  it("names the workspace project's remembered launch, not a thread's turn launch", () => {
    render({
      agents: agents({
        threads: [
          threadView({
            threadId: "agt-1",
            rootKey: OTHER_ROOT,
            launch: {
              provider: "claudeCode",
              model: "opus",
              mode: "acceptEdits",
              effort: "default",
            },
          }),
        ],
        lastUsedLaunch: (projectRootKey: string) =>
          projectRootKey === ROOT
            ? { provider: "codex", model: "gpt-5.5", mode: "workspaceWrite" }
            : null,
      }),
    });

    expect(host.querySelector(".status-agent-launch")?.textContent).toBe(
      "gpt-5.5 · workspace write",
    );
  });

  it("names the workspace project's remembered launch", () => {
    render({
      agents: agents({
        threads: [threadView({ threadId: "agt-1", launch: null })],
        lastUsedLaunch: (projectRootKey: string) =>
          projectRootKey === ROOT
            ? { provider: "claudeCode", model: "sonnet", mode: "plan", effort: "default" }
            : null,
      }),
    });

    expect(host.querySelector(".status-agent-launch")?.textContent).toBe("sonnet · plan only");
  });

  it("stays silent when nothing is selected and nothing is remembered", () => {
    render({ workspaceRoot: null });

    expect(host.querySelector(".status-agent-launch")).toBeNull();
    expect(host.querySelector(".status-agent-attention")).toBeNull();
    expect(host.querySelector(".status-agent-cli")).toBeNull();
  });

  it("names the configured CLI binary and its probed version", () => {
    render({ agents: agents({ agentCliKind: "claudeCode", agentCliVersion: "2.1.245" }) });

    expect(host.querySelector(".status-agent-cli")?.textContent).toBe("claude 2.1.245");
  });

  it("labels the codex binary by its executable name", () => {
    render({ agents: agents({ agentCliKind: "codex", agentCliVersion: "0.104.0" }) });

    expect(host.querySelector(".status-agent-cli")?.textContent).toBe("codex 0.104.0");
  });

  it("hides the version while the probe is unknown", () => {
    render({ agents: agents({ agentCliVersion: null }) });

    expect(host.querySelector(".status-agent-cli")).toBeNull();
  });

  it("reports the live slots of the surface it was given", () => {
    render({ agents: agents({ liveTaskCount: 2, maxConcurrentAgentTasks: 4 }) });

    expect(host.textContent).toContain("2/4 agents running");
  });

  function render(overrides: Partial<AgentStatusBarHostProps> = {}): void {
    act(() => root.render(<AgentStatusBarHost {...defaultProps()} {...overrides} />));
  }
});

function defaultProps(): AgentStatusBarHostProps {
  return {
    agents: agents({}),
    workspaceRoot: ROOT,
    workspaceTrusted: true,
  };
}

function agents(overrides: Partial<AgentStatusBarAgents>): AgentStatusBarAgents {
  return {
    threads: [],
    liveTaskCount: 0,
    maxConcurrentAgentTasks: 3,
    lastUsedLaunch: () => null,
    agentCliKind: "claudeCode",
    agentCliVersion: null,
    ...overrides,
  };
}

interface ThreadViewOptions {
  readonly threadId: string;
  readonly rootKey?: string;
  readonly attention?: AgentThreadAttention;
  readonly launch?: AgentLaunchOptions | null;
}

function threadView({
  attention = "settled",
  launch = null,
  rootKey = ROOT,
  threadId,
}: ThreadViewOptions): AgentThreadView {
  const thread: AgentThread = {
    threadId,
    owner: { rootKey, ownerId: "agent-root:app", repositoryRoot: rootKey },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: null },
    title: "Refactor the parser",
    pinned: false,
    archived: false,
    createdAtEpochMs: 1_700_000_000_000,
    updatedAtEpochMs: 1_700_000_000_000,
    turns: [turn(threadId, launch)],
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
  };

  return {
    thread,
    lifecycle: "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention,
    unread: false,
  };
}

function turn(threadId: string, launch: AgentLaunchOptions | null): AgentTurn {
  return {
    turnId: `${threadId}-t1`,
    prompt: "Refactor the parser",
    status: { kind: "exited", exitCode: 0 },
    startedAtEpochMs: 1_700_000_000_000,
    endedAtEpochMs: null,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch,
    cliVersion: null,
  };
}
