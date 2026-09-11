import { describe, expect, it, vi } from "vitest";
import { agentAttachmentPromptLine } from "../domain/agentAttachmentIntake";
import { MAX_AGENT_TASK_PROMPT_BYTES } from "../domain/agentTask";
import type { AgentAttachmentGateway } from "./agentAttachmentPorts";
import type { AgentTasksNotice, AgentTurnAttachmentIntent } from "./agentThreadPorts";
import {
  AGENT_ATTACHMENTS_DISCARDED_NOTICE,
  AGENT_ATTACHMENT_PROMPT_TOO_LONG_NOTICE,
  AGENT_ATTACHMENT_UNAVAILABLE_NOTICE,
  admitTurnAttachments,
  claimTurnAttachments,
  prepareTurnAttachments,
  retryAttachmentThreadId,
  type AgentTurnAttachmentAuthority,
} from "./agentTurnAttachments";

const IMAGE_ID = "0123456789abcdef0123456789abcdef";
const FILE_ID = "fedcba9876543210fedcba9876543210";
const THREAD_ID = "agt-1-0a1b";
const STORED_IMAGE = `/data/agent-attachments/threads/${THREAD_ID}/${IMAGE_ID}.png`;
const STORED_FILE = `/data/agent-attachments/threads/${THREAD_ID}/${FILE_ID}.bin`;

const AUTHORITY: AgentTurnAttachmentAuthority = {
  rootKey: "/workspace/app",
  ownerId: "owner-a",
  generation: 3,
  workspaceId: "ws-1",
};

const IMAGE_INTENT: AgentTurnAttachmentIntent = {
  kind: "staged",
  attachmentId: IMAGE_ID,
  name: "shot.png",
  bytes: 2_048,
  mime: "image/png",
  width: 800,
  height: 600,
};

const FILE_INTENT: AgentTurnAttachmentIntent = {
  kind: "staged",
  attachmentId: FILE_ID,
  name: "notes.txt",
  bytes: 32,
  mime: null,
  width: null,
  height: null,
};

const REFERENCE_INTENT: AgentTurnAttachmentIntent = {
  kind: "reference",
  name: "clip.mp4",
  path: "/Users/dev/clip.mp4",
  bytes: 4_096,
};

function owner(overrides: Partial<AgentTurnAttachmentAuthority> = {}) {
  const merged = { ...AUTHORITY, ...overrides };
  return {
    projectRootKey: merged.rootKey,
    ownerId: merged.ownerId,
    generation: merged.generation,
    workspaceId: merged.workspaceId,
  };
}

function gateway(overrides: Partial<AgentAttachmentGateway> = {}): AgentAttachmentGateway {
  return {
    stageAgentAttachmentBytes: vi.fn(),
    stageAgentAttachmentFromPath: vi.fn(),
    inspectAgentAttachmentCandidate: vi.fn(),
    readAgentAttachmentCandidate: vi.fn(),
    claimAgentAttachments: vi.fn(
      async ({ attachmentIds }: { attachmentIds: ReadonlyArray<string> }) =>
        attachmentIds.map((attachmentId: string) => ({
          attachmentId,
          storedPath: attachmentId === IMAGE_ID ? STORED_IMAGE : STORED_FILE,
          promptLine: "[Attached]",
        })),
    ),
    releaseAgentAttachment: vi.fn(async () => undefined),
    readAgentAttachment: vi.fn(),
    revealAgentAttachment: vi.fn(),
    ...overrides,
  } as AgentAttachmentGateway;
}

function lastMessage(notices: ReadonlyArray<AgentTasksNotice | null>): string | undefined {
  return notices[notices.length - 1]?.message;
}

function recorder() {
  const notices: Array<AgentTasksNotice | null> = [];
  const errors: unknown[] = [];
  return {
    notices,
    errors,
    setNotice: (notice: AgentTasksNotice | null) => notices.push(notice),
    reportError: (_source: string, error: unknown) => errors.push(error),
  };
}

describe("admitTurnAttachments", () => {
  it("admits intents whose owner matches the launch authority exactly", () => {
    expect(
      admitTurnAttachments({ attachments: [IMAGE_INTENT], attachmentOwner: owner() }, AUTHORITY),
    ).toEqual({ kind: "admitted", intents: [IMAGE_INTENT] });
  });

  it.each([
    ["a different project", owner({ rootKey: "/workspace/other" })],
    ["a different owner id", owner({ ownerId: "owner-b" })],
    ["a newer generation", owner({ generation: 4 })],
    ["a different workspace id", owner({ workspaceId: "ws-2" })],
  ] as const)("discards intents from %s", (_label, staleOwner) => {
    expect(
      admitTurnAttachments({ attachments: [IMAGE_INTENT], attachmentOwner: staleOwner }, AUTHORITY),
    ).toEqual({ kind: "discarded", intents: [IMAGE_INTENT] });
  });

  it("discards intents that carry no owner at all", () => {
    expect(admitTurnAttachments({ attachments: [IMAGE_INTENT] }, AUTHORITY).kind).toBe("discarded");
  });
});

