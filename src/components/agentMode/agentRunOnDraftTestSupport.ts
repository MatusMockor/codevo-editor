import { act, createElement, StrictMode, useLayoutEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, vi } from "vitest";
import type { AgentAttachmentGateway } from "../../application/agentAttachmentPorts";
import {
  createAgentComposerDraftStore,
  type AgentComposerDraftStore,
} from "../../application/agentComposerDrafts";
import type { AgentThreadsSurface, AgentThreadView } from "../../application/agentThreadPorts";
import { remoteAgentProjectKey } from "../../application/remoteAgentProjection";
import {
  useAgentComposerAttachments,
  type AgentAttachmentOwner,
  type AgentAttachmentSource,
  type AgentComposerAttachmentDraft,
} from "../../application/useAgentComposerAttachments";
import { useUnifiedAgentThreads } from "../../application/useUnifiedAgentThreads";
import type { AgentImageSurfacePort } from "../../domain/agentImageShrink";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type {
  RemoteRunnerGateway,
  RemoteRunnerServer,
  RemoteRunnerTask,
} from "../../domain/remoteRunner";
import { environmentComposerScope, groupedEnvironmentProjects } from "./agentEnvironmentProjects";
import { agentProjectGroups } from "./agentModePresentation";
import { SURFACE_FIXTURE_ROOT } from "./agentSurfaceTestFixtures";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import { useAgentComposerState, type AgentComposerState } from "./useAgentComposerState";
import { useAgentThreadNavigation, type AgentThreadNavigation } from "./useAgentThreadNavigation";

export const RUN_ON_SERVER: RemoteRunnerServer = {
  id: "server",
  name: "Linux",
  host: "linux",
  username: "user",
  port: 22,
  connected: true,
};
export const RUN_ON_SECOND_SERVER: RemoteRunnerServer = {
  id: "second",
  name: "Staging",
  host: "staging",
  username: "user",
  port: 22,
  connected: true,
};
export const RUN_ON_LOCAL_ROOT = SURFACE_FIXTURE_ROOT;
export const RUN_ON_OTHER_LOCAL_ROOT = "/workspace/other";
export const RUN_ON_LINKED_ROOT = remoteAgentProjectKey("server", "runner", "project");
export const RUN_ON_UNLINKED_ROOT = remoteAgentProjectKey("server", "runner", "other");
export const RUN_ON_SECOND_ROOT = remoteAgentProjectKey("second", "runner", "project");

export interface RunOnDraftOptions {
  readonly links?: ReadonlyMap<string, string>;
  readonly localProjects?: ReadonlyArray<AgentProjectDescriptor>;
  readonly remoteProjects?: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly servers?: ReadonlyArray<RemoteRunnerServer>;
  readonly threads?: ReadonlyArray<AgentThreadView>;
  readonly drafts?: AgentComposerDraftStore;
  readonly strict?: boolean;
}

export interface RunOnDraftView {
  readonly composer: AgentComposerState;
  readonly navigation: AgentThreadNavigation;
  readonly selectedServerId: string | null;
  selectServer(serverId: string | null): void;
}

interface Deferred {
  readonly promise: Promise<void>;
  release(): void;
}

