// @vitest-environment jsdom

import { StrictMode, act, useLayoutEffect, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import { KeyMod } from "monaco-editor/esm/vs/editor/common/services/editorBaseApi.js";
import { KeyCode } from "monaco-editor/esm/vs/editor/common/standalone/standaloneEnums.js";
import type { CommandContext, CommandExecutionOutcome } from "../../application/commandRegistry";
import { defaultKeymapSettings, type KeymapSettings } from "../../domain/keymap";
import { ExternalFileCompareDialog } from "../ExternalFileCompareDialog";
import { FileHistoryPanel } from "../FileHistoryPanel";
import { GitDiffPreview } from "../GitDiffPreview";
import { LocalHistoryPanel } from "../LocalHistoryPanel";
import RemoteFileComparison from "../remoteRunner/RemoteFileComparison";
import {
  SecondaryEditorKeymapContext,
  useSecondaryEditorKeymapBinding,
} from "./secondaryEditorKeymapContext";

interface RecordedAction {
  readonly descriptor: Monaco.editor.IActionDescriptor;
  disposed: boolean;
}

interface FakeDiffEditor {
  readonly actions: RecordedAction[];
  dispose(): void;
  readonly goToDiff: ReturnType<typeof vi.fn>;
}

const monacoDouble = vi.hoisted(() => ({
  editors: [] as FakeDiffEditor[],
  runtimeReady: Promise.resolve(),
}));

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: function DiffEditorDouble(props: {
    onMount?: (editor: unknown, monaco: unknown) => void;
  }) {
    const onMountRef = useRef(props.onMount);
    useLayoutEffect(() => {
      const editor = createFakeDiffEditor();
      monacoDouble.editors.push(editor);
      onMountRef.current?.(editor, { KeyCode, KeyMod });
    }, []);
    return <div data-testid="diff-editor" />;
  },
}));

vi.mock("../monacoRuntimeLoader", () => ({
  initializeMonacoRuntime: vi.fn(() => monacoDouble.runtimeReady),
}));

vi.mock("../../infrastructure/shikiHighlighter", () => ({
  applyImmediateFallbackTheme: vi.fn(),
  setupShikiTokenization: vi.fn(async () => undefined),
}));

function createFakeInnerEditor(actions: RecordedAction[], disposeListeners: Array<() => void>) {
  return {
    onDidDispose: (listener: () => void) => {
      disposeListeners.push(listener);
      return {
        dispose: () => {
          disposeListeners.splice(disposeListeners.indexOf(listener), 1);
        },
      };
    },
    addAction: (descriptor: Monaco.editor.IActionDescriptor) => {
      const entry: RecordedAction = { descriptor, disposed: false };
      actions.push(entry);
      return {
        dispose: () => {
          entry.disposed = true;
        },
      };
    },
    getAction: () => null,
    getModel: () => ({}),
    trigger: vi.fn(),
  };
}

function createFakeDiffEditor() {
  const actions: RecordedAction[] = [];
  const disposeListeners: Array<() => void> = [];
  const original = createFakeInnerEditor(actions, []);
  const modified = createFakeInnerEditor(actions, disposeListeners);
  const model = { dispose: vi.fn(), isDisposed: () => false };
  return {
    actions,
    dispose: () => [...disposeListeners].forEach((listener) => listener()),
    getLineChanges: () => [],
    getModel: () => ({ modified: model, original: model }),
    getModifiedEditor: () => modified,
    getOriginalEditor: () => original,
    goToDiff: vi.fn(),
    onDidDispose: () => ({ dispose: () => undefined }),
    onDidUpdateDiff: () => ({ dispose: () => undefined }),
    setModel: vi.fn(),
    updateOptions: vi.fn(),
  };
}

const gitDiff = {
  change: {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path: "/workspace/src/example.ts",
    relativePath: "src/example.ts",
    status: "modified" as const,
  },
  language: "typescript",
  modifiedContent: "const value = 2;\n",
  originalContent: "const value = 1;\n",
};

type HostCase = readonly [string, (onClose: () => void) => ReactNode];