describe("claimTurnAttachments", () => {
  it("builds the persisted attachments and the effective prompt in composer order", async () => {
    const port = gateway();

    const claimed = await claimTurnAttachments(
      port,
      "ws-1",
      THREAD_ID,
      [IMAGE_INTENT, FILE_INTENT, REFERENCE_INTENT],
      "look at this",
    );

    expect(claimed.attachments).toEqual([
      {
        kind: "image",
        attachmentId: IMAGE_ID,
        name: "shot.png",
        mime: "image/png",
        bytes: 2_048,
        width: 800,
        height: 600,
        storedPath: STORED_IMAGE,
      },
      {
        kind: "file",
        attachmentId: FILE_ID,
        name: "notes.txt",
        bytes: 32,
        storedPath: STORED_FILE,
      },
      { kind: "reference", name: "clip.mp4", path: "/Users/dev/clip.mp4", bytes: 4_096 },
    ]);
    expect(claimed.references).toEqual([
      { kind: "staged", attachmentId: IMAGE_ID },
      { kind: "staged", attachmentId: FILE_ID },
      { kind: "reference", name: "clip.mp4", path: "/Users/dev/clip.mp4" },
    ]);
    expect(claimed.prompt).toBe(
      `look at this\n\n${claimed.attachments.map(agentAttachmentPromptLine).join("\n")}`,
    );
    expect(port.claimAgentAttachments).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: THREAD_ID,
      attachmentIds: [IMAGE_ID, FILE_ID],
    });
  });

  it("never claims when only references are attached", async () => {
    const port = gateway();

    const claimed = await claimTurnAttachments(port, "ws-1", THREAD_ID, [REFERENCE_INTENT], "");

    expect(port.claimAgentAttachments).not.toHaveBeenCalled();
    expect(claimed.prompt).toBe('[Attached file "clip.mp4" is at: /Users/dev/clip.mp4]');
  });
});

describe("prepareTurnAttachments", () => {
  it("releases discarded attachments, warns and keeps the text turn", async () => {
    const port = gateway();
    const sink = recorder();

    const prepared = await prepareTurnAttachments(
      { agentAttachmentGateway: port, ...sink },
      { attachments: [IMAGE_INTENT], attachmentOwner: owner({ generation: 4 }) },
      AUTHORITY,
      THREAD_ID,
      "look",
    );

    expect(prepared).toMatchObject({ prompt: "look", attachments: [], references: [] });
    expect(prepared?.notice?.message).toBe(AGENT_ATTACHMENTS_DISCARDED_NOTICE);
    expect(port.releaseAgentAttachment).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      attachmentId: IMAGE_ID,
    });
    expect(port.claimAgentAttachments).not.toHaveBeenCalled();
    expect(lastMessage(sink.notices)).toBe(AGENT_ATTACHMENTS_DISCARDED_NOTICE);
  });

  it("stops an attachment-only turn whose attachments were discarded", async () => {
    const port = gateway();
    const sink = recorder();

    expect(
      await prepareTurnAttachments(
        { agentAttachmentGateway: port, ...sink },
        { attachments: [IMAGE_INTENT], attachmentOwner: owner({ ownerId: "owner-b" }) },
        AUTHORITY,
        THREAD_ID,
        "",
      ),
    ).toBeNull();
  });

  it("reports a definite failure when the claim refuses", async () => {
    const port = gateway({
      claimAgentAttachments: vi.fn(async () => {
        throw new Error("Agent attachment is no longer staged.");
      }),
    });
    const sink = recorder();

    expect(
      await prepareTurnAttachments(
        { agentAttachmentGateway: port, ...sink },
        { attachments: [IMAGE_INTENT], attachmentOwner: owner() },
        AUTHORITY,
        THREAD_ID,
        "look",
      ),
    ).toBeNull();
    expect(lastMessage(sink.notices)).toBe(AGENT_ATTACHMENT_UNAVAILABLE_NOTICE);
    expect(sink.errors).toHaveLength(1);
  });

  it("refuses when the effective prompt would exceed the spawner cap", async () => {
    const port = gateway();
    const sink = recorder();

    expect(
      await prepareTurnAttachments(
        { agentAttachmentGateway: port, ...sink },
        { attachments: [IMAGE_INTENT], attachmentOwner: owner() },
        AUTHORITY,
        THREAD_ID,
        "x".repeat(MAX_AGENT_TASK_PROMPT_BYTES),
      ),
    ).toBeNull();
    expect(lastMessage(sink.notices)).toBe(AGENT_ATTACHMENT_PROMPT_TOO_LONG_NOTICE);
  });

  it("passes a turn with no attachments through untouched", async () => {
    const port = gateway();
    const sink = recorder();

    expect(
      await prepareTurnAttachments(
        { agentAttachmentGateway: port, ...sink },
        {},
        AUTHORITY,
        THREAD_ID,
        "look",
      ),
    ).toEqual({ prompt: "look", attachments: [], references: [], notice: null });
    expect(sink.notices).toHaveLength(0);
  });

  it("refuses attachments when no gateway is wired", async () => {
    const sink = recorder();

    expect(
      await prepareTurnAttachments(
        sink,
        { attachments: [IMAGE_INTENT], attachmentOwner: owner() },
        AUTHORITY,
        THREAD_ID,
        "look",
      ),
    ).toBeNull();
    expect(lastMessage(sink.notices)).toBe(AGENT_ATTACHMENT_UNAVAILABLE_NOTICE);
  });
});

describe("attachment retry thread ownership", () => {
  const authority = { ...AUTHORITY, workspaceGeneration: 8 };
  const reservation = { authority, threadId: THREAD_ID };
  it("retains the unpublished thread for the exact authority", () => {
    expect(retryAttachmentThreadId(reservation, authority, new Set())).toBe(THREAD_ID);
    expect(retryAttachmentThreadId(reservation, authority, new Set([THREAD_ID]))).toBeNull();
  });
  it.each([
    { rootKey: "/other" },
    { ownerId: "other" },
    { generation: 4 },
    { workspaceId: "other" },
    { workspaceGeneration: 9 },
  ])("rejects replacement authority %j", (replacement) => {
    expect(
      retryAttachmentThreadId(reservation, { ...authority, ...replacement }, new Set()),
    ).toBeNull();
  });
});
