// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentComposerAttachmentDraft } from "../../application/useAgentComposerAttachments";
import { AGENT_ATTACHMENT_MISSING_SOURCE_NOTICE } from "../../application/useAgentComposerAttachments";
import { AgentComposerAttachments } from "./AgentComposerAttachments";

const FOLDER_PATH = "/Users/x/Documents/codevo s.r.o./invoices";

describe("AgentComposerAttachments folder pill", () => {
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
  });

  it("shows a folder as a compact pill with its basename and the full path as the tooltip", () => {
    render([folderDraft({})]);

    const pill = chip("draft-folder");
    expect(pill.dataset.agentAttachmentEntry).toBe("directory");
    expect(pill.dataset.agentAttachmentCompact).toBe("true");
    expect(pill.title).toBe(FOLDER_PATH);
    expect(pill.querySelector(".lucide-folder")).not.toBeNull();
    expect(pill.querySelector(".lucide-link-2")).toBeNull();
    expect(pill.querySelector(".agent-composer-attachment__name")?.textContent).toBe("invoices");
    expect(pill.querySelector(".agent-composer-attachment__meta")?.children).toHaveLength(1);
    expect(pill.textContent).toBe("invoices");
  });

  it("keeps the file reference chip with its link glyph and size line", () => {
    render([
      folderDraft({
        draftId: "draft-file",
        entry: "file",
        name: "clip.mp4",
        path: "/Users/dev/clip.mp4",
        bytes: 5_000_000,
      }),
    ]);

    const pill = chip("draft-file");
    expect(pill.dataset.agentAttachmentEntry).toBeUndefined();
    expect(pill.dataset.agentAttachmentCompact).toBeUndefined();
    expect(pill.title).toBe("/Users/dev/clip.mp4");
    expect(pill.querySelector(".lucide-link-2")).not.toBeNull();
    expect(pill.querySelector(".lucide-folder")).toBeNull();
    expect(pill.querySelector(".agent-composer-attachment__size")?.textContent).toBe("4.8 MiB");
  });

  it("decides the pill from the inspected entry, never from the name", () => {
    render([
      folderDraft({ draftId: "draft-dotted", name: "report.pdf", path: "/Users/x/report.pdf" }),
      folderDraft({ draftId: "draft-plain", entry: "file", name: "Makefile", path: "/w/Makefile" }),
    ]);

    expect(chip("draft-dotted").querySelector(".lucide-folder")).not.toBeNull();
    expect(chip("draft-plain").querySelector(".lucide-folder")).toBeNull();
  });

  it("keeps the missing notice visible on a folder that is gone", () => {
    render([folderDraft({ missing: true, notice: AGENT_ATTACHMENT_MISSING_SOURCE_NOTICE })]);

    const pill = chip("draft-folder");
    expect(pill.dataset.agentAttachmentMissing).toBe("true");
    expect(pill.dataset.agentAttachmentCompact).toBeUndefined();
    expect(pill.querySelector(".lucide-folder")).not.toBeNull();
    expect(pill.querySelector(".agent-composer-attachment__notice")?.textContent).toBe(
      AGENT_ATTACHMENT_MISSING_SOURCE_NOTICE,
    );
    expect(pill.title).toBe(`invoices - ${AGENT_ATTACHMENT_MISSING_SOURCE_NOTICE}`);
  });

  it("keeps the failure text visible on a failed folder", () => {
    render([folderDraft({ state: "failed", failure: "Path is not attachable." })]);

    const pill = chip("draft-folder");
    expect(pill.dataset.agentAttachmentState).toBe("failed");
    expect(pill.dataset.agentAttachmentCompact).toBeUndefined();
    expect(pill.querySelector(".agent-composer-attachment__failure")?.textContent).toBe(
      "Path is not attachable.",
    );
    expect(pill.title).toBe("invoices - Path is not attachable.");
  });

  it("removes a folder through its remove control", () => {
    const onRemove = vi.fn();
    render([folderDraft({})], onRemove);

    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Remove invoices"]')?.click());

    expect(onRemove).toHaveBeenCalledWith("draft-folder");
  });

  function chip(draftId: string): HTMLElement {
    const index = drafts.findIndex((draft) => draft.draftId === draftId);
    const found = host.querySelectorAll<HTMLElement>(".agent-composer-attachment")[index];
    expect(found).toBeDefined();
    return found as HTMLElement;
  }

  let drafts: ReadonlyArray<AgentComposerAttachmentDraft> = [];

  function render(
    next: ReadonlyArray<AgentComposerAttachmentDraft>,
    onRemove: (draftId: string) => void = () => undefined,
  ): void {
    drafts = next;
    act(() =>
      root.render(
        <AgentComposerAttachments
          drafts={next}
          onDismissRefusal={() => undefined}
          onRemove={onRemove}
          refusal={null}
        />,
      ),
    );
  }
});

function folderDraft(
  overrides: Partial<AgentComposerAttachmentDraft>,
): AgentComposerAttachmentDraft {
  return {
    draftId: "draft-folder",
    kind: "reference",
    entry: "directory",
    state: "ready",
    name: "invoices",
    bytes: 0,
    mime: null,
    width: null,
    height: null,
    attachmentId: null,
    path: FOLDER_PATH,
    previewUrl: null,
    failure: null,
    notice: null,
    missing: false,
    promptLineBytesMax: 0,
    ...overrides,
  };
}
