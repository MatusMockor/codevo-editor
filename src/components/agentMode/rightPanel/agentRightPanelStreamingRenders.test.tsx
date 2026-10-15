// @vitest-environment jsdom
import { REMOTE_RUNNER_REACHABLE } from "../../../domain/remoteRunnerReachability";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../../application/agentThreadPorts";
import type { AgentTurn } from "../../../domain/agentThread";
import type { AgentSurfaceKind } from "../../../domain/agentWorkbenchLayout";
import type { TerminalTheme } from "../../../domain/settings";
import type { FileEntry } from "../../../domain/workspace";
import { AgentSurfaceHost, type AgentSurfaceHostProps } from "../AgentSurfaceHost";
import {
  SURFACE_FIXTURE_ROOT,
  SURFACE_FIXTURE_WORKTREE,
  surfaceRepositoryScope,
  surfaceThreadView,
} from "../agentSurfaceTestFixtures";
import { fakeTerminalGateway, installResizeObserver } from "../agentSurfaceTerminalTestSupport";
import {
  UNAVAILABLE_AGENT_SCRIPT_RUNNER,
  type AgentWorkbenchChrome,
} from "../agentWorkbenchChrome";
import { agentRightPanelThreadKey, useStableAgentRightPanelThread } from "./agentRightPanelThread";

const probe = vi.hoisted(() => {
  const renders = new Map<string, number>();
  const contexts = new Set<unknown>();
  const surface = async (name: string) => {
    const { useAgentRightPanelContext } = await import("./agentRightPanelContext");
    return function RenderProbe() {
      contexts.add(useAgentRightPanelContext());
      renders.set(name, (renders.get(name) ?? 0) + 1);
      return null;
    };
  };
  const files = function FilesProbe(props: { readonly fileTree: unknown }) {
    renders.set("files", (renders.get("files") ?? 0) + 1);
    if (props.fileTree !== null) renders.set("filesWithTree", 1);
    return null;
  };
  return { renders, contexts, surface, files };
});

vi.mock("./files/AgentFilesSurface", () => ({ AgentFilesSurface: probe.files }));

vi.mock("./diff/AgentDiffSurfaceContainer", async () => ({
  AgentDiffSurfaceContainer: await probe.surface("diff"),
}));
vi.mock("./git/AgentGitSurfaceContainer", async () => ({
  AgentGitSurfaceContainer: await probe.surface("git"),
}));
vi.mock("./scripts/AgentScriptsSurfaceContainer", async () => ({
  AgentScriptsSurfaceContainer: await probe.surface("scripts"),
}));
vi.mock("./pullRequest/AgentPullRequestSurfaceContainer", async () => ({
  AgentPullRequestSurfaceContainer: await probe.surface("pullRequest"),
}));

const OPEN: ReadonlyArray<AgentSurfaceKind> = ["files", "diff", "git", "scripts", "pullRequest"];
const REMOTE_EXECUTION = {
  kind: "remote",
  serverId: "server",
  runnerId: "runner",
  projectId: "project",
  taskId: undefined,
  conversationId: "conversation",
  latestTaskId: "task",
  resume: null,
  reachability: REMOTE_RUNNER_REACHABLE,
} as const;

describe("right panel under a streaming thread", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    installResizeObserver();
    probe.renders.clear();
    probe.contexts.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("does not re-render any surface for streamed output that surfaces do not read", async () => {
    const props = hostProps();
    render({ ...props, thread: streamed(0) });
    await act(async () => undefined);
    const settled = new Map(probe.renders);
    expect([...settled.keys()].sort()).toEqual([...OPEN, "filesWithTree"].sort());
    probe.contexts.clear();

    for (let flush = 1; flush <= 20; flush += 1) render({ ...props, thread: streamed(flush) });
    await act(async () => undefined);

    expect(probe.renders).toEqual(settled);
    expect(probe.contexts.size).toBe(0);
  });

  it("keeps the remote working-tree diff context stable while a remote thread streams", async () => {
    const props = hostProps();
    const layout = { openSurfaces: ["diff"], activeSurface: "diff" } as const;
    const remote = (flush: number) => ({ ...streamed(flush), execution: REMOTE_EXECUTION });
    render({ ...props, layout, thread: remote(0) });
    await act(async () => undefined);
    const settled = probe.renders.get("diff");
    expect(settled).toBeGreaterThan(0);
    const contexts = [...probe.contexts];
    expect(contexts).toHaveLength(1);

    for (let flush = 1; flush <= 20; flush += 1)
      render({ ...props, layout, thread: remote(flush) });

    expect(probe.renders.get("diff")).toBe(settled);
    expect([...probe.contexts]).toEqual(contexts);
  });

  it("re-renders surfaces when a projected field changes", () => {
    const props = hostProps();
    render({ ...props, thread: streamed(0) });
    const before = probe.renders.get("git") ?? 0;

    render({ ...props, thread: streamed(1, { title: "Renamed thread" }) });

    expect(probe.renders.get("git")).toBe(before + 1);
    expect(probe.contexts.size).toBe(2);
  });

  function render(props: AgentSurfaceHostProps): void {
    act(() => root.render(<AgentSurfaceHost {...props} />));
  }
});

