// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { MAX_AGENT_IMAGE_BYTES } from "../domain/agentAttachment";
import {
  AGENT_ATTACHMENT_COUNT_REFUSAL,
  AGENT_ATTACHMENT_IMAGE_BYTES_REFUSAL,
  AGENT_ATTACHMENT_OVERSIZED_IMAGE_NOTICE,
  AGENT_ATTACHMENT_PATH_REFUSAL,
} from "../domain/agentAttachmentIntake";
import type { AgentImageSurfacePort } from "../domain/agentImageShrink";
import type { AgentAttachmentGateway } from "./agentAttachmentPorts";
import {
  AGENT_ATTACHMENT_MISSING_SOURCE_NOTICE,
  AGENT_ATTACHMENT_STAGE_FAILURE_PREFIX,
  useAgentComposerAttachments,
  type AgentAttachmentOwner,
  type AgentComposerAttachmentsSurface,
} from "./useAgentComposerAttachments";

const ROOT_A = "/workspace/app";
const ROOT_B = "/workspace/other";
const IMAGE_ID = "0123456789abcdef0123456789abcdef";

interface Environment {
  owners: Map<string, AgentAttachmentOwner>;
  isRegularFile: boolean;
  candidateBytes: number;
  extensionMime: string | null;
  stageError: Error | null;
  decodable: boolean;
  encodedBytes: number;
  onStage: (() => void) | null;
}

function ownerA(generation = 1): AgentAttachmentOwner {
  return { projectRootKey: ROOT_A, ownerId: "owner-a", generation, workspaceId: "ws-a" };
}

function ownerB(): AgentAttachmentOwner {
  return { projectRootKey: ROOT_B, ownerId: "owner-b", generation: 1, workspaceId: "ws-b" };
}

function imageSurface(environment: Environment): AgentImageSurfacePort {
  return {
    decode: async () => {
      if (!environment.decodable) throw new Error("undecodable");
      return { width: 4_096, height: 2_048 };
    },
    encodeMime: async () => "image/webp",
    encode: async () => new ArrayBuffer(environment.encodedBytes),
    release: () => undefined,
  };
}

function renderAttachments(environment: Environment) {
  const released: string[] = [];
  let draftSequence = 0;
  const gateway: AgentAttachmentGateway = {
    stageAgentAttachmentBytes: vi.fn(async ({ name, mime, width, height }) => {
      environment.onStage?.();
      if (environment.stageError !== null) throw environment.stageError;
      return {
        attachmentId: IMAGE_ID,
        name,
        mime,
        bytes: 512,
        width,
        height,
        promptLineBytesMax: 120,
      };
    }),
    stageAgentAttachmentFromPath: vi.fn(async ({ name, mime }) => {
      environment.onStage?.();
      if (environment.stageError !== null) throw environment.stageError;
      return {
        attachmentId: IMAGE_ID,
        name,
        mime,
        bytes: 4_096,
        width: 100,
        height: 50,
        promptLineBytesMax: 140,
      };
    }),
    inspectAgentAttachmentCandidate: vi.fn(async () => ({
      bytes: environment.candidateBytes,
      isRegularFile: environment.isRegularFile,
      extensionMime: environment.extensionMime,
    })),
    readAgentAttachmentCandidate: vi.fn(async () => new ArrayBuffer(environment.candidateBytes)),
    claimAgentAttachments: vi.fn(),
    releaseAgentAttachment: vi.fn(async ({ attachmentId }) => {
      released.push(attachmentId);
    }),
    readAgentAttachment: vi.fn(),
    revealAgentAttachment: vi.fn(),
  };
  const errors: unknown[] = [];
  let surface: AgentComposerAttachmentsSurface | null = null;

  function Probe() {
    surface = useAgentComposerAttachments({
      gateway,
      imageSurface: imageSurface(environment),
      resolveOwner: (projectRootKey) => environment.owners.get(projectRootKey) ?? null,
      reportError: (_source, error) => errors.push(error),
      createDraftId: () => `draft-${(draftSequence += 1)}`,
    });
    return null;
  }

  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(createElement(Probe)));

  return {
    errors,
    gateway,
    released,
    hook: (): AgentComposerAttachmentsSurface => {
      if (surface === null) throw new Error("The attachment surface is not mounted.");
      return surface;
    },
    unmount: () => act(() => root.unmount()),
  };
}

function environment(overrides: Partial<Environment> = {}): Environment {
  return {
    owners: new Map([[ROOT_A, ownerA()]]),
    isRegularFile: true,
    candidateBytes: 4_096,
    extensionMime: "image/png",
    stageError: null,
    decodable: true,
    encodedBytes: 512,
    onStage: null,
    ...overrides,
  };
}

