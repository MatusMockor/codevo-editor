// @vitest-environment jsdom
import { act, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAttachment } from "../domain/agentAttachment";
import type {
  RemoteRunnerAttachment,
  RemoteRunnerGateway,
  RemoteRunnerServer,
  RemoteRunnerTask,
} from "../domain/remoteRunner";
import { RemoteRunnerRequestRejectedError } from "../domain/remoteRunnerErrors";
import {
  AgentTurnAttachments,
  type AgentTurnAttachmentImageViewer,
} from "../components/agentMode/AgentTurnAttachments";
import { agentTurnAttachmentViews } from "../components/agentMode/agentTurnAttachmentPresentation";
import { surfaceThreadView } from "../components/agentMode/agentSurfaceTestFixtures";
import {
  projectFixture,
  threadsSurfaceFixture,
} from "../components/agentMode/agentThreadsSurfaceTestFixtures";
import { useAgentTurnAttachmentImagePort } from "../components/agentMode/useAgentTurnAttachmentImages";
import type { AgentThreadsSurface } from "./agentThreadPorts";
import { remoteAgentProjectKey, remoteAgentThreadKey } from "./remoteAgentProjection";
import { remoteAttachmentUnavailableMessage } from "./remoteAttachmentHistory";
import { AGENT_ATTACHMENTS_DISCARDED_NOTICE } from "./agentTurnAttachments";
import { REMOTE_ATTACHMENTS_TRUNCATED_NOTICE } from "./useRemoteAttachmentHistory";
import { agentAttachmentImageKey } from "./useAgentAttachmentImages";
import { useUnifiedAgentThreads, type UnifiedAgentThreadsOptions } from "./useUnifiedAgentThreads";

