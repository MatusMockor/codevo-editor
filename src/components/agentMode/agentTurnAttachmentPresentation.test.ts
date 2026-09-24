import { describe, expect, it } from "vitest";
import type { AgentAttachment } from "../../domain/agentAttachment";
import { parseExternalSessionExchange } from "../../domain/externalAgentSession";
import {
  AGENT_IMPORTED_IMAGE_LABEL,
  agentAttachmentImageIsResolvable,
  agentAttachmentLightboxFit,
  agentLightboxNeighborIndex,
  agentImportedAttachmentViews,
  agentTurnAttachmentViews,
  formatAgentAttachmentBytes,
} from "./agentTurnAttachmentPresentation";

const IMAGE_ID = "a".repeat(32);

const IMAGE: AgentAttachment = {
  kind: "image",
  attachmentId: IMAGE_ID,
  name: "shot.png",
  mime: "image/png",
  bytes: 2_048,
  width: 800,
  height: 600,
  storedPath: "/data/agent-attachments/threads/agt-1/shot.png",
};

const FILE: AgentAttachment = {
  kind: "file",
  attachmentId: "b".repeat(32),
  name: "notes.txt",
  bytes: 1_024,
  storedPath: "/data/agent-attachments/threads/agt-1/notes.bin",
};

const REFERENCE: AgentAttachment = {
  kind: "reference",
  name: "clip.mp4",
  path: "/workspace/app/clip.mp4",
  bytes: 5_000_000,
};

describe("agentTurnAttachmentViews", () => {
  it("keeps images inline and everything else as a named chip", () => {
    expect(agentTurnAttachmentViews([IMAGE, FILE, REFERENCE])).toEqual([
      {
        kind: "image",
        key: IMAGE_ID,
        name: "shot.png",
        attachmentId: IMAGE_ID,
        mime: "image/png",
        width: 800,
        height: 600,
      },
      { kind: "chip", key: "b".repeat(32), name: "notes.txt", glyph: "file" },
      {
        kind: "chip",
        key: "reference-2-/workspace/app/clip.mp4",
        name: "clip.mp4",
        glyph: "reference",
      },
    ]);
  });

  it("returns nothing for a turn without attachments", () => {
    expect(agentTurnAttachmentViews(undefined)).toEqual([]);
    expect(agentTurnAttachmentViews([])).toEqual([]);
  });

  it("bounds a turn to the per-turn attachment cap", () => {
    const many = Array.from({ length: 12 }, () => REFERENCE);

    expect(agentTurnAttachmentViews(many)).toHaveLength(8);
  });

  it("treats an unresolvable image id or mime as not resolvable", () => {
    expect(
      agentAttachmentImageIsResolvable({
        kind: "image",
        key: "k",
        name: "shot.png",
        attachmentId: "short",
        mime: "image/png",
      }),
    ).toBe(false);
    expect(agentAttachmentImageIsResolvable(agentTurnAttachmentViews([IMAGE])[0]!)).toBe(true);
    expect(agentAttachmentImageIsResolvable(agentTurnAttachmentViews([FILE])[0]!)).toBe(false);
  });
});

describe("agentImportedAttachmentViews", () => {
  it("renders imported images and files as chips only", () => {
    expect(
      agentImportedAttachmentViews(
        parseExternalSessionExchange({
          text: "look",
          role: "user",
          attachments: [
            { kind: "image", mime: "image/png" },
            { kind: "image", mime: "image/png", path: "/var/folders/T/codex-clipboard-1.png" },
            { kind: "file", name: "notes.txt", path: "/Users/dev/notes.txt" },
          ],
        }),
      ),
    ).toEqual([
      { kind: "chip", key: "imported-0", name: AGENT_IMPORTED_IMAGE_LABEL, glyph: "image" },
      { kind: "chip", key: "imported-1", name: "codex-clipboard-1.png", glyph: "image" },
      { kind: "chip", key: "imported-2", name: "notes.txt", glyph: "file" },
    ]);
  });

  it("labels an imported image by its original name before the stored basename", () => {
    expect(
      agentImportedAttachmentViews(
        parseExternalSessionExchange({
          text: "look",
          role: "user",
          attachments: [
            {
              kind: "image",
              mime: "image/png",
              name: "screenshot.png",
              path: "/store/threads/agt-1/d88cab3ac346ee5db5e41f35f35a1d8a.png",
            },
            { kind: "image", mime: "image/png", name: "pasted.png" },
            { kind: "image", mime: "image/png", path: "/store/threads/agt-1/" },
          ],
        }),
      ).map((view) => view.name),
    ).toEqual(["screenshot.png", "pasted.png", AGENT_IMPORTED_IMAGE_LABEL]);
  });

  it("renders nothing for an exchange without the field", () => {
    expect(agentImportedAttachmentViews({ attachments: undefined })).toEqual([]);
    expect(
      agentImportedAttachmentViews(parseExternalSessionExchange({ role: "user", text: "look" })),
    ).toEqual([]);
  });

  it("bounds an imported exchange to the per-turn attachment cap", () => {
    const many = Array.from({ length: 12 }, () => ({ kind: "file", name: "notes.txt" }) as const);

    expect(agentImportedAttachmentViews({ attachments: many })).toHaveLength(8);
  });
});

