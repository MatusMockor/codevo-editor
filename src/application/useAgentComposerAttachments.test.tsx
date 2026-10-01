// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { AGENT_IMAGE_MAX_MODEL_BYTES, MAX_AGENT_IMAGE_BYTES } from "../domain/agentAttachment";
import {
  AGENT_ATTACHMENT_COUNT_REFUSAL,
  AGENT_ATTACHMENT_IMAGE_BYTES_REFUSAL,
  AGENT_ATTACHMENT_IMAGE_DIMENSIONS_REFUSAL,
  AGENT_ATTACHMENT_OVERSIZED_IMAGE_NOTICE,
  AGENT_ATTACHMENT_PATH_REFUSAL,
  AGENT_ATTACHMENT_UNDECODABLE_IMAGE_NOTICE,
} from "../domain/agentAttachmentIntake";
import type { AgentImageSurfacePort } from "../domain/agentImageShrink";
import type { AgentAttachmentGateway } from "./agentAttachmentPorts";
import { AGENT_ATTACHMENTS_DISCARDED_NOTICE } from "./agentTurnAttachments";
import {
  AGENT_ATTACHMENT_MISSING_SOURCE_NOTICE,
  AGENT_ATTACHMENT_STAGE_FAILURE_PREFIX,
  AGENT_ATTACHMENT_UNREADABLE_REFUSAL,
  agentAttachmentDuplicateRefusal,
  useAgentComposerAttachments,
  type AgentAttachmentOwner,
  type AgentComposerAttachmentDraft,
  type AgentComposerAttachmentsSurface,
} from "./useAgentComposerAttachments";

const ROOT_A = "/workspace/app";
const ROOT_B = "/workspace/other";
const IMAGE_ID = "0123456789abcdef0123456789abcdef";

interface PreviewBlob {
  readonly url: string;
  readonly bytes: number;
  readonly mime: string;
}

interface Environment {
  owners: Map<string, AgentAttachmentOwner>;
  isRegularFile: boolean;
  candidateBytes: number;
  extensionMime: string | null;
  stageError: Error | null;
  decodable: boolean;
  encodedBytes: number;
  imageWidth: number;
  imageHeight: number;
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
      return { width: environment.imageWidth, height: environment.imageHeight };
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
        width: width ?? environment.imageWidth,
        height: height ?? environment.imageHeight,
        promptLineBytesMax: 120,
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
  const issued: PreviewBlob[] = [];
  const revoked: string[] = [];
  let surface: AgentComposerAttachmentsSurface | null = null;

  function Probe() {
    surface = useAgentComposerAttachments({
      gateway,
      imageSurface: imageSurface(environment),
      resolveOwner: (projectRootKey) => environment.owners.get(projectRootKey) ?? null,
      reportError: (_source, error) => errors.push(error),
      createDraftId: () => `draft-${(draftSequence += 1)}`,
      createObjectUrl: (blob) => {
        const url = `blob:preview-${issued.length + 1}`;
        issued.push({ url, bytes: blob.size, mime: blob.type });
        return url;
      },
      revokeObjectUrl: (url) => revoked.push(url),
    });
    return null;
  }

  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(createElement(Probe)));

  return {
    errors,
    gateway,
    issued,
    released,
    revoked,
    hook: (): AgentComposerAttachmentsSurface => {
      if (surface === null) throw new Error("The attachment surface is not mounted.");
      return surface;
    },
    rerender: () => act(() => root.render(createElement(Probe))),
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
    imageWidth: 4_096,
    imageHeight: 2_048,
    onStage: null,
    ...overrides,
  };
}

