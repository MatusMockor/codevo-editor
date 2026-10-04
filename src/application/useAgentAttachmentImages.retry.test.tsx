// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAttachmentGateway } from "./agentAttachmentPorts";
import { waitForReact } from "../test/reactTestLifecycle";
import {
  agentAttachmentImageKey,
  useAgentAttachmentImages,
  type AgentAttachmentImageCache,
  type AgentAttachmentImagesDependencies,
} from "./useAgentAttachmentImages";

const THREAD_ID = "agt-1-0a1b";
const attachmentId = (index: number): string => index.toString(16).padStart(32, "0");
const imageRequest = (index: number, workspaceId = "ws-1") =>
  ({
    workspaceId,
    threadId: THREAD_ID,
    attachmentId: attachmentId(index),
    mime: "image/png",
  }) as const;

function renderCache(
  readAgentAttachment: AgentAttachmentGateway["readAgentAttachment"],
  presentError?: AgentAttachmentImagesDependencies["presentError"],
) {
  const created: string[] = [];
  const revoked: string[] = [];
  const errors: unknown[] = [];
  let cache!: AgentAttachmentImageCache;
  const gateway = { readAgentAttachment } as AgentAttachmentGateway;
  function Probe() {
    cache = useAgentAttachmentImages({
      gateway,
      reportError: (_source, error) => errors.push(error),
      presentError,
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
    revoked,
    errors,
    cache: () => cache,
    stateOf: (index: number, workspaceId = "ws-1") =>
      cache.images.get(agentAttachmentImageKey(workspaceId, THREAD_ID, attachmentId(index))),
    unmount: () => act(() => root.unmount()),
  };
}

describe("agent attachment image cache retry", () => {
  beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
  afterEach(() => vi.unstubAllGlobals());

  it("retries only the unavailable image and leaves a ready sibling untouched", async () => {
    const failed = attachmentId(2);
    let failing = true;
    const read = vi.fn(async (request: { readonly attachmentId: string }) => {
      const reject = failing && request.attachmentId === failed;
      return reject
        ? Promise.reject(new Error("Agent attachment is no longer available."))
        : new Uint8Array([1, 2, 3]).buffer;
    });
    const harness = renderCache(read);
    await act(async () => harness.cache().ensure(imageRequest(1)));
    await act(async () => harness.cache().ensure(imageRequest(2)));
    await waitForReact(() => expect(harness.stateOf(2)?.kind).toBe("unavailable"));
    expect(harness.stateOf(1)).toEqual({ kind: "ready", url: "blob:0" });

    failing = false;
    await act(async () => harness.cache().retry(imageRequest(1)));
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => harness.cache().retry(imageRequest(2)));
    await waitForReact(() => expect(harness.stateOf(2)).toEqual({ kind: "ready", url: "blob:1" }));
    expect(harness.stateOf(1)).toEqual({ kind: "ready", url: "blob:0" });
    expect(read).toHaveBeenCalledTimes(3);
    expect(harness.revoked).toEqual([]);

    await act(async () => harness.cache().retry(imageRequest(3)));
    expect(harness.stateOf(3)).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(3);
    harness.unmount();
  });

  it("releases every workspace at once and ignores reads that settle afterwards", async () => {
    let finish!: (bytes: ArrayBuffer) => void;
    const read = vi.fn(async (request: { readonly workspaceId: string }) =>
      request.workspaceId === "ws-3"
        ? new Promise<ArrayBuffer>((resolve) => {
            finish = resolve;
          })
        : request.workspaceId === "ws-2"
          ? Promise.reject(new Error("Agent attachment is no longer available."))
          : new Uint8Array([1]).buffer,
    );
    const harness = renderCache(read);
    await act(async () => harness.cache().ensure(imageRequest(1)));
    await act(async () => harness.cache().ensure(imageRequest(2, "ws-2")));
    await act(async () => harness.cache().ensure(imageRequest(3, "ws-3")));
    await waitForReact(() => expect(harness.stateOf(2, "ws-2")?.kind).toBe("unavailable"));
    expect(harness.stateOf(3, "ws-3")).toEqual({ kind: "loading" });

    await act(async () => harness.cache().releaseAll());
    expect(harness.cache().images.size).toBe(0);
    expect(harness.revoked).toEqual(["blob:0"]);
    await act(async () => finish(new Uint8Array([1]).buffer));
    expect(harness.cache().images.size).toBe(0);
    harness.unmount();
  });

  it("shows and reports the presented error instead of the raw read failure", async () => {
    const presented = new Error("The server is busy.");
    const harness = renderCache(
      vi.fn(async () => Promise.reject(new Error("backend 10.0.0.7 refused"))),
      () => presented,
    );
    await act(async () => harness.cache().ensure(imageRequest(1)));
    await waitForReact(() =>
      expect(harness.stateOf(1)).toEqual({ kind: "unavailable", reason: "The server is busy." }),
    );
    expect(harness.errors).toEqual([presented]);
    harness.unmount();
  });
});