describe("useAgentComposerAttachments staging", () => {
  it("stages a pasted image through the shrink pipeline and reports it ready", async () => {
    const env = environment();
    const harness = renderAttachments(env);

    await act(() =>
      harness.hook().add(ROOT_A, [
        {
          kind: "bytes",
          name: "shot.png",
          mime: "image/png",
          bytes: new ArrayBuffer(MAX_AGENT_IMAGE_BYTES + 1),
        },
      ]),
    );

    const draft = harness.hook().drafts[0];
    expect(draft).toMatchObject({
      kind: "image",
      state: "ready",
      name: "shot.webp",
      mime: "image/webp",
      attachmentId: IMAGE_ID,
      bytes: 512,
    });
    expect(harness.hook().blocked).toBe(false);
    expect(harness.hook().staging).toBe(false);
    harness.unmount();
  });

  it("stages a path-backed image within budget through the store copy", async () => {
    const harness = renderAttachments(environment());

    await act(() => harness.hook().add(ROOT_A, [{ kind: "path", path: "/Users/dev/shot.png" }]));

    expect(harness.gateway.stageAgentAttachmentFromPath).toHaveBeenCalledWith({
      workspaceId: "ws-a",
      kind: "image",
      name: "shot.png",
      mime: "image/png",
      path: "/Users/dev/shot.png",
    });
    expect(harness.gateway.readAgentAttachmentCandidate).not.toHaveBeenCalled();
    expect(harness.hook().drafts[0]).toMatchObject({ kind: "image", state: "ready" });
    harness.unmount();
  });

  it("keeps an unattachable dropped file as a reference with its path line budget", async () => {
    const harness = renderAttachments(
      environment({ extensionMime: null, candidateBytes: 9_000_000 }),
    );

    await act(() => harness.hook().add(ROOT_A, [{ kind: "path", path: "/Users/dev/clip.mp4" }]));

    expect(harness.hook().drafts[0]).toMatchObject({
      kind: "reference",
      state: "ready",
      name: "clip.mp4",
      path: "/Users/dev/clip.mp4",
      notice: null,
    });
    expect(harness.gateway.stageAgentAttachmentFromPath).not.toHaveBeenCalled();
    expect(harness.hook().promptLineBytes).toBe(53);
    harness.unmount();
  });

  it("falls back to a reference when a path-backed image cannot be decoded", async () => {
    const harness = renderAttachments(
      environment({
        decodable: false,
        extensionMime: "image/png",
        candidateBytes: MAX_AGENT_IMAGE_BYTES + 1,
      }),
    );

    await act(() => harness.hook().add(ROOT_A, [{ kind: "path", path: "/Users/dev/photo.heic" }]));

    expect(harness.hook().drafts[0]).toMatchObject({
      kind: "reference",
      state: "ready",
      notice: AGENT_ATTACHMENT_OVERSIZED_IMAGE_NOTICE,
      path: "/Users/dev/photo.heic",
    });
    harness.unmount();
  });

  it("fails the draft when the image cannot be shrunk under the wire cap", async () => {
    const harness = renderAttachments(environment({ encodedBytes: MAX_AGENT_IMAGE_BYTES + 1 }));

    await act(() =>
      harness.hook().add(ROOT_A, [
        {
          kind: "bytes",
          name: "shot.png",
          mime: "image/png",
          bytes: new ArrayBuffer(MAX_AGENT_IMAGE_BYTES + 1),
        },
      ]),
    );

    expect(harness.hook().drafts[0]).toMatchObject({
      state: "failed",
      failure: AGENT_ATTACHMENT_IMAGE_BYTES_REFUSAL,
    });
    expect(harness.hook().blocked).toBe(true);
    harness.unmount();
  });

  it("keeps Send blocked with a definite reason when staging fails", async () => {
    const harness = renderAttachments(
      environment({ stageError: new Error("No space left on device") }),
    );

    await act(() =>
      harness
        .hook()
        .add(ROOT_A, [
          { kind: "bytes", name: "notes.txt", mime: "text/plain", bytes: new ArrayBuffer(8) },
        ]),
    );

    expect(harness.hook().drafts[0]).toMatchObject({
      state: "failed",
      failure: `${AGENT_ATTACHMENT_STAGE_FAILURE_PREFIX}No space left on device`,
    });
    expect(harness.hook().blocked).toBe(true);
    expect(harness.errors).toHaveLength(1);
    harness.unmount();
  });

  it("refuses a non-regular drop target with a definite message", async () => {
    const harness = renderAttachments(environment({ isRegularFile: false }));

    await act(() => harness.hook().add(ROOT_A, [{ kind: "path", path: "/Users/dev" }]));

    expect(harness.hook().drafts[0]).toMatchObject({
      state: "failed",
      failure: AGENT_ATTACHMENT_PATH_REFUSAL,
    });
    harness.unmount();
  });

  it("refuses the ninth attachment without touching the gateway again", async () => {
    const harness = renderAttachments(environment({ extensionMime: null }));
    const sources = Array.from({ length: 9 }, (_unused, index) => ({
      kind: "path" as const,
      path: `/Users/dev/clip-${index}.mp4`,
    }));

    await act(() => harness.hook().add(ROOT_A, sources));

    expect(harness.hook().drafts).toHaveLength(8);
    expect(harness.hook().refusal).toBe(AGENT_ATTACHMENT_COUNT_REFUSAL);
    harness.unmount();
  });
});

