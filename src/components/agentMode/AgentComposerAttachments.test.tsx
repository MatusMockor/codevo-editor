// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentAttachmentSource,
  AgentComposerAttachmentDraft,
  AgentComposerAttachmentsSurface,
} from "../../application/useAgentComposerAttachments";
import { MAX_AGENT_FILE_BYTES } from "../../domain/agentAttachment";
import {
  AGENT_ATTACHMENT_COUNT_REFUSAL,
  AGENT_ATTACHMENT_IMAGE_SOURCE_BYTES_REFUSAL,
} from "../../domain/agentAttachmentIntake";
import { AgentComposer, type AgentComposerProps, type AgentComposerTarget } from "./AgentComposer";
import {
  AGENT_ATTACHMENT_DROP_UNAVAILABLE,
  AGENT_ATTACHMENT_PASTE_READ_FAILURE,
  AGENT_ATTACHMENT_PICKER_FAILURE,
  type AgentComposerDragDropListener,
  type AgentComposerDragDropSubscribe,
} from "./agentComposerAttachmentPorts";

const ABSOLUTE_VIDEO = "/workspace/app/clip.mp4";
const PREVIEW_URL = "blob:preview-1";

describe("AgentComposer attachments", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("claims a pasted image and stages it as bytes", async () => {
    const add = vi.fn<AgentComposerAttachmentsSurface["add"]>(async () => undefined);
    const claimPaste = vi.fn(() => "claim" as const);
    render({ attachments: surface({ add, claimPaste }) });

    const event = pasteEvent([file("shot.png", "image/png", 12)], "");
    await act(async () => {
      textarea().dispatchEvent(event);
    });

    expect(claimPaste).toHaveBeenCalledWith(
      [{ name: "shot.png", mime: "image/png", hasPath: false, bytes: 12 }],
      0,
    );
    expect(event.defaultPrevented).toBe(true);
    expect(add).toHaveBeenCalledTimes(1);
    const sources: ReadonlyArray<AgentAttachmentSource> = add.mock.calls[0]?.[1] ?? [];
    expect(sources[0]?.kind).toBe("bytes");
    expect(sources[0]).toMatchObject({ name: "shot.png", mime: "image/png" });
  });

  it("does not claim a paste while a turn is dispatching", async () => {
    const add = vi.fn<AgentComposerAttachmentsSurface["add"]>(async () => undefined);
    const claimPaste = vi.fn(() => "claim" as const);
    render({ attachments: surface({ add, claimPaste }), dispatching: true });

    const event = pasteEvent([file("shot.png", "image/png", 12)], "");
    await act(async () => {
      textarea().dispatchEvent(event);
    });

    expect(claimPaste).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(add).not.toHaveBeenCalled();
  });

  it("surfaces a refusal when the pasted files cannot be read", async () => {
    const add = vi.fn<AgentComposerAttachmentsSurface["add"]>(async () => undefined);
    const refuse = vi.fn();
    render({ attachments: surface({ add, refuse, claimPaste: () => "claim" }) });
    const broken = file("shot.png", "image/png", 12);
    Object.defineProperty(broken, "arrayBuffer", {
      value: async () => {
        throw new Error("clipboard gone");
      },
    });

    await act(async () => {
      textarea().dispatchEvent(pasteEvent([broken], ""));
    });
    await act(async () => undefined);

    expect(add).not.toHaveBeenCalled();
    expect(refuse).toHaveBeenCalledWith(AGENT_ATTACHMENT_PASTE_READ_FAILURE);
  });

  it("explains oversized clipboard refusal without reading or staging it", async () => {
    const add = vi.fn<AgentComposerAttachmentsSurface["add"]>(async () => undefined);
    const refuse = vi.fn();
    render({ attachments: surface({ add, refuse, claimPaste: () => "claim" }) });
    const oversized = new File([], "large.png", { type: "image/png" });
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    Object.defineProperties(oversized, {
      size: { value: MAX_AGENT_FILE_BYTES + 1 },
      arrayBuffer: { value: arrayBuffer },
    });

    await act(async () => {
      textarea().dispatchEvent(pasteEvent([oversized], ""));
    });

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(refuse).toHaveBeenCalledWith(AGENT_ATTACHMENT_IMAGE_SOURCE_BYTES_REFUSAL);
  });

  it("surfaces a refusal when the picker cannot be opened", async () => {
    const add = vi.fn<AgentComposerAttachmentsSurface["add"]>(async () => undefined);
    const refuse = vi.fn();
    const attachmentPicker = vi.fn(async (): Promise<ReadonlyArray<string>> => {
      throw new Error("dialog unavailable");
    });
    render({ attachments: surface({ add, refuse }), attachmentPicker });

    await act(async () => {
      attachButton().click();
    });
    await act(async () => undefined);

    expect(add).not.toHaveBeenCalled();
    expect(refuse).toHaveBeenCalledWith(AGENT_ATTACHMENT_PICKER_FAILURE);
  });

  it("surfaces a refusal when the drop subscription fails instead of rejecting unhandled", async () => {
    const refuse = vi.fn();
    const subscribe: AgentComposerDragDropSubscribe = async () => {
      throw new Error("no webview");
    };
    render({ attachments: surface({ refuse }), attachmentDragDrop: subscribe });

    await act(async () => undefined);

    expect(refuse).toHaveBeenCalledWith(AGENT_ATTACHMENT_DROP_UNAVAILABLE);
  });

  it("lets a text paste through without attaching the clipboard file", async () => {
    const add = vi.fn<AgentComposerAttachmentsSurface["add"]>(async () => undefined);
    const claimPaste = vi.fn(() => "pass-through" as const);
    render({ attachments: surface({ add, claimPaste }) });

    const event = pasteEvent([file("notes.txt", "text/plain", 4)], "hello");
    await act(async () => {
      textarea().dispatchEvent(event);
    });

    expect(claimPaste).toHaveBeenCalledWith(
      [{ name: "notes.txt", mime: "text/plain", hasPath: false, bytes: 4 }],
      5,
    );
    expect(event.defaultPrevented).toBe(false);
    expect(add).not.toHaveBeenCalled();
  });

  it("adds a dropped path inside the composer and shows the drop state", async () => {
    const add = vi.fn<AgentComposerAttachmentsSurface["add"]>(async () => undefined);
    let listener: AgentComposerDragDropListener = () => undefined;
    const subscribe: AgentComposerDragDropSubscribe = async (next) => {
      listener = next;
      return () => undefined;
    };
    render({ attachments: surface({ add }), attachmentDragDrop: subscribe });
    await act(async () => undefined);
    stubComposerBounds();

    act(() => listener({ kind: "over", x: 50, y: 50, paths: [] }));
    expect(host.querySelector("[data-agent-composer-drop='active']")).not.toBeNull();

    act(() => listener({ kind: "drop", x: 50, y: 50, paths: [ABSOLUTE_VIDEO] }));
    expect(add).toHaveBeenCalledWith("/workspace/app", [{ kind: "path", path: ABSOLUTE_VIDEO }]);
    expect(host.querySelector("[data-agent-composer-drop='active']")).toBeNull();
  });

  it("ignores a drop outside the composer bounds", async () => {
    const add = vi.fn<AgentComposerAttachmentsSurface["add"]>(async () => undefined);
    let listener: AgentComposerDragDropListener = () => undefined;
    const subscribe: AgentComposerDragDropSubscribe = async (next) => {
      listener = next;
      return () => undefined;
    };
    render({ attachments: surface({ add }), attachmentDragDrop: subscribe });
    await act(async () => undefined);
    stubComposerBounds();

    act(() => listener({ kind: "drop", x: 900, y: 900, paths: [ABSOLUTE_VIDEO] }));

    expect(add).not.toHaveBeenCalled();
  });

  it("renders a dropped non-image as a reference chip carrying its absolute path", () => {
    render({
      attachments: surface({
        drafts: [referenceDraft()],
        projectRootKey: "/workspace/app",
      }),
    });

    const chip = host.querySelector<HTMLElement>("[data-agent-attachment-kind='reference']");
    expect(chip).not.toBeNull();
    expect(chip?.title).toBe(ABSOLUTE_VIDEO);
    expect(chip?.querySelector(".agent-composer-attachment__name")?.textContent).toBe("clip.mp4");
  });

  it("adds every picked file through the picker button", async () => {
    const add = vi.fn<AgentComposerAttachmentsSurface["add"]>(async () => undefined);
    const attachmentPicker = vi.fn(async () => ["/workspace/app/a.pdf", "/workspace/app/b.pdf"]);
    render({ attachments: surface({ add }), attachmentPicker });

    await act(async () => {
      attachButton().click();
    });

    expect(attachmentPicker).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith("/workspace/app", [
      { kind: "path", path: "/workspace/app/a.pdf" },
      { kind: "path", path: "/workspace/app/b.pdf" },
    ]);
  });

  it("releases an attachment through its remove control", () => {
    const remove = vi.fn();
    render({ attachments: surface({ drafts: [referenceDraft()], remove }) });

    act(() => {
      const button = host.querySelector<HTMLButtonElement>("button[aria-label='Remove clip.mp4']");
      expect(button).not.toBeNull();
      button?.click();
    });

    expect(remove).toHaveBeenCalledWith("draft-reference");
  });

  it("shows the count refusal from the spec and dismisses it", () => {
    const dismissRefusal = vi.fn();
    render({
      attachments: surface({ refusal: AGENT_ATTACHMENT_COUNT_REFUSAL, dismissRefusal }),
    });

    expect(host.querySelector(".agent-composer__attachment-refusal")?.textContent).toContain(
      AGENT_ATTACHMENT_COUNT_REFUSAL,
    );

    act(() => {
      host
        .querySelector<HTMLButtonElement>("button[aria-label='Dismiss attachment message']")
        ?.click();
    });

    expect(dismissRefusal).toHaveBeenCalledTimes(1);
  });

  it("marks a staging draft busy while Send stays blocked", () => {
    render({
      attachments: surface({ drafts: [stagingDraft()], staging: true, blocked: true }),
      submitBlocked: true,
    });

    const draft = host.querySelector<HTMLElement>("[data-agent-attachment-state='staging']");
    expect(draft?.getAttribute("aria-busy")).toBe("true");
    expect(draft?.querySelector(".agent-composer-attachment__spinner")).not.toBeNull();
    expect(submitButton().disabled).toBe(true);
  });

  it("shows a failure reason inline on a failed draft", () => {
    render({ attachments: surface({ drafts: [failedDraft()], blocked: true }) });

    expect(host.querySelector(".agent-composer-attachment__failure")?.textContent).toBe(
      "Image cannot be shrunk to 10 MiB.",
    );
  });

  it("keeps Send available for a missing reference and shows its notice", () => {
    render({ attachments: surface({ drafts: [missingDraft()] }), submitBlocked: false });

    const draft = host.querySelector<HTMLElement>("[data-agent-attachment-missing='true']");
    expect(draft).not.toBeNull();
    expect(draft?.querySelector(".agent-composer-attachment__notice")?.textContent).toBe(
      "This file is no longer at that path",
    );
    expect(submitButton().disabled).toBe(false);
  });

  it("renders an image draft as a fixed thumbnail tile", () => {
    render({ attachments: surface({ drafts: [imageDraft()] }) });

    const tile = host.querySelector<HTMLElement>(".agent-composer-attachment--image");
    expect(tile).not.toBeNull();
    expect(tile?.querySelector(".agent-composer-attachment__thumb")).not.toBeNull();
    expect(tile?.textContent).toContain("shot.webp");
  });

  it("renders a ready image draft as its own preview instead of a glyph", () => {
    render({ attachments: surface({ drafts: [previewImageDraft()] }) });

    const preview = host.querySelector<HTMLImageElement>(
      ".agent-composer-attachment__thumb img.agent-composer-attachment__preview",
    );
    expect(preview?.getAttribute("src")).toBe(PREVIEW_URL);
    expect(preview?.alt).toBe("shot.webp");
    expect(host.querySelector(".agent-composer-attachment__thumb svg")).toBeNull();
  });

  it("keeps the glyph tile while an image is still staging", () => {
    render({ attachments: surface({ drafts: [stagingPreviewDraft()], staging: true }) });

    expect(host.querySelector(".agent-composer-attachment__preview")).toBeNull();
    expect(host.querySelector(".agent-composer-attachment__spinner")).not.toBeNull();
  });

  it("keeps the glyph tile when the draft carries no preview", () => {
    render({ attachments: surface({ drafts: [imageDraft()] }) });

    expect(host.querySelector(".agent-composer-attachment__preview")).toBeNull();
    expect(host.querySelector(".agent-composer-attachment__thumb svg")).not.toBeNull();
  });

  it("falls back to the glyph when the preview fails to load", () => {
    render({ attachments: surface({ drafts: [previewImageDraft()] }) });

    act(() => {
      host
        .querySelector<HTMLImageElement>(".agent-composer-attachment__preview")
        ?.dispatchEvent(new Event("error"));
    });

    expect(host.querySelector(".agent-composer-attachment__preview")).toBeNull();
    expect(host.querySelector(".agent-composer-attachment__thumb svg")).not.toBeNull();
    expect(host.querySelector(".agent-composer-attachment__thumb")?.textContent).toContain(
      "shot.webp",
    );
  });

  it("hides the attachment entry points when no project owns the draft", () => {
    render({ attachments: surface({}), attachmentTargetKey: null });

    expect(host.querySelector(".agent-composer__attach")).toBeNull();
  });

  function render(overrides: Partial<AgentComposerProps> = {}): void {
    act(() => root.render(<AgentComposer {...defaultProps()} {...overrides} />));
  }

  function textarea(): HTMLTextAreaElement {
    const element = host.querySelector<HTMLTextAreaElement>("textarea#agent-prompt");
    expect(element).not.toBeNull();
    return element ?? document.createElement("textarea");
  }

  function attachButton(): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(".agent-composer__attach");
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
  }

  function submitButton(): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
  }

  function stubComposerBounds(): void {
    const form = host.querySelector<HTMLFormElement>("form.agent-composer");
    expect(form).not.toBeNull();
    Object.defineProperty(form, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 200,
        height: 200,
        left: 0,
        right: 400,
        top: 0,
        width: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
  }
});

