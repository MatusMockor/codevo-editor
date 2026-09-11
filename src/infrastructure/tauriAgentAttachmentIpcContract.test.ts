import { describe, expect, it, vi } from "vitest";
import {
  AGENT_ATTACHMENT_REQUEST_HEADER,
  CLAIM_AGENT_ATTACHMENTS_IPC_COMMAND,
  INSPECT_AGENT_ATTACHMENT_CANDIDATE_IPC_COMMAND,
  READ_AGENT_ATTACHMENT_CANDIDATE_IPC_COMMAND,
  READ_AGENT_ATTACHMENT_IPC_COMMAND,
  RELEASE_AGENT_ATTACHMENT_IPC_COMMAND,
  REVEAL_AGENT_ATTACHMENT_IPC_COMMAND,
  STAGE_AGENT_ATTACHMENT_BYTES_IPC_COMMAND,
  STAGE_AGENT_ATTACHMENT_FROM_PATH_IPC_COMMAND,
  agentAttachmentRequestHeaders,
  invokeClaimAgentAttachmentsIpc,
  invokeInspectAgentAttachmentCandidateIpc,
  invokeReadAgentAttachmentIpc,
  invokeReleaseAgentAttachmentIpc,
  invokeRevealAgentAttachmentIpc,
  invokeStageAgentAttachmentBytesIpc,
  invokeStageAgentAttachmentFromPathIpc,
  parseStagedAgentAttachment,
  type InvokeAgentAttachmentRawCommand,
} from "./tauriAgentAttachmentIpcContract";

const ATTACHMENT_ID = "0123456789abcdef0123456789abcdef";
const OTHER_ID = "fedcba9876543210fedcba9876543210";
const STORED_PATH = `/data/agent-attachments/threads/agt-1-0a1b/${ATTACHMENT_ID}.png`;

function stagedResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    attachmentId: ATTACHMENT_ID,
    name: "shot.png",
    mime: "image/png",
    bytes: 2_048,
    width: 800,
    height: 600,
    promptLineBytesMax: 120,
    ...overrides,
  };
}

describe("agent attachment IPC command names", () => {
  it("pins the eight snake_case commands and the raw-body header", () => {
    expect(STAGE_AGENT_ATTACHMENT_BYTES_IPC_COMMAND).toBe("stage_agent_attachment_bytes");
    expect(STAGE_AGENT_ATTACHMENT_FROM_PATH_IPC_COMMAND).toBe("stage_agent_attachment_from_path");
    expect(INSPECT_AGENT_ATTACHMENT_CANDIDATE_IPC_COMMAND).toBe(
      "inspect_agent_attachment_candidate",
    );
    expect(READ_AGENT_ATTACHMENT_CANDIDATE_IPC_COMMAND).toBe("read_agent_attachment_candidate");
    expect(CLAIM_AGENT_ATTACHMENTS_IPC_COMMAND).toBe("claim_agent_attachments");
    expect(RELEASE_AGENT_ATTACHMENT_IPC_COMMAND).toBe("release_agent_attachment");
    expect(READ_AGENT_ATTACHMENT_IPC_COMMAND).toBe("read_agent_attachment");
    expect(REVEAL_AGENT_ATTACHMENT_IPC_COMMAND).toBe("reveal_agent_attachment");
    expect(AGENT_ATTACHMENT_REQUEST_HEADER).toBe("x-agent-attachment");
  });
});

