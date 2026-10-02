// @vitest-environment jsdom

import { StrictMode, act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentAttachmentGateway } from "./agentAttachmentPorts";
import {
  AGENT_ATTACHMENT_READ_RETRY_DELAYS_MS,
  MAX_AGENT_ATTACHMENT_CONCURRENT_READS,
} from "./agentAttachmentReadLimiter";
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

function imageRequest(index: number, workspaceId = "ws-1") {
  return {
    workspaceId,
    threadId: THREAD_ID,
    attachmentId: attachmentId(index),
    mime: "image/png",
  } as const;
}

function imageState(harness: ReturnType<typeof renderImages>, index: number) {
  return harness.hook().images.get(agentAttachmentImageKey("ws-1", THREAD_ID, attachmentId(index)));
}

async function advance(milliseconds: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
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
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("bounds pending reads and preserves admitted loads", async () => {
    const pending: Array<() => void> = [];
    const read = vi.fn(
      () => new Promise<ArrayBuffer>((resolve) => pending.push(() => resolve(new ArrayBuffer(1)))),
    );
    const harness = renderImages(read);
    await act(async () => {
      harness.hook().holdThread({ workspaceId: "ws-1", threadId: THREAD_ID });
      for (let index = 0; index < 100; index++)
        harness.hook().ensure({
          workspaceId: "ws-1",
          threadId: THREAD_ID,
          attachmentId: attachmentId(index),
          mime: "image/png",
        });
    });
    expect(read).toHaveBeenCalledTimes(MAX_AGENT_ATTACHMENT_CONCURRENT_READS);
    expect(harness.hook().images.size).toBe(MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES);
    expect(harness.hook().capacityReached).toBe(true);
    while (pending.length > 0) await act(async () => pending.shift()?.());
    expect(read).toHaveBeenCalledTimes(MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES);
    expect(harness.created).toHaveLength(MAX_AGENT_ATTACHMENT_IMAGE_ENTRIES);
    expect(harness.revoked).toHaveLength(0);
    harness.unmount();
  });

  it("bounds held bytes and releases previews immediately on final hold release", async () => {
    const harness = renderImages(vi.fn(async () => new ArrayBuffer(20 * 1024 * 1024)));
    let release = () => {};
    act(() => {
      release = harness.hook().holdThread({ workspaceId: "ws-1", threadId: THREAD_ID });
    });
    for (let index = 0; index < 8; index++) {
      await act(async () =>
        harness.hook().ensure({
          workspaceId: "ws-1",
          threadId: THREAD_ID,
          attachmentId: attachmentId(index),
          mime: "image/png",
        }),
      );
    }
    expect(harness.created).toHaveLength(3);
    expect(
      [...harness.hook().images.values()].filter((state) => state.kind === "unavailable"),
    ).toHaveLength(5);
    act(() => release());
    expect(harness.hook().images.size).toBe(0);
    expect(harness.revoked).toHaveLength(3);
    harness.unmount();
  });

  it("does not publish a stale read into a replacement workspace load", async () => {
    const pending: Array<(value: ArrayBuffer) => void> = [];
    const harness = renderImages(
      vi.fn(() => new Promise<ArrayBuffer>((resolve) => pending.push(resolve))),
    );
    const request = {
      workspaceId: "ws-1",
      threadId: THREAD_ID,
      attachmentId: attachmentId(1),
      mime: "image/png",
    } as const;
    act(() => harness.hook().ensure(request));
    act(() => harness.hook().releaseWorkspace("ws-1"));
    act(() => harness.hook().ensure(request));
    await act(async () => pending[0]?.(new ArrayBuffer(1)));
    expect(harness.created).toHaveLength(0);
    await act(async () => pending[1]?.(new ArrayBuffer(1)));
    expect(harness.created).toHaveLength(1);
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

  it("keeps at most two reads in flight and resolves every queued image", async () => {
    const pending: Array<() => void> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const read = vi.fn(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          pending.push(() => {
            inFlight -= 1;
            resolve(new ArrayBuffer(1));
          });
        }),
    );
    const harness = renderImages(read);

    await act(async () => {
      for (let index = 0; index < 5; index += 1) harness.hook().ensure(imageRequest(index));
    });
    expect(read).toHaveBeenCalledTimes(MAX_AGENT_ATTACHMENT_CONCURRENT_READS);
    expect([...harness.hook().images.values()].every((state) => state.kind === "loading")).toBe(
      true,
    );

    while (pending.length > 0) await act(async () => pending.shift()?.());

    expect(read).toHaveBeenCalledTimes(5);
    expect(maxInFlight).toBe(MAX_AGENT_ATTACHMENT_CONCURRENT_READS);
    for (let index = 0; index < 5; index += 1)
      expect(imageState(harness, index)?.kind).toBe("ready");
    expect(harness.errors).toHaveLength(0);
    harness.unmount();
  });

  it("retries a transient busy runner response without reporting it", async () => {
    vi.useFakeTimers();
    const read = vi
      .fn<AgentAttachmentGateway["readAgentAttachment"]>()
      .mockRejectedValueOnce("Runner request failed (HTTP 503).")
      .mockResolvedValue(new ArrayBuffer(1));
    const harness = renderImages(read);

    await act(async () => harness.hook().ensure(imageRequest(1)));
    expect(read).toHaveBeenCalledTimes(1);
    expect(imageState(harness, 1)).toEqual({ kind: "loading" });

    await advance(AGENT_ATTACHMENT_READ_RETRY_DELAYS_MS[0] ?? 0);

    expect(read).toHaveBeenCalledTimes(2);
    expect(imageState(harness, 1)).toEqual({ kind: "ready", url: "blob:0" });
    expect(harness.errors).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    harness.unmount();
  });

  it("reports a persistent busy runner exactly once after the retry budget", async () => {
    vi.useFakeTimers();
    const read = vi.fn<AgentAttachmentGateway["readAgentAttachment"]>(async () => {
      throw new Error("Runner is busy; retry shortly");
    });
    const harness = renderImages(read);

    await act(async () => harness.hook().ensure(imageRequest(1)));
    for (const delay of AGENT_ATTACHMENT_READ_RETRY_DELAYS_MS) {
      expect(harness.errors).toHaveLength(0);
      await advance(delay);
    }
    await advance(10_000);

    expect(read).toHaveBeenCalledTimes(AGENT_ATTACHMENT_READ_RETRY_DELAYS_MS.length + 1);
    expect(harness.errors).toEqual([new Error("Runner is busy; retry shortly")]);
    expect(imageState(harness, 1)).toEqual({
      kind: "unavailable",
      reason: "Runner is busy; retry shortly",
    });
    expect(vi.getTimerCount()).toBe(0);
    harness.unmount();
  });

  it("does not retry a non-transient failure", async () => {
    vi.useFakeTimers();
    const read = vi.fn<AgentAttachmentGateway["readAgentAttachment"]>(async () => {
      throw "Runner request failed (HTTP 500).";
    });
    const harness = renderImages(read);

    await act(async () => harness.hook().ensure(imageRequest(1)));

    expect(read).toHaveBeenCalledTimes(1);
    expect(harness.errors).toEqual(["Runner request failed (HTTP 500)."]);
    expect(vi.getTimerCount()).toBe(0);
    harness.unmount();
  });

  it.each(["release", "unmount"] as const)(
    "drops queued and backing-off reads on %s without publishing",
    async (change) => {
      vi.useFakeTimers();
      const read = vi.fn<AgentAttachmentGateway["readAgentAttachment"]>(async () => {
        throw "Runner request failed (HTTP 503).";
      });
      const harness = renderImages(read);

      await act(async () => {
        for (let index = 0; index < 4; index += 1) harness.hook().ensure(imageRequest(index));
      });
      expect(read).toHaveBeenCalledTimes(MAX_AGENT_ATTACHMENT_CONCURRENT_READS);
      expect(vi.getTimerCount()).toBe(MAX_AGENT_ATTACHMENT_CONCURRENT_READS);

      if (change === "release") await act(async () => harness.hook().releaseWorkspace("ws-1"));
      if (change === "unmount") harness.unmount();

      expect(vi.getTimerCount()).toBe(0);
      await advance(10_000);
      expect(read).toHaveBeenCalledTimes(MAX_AGENT_ATTACHMENT_CONCURRENT_READS);
      expect(harness.errors).toHaveLength(0);
      expect(harness.created).toHaveLength(0);
      if (change === "release") {
        expect(harness.hook().images.size).toBe(0);
        harness.unmount();
      }
    },
  );

  it("drops a stale in-flight read result after the owner changes and continues the queue", async () => {
    const pending: Array<() => void> = [];
    const read = vi.fn(
      () => new Promise<ArrayBuffer>((resolve) => pending.push(() => resolve(new ArrayBuffer(1)))),
    );
    const harness = renderImages(read);

    await act(async () => {
      for (let index = 0; index < 3; index += 1) harness.hook().ensure(imageRequest(index));
      harness.hook().ensure(imageRequest(3, "ws-2"));
    });
    await act(async () => harness.hook().releaseWorkspace("ws-1"));
    expect(read).toHaveBeenCalledTimes(MAX_AGENT_ATTACHMENT_CONCURRENT_READS);

    await act(async () => pending.shift()?.());
    expect(read).toHaveBeenCalledTimes(3);
    expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: "ws-2" }));
    while (pending.length > 0) await act(async () => pending.shift()?.());

    expect(harness.created).toHaveLength(1);
    expect(harness.hook().images.size).toBe(1);
    expect(harness.errors).toHaveLength(0);
    harness.unmount();
  });

  it("loads an image requested by a child effect during a StrictMode remount", async () => {
    const readAgentAttachment: AgentAttachmentGateway["readAgentAttachment"] = vi.fn(
      async () => new Uint8Array([1, 2, 3]).buffer,
    );
    const gateway = { readAgentAttachment } as AgentAttachmentGateway;
    let surface: AgentAttachmentImagesSurface | null = null;

    function Child({ ensure }: { readonly ensure: AgentAttachmentImagesSurface["ensure"] }) {
      useEffect(() => ensure(imageRequest(1)), [ensure]);
      return null;
    }

    function Owner() {
      surface = useAgentAttachmentImages({
        gateway,
        reportError: () => undefined,
        createObjectUrl: () => "blob:strict",
        revokeObjectUrl: () => undefined,
      });
      return createElement(Child, { ensure: surface.ensure });
    }

    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(StrictMode, null, createElement(Owner))));

    await waitForReact(() =>
      expect(
        surface?.images.get(agentAttachmentImageKey("ws-1", THREAD_ID, attachmentId(1))),
      ).toEqual({ kind: "ready", url: "blob:strict" }),
    );
    act(() => root.unmount());
  });
});