function file(name: string, mime: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name, { type: mime });
}

function pasteEvent(files: ReadonlyArray<File>, text: string): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { files, getData: () => text },
  });
  return event;
}

function draft(overrides: Partial<AgentComposerAttachmentDraft>): AgentComposerAttachmentDraft {
  return {
    draftId: "draft-1",
    kind: "file",
    state: "ready",
    name: "notes.txt",
    bytes: 1_024,
    mime: null,
    width: null,
    height: null,
    attachmentId: null,
    path: null,
    previewUrl: null,
    failure: null,
    notice: null,
    missing: false,
    promptLineBytesMax: 40,
    ...overrides,
  };
}

function referenceDraft(): AgentComposerAttachmentDraft {
  return draft({
    draftId: "draft-reference",
    kind: "reference",
    name: "clip.mp4",
    path: ABSOLUTE_VIDEO,
    bytes: 5_000_000,
  });
}

function missingDraft(): AgentComposerAttachmentDraft {
  return draft({
    draftId: "draft-missing",
    kind: "reference",
    name: "gone.pdf",
    path: "/workspace/app/gone.pdf",
    missing: true,
    notice: "This file is no longer at that path",
  });
}

function stagingDraft(): AgentComposerAttachmentDraft {
  return draft({ draftId: "draft-staging", kind: "image", state: "staging", name: "shot.png" });
}