const HOSTS: readonly HostCase[] = [
  [
    "GitDiffPreview",
    (onClose) => (
      <GitDiffPreview diff={gitDiff} isLoading={false} monacoTheme="calm-dark" onClose={onClose} />
    ),
  ],
  [
    "LocalHistoryPanel",
    (onClose) => (
      <LocalHistoryPanel
        diff={{ language: "typescript", modifiedContent: "b\n", originalContent: "a\n" }}
        diffLoading={false}
        isOpen
        monacoTheme="calm-dark"
        onClose={onClose}
        onRevertVersion={vi.fn()}
        onSelectVersion={vi.fn()}
        relativePath="src/example.ts"
        selectedVersionId="v1"
        versions={[]}
        versionsLoading={false}
      />
    ),
  ],
  [
    "FileHistoryPanel",
    (onClose) => (
      <FileHistoryPanel
        commits={[]}
        commitsLoading={false}
        diff={gitDiff}
        diffLoading={false}
        isOpen
        monacoTheme="calm-dark"
        onClose={onClose}
        onSelectCommit={vi.fn()}
        relativePath="src/example.ts"
        selectedSha="abc123"
      />
    ),
  ],
  [
    "ExternalFileCompareDialog",
    (onClose) => (
      <ExternalFileCompareDialog
        conflict={{
          baseline: { content: "saved", path: "/project/note.txt" },
          disk: { content: "disk", path: "/project/note.txt" },
          id: 1,
          kind: "modified",
          revision: 2,
        }}
        isOpen
        language="plaintext"
        liveLocalContent="draft"
        monacoTheme="calm-dark"
        onClose={onClose}
      />
    ),
  ],
  ["RemoteFileComparison", () => <RemoteFileComparison original="server" modified="draft" />],
];

