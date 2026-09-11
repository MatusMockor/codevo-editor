// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAttachmentGateway } from "../../application/agentAttachmentPorts";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES,
  useAgentAttachmentImages,
} from "../../application/useAgentAttachmentImages";
import type { AgentAttachment } from "../../domain/agentAttachment";
import {
  agentThreadAttention,
  agentThreadUnread,
  type AgentThread,
  type AgentTurn,
} from "../../domain/agentThread";
import { waitForReact } from "../../test/reactTestLifecycle";
import { AgentThreadSession } from "./AgentThreadSession";
import { AgentClockProvider } from "./agentClock";

const ROOT = "/workspace/app";
const OWNER_ID = "agent-root:app";
const NOW = 1_700_000_600_000;
const THREAD_ID = "agt-1";
const IMAGES_PER_TURN = 8;
const TURNS_OVER_CAP = Math.ceil(MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES / IMAGES_PER_TURN) + 1;

describe("attachment image cache under a rendered thread", () => {
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

  it("bounds previews and shows an unavailable reason without a reload loop when the thread exceeds capacity", async () => {
    const read = vi.fn(async () => new ArrayBuffer(16));
    const gateway = { readAgentAttachment: read } as unknown as AgentAttachmentGateway;
    const turns = Array.from({ length: TURNS_OVER_CAP }, (_, turnIndex) =>
      turn(
        `t${turnIndex}`,
        Array.from({ length: IMAGES_PER_TURN }, (_, i) => image(turnIndex * IMAGES_PER_TURN + i)),
      ),
    );
    const imageCount = TURNS_OVER_CAP * IMAGES_PER_TURN;
    expect(imageCount).toBeGreaterThan(MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES);

    act(() => root.render(<Harness gateway={gateway} thread={threadView(turns)} />));

    await waitForReact(() =>
      expect(host.querySelectorAll(".agent-attachments__image")).toHaveLength(
        MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES,
      ),
    );
    for (let round = 0; round < 6; round += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }

    expect(read).toHaveBeenCalledTimes(MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES);
    expect(host.querySelectorAll('[data-agent-attachment="unavailable"]')).toHaveLength(
      imageCount - MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES,
    );
    const other = threadView([turn("other-turn", [image(100)])]);
    const next = { ...other, thread: { ...other.thread, threadId: "agt-other" } };
    act(() => root.render(<Harness gateway={gateway} thread={next} />));
    await waitForReact(() =>
      expect(host.querySelectorAll(".agent-attachments__image")).toHaveLength(1),
    );
    expect(read).toHaveBeenCalledTimes(MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES + 1);
    act(() => root.render(<Harness gateway={gateway} thread={threadView(turns)} />));
    await waitForReact(() =>
      expect(host.querySelectorAll(".agent-attachments__image")).toHaveLength(
        MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES,
      ),
    );
    expect(read).toHaveBeenCalledTimes(MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES * 2 + 1);
    expect(host.querySelectorAll(".agent-attachments__pending")).toHaveLength(0);
    expect(host.querySelectorAll(".agent-attachments__image")).toHaveLength(
      MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES,
    );
  });

  it("loads the selected thread after the previous thread's full pending batch settles", async () => {
    const pending: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    const read = vi.fn(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          active++;
          peak = Math.max(peak, active);
          pending.push(() => {
            active--;
            resolve(new ArrayBuffer(16));
          });
        }),
    );
    const gateway = { readAgentAttachment: read } as unknown as AgentAttachmentGateway;
    const turns = Array.from({ length: 3 }, (_, index) =>
      turn(
        `pending-${index}`,
        Array.from({ length: 8 }, (_, i) => image(index * 8 + i)),
      ),
    );
    act(() => root.render(<Harness gateway={gateway} thread={threadView(turns)} />));
    expect(read).toHaveBeenCalledTimes(24);
    const other = threadView([turn("other-turn", [image(100)])]);
    const next = { ...other, thread: { ...other.thread, threadId: "agt-other" } };
    act(() => root.render(<Harness gateway={gateway} thread={next} />));
    expect(read).toHaveBeenCalledTimes(24);
    const oldBatch = pending.splice(0);
    await act(async () => oldBatch.forEach((settle) => settle()));
    expect(read).toHaveBeenCalledTimes(25);
    await act(async () => pending.splice(0).forEach((settle) => settle()));
    await waitForReact(() =>
      expect(host.querySelectorAll(".agent-attachments__image")).toHaveLength(1),
    );
    expect(host.querySelectorAll(".agent-attachments__pending")).toHaveLength(0);
    expect(host.querySelectorAll('[data-agent-attachment="unavailable"]')).toHaveLength(0);
    expect(peak).toBeLessThanOrEqual(MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES);
  });

  it("reads every image once when the visible set fits in the cache", async () => {
    const read = vi.fn(async () => new ArrayBuffer(16));
    const gateway = { readAgentAttachment: read } as unknown as AgentAttachmentGateway;
    const turns = [
      turn(
        "t0",
        Array.from({ length: IMAGES_PER_TURN }, (_, i) => image(i)),
      ),
    ];

    act(() => root.render(<Harness gateway={gateway} thread={threadView(turns)} />));

    await waitForReact(() =>
      expect(host.querySelectorAll(".agent-attachments__image")).toHaveLength(IMAGES_PER_TURN),
    );
    for (let round = 0; round < 4; round += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    expect(read).toHaveBeenCalledTimes(IMAGES_PER_TURN);
  });
});

