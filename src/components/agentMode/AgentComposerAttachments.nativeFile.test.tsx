// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentComposerAttachmentDraft } from "../../application/useAgentComposerAttachments";
import { MAX_AGENT_FILE_BYTES } from "../../domain/agentAttachment";
import { REMOTE_FILE_UPLOAD_CHANGED_ERROR } from "../../domain/remoteRunnerFileAttachment";
import {
  AGENT_COMPOSER_ATTACHMENT_SAVING_LABEL,
  AGENT_COMPOSER_FILE_CHECKING_LABEL,
  AgentComposerAttachments,
} from "./AgentComposerAttachments";
import { AgentComposerQueuedEditAttachments } from "./AgentComposerQueuedEditBar";
import { queuedEditAttachmentDraft } from "./agentComposerQueuedEdit";

const LONG_NAME = `quarterly-report-${"final-".repeat(30)}v2.pdf`;

describe("composer chip for a path-backed file", () => {
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

  function render(
    drafts: ReadonlyArray<AgentComposerAttachmentDraft>,
    onRemove: (draftId: string) => void = () => undefined,
    refusal: string | null = null,
  ): void {
    act(() =>
      root.render(
        <AgentComposerAttachments
          drafts={drafts}
          onDismissRefusal={() => undefined}
          onRemove={onRemove}
          refusal={refusal}
        />,
      ),
    );
  }

  function chip(): HTMLElement {
    const element = host.querySelector<HTMLElement>("[data-agent-attachment-kind='file']");
    expect(element).not.toBeNull();
    return element ?? document.createElement("div");
  }

  it("says truthfully that a staging file is being checked and never shows a zero size", () => {
    const remove = vi.fn();
    render([nativeFile({ state: "staging", bytes: 0 })], remove);

    const staging = chip();
    expect(staging.getAttribute("aria-busy")).toBe("true");
    expect(staging.dataset.agentAttachmentState).toBe("staging");
    expect(staging.classList.contains("agent-composer-attachment--chip")).toBe(true);
    expect(staging.querySelector(".cv-spinner")).not.toBeNull();
    expect(staging.querySelector(".agent-composer-attachment__name")?.textContent).toBe(
      "report.pdf",
    );
    expect(staging.querySelector(".agent-composer-attachment__size")?.textContent).toBe(
      AGENT_COMPOSER_FILE_CHECKING_LABEL,
    );
    expect(staging.textContent).not.toContain("0 B");
    expect(staging.textContent).not.toContain(AGENT_COMPOSER_ATTACHMENT_SAVING_LABEL);

    act(() =>
      host.querySelector<HTMLButtonElement>("button[aria-label='Remove report.pdf']")?.click(),
    );
    expect(remove).toHaveBeenCalledWith("draft-file");
  });

  it("keeps the saving label for a pasted file that is copied into the draft store", () => {
    render([nativeFile({ state: "staging", bytes: 0, backing: undefined })]);

    expect(chip().querySelector(".agent-composer-attachment__size")?.textContent).toBe(
      AGENT_COMPOSER_ATTACHMENT_SAVING_LABEL,
    );
  });

  it("shows a ready file as a file chip with its name, size and remove control", () => {
    const remove = vi.fn();
    render([nativeFile({ bytes: 5_000_000 })], remove);

    const ready = chip();
    expect(ready.getAttribute("aria-busy")).toBeNull();
    expect(ready.classList.contains("agent-composer-attachment--image")).toBe(false);
    expect(ready.querySelector("svg.lucide-file-text")).not.toBeNull();
    expect(ready.querySelector("img")).toBeNull();
    expect(ready.querySelector(".agent-composer-attachment__thumb")).toBeNull();
    expect(ready.querySelector(".agent-composer-attachment__name")?.textContent).toBe("report.pdf");
    expect(ready.querySelector(".agent-composer-attachment__size")?.textContent).toBe("4.8 MiB");

    const button = host.querySelector<HTMLButtonElement>("button[aria-label='Remove report.pdf']");
    expect(button?.type).toBe("button");
    act(() => button?.click());
    expect(remove).toHaveBeenCalledWith("draft-file");
  });

  it("reads the largest accepted file as 50 MiB", () => {
    render([nativeFile({ bytes: MAX_AGENT_FILE_BYTES })]);

    expect(chip().querySelector(".agent-composer-attachment__size")?.textContent).toBe("50 MiB");
  });

  it("keeps the full name of a long file in the title while the label truncates", () => {
    render([nativeFile({ name: LONG_NAME, bytes: 2_048 })]);

    const long = chip();
    expect(long.title).toBe(LONG_NAME);
    expect(long.querySelector(".agent-composer-attachment__name")?.textContent).toBe(LONG_NAME);
    expect(host.innerHTML).not.toContain("/Users/");
  });

  it("treats a file that declares an image type by its name as a file", () => {
    render([nativeFile({ name: "photo.png", bytes: 2_048 })]);

    const declared = chip();
    expect(declared.classList.contains("agent-composer-attachment--chip")).toBe(true);
    expect(declared.querySelector("svg.lucide-file-text")).not.toBeNull();
    expect(host.querySelector("button[aria-label='Preview photo.png']")).toBeNull();
  });

  it("shows the failure of a file verbatim, without a size and without calling it an image", () => {
    render([nativeFile({ state: "failed", bytes: 0, failure: REMOTE_FILE_UPLOAD_CHANGED_ERROR })]);

    const failed = chip();
    expect(failed.dataset.agentAttachmentState).toBe("failed");
    expect(failed.querySelector(".agent-composer-attachment__failure")?.textContent).toBe(
      REMOTE_FILE_UPLOAD_CHANGED_ERROR,
    );
    expect(failed.title).toBe(`report.pdf - ${REMOTE_FILE_UPLOAD_CHANGED_ERROR}`);
    expect(failed.querySelector(".agent-composer-attachment__size")).toBeNull();
    expect(failed.querySelector("svg.lucide-triangle-alert")).not.toBeNull();
    expect(failed.textContent).not.toMatch(/image/i);
    expect(failed.textContent).not.toContain("0 B");
    expect(host.querySelector("button[aria-label='Remove report.pdf']")).not.toBeNull();
  });

  it("shows no size for a failed file that carries no reason", () => {
    render([nativeFile({ state: "failed", bytes: 0, failure: null })]);

    expect(chip().querySelector(".agent-composer-attachment__size")).toBeNull();
    expect(chip().textContent).toBe("report.pdf");
  });

  it("shows the pending-clone notice instead of an unknown size", () => {
    render([nativeFile({ bytes: 0, notice: "Will attach when cloning finishes" })]);

    const held = chip();
    expect(held.querySelector(".agent-composer-attachment__notice")?.textContent).toBe(
      "Will attach when cloning finishes",
    );
    expect(held.textContent).not.toContain("0 B");
  });

  it("shows a queued file being edited as a sized file chip", () => {
    const queued = queuedEditAttachmentDraft({
      key: "q1",
      entry: "file",
      attachment: {
        kind: "file",
        attachmentId: "b".repeat(32),
        name: "report.pdf",
        bytes: 5_000_000,
        storedPath: "/data/agent-attachments/report.bin",
      },
    });
    const onRemoveAttachment = vi.fn();
    act(() =>
      root.render(
        <AgentComposerQueuedEditAttachments
          edit={{
            threadId: "t",
            lease: 1,
            prompt: "Use the report",
            attachments: [queued],
            onRemoveAttachment,
            onCancel: () => undefined,
            commit: async () => true,
          }}
        />,
      ),
    );

    const editing = chip();
    expect(editing.querySelector(".agent-composer-attachment__name")?.textContent).toBe(
      "report.pdf",
    );
    expect(editing.querySelector(".agent-composer-attachment__size")?.textContent).toBe("4.8 MiB");
    expect(host.innerHTML).not.toContain("/data/agent-attachments");
    act(() =>
      host.querySelector<HTMLButtonElement>("button[aria-label='Remove report.pdf']")?.click(),
    );
    expect(onRemoveAttachment).toHaveBeenCalledWith(queued.draftId);
  });
});

function nativeFile(
  overrides: Partial<AgentComposerAttachmentDraft> = {},
): AgentComposerAttachmentDraft {
  return {
    draftId: "draft-file",
    kind: "file",
    entry: "file",
    state: "ready",
    name: "report.pdf",
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
    promptLineBytesMax: 0,
    backing: "nativeFile",
    ...overrides,
  };
}