describe.each(HOSTS)("%s keymap bridge", (hostName, renderHost) => {
  let host: HTMLDivElement;
  let root: Root;
  let ranCommands: Array<readonly [string, CommandContext | undefined]>;
  let onClose: ReturnType<typeof vi.fn<() => void>>;

  function runCommand(commandId: string, context?: CommandContext): CommandExecutionOutcome {
    ranCommands.push([commandId, context]);
    return "executed";
  }

  function KeymapProvider({ children, keymap }: { children: ReactNode; keymap: KeymapSettings }) {
    const binding = useSecondaryEditorKeymapBinding(keymap, runCommand, true);
    return (
      <SecondaryEditorKeymapContext.Provider value={binding}>
        {children}
      </SecondaryEditorKeymapContext.Provider>
    );
  }

  async function render(keymap: KeymapSettings | null): Promise<void> {
    await act(async () => {
      root.render(
        keymap ? (
          <KeymapProvider keymap={keymap}>{renderHost(onClose)}</KeymapProvider>
        ) : (
          renderHost(onClose)
        ),
      );
      await Promise.resolve();
    });
  }

  function mountedEditor(): FakeDiffEditor {
    const editor = monacoDouble.editors[monacoDouble.editors.length - 1];
    expect(editor, `${hostName} mounted a diff editor`).toBeDefined();
    return editor ?? { actions: [], dispose: () => undefined, goToDiff: vi.fn() };
  }

  function liveAction(label: string): RecordedAction | undefined {
    return mountedEditor().actions.find(
      (action) => !action.disposed && action.descriptor.label === label,
    );
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    monacoDouble.editors = [];
    ranCommands = [];
    onClose = vi.fn<() => void>();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("installs the Codevo keymap bridge on both sides of the diff editor", async () => {
    await render(defaultKeymapSettings("mac"));

    const ids = mountedEditor().actions.map((action) => action.descriptor.id);
    expect(ids.filter((id) => id === "mockor.secondary.editor.rename")).toHaveLength(2);
    expect(ids.some((id) => id.startsWith("mockor.keymap."))).toBe(true);
  });

  it("dispatches bridged shortcuts through the registry without the main document", async () => {
    await render(defaultKeymapSettings("mac"));

    const recentFiles = liveAction("Cmd+E");
    expect(recentFiles).toBeDefined();

    await recentFiles?.descriptor.run({} as Monaco.editor.ICodeEditor);

    expect(ranCommands).toEqual([
      [
        "editor.recentFiles",
        { activeDocumentDirty: false, hasActiveDocument: false, hasWorkspace: true },
      ],
    ]);
  });

  it("disposes every bridge registration on unmount", async () => {
    await render(defaultKeymapSettings("mac"));
    const { actions } = mountedEditor();
    expect(actions.length).toBeGreaterThan(0);

    await act(async () => root.render(null));

    expect(actions.filter((action) => !action.disposed)).toEqual([]);
  });

  it("re-registers the bridge when a shortcut is rebound in settings", async () => {
    await render(defaultKeymapSettings("mac"));
    expect(liveAction("Cmd+E")).toBeDefined();

    await render({ ...defaultKeymapSettings("mac"), "editor.recentFiles": "Cmd+Alt+E" });

    expect(liveAction("Cmd+E")).toBeUndefined();
    expect(liveAction("Cmd+Alt+E")).toBeDefined();
  });

  it("keeps a live bridge through StrictMode effect replays", async () => {
    await act(async () => {
      root.render(
        <StrictMode>
          <KeymapProvider keymap={defaultKeymapSettings("mac")}>
            {renderHost(onClose)}
          </KeymapProvider>
        </StrictMode>,
      );
      await Promise.resolve();
    });

    expect(liveAction("Cmd+E")).toBeDefined();
    expect(
      monacoDouble.editors
        .slice(0, -1)
        .flatMap((editor) => editor.actions)
        .filter((action) => !action.disposed),
    ).toEqual([]);
  });

  it("releases the bridge of a disposed editor and never reinstalls it", async () => {
    await render(defaultKeymapSettings("mac"));
    const editor = mountedEditor();
    const registered = editor.actions.length;

    editor.dispose();
    await render({ ...defaultKeymapSettings("mac"), "editor.recentFiles": "Cmd+Alt+E" });

    expect(editor.actions.filter((action) => !action.disposed)).toEqual([]);
    expect(editor.actions).toHaveLength(registered);
  });

  it("installs nothing outside the Codevo workbench", async () => {
    await render(null);

    expect(mountedEditor().actions).toEqual([]);
  });

  it("keeps main-editor document commands from running anywhere", async () => {
    await render(defaultKeymapSettings("mac"));

    const rename = liveAction("Rename Symbol");
    const definition = liveAction("Go to Definition");
    expect(rename).toBeDefined();
    expect(definition).toBeDefined();

    await rename?.descriptor.run({} as Monaco.editor.ICodeEditor);
    await definition?.descriptor.run({} as Monaco.editor.ICodeEditor);

    expect(ranCommands).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("GitDiffPreview keymap host actions", () => {
  it("closes its own diff tab on the Close Tab shortcut", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    monacoDouble.editors = [];
    const onClose = vi.fn();
    const runCommand = vi.fn<(id: string) => CommandExecutionOutcome>(() => "executed");
    const host = document.createElement("div");
    const root = createRoot(host);

    function Provider({ children }: { children: ReactNode }) {
      const binding = useSecondaryEditorKeymapBinding(
        defaultKeymapSettings("mac"),
        runCommand,
        true,
      );
      return (
        <SecondaryEditorKeymapContext.Provider value={binding}>
          {children}
        </SecondaryEditorKeymapContext.Provider>
      );
    }

    await act(async () => {
      root.render(
        <Provider>
          <GitDiffPreview
            diff={gitDiff}
            isLoading={false}
            monacoTheme="calm-dark"
            onClose={onClose}
          />
        </Provider>,
      );
      await Promise.resolve();
    });
    const closeTab = monacoDouble.editors[monacoDouble.editors.length - 1]?.actions.find(
      (action) => action.descriptor.id === "mockor.secondary.editor.closeTab",
    );
    await closeTab?.descriptor.run({} as Monaco.editor.ICodeEditor);

    expect(closeTab).toBeDefined();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(runCommand).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