describe("stage_agent_attachment_bytes", () => {
  it("sends the metadata as one ASCII-escaped JSON header and the bytes as the raw body", async () => {
    const invokeRaw = vi.fn<InvokeAgentAttachmentRawCommand>(async () => stagedResult());
    const body = new Uint8Array([1, 2, 3]).buffer;

    const staged = await invokeStageAgentAttachmentBytesIpc(invokeRaw, {
      workspaceId: "ws-1",
      kind: "image",
      name: "snäp.png",
      mime: "image/png",
      width: 800,
      height: 600,
      bytes: body,
    });

    expect(staged.attachmentId).toBe(ATTACHMENT_ID);
    const call = invokeRaw.mock.calls[0];
    expect(call?.[0]).toBe("stage_agent_attachment_bytes");
    expect(call?.[1]).toEqual(new Uint8Array([1, 2, 3]));
    const header = call?.[2][AGENT_ATTACHMENT_REQUEST_HEADER] ?? "";
    expect(header).toBe(
      '{"workspaceId":"ws-1","kind":"image","name":"sn\\u00e4p.png","mime":"image/png","width":800,"height":600}',
    );
    expect(/^[ -~]*$/.test(header)).toBe(true);
    expect(JSON.parse(header)).toEqual({
      workspaceId: "ws-1",
      kind: "image",
      name: "snäp.png",
      mime: "image/png",
      width: 800,
      height: 600,
    });
  });

  it("refuses an empty body and an unsanitised name before invoking", async () => {
    expect(() =>
      agentAttachmentRequestHeaders({
        workspaceId: "ws-1",
        kind: "file",
        name: 'bad"name.txt',
        mime: null,
        width: null,
        height: null,
        bytes: new ArrayBuffer(1),
      }),
    ).toThrow(/request\.name/);
    const invokeRaw = vi.fn(async () => stagedResult());
    await expect(
      invokeStageAgentAttachmentBytesIpc(invokeRaw, {
        workspaceId: "ws-1",
        kind: "file",
        name: "notes.txt",
        mime: null,
        width: null,
        height: null,
        bytes: new ArrayBuffer(0),
      }),
    ).rejects.toThrow(/request\.bytes/);
    expect(invokeRaw).not.toHaveBeenCalled();
  });
});

describe("stage_agent_attachment_from_path", () => {
  it("sends a bounded absolute path and rejects a relative one", async () => {
    const invokeCommand = vi.fn(async () => stagedResult());

    await invokeStageAgentAttachmentFromPathIpc(invokeCommand, {
      workspaceId: "ws-1",
      kind: "image",
      name: "shot.png",
      mime: "image/png",
      path: "/Users/dev/shot.png",
    });

    expect(invokeCommand).toHaveBeenCalledWith("stage_agent_attachment_from_path", {
      request: {
        workspaceId: "ws-1",
        kind: "image",
        name: "shot.png",
        mime: "image/png",
        path: "/Users/dev/shot.png",
      },
    });
    await expect(
      invokeStageAgentAttachmentFromPathIpc(invokeCommand, {
        workspaceId: "ws-1",
        kind: "image",
        name: "shot.png",
        mime: "image/png",
        path: "shot.png",
      }),
    ).rejects.toThrow(/request\.path/);
  });
});

describe("staged result parsing", () => {
  it("accepts an omitted mime for a generic file", () => {
    expect(
      parseStagedAgentAttachment({
        attachmentId: ATTACHMENT_ID,
        name: "notes.txt",
        bytes: 32,
        promptLineBytesMax: 90,
      }),
    ).toEqual({
      attachmentId: ATTACHMENT_ID,
      name: "notes.txt",
      mime: null,
      bytes: 32,
      width: null,
      height: null,
      promptLineBytesMax: 90,
    });
  });

  it.each([
    ["an unknown field", stagedResult({ storedPath: STORED_PATH })],
    ["a short attachment id", stagedResult({ attachmentId: "abc" })],
    ["an uppercase attachment id", stagedResult({ attachmentId: ATTACHMENT_ID.toUpperCase() })],
    ["an unsupported mime", stagedResult({ mime: "image/svg+xml" })],
    ["an out-of-range dimension", stagedResult({ width: 16_385 })],
    ["a mime without dimensions", stagedResult({ width: undefined, height: undefined })],
    ["dimensions without a mime", stagedResult({ mime: undefined })],
    ["a negative byte count", stagedResult({ bytes: -1 })],
  ] as const)("rejects %s", (_label, value) => {
    expect(() => parseStagedAgentAttachment(value)).toThrow(TypeError);
  });
});