function deferred(): Deferred {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function localAttachmentGateway() {
  let sequence = 0;
  let gate: Deferred | null = null;
  const released: string[] = [];
  const staged: string[] = [];
  const gateway: AgentAttachmentGateway = {
    stageAgentAttachmentBytes: vi.fn(async ({ name, mime, width, height, bytes }) => {
      if (gate !== null) await gate.promise;
      sequence += 1;
      const attachmentId = sequence.toString(16).padStart(32, "0");
      staged.push(attachmentId);
      return {
        attachmentId,
        name,
        mime,
        bytes: bytes.byteLength,
        width: width ?? 10,
        height: height ?? 10,
        promptLineBytesMax: 120,
      };
    }),
    inspectAgentAttachmentCandidate: vi.fn(async ({ path }) => ({
      bytes: 2_048,
      isRegularFile: true,
      isDirectory: false,
      extensionMime: path.endsWith(".png") ? "image/png" : "application/pdf",
    })),
    readAgentAttachmentCandidate: vi.fn(async () => new ArrayBuffer(16)),
    claimAgentAttachments: vi.fn(async () => []),
    releaseAgentAttachment: vi.fn(async ({ attachmentId }) => {
      released.push(attachmentId);
    }),
    readAgentAttachment: vi.fn(async () => new ArrayBuffer(0)),
    revealAgentAttachment: vi.fn(async () => undefined),
  };
  return {
    gateway,
    released,
    staged,
    holdStaging: (): Deferred => {
      gate = deferred();
      return gate;
    },
  };
}

function remoteRunnerGateway(projects: Readonly<Record<string, ReadonlyArray<string>>>) {
  const uploaded: { readonly serverId: string; readonly name: string }[] = [];
  let created: RemoteRunnerTask | null = null;
  const gateway = {
    collectInstructions: vi.fn().mockResolvedValue({ version: 1, files: [] }),
    listServers: vi.fn(),
    connectServer: vi.fn(),
    disconnectServer: vi.fn(),
    removeServer: vi.fn(),
    getRunner: vi.fn().mockResolvedValue({
      protocolVersion: 1,
      runnerId: "runner",
      name: "Linux",
      capabilities: {
        taskExecution: true,
        instructionSync: true,
        eventReplay: true,
        taskContinuation: true,
        taskLaunchOptions: true,
      },
    }),
    listProjects: vi.fn(async ({ serverId }: { serverId: string }) => ({
      items: (projects[serverId] ?? []).map((id) => ({ id, name: id })),
    })),
    cloneProject: vi.fn(),
    getProjectClone: vi.fn(),
    cancelProjectClone: vi.fn(),
    listTasks: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    createTask: vi.fn(
      async (request: Pick<RemoteRunnerTask, "parts" | "provider" | "launch" | "isolation">) => {
        created = {
          id: "carried-turn",
          runnerId: "runner",
          sequence: 1,
          provider: request.provider,
          launch: request.launch,
          isolation: request.isolation,
          status: "draft",
          parts: request.parts,
          createdAt: "2026-09-13T00:00:00Z",
        };
        return { created: true, task: created };
      },
    ),
    startTask: vi.fn(async () => ({ ...created, status: "running", projectId: "project" })),
    getTask: vi.fn(),
    getTaskResume: vi.fn().mockResolvedValue({ available: true, reason: null }),
    continueTask: vi.fn(),
    cancelTask: vi.fn(),
    listEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getDiff: vi.fn(),
    uploadAttachment: vi.fn(
      async (request: { serverId: string; attachmentId: string; name: string }) => {
        uploaded.push({ serverId: request.serverId, name: request.name });
        return {
          created: true,
          attachment: {
            id: request.attachmentId,
            runnerId: "runner",
            name: request.name,
            mediaType: "image/png",
            bytes: 4,
            width: 10,
            height: 10,
            sha256: "a".repeat(64),
            createdAt: "2026-09-13T00:00:00Z",
          },
        };
      },
    ),
    getAttachment: vi.fn(),
    readAttachment: vi.fn(),
  };
  return { gateway, uploaded, port: gateway as unknown as RemoteRunnerGateway };
}

const IMAGE_SURFACE: AgentImageSurfacePort = {
  decode: async () => ({ width: 10, height: 10 }),
  encodeMime: async () => "image/png",
  encode: async () => new ArrayBuffer(4),
  release: () => undefined,
};

const ATTACHMENT_ENCODER = {
  encode: async (bytes: Uint8Array<ArrayBuffer>) => btoa(String.fromCharCode(...bytes)),
};

export function pastedImage(name = "shot.png"): AgentAttachmentSource {
  return { kind: "bytes", name, mime: "image/png", bytes: new ArrayBuffer(4) };
}

export async function setupRunOnDraft(options: RunOnDraftOptions = {}) {
  let nextUrl = 0;
  const revoked: string[] = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => `blob:run-on-${(nextUrl += 1)}`;
      static revokeObjectURL = (url: string) => revoked.push(url);
    },
  );
  const local = localAttachmentGateway();
  const remote = remoteRunnerGateway(
    options.remoteProjects ?? { [RUN_ON_SERVER.id]: ["project", "other"] },
  );
  const drafts = options.drafts ?? createAgentComposerDraftStore();
  let servers = options.servers ?? [RUN_ON_SERVER];
  const links = options.links ?? new Map<string, string>();
  const startLocalThread = vi.fn<AgentThreadsSurface["startThread"]>(async () => ({
    threadId: "agt-started",
  }));
  let localProjects = options.localProjects ?? [projectFixture()];
  let view: RunOnDraftView | null = null;

  function Harness({
    projects,
    connections,
  }: {
    readonly projects: ReadonlyArray<AgentProjectDescriptor>;
    readonly connections: ReadonlyArray<RemoteRunnerServer>;
  }) {
    const [selectedServerId, selectServer] = useState<string | null>(null);
    const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
    const resolveOwner = (projectRootKey: string): AgentAttachmentOwner | null => {
      const project = projects.find((candidate) => candidate.rootKey === projectRootKey);
      if (project === undefined) return null;
      return {
        projectRootKey,
        ownerId: project.ownerId,
        generation: project.generation,
        workspaceId: `workspace:${projectRootKey}`,
      };
    };
    const localAttachments = useAgentComposerAttachments({
      gateway: local.gateway,
      imageSurface: IMAGE_SURFACE,
      resolveOwner,
      reportError: () => undefined,
    });
    const localSurface = useMemo(
      () =>
        threadsSurfaceFixture({
          threads: options.threads ?? [],
          startThread: startLocalThread,
        }),
      [],
    );
    const unified = useUnifiedAgentThreads({
      local: { ...localSurface, attachments: localAttachments },
      gateway: remote.port,
      servers: connections,
      selectedServerId,
      workspaceOwner: "A",
      selectedThreadId,
      localProjects: projects,
      imageSurface: IMAGE_SURFACE,
      attachmentEncoder: ATTACHMENT_ENCODER,
      gitSync: null,
      repositoryIdentity: null,
      externalUrlOpener: null,
    });
    const agents = unified.agents;
    const allProjects = unified.projects;
    const executionGroups = useMemo(
      () => agentProjectGroups(allProjects, agents.threads, agents.orphanedWorktrees),
      [agents.orphanedWorktrees, agents.threads, allProjects],
    );
    const groups = useMemo(
      () => groupedEnvironmentProjects(executionGroups, allProjects, links),
      [executionGroups, allProjects],
    );
    const navigation = useAgentThreadNavigation({
      agents,
      groups,
      presentationThreads: agents.threads,
      projects: allProjects,
      authoritativeRemoteProjectKeys: unified.authoritativeRemoteProjectKeys,
    });
    const navigatedThreadId = navigation.selectedThreadId;
    useLayoutEffect(() => setSelectedThreadId(navigatedThreadId), [navigatedThreadId]);
    const selectedThread = navigation.selectedThread;
    const composerScope = useMemo(
      () =>
        selectedThread === null
          ? environmentComposerScope(
              navigation.composerScope,
              groups,
              allProjects,
              selectedServerId,
            )
          : navigation.composerScope,
      [selectedThread, navigation.composerScope, groups, allProjects, selectedServerId],
    );
    const composerProjects = useMemo(() => {
      if (selectedThread !== null) return allProjects;
      const prefix =
        selectedServerId === null ? null : `remote:${encodeURIComponent(selectedServerId)}:`;
      return allProjects.filter((project) =>
        prefix === null
          ? !project.rootKey.startsWith("remote:")
          : project.rootKey.startsWith(prefix),
      );
    }, [allProjects, selectedServerId, selectedThread]);
    const composer = useAgentComposerState({
      agents,
      drafts,
      groups: executionGroups,
      projects: composerProjects,
      providerEnabled: { claudeCode: true, codex: true },
      railScope: composerScope,
      selectedThread,
      onClearSelectedThread: navigation.clearSelectedThread,
      onThreadStarted: navigation.selectStartedThread,
    });
    view = { composer, navigation, selectedServerId, selectServer };
    return null;
  }

  const root = createRoot(document.createElement("div"));
  const render = () =>
    act(async () => {
      const harness = createElement(Harness, { connections: servers, projects: localProjects });
      root.render(options.strict === true ? createElement(StrictMode, null, harness) : harness);
    });
  const current = (): RunOnDraftView => {
    expect(view).not.toBeNull();
    return view as RunOnDraftView;
  };
  await render();
  await act(async () => {
    await vi.waitFor(() =>
      expect(remote.gateway.listProjects.mock.calls.length).toBeGreaterThanOrEqual(servers.length),
    );
  });
  const props = () => current().composer.composerProps;
  const attachmentDrafts = (): ReadonlyArray<AgentComposerAttachmentDraft> =>
    props().attachments?.drafts ?? [];
  return {
    drafts,
    local,
    remote,
    revoked,
    startLocalThread,
    current,
    props,
    attachmentDrafts,
    replaceLocalProjects: (next: ReadonlyArray<AgentProjectDescriptor>) => {
      localProjects = next;
      return render();
    },
    replaceServers: (next: ReadonlyArray<RemoteRunnerServer>) => {
      servers = next;
      return render();
    },
    runOn: (serverId: string | null) =>
      act(async () => {
        current().selectServer(serverId);
      }),
    type: (text: string) => act(() => props().onPromptChange(text)),
    attach: (sources: ReadonlyArray<AgentAttachmentSource>) =>
      act(async () => {
        const attachments = props().attachments;
        const target = props().attachmentTargetKey ?? null;
        expect(attachments).not.toBeNull();
        expect(target).not.toBeNull();
        await attachments?.add(target ?? "", sources);
      }),
    settle: (assertion: () => void) =>
      act(async () => {
        await vi.waitFor(assertion);
      }),
    unmount: () => {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    },
  };
}

export type RunOnDraftHarness = Awaited<ReturnType<typeof setupRunOnDraft>>;