function failedDraft(): AgentComposerAttachmentDraft {
  return draft({
    draftId: "draft-failed",
    kind: "image",
    state: "failed",
    name: "huge.png",
    failure: "Image cannot be shrunk to 10 MiB.",
  });
}

function imageDraft(): AgentComposerAttachmentDraft {
  return draft({
    draftId: "draft-image",
    kind: "image",
    name: "shot.webp",
    mime: "image/webp",
    width: 1_024,
    height: 768,
    attachmentId: "0".repeat(32),
    bytes: 240_000,
  });
}

function previewImageDraft(): AgentComposerAttachmentDraft {
  return draft({ ...imageDraft(), draftId: "draft-preview", previewUrl: PREVIEW_URL });
}

function stagingPreviewDraft(): AgentComposerAttachmentDraft {
  return draft({ ...stagingDraft(), previewUrl: PREVIEW_URL });
}

function surface(
  overrides: Partial<AgentComposerAttachmentsSurface>,
): AgentComposerAttachmentsSurface {
  return {
    drafts: [],
    projectRootKey: "/workspace/app",
    staging: false,
    blocked: false,
    refusal: null,
    promptLineBytes: 0,
    add: async () => undefined,
    claimPaste: () => "pass-through",
    remove: () => undefined,
    clear: () => undefined,
    markSent: () => undefined,
    refuse: () => undefined,
    dismissRefusal: () => undefined,
    prepareTurn: async () => null,
    ...overrides,
  };
}

function target(): AgentComposerTarget {
  return {
    projectLabel: "app",
    projectRoot: "/workspace/app",
    repositoryOptions: [],
    selectedRepositoryRoot: "/workspace/app",
  };
}

function defaultProps(): AgentComposerProps {
  return {
    attachmentTargetKey: "/workspace/app",
    attachmentDragDrop: async () => () => undefined,
    attachmentPicker: async () => [],
    target: target(),
    prompt: "Ship it",
    promptBytes: 7,
    isolation: "in-place",
    isolationReason: null,
    worktreeAvailable: true,
    worktreeOnly: false,
    worktreeOnlyReason: null,
    guard: { kind: "safe" },
    launch: { provider: "claudeCode", model: "default", mode: "default", effort: "default" },
    launchProvider: "claudeCode",
    dispatching: false,
    submitBlocked: false,
    providerEnabled: { claudeCode: true, codex: true },
    mode: { kind: "new" },
    onSelectRepository: () => undefined,
    onPromptChange: () => undefined,
    onIsolationChange: () => undefined,
    onLaunchChange: () => undefined,
    onNewThread: () => undefined,
    onOpenProviderSettings: () => undefined,
    onSubmit: () => undefined,
  };
}