describe("claim_agent_attachments", () => {
  it("returns one claimed attachment per requested id in order", async () => {
    const invokeCommand = vi.fn(async () => [
      { attachmentId: ATTACHMENT_ID, storedPath: STORED_PATH, promptLine: "[Attached image]" },
      { attachmentId: OTHER_ID, storedPath: STORED_PATH, promptLine: "[Attached file]" },
    ]);

    const claimed = await invokeClaimAgentAttachmentsIpc(invokeCommand, {
      workspaceId: "ws-1",
      threadId: "agt-1-0a1b",
      attachmentIds: [ATTACHMENT_ID, OTHER_ID],
    });

    expect(claimed.map((entry) => entry.attachmentId)).toEqual([ATTACHMENT_ID, OTHER_ID]);
    expect(invokeCommand).toHaveBeenCalledWith("claim_agent_attachments", {
      request: {
        workspaceId: "ws-1",
        threadId: "agt-1-0a1b",
        attachmentIds: [ATTACHMENT_ID, OTHER_ID],
      },
    });
  });

  it("rejects duplicate ids, a foreign result order and a multi-line prompt line", async () => {
    const ok = vi.fn(async () => []);
    await expect(
      invokeClaimAgentAttachmentsIpc(ok, {
        workspaceId: "ws-1",
        threadId: "agt-1-0a1b",
        attachmentIds: [ATTACHMENT_ID, ATTACHMENT_ID],
      }),
    ).rejects.toThrow(/distinct attachment ids/);

    const reordered = vi.fn(async () => [
      { attachmentId: OTHER_ID, storedPath: STORED_PATH, promptLine: "[Attached image]" },
    ]);
    await expect(
      invokeClaimAgentAttachmentsIpc(reordered, {
        workspaceId: "ws-1",
        threadId: "agt-1-0a1b",
        attachmentIds: [ATTACHMENT_ID],
      }),
    ).rejects.toThrow(/result\[0\]\.attachmentId/);

    const multiline = vi.fn(async () => [
      { attachmentId: ATTACHMENT_ID, storedPath: STORED_PATH, promptLine: "one\ntwo" },
    ]);
    await expect(
      invokeClaimAgentAttachmentsIpc(multiline, {
        workspaceId: "ws-1",
        threadId: "agt-1-0a1b",
        attachmentIds: [ATTACHMENT_ID],
      }),
    ).rejects.toThrow(/promptLine/);
  });

  it("rejects an unsafe thread id", async () => {
    const invokeCommand = vi.fn(async () => []);
    await expect(
      invokeClaimAgentAttachmentsIpc(invokeCommand, {
        workspaceId: "ws-1",
        threadId: "../escape",
        attachmentIds: [ATTACHMENT_ID],
      }),
    ).rejects.toThrow(/request\.threadId/);
    expect(invokeCommand).not.toHaveBeenCalled();
  });
});

describe("inspect, read, release and reveal", () => {
  it("parses a bounded candidate inspection", async () => {
    const invokeCommand = vi.fn(async () => ({ bytes: 64, isRegularFile: true }));

    expect(
      await invokeInspectAgentAttachmentCandidateIpc(invokeCommand, {
        workspaceId: "ws-1",
        path: "/Users/dev/clip.mp4",
      }),
    ).toEqual({ bytes: 64, isRegularFile: true, extensionMime: null });
  });

  it("normalises attachment bytes to an ArrayBuffer", async () => {
    const invokeCommand = vi.fn(async () => new Uint8Array([7, 8, 9]));

    const buffer = await invokeReadAgentAttachmentIpc(invokeCommand, {
      workspaceId: "ws-1",
      threadId: "agt-1-0a1b",
      attachmentId: ATTACHMENT_ID,
    });

    expect([...new Uint8Array(buffer)]).toEqual([7, 8, 9]);
  });

  it("requires null from the unit commands", async () => {
    const nullCommand = vi.fn(async () => null);
    await expect(
      invokeReleaseAgentAttachmentIpc(nullCommand, {
        workspaceId: "ws-1",
        attachmentId: ATTACHMENT_ID,
      }),
    ).resolves.toBeUndefined();

    const chatty = vi.fn(async () => ({ ok: true }));
    await expect(
      invokeRevealAgentAttachmentIpc(chatty, {
        workspaceId: "ws-1",
        threadId: "agt-1-0a1b",
        attachmentId: ATTACHMENT_ID,
      }),
    ).rejects.toThrow(/expected null/);
  });
});
