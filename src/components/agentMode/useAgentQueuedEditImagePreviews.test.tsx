// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAttachmentGateway } from "../../application/agentAttachmentPorts";
import { useAgentAttachmentImages } from "../../application/useAgentAttachmentImages";
import { waitForReact } from "../../test/reactTestLifecycle";
import { AgentComposerQueuedEditAttachments } from "./AgentComposerQueuedEditBar";
import { queuedEditAttachmentDraft, type AgentComposerQueuedEdit } from "./agentComposerQueuedEdit";
import {
  queuedEditImageOwner,
  useAgentQueuedEditImagePreviews,
  type AgentQueuedEditImageOwner,
} from "./useAgentQueuedEditImagePreviews";

const THREAD_ID = "agt-1-0a1b";
const WORKSPACE_ID = "agent-root:0123456789abcdef";
const IMAGE_ID = "0".repeat(31) + "1";

function queuedEdit(threadId = THREAD_ID): AgentComposerQueuedEdit {
  return {
    threadId,
    lease: 1,
    prompt: "Describe the image",
    attachments: [
      queuedEditAttachmentDraft({
        key: "attachment-0",
        attachment: {
          kind: "image",
          attachmentId: IMAGE_ID,
          name: "pripona.png",
          mime: "image/png",
          bytes: 3,
          width: 1,
          height: 1,
          storedPath: "/data/pripona.png",
        },
      }),
    ],
    onRemoveAttachment: () => undefined,
    onCancel: () => undefined,
    commit: async () => true,
  };
}

describe("useAgentQueuedEditImagePreviews", () => {
  let host: HTMLDivElement;
  let root: Root;
  const created: string[] = [];
  const revoked: string[] = [];
  const readAgentAttachment = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer);
  const gateway = { readAgentAttachment } as unknown as AgentAttachmentGateway;

  function Probe({
    edit,
    owner,
  }: {
    readonly edit: AgentComposerQueuedEdit | null;
    readonly owner: AgentQueuedEditImageOwner | null;
  }) {
    const images = useAgentAttachmentImages({
      gateway,
      reportError: () => undefined,
      createObjectUrl: () => {
        const url = `blob:queued-${created.length}`;
        created.push(url);
        return url;
      },
      revokeObjectUrl: (url) => revoked.push(url),
    });
    const previewed = useAgentQueuedEditImagePreviews(edit, images, owner);
    return previewed === null
      ? null
      : createElement(AgentComposerQueuedEditAttachments, { edit: previewed });
  }

  const render = (
    edit: AgentComposerQueuedEdit | null,
    owner: AgentQueuedEditImageOwner | null,
  ): void => {
    act(() => root.render(createElement(Probe, { edit, owner })));
  };

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    created.length = 0;
    revoked.length = 0;
    readAgentAttachment.mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("shows the kept image as a thumbnail from the attachment store", async () => {
    render(queuedEdit(), { workspaceId: WORKSPACE_ID, threadId: THREAD_ID });

    await waitForReact(() => {
      const image = host.querySelector<HTMLImageElement>(".agent-composer-attachment__preview");
      expect(image?.getAttribute("src")).toBe("blob:queued-0");
    });
    expect(readAgentAttachment).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      threadId: THREAD_ID,
      attachmentId: IMAGE_ID,
    });
  });

  it("releases the borrowed thumbnail when the edit ends", async () => {
    render(queuedEdit(), { workspaceId: WORKSPACE_ID, threadId: THREAD_ID });
    await waitForReact(() => expect(created).toEqual(["blob:queued-0"]));

    render(null, { workspaceId: WORKSPACE_ID, threadId: THREAD_ID });

    await waitForReact(() => expect(revoked).toEqual(["blob:queued-0"]));
  });

  it("never reads the local attachment store for a remote or foreign thread", async () => {
    render(queuedEdit(), null);
    render(queuedEdit("agt-2-0c0d"), { workspaceId: WORKSPACE_ID, threadId: THREAD_ID });
    await act(async () => Promise.resolve());

    expect(readAgentAttachment).not.toHaveBeenCalled();
    expect(host.querySelector(".agent-composer-attachment__preview")).toBeNull();
    expect(
      queuedEditImageOwner({
        thread: {
          threadId: THREAD_ID,
          owner: { rootKey: "/r", ownerId: WORKSPACE_ID, repositoryRoot: "/r" },
        } as never,
        execution: { kind: "remote" } as never,
      }),
    ).toBeNull();
  });
});
