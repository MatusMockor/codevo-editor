// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentImageSurfacePort } from "../domain/agentImageShrink";
import { useRemoteAgentAttachments } from "./useRemoteAgentAttachments";

describe("remote attachment image normalization", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([1024, 5 * 1024 * 1024 + 1, 10 * 1024 * 1024 + 1])(
    "stages a %i-byte PNG using the runner's size and format limits",
    async (size) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      const createObjectURL = vi.fn(() => "blob:remote-preview");
      const revokeObjectURL = vi.fn();
      vi.stubGlobal(
        "URL",
        class extends URL {
          static createObjectURL = createObjectURL;
          static revokeObjectURL = revokeObjectURL;
        },
      );
      const encode = vi.fn(async () => new ArrayBuffer(1024));
      const imageSurface: AgentImageSurfacePort = {
        decode: async () => ({ width: 4096, height: 2048 }),
        encodeMime: vi.fn(async () => "image/webp" as const),
        encode,
        release: vi.fn(),
      };
      const owner = {
        projectRootKey: "project",
        workspaceId: "project",
        ownerId: "owner",
        generation: 1,
      };
      const reportError = vi.fn();
      let result: ReturnType<typeof useRemoteAgentAttachments> | undefined;
      function Probe() {
        result = useRemoteAgentAttachments({
          gateway: null,
          imageSurface,
          resolveOwner: () => owner,
          resolveServer: () => "server",
          reportError,
        });
        return null;
      }
      const root = createRoot(document.createElement("div"));
      try {
        act(() => root.render(createElement(Probe)));
        await act(async () => {
          await result!.attachments.add("project", [
            { kind: "bytes", name: "large.png", mime: "image/png", bytes: new ArrayBuffer(size) },
          ]);
        });
        expect(result!.attachments.drafts).toMatchObject([
          {
            state: "ready",
            name: size === 1024 ? "large.png" : "large.jpg",
            mime: size === 1024 ? "image/png" : "image/jpeg",
            bytes: 1024,
          },
        ]);
        if (size === 1024) expect(encode).not.toHaveBeenCalled();
        else
          expect(encode.mock.calls[0]).toEqual([
            { width: 4096, height: 2048 },
            2048,
            1024,
            "image/jpeg",
            0.92,
          ]);
        expect(imageSurface.encodeMime).not.toHaveBeenCalled();
        expect(reportError).not.toHaveBeenCalled();
      } finally {
        act(() => root.unmount());
      }
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:remote-preview");
    },
  );
});
