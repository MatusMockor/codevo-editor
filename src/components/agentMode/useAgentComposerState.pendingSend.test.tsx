// @vitest-environment jsdom

import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentFollowUpRequest,
  AgentThreadStartRequest,
  AgentThreadStartResult,
  AgentThreadsSurface,
  AgentThreadView,
} from "../../application/agentThreadPorts";
import type { AgentAttachmentGateway } from "../../application/agentAttachmentPorts";
import { useAgentComposerAttachments } from "../../application/useAgentComposerAttachments";
import { defaultAgentLaunchOptions } from "../../domain/agentLaunch";
import type { AgentTurn } from "../../domain/agentThread";
import { agentProjectGroups } from "./agentModePresentation";
import { SURFACE_FIXTURE_ROOT, surfaceThreadView } from "./agentSurfaceTestFixtures";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import { useAgentComposerState, type AgentComposerState } from "./useAgentComposerState";
import { useAgentThreadNavigation, type AgentThreadNavigation } from "./useAgentThreadNavigation";

const IMAGE_ID = "0123456789abcdef0123456789abcdef";
const OWNER = {
  projectRootKey: SURFACE_FIXTURE_ROOT,
  ownerId: "agent-root:app",
  generation: 0,
  workspaceId: "ws-app",
};

interface Captured {
  readonly composer: AgentComposerState;
  readonly navigation: AgentThreadNavigation;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function attachmentGateway(released: string[]): AgentAttachmentGateway {
  return {
    stageAgentAttachmentBytes: vi.fn(async ({ name, mime, width, height }) => ({
      attachmentId: IMAGE_ID,
      name,
      mime,
      bytes: 512,
      width,
      height,
      promptLineBytesMax: 120,
    })),
    inspectAgentAttachmentCandidate: vi.fn(),
    readAgentAttachmentCandidate: vi.fn(),
    claimAgentAttachments: vi.fn(),
    releaseAgentAttachment: vi.fn(async ({ attachmentId }) => {
      released.push(attachmentId);
    }),
    readAgentAttachment: vi.fn(),
    revealAgentAttachment: vi.fn(),
  };
}

function turn(turnId: string): AgentTurn {
  return {
    turnId,
    prompt: "Look",
    status: { kind: "pending" },
    startedAtEpochMs: 1,
    endedAtEpochMs: null,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

describe("composer optimistic send", () => {
  let host: HTMLDivElement;
  let root: Root;
  let captured: Captured | null;
  let released: string[];
  let revoked: string[];

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    captured = null;
    released = [];
    revoked = [];
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function current(): Captured {
    expect(captured).not.toBeNull();
    return captured as Captured;
  }

  function Harness({ agents }: { readonly agents: AgentThreadsSurface }) {
    const gateway = useMemo(() => attachmentGateway(released), []);
    const attachments = useAgentComposerAttachments({
      gateway,
      imageSurface: {
        decode: async () => ({ width: 40, height: 20 }),
        encodeMime: async () => "image/webp",
        encode: async () => new ArrayBuffer(8),
        release: () => undefined,
      },
      resolveOwner: (projectRootKey) => (projectRootKey === SURFACE_FIXTURE_ROOT ? OWNER : null),
      reportError: () => undefined,
      createDraftId: () => "draft-1",
      createObjectUrl: () => "blob:preview-1",
      revokeObjectUrl: (url) => revoked.push(url),
    });
    const surface = useMemo(() => ({ ...agents, attachments }), [agents, attachments]);
    const projects = useMemo(() => [projectFixture()], []);
    const groups = useMemo(
      () => agentProjectGroups(projects, surface.threads, surface.orphanedWorktrees),
      [projects, surface.orphanedWorktrees, surface.threads],
    );
    const navigation = useAgentThreadNavigation({
      agents: surface,
      groups,
      presentationThreads: surface.threads,
      projects,
    });
    const composer = useAgentComposerState({
      agents: surface,
      groups,
      projects,
      providerEnabled: { claudeCode: true, codex: true },
      railScope: navigation.composerScope,
      selectedThread: navigation.selectedThread,
      onClearSelectedThread: navigation.clearSelectedThread,
      onThreadStarted: navigation.selectStartedThread,
    });
    captured = { composer, navigation };
    return null;
  }

  function render(agents: AgentThreadsSurface): void {
    act(() => root.render(<Harness agents={agents} />));
  }

  async function attachImage(): Promise<void> {
    const attachments = current().composer.composerProps.attachments;
    await act(async () => {
      await attachments?.add(SURFACE_FIXTURE_ROOT, [
        { kind: "bytes", name: "shot.png", mime: "image/png", bytes: new ArrayBuffer(12) },
      ]);
    });
    expect(current().composer.composerProps.attachments?.drafts.map((d) => d.state)).toEqual([
      "ready",
    ]);
  }

  async function submit(prompt: string): Promise<void> {
    act(() => current().composer.composerProps.onPromptChange(prompt));
    await act(async () => {
      current().composer.composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: false,
      });
    });
  }

  function followUpSurface(
    threads: ReadonlyArray<AgentThreadView>,
    sendFollowUp: AgentThreadsSurface["sendFollowUp"],
    extra: Partial<AgentThreadsSurface> = {},
  ): AgentThreadsSurface {
    return threadsSurfaceFixture({ threads, sendFollowUp, ...extra });
  }

  it("clears the composer at once and shows the message with its local preview while sending", async () => {
    const send = deferred<boolean>();
    const sendFollowUp = vi.fn((_request: AgentFollowUpRequest) => send.promise);
    const threads = [surfaceThreadView()];
    render(followUpSurface(threads, sendFollowUp));
    act(() => current().navigation.selectThread("agt-1"));
    await attachImage();

    await submit("Look");

    expect(current().composer.composerProps.prompt).toBe("");
    expect(current().composer.composerProps.attachments?.drafts).toEqual([]);
    expect(current().composer.pendingSend).toMatchObject({
      prompt: "Look",
      status: "sending",
      attachments: [{ previewUrl: "blob:preview-1", view: { kind: "image", name: "shot.png" } }],
    });
    expect(sendFollowUp).toHaveBeenCalledTimes(1);
    expect(sendFollowUp.mock.calls[0]?.[0].attachments).toEqual([
      expect.objectContaining({ kind: "staged", attachmentId: IMAGE_ID }),
    ]);
    expect(revoked).toEqual([]);

    await act(async () => send.resolve(true));

    expect(current().composer.pendingSend).toBeNull();
    expect(current().composer.composerProps.attachments?.drafts).toEqual([]);
    expect(current().composer.composerProps.prompt).toBe("");
    expect(revoked).toEqual(["blob:preview-1"]);
    expect(released).toEqual([]);
  });

  it("hands over to the registered turn instead of showing the message twice", async () => {
    const send = deferred<boolean>();
    const threads = [surfaceThreadView()];
    render(followUpSurface(threads, () => send.promise));
    act(() => current().navigation.selectThread("agt-1"));
    await submit("Look");
    expect(current().composer.pendingSend?.prompt).toBe("Look");

    const registered = surfaceThreadView({
      thread: { ...threads[0]!.thread, turns: [turn("agt-1-t1")] },
    });
    render(followUpSurface([registered], () => send.promise));

    expect(current().composer.pendingSend).toBeNull();
    await act(async () => send.resolve(true));
    expect(current().composer.pendingSend).toBeNull();
  });

  it("marks the message as not sent and restores text and attachments when the send fails", async () => {
    const send = deferred<boolean>();
    render(followUpSurface([surfaceThreadView()], () => send.promise));
    act(() => current().navigation.selectThread("agt-1"));
    await attachImage();
    await submit("Look");

    await act(async () => send.resolve(false));

    expect(current().composer.pendingSend).toMatchObject({ prompt: "Look", status: "failed" });
    expect(current().composer.composerProps.prompt).toBe("Look");
    expect(
      current().composer.composerProps.attachments?.drafts.map((d) => [d.name, d.previewUrl]),
    ).toEqual([["shot.png", "blob:preview-1"]]);
    expect(revoked).toEqual([]);
    expect(released).toEqual([]);

    act(() => current().composer.dismissPendingSend());
    expect(current().composer.pendingSend).toBeNull();
    expect(current().composer.composerProps.attachments?.drafts).toHaveLength(1);
  });

  it("puts a failed message back next to text typed while it was sending", async () => {
    const send = deferred<boolean>();
    render(followUpSurface([surfaceThreadView()], () => send.promise));
    act(() => current().navigation.selectThread("agt-1"));
    await submit("Look");
    act(() => current().composer.composerProps.onPromptChange("Next"));

    await act(async () => send.resolve(false));

    expect(current().composer.pendingSend?.status).toBe("failed");
    expect(current().composer.composerProps.prompt).toBe("Next\n\nLook");
  });

  it("marks the message as not sent and restores it when the send throws", async () => {
    const send = deferred<boolean>();
    render(
      followUpSurface([surfaceThreadView()], () =>
        send.promise.then(() => Promise.reject(new Error("ipc"))),
      ),
    );
    act(() => current().navigation.selectThread("agt-1"));
    await attachImage();
    await submit("Look");

    await act(async () => send.resolve(true));

    expect(current().composer.pendingSend?.status).toBe("failed");
    expect(current().composer.composerProps.prompt).toBe("Look");
    expect(current().composer.composerProps.attachments?.drafts).toHaveLength(1);
  });

  it("restores the draft and withdraws the bubble when the send asks for a session restart", async () => {
    render(
      followUpSurface([surfaceThreadView()], async () => false, {
        followUpNeedsSessionRestart: () => true,
      }),
    );
    act(() => current().navigation.selectThread("agt-1"));
    await attachImage();
    await submit("Look");

    expect(current().composer.pendingSend).toBeNull();
    expect(current().composer.composerProps.prompt).toBe("Look");
    expect(current().composer.composerProps.attachments?.drafts).toHaveLength(1);
  });

  it("does not send the held attachments twice when submitted again while in flight", async () => {
    const send = deferred<boolean>();
    const sendFollowUp = vi.fn((_request: AgentFollowUpRequest) => send.promise);
    render(followUpSurface([surfaceThreadView()], sendFollowUp));
    act(() => current().navigation.selectThread("agt-1"));
    await attachImage();
    await submit("Look");
    await submit("Again");

    expect(
      sendFollowUp.mock.calls.filter(([request]) => (request.attachments?.length ?? 0) > 0),
    ).toHaveLength(1);
    await act(async () => send.resolve(true));
  });

  it("shows a new thread's first message on the empty composer until the thread starts", async () => {
    const start = deferred<AgentThreadStartResult | null>();
    const startThread = vi.fn((_request: AgentThreadStartRequest) => start.promise);
    render(threadsSurfaceFixture({ startThread }));
    await attachImage();

    await submit("Build it");

    expect(current().composer.pendingSend).toMatchObject({
      prompt: "Build it",
      status: "sending",
      target: { kind: "new", projectRootKey: SURFACE_FIXTURE_ROOT },
    });
    expect(current().composer.composerProps.attachments?.drafts).toEqual([]);

    await act(async () => start.resolve(null));

    expect(current().composer.pendingSend).toMatchObject({ status: "failed" });
    expect(current().composer.composerProps.prompt).toBe("Build it");
    expect(current().composer.composerProps.attachments?.drafts).toHaveLength(1);
  });
});
