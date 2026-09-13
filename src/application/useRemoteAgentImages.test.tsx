// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { attachmentImagesSurfaceFixture } from "../components/agentMode/agentThreadsSurfaceTestFixtures";
import type { AgentAttachmentGateway } from "./agentAttachmentPorts";
import {
  agentAttachmentImageKey,
  useAgentAttachmentImages,
  type AgentAttachmentImagesSurface,
} from "./useAgentAttachmentImages";
import { useRemoteAgentImages } from "./useRemoteAgentImages";

const request = {
  workspaceId: "remote:server/project",
  threadId: "remote-thread:conversation",
  attachmentId: "image",
  mime: "image/png",
} as const;
describe("merged remote image ownership", () => {
  it("keeps the transcript hold stable while a real image read publishes loading and ready states", async () => {
    const read = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer);
    const gateway: AgentAttachmentGateway = {
      stageAgentAttachmentBytes: vi.fn(),
      stageAgentAttachmentFromPath: vi.fn(),
      inspectAgentAttachmentCandidate: vi.fn(),
      readAgentAttachmentCandidate: vi.fn(),
      claimAgentAttachments: vi.fn(),
      releaseAgentAttachment: vi.fn(),
      readAgentAttachment: read,
      revealAgentAttachment: vi.fn(),
    };
    const local = attachmentImagesSurfaceFixture({ holdThread: vi.fn(), ensure: vi.fn() });
    const revoked = vi.fn();
    let effectCount = 0;
    let cleanupCount = 0;
    let surface!: AgentAttachmentImagesSurface;
    function Transcript({ images }: { images: AgentAttachmentImagesSurface }) {
      const hold = images.holdThread;
      useEffect(() => {
        effectCount += 1;
        // Bound a regression instead of letting an effect/cleanup publish loop hang the suite.
        if (effectCount > 3) throw new Error("Image publication restarted the transcript hold");
        const release = hold(request);
        return () => {
          cleanupCount += 1;
          release();
        };
      }, [hold]);
      return null;
    }
    function Harness() {
      const remote = useAgentAttachmentImages({
        gateway,
        reportError: vi.fn(),
        createObjectUrl: () => "blob:remote-preview",
        revokeObjectUrl: revoked,
      });
      surface = useRemoteAgentImages(local, remote);
      return createElement(Transcript, { images: surface });
    }
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => {
        root.render(createElement(Harness));
      });
      const initialHold = surface.holdThread;
      const initialEnsure = surface.ensure;
      await act(async () => {
        surface.ensure(request);
      });
      expect(
        surface.images.get(
          agentAttachmentImageKey(request.workspaceId, request.threadId, request.attachmentId),
        ),
      ).toEqual({ kind: "ready", url: "blob:remote-preview" });
      expect(surface.holdThread).toBe(initialHold);
      expect(surface.ensure).toBe(initialEnsure);
      expect(effectCount).toBe(1);
      expect(cleanupCount).toBe(0);
      expect(revoked).not.toHaveBeenCalled();
      expect(local.holdThread).not.toHaveBeenCalled();
      expect(local.ensure).not.toHaveBeenCalled();
      expect(read).toHaveBeenCalledOnce();
    } finally {
      act(() => root.unmount());
    }
    expect(cleanupCount).toBe(1);
    expect(revoked).toHaveBeenCalledExactlyOnceWith("blob:remote-preview");
  });

  it("routes replaced remote methods to their new port and preserves local ownership", async () => {
    const local = attachmentImagesSurfaceFixture({ ensure: vi.fn() });
    let remote = attachmentImagesSurfaceFixture({ ensure: vi.fn() });
    const original = remote;
    let surface!: AgentAttachmentImagesSurface;
    function Harness() {
      surface = useRemoteAgentImages(local, remote);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => {
        root.render(createElement(Harness));
      });
      remote = attachmentImagesSurfaceFixture({
        ensure: vi.fn(),
        images: new Map([["ready", { kind: "ready", url: "blob:next" }]]),
      });
      await act(async () => {
        root.render(createElement(Harness));
      });
      surface.ensure(request);
      surface.ensure({ ...request, workspaceId: "local-workspace" });
      expect(remote.ensure).toHaveBeenCalledExactlyOnceWith(request);
      expect(original.ensure).not.toHaveBeenCalled();
      expect(local.ensure).toHaveBeenCalledExactlyOnceWith({
        ...request,
        workspaceId: "local-workspace",
      });
      expect(surface.images.get("ready")).toEqual({ kind: "ready", url: "blob:next" });
    } finally {
      act(() => root.unmount());
    }
  });
});