function Harness({
  gateway,
  thread,
}: {
  readonly gateway: AgentAttachmentGateway;
  readonly thread: AgentThreadView;
}) {
  const images = useAgentAttachmentImages({
    gateway,
    reportError: () => undefined,
    createObjectUrl: () => "blob:x",
    revokeObjectUrl: () => undefined,
  });
  return (
    <AgentClockProvider nowTickMs={600_000}>
      <AgentThreadSession
        attachmentImages={images}
        composerRepositoryLabel="app"
        markdownViewport={null}
        onReviewInDiff={() => undefined}
        thread={thread}
      />
    </AgentClockProvider>
  );
}

function image(index: number): AgentAttachment {
  const id = index.toString(16).padStart(32, "0");
  return {
    kind: "image",
    attachmentId: id,
    name: `shot-${index}.png`,
    mime: "image/png",
    bytes: 2_048,
    width: 800,
    height: 600,
    storedPath: `/data/agent-attachments/threads/${THREAD_ID}/${id}.png`,
  };
}

function turn(turnId: string, attachments: ReadonlyArray<AgentAttachment>): AgentTurn {
  return {
    turnId,
    prompt: "look",
    status: { kind: "exited", exitCode: 0 },
    startedAtEpochMs: NOW - 300_000,
    endedAtEpochMs: NOW - 30_000,
    events: [{ kind: "assistantText", text: "done" }],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
    attachments,
  };
}

function threadView(turns: ReadonlyArray<AgentTurn>): AgentThreadView {
  const record: AgentThread = {
    threadId: THREAD_ID,
    owner: { rootKey: ROOT, ownerId: OWNER_ID, repositoryRoot: ROOT },
    target: { isolation: "in-place", worktreePath: null },
    provider: { kind: "claudeCode", sessionId: "session-abcdefgh" },
    title: "Check the project",
    pinned: false,
    archived: false,
    createdAtEpochMs: NOW - 600_000,
    updatedAtEpochMs: NOW - 60_000,
    turns,
    turnsTruncated: false,
    viewedAtEpochMs: null,
    externalOrigin: null,
    integration: null,
  };
  return {
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "available" },
    attention: agentThreadAttention(record),
    unread: agentThreadUnread(record),
    thread: record,
    lifecycle: "settled",
    repositoryLabel: "app",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
  };
}