describe("useAgentComposerAttachments staging", () => {
  it("refuses captured intake after the same project owner generation is replaced", async () => {
    const env = environment();
    const harness = renderAttachments(env);
    const intake = harness.hook().captureIntake?.(ROOT_A);
    expect(intake).toBeTypeOf("function");
    env.owners.set(ROOT_A, ownerA(2));
    await act(async () =>
      intake?.([
        { kind: "bytes", name: "image.png", mime: "image/png", bytes: new ArrayBuffer(12) },
      ]),
    );
    expect(harness.gateway.stageAgentAttachmentBytes).not.toHaveBeenCalled();
    expect(harness.hook().drafts).toEqual([]);
    harness.unmount();
  });

  it("releases a staged image when its picker is cancelled during staging", async () => {
    let current = true;
    const env = environment({
      onStage: () => {
        current = false;
      },
    });
    const harness = renderAttachments(env);
    const intake = harness.hook().captureIntake?.(ROOT_A, () => current);
    await act(async () =>
      intake?.([
        { kind: "bytes", name: "image.png", mime: "image/png", bytes: new ArrayBuffer(12) },
      ]),
    );
    expect(harness.gateway.stageAgentAttachmentBytes).toHaveBeenCalledOnce();
    expect(harness.released).toContain(IMAGE_ID);
    expect(harness.hook().drafts).toEqual([]);
    harness.unmount();
  });

  it("does not report a stale staging failure into the replacement composer", async () => {
    let current = true;
    const env = environment({
      onStage: () => {
        current = false;
      },
      stageError: new Error("old stage failed"),
    });
    const harness = renderAttachments(env);
    const intake = harness.hook().captureIntake?.(ROOT_A, () => current);
    await act(async () =>
      intake?.([
        { kind: "bytes", name: "image.png", mime: "image/png", bytes: new ArrayBuffer(12) },
      ]),
    );
    expect(harness.errors).toEqual([]);
    expect(harness.hook().refusal).toBeNull();
    expect(harness.hook().drafts).toEqual([]);
    harness.unmount();
  });

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
      name: "shot.png",
      mime: "image/png",
      attachmentId: IMAGE_ID,
      bytes: 512,
    });
    expect(harness.hook().blocked).toBe(false);
    expect(harness.hook().staging).toBe(false);
    harness.unmount();
  });

  it("stages a dropped retina screenshot downscaled to the model edge", async () => {
    const harness = renderAttachments(environment({ imageWidth: 2_742, imageHeight: 1_416 }));

    await act(() => harness.hook().add(ROOT_A, [{ kind: "path", path: "/Users/dev/shot.png" }]));

    expect(harness.gateway.stageAgentAttachmentBytes).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-a",
        kind: "image",
        name: "shot.png",
        mime: "image/png",
        width: 1_568,
        height: 810,
      }),
    );
    expect(harness.hook().drafts[0]).toMatchObject({
      kind: "image",
      state: "ready",
      path: "/Users/dev/shot.png",
      previewUrl: "blob:preview-1",
    });
    expect(harness.issued).toEqual([{ url: "blob:preview-1", bytes: 512, mime: "image/png" }]);
    harness.unmount();
  });

  it("stages a small dropped image with its original bytes", async () => {
    const harness = renderAttachments(environment({ imageWidth: 800, imageHeight: 400 }));

    await act(() => harness.hook().add(ROOT_A, [{ kind: "path", path: "/Users/dev/shot.png" }]));

    expect(harness.gateway.stageAgentAttachmentBytes).toHaveBeenCalledWith(
      expect.objectContaining({ name: "shot.png", mime: "image/png", width: null, height: null }),
    );
    const staged = vi.mocked(harness.gateway.stageAgentAttachmentBytes).mock.calls[0]?.[0];
    expect(staged?.bytes.byteLength).toBe(4_096);
    expect(harness.issued).toEqual([{ url: "blob:preview-1", bytes: 4_096, mime: "image/png" }]);
    harness.unmount();
  });

  it("refuses a dropped image whose bytes cannot be read", async () => {
    const harness = renderAttachments(environment());
    harness.gateway.readAgentAttachmentCandidate = vi.fn(async () => {
      throw new Error("moved");
    });

    await act(() => harness.hook().add(ROOT_A, [{ kind: "path", path: "/Users/dev/shot.png" }]));

    expect(harness.hook().drafts[0]).toMatchObject({
      state: "failed",
      failure: AGENT_ATTACHMENT_UNREADABLE_REFUSAL,
      previewUrl: null,
    });
    expect(harness.gateway.stageAgentAttachmentBytes).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("refuses a path that is already attached without inspecting it again", async () => {
    const harness = renderAttachments(environment({ extensionMime: null }));

    await act(() => harness.hook().add(ROOT_A, [{ kind: "path", path: "/Users/dev/clip.mp4" }]));
    await act(() => harness.hook().add(ROOT_A, [{ kind: "path", path: "/Users/dev/clip.mp4" }]));

    expect(harness.hook().drafts).toHaveLength(1);
    expect(harness.hook().refusal).toBe(agentAttachmentDuplicateRefusal("clip.mp4"));
    expect(harness.gateway.inspectAgentAttachmentCandidate).toHaveBeenCalledTimes(1);
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
      notice: AGENT_ATTACHMENT_UNDECODABLE_IMAGE_NOTICE,
      path: "/Users/dev/photo.heic",
    });
    harness.unmount();
  });

  it("inserts a dropped image above the supported dimensions as a path", async () => {
    const harness = renderAttachments(environment({ imageWidth: 20_000, imageHeight: 100 }));

    await act(() => harness.hook().add(ROOT_A, [{ kind: "path", path: "/Users/dev/poster.png" }]));

    expect(harness.hook().drafts[0]).toMatchObject({
      kind: "reference",
      state: "ready",
      notice: AGENT_ATTACHMENT_OVERSIZED_IMAGE_NOTICE,
      path: "/Users/dev/poster.png",
    });
    expect(harness.gateway.stageAgentAttachmentBytes).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("refuses a pasted image above the supported dimensions", async () => {
    const harness = renderAttachments(environment({ imageWidth: 20_000, imageHeight: 100 }));

    await act(() =>
      harness
        .hook()
        .add(ROOT_A, [
          { kind: "bytes", name: "poster.png", mime: "image/png", bytes: new ArrayBuffer(64) },
        ]),
    );

    expect(harness.hook().drafts[0]).toMatchObject({
      state: "failed",
      failure: AGENT_ATTACHMENT_IMAGE_DIMENSIONS_REFUSAL,
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
    expect(harness.gateway.inspectAgentAttachmentCandidate).toHaveBeenCalledTimes(8);
    harness.unmount();
  });

  it("refuses a hundred-file drop after the cap without inspecting the rest", async () => {
    const harness = renderAttachments(environment({ extensionMime: null }));
    const sources = Array.from({ length: 100 }, (_unused, index) => ({
      kind: "path" as const,
      path: `/Users/dev/clip-${index}.mp4`,
    }));

    await act(() => harness.hook().add(ROOT_A, sources));

    expect(harness.hook().drafts).toHaveLength(8);
    expect(harness.hook().refusal).toBe(AGENT_ATTACHMENT_COUNT_REFUSAL);
    expect(harness.gateway.inspectAgentAttachmentCandidate).toHaveBeenCalledTimes(8);
    harness.unmount();
  });
});

describe("useAgentComposerAttachments conversation drafts", () => {
  it("isolates thread A and B in one project and restores both on return", async () => {
    const harness = renderAttachments(environment());
    const scope = (key: string) => harness.hook().forDraft!(key);
    await act(() => scope("thread-a").add(ROOT_A, [{ kind: "path", path: "/Users/dev/a.png" }]));
    const original = scope("thread-a").drafts[0];
    expect(scope("thread-b").drafts).toEqual([]);
    expect(scope("thread-b").promptLineBytes).toBe(0);
    await act(() => scope("thread-b").add(ROOT_A, [{ kind: "path", path: "/Users/dev/b.png" }]));
    expect(scope("thread-a").drafts).toEqual([original]);
    expect(scope("thread-b").drafts.map((draft) => draft.name)).toEqual(["b.png"]);
    expect(harness.released).toEqual([]);
    harness.unmount();
  });

  it("keeps new-conversation drafts separate and clears only the captured sent conversation", async () => {
    const harness = renderAttachments(environment());
    const scope = (key: string) => harness.hook().forDraft!(key);
    await act(() => scope("thread-a").add(ROOT_A, [{ kind: "path", path: "/Users/dev/a.png" }]));
    const submitted = scope("thread-a");
    const prepared = await act(() => submitted.prepareTurn(ROOT_A));
    await act(() =>
      scope("new:project").add(ROOT_A, [{ kind: "path", path: "/Users/dev/new.png" }]),
    );
    act(() => submitted.markSent(prepared!.draftIds));
    expect(scope("thread-a").drafts).toEqual([]);
    expect(scope("new:project").drafts.map((draft) => draft.name)).toEqual(["new.png"]);
    harness.unmount();
  });

  it("preserves capture callbacks across unrelated publications and rejects an A B A intake lease", async () => {
    const harness = renderAttachments(environment());
    const scope = (key: string) => harness.hook().forDraft!(key);
    const capture = scope("thread-a").captureIntake;
    let generation = 1;
    const intake = capture!(ROOT_A, () => generation === 1)!;
    act(() => scope("thread-b").refuse("Only B"));
    expect(scope("thread-a").captureIntake).toBe(capture);
    expect(scope("thread-a").refusal).toBeNull();
    generation = 3;
    await act(() => intake([{ kind: "path", path: "/Users/dev/late.png" }]));
    expect(scope("thread-a").drafts).toEqual([]);
    expect(scope("thread-b").drafts).toEqual([]);
    harness.unmount();
  });

  it("retains scoped drafts for distinct projects and rejects replaced workspace authority", async () => {
    const env = environment({
      owners: new Map([
        [ROOT_A, ownerA()],
        [ROOT_B, ownerB()],
      ]),
    });
    const harness = renderAttachments(env);
    const scope = (key: string) => harness.hook().forDraft!(key);
    await act(() => scope("a").add(ROOT_A, [{ kind: "path", path: "/Users/dev/a.png" }]));
    await act(() => scope("b").add(ROOT_B, [{ kind: "path", path: "/Users/dev/b.png" }]));
    env.owners.set(ROOT_A, ownerA(2));
    expect(await act(() => scope("a").prepareTurn(ROOT_A))).toBeNull();
    expect(scope("a").drafts).toEqual([]);
    expect(scope("b").drafts.map((draft) => draft.name)).toEqual(["b.png"]);
    harness.unmount();
  });

  it("invalidates pending intake when all drafts are cleared", async () => {
    const harness = renderAttachments(environment());
    let complete:
      | ((value: { bytes: number; isRegularFile: boolean; extensionMime: string }) => void)
      | undefined;
    harness.gateway.inspectAgentAttachmentCandidate = vi.fn(
      () =>
        new Promise<{ bytes: number; isRegularFile: boolean; extensionMime: string }>((resolve) => {
          complete = resolve;
        }),
    );
    let pending: Promise<void>;
    act(() => {
      pending = harness.hook().forDraft!("a").add(ROOT_A, [
        { kind: "path", path: "/Users/dev/late.png" },
      ]);
    });
    act(() => harness.hook().clearAll!());
    await act(async () => {
      complete!({ bytes: 100, isRegularFile: true, extensionMime: "image/png" });
      await pending;
    });
    expect(harness.hook().forDraft!("a").drafts).toEqual([]);
    harness.unmount();
  });

  it("rejects pending empty-scope intake across owner A B A replacement", async () => {
    const env = environment();
    const harness = renderAttachments(env);
    let complete:
      | ((value: { bytes: number; isRegularFile: boolean; extensionMime: string }) => void)
      | undefined;
    harness.gateway.inspectAgentAttachmentCandidate = vi.fn(
      () =>
        new Promise<{ bytes: number; isRegularFile: boolean; extensionMime: string }>((resolve) => {
          complete = resolve;
        }),
    );
    let pending: Promise<void>;
    act(() => {
      pending = harness.hook().forDraft!("pending").add(ROOT_A, [
        { kind: "path", path: "/Users/dev/late.png" },
      ]);
    });
    env.owners.set(ROOT_A, ownerA(2));
    harness.rerender();
    env.owners.set(ROOT_A, ownerA(1));
    harness.rerender();
    await act(async () => {
      complete!({ bytes: 100, isRegularFile: true, extensionMime: "image/png" });
      await pending;
    });
    expect(harness.hook().forDraft!("pending").drafts).toEqual([]);
    harness.unmount();
  });

  it("bounds retained image bytes across conversations without deleting earlier images", async () => {
    const harness = renderAttachments(environment());
    harness.gateway.stageAgentAttachmentBytes = vi.fn(async ({ name, mime, width, height }) => ({
      attachmentId: IMAGE_ID,
      name,
      mime,
      bytes: AGENT_IMAGE_MAX_MODEL_BYTES,
      width,
      height,
      promptLineBytesMax: 100,
    }));
    for (let index = 0; index < 12; index++) {
      await act(() =>
        harness.hook().forDraft!(`bytes-${index}`).add(ROOT_A, [
          { kind: "path", path: `/Users/dev/${index}.png` },
        ]),
      );
    }
    expect(harness.hook().forDraft!("bytes-0").drafts).toHaveLength(1);
    expect(harness.hook().forDraft!("bytes-10").drafts).toHaveLength(1);
    expect(harness.hook().forDraft!("bytes-11").drafts).toEqual([]);
    expect(harness.hook().forDraft!("bytes-11").refusal).toContain("storage is full");
    expect(harness.released).toEqual([IMAGE_ID]);
    harness.unmount();
  });

  it("refuses capacity without evicting retained drafts", async () => {
    const harness = renderAttachments(environment({ extensionMime: null }));
    for (let index = 0; index < 32; index++) {
      await act(() =>
        harness.hook().forDraft!(`thread-${index}`).add(ROOT_A, [
          { kind: "path", path: `/Users/dev/${index}.txt` },
        ]),
      );
    }
    const full = harness.hook().forDraft!("overflow");
    await act(() => full.add(ROOT_A, [{ kind: "path", path: "/Users/dev/overflow.txt" }]));
    expect(harness.hook().forDraft!("overflow").refusal).toContain("storage is full");
    expect(harness.hook().forDraft!("thread-0").drafts[0]?.name).toBe("0.txt");
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
        bytes: 512,
        mime: "image/png",
        width: 1_568,
        height: 784,
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
    const draftId = harness.hook().drafts[0]?.draftId ?? "";
    await act(async () => harness.hook().markSent([draftId]));

    expect(harness.hook().drafts).toHaveLength(0);
    expect(harness.hook().projectRootKey).toBeNull();
    expect(harness.released).toEqual([]);
    harness.unmount();
  });

  it("holds sent drafts out of the composer and returns them intact when the send fails", async () => {
    const harness = renderAttachments(environment());
    await act(() => harness.hook().add(ROOT_A, [{ kind: "path", path: "/Users/dev/shot.png" }]));
    const prepared = await act(() => harness.hook().prepareTurn(ROOT_A));
    const draftIds = prepared?.draftIds ?? [];
    let held: ReadonlyArray<AgentComposerAttachmentDraft> = [];
    act(() => {
      held = harness.hook().holdForSend?.(draftIds) ?? [];
    });

    expect(held.map((draft) => [draft.name, draft.previewUrl])).toEqual([
      ["shot.png", "blob:preview-1"],
    ]);
    expect(harness.hook().drafts).toEqual([]);
    expect(harness.hook().blocked).toBe(false);
    expect(harness.hook().promptLineBytes).toBe(0);
    const again = await act(() => harness.hook().prepareTurn(ROOT_A));
    expect(again?.draftIds).toEqual([]);
    expect(harness.revoked).toEqual([]);
    expect(harness.released).toEqual([]);

    act(() => harness.hook().returnToComposer?.(draftIds));
    expect(harness.hook().drafts.map((draft) => [draft.name, draft.previewUrl])).toEqual([
      ["shot.png", "blob:preview-1"],
    ]);
    expect(harness.hook().projectRootKey).toBe(ROOT_A);
    harness.unmount();
  });

  it("settles held drafts once the send succeeds without releasing the claimed files", async () => {
    const harness = renderAttachments(environment());
    await act(() => harness.hook().add(ROOT_A, [{ kind: "path", path: "/Users/dev/shot.png" }]));
    const prepared = await act(() => harness.hook().prepareTurn(ROOT_A));
    const draftIds = prepared?.draftIds ?? [];
    act(() => {
      harness.hook().holdForSend?.(draftIds);
    });
    await act(() => harness.hook().add(ROOT_A, [{ kind: "path", path: "/Users/dev/next.png" }]));
    expect(harness.hook().drafts.map((draft) => draft.name)).toEqual(["next.png"]);

    act(() => harness.hook().markSent(draftIds));
    act(() => harness.hook().returnToComposer?.(draftIds));
    expect(harness.hook().drafts.map((draft) => draft.name)).toEqual(["next.png"]);
    expect(harness.revoked).toEqual(["blob:preview-1"]);
    expect(harness.released).toEqual([]);
    harness.unmount();
  });

  it("releases held drafts when the composer is cleared while the send is in flight", async () => {
    const harness = renderAttachments(environment());
    await act(() => harness.hook().add(ROOT_A, [{ kind: "path", path: "/Users/dev/shot.png" }]));
    const prepared = await act(() => harness.hook().prepareTurn(ROOT_A));
    const draftIds = prepared?.draftIds ?? [];
    act(() => {
      harness.hook().holdForSend?.(draftIds);
    });
    await act(async () => harness.hook().clear());
    act(() => harness.hook().returnToComposer?.(draftIds));
    expect(harness.hook().drafts).toEqual([]);
    expect(harness.revoked).toEqual(["blob:preview-1"]);
    expect(harness.released).toEqual([IMAGE_ID]);
    harness.unmount();
  });

  it("marks only the drafts that were part of the request as sent", async () => {
    const harness = renderAttachments(environment({ extensionMime: null }));

    await act(() =>
      harness.hook().add(ROOT_A, [
        { kind: "path", path: "/Users/dev/a.mp4" },
        { kind: "path", path: "/Users/dev/b.mp4" },
      ]),
    );
    const prepared = await act(() => harness.hook().prepareTurn(ROOT_A));
    expect(prepared?.draftIds).toHaveLength(2);
    await act(() => harness.hook().add(ROOT_A, [{ kind: "path", path: "/Users/dev/c.mp4" }]));

    await act(async () => harness.hook().markSent(prepared?.draftIds ?? []));

    expect(harness.hook().drafts.map((draft) => draft.name)).toEqual(["c.mp4"]);
    expect(harness.hook().projectRootKey).toBe(ROOT_A);
    harness.unmount();
  });

  it("discards drafts whose owner generation changed before send and says so", async () => {
    const env = environment();
    const harness = renderAttachments(env);

    await act(() => harness.hook().add(ROOT_A, [{ kind: "path", path: "/Users/dev/shot.png" }]));
    expect(harness.hook().drafts[0]?.state).toBe("ready");

    env.owners.set(ROOT_A, ownerA(2));
    expect(await act(() => harness.hook().prepareTurn(ROOT_A))).toBeNull();

    expect(harness.hook().drafts).toHaveLength(0);
    expect(harness.released).toEqual([IMAGE_ID]);
    expect(harness.hook().refusal).toBe(AGENT_ATTACHMENTS_DISCARDED_NOTICE);
    harness.unmount();
  });

  it("discards drafts when the workspace is replaced while a reference is inspected", async () => {
    const env = environment({ extensionMime: null });
    const harness = renderAttachments(env);

    await act(() => harness.hook().add(ROOT_A, [{ kind: "path", path: "/Users/dev/clip.mp4" }]));
    harness.gateway.inspectAgentAttachmentCandidate = vi.fn(async () => {
      env.owners.set(ROOT_A, ownerA(2));
      return { bytes: 4_096, isRegularFile: true, extensionMime: null };
    });

    expect(await act(() => harness.hook().prepareTurn(ROOT_A))).toBeNull();

    expect(harness.hook().drafts).toHaveLength(0);
    expect(harness.hook().refusal).toBe(AGENT_ATTACHMENTS_DISCARDED_NOTICE);
    harness.unmount();
  });

  it("surfaces a refusal handed in by the composer", () => {
    const harness = renderAttachments(environment());

    act(() => harness.hook().refuse("The file picker could not be opened."));
    expect(harness.hook().refusal).toBe("The file picker could not be opened.");

    act(() => harness.hook().dismissRefusal());
    expect(harness.hook().refusal).toBeNull();
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

describe("useAgentComposerAttachments previews", () => {
  const PASTED_IMAGE = {
    kind: "bytes" as const,
    name: "shot.png",
    mime: "image/png",
    bytes: new ArrayBuffer(MAX_AGENT_IMAGE_BYTES + 1),
  };

  it("previews a staged image from the bytes the shrink pipeline produced", async () => {
    const harness = renderAttachments(environment());

    await act(() => harness.hook().add(ROOT_A, [PASTED_IMAGE]));

    expect(harness.issued).toEqual([{ url: "blob:preview-1", bytes: 512, mime: "image/png" }]);
    expect(harness.hook().drafts[0]).toMatchObject({
      kind: "image",
      state: "ready",
      previewUrl: "blob:preview-1",
    });
    harness.unmount();
  });

  it("leaves a staged file and a reference draft without a preview", async () => {
    const harness = renderAttachments(environment({ extensionMime: null }));

    await act(() =>
      harness.hook().add(ROOT_A, [
        { kind: "bytes", name: "notes.txt", mime: "text/plain", bytes: new ArrayBuffer(8) },
        { kind: "path", path: "/Users/dev/clip.mp4" },
      ]),
    );

    expect(harness.hook().drafts.map((entry) => entry.previewUrl)).toEqual([null, null]);
    expect(harness.issued).toEqual([]);
    harness.unmount();
  });

  it("revokes the preview exactly once when the draft is removed", async () => {
    const harness = renderAttachments(environment());

    await act(() => harness.hook().add(ROOT_A, [PASTED_IMAGE]));
    const draftId = harness.hook().drafts[0]?.draftId ?? "";
    await act(async () => harness.hook().remove(draftId));

    expect(harness.revoked).toEqual(["blob:preview-1"]);
    harness.unmount();
    expect(harness.revoked).toEqual(["blob:preview-1"]);
  });

  it("revokes the preview exactly once when the composer is cleared", async () => {
    const harness = renderAttachments(environment());

    await act(() => harness.hook().add(ROOT_A, [PASTED_IMAGE]));
    await act(async () => harness.hook().clear());

    expect(harness.revoked).toEqual(["blob:preview-1"]);
    harness.unmount();
    expect(harness.revoked).toEqual(["blob:preview-1"]);
  });

  it("revokes the preview exactly once when the turn is sent", async () => {
    const harness = renderAttachments(environment());

    await act(() => harness.hook().add(ROOT_A, [PASTED_IMAGE]));
    const draftId = harness.hook().drafts[0]?.draftId ?? "";
    await act(async () => harness.hook().markSent([draftId]));

    expect(harness.released).toEqual([]);
    expect(harness.revoked).toEqual(["blob:preview-1"]);
    harness.unmount();
    expect(harness.revoked).toEqual(["blob:preview-1"]);
  });

  it("revokes the preview exactly once when a stale owner discards the draft", async () => {
    const env = environment();
    env.onStage = () => env.owners.set(ROOT_A, ownerA(2));
    const harness = renderAttachments(env);

    await act(() => harness.hook().add(ROOT_A, [PASTED_IMAGE]));

    expect(harness.hook().drafts).toHaveLength(0);
    expect(harness.released).toEqual([IMAGE_ID]);
    expect(harness.revoked).toEqual(["blob:preview-1"]);
    harness.unmount();
    expect(harness.revoked).toEqual(["blob:preview-1"]);
  });

  it("revokes every outstanding preview when the composer unmounts", async () => {
    const harness = renderAttachments(environment());

    await act(() => harness.hook().add(ROOT_A, [PASTED_IMAGE, PASTED_IMAGE]));
    expect(harness.revoked).toEqual([]);

    harness.unmount();

    expect(harness.revoked).toEqual(["blob:preview-1", "blob:preview-2"]);
  });
});
