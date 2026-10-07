// @vitest-environment jsdom

import { StrictMode, act, createElement, useEffect, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_AGENT_INLINE_IMAGE_BYTES } from "../domain/agentMarkdown/agentInlineImage";
import { waitForReact } from "../test/reactTestLifecycle";
import {
  AGENT_ATTACHMENT_READ_RETRY_DELAYS_MS,
  MAX_AGENT_ATTACHMENT_CONCURRENT_READS,
} from "./agentAttachmentReadLimiter";
import {
  AGENT_INLINE_IMAGE_BUSY_MESSAGE,
  type AgentInlineImageGateway,
} from "./agentInlineImagePorts";
import {
  AGENT_INLINE_IMAGE_DECODE_FAILED_REASON,
  AGENT_INLINE_IMAGE_MEMORY_LIMIT_REASON,
  AGENT_INLINE_IMAGE_NO_GATEWAY_REASON,
  AGENT_INLINE_IMAGE_QUEUE_LIMIT_REASON,
  AGENT_INLINE_IMAGE_TOO_LARGE_REASON,
  AGENT_INLINE_IMAGE_UNREADABLE_REASON,
  AGENT_INLINE_IMAGE_UNSUPPORTED_REASON,
  MAX_AGENT_INLINE_IMAGE_ENTRIES,
  MAX_AGENT_INLINE_IMAGE_UNAVAILABLE_REASON_CHARS,
  agentInlineImageUnavailableReason,
  useAgentInlineImages,
  type AgentInlineImageIdentity,
  type AgentInlineImagesSurface,
} from "./useAgentInlineImages";

type ReadInlineImage = AgentInlineImageGateway["readAgentInlineImage"];

const THREAD_ID = "agt-1-0a1b";
const OTHER_THREAD_ID = "agt-2-0c2d";
const TURN = "agt-1-0a1b-t1";
const LATER_TURN = "agt-1-0a1b-t2";
const OWNER = { workspaceId: "ws-1", threadId: THREAD_ID } as const;
const GONE = "The image is no longer available.";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP_SIGNATURE = [0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
const MIB = 1_024 * 1_024;

function imageBytes(signature: ReadonlyArray<number>, byteLength = signature.length): ArrayBuffer {
  const bytes = new Uint8Array(byteLength);
  bytes.set(signature);
  return bytes.buffer;
}

function png(byteLength = PNG_SIGNATURE.length): ArrayBuffer {
  return imageBytes(PNG_SIGNATURE, byteLength);
}

function imagePath(index: number): string {
  return `/tmp/shots/${index}.png`;
}

function image(
  index: number,
  workspaceId = "ws-1",
  threadId = THREAD_ID,
  scope = TURN,
): AgentInlineImageIdentity {
  return { workspaceId, threadId, scope, path: imagePath(index) };
}

function wire(identity: AgentInlineImageIdentity) {
  const { path, threadId, workspaceId } = identity;
  return { workspaceId, threadId, path };
}

function deferredReads() {
  const pending: Array<{ resolve(value: ArrayBuffer): void; reject(error: unknown): void }> = [];
  const read = vi.fn<ReadInlineImage>(
    () => new Promise<ArrayBuffer>((resolve, reject) => pending.push({ resolve, reject })),
  );
  return { pending, read };
}

async function advance(milliseconds: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

function renderImages(readAgentInlineImage: ReadInlineImage | null) {
  const created: Array<{ url: string; type: string; size: number }> = [];
  const revoked: string[] = [];
  const surfaces: AgentInlineImagesSurface[] = [];
  const gateway = readAgentInlineImage === null ? null : { readAgentInlineImage };

  function Probe({ tick }: { readonly tick: number }) {
    surfaces.push(
      useAgentInlineImages({
        gateway,
        createObjectUrl: (blob) => {
          const url = `blob:${created.length}`;
          created.push({ url, type: blob.type, size: blob.size });
          return url;
        },
        revokeObjectUrl: (url) => revoked.push(url),
      }),
    );
    return createElement("span", null, tick);
  }

  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe, { tick: 0 })));

  const hook = (): AgentInlineImagesSurface => {
    const surface = surfaces[surfaces.length - 1];
    expect(surface).toBeDefined();
    return surface as AgentInlineImagesSurface;
  };

  return {
    created,
    revoked,
    surfaces,
    hook,
    rerender: (tick: number) => act(() => root.render(createElement(Probe, { tick }))),
    state: (index: number, workspaceId = "ws-1", threadId = THREAD_ID, scope = TURN) =>
      hook().stateOf(image(index, workspaceId, threadId, scope)),
    unmount: () => act(() => root.unmount()),
  };
}