describe("agentRightPanelThreadKey", () => {
  it("ignores transcript growth and tracks finished turns", () => {
    expect(agentRightPanelThreadKey(streamed(1))).toBe(agentRightPanelThreadKey(streamed(9)));
    expect(agentRightPanelThreadKey(streamed(1))).not.toBe(
      agentRightPanelThreadKey(streamed(1, {}, 42)),
    );
  });

  it("keeps the previous view object while the key is unchanged", () => {
    const seen: Array<AgentThreadView | null> = [];
    function Probe(props: { readonly view: AgentThreadView }) {
      seen.push(useStableAgentRightPanelThread(props.view));
      return null;
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    const first = streamed(1);
    act(() => root.render(<Probe view={first} />));
    act(() => root.render(<Probe view={streamed(2)} />));
    const renamed = streamed(3, { title: "Renamed" });
    act(() => root.render(<Probe view={renamed} />));
    act(() => root.unmount());

    expect(seen[0]).toBe(first);
    expect(seen[1]).toBe(first);
    expect(seen[seen.length - 1]).toBe(renamed);
  });
});

function streamed(
  flush: number,
  overrides: Partial<AgentThreadView["thread"]> = {},
  endedAtEpochMs: number | null = null,
): AgentThreadView {
  return surfaceThreadView({
    lifecycle: "running",
    thread: {
      ...surfaceThreadView().thread,
      updatedAtEpochMs: 1_700_000_000_000 + flush,
      turns: [turn("t1", 10, flush), turn("t2", endedAtEpochMs, flush)],
      ...overrides,
    },
  });
}

function turn(turnId: string, endedAtEpochMs: number | null, flush: number): AgentTurn {
  return {
    turnId,
    prompt: "do the thing",
    status: endedAtEpochMs === null ? { kind: "running" } : { kind: "exited", exitCode: 0 },
    startedAtEpochMs: 1,
    endedAtEpochMs,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: flush,
    streamMetrics: null,
    launch: null,
    cliVersion: null,
  };
}

function hostProps(): AgentSurfaceHostProps {
  const chrome: AgentWorkbenchChrome = {
    layout: { layout: { openSurfaces: OPEN, activeSurface: "diff" } } as never,
    bottomPanelVisible: false,
    shortcuts: null,
    scripts: UNAVAILABLE_AGENT_SCRIPT_RUNNER,
    workspaceId: "ws-1",
    workspaceTrusted: true,
    fileTree: {
      files: { readDirectory: async (): Promise<FileEntry[]> => [] },
      fileChanges: null,
      activePath: null,
      revealActivePathSignal: 0,
      onOpenFile: () => undefined,
      onPreviewFile: async () => true,
      revealEditor: () => undefined,
    },
    diff: { monacoTheme: "calm-dark" },
    terminal: {
      terminalGateway: fakeTerminalGateway(),
      terminalTheme: new Proxy({} as TerminalTheme, { get: () => "#000000" }),
      shellIntegrationEnabled: false,
    },
    onToggleBottomPanel: () => undefined,
    onShowTerminalPanel: () => undefined,
    onOpenScriptsView: null,
    addProject: null,
    revealPath: async () => undefined,
  };
  return {
    chrome,
    layout: { openSurfaces: OPEN, activeSurface: "diff" },
    thread: surfaceThreadView(),
    threadRootPath: SURFACE_FIXTURE_WORKTREE,
    scope: surfaceRepositoryScope(),
    workspaceRoot: SURFACE_FIXTURE_ROOT,
    hidden: false,
    chooserAutoFocus: false,
    agents: {
      showChanges: async () => undefined,
      showFileDiff: async () => undefined,
      hideFileDiff: () => undefined,
      openChangedFile: async () => undefined,
      openChangedFileDiff: async () => undefined,
    },
    layoutControls: null,
    onOpenSurface: () => undefined,
    onActivateSurface: () => undefined,
    onCloseSurfaceTab: () => undefined,
    onTrustScope: () => undefined,
    onSwitchScope: null,
  };
}
