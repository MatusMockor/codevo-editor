import { describe, expect, it, vi } from "vitest";
import {
  AGENT_ATTACHMENT_RUNTIME_UNAVAILABLE,
  TauriAgentAttachmentGateway,
} from "./tauriAgentAttachmentGateway";
import type {
  InvokeAgentAttachmentCommand,
  InvokeAgentAttachmentRawCommand,
} from "./tauriAgentAttachmentIpcContract";

const ATTACHMENT_ID = "0123456789abcdef0123456789abcdef";
const STORED_PATH = `/data/agent-attachments/threads/agt-1-0a1b/${ATTACHMENT_ID}.png`;

function gateway(available: boolean) {
  const invokeCommand = vi.fn<InvokeAgentAttachmentCommand>(async (command) => {
    if (command === "claim_agent_attachments") {
      return [{ attachmentId: ATTACHMENT_ID, storedPath: STORED_PATH, promptLine: "[Attached]" }];
    }
    if (command === "inspect_agent_attachment_candidate") {
      return { bytes: 10, isRegularFile: true, extensionMime: "image/png" };
    }
    if (command === "read_agent_attachment" || command === "read_agent_attachment_candidate") {
      return new Uint8Array([1, 2]).buffer;
    }
    if (command === "stage_agent_attachment_from_path") {
      return {
        attachmentId: ATTACHMENT_ID,
        name: "shot.png",
        mime: "image/png",
        bytes: 2,
        width: 4,
        height: 4,
        promptLineBytesMax: 100,
      };
    }
    return null;
  });
  const invokeRawCommand = vi.fn<InvokeAgentAttachmentRawCommand>(async () => ({
    attachmentId: ATTACHMENT_ID,
    name: "shot.png",
    mime: "image/png",
    bytes: 2,
    width: 4,
    height: 4,
    promptLineBytesMax: 100,
  }));
  return {
    invokeCommand,
    invokeRawCommand,
    port: new TauriAgentAttachmentGateway(invokeCommand, invokeRawCommand, () => available),
  };
}

describe("TauriAgentAttachmentGateway", () => {
  it("routes every command through the typed contract", async () => {
    const { invokeCommand, invokeRawCommand, port } = gateway(true);

    await port.stageAgentAttachmentBytes({
      workspaceId: "ws-1",
      kind: "image",
      name: "shot.png",
      mime: "image/png",
      width: 4,
      height: 4,
      bytes: new Uint8Array([1, 2]).buffer,
    });
    await port.stageAgentAttachmentFromPath({
      workspaceId: "ws-1",
      kind: "image",
      name: "shot.png",
      mime: "image/png",
      path: "/Users/dev/shot.png",
    });
    await port.inspectAgentAttachmentCandidate({
      workspaceId: "ws-1",
      path: "/Users/dev/shot.png",
    });
    await port.readAgentAttachmentCandidate({ workspaceId: "ws-1", path: "/Users/dev/shot.png" });
    await port.claimAgentAttachments({
      workspaceId: "ws-1",
      threadId: "agt-1-0a1b",
      attachmentIds: [ATTACHMENT_ID],
    });
    await port.releaseAgentAttachment({ workspaceId: "ws-1", attachmentId: ATTACHMENT_ID });
    await port.readAgentAttachment({
      workspaceId: "ws-1",
      threadId: "agt-1-0a1b",
      attachmentId: ATTACHMENT_ID,
    });
    await port.revealAgentAttachment({
      workspaceId: "ws-1",
      threadId: "agt-1-0a1b",
      attachmentId: ATTACHMENT_ID,
    });

    expect(invokeRawCommand.mock.calls.map((call) => call[0])).toEqual([
      "stage_agent_attachment_bytes",
    ]);
    expect(invokeCommand.mock.calls.map((call) => call[0])).toEqual([
      "stage_agent_attachment_from_path",
      "inspect_agent_attachment_candidate",
      "read_agent_attachment_candidate",
      "claim_agent_attachments",
      "release_agent_attachment",
      "read_agent_attachment",
      "reveal_agent_attachment",
    ]);
  });

  it("refuses outside the native runtime and treats release as a no-op", async () => {
    const { invokeCommand, invokeRawCommand, port } = gateway(false);

    await expect(
      port.readAgentAttachment({
        workspaceId: "ws-1",
        threadId: "agt-1-0a1b",
        attachmentId: ATTACHMENT_ID,
      }),
    ).rejects.toThrow(AGENT_ATTACHMENT_RUNTIME_UNAVAILABLE);
    await expect(
      port.releaseAgentAttachment({ workspaceId: "ws-1", attachmentId: ATTACHMENT_ID }),
    ).resolves.toBeUndefined();
    expect(invokeCommand).not.toHaveBeenCalled();
    expect(invokeRawCommand).not.toHaveBeenCalled();
  });
});