describe("agentInlineImageUnavailableReason", () => {
  it("keeps the first line of a backend message and bounds its length", () => {
    expect(agentInlineImageUnavailableReason("The image is too large.\nstack", "/tmp/x.png")).toBe(
      "The image is too large.",
    );
    expect(agentInlineImageUnavailableReason(new Error(" gone "), "/tmp/x.png")).toBe("gone");
    const long = agentInlineImageUnavailableReason("é".repeat(500), "/tmp/x.png");
    expect([...long]).toHaveLength(MAX_AGENT_INLINE_IMAGE_UNAVAILABLE_REASON_CHARS);
  });

  it("falls back to a generic reason instead of exposing the path or an opaque value", () => {
    for (const error of ["Cannot open /tmp/x.png", "", "\n", null, undefined, { message: "x" }]) {
      expect(agentInlineImageUnavailableReason(error, "/tmp/x.png")).toBe(
        AGENT_INLINE_IMAGE_UNREADABLE_REASON,
      );
    }
  });
});

describe("useAgentInlineImages", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads an image once and publishes a blob url typed from its sniffed signature", async () => {
    const read = vi.fn<ReadInlineImage>(async (request) =>
      request.path === imagePath(2) ? imageBytes(WEBP_SIGNATURE, 40) : png(24),
    );
    const harness = renderImages(read);

    await act(async () => {
      harness.hook().ensure(image(1));
      harness.hook().ensure(image(2));
    });
    await waitForReact(() => expect(harness.state(2)).toEqual({ kind: "ready", url: "blob:1" }));

    expect(harness.state(1)).toEqual({ kind: "ready", url: "blob:0" });
    expect(harness.created).toEqual([
      { url: "blob:0", type: "image/png", size: 24 },
      { url: "blob:1", type: "image/webp", size: 40 },
    ]);
    expect(read.mock.calls).toEqual([
      [{ workspaceId: "ws-1", threadId: THREAD_ID, path: imagePath(1) }],
      [{ workspaceId: "ws-1", threadId: THREAD_ID, path: imagePath(2) }],
    ]);

    await act(async () => harness.hook().ensure(image(2)));
    expect(read).toHaveBeenCalledTimes(2);
    harness.unmount();
    expect(harness.revoked).toEqual(["blob:0", "blob:1"]);
  });

  it("deduplicates concurrent requests for the same image of one turn", async () => {
    const { pending, read } = deferredReads();
    const harness = renderImages(read);

    await act(async () => {
      for (let repeat = 0; repeat < 5; repeat += 1) harness.hook().ensure(image(1));
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(harness.state(1)).toEqual({ kind: "loading" });

    await act(async () => harness.hook().ensure(image(1)));
    await act(async () => pending[0]?.resolve(png()));

    expect(read).toHaveBeenCalledTimes(1);
    expect(harness.created).toHaveLength(1);
    expect(harness.state(1)).toEqual({ kind: "ready", url: "blob:0" });
    harness.unmount();
  });

  it("reads a path again for a later turn and leaves the earlier turn what it showed", async () => {
    const { pending, read } = deferredReads();
    const harness = renderImages(read);
    const earlier = image(1);
    const later = image(1, "ws-1", THREAD_ID, LATER_TURN);

    await act(async () => harness.hook().ensure(earlier));
    await act(async () => pending[0]?.resolve(png(16)));
    await act(async () => {
      harness.hook().ensure(earlier);
      harness.hook().ensure(later);
      harness.hook().ensure(later);
    });
    expect(harness.hook().stateOf(later)).toEqual({ kind: "loading" });
    expect(harness.hook().stateOf(earlier)).toEqual({ kind: "ready", url: "blob:0" });
    await act(async () => pending[1]?.resolve(png(48)));

    expect(read.mock.calls).toEqual([[wire(earlier)], [wire(later)]]);
    expect(harness.hook().stateOf(earlier)).toEqual({ kind: "ready", url: "blob:0" });
    expect(harness.hook().stateOf(later)).toEqual({ kind: "ready", url: "blob:1" });
    expect(harness.created.map((blob) => blob.size)).toEqual([16, 48]);
    expect(harness.revoked).toEqual([]);
    harness.unmount();
  });

  it("keeps the same image of two threads and two workspaces apart", async () => {
    const read = vi.fn<ReadInlineImage>(async () => png());
    const harness = renderImages(read);

    await act(async () => {
      harness.hook().ensure(image(1));
      harness.hook().ensure(image(1, "ws-1", OTHER_THREAD_ID));
      harness.hook().ensure(image(1, "ws-2"));
    });
    await waitForReact(() => expect(harness.created).toHaveLength(3));

    expect(read).toHaveBeenCalledTimes(3);
    expect(harness.state(1)?.kind).toBe("ready");
    expect(harness.state(1, "ws-1", OTHER_THREAD_ID)?.kind).toBe("ready");
    expect(harness.state(1, "ws-2")?.kind).toBe("ready");
    harness.unmount();
  });

  it("publishes an unavailable state without a blob url when the bytes are not an image", async () => {
    const harness = renderImages(
      vi.fn<ReadInlineImage>(async () => new TextEncoder().encode("<svg onload=x>").buffer),
    );

    await act(async () => harness.hook().ensure(image(1)));
    await waitForReact(() =>
      expect(harness.state(1)).toEqual({
        kind: "unavailable",
        reason: AGENT_INLINE_IMAGE_UNSUPPORTED_REASON,
      }),
    );
    expect(harness.created).toHaveLength(0);
    harness.unmount();
    expect(harness.revoked).toHaveLength(0);
  });

  it("refuses bytes beyond the per-image limit even from a gateway that returns them", async () => {
    const harness = renderImages(
      vi.fn<ReadInlineImage>(async () => png(MAX_AGENT_INLINE_IMAGE_BYTES + 1)),
    );

    await act(async () => harness.hook().ensure(image(1)));
    await waitForReact(() =>
      expect(harness.state(1)).toEqual({
        kind: "unavailable",
        reason: AGENT_INLINE_IMAGE_TOO_LARGE_REASON,
      }),
    );
    expect(harness.created).toHaveLength(0);
    harness.unmount();
  });

  it("maps a failure to a bounded reason that never contains the path", async () => {
    const read = vi.fn<ReadInlineImage>((request) => {
      if (request.path === imagePath(1)) return Promise.reject(GONE);
      if (request.path === imagePath(2)) {
        return Promise.reject(new Error(`open ${request.path}: denied`));
      }
      return Promise.reject(`${"x".repeat(400)}\nsecond line`);
    });
    const harness = renderImages(read);

    await act(async () => {
      for (let index = 1; index <= 3; index += 1) harness.hook().ensure(image(index));
    });
    await waitForReact(() => expect(harness.state(3)?.kind).toBe("unavailable"));

    expect(harness.state(1)).toEqual({ kind: "unavailable", reason: GONE });
    expect(harness.state(2)).toEqual({
      kind: "unavailable",
      reason: AGENT_INLINE_IMAGE_UNREADABLE_REASON,
    });
    expect(harness.state(3)).toEqual({
      kind: "unavailable",
      reason: "x".repeat(MAX_AGENT_INLINE_IMAGE_UNAVAILABLE_REASON_CHARS),
    });
    expect(read).toHaveBeenCalledTimes(3);
    expect(harness.created).toHaveLength(0);
    harness.unmount();
  });

  it("retries an unavailable image through the same read path only when asked", async () => {
    const read = vi.fn<ReadInlineImage>().mockRejectedValueOnce(GONE).mockResolvedValue(png(24));
    const harness = renderImages(read);

    await act(async () => harness.hook().ensure(image(1)));
    await waitForReact(() => expect(harness.state(1)?.kind).toBe("unavailable"));
    await act(async () => harness.hook().ensure(image(1)));
    expect(read).toHaveBeenCalledTimes(1);

    await act(async () => harness.hook().retry(image(1)));
    await waitForReact(() => expect(harness.state(1)).toEqual({ kind: "ready", url: "blob:0" }));

    expect(read.mock.calls).toEqual([[wire(image(1))], [wire(image(1))]]);
    harness.unmount();
  });

  it("starts a read for an unknown image on retry, ignores a loading one and reloads a ready one", async () => {
    const { pending, read } = deferredReads();
    const harness = renderImages(read);

    await act(async () => harness.hook().retry(image(1)));
    expect(read).toHaveBeenCalledTimes(1);
    expect(harness.state(1)).toEqual({ kind: "loading" });

    await act(async () => harness.hook().retry(image(1)));
    expect(read).toHaveBeenCalledTimes(1);

    await act(async () => pending[0]?.resolve(png()));
    expect(harness.state(1)).toEqual({ kind: "ready", url: "blob:0" });

    await act(async () => harness.hook().retry(image(1)));
    expect(harness.revoked).toEqual(["blob:0"]);
    expect(harness.state(1)).toEqual({ kind: "loading" });
    await act(async () => pending[1]?.resolve(png()));
    expect(harness.state(1)).toEqual({ kind: "ready", url: "blob:1" });
    expect(read).toHaveBeenCalledTimes(2);
    harness.unmount();
  });

  it("publishes a truthful state without a gateway", async () => {
    const harness = renderImages(null);

    await act(async () => harness.hook().ensure(image(1)));

    expect(harness.state(1)).toEqual({
      kind: "unavailable",
      reason: AGENT_INLINE_IMAGE_NO_GATEWAY_REASON,
    });
    harness.unmount();
  });

  it("retries the busy image read and publishes the image once it succeeds", async () => {
    vi.useFakeTimers();
    const read = vi
      .fn<ReadInlineImage>()
      .mockRejectedValueOnce(AGENT_INLINE_IMAGE_BUSY_MESSAGE)
      .mockRejectedValueOnce(new Error(AGENT_INLINE_IMAGE_BUSY_MESSAGE))
      .mockResolvedValue(png());
    const harness = renderImages(read);

    await act(async () => harness.hook().ensure(image(1)));
    expect(read).toHaveBeenCalledTimes(1);
    expect(harness.state(1)).toEqual({ kind: "loading" });

    await advance(AGENT_ATTACHMENT_READ_RETRY_DELAYS_MS[0] ?? 0);
    expect(read).toHaveBeenCalledTimes(2);
    expect(harness.state(1)).toEqual({ kind: "loading" });

    await advance(AGENT_ATTACHMENT_READ_RETRY_DELAYS_MS[1] ?? 0);
    expect(read).toHaveBeenCalledTimes(3);
    expect(harness.state(1)).toEqual({ kind: "ready", url: "blob:0" });
    expect(vi.getTimerCount()).toBe(0);
    harness.unmount();
  });

  it("gives up on a persistently busy read after the retry budget", async () => {
    vi.useFakeTimers();
    const read = vi.fn<ReadInlineImage>().mockRejectedValue(AGENT_INLINE_IMAGE_BUSY_MESSAGE);
    const harness = renderImages(read);

    await act(async () => harness.hook().ensure(image(1)));
    for (const delay of AGENT_ATTACHMENT_READ_RETRY_DELAYS_MS) {
      expect(harness.state(1)).toEqual({ kind: "loading" });
      await advance(delay);
    }
    await advance(10_000);

    expect(read).toHaveBeenCalledTimes(AGENT_ATTACHMENT_READ_RETRY_DELAYS_MS.length + 1);
    expect(harness.state(1)).toEqual({
      kind: "unavailable",
      reason: AGENT_INLINE_IMAGE_BUSY_MESSAGE,
    });
    expect(vi.getTimerCount()).toBe(0);
    harness.unmount();
  });

  it.each(["Runner is busy; retry shortly", "Runner request failed (HTTP 503).", GONE])(
    "does not retry the failure %s",
    async (message) => {
      vi.useFakeTimers();
      const read = vi.fn<ReadInlineImage>().mockRejectedValue(message);
      const harness = renderImages(read);

      await act(async () => harness.hook().ensure(image(1)));
      await advance(10_000);

      expect(read).toHaveBeenCalledTimes(1);
      expect(harness.state(1)).toEqual({ kind: "unavailable", reason: message });
      expect(vi.getTimerCount()).toBe(0);
      harness.unmount();
    },
  );

  it("keeps at most two reads in flight and resolves every queued image", async () => {
    const { pending, read } = deferredReads();
    const harness = renderImages(read);

    await act(async () => {
      for (let index = 0; index < 5; index += 1) harness.hook().ensure(image(index));
    });
    expect(read).toHaveBeenCalledTimes(MAX_AGENT_ATTACHMENT_CONCURRENT_READS);
    for (let index = 0; index < 5; index += 1) {
      expect(harness.state(index)).toEqual({ kind: "loading" });
    }

    for (let settled = 0; settled < 5; settled += 1) {
      expect(read.mock.calls.length - settled).toBeLessThanOrEqual(
        MAX_AGENT_ATTACHMENT_CONCURRENT_READS,
      );
      await act(async () => pending[settled]?.resolve(png()));
    }

    expect(read).toHaveBeenCalledTimes(5);
    for (let index = 0; index < 5; index += 1) expect(harness.state(index)?.kind).toBe("ready");
    harness.unmount();
  });

  it("drops a late result after the thread is released and never creates its url", async () => {
    const { pending, read } = deferredReads();
    const harness = renderImages(read);
    let release = (): void => undefined;

    await act(async () => {
      release = harness.hook().holdThread(OWNER);
      harness.hook().ensure(image(1));
      harness.hook().ensure(image(2));
      harness.hook().ensure(image(3));
      harness.hook().ensure(image(1, "ws-1", OTHER_THREAD_ID));
    });
    await act(async () => pending[0]?.resolve(png()));
    expect(harness.state(1)).toEqual({ kind: "ready", url: "blob:0" });

    act(() => release());
    act(() => release());

    expect(harness.revoked).toEqual(["blob:0"]);
    expect(harness.state(1)).toBeUndefined();
    expect(harness.state(1, "ws-1", OTHER_THREAD_ID)).toEqual({ kind: "loading" });

    expect(read).toHaveBeenCalledTimes(3);
    await act(async () => pending[1]?.resolve(png()));
    expect(harness.created).toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(4);
    expect(read).toHaveBeenLastCalledWith(wire(image(1, "ws-1", OTHER_THREAD_ID)));
    await act(async () => pending[2]?.resolve(png()));
    expect(harness.created).toHaveLength(1);
    await act(async () => pending[3]?.resolve(png()));

    expect(harness.created.map((blob) => blob.url)).toEqual(["blob:0", "blob:1"]);
    expect(harness.state(2)).toBeUndefined();
    expect(harness.state(3)).toBeUndefined();
    expect(harness.state(1, "ws-1", OTHER_THREAD_ID)).toEqual({ kind: "ready", url: "blob:1" });
    harness.unmount();
    expect(harness.revoked).toEqual(["blob:0", "blob:1"]);
  });

  it("keeps a thread's images until its last holder releases", async () => {
    const harness = renderImages(vi.fn<ReadInlineImage>(async () => png()));
    let first = (): void => undefined;
    let second = (): void => undefined;

    await act(async () => {
      first = harness.hook().holdThread(OWNER);
      second = harness.hook().holdThread(OWNER);
      harness.hook().ensure(image(1));
    });
    await waitForReact(() => expect(harness.state(1)?.kind).toBe("ready"));

    act(() => first());
    expect(harness.state(1)?.kind).toBe("ready");
    expect(harness.revoked).toHaveLength(0);

    act(() => second());
    expect(harness.state(1)).toBeUndefined();
    expect(harness.revoked).toEqual(["blob:0"]);
    harness.unmount();
  });

  it("does not resurrect a thread's stale entries across A to B to A", async () => {
    const { pending, read } = deferredReads();
    const harness = renderImages(read);
    const other = { workspaceId: "ws-2", threadId: THREAD_ID };
    let release = harness.hook().holdThread(OWNER);

    await act(async () => harness.hook().ensure(image(1)));
    await act(async () => pending[0]?.resolve(png()));
    await act(async () => harness.hook().ensure(image(2)));
    expect(harness.state(1)).toEqual({ kind: "ready", url: "blob:0" });

    act(() => release());
    expect(harness.revoked).toEqual(["blob:0"]);
    const releaseOther = harness.hook().holdThread(other);
    await act(async () => harness.hook().ensure(image(1, "ws-2")));
    expect(harness.state(1)).toBeUndefined();
    expect(harness.state(2)).toBeUndefined();

    act(() => releaseOther());
    release = harness.hook().holdThread(OWNER);
    await act(async () => {
      harness.hook().ensure(image(1));
      harness.hook().ensure(image(2));
    });
    expect(harness.state(1)).toEqual({ kind: "loading" });
    expect(harness.state(2)).toEqual({ kind: "loading" });

    await act(async () => pending[1]?.resolve(png()));
    expect(harness.state(2)).toEqual({ kind: "loading" });
    expect(harness.created).toHaveLength(1);

    await act(async () => pending[2]?.resolve(png()));
    expect(harness.created).toHaveLength(1);
    await act(async () => pending[3]?.resolve(png()));
    await act(async () => pending[4]?.resolve(png()));

    expect(read).toHaveBeenCalledTimes(5);
    expect(harness.state(1)).toEqual({ kind: "ready", url: "blob:1" });
    expect(harness.state(2)).toEqual({ kind: "ready", url: "blob:2" });
    expect(harness.state(1, "ws-2")).toBeUndefined();
    expect(harness.revoked).toEqual(["blob:0"]);
    act(() => release());
    harness.unmount();
  });

  it("evicts the least recently used off-screen image of a held thread past the bound", async () => {
    const harness = renderImages(vi.fn<ReadInlineImage>(async () => png()));
    const release = harness.hook().holdThread(OWNER);

    for (let index = 0; index < MAX_AGENT_INLINE_IMAGE_ENTRIES; index += 1) {
      await act(async () => harness.hook().ensure(image(index)));
      await waitForReact(() => expect(harness.state(index)?.kind).toBe("ready"));
    }
    expect(harness.revoked).toHaveLength(0);

    await act(async () => harness.hook().ensure(image(0)));
    await act(async () => harness.hook().ensure(image(100)));
    await waitForReact(() => expect(harness.state(100)?.kind).toBe("ready"));
    await act(async () => harness.hook().ensure(image(101)));
    await waitForReact(() => expect(harness.state(101)?.kind).toBe("ready"));

    expect(harness.revoked).toEqual(["blob:1", "blob:2"]);
    expect(harness.state(0)).toEqual({ kind: "ready", url: "blob:0" });
    expect(harness.state(1)).toBeUndefined();
    expect(harness.state(2)).toBeUndefined();
    act(() => release());
    harness.unmount();
  });

  it("settles with the overflow waiting when more images are on screen than fit, without looping reads", async () => {
    vi.useFakeTimers();
    const read = vi.fn<ReadInlineImage>(async () => png());
    const harness = renderImages(read);
    const total = MAX_AGENT_INLINE_IMAGE_ENTRIES + 8;
    const unpins: Array<() => void> = [];

    await act(async () => {
      for (let index = 0; index < total; index += 1) {
        unpins.push(harness.hook().pin(image(index)));
        harness.hook().ensure(image(index));
      }
    });
    await advance(60_000);

    expect(read).toHaveBeenCalledTimes(MAX_AGENT_INLINE_IMAGE_ENTRIES);
    expect(harness.revoked).toEqual([]);
    for (let index = 0; index < MAX_AGENT_INLINE_IMAGE_ENTRIES; index += 1) {
      expect(harness.state(index)?.kind).toBe("ready");
    }
    for (let index = MAX_AGENT_INLINE_IMAGE_ENTRIES; index < total; index += 1) {
      expect(harness.state(index)).toEqual({ kind: "waiting" });
    }

    await act(async () => harness.hook().retry(image(total - 1)));
    await advance(60_000);
    expect(read).toHaveBeenCalledTimes(MAX_AGENT_INLINE_IMAGE_ENTRIES);

    await act(async () => {
      unpins[0]?.();
      unpins[0]?.();
      unpins[1]?.();
    });
    await advance(60_000);

    expect(read).toHaveBeenCalledTimes(MAX_AGENT_INLINE_IMAGE_ENTRIES + 2);
    expect(harness.revoked).toEqual(["blob:0", "blob:1"]);
    expect(harness.state(0)).toBeUndefined();
    expect(harness.state(MAX_AGENT_INLINE_IMAGE_ENTRIES)?.kind).toBe("ready");
    expect(harness.state(MAX_AGENT_INLINE_IMAGE_ENTRIES + 1)?.kind).toBe("ready");
    expect(harness.state(MAX_AGENT_INLINE_IMAGE_ENTRIES + 2)).toEqual({ kind: "waiting" });

    await act(async () => {
      unpins[total - 1]?.();
    });
    expect(harness.state(total - 1)).toBeUndefined();
    await advance(60_000);
    expect(read).toHaveBeenCalledTimes(MAX_AGENT_INLINE_IMAGE_ENTRIES + 2);
    harness.unmount();
  });

  it("gives a request that cannot wait the manual-retry state and reads it on retry with room", async () => {
    const read = vi.fn<ReadInlineImage>(async () => png());
    const harness = renderImages(read);
    const unpins: Array<() => void> = [];

    await act(async () => {
      for (let index = 0; index < MAX_AGENT_INLINE_IMAGE_ENTRIES; index += 1) {
        unpins.push(harness.hook().pin(image(index)));
        harness.hook().ensure(image(index));
      }
    });
    await waitForReact(() => expect(harness.created).toHaveLength(MAX_AGENT_INLINE_IMAGE_ENTRIES));

    await act(async () => harness.hook().ensure(image(90)));
    expect(harness.state(90)).toEqual({
      kind: "unavailable",
      reason: AGENT_INLINE_IMAGE_QUEUE_LIMIT_REASON,
    });
    await act(async () => unpins[3]?.());
    await act(async () => harness.hook().ensure(image(90)));
    expect(read).toHaveBeenCalledTimes(MAX_AGENT_INLINE_IMAGE_ENTRIES);

    await act(async () => harness.hook().retry(image(90)));
    await waitForReact(() => expect(harness.state(90)?.kind).toBe("ready"));
    expect(harness.revoked).toEqual(["blob:3"]);
    harness.unmount();
  });

  it("never lets failed references take the room of a later good image", async () => {
    const read = vi.fn<ReadInlineImage>((request) =>
      request.path === imagePath(900) ? Promise.resolve(png()) : Promise.reject(GONE),
    );
    const harness = renderImages(read);

    await act(async () => {
      for (let index = 0; index < MAX_AGENT_INLINE_IMAGE_ENTRIES + 4; index += 1) {
        harness.hook().pin(image(index));
        harness.hook().ensure(image(index));
      }
    });
    await waitForReact(() =>
      expect(harness.state(MAX_AGENT_INLINE_IMAGE_ENTRIES + 3)).toEqual({
        kind: "unavailable",
        reason: GONE,
      }),
    );

    await act(async () => {
      harness.hook().pin(image(900));
      harness.hook().ensure(image(900));
    });
    await waitForReact(() => expect(harness.state(900)).toEqual({ kind: "ready", url: "blob:0" }));

    expect(harness.state(0)).toEqual({ kind: "unavailable", reason: GONE });
    expect(read).toHaveBeenCalledTimes(MAX_AGENT_INLINE_IMAGE_ENTRIES + 5);
    harness.unmount();
  });

  it("reclaims the byte budget from the oldest off-screen images first", async () => {
    const harness = renderImages(vi.fn<ReadInlineImage>(async () => png(10 * MIB)));

    for (let index = 0; index < 6; index += 1) {
      await act(async () => harness.hook().ensure(image(index)));
      await waitForReact(() => expect(harness.state(index)?.kind).toBe("ready"));
    }
    expect(harness.revoked).toHaveLength(0);

    await act(async () => harness.hook().ensure(image(0)));
    await act(async () => harness.hook().ensure(image(6)));
    await waitForReact(() => expect(harness.state(6)?.kind).toBe("ready"));

    expect(harness.revoked).toEqual(["blob:1"]);
    expect(harness.state(0)?.kind).toBe("ready");
    expect(harness.state(1)).toBeUndefined();
    harness.unmount();
    expect(harness.revoked).toHaveLength(7);
  });

  it("marks an image unavailable when on-screen images fill the byte budget, and loads it on retry once they left", async () => {
    const harness = renderImages(vi.fn<ReadInlineImage>(async () => png(10 * MIB)));
    const unpins: Array<() => void> = [];

    for (let index = 0; index < 7; index += 1) {
      await act(async () => {
        unpins.push(harness.hook().pin(image(index)));
        harness.hook().ensure(image(index));
      });
      await waitForReact(() => expect(harness.state(index)?.kind).not.toBe("loading"));
    }

    expect(harness.created).toHaveLength(6);
    expect(harness.revoked).toHaveLength(0);
    expect(harness.state(6)).toEqual({
      kind: "unavailable",
      reason: AGENT_INLINE_IMAGE_MEMORY_LIMIT_REASON,
    });

    await act(async () => unpins[0]?.());
    await act(async () => harness.hook().ensure(image(6)));
    expect(harness.state(6)?.kind).toBe("unavailable");
    expect(harness.created).toHaveLength(6);
    await act(async () => harness.hook().retry(image(6)));
    await waitForReact(() => expect(harness.state(6)?.kind).toBe("ready"));
    expect(harness.revoked).toEqual(["blob:0"]);
    harness.unmount();
  });

  it("stays the same surface and never re-renders its owner while images settle", async () => {
    const read = vi.fn<ReadInlineImage>((request) =>
      request.path === imagePath(2) ? Promise.reject(GONE) : Promise.resolve(png()),
    );
    const harness = renderImages(read);
    const seen = vi.fn();
    const unsubscribe = harness.hook().subscribe(seen);
    const before = harness.hook().revision();

    await act(async () => {
      for (let index = 0; index < MAX_AGENT_INLINE_IMAGE_ENTRIES + 1; index += 1) {
        harness.hook().pin(image(index));
        harness.hook().ensure(image(index));
      }
    });
    await waitForReact(() =>
      expect(harness.state(MAX_AGENT_INLINE_IMAGE_ENTRIES)?.kind).toBe("ready"),
    );

    expect(harness.surfaces).toHaveLength(1);
    expect(harness.hook().revision()).toBeGreaterThan(before);
    expect(seen.mock.calls.length).toBe(harness.hook().revision() - before);

    harness.rerender(1);
    harness.rerender(2);
    expect(harness.surfaces).toHaveLength(3);
    expect(new Set(harness.surfaces).size).toBe(1);

    unsubscribe();
    const calls = seen.mock.calls.length;
    await act(async () => harness.hook().retry(image(2)));
    expect(seen).toHaveBeenCalledTimes(calls);
    harness.unmount();
  });

  it("re-renders only the subscribed reader when the capacity state of its image changes", async () => {
    const read = vi.fn<ReadInlineImage>(async () => png());
    const kinds: Array<string | undefined> = [];
    const ownerRenders = vi.fn();
    const unpins: Array<() => void> = [];
    const watched = image(MAX_AGENT_INLINE_IMAGE_ENTRIES);

    function Reader({ images }: { readonly images: AgentInlineImagesSurface }) {
      const state = useSyncExternalStore(images.subscribe, () => images.stateOf(watched));
      kinds.push(state?.kind);
      return null;
    }

    function Owner() {
      ownerRenders();
      const images = useAgentInlineImages({
        gateway: { readAgentInlineImage: read },
        createObjectUrl: () => "blob:x",
        revokeObjectUrl: () => undefined,
      });
      useEffect(() => {
        for (let index = 0; index <= MAX_AGENT_INLINE_IMAGE_ENTRIES; index += 1) {
          unpins.push(images.pin(image(index)));
          images.ensure(image(index));
        }
      }, [images]);
      return createElement(Reader, { images });
    }

    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Owner)));
    await waitForReact(() => expect(read).toHaveBeenCalledTimes(MAX_AGENT_INLINE_IMAGE_ENTRIES));
    expect(kinds[kinds.length - 1]).toBe("waiting");

    await act(async () => unpins[0]?.());
    await waitForReact(() => expect(kinds[kinds.length - 1]).toBe("ready"));

    expect(ownerRenders).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(MAX_AGENT_INLINE_IMAGE_ENTRIES + 1);
    act(() => root.unmount());
  });

  it("overlays a decode failure on the exact url and clears it when the image is read again", async () => {
    const harness = renderImages(vi.fn<ReadInlineImage>(async () => png()));
    await act(async () => harness.hook().ensure(image(1)));
    await waitForReact(() => expect(harness.state(1)?.kind).toBe("ready"));
    const revision = harness.hook().revision();

    harness.hook().markBroken(image(1), "blob:stale");
    harness.hook().markBroken(image(2), "blob:0");
    expect(harness.state(1)).toEqual({ kind: "ready", url: "blob:0" });
    expect(harness.hook().revision()).toBe(revision);

    harness.hook().markBroken(image(1), "blob:0");
    harness.hook().markBroken(image(1), "blob:0");
    expect(harness.state(1)).toEqual({
      kind: "unavailable",
      reason: AGENT_INLINE_IMAGE_DECODE_FAILED_REASON,
    });
    expect(harness.hook().revision()).toBe(revision + 1);

    await act(async () => harness.hook().retry(image(1)));
    await waitForReact(() => expect(harness.state(1)).toEqual({ kind: "ready", url: "blob:1" }));
    expect(harness.revoked).toEqual(["blob:0"]);
    harness.unmount();
  });

  it("remembers a measured size across eviction and forgets it with the thread", async () => {
    const harness = renderImages(vi.fn<ReadInlineImage>(async () => png()));
    const release = harness.hook().holdThread(OWNER);
    await act(async () => harness.hook().ensure(image(0)));
    await waitForReact(() => expect(harness.state(0)?.kind).toBe("ready"));
    const revision = harness.hook().revision();

    harness.hook().measure(image(0), "blob:stale", { width: 10, height: 10 });
    harness.hook().measure(image(1), "blob:0", { width: 10, height: 10 });
    for (const size of [
      { width: 0, height: 10 },
      { width: 10, height: Number.NaN },
      { width: 1.5, height: 10 },
    ]) {
      harness.hook().measure(image(0), "blob:0", size);
    }
    expect(harness.hook().sizeOf(image(0))).toBeNull();

    harness.hook().measure(image(0), "blob:0", { width: 2_560, height: 1_440 });
    expect(harness.hook().sizeOf(image(0))).toEqual({ width: 2_560, height: 1_440 });
    expect(harness.hook().revision()).toBe(revision);

    for (let index = 1; index <= MAX_AGENT_INLINE_IMAGE_ENTRIES; index += 1) {
      await act(async () => harness.hook().ensure(image(index)));
    }
    await waitForReact(() =>
      expect(harness.state(MAX_AGENT_INLINE_IMAGE_ENTRIES)?.kind).toBe("ready"),
    );
    expect(harness.state(0)).toBeUndefined();
    expect(harness.hook().sizeOf(image(0))).toEqual({ width: 2_560, height: 1_440 });

    act(() => release());
    expect(harness.hook().sizeOf(image(0))).toBeNull();
    harness.unmount();
  });

  it("revokes every url on unmount and drops queued, in-flight and backing-off reads", async () => {
    vi.useFakeTimers();
    const pending: Array<(value: ArrayBuffer) => void> = [];
    const read = vi.fn<ReadInlineImage>((request) => {
      if (request.path === imagePath(0)) return Promise.resolve(png());
      if (request.path === imagePath(1)) return Promise.reject(AGENT_INLINE_IMAGE_BUSY_MESSAGE);
      return new Promise<ArrayBuffer>((resolve) => pending.push(resolve));
    });
    const harness = renderImages(read);

    await act(async () => harness.hook().ensure(image(0)));
    expect(harness.state(0)).toEqual({ kind: "ready", url: "blob:0" });
    await act(async () => {
      for (let index = 1; index < 5; index += 1) harness.hook().ensure(image(index));
    });
    expect(read).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(1);

    harness.unmount();

    expect(harness.revoked).toEqual(["blob:0"]);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => pending[0]?.(png()));
    await advance(10_000);
    expect(read).toHaveBeenCalledTimes(3);
    expect(harness.created).toHaveLength(1);
  });

  it("loads an image requested by a child effect during a StrictMode remount", async () => {
    const gateway: AgentInlineImageGateway = {
      readAgentInlineImage: vi.fn<ReadInlineImage>(async () => png()),
    };
    const revoked: string[] = [];
    let surface: AgentInlineImagesSurface | null = null;

    function Child({ images }: { readonly images: AgentInlineImagesSurface }) {
      useEffect(() => {
        const unpin = images.pin(image(1));
        images.ensure(image(1));
        return unpin;
      }, [images]);
      useEffect(() => images.holdThread(OWNER), [images]);
      return null;
    }

    function Owner() {
      surface = useAgentInlineImages({
        gateway,
        createObjectUrl: () => "blob:strict",
        revokeObjectUrl: (url) => revoked.push(url),
      });
      return createElement(Child, { images: surface });
    }

    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(StrictMode, null, createElement(Owner))));

    await waitForReact(() =>
      expect(surface?.stateOf(image(1))).toEqual({ kind: "ready", url: "blob:strict" }),
    );
    act(() => root.unmount());
    expect(revoked).toEqual(["blob:strict"]);
  });
});
