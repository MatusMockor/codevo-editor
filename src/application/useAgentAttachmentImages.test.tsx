// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AgentAttachmentGateway } from "./agentAttachmentPorts";
import { waitForReact } from "../test/reactTestLifecycle";
import {
  MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES,
  agentAttachmentImageKey,
  useAgentAttachmentImages,
  type AgentAttachmentImagesSurface,
} from "./useAgentAttachmentImages";

const THREAD_ID = "agt-1-0a1b";

function attachmentId(index: number): string {
  return index.toString(16).padStart(32, "0");
}

function renderImages(readAgentAttachment: AgentAttachmentGateway["readAgentAttachment"]) {
  const created: string[] = [];
  const revoked: string[] = [];
  const errors: unknown[] = [];
  let surface: AgentAttachmentImagesSurface | null = null;
  const gateway = { readAgentAttachment } as AgentAttachmentGateway;

  function Probe() {
    surface = useAgentAttachmentImages({
      gateway,
      reportError: (_source, error) => errors.push(error),
      createObjectUrl: () => {
        const url = `blob:${created.length}`;
        created.push(url);
        return url;
      },
      revokeObjectUrl: (url) => revoked.push(url),
    });
    return null;
  }

  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));

  return {
    created,
    revoked,
    errors,
    hook: (): AgentAttachmentImagesSurface => {
      if (surface === null) throw new Error("The attachment image surface is not mounted.");
      return surface;
    },
    unmount: () => act(() => root.unmount()),
  };
}

describe("useAgentAttachmentImages", () => {
  it("loads an image once and publishes a blob url for the transcript", async () => {
    const readAgentAttachment = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer);
    const harness = renderImages(readAgentAttachment);
    const request = {
      workspaceId: "ws-1",
      threadId: THREAD_ID,
      attachmentId: attachmentId(1),
      mime: "image/png",
    } as const;

    await act(async () => harness.hook().ensure(request));
    await waitForReact(() =>
      expect(
        harness.hook().images.get(agentAttachmentImageKey("ws-1", THREAD_ID, request.attachmentId)),
      ).toEqual({ kind: "ready", url: "blob:0" }),
    );

    await act(async () => harness.hook().ensure(request));
    expect(readAgentAttachment).toHaveBeenCalledTimes(1);
    harness.unmount();
    expect(harness.revoked).toEqual(["blob:0"]);
  });

  it("publishes a truthful unavailable state when the attachment cannot be read", async () => {
    const harness = renderImages(
      vi.fn(async () => {
        throw new Error("Agent attachment is no longer available.");
      }),
    );

    await act(async () =>
      harness.hook().ensure({
        workspaceId: "ws-1",
        threadId: THREAD_ID,
        attachmentId: attachmentId(2),
        mime: "image/png",
      }),
    );
    await waitForReact(() =>
      expect(
        harness.hook().images.get(agentAttachmentImageKey("ws-1", THREAD_ID, attachmentId(2))),
      ).toEqual({ kind: "unavailable", reason: "Agent attachment is no longer available." }),
    );
    expect(harness.errors).toHaveLength(1);
    harness.unmount();
  });

  it("evicts the oldest entries past the cache bound and revokes their blob urls", async () => {
    const harness = renderImages(vi.fn(async () => new Uint8Array([1]).buffer));

    for (let index = 0; index <= MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES; index += 1) {
      await act(async () =>
        harness.hook().ensure({
          workspaceId: "ws-1",
          threadId: THREAD_ID,
          attachmentId: attachmentId(index),
          mime: "image/png",
        }),
      );
      await waitForReact(() =>
        expect(
          harness.hook().images.get(agentAttachmentImageKey("ws-1", THREAD_ID, attachmentId(index)))
            ?.kind,
        ).toBe("ready"),
      );
    }

    expect(harness.hook().images.size).toBe(MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES);
    expect(harness.revoked).toEqual(["blob:0"]);
    harness.unmount();
  });

  it("never evicts an entry that is still loading", async () => {
    const pending: Array<() => void> = [];
    const harness = renderImages(
      vi.fn(
        () =>
          new Promise<ArrayBuffer>((resolve) => {
            pending.push(() => resolve(new Uint8Array([1]).buffer));
          }),
      ),
    );
    const total = MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES + 2;

    for (let index = 0; index < total; index += 1) {
      await act(async () =>
        harness.hook().ensure({
          workspaceId: "ws-1",
          threadId: THREAD_ID,
          attachmentId: attachmentId(index),
          mime: "image/png",
        }),
      );
    }
    expect(harness.hook().images.size).toBe(total);

    await act(async () => pending[total - 1]?.());
    await waitForReact(() =>
      expect(
        harness
          .hook()
          .images.get(agentAttachmentImageKey("ws-1", THREAD_ID, attachmentId(total - 1)))?.kind,
      ).toBe("ready"),
    );

    expect(harness.hook().images.size).toBe(total);
    expect(harness.revoked).toEqual([]);
    for (const settle of pending) await act(async () => settle());
    await waitForReact(() =>
      expect(harness.hook().images.size).toBe(MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES),
    );
    harness.unmount();
  });

  it("keeps every image of a held thread while the hold lasts", async () => {
    const harness = renderImages(vi.fn(async () => new Uint8Array([1]).buffer));
    const total = MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES + 4;
    let release: () => void = () => undefined;
    await act(async () => {
      release = harness.hook().holdThread({ workspaceId: "ws-1", threadId: THREAD_ID });
    });

    for (let index = 0; index < total; index += 1) {
      await act(async () =>
        harness.hook().ensure({
          workspaceId: "ws-1",
          threadId: THREAD_ID,
          attachmentId: attachmentId(index),
          mime: "image/png",
        }),
      );
      await waitForReact(() =>
        expect(
          harness.hook().images.get(agentAttachmentImageKey("ws-1", THREAD_ID, attachmentId(index)))
            ?.kind,
        ).toBe("ready"),
      );
    }

    expect(harness.hook().images.size).toBe(total);
    expect(harness.revoked).toEqual([]);

    await act(async () => release());
    await act(async () =>
      harness.hook().ensure({
        workspaceId: "ws-1",
        threadId: "agt-other",
        attachmentId: attachmentId(total),
        mime: "image/png",
      }),
    );
    await waitForReact(() =>
      expect(harness.hook().images.size).toBe(MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES),
    );
    expect(harness.revoked).toHaveLength(total + 1 - MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES);
    harness.unmount();
  });

  it("drops every entry of a workspace whose generation was replaced", async () => {
    const harness = renderImages(vi.fn(async () => new Uint8Array([1]).buffer));

    await act(async () =>
      harness.hook().ensure({
        workspaceId: "ws-1",
        threadId: THREAD_ID,
        attachmentId: attachmentId(1),
        mime: "image/png",
      }),
    );
    await act(async () =>
      harness.hook().ensure({
        workspaceId: "ws-2",
        threadId: THREAD_ID,
        attachmentId: attachmentId(2),
        mime: "image/png",
      }),
    );
    await waitForReact(() => expect(harness.created).toHaveLength(2));

    await act(async () => harness.hook().releaseWorkspace("ws-1"));

    expect(harness.hook().images.size).toBe(1);
    expect(harness.revoked).toEqual(["blob:0"]);
    harness.unmount();
  });
});
