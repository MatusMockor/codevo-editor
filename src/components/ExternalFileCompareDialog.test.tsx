// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalFileConflict } from "../domain/externalFileConflict";
import { ExternalFileCompareDialog } from "./ExternalFileCompareDialog";

const compareDialogMocks = vi.hoisted(() => ({
  diffEditorProps: vi.fn(),
  setupShikiTokenization: vi.fn(async (..._args: unknown[]) => {}),
}));

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: (props: Record<string, unknown>) => {
    compareDialogMocks.diffEditorProps(props);
    return <button type="button">Diff control</button>;
  },
}));

vi.mock("../infrastructure/shikiHighlighter", () => ({
  applyImmediateFallbackTheme: vi.fn(),
  setupShikiTokenization: compareDialogMocks.setupShikiTokenization,
}));

describe("ExternalFileCompareDialog", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => mediaQueryList(false)),
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    compareDialogMocks.diffEditorProps.mockReset();
    compareDialogMocks.setupShikiTokenization.mockReset();
    compareDialogMocks.setupShikiTokenization.mockImplementation(
      async (..._args: unknown[]) => {},
    );
    vi.restoreAllMocks();
  });

  it("renders nothing while closed", async () => {
    await renderDialog({ isOpen: false });

    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(compareDialogMocks.diffEditorProps).not.toHaveBeenCalled();
  });

  it("compares live local content with disk using accessible read-only panes", async () => {
    await renderDialog({ liveLocalContent: "current local draft" });

    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.textContent).toContain("Local: /project/note.txt");
    expect(host.textContent).not.toContain("Editor: /project/note.txt");

    expect(lastDiffEditorProps()).toMatchObject({
      height: "100%",
      language: "plaintext",
      modified: "disk version",
      original: "current local draft",
      theme: "calm-dark",
      options: {
        automaticLayout: true,
        minimap: { enabled: false },
        modifiedAriaLabel: "Disk file content",
        originalAriaLabel: "Live local editor content",
        originalEditable: false,
        readOnly: true,
        renderSideBySide: true,
        scrollBeyondLastLine: false,
      },
    });
  });

  it("updates Monaco original content when the live local document changes", async () => {
    await renderDialog({ liveLocalContent: "draft one" });
    await renderDialog({ liveLocalContent: "draft two" });

    expect(lastDiffEditorProps().original).toBe("draft two");
    expect(lastDiffEditorProps().modified).toBe("disk version");
  });

  it("compares a deleted file against empty disk content", async () => {
    await renderDialog({ conflict: deletedConflict() });

    expect(lastDiffEditorProps().modified).toBe("");
    expect(host.textContent).toContain("Disk: file deleted");
  });

  it("uses inline diff and stacked labels on compact viewports", async () => {
    vi.mocked(window.matchMedia).mockReturnValue(mediaQueryList(true));
    await renderDialog();

    expect(lastDiffEditorProps()).toMatchObject({
      options: { renderSideBySide: false },
    });
    expect(
      host.querySelector(".external-file-compare-labels-inline"),
    ).not.toBeNull();
  });

  it("allows an explicit side-by-side override", async () => {
    vi.mocked(window.matchMedia).mockReturnValue(mediaQueryList(true));
    await renderDialog({ renderSideBySide: true });

    expect(lastDiffEditorProps()).toMatchObject({
      options: { renderSideBySide: true },
    });
    expect(host.querySelector(".external-file-compare-labels-inline")).toBeNull();
  });

  it("traps focus, closes with Escape, and restores invoking focus", async () => {
    const invoker = document.createElement("button");
    document.body.append(invoker);
    invoker.focus();
    const onClose = vi.fn();
    await renderDialog({ onClose });

    const dialog = requireDialog();
    const close = requireCloseButton();
    const diffControl = button("Diff control");
    expect(document.activeElement).toBe(close);

    diffControl.focus();
    await act(async () => {
      dialog.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(close);

    await act(async () => {
      dialog.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    await renderDialog({ isOpen: false, onClose });
    expect(document.activeElement).toBe(invoker);
    invoker.remove();
  });

  it("closes from the close button and native backdrop surface", async () => {
    const onClose = vi.fn();
    await renderDialog({ onClose });

    await act(async () => {
      requireCloseButton().click();
      requireDialog().dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true }),
      );
    });

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not close when the modal content is clicked", async () => {
    const onClose = vi.fn();
    await renderDialog({ onClose });

    await act(async () => {
      host
        .querySelector<HTMLElement>(".external-file-compare-surface")
        ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("clears disposed editor refs and guards later option effects", async () => {
    const disposeListener: { current: (() => void) | null } = { current: null };
    const updateOptions = vi.fn();
    const listenerDispose = vi.fn();
    const editor = {
      onDidDispose: vi.fn((listener: () => void) => {
        disposeListener.current = listener;
        return { dispose: listenerDispose };
      }),
      updateOptions,
    };
    await renderDialog();

    await act(async () => {
      onMount()(editor);
    });
    expect(updateOptions).toHaveBeenCalledTimes(1);

    disposeListener.current?.();
    await renderDialog({ editorFontSize: 18 });

    expect(updateOptions).toHaveBeenCalledTimes(1);
  });

  it("disposes editor lifecycle listeners on unmount", async () => {
    const listenerDispose = vi.fn();
    await renderDialog();
    await act(async () => {
      onMount()({
        onDidDispose: () => ({ dispose: listenerDispose }),
        updateOptions: vi.fn(),
      });
      root.unmount();
    });

    expect(listenerDispose).toHaveBeenCalledTimes(1);
    root = createRoot(host);
  });

  it("cancels stale async theme application after a theme change", async () => {
    const monaco = {};
    await renderDialog({ monacoTheme: "calm-dark" });

    beforeMount()(monaco);
    const firstGuard = themeGuard(0);
    expect(firstGuard()).toBe(true);

    await renderDialog({ monacoTheme: "calm-light" });

    expect(compareDialogMocks.setupShikiTokenization).toHaveBeenCalledTimes(2);
    expect(firstGuard()).toBe(false);
    expect(themeGuard(1)()).toBe(true);
  });

  it("cancels an in-flight theme request when the dialog closes", async () => {
    let resolveTheme: (() => void) | null = null;
    const applied = vi.fn();
    compareDialogMocks.setupShikiTokenization.mockImplementation(
      async (...args: unknown[]) => {
        await new Promise<void>((resolve) => {
          resolveTheme = resolve;
        });
        const options = args[2] as { shouldApply(): boolean };
        if (options.shouldApply()) {
          applied();
        }
      },
    );

    await renderDialog();
    beforeMount()({});
    expect(themeGuard(0)()).toBe(true);

    await renderDialog({ isOpen: false });
    expect(themeGuard(0)()).toBe(false);

    await act(async () => {
      resolveTheme?.();
      await Promise.resolve();
    });

    expect(applied).not.toHaveBeenCalled();
  });

  async function renderDialog(
    overrides: Partial<{
      conflict: ExternalFileConflict;
      editorFontSize: number;
      isOpen: boolean;
      liveLocalContent: string;
      monacoTheme: "calm-dark" | "calm-light";
      onClose: () => void;
      renderSideBySide: boolean;
    }> = {},
  ) {
    await act(async () => {
      root.render(
        <ExternalFileCompareDialog
          conflict={overrides.conflict ?? modifiedConflict()}
          editorFontSize={overrides.editorFontSize}
          isOpen={overrides.isOpen ?? true}
          language="plaintext"
          liveLocalContent={overrides.liveLocalContent ?? "editor draft"}
          monacoTheme={overrides.monacoTheme ?? "calm-dark"}
          onClose={overrides.onClose ?? vi.fn()}
          renderSideBySide={overrides.renderSideBySide}
        />,
      );
    });
  }

  function requireDialog(): HTMLDialogElement {
    const dialog = host.querySelector<HTMLDialogElement>('[role="dialog"]');
    if (!dialog) {
      throw new Error("Expected comparison dialog");
    }

    return dialog;
  }

  function requireCloseButton(): HTMLButtonElement {
    const close = host.querySelector<HTMLButtonElement>(
      '[aria-label="Close comparison"]',
    );
    if (!close) {
      throw new Error("Expected close button");
    }

    return close;
  }

  function button(label: string): HTMLButtonElement {
    const match = Array.from(host.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
    );
    if (!match) {
      throw new Error(`Expected ${label} button`);
    }

    return match;
  }
});

function lastDiffEditorProps(): Record<string, unknown> & {
  modified?: unknown;
  original?: unknown;
} {
  const calls = compareDialogMocks.diffEditorProps.mock.calls;
  const props = calls[calls.length - 1]?.[0];

  if (!props) {
    throw new Error("Expected the diff editor to render");
  }

  return props;
}

function beforeMount(): (monaco: object) => void {
  return lastDiffEditorProps().beforeMount as (monaco: object) => void;
}

type TestDiffEditor = {
  onDidDispose(listener: () => void): { dispose(): void };
  updateOptions(options: object): void;
};

function onMount(): (editor: TestDiffEditor) => void {
  return lastDiffEditorProps().onMount as (editor: TestDiffEditor) => void;
}

function themeGuard(callIndex: number): () => boolean {
  const options = compareDialogMocks.setupShikiTokenization.mock.calls[
    callIndex
  ]?.[2] as { shouldApply?: unknown } | undefined;
  const shouldApply = options?.shouldApply;
  if (typeof shouldApply !== "function") {
    throw new Error("Expected a theme cancellation guard");
  }

  return shouldApply as () => boolean;
}

function mediaQueryList(matches: boolean): MediaQueryList {
  return {
    matches,
    media: "(max-width: 680px)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

function modifiedConflict(): ExternalFileConflict {
  return {
    id: 1,
    revision: 2,
    kind: "modified",
    baseline: { path: "/project/note.txt", content: "saved baseline" },
    disk: { path: "/project/note.txt", content: "disk version" },
  };
}

function deletedConflict(): ExternalFileConflict {
  return {
    id: 1,
    revision: 3,
    kind: "deleted",
    baseline: { path: "/project/note.txt", content: "saved baseline" },
    disk: null,
  };
}
