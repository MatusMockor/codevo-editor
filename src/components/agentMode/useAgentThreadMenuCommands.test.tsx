// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTasksNotice } from "../../application/agentThreadPorts";
import { agentProjectGroups } from "./agentModePresentation";
import { SURFACE_FIXTURE_ROOT, surfaceThreadView } from "./agentSurfaceTestFixtures";
import type { AgentProjectMenuTarget, AgentRailScope } from "./agentSidebarPresentation";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import {
  CLIPBOARD_UNAVAILABLE_NOTICE,
  NOTHING_TO_COPY_NOTICE,
  REVEAL_FAILED_NOTICE,
  useAgentThreadMenuCommands,
  type AgentMenuCommandSurface,
  type AgentThreadMenuCommandOptions,
  type AgentThreadMenuCommands,
} from "./useAgentThreadMenuCommands";

const PROJECT_TARGET: AgentProjectMenuTarget = {
  projectRootKey: SURFACE_FIXTURE_ROOT,
  repositoryRoot: SURFACE_FIXTURE_ROOT,
  rootPath: SURFACE_FIXTURE_ROOT,
};

describe("useAgentThreadMenuCommands", () => {
  let host: HTMLDivElement;
  let root: Root;
  let captured: AgentThreadMenuCommands | null;
  let notices: AgentTasksNotice[];
  let scopes: AgentRailScope[];
  let removed: string[];
  let started: Array<readonly [string, string]>;
  let terminalSessions: Array<readonly [string, string]>;
  let clipboardDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    captured = null;
    notices = [];
    scopes = [];
    removed = [];
    started = [];
    terminalSessions = [];
    clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    if (clipboardDescriptor === undefined) {
      Reflect.deleteProperty(navigator, "clipboard");
      return;
    }
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  });

  it("routes project commands to trust, close, release, scope filtering, reveal, and copy", async () => {
    const writeText = installClipboard(async () => undefined);
    const onTrustProject = vi.fn();
    const onCloseProject = vi.fn();
    const onReleaseProject = vi.fn();
    const revealPath = vi.fn(async () => undefined);
    render({ onTrustProject, onCloseProject, onReleaseProject, revealPath });

    act(() => current().handleProjectCommand(PROJECT_TARGET, "trust"));
    act(() => current().handleProjectCommand(PROJECT_TARGET, "close"));
    act(() => current().handleProjectCommand(PROJECT_TARGET, "release"));
    act(() => current().handleProjectCommand(PROJECT_TARGET, "filterToProject"));
    await act(async () => current().handleProjectCommand(PROJECT_TARGET, "reveal"));
    await act(async () => current().handleProjectCommand(PROJECT_TARGET, "copyPath"));

    expect(onTrustProject).toHaveBeenCalledWith(SURFACE_FIXTURE_ROOT);
    expect(onCloseProject).toHaveBeenCalledWith(SURFACE_FIXTURE_ROOT);
    expect(onReleaseProject).toHaveBeenCalledWith(SURFACE_FIXTURE_ROOT);
    expect(scopes).toEqual([
      {
        kind: "repository",
        projectRootKey: SURFACE_FIXTURE_ROOT,
        repositoryRoot: SURFACE_FIXTURE_ROOT,
      },
    ]);
    expect(revealPath).toHaveBeenCalledWith(SURFACE_FIXTURE_ROOT);
    expect(writeText).toHaveBeenCalledWith(SURFACE_FIXTURE_ROOT);
    expect(notices).toEqual([]);
  });

  it("opens terminal sessions for the gear menu target project", () => {
    render();

    act(() => current().handleProjectCommand(PROJECT_TARGET, "terminalSessions"));
    act(() =>
      current().handleProjectCommand(
        { ...PROJECT_TARGET, repositoryRoot: `${SURFACE_FIXTURE_ROOT}/packages/api` },
        "terminalSessions",
      ),
    );

    expect(terminalSessions).toEqual([
      [SURFACE_FIXTURE_ROOT, SURFACE_FIXTURE_ROOT],
      [SURFACE_FIXTURE_ROOT, `${SURFACE_FIXTURE_ROOT}/packages/api`],
    ]);
    expect(notices).toEqual([]);
  });

  it("reports a notice when reveal fails or the project has no path", async () => {
    render({ revealPath: async () => Promise.reject(new Error("denied")) });

    await act(async () => current().handleProjectCommand(PROJECT_TARGET, "reveal"));
    act(() => current().handleProjectCommand({ ...PROJECT_TARGET, rootPath: null }, "reveal"));
    act(() => current().handleProjectCommand({ ...PROJECT_TARGET, rootPath: null }, "copyPath"));

    expect(notices).toEqual([REVEAL_FAILED_NOTICE]);
  });

  it("routes thread commands to the surface and starts a new thread in the same repository", async () => {
    const agents = threadsSurfaceFixture({
      threads: [surfaceThreadView()],
      togglePin: vi.fn(),
      stop: vi.fn(async () => undefined),
      archive: vi.fn(),
      remove: vi.fn(),
      renameThread: vi.fn(),
      markThreadUnread: vi.fn(),
    });
    render({ agents });

    act(() => current().handleThreadMenuCommand("agt-1", { kind: "togglePin" }));
    await act(async () => current().handleThreadMenuCommand("agt-1", { kind: "stop" }));
    act(() => current().handleThreadMenuCommand("agt-1", { kind: "archive" }));
    act(() => current().handleThreadMenuCommand("agt-1", { kind: "rename", title: "Renamed" }));
    act(() => current().handleThreadMenuCommand("agt-1", { kind: "markUnread" }));
    act(() => current().handleThreadMenuCommand("agt-1", { kind: "delete" }));
    act(() => current().handleThreadMenuCommand("agt-1", { kind: "newThread" }));
    act(() => current().handleThreadMenuCommand("missing", { kind: "newThread" }));

    expect(agents.togglePin).toHaveBeenCalledWith("agt-1");
    expect(agents.stop).toHaveBeenCalledWith("agt-1");
    expect(agents.archive).toHaveBeenCalledWith("agt-1");
    expect(agents.renameThread).toHaveBeenCalledWith("agt-1", "Renamed");
    expect(agents.markThreadUnread).toHaveBeenCalledWith("agt-1");
    expect(agents.remove).toHaveBeenCalledWith("agt-1");
    expect(removed).toEqual(["agt-1"]);
    expect(started).toEqual([[SURFACE_FIXTURE_ROOT, SURFACE_FIXTURE_ROOT]]);
  });

  it("copies a thread detail and falls back to notices when nothing or no clipboard is available", async () => {
    const writeText = installClipboard(async () => undefined);
    render({
      agents: threadsSurfaceFixture({
        threads: [surfaceThreadView()],
        threadCopyDetail: (_threadId, detail) => (detail === "branch" ? "agent/agt-1" : null),
      }),
    });

    await act(async () =>
      current().handleThreadMenuCommand("agt-1", { kind: "copy", detail: "branch" }),
    );
    act(() => current().handleThreadMenuCommand("agt-1", { kind: "copy", detail: "path" }));

    expect(writeText).toHaveBeenCalledWith("agent/agt-1");
    expect(notices).toEqual([NOTHING_TO_COPY_NOTICE]);

    installClipboard(async () => Promise.reject(new Error("blocked")));
    await act(async () =>
      current().handleThreadMenuCommand("agt-1", { kind: "copy", detail: "branch" }),
    );
    expect(notices).toEqual([NOTHING_TO_COPY_NOTICE, CLIPBOARD_UNAVAILABLE_NOTICE]);

    Reflect.deleteProperty(navigator, "clipboard");
    act(() => current().handleThreadMenuCommand("agt-1", { kind: "copy", detail: "branch" }));
    expect(notices).toEqual([
      NOTHING_TO_COPY_NOTICE,
      CLIPBOARD_UNAVAILABLE_NOTICE,
      CLIPBOARD_UNAVAILABLE_NOTICE,
    ]);
  });

  function installClipboard(writeText: (text: string) => Promise<void>) {
    const spy = vi.fn(writeText);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: spy },
    });
    return spy;
  }

  function render(overrides: Partial<AgentThreadMenuCommandOptions> = {}): void {
    const agents: AgentMenuCommandSurface = overrides.agents ?? threadsSurfaceFixture();
    const options: AgentThreadMenuCommandOptions = {
      agents,
      groups: agentProjectGroups([projectFixture()], agents.threads, []),
      revealPath: async () => undefined,
      reportNotice: (notice) => notices.push(notice),
      onTrustProject: () => undefined,
      onCloseProject: () => undefined,
      onReleaseProject: () => undefined,
      onFilterScope: (scope) => scopes.push(scope),
      onThreadRemoved: (threadId) => removed.push(threadId),
      onOpenTerminalSessions: (projectRootKey, repositoryRoot) =>
        terminalSessions.push([projectRootKey, repositoryRoot]),
      startNewThread: (projectRootKey, repositoryRoot) =>
        started.push([projectRootKey, repositoryRoot]),
      ...overrides,
    };
    act(() => {
      root.render(<Harness options={options} />);
    });
  }

  function current(): AgentThreadMenuCommands {
    expect(captured).not.toBeNull();
    return captured as AgentThreadMenuCommands;
  }

  function Harness({ options }: { readonly options: AgentThreadMenuCommandOptions }) {
    captured = useAgentThreadMenuCommands(options);
    return null;
  }
});