describe("imported attachment dimensions", () => {
  it("gives imported images no dimensions because they render as chips", () => {
    const [imported] = agentImportedAttachmentViews(
      parseExternalSessionExchange({
        role: "user",
        text: "look",
        attachments: [{ kind: "image", mime: "image/png" }],
      }),
    );

    expect(imported?.kind).toBe("chip");
    expect(imported).not.toHaveProperty("width");
  });
});

describe("agentAttachmentLightboxFit", () => {
  it("caps the lightbox image at the viewport fraction and at its natural size", () => {
    expect(agentAttachmentLightboxFit({ width: 800, height: 600 })).toEqual({
      maxWidth: "min(92vw, 800px)",
      maxHeight: "min(86vh, 600px)",
    });
    expect(agentAttachmentLightboxFit({ width: 120.4, height: 33.6 })).toEqual({
      maxWidth: "min(92vw, 120px)",
      maxHeight: "min(86vh, 34px)",
    });
  });

  it("leaves the viewport cap alone when the natural size is unknown or unusable", () => {
    expect(agentAttachmentLightboxFit({})).toBeNull();
    expect(agentAttachmentLightboxFit({ width: 800 })).toBeNull();
    expect(agentAttachmentLightboxFit({ width: 0, height: 600 })).toBeNull();
    expect(agentAttachmentLightboxFit({ width: 800, height: Number.POSITIVE_INFINITY })).toBeNull();
    expect(agentAttachmentLightboxFit({ width: -5, height: 600 })).toBeNull();
  });
});

describe("agentLightboxNeighborIndex", () => {
  const items = ["a", "b", "c", "d"].map((attachmentId) => ({ attachmentId }));

  it("steps to the nearest ready sibling and skips the ones that are not ready", () => {
    const ready = (attachmentId: string) => attachmentId !== "b";
    expect(agentLightboxNeighborIndex(items, 0, 1, ready)).toBe(2);
    expect(agentLightboxNeighborIndex(items, 2, -1, ready)).toBe(0);
    expect(agentLightboxNeighborIndex(items, 2, 1, ready)).toBe(3);
  });

  it("clamps at the ends and when no sibling in that direction is ready", () => {
    const ready = (attachmentId: string) => attachmentId !== "d";
    expect(agentLightboxNeighborIndex(items, 0, -1, ready)).toBeNull();
    expect(agentLightboxNeighborIndex(items, 2, 1, ready)).toBeNull();
    expect(agentLightboxNeighborIndex(items, 3, 1, ready)).toBeNull();
  });

  it("refuses an index outside the list", () => {
    const ready = () => true;
    expect(agentLightboxNeighborIndex(items, -1, 1, ready)).toBeNull();
    expect(agentLightboxNeighborIndex(items, 4, -1, ready)).toBeNull();
    expect(agentLightboxNeighborIndex(items, 1.5, 1, ready)).toBeNull();
    expect(agentLightboxNeighborIndex([], 0, 1, ready)).toBeNull();
  });
});

describe("formatAgentAttachmentBytes", () => {
  it("reads bytes, kilobytes and megabytes", () => {
    expect(formatAgentAttachmentBytes(0)).toBe("0 B");
    expect(formatAgentAttachmentBytes(512)).toBe("512 B");
    expect(formatAgentAttachmentBytes(2_048)).toBe("2.0 KiB");
    expect(formatAgentAttachmentBytes(5_000_000)).toBe("4.8 MiB");
    expect(formatAgentAttachmentBytes(10 * 1_024 * 1_024)).toBe("10 MiB");
    expect(formatAgentAttachmentBytes(-1)).toBe("");
  });
});