describe("useAgentComposerAttachments ownership", () => {
  it("releases a draft staged for a workspace that was replaced mid-flight", async () => {
    const env: Environment = environment();
    env.onStage = () => env.owners.set(ROOT_A, ownerA(2));
    const harness = renderAttachments(env);

    await act(() => harness.hook().add(ROOT_A, [{ kind: "path", path: "/Users/dev/shot.png" }]));

    expect(harness.hook().drafts).toHaveLength(0);
    expect(harness.released).toEqual([IMAGE_ID]);
    harness.unmount();
  });

  it("never hands a stale draft to another workspace generation after A to B to A", async () => {
    const env = environment({ owners: new Map([[ROOT_A, ownerA(1)]]) });
    const harness = renderAttachments(env);

    await act(() => harness.hook().add(ROOT_A, [{ kind: "path", path: "/Users/dev/shot.png" }]));
    expect(harness.hook().drafts[0]?.state).toBe("ready");

    env.owners.set(ROOT_B, ownerB());
    await act(() => harness.hook().add(ROOT_B, [{ kind: "path", path: "/Users/dev/other.png" }]));
    expect(harness.hook().projectRootKey).toBe(ROOT_B);
    expect(harness.released).toEqual([IMAGE_ID]);

    env.owners.set(ROOT_A, ownerA(2));
    expect(await act(() => harness.hook().prepareTurn(ROOT_A))).toBeNull();

    const prepared = await act(() => harness.hook().prepareTurn(ROOT_B));
    expect(prepared?.owner).toEqual(ownerB());
    expect(prepared?.intents).toEqual([
      {
        kind: "staged",
        attachmentId: IMAGE_ID,
        name: "other.png",
        bytes: 4_096,
        mime: "image/png",
        width: 100,
        height: 50,
      },
    ]);
    harness.unmount();
  });

  it("marks a reference missing at send time without blocking the turn", async () => {
    const env = environment({ extensionMime: null });
    const harness = renderAttachments(env);

    await act(() => harness.hook().add(ROOT_A, [{ kind: "path", path: "/Users/dev/clip.mp4" }]));
    env.isRegularFile = false;

    const prepared = await act(() => harness.hook().prepareTurn(ROOT_A));

    expect(prepared?.intents).toEqual([
      { kind: "reference", name: "clip.mp4", path: "/Users/dev/clip.mp4", bytes: 4_096 },
    ]);
    expect(harness.hook().drafts[0]).toMatchObject({
      missing: true,
      notice: AGENT_ATTACHMENT_MISSING_SOURCE_NOTICE,
    });
    harness.unmount();
  });

  it("releases staged bytes on remove and on clear", async () => {
    const harness = renderAttachments(environment());

    await act(() => harness.hook().add(ROOT_A, [{ kind: "path", path: "/Users/dev/shot.png" }]));
    const draftId = harness.hook().drafts[0]?.draftId ?? "";
    await act(async () => harness.hook().remove(draftId));
    expect(harness.hook().drafts).toHaveLength(0);
    expect(harness.released).toEqual([IMAGE_ID]);

    await act(() => harness.hook().add(ROOT_A, [{ kind: "path", path: "/Users/dev/shot.png" }]));
    await act(async () => harness.hook().clear());
    expect(harness.hook().drafts).toHaveLength(0);
    expect(harness.hook().projectRootKey).toBeNull();
    expect(harness.released).toEqual([IMAGE_ID, IMAGE_ID]);
    harness.unmount();
  });

  it("clears a sent draft without releasing files the turn already claimed", async () => {
    const harness = renderAttachments(environment());

    await act(() => harness.hook().add(ROOT_A, [{ kind: "path", path: "/Users/dev/shot.png" }]));
    await act(async () => harness.hook().markSent());

    expect(harness.hook().drafts).toHaveLength(0);
    expect(harness.hook().projectRootKey).toBeNull();
    expect(harness.released).toEqual([]);
    harness.unmount();
  });

  it("claims a paste with an image and passes a text paste through", () => {
    const harness = renderAttachments(environment());
    const image = { name: "shot.png", mime: "image/png", hasPath: false, bytes: 10 };
    const text = { name: "a.txt", mime: "text/plain", hasPath: false, bytes: 10 };

    expect(harness.hook().claimPaste([image, text], 5)).toBe("claim");
    expect(harness.hook().claimPaste([text], 5)).toBe("pass-through");
    expect(harness.hook().claimPaste([text], 0)).toBe("claim");
    harness.unmount();
  });
});
