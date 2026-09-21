// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentAttachmentSource,
  AgentComposerAttachmentsSurface,
  AgentComposerAttachmentDraft,
} from "../../application/useAgentComposerAttachments";
import { AgentComposer, type AgentComposerProps } from "./AgentComposer";
import { agentPasteClaim } from "../../domain/agentAttachmentIntake";

const longText = "😀".repeat(9500);
const encoder = new TextEncoder();
function draft(name = "pasted-text.txt"): AgentComposerAttachmentDraft {
  return {
    draftId: name,
    kind: "file",
    state: "ready",
    name,
    bytes: 38000,
    mime: null,
    width: null,
    height: null,
    attachmentId: "attachment-1",
    path: null,
    previewUrl: null,
    failure: null,
    notice: null,
    missing: false,
    promptLineBytesMax: 256,
  };
}
function surface(
  overrides: Partial<AgentComposerAttachmentsSurface> = {},
): AgentComposerAttachmentsSurface {
  return {
    drafts: [],
    projectRootKey: "/app",
    staging: false,
    blocked: false,
    refusal: null,
    promptLineBytes: 0,
    add: async () => undefined,
    claimPaste: agentPasteClaim,
    remove: vi.fn(),
    clear: vi.fn(),
    markSent: vi.fn(),
    refuse: vi.fn(),
    dismissRefusal: vi.fn(),
    prepareTurn: async () => null,
    ...overrides,
  };
}
function props(): AgentComposerProps {
  return {
    target: {
      projectLabel: "app",
      projectRoot: "/app",
      repositoryOptions: [],
      selectedRepositoryRoot: "/app",
    },
    prompt: "",
    promptBytes: 0,
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
    onSelectRepository: vi.fn(),
    onPromptChange: vi.fn(),
    onIsolationChange: vi.fn(),
    onLaunchChange: vi.fn(),
    onNewThread: vi.fn(),
    onOpenProviderSettings: vi.fn(),
    onSubmit: vi.fn(),
    attachmentTargetKey: "/app",
    promptOwnerKey: "owner-A",
    attachmentDragDrop: async () => () => undefined,
  };
}
describe("AgentComposer pasted text", () => {
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
    vi.restoreAllMocks();
  });
  function render(overrides: Partial<AgentComposerProps> = {}) {
    act(() => root.render(<AgentComposer {...props()} {...overrides} />));
  }
  function field() {
    return host.querySelector("textarea")!;
  }
  async function paste(text: string, files: File[] = []) {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { files, items: [], getData: () => text },
    });
    await act(async () => {
      field().dispatchEvent(event);
    });
    return event;
  }
  it("stages every UTF-8 byte of 38k text without replacing the existing prompt", async () => {
    const intake = vi.fn(async (_sources: ReadonlyArray<AgentAttachmentSource>) => undefined);
    const onPromptChange = vi.fn();
    render({
      attachments: surface({ captureIntake: () => intake }),
      prompt: "Review this:",
      promptBytes: 12,
      onPromptChange,
    });
    expect((await paste(longText)).defaultPrevented).toBe(true);
    const source = intake.mock.calls[0]?.[0][0];
    expect(source?.kind).toBe("bytes");
    if (source?.kind !== "bytes") throw new Error("missing bytes");
    expect(source.bytes.byteLength).toBe(38000);
    expect(new TextDecoder().decode(source.bytes)).toBe(longText);
    expect(source.name).toBe("pasted-text.txt");
    expect(source.mime).toBe("text/plain;charset=utf-8");
    expect(field().value).toBe("Review this:");
    expect(onPromptChange).not.toHaveBeenCalled();
  });
  it("folds a short paste only when the result including references exceeds budget", async () => {
    const intake = vi.fn(async () => undefined);
    const attachments = surface({ captureIntake: () => intake });
    render({ attachments, prompt: "😀", promptBytes: 32768 });
    field().setSelectionRange(0, 2);
    expect((await paste("ab")).defaultPrevented).toBe(false);
    field().setSelectionRange(2, 2);
    expect((await paste("ab")).defaultPrevented).toBe(true);
    expect(intake).toHaveBeenCalledOnce();
  });
  it.each(["metaKey", "ctrlKey"] as const)(
    "allows Shift+%s+V inline for exactly one paste",
    async (modifier) => {
      const intake = vi.fn(async () => undefined);
      render({ attachments: surface({ captureIntake: () => intake }) });
      act(() =>
        field().dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "V",
            shiftKey: true,
            [modifier]: true,
            bubbles: true,
          }),
        ),
      );
      expect((await paste(longText)).defaultPrevented).toBe(false);
      expect((await paste(longText)).defaultPrevented).toBe(true);
      expect(intake).toHaveBeenCalledOnce();
    },
  );
  it("refuses unavailable targets and exhausted attachment capacity without inserting text", async () => {
    render({ attachments: null });
    expect((await paste(longText)).defaultPrevented).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("available project");
    const intake = vi.fn(async () => undefined);
    render({
      attachments: surface({
        drafts: Array.from({ length: 8 }, (_, i) => draft(`${i}.txt`)),
        captureIntake: () => intake,
      }),
    });
    expect((await paste(longText)).defaultPrevented).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("8 attachments");
    expect(intake).not.toHaveBeenCalled();
  });
  it("keeps names unique after staging settles before draft publication", async () => {
    const intake = vi.fn(async (_sources: ReadonlyArray<AgentAttachmentSource>) => undefined);
    render({ attachments: surface({ captureIntake: () => intake }) });
    await paste(longText);
    await paste(longText);
    expect(
      intake.mock.calls.map(([sources]) => sources[0]?.kind === "bytes" && sources[0].name),
    ).toEqual(["pasted-text.txt", "pasted-text-2.txt"]);
  });
  it("resets naming on owner switches without stale completion releasing the new owner reservation", async () => {
    let finishOld: (() => void) | undefined;
    const oldPending = new Promise<void>((resolve) => {
      finishOld = resolve;
    });
    const intake = vi.fn((_sources: ReadonlyArray<AgentAttachmentSource>) => Promise.resolve());
    intake.mockImplementationOnce(() => oldPending);
    const attachments = surface({ captureIntake: () => intake });
    render({ attachments });
    await paste(longText);
    render({ attachments, promptOwnerKey: "owner-B" });
    await paste(longText);
    render({ attachments, promptOwnerKey: "owner-A" });
    await paste(longText);
    await act(async () => finishOld?.());
    await paste(longText);
    expect(
      intake.mock.calls.map(([sources]) => sources[0]?.kind === "bytes" && sources[0].name),
    ).toEqual(["pasted-text.txt", "pasted-text.txt", "pasted-text.txt", "pasted-text-2.txt"]);
  });
  it("reserves unique names while earlier staging is still pending", async () => {
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const intake = vi.fn((_sources: ReadonlyArray<AgentAttachmentSource>) => pending);
    render({ attachments: surface({ drafts: [draft()], captureIntake: () => intake }) });
    await paste(longText);
    await paste(longText);
    expect(
      intake.mock.calls.map(([sources]) => sources[0]?.kind === "bytes" && sources[0].name),
    ).toEqual(["pasted-text-2.txt", "pasted-text-3.txt"]);
    await act(async () => finish?.());
  });
  it("gives an image clipboard priority and renders removable ordinary file chips", async () => {
    const intake = vi.fn(async (_sources: ReadonlyArray<AgentAttachmentSource>) => undefined);
    const image = new File(["png"], "shot.png", { type: "image/png" });
    Object.defineProperty(image, "arrayBuffer", {
      value: async () => encoder.encode("png").buffer,
    });
    const attachments = surface({
      drafts: [draft()],
      captureIntake: () => intake,
    });
    render({ attachments });
    expect((await paste(longText, [image])).defaultPrevented).toBe(true);
    expect(intake.mock.calls[0]?.[0][0]).toMatchObject({ kind: "bytes", name: "shot.png" });
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Remove pasted-text.txt"]')?.click(),
    );
    expect(attachments.remove).toHaveBeenCalledWith("pasted-text.txt");
  });
  it("replaces only the selected range once its pasted file is ready", async () => {
    const intake = vi.fn(async () => undefined);
    const attachments = surface({ captureIntake: () => intake });
    const onPromptChange = vi.fn();
    const base = { attachments, prompt: "before old after", promptBytes: 16, onPromptChange };
    render(base);
    field().setSelectionRange(7, 10);
    await paste(longText);
    expect(onPromptChange).not.toHaveBeenCalled();
    render({ ...base, attachments: { ...attachments, drafts: [draft()] } });
    expect(onPromptChange).toHaveBeenCalledExactlyOnceWith("before  after");
  });
  it("releases a refused conversion so the unchanged draft can be retried", async () => {
    const attachments = surface({ captureIntake: () => null });
    const onPromptChange = vi.fn();
    const base = { attachments, prompt: longText, promptBytes: 38000, onPromptChange };
    render(base);
    const button = Array.from(host.querySelectorAll("button")).find(
      (entry) => entry.textContent === "Attach draft as text file",
    );
    await act(async () => button?.click());
    expect(attachments.refuse).toHaveBeenCalledExactlyOnceWith(
      "The attachment draft is unavailable. Select the project again.",
    );
    render({
      ...base,
      attachments: {
        ...attachments,
        refusal: "The attachment draft is unavailable. Select the project again.",
      },
    });
    expect(
      Array.from(host.querySelectorAll("button")).find(
        (entry) => entry.textContent === "Attach draft as text file",
      )?.disabled,
    ).toBe(false);
    expect(field().value).toBe(longText);
    expect(onPromptChange).not.toHaveBeenCalled();
  });
  it("expires inline bypass instead of applying it to a later unrelated paste", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    const intake = vi.fn(async () => undefined);
    render({ attachments: surface({ captureIntake: () => intake }) });
    act(() =>
      field().dispatchEvent(
        new KeyboardEvent("keydown", { key: "v", shiftKey: true, metaKey: true, bubbles: true }),
      ),
    );
    now.mockReturnValue(2001);
    expect((await paste(longText)).defaultPrevented).toBe(true);
    expect(intake).toHaveBeenCalledOnce();
  });
  it("retains an over-budget draft until the corresponding file is ready", async () => {
    const intake = vi.fn(async () => undefined);
    const onPromptChange = vi.fn();
    const base = { prompt: longText, promptBytes: 38000, onPromptChange };
    const attachments = surface({ captureIntake: () => intake });
    render({ ...base, attachments });
    const button = Array.from(host.querySelectorAll("button")).find(
      (entry) => entry.textContent === "Attach draft as text file",
    );
    expect(button).toBeDefined();
    await act(async () => button?.click());
    expect(onPromptChange).not.toHaveBeenCalled();
    expect(field().value).toBe(longText);
    render({
      ...base,
      attachments: { ...attachments, drafts: [{ ...draft(), state: "staging" }] },
    });
    expect(onPromptChange).not.toHaveBeenCalled();
    render({ ...base, attachments: { ...attachments, drafts: [draft()] } });
    expect(onPromptChange).toHaveBeenCalledExactlyOnceWith("");
  });
  it.each(["failed", "owner", "revision", "edit-away-back"])(
    "does not clear a draft after %s invalidates conversion",
    async (scenario) => {
      const onPromptChange = vi.fn();
      const attachments = surface({ captureIntake: () => async () => undefined });
      const base = { prompt: longText, promptBytes: 38000, onPromptChange, attachments };
      render(base);
      const button = Array.from(host.querySelectorAll("button")).find(
        (entry) => entry.textContent === "Attach draft as text file",
      );
      await act(async () => button?.click());
      if (scenario === "owner") {
        render({ ...base, promptOwnerKey: "owner-B" });
        render(base);
      } else if (scenario === "revision") {
        render({ ...base, promptRevision: 2 });
      } else if (scenario === "edit-away-back") {
        render({ ...base, prompt: "temporary" });
        render(base);
      } else {
        render({
          ...base,
          attachments: {
            ...attachments,
            drafts: [{ ...draft(), state: "failed", failure: "stage refused" }],
          },
        });
      }
      render({ ...base, attachments: { ...attachments, drafts: [draft()] } });
      expect(onPromptChange).not.toHaveBeenCalled();
      expect(field().value).toBe(longText);
    },
  );
  it("invalidates pending staging authority on A to B to A and suppresses stale errors", async () => {
    let reject: ((error: Error) => void) | undefined;
    const pending = new Promise<void>((_, fail) => {
      reject = fail;
    });
    let isCurrent: (() => boolean) | undefined;
    const attachments = surface({
      captureIntake: (_target, current) => {
        isCurrent = current;
        return () => pending;
      },
    });
    render({ attachments });
    await paste(longText);
    expect(isCurrent?.()).toBe(true);
    render({ attachments, promptOwnerKey: "owner-B" });
    render({ attachments, promptOwnerKey: "owner-A" });
    expect(isCurrent?.()).toBe(false);
    await act(async () => reject?.(new Error("old failure")));
    expect(attachments.refuse).not.toHaveBeenCalled();
  });
});
