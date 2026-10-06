// @vitest-environment jsdom

import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AgentThreadsSurface,
  AgentThreadView,
  RemoteAgentCommandCatalogAccess,
} from "../../application/agentThreadPorts";
import {
  remoteCommandCatalogAccess,
  remoteCommandCatalogRunners,
} from "../../application/remoteAgentCommandCatalog";
import { remoteAgentProjectKey } from "../../application/remoteAgentProjection";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { agentProjectGroups } from "./agentModePresentation";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import {
  useAgentComposerControllerState,
  type AgentComposerControllerState,
} from "./useAgentComposerState";
import { useAgentThreadNavigation, type AgentThreadNavigation } from "./useAgentThreadNavigation";

const PROVIDERS = { claudeCode: true, codex: true } as const;
const remoteRoot = remoteAgentProjectKey("server", "runner", "project");
const remoteProject = projectFixture({ rootKey: remoteRoot, rootPath: remoteRoot });

function accessFor(
  runnerId: string,
  commandCatalog = true,
): RemoteAgentCommandCatalogAccess | undefined {
  return remoteCommandCatalogAccess(
    remoteCommandCatalogRunners({
      gateway: { getCommandCatalog: () => new Promise(() => undefined) },
      servers: [{ id: "server", connected: true }],
      snapshots: [
        {
          serverId: "server",
          connected: true,
          descriptor: {
            protocolVersion: 1,
            runnerId,
            name: "Linux",
            capabilities: { taskExecution: true, eventReplay: true, commandCatalog },
          },
        },
      ],
    }),
  );
}

function remoteThread(): AgentThreadView {
  const base = surfaceThreadView();
  return {
    ...base,
    thread: {
      ...base.thread,
      owner: { rootKey: remoteRoot, ownerId: remoteRoot, repositoryRoot: remoteRoot },
    },
    execution: {
      kind: "remote",
      serverId: "server",
      runnerId: "runner",
      projectId: "project",
      conversationId: base.thread.threadId,
      latestTaskId: "task",
      resume: { available: true, reason: null },
    },
  };
}

describe("composer state command catalog project", () => {
  let host: HTMLDivElement;
  let root: Root;
  let composer: AgentComposerControllerState | null;
  let navigation: AgentThreadNavigation | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    composer = null;
    navigation = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function Harness({
    agents,
    projects,
  }: {
    readonly agents: AgentThreadsSurface;
    readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  }) {
    const groups = useMemo(
      () => agentProjectGroups(projects, agents.threads, agents.orphanedWorktrees),
      [agents.orphanedWorktrees, agents.threads, projects],
    );
    const threads = useAgentThreadNavigation({
      agents,
      groups,
      presentationThreads: agents.threads,
      projects,
    });
    navigation = threads;
    composer = useAgentComposerControllerState({
      agents,
      groups,
      projects,
      providerEnabled: PROVIDERS,
      railScope: threads.composerScope,
      selectedThread: threads.selectedThread,
      onClearSelectedThread: threads.clearSelectedThread,
      onThreadStarted: threads.selectStartedThread,
    });
    return null;
  }

  function render(
    agents: AgentThreadsSurface,
    projects: ReadonlyArray<AgentProjectDescriptor> = [projectFixture(), remoteProject],
  ): void {
    act(() => root.render(<Harness agents={agents} projects={projects} />));
  }

  function project() {
    expect(composer).not.toBeNull();
    return composer?.composerProps.commandCatalogProject ?? null;
  }

  it("resolves the remote project of a new server draft from its project key", () => {
    render(threadsSurfaceFixture({ remoteCommandCatalog: accessFor("runner") }));
    expect(project()).toBeNull();
    act(() => composer?.startNewThread(remoteRoot, remoteProject.rootPath));
    expect(project()).toEqual({ serverId: "server", runnerId: "runner", projectId: "project" });
  });

  it("resolves the remote project of a selected server thread from its execution identity", () => {
    const thread = remoteThread();
    render(threadsSurfaceFixture({ threads: [thread], remoteCommandCatalog: accessFor("runner") }));
    act(() => navigation?.selectThread(thread.thread.threadId));
    expect(project()).toEqual({ serverId: "server", runnerId: "runner", projectId: "project" });
  });

  it("resolves nothing for a local thread or a local draft", () => {
    const thread = surfaceThreadView();
    render(threadsSurfaceFixture({ threads: [thread], remoteCommandCatalog: accessFor("runner") }));
    expect(project()).toBeNull();
    act(() => navigation?.selectThread(thread.thread.threadId));
    expect(project()).toBeNull();
  });

  it.each([
    ["the runner does not announce command catalogs", accessFor("runner", false)],
    ["no runner is capable", undefined],
    ["the connected runner has a different identity", accessFor("runner-replaced")],
  ])("resolves nothing for a server thread and draft when %s", (_name, access) => {
    const thread = remoteThread();
    render(threadsSurfaceFixture({ threads: [thread], remoteCommandCatalog: access }));
    act(() => composer?.startNewThread(remoteRoot, remoteProject.rootPath));
    expect(project()).toBeNull();
    act(() => navigation?.selectThread(thread.thread.threadId));
    expect(project()).toBeNull();
  });

  it("uses the thread's own runner identity rather than the project it is filed under", () => {
    const base = remoteThread();
    const execution = base.execution;
    expect(execution).toBeDefined();
    const thread: AgentThreadView = {
      ...base,
      ...(execution === undefined ? {} : { execution: { ...execution, runnerId: "runner-old" } }),
    };
    render(threadsSurfaceFixture({ threads: [thread], remoteCommandCatalog: accessFor("runner") }));
    act(() => composer?.startNewThread(remoteRoot, remoteProject.rootPath));
    expect(project()).not.toBeNull();
    act(() => navigation?.selectThread(thread.thread.threadId));
    expect(project()).toBeNull();
  });

  it("drops the project when the runner identity changes under a selected thread", () => {
    const thread = remoteThread();
    render(threadsSurfaceFixture({ threads: [thread], remoteCommandCatalog: accessFor("runner") }));
    act(() => navigation?.selectThread(thread.thread.threadId));
    expect(project()).not.toBeNull();
    render(
      threadsSurfaceFixture({
        threads: [thread],
        remoteCommandCatalog: accessFor("runner-replaced"),
      }),
    );
    expect(project()).toBeNull();
  });
});