const server: RemoteRunnerServer = {
  id: "server",
  name: "Linux",
  host: "linux",
  username: "user",
  port: 22,
  connected: true,
};
const attachmentId = "11111111-1111-4111-8111-111111111111";
const displayId = attachmentId.replace(/-/g, "");
const turn: RemoteRunnerTask = {
  id: "root",
  runnerId: "runner",
  sequence: 1,
  provider: "codex",
  launch: { provider: "codex", model: "default", mode: "default" },
  projectId: "project",
  status: "succeeded",
  parts: [
    { type: "text", text: "Look at this" },
    { type: "attachment", attachmentId },
  ],
  createdAt: "2026-09-13T00:00:00Z",
};
const metadata: RemoteRunnerAttachment = {
  id: attachmentId,
  runnerId: "runner",
  name: "shot.png",
  mediaType: "image/png",
  bytes: 4,
  width: 1,
  height: 1,
  sha256: "a".repeat(64),
  createdAt: turn.createdAt,
};
const remoteId = remoteAgentThreadKey(server.id, "runner", "root");
const projectKey = remoteAgentProjectKey(server.id, "runner", "project");
const imageKey = agentAttachmentImageKey(projectKey, remoteId, displayId);
const listTurns = async ({ after }: { after: number }) => ({
  items: after === 0 ? [turn] : [],
  nextCursor: null,
});
const siblingId = "33333333-3333-4333-8333-333333333333";
const pairedTurn: RemoteRunnerTask = {
  ...turn,
  parts: [...turn.parts, { type: "attachment", attachmentId: siblingId }],
};
const metadataOf = async ({ attachmentId: id }: { attachmentId: string }) => ({
  ...metadata,
  id,
  name: id === siblingId ? "sibling.png" : metadata.name,
});
const notFound = () => new RemoteRunnerRequestRejectedError("Runner request failed (HTTP 404).");
const numbered = (index: number): string =>
  `${index.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
function conversation(
  rootId: string,
  turns: number,
  perTurn: number,
  firstSequence: number,
  firstImage: number,
): readonly RemoteRunnerTask[] {
  return Array.from({ length: turns }, (_, index) => ({
    ...turn,
    id: index === 0 ? rootId : `${rootId}-${index}`,
    sequence: firstSequence + index,
    ...(index === 0
      ? {}
      : {
          conversationId: rootId,
          parentTaskId: index === 1 ? rootId : `${rootId}-${index - 1}`,
        }),
    parts: Array.from({ length: perTurn }, (_, offset) => ({
      type: "attachment" as const,
      attachmentId: numbered(firstImage + index * perTurn + offset),
    })),
  }));
}
function serve(gw: ReturnType<typeof gateway>, tasks: readonly RemoteRunnerTask[]): void {
  gw.listTasks.mockImplementation(async ({ after }: { after: number }) => ({
    items: tasks.filter((item) => item.sequence > after).slice(0, 64),
    nextCursor: null,
  }));
  gw.getTask.mockImplementation(
    async ({ taskId }: { taskId: string }) => tasks.find((item) => item.id === taskId) ?? turn,
  );
  gw.getAttachment.mockImplementation(metadataOf);
}

function gateway() {
  return {
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
    listProjects: vi.fn().mockResolvedValue({ items: [{ id: "project", name: "App" }] }),
    cloneProject: vi.fn(),
    getProjectClone: vi.fn(),
    cancelProjectClone: vi.fn(),
    listTasks: vi.fn().mockImplementation(listTurns),
    createTask: vi.fn(),
    startTask: vi.fn(),
    getTask: vi.fn().mockResolvedValue(turn),
    getTaskResume: vi.fn().mockResolvedValue({ available: true, reason: null }),
    continueTask: vi.fn(),
    cancelTask: vi.fn(),
    listEvents: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getDiff: vi.fn(),
    uploadAttachment: vi.fn(),
    getAttachment: vi.fn().mockResolvedValue(metadata),
    readAttachment: vi.fn().mockResolvedValue({ mediaType: "image/png", base64: "iVBORw==" }),
  } satisfies RemoteRunnerGateway;
}

function TurnImages({
  attachments,
  images,
}: {
  readonly attachments: ReadonlyArray<AgentAttachment> | undefined;
  readonly images: AgentTurnAttachmentImageViewer | null;
}) {
  const views = useMemo(() => agentTurnAttachmentViews(attachments, ""), [attachments]);
  return <AgentTurnAttachments attachments={views} images={images} />;
}

function Transcript({
  agents,
  threadId,
  workspaceId,
}: {
  readonly agents: AgentThreadsSurface;
  readonly threadId: string;
  readonly workspaceId: string;
}) {
  const owner = useMemo(() => ({ workspaceId, threadId }), [workspaceId, threadId]);
  const port = useAgentTurnAttachmentImagePort(agents.attachmentImages, null, owner);
  const viewer = useMemo<AgentTurnAttachmentImageViewer | null>(
    () => (port === null ? null : { ...port, open: () => undefined }),
    [port],
  );
  const view = agents.threads.find((candidate) => candidate.thread.threadId === threadId);
  return (
    <>
      {view?.thread.turns.map((item) => (
        <TurnImages attachments={item.attachments} images={viewer} key={item.turnId} />
      ))}
    </>
  );
}

const disposers: (() => void)[] = [];
const revokeObjectURL = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let nextUrl = 0;
  revokeObjectURL.mockClear();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => `blob:remote-${(nextUrl += 1)}`;
      static revokeObjectURL = revokeObjectURL;
    },
  );
});
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.unstubAllGlobals();
});

async function setup(
  selectedThreadId: string | null,
  configure?: (configured: ReturnType<typeof gateway>) => void,
) {
  const gw = gateway();
  configure?.(gw);
  let options: UnifiedAgentThreadsOptions = {
    local: threadsSurfaceFixture({ threads: [surfaceThreadView()] }),
    gateway: gw,
    servers: [server],
    selectedServerId: server.id,
    workspaceOwner: "A",
    selectedThreadId,
    localProjects: [projectFixture()],
    gitSync: null,
    repositoryIdentity: null,
    externalUrlOpener: null,
  };
  let current!: ReturnType<typeof useUnifiedAgentThreads>;
  let workspaceId = projectKey;
  const container = document.createElement("div");
  const root = createRoot(container);
  const listedPerRender: number[] = [];
  const listedNames = (): readonly string[] =>
    current.agents.threads
      .find((view) => view.thread.threadId === options.selectedThreadId)
      ?.thread.turns.flatMap((item) => item.attachments ?? [])
      .map((attachment) => attachment.name) ?? [];
  function Harness() {
    current = useUnifiedAgentThreads(options);
    listedPerRender.push(listedNames().length);
    return options.selectedThreadId === null ? null : (
      <Transcript
        agents={current.agents}
        threadId={options.selectedThreadId}
        workspaceId={workspaceId}
      />
    );
  }
  const render = (patch: Partial<UnifiedAgentThreadsOptions> = {}, workspace = workspaceId) => {
    options = { ...options, ...patch };
    workspaceId = workspace;
    return act(async () => {
      root.render(<Harness />);
    });
  };
  disposers.push(() => act(() => root.unmount()));
  await render();
  return {
    gw,
    render,
    refresh: () =>
      act(async () => {
        await current.refreshRemote();
      }),
    settle: (assertion: () => void) =>
      act(async () => {
        await vi.waitFor(assertion);
      }),
    shown: () => [...container.querySelectorAll("img")].map((image) => image.getAttribute("src")),
    unavailable: () =>
      [...container.querySelectorAll('[data-agent-attachment="unavailable"]')].map(
        (chip) => chip.getAttribute("title") ?? "",
      ),
    listed: listedNames,
    listedPerRender,
    get current() {
      return current;
    },
  };
}

async function stageServerDraft(h: Awaited<ReturnType<typeof setup>>) {
  await h.render({
    imageSurface: {
      decode: async () => ({ width: 1, height: 1 }),
      encodeMime: async () => "image/png",
      encode: async () => new ArrayBuffer(4),
      release: () => undefined,
    },
  });
  const key = `new:${projectKey}`;
  const draft = () => h.current.agents.attachments.forDraft!(key);
  await act(async () => {
    await draft().add(projectKey, [
      { kind: "bytes", name: "draft.png", mime: "image/png", bytes: new ArrayBuffer(4) },
    ]);
  });
  expect(draft().drafts).toHaveLength(1);
  const saved = draft().drafts[0]!;
  expect(saved.state).toBe("ready");
  return Object.assign(draft, { saved, key });
}

describe("server thread images across inventory connectivity", () => {
  it("retains a new server draft image across local workspace A B A and thread navigation", async () => {
    const h = await setup(null);
    await h.render({
      imageSurface: {
        decode: async () => ({ width: 1, height: 1 }),
        encodeMime: async () => "image/png",
        encode: async () => new ArrayBuffer(4),
        release: () => undefined,
      },
    });
    const draftKey = `new:${projectKey}`;
    const draft = () => h.current.agents.attachments.forDraft!(draftKey);
    await act(async () => {
      await draft().add(projectKey, [
        { kind: "bytes", name: "draft.png", mime: "image/png", bytes: new ArrayBuffer(4) },
      ]);
    });
    expect(draft().drafts).toHaveLength(1);
    const saved = draft().drafts[0];
    const generation = h.current.projects.find(
      (project) => project.rootKey === projectKey,
    )!.generation;

    await h.render({
      workspaceOwner: "B",
      selectedThreadId: "local-thread",
      selectedServerId: null,
    });
    await h.render({ workspaceOwner: "A", selectedThreadId: null, selectedServerId: server.id });
    expect(draft().drafts).toEqual([saved]);
    expect(h.current.projects.find((project) => project.rootKey === projectKey)!.generation).toBe(
      generation,
    );
    expect(revokeObjectURL).not.toHaveBeenCalledWith(saved!.previewUrl);
    await act(async () => {
      expect(await draft().prepareTurn(projectKey)).toMatchObject({ draftIds: [saved!.draftId] });
    });

    await h.render({ servers: [{ ...server, host: "replacement" }] });
    expect(draft().drafts).toEqual([]);
    expect(draft().refusal).toBe(AGENT_ATTACHMENTS_DISCARDED_NOTICE);
    expect(revokeObjectURL).toHaveBeenCalledWith(saved!.previewUrl);
  });

  it("discards a retained server draft with the notice when its server is replaced while another workspace is active", async () => {
    const h = await setup(null);
    const draft = await stageServerDraft(h);
    await h.render({
      workspaceOwner: "B",
      selectedThreadId: "local-thread",
      selectedServerId: null,
    });
    await h.render({ servers: [{ ...server, host: "replacement" }] });
    await h.render({ workspaceOwner: "A", selectedThreadId: null, selectedServerId: server.id });
    expect(draft().drafts).toEqual([]);
    expect(draft().refusal).toBe(AGENT_ATTACHMENTS_DISCARDED_NOTICE);
    expect(revokeObjectURL).toHaveBeenCalledWith(draft.saved.previewUrl);
  });

  it("discards a retained server draft with the notice when the server is removed", async () => {
    const h = await setup(null);
    const draft = await stageServerDraft(h);
    await h.render({ servers: [], selectedServerId: null });
    await h.render({ servers: [server], selectedServerId: server.id });
    expect(draft().drafts).toEqual([]);
    expect(draft().refusal).toBe(AGENT_ATTACHMENTS_DISCARDED_NOTICE);
    expect(revokeObjectURL).toHaveBeenCalledWith(draft.saved.previewUrl);
  });

  it("discards a retained server draft with the notice when the runner no longer lists its project", async () => {
    const h = await setup(null);
    const draft = await stageServerDraft(h);
    h.gw.listProjects.mockResolvedValue({ items: [] });
    await h.refresh();
    expect(draft().drafts).toEqual([]);
    expect(draft().refusal).toBe(AGENT_ATTACHMENTS_DISCARDED_NOTICE);
    expect(revokeObjectURL).toHaveBeenCalledWith(draft.saved.previewUrl);
  });

  it("discards a retained server draft with the notice when the remote gateway is replaced", async () => {
    const h = await setup(null);
    const draft = await stageServerDraft(h);
    await h.render({ gateway: { ...h.gw } });
    expect(draft().drafts).toEqual([]);
    expect(draft().refusal).toBe(AGENT_ATTACHMENTS_DISCARDED_NOTICE);
    expect(revokeObjectURL).toHaveBeenCalledWith(draft.saved.previewUrl);
  });

  it("never surfaces a retained server draft under another project key or the local surface", async () => {
    const h = await setup(null);
    const draft = await stageServerDraft(h);
    const otherKey = `new:${remoteAgentProjectKey(server.id, "runner", "other")}`;
    expect(h.current.agents.attachments.forDraft!(otherKey).drafts).toEqual([]);
    await h.render({ selectedServerId: null });
    const local = h.current.agents.attachments;
    expect((local.forDraft?.(draft.key) ?? local).drafts).toEqual([]);
    await h.render({ selectedServerId: server.id });
    expect(draft().drafts).toEqual([draft.saved]);
    expect(draft().refusal).toBeNull();
  });

  it("keeps screenshot intake local during a failed inventory refresh, then uploads with Codex High", async () => {
    const h = await setup(null);
    await h.render({
      selectedProjectRootKey: projectKey,
      attachmentEncoder: { encode: async (bytes) => btoa(String.fromCharCode(...bytes)) },
      imageSurface: {
        decode: async () => ({ width: 1, height: 1 }),
        encodeMime: async () => "image/png",
        encode: async () => new ArrayBuffer(4),
        release: () => undefined,
      },
    });
    const draft = () => h.current.agents.attachments.forDraft!(`new:${projectKey}`);
    await act(async () => {
      await draft().add(projectKey, [
        { kind: "bytes", name: "first.png", mime: "image/png", bytes: new ArrayBuffer(4) },
      ]);
    });
    const first = draft().drafts[0]!;
    h.gw.listTasks.mockRejectedValueOnce(new Error("Temporary history failure"));
    await h.refresh();
    expect(draft().drafts).toEqual([first]);
    expect(revokeObjectURL).not.toHaveBeenCalledWith(first.previewUrl);
    const intake = draft().captureIntake!(projectKey);
    expect(intake).toBeTypeOf("function");
    await act(async () => {
      await intake!([
        { kind: "bytes", name: "second.png", mime: "image/png", bytes: new ArrayBuffer(4) },
      ]);
    });
    expect(draft().drafts).toHaveLength(2);
    expect(
      draft().drafts.every((image) => image.state === "ready" && image.previewUrl !== null),
    ).toBe(true);
    expect(h.gw.uploadAttachment).not.toHaveBeenCalled();
    await h.refresh();
    const launch = {
      provider: "codex",
      model: "gpt-5.4",
      mode: "default",
      effort: "high",
    } as const;
    h.gw.uploadAttachment.mockImplementation(async (request) => ({
      created: true,
      attachment: { ...metadata, id: request.attachmentId, name: request.name },
    }));
    let created!: RemoteRunnerTask;
    h.gw.createTask.mockImplementation(async (request) => {
      created = {
        ...turn,
        id: "screenshot-turn",
        parts: request.parts,
        launch,
        status: "draft",
        projectId: undefined,
      };
      return { created: true, task: created };
    });
    h.gw.startTask.mockImplementation(async () => ({
      ...created,
      status: "running",
      projectId: "project",
    }));
    await act(async () => {
      const prepared = await draft().prepareTurn(projectKey);
      expect(prepared).not.toBeNull();
      expect(
        await h.current.agents.startThread({
          projectRootKey: projectKey,
          repositoryRoot: projectKey,
          prompt: "Review these screenshots",
          unsafeInPlaceConfirmationKey: null,
          launch,
          isolation: "worktree",
          attachments: prepared!.intents,
          attachmentOwner: prepared!.owner,
        }),
      ).toEqual({ threadId: remoteAgentThreadKey("server", "runner", "screenshot-turn") });
    });
    expect(h.gw.uploadAttachment).toHaveBeenCalledTimes(2);
    expect(h.gw.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: "server",
        provider: "codex",
        launch,
        parts: [
          { type: "text", text: "Review these screenshots" },
          ...h.gw.uploadAttachment.mock.calls.map(([request]) => ({
            type: "attachment",
            attachmentId: request.attachmentId,
          })),
        ],
      }),
    );
  });

  it("keeps a sent image viewable when one inventory refresh fails and the next succeeds", async () => {
    const h = await setup(remoteId);
    await h.settle(() => expect(h.shown()).toEqual(["blob:remote-1"]));
    expect(h.current.agents.agentCliConfigured).toBe(true);

    h.gw.listTasks.mockRejectedValueOnce(new Error("Runner restarting"));
    await h.refresh();
    expect(h.current.agents.agentCliConfigured).toBe(false);
    expect(h.shown()).toEqual(["blob:remote-1"]);
    expect(h.listed()).toEqual(["shot.png"]);

    await h.refresh();
    expect(h.current.agents.agentCliConfigured).toBe(true);
    expect(h.shown()).toEqual(["blob:remote-1"]);
    expect(h.listed()).toEqual(["shot.png"]);
    expect(h.unavailable()).toEqual([]);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(h.gw.getAttachment).toHaveBeenCalledTimes(1);
    expect(h.gw.readAttachment).toHaveBeenCalledTimes(1);

    await h.render({ selectedThreadId: null });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:remote-1");
    await h.render({ selectedThreadId: remoteId });
    await h.settle(() => expect(h.shown()).toEqual(["blob:remote-2"]));
    expect(h.unavailable()).toEqual([]);
    expect(h.gw.getAttachment).toHaveBeenCalledTimes(1);
    expect(h.gw.readAttachment).toHaveBeenCalledTimes(2);
  });

  it("reads an image again after the outage that broke its first read has ended", async () => {
    const h = await setup(remoteId, (gw) => {
      gw.readAttachment.mockRejectedValueOnce(new Error("ssh: connection reset by 10.0.0.7"));
    });
    const readFailed = remoteAttachmentUnavailableMessage("readFailed");
    await h.settle(() => expect(h.unavailable()).toEqual([`shot.png: ${readFailed}`]));
    expect(h.current.agents.notice?.message).toBe(readFailed);

    h.gw.listTasks.mockRejectedValueOnce(new Error("Runner restarting"));
    await h.refresh();
    expect(h.current.agents.agentCliConfigured).toBe(false);
    expect(h.gw.readAttachment).toHaveBeenCalledTimes(1);

    await h.refresh();
    await h.settle(() => expect(h.shown()).toEqual(["blob:remote-1"]));
    expect(h.unavailable()).toEqual([]);
    expect(h.gw.getAttachment).toHaveBeenCalledTimes(1);
    expect(h.gw.readAttachment).toHaveBeenCalledTimes(2);
  });

  it("requests nothing from a disconnected server and shows the image once it reconnects", async () => {
    const h = await setup(null);
    await h.settle(() => expect(h.current.agents.agentCliConfigured).toBe(true));
    h.gw.listTasks.mockRejectedValue(new Error("Runner restarting"));
    await h.refresh();
    expect(h.current.agents.agentCliConfigured).toBe(false);
    await h.render({ selectedThreadId: remoteId });
    await h.refresh();
    expect(h.current.agents.agentCliConfigured).toBe(false);
    expect(h.listed()).toEqual([]);

    await act(async () => {
      h.current.agents.attachmentImages.ensure({
        workspaceId: projectKey,
        threadId: remoteId,
        attachmentId: displayId,
        mime: "image/png",
      });
    });
    expect(h.current.agents.attachmentImages.images.get(imageKey)).toEqual({
      kind: "unavailable",
      reason: remoteAttachmentUnavailableMessage("notConnected"),
    });
    expect(h.gw.getAttachment).not.toHaveBeenCalled();
    expect(h.gw.readAttachment).not.toHaveBeenCalled();

    h.gw.listTasks.mockImplementation(listTurns);
    await h.refresh();
    await h.settle(() => expect(h.shown()).toEqual(["blob:remote-1"]));
    expect(h.unavailable()).toEqual([]);
    expect(h.gw.getAttachment).toHaveBeenCalledTimes(1);
    expect(h.gw.readAttachment).toHaveBeenCalledTimes(1);
  });

  it("tells the user when the server no longer stores a sent image", async () => {
    const h = await setup(remoteId, (gw) => {
      gw.getAttachment.mockRejectedValue(notFound());
    });
    const notStored = remoteAttachmentUnavailableMessage("notStored");
    await h.settle(() => expect(h.current.agents.notice?.message).toBe(notStored));
    await h.refresh();
    await h.refresh();
    expect(h.gw.getAttachment).toHaveBeenCalledTimes(1);
    expect(h.gw.readAttachment).not.toHaveBeenCalled();
    expect(h.listed()).toEqual([]);
  });

  it("recovers only the image whose read failed and keeps its ready sibling untouched", async () => {
    const h = await setup(remoteId, (gw) => {
      gw.listTasks.mockImplementation(async ({ after }: { after: number }) => ({
        items: after === 0 ? [pairedTurn] : [],
        nextCursor: null,
      }));
      gw.getTask.mockResolvedValue(pairedTurn);
      gw.getAttachment.mockImplementation(metadataOf);
      gw.readAttachment.mockImplementationOnce(async () => ({
        mediaType: "image/png",
        base64: "iVBORw==",
      }));
      gw.readAttachment.mockRejectedValueOnce(new Error("ssh: connection reset by 10.0.0.7"));
    });
    const readFailed = remoteAttachmentUnavailableMessage("readFailed");
    await h.settle(() => {
      expect(h.shown()).toEqual(["blob:remote-1"]);
      expect(h.unavailable()).toEqual([`sibling.png: ${readFailed}`]);
    });

    h.gw.listTasks.mockRejectedValueOnce(new Error("Runner restarting"));
    await h.refresh();
    expect(h.current.agents.agentCliConfigured).toBe(false);
    await h.refresh();
    await h.settle(() => expect(h.shown()).toEqual(["blob:remote-1", "blob:remote-2"]));
    expect(h.unavailable()).toEqual([]);
    expect(h.listed()).toEqual(["shot.png", "sibling.png"]);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(h.gw.getAttachment).toHaveBeenCalledTimes(2);
    expect(h.gw.readAttachment).toHaveBeenCalledTimes(3);
  });

  it("asks again for an image that was missing only during a restart window", async () => {
    const h = await setup(remoteId, (gw) => {
      gw.getAttachment.mockRejectedValueOnce(notFound());
    });
    const notStored = remoteAttachmentUnavailableMessage("notStored");
    await h.settle(() => expect(h.current.agents.notice?.message).toBe(notStored));
    await h.refresh();
    expect(h.gw.getAttachment).toHaveBeenCalledTimes(1);

    h.gw.listTasks.mockRejectedValueOnce(new Error("Runner restarting"));
    await h.refresh();
    expect(h.gw.getAttachment).toHaveBeenCalledTimes(1);
    await h.refresh();
    await h.settle(() => expect(h.shown()).toEqual(["blob:remote-1"]));
    expect(h.gw.getAttachment).toHaveBeenCalledTimes(2);
  });

  it("raises one fixed notice for image details the server cannot provide", async () => {
    const h = await setup(remoteId, (gw) => {
      gw.getAttachment.mockRejectedValue(
        new Error("ssh: connect to host 10.0.0.7 port 22: Connection refused"),
      );
    });
    const loadFailed = remoteAttachmentUnavailableMessage("loadFailed");
    await h.settle(() => expect(h.current.agents.notice?.message).toBe(loadFailed));
    await act(async () => h.current.agents.dismissNotice());
    await h.refresh();
    await h.refresh();
    expect(h.current.agents.notice).toBeNull();
    expect(h.gw.getAttachment).toHaveBeenCalledTimes(1);
    expect(h.listed()).toEqual([]);

    await act(async () => {
      h.current.agents.attachmentImages.ensure({
        workspaceId: projectKey,
        threadId: remoteId,
        attachmentId: displayId,
        mime: "image/png",
      });
    });
    expect(h.current.agents.attachmentImages.images.get(imageKey)).toEqual({
      kind: "unavailable",
      reason: loadFailed,
    });
    expect(h.gw.readAttachment).not.toHaveBeenCalled();
  });

  it("revokes previews when the server disconnects and loads them again after it reconnects", async () => {
    const h = await setup(remoteId);
    await h.settle(() => expect(h.shown()).toEqual(["blob:remote-1"]));

    await h.render({ servers: [{ ...server, connected: false }] });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:remote-1");
    expect(h.shown()).toEqual([]);
    expect(h.listed()).toEqual([]);
    expect(h.current.agents.attachmentImages.images.get(imageKey)).toBeUndefined();
    expect(h.gw.readAttachment).toHaveBeenCalledTimes(1);

    await h.render({ servers: [server] });
    await h.settle(() => expect(h.shown()).toEqual(["blob:remote-2"]));
    expect(h.gw.getAttachment).toHaveBeenCalledTimes(2);
    expect(h.gw.readAttachment).toHaveBeenCalledTimes(2);
  });

  it("shows nothing retained from the previous runner after the runner identity changes", async () => {
    const h = await setup(remoteId);
    await h.settle(() => expect(h.shown()).toEqual(["blob:remote-1"]));

    const replacement = { ...turn, runnerId: "runner-2" };
    const descriptor = await h.gw.getRunner();
    h.gw.getRunner.mockResolvedValue({ ...descriptor, runnerId: "runner-2" });
    h.gw.listTasks.mockImplementation(async ({ after }: { after: number }) => ({
      items: after === 0 ? [replacement] : [],
      nextCursor: null,
    }));
    h.gw.getTask.mockResolvedValue(replacement);
    h.gw.getAttachment.mockResolvedValue({ ...metadata, runnerId: "runner-2" });
    await h.refresh();
    expect(h.current.agents.agentCliConfigured).toBe(false);
    expect(h.gw.getAttachment).toHaveBeenCalledTimes(1);
    expect(h.gw.readAttachment).toHaveBeenCalledTimes(1);

    const nextThread = remoteAgentThreadKey(server.id, "runner-2", "root");
    const nextProject = remoteAgentProjectKey(server.id, "runner-2", "project");
    // A local tab switch no longer resets server identity. Replacing the remote
    // gateway explicitly establishes a new remote connection authority.
    await h.render(
      { gateway: { ...h.gw }, workspaceOwner: "B", selectedThreadId: nextThread },
      nextProject,
    );
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:remote-1");
    expect(h.current.agents.attachmentImages.images.get(imageKey)).toBeUndefined();
    await h.settle(() => expect(h.shown()).toEqual(["blob:remote-2"]));
    expect(h.gw.getAttachment).toHaveBeenCalledTimes(2);
    expect(h.gw.readAttachment).toHaveBeenCalledTimes(2);
    expect(
      h.current.agents.attachmentImages.images.get(
        agentAttachmentImageKey(nextProject, nextThread, displayId),
      ),
    ).toEqual({ kind: "ready", url: "blob:remote-2" });
  });

  it("drops images of a project the runner no longer lists and reloads them when it returns", async () => {
    const h = await setup(remoteId);
    await h.settle(() => expect(h.shown()).toEqual(["blob:remote-1"]));

    h.gw.listProjects.mockResolvedValue({ items: [] });
    await h.refresh();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:remote-1");
    expect(h.shown()).toEqual([]);
    expect(h.listed()).toEqual([]);
    expect(h.gw.readAttachment).toHaveBeenCalledTimes(1);

    h.gw.listProjects.mockResolvedValue({ items: [{ id: "project", name: "App" }] });
    await h.refresh();
    await h.settle(() => expect(h.shown()).toEqual(["blob:remote-2"]));
    expect(h.gw.getAttachment).toHaveBeenCalledTimes(2);
    expect(h.gw.readAttachment).toHaveBeenCalledTimes(2);
  });

  it("says once when a turn has more attachments than are shown", async () => {
    const [large] = conversation("root", 1, 70, 1, 1);
    const h = await setup(remoteId, (gw) => serve(gw, [large!]));
    await h.settle(() => {
      expect(h.listed()).toHaveLength(64);
      expect(h.current.agents.notice?.message).toBe(REMOTE_ATTACHMENTS_TRUNCATED_NOTICE);
    });
    expect(h.gw.getAttachment).toHaveBeenCalledTimes(64);

    await act(async () => h.current.agents.dismissNotice());
    await h.refresh();
    await h.refresh();
    expect(h.current.agents.notice).toBeNull();
    expect(h.listed()).toHaveLength(64);
    expect(h.gw.getAttachment).toHaveBeenCalledTimes(64);
  });

  it("reports a saturated image registry once instead of on every inventory refresh", async () => {
    const h = await setup(remoteId, (gw) => serve(gw, conversation("root", 11, 64, 1, 1)));
    const limit = remoteAttachmentUnavailableMessage("limit");
    await h.settle(() => {
      expect(h.listed()).toHaveLength(512);
      expect(h.current.agents.notice?.message).toBe(limit);
    });
    await h.refresh();
    expect(h.gw.getAttachment).toHaveBeenCalledTimes(512);

    await act(async () => h.current.agents.dismissNotice());
    await h.refresh();
    await h.refresh();
    expect(h.current.agents.notice).toBeNull();
    expect(h.listed()).toHaveLength(512);
    expect(h.gw.getAttachment).toHaveBeenCalledTimes(512);
  });

  it("evicts another conversation's oldest image to make room and fetches it again when viewed", async () => {
    const full = conversation("root", 8, 64, 1, 1);
    const solo = conversation("solo", 1, 1, 100, 9001);
    const soloId = remoteAgentThreadKey(server.id, "runner", "solo");
    const h = await setup(remoteId, (gw) => serve(gw, [...full, ...solo]));
    await h.settle(() => expect(h.listed()).toHaveLength(512));
    expect(h.gw.getAttachment).toHaveBeenCalledTimes(512);

    await h.render({ selectedThreadId: soloId });
    await h.settle(() => {
      expect(h.listed()).toHaveLength(1);
      expect(h.shown()).toHaveLength(1);
    });
    expect(h.gw.getAttachment).toHaveBeenCalledTimes(513);
    expect(h.current.agents.notice).toBeNull();

    await h.render({ selectedThreadId: remoteId });
    await h.settle(() => expect(h.listed()).toHaveLength(512));
    expect(h.gw.getAttachment).toHaveBeenCalledTimes(514);
    expect(h.gw.getAttachment).toHaveBeenLastCalledWith({
      serverId: server.id,
      attachmentId: numbered(1 + 7 * 64),
    });
    expect(h.current.agents.notice).toBeNull();
  });

  it("restarts the open conversation once per evicting load, not once per evicted image", async () => {
    const next = conversation("next", 2, 8, 100, 9001);
    const nextId = remoteAgentThreadKey(server.id, "runner", "next");
    const open = async (turns: number) => {
      const first = conversation("root", turns, 63, 1, 1);
      const h = await setup(remoteId, (gw) => serve(gw, [...first, ...next]));
      await h.settle(() => expect(h.listed()).toHaveLength(turns * 63));
      const from = h.listedPerRender.length;
      await h.render({ selectedThreadId: nextId });
      await h.settle(() => expect(h.listed()).toHaveLength(16));
      const counts = h.listedPerRender.slice(from);
      expect(h.gw.getAttachment).toHaveBeenCalledTimes(turns * 63 + 16);
      return {
        renders: counts.indexOf(16),
        resets: counts.filter((count, index) => count < (counts[index - 1] ?? 0)).length,
      };
    };
    const roomy = await open(1);
    const saturated = await open(8);
    expect(roomy.resets).toBe(0);
    expect(saturated.resets).toBe(0);
    expect(saturated.renders - roomy.renders).toBeLessThanOrEqual(1);
  });
});
