// @vitest-environment jsdom

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import type { CommandExecutionOutcome } from "../../application/commandRegistry";
import { commandActiveForEditorFocus } from "../../application/shortcutFocusScope";
import { FOCUS_SCOPED_COMMAND_IDS } from "../../application/workbenchShortcutCommandDispatcher";
import {
  defaultKeymapSettings,
  keymapCommands,
  parseShortcutSequence,
  shortcutForCommand,
  type KeymapSettings,
  type ShortcutStroke,
} from "../../domain/keymap";
import type { EditorKeymapActionOptions } from "./editorKeymapActions";

vi.mock("@monaco-editor/react", () => ({ loader: { config: () => undefined } }));

type MonacoApi = typeof Monaco;
type RegisterEditorKeymapActions =
  typeof import("./editorKeymapActions").registerEditorKeymapActions;
type InstallDiffEditorKeymapBridge =
  typeof import("../secondaryEditorKeymap/installCodevoEditorKeymapBridge").installDiffEditorKeymapBridge;
type OnDiffEditorDisposed =
  typeof import("../secondaryEditorKeymap/installCodevoEditorKeymapBridge").onDiffEditorDisposed;
type DefaultCommandsForKeybinding =
  typeof import("../../infrastructure/monacoWorkbenchPolicy").monacoDefaultEditorCommandsForKeybinding;

interface ContextKeyServiceProbe {
  contextMatchesRules(rules: unknown): boolean;
}

const LANGUAGE_ID = "codevo-keymap-test";
const KEY_CODES: Readonly<Record<string, number>> = {
  "'": 222,
  ",": 188,
  "-": 189,
  ".": 190,
  "/": 191,
  ";": 186,
  "=": 187,
  "[": 219,
  "\\": 220,
  "]": 221,
  "`": 192,
  arrowdown: 40,
  arrowleft: 37,
  arrowright: 39,
  arrowup: 38,
  backspace: 8,
  delete: 46,
  enter: 13,
  escape: 27,
  space: 32,
  tab: 9,
};

let monaco: MonacoApi;
let registerEditorKeymapActions: RegisterEditorKeymapActions;
let installDiffEditorKeymapBridge: InstallDiffEditorKeymapBridge;
let onDiffEditorDisposed: OnDiffEditorDisposed;
let defaultEditorCommandsForKeybinding: DefaultCommandsForKeybinding;
let menuItems: () => ReadonlyArray<{ command?: { id: string }; when?: unknown }>;
let editor: Monaco.editor.IStandaloneCodeEditor;
let host: HTMLDivElement;
let disposables: Monaco.IDisposable[] = [];
let ranEditorActions: string[] = [];
let ranCommands: string[] = [];
let windowKeys: string[] = [];
let commandOutcome: (commandId: string) => CommandExecutionOutcome = () => "executed";
let openFileStructure = vi.fn();

function installBrowserShims(): void {
  Object.defineProperty(document, "queryCommandSupported", {
    configurable: true,
    value: () => false,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (media: string) => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      dispatchEvent: () => false,
      matches: false,
      media,
      onchange: null,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    }),
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      readText: async () => "",
      write: async () => undefined,
      writeText: async () => undefined,
    },
  });
  Object.defineProperty(globalThis, "ClipboardItem", {
    configurable: true,
    value: class {
      constructor(items: Record<string, unknown>) {
        Object.values(items).forEach((item) => Promise.resolve(item).catch(() => undefined));
      }
    },
  });
  Object.defineProperty(globalThis, "CSS", {
    configurable: true,
    value: { escape: (value: string) => value, supports: () => false },
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      disconnect(): void {}
      observe(): void {}
      unobserve(): void {}
    },
  });
  HTMLCanvasElement.prototype.getContext = (() =>
    new Proxy(
      {},
      {
        get: (_target, property) =>
          property === "measureText" ? () => ({ width: 7 }) : () => undefined,
      },
    )) as unknown as HTMLCanvasElement["getContext"];
}

function keyboardEvent(stroke: ShortcutStroke): KeyboardEvent {
  const keyCode = keyCodeFor(stroke.key);
  const event = new KeyboardEvent("keydown", {
    altKey: stroke.alt,
    bubbles: true,
    cancelable: true,
    ctrlKey: stroke.ctrl,
    key:
      stroke.key.length === 1 ? stroke.key : stroke.value.slice(stroke.value.lastIndexOf("+") + 1),
    metaKey: stroke.meta,
    shiftKey: stroke.shift,
  });
  Object.defineProperty(event, "keyCode", { value: keyCode });
  return event;
}

function keyCodeFor(key: string): number {
  if (/^[a-z]$/.test(key)) return key.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(key)) return key.charCodeAt(0);
  const functionKey = /^f(\d{1,2})$/.exec(key);
  if (functionKey?.[1]) return 111 + Number(functionKey[1]);
  const keyCode = KEY_CODES[key];
  expect(keyCode, `test key code for ${key}`).toBeDefined();
  return keyCode ?? 0;
}

function press(
  shortcut: string,
  target: Element | null = host.querySelector("textarea.inputarea"),
): { readonly reachedWindow: boolean } {
  const sequence = parseShortcutSequence(shortcut);
  expect(sequence, shortcut).not.toBeNull();
  expect(target).not.toBeNull();
  const before = windowKeys.length;
  for (const stroke of sequence ?? []) {
    target?.dispatchEvent(keyboardEvent(stroke));
  }
  return { reachedWindow: windowKeys.length - before === (sequence?.length ?? 0) };
}

function resetChordState(): void {
  press("Escape");
  ranEditorActions = [];
  ranCommands = [];
}

function registerActions(keymap: KeymapSettings): void {
  const options: EditorKeymapActionOptions = {
    activeDocumentRef: { current: null },
    columnSelectionEnabledRef: { current: false },
    commandExecutionRunnerRef: {
      current: (commandId) => {
        ranCommands.push(commandId);
        return commandOutcome(commandId);
      },
    },
    customDefinitionNavigationEnabled: true,
    defaultEditorCommandsForKeybinding,
    editor,
    editorActionCommandPortRef: {
      current: {
        closeActiveTab: vi.fn(),
        goBack: vi.fn(),
        goForward: vi.fn(),
        goToDefinition: vi.fn(),
        goToImplementationAt: vi.fn(),
        goToSuperMethod: vi.fn(),
        openClass: vi.fn(),
        openFile: vi.fn(),
        openFileStructure,
      },
    },
    hippieSessionRef: { current: null },
    keymap,
    keymapPlatform: "mac",
    managedJavaScriptTypeScriptDocumentActive: false,
    monaco,
    requestSurroundWith: vi.fn(),
  };
  disposables.forEach((disposable) => disposable.dispose());
  disposables = [...registerEditorKeymapActions(options)];
}

function recordActionRuns(target: Monaco.editor.IStandaloneCodeEditor): void {
  const addAction = target.addAction.bind(target);
  target.addAction = (descriptor) =>
    addAction({
      ...descriptor,
      run: (...args) => {
        ranEditorActions.push(descriptor.id);
        return descriptor.run(...args);
      },
    });
}

function editorReachableShortcuts(keymap: KeymapSettings) {
  return keymapCommands
    .map((command) => command.id)
    .filter((commandId) => commandActiveForEditorFocus(commandId, true))
    .filter((commandId) => !FOCUS_SCOPED_COMMAND_IDS.has(commandId))
    .map((commandId) => ({ commandId, shortcut: shortcutForCommand(keymap, commandId, "mac") }))
    .filter(({ shortcut }) => {
      const first = parseShortcutSequence(shortcut)?.[0];
      return (
        first !== undefined && (first.meta || first.ctrl || first.alt || /^f\d/.test(first.key))
      );
    });
}

function visibleContextMenuCommandIds(): string[] {
  const contextKeys = (editor as unknown as { _contextKeyService: ContextKeyServiceProbe })
    ._contextKeyService;
  return menuItems()
    .filter((item) => contextKeys.contextMatchesRules(item.when))
    .map((item) => item.command?.id ?? "")
    .filter(Boolean)
    .map((id) => id.replace(`${editor.getId()}:`, ""));
}

describe("editor keymap actions on a real Monaco editor", () => {
  beforeAll(async () => {
    installBrowserShims();
    const environment = await import("../../infrastructure/monacoEnvironment");
    environment.configureMonacoEnvironment({});
    monaco = await import("monaco-editor/esm/vs/editor/editor.api.js");
    ({ registerEditorKeymapActions } = await import("./editorKeymapActions"));
    ({ installDiffEditorKeymapBridge, onDiffEditorDisposed } =
      await import("../secondaryEditorKeymap/installCodevoEditorKeymapBridge"));
    ({ monacoDefaultEditorCommandsForKeybinding: defaultEditorCommandsForKeybinding } =
      await import("../../infrastructure/monacoWorkbenchPolicy"));
    const { MenuId, MenuRegistry } =
      await import("monaco-editor/esm/vs/platform/actions/common/actions.js");
    menuItems = () => MenuRegistry.getMenuItems(MenuId.EditorContext);
    monaco.languages.register({ id: LANGUAGE_ID });
    monaco.languages.setLanguageConfiguration(LANGUAGE_ID, { comments: { lineComment: "//" } });
    monaco.languages.registerDefinitionProvider(LANGUAGE_ID, { provideDefinition: () => null });
    monaco.languages.registerDeclarationProvider(LANGUAGE_ID, { provideDeclaration: () => null });
    monaco.languages.registerTypeDefinitionProvider(LANGUAGE_ID, {
      provideTypeDefinition: () => null,
    });
    monaco.languages.registerImplementationProvider(LANGUAGE_ID, {
      provideImplementation: () => null,
    });
    monaco.languages.registerReferenceProvider(LANGUAGE_ID, { provideReferences: () => null });
    monaco.languages.registerDocumentSymbolProvider(LANGUAGE_ID, {
      provideDocumentSymbols: () => [],
    });
    monaco.languages.registerRenameProvider(LANGUAGE_ID, { provideRenameEdits: () => null });
    monaco.languages.registerDocumentFormattingEditProvider(LANGUAGE_ID, {
      provideDocumentFormattingEdits: () => [],
    });
    monaco.languages.registerCodeActionProvider(
      LANGUAGE_ID,
      { provideCodeActions: () => ({ actions: [], dispose: () => undefined }) },
      { providedCodeActionKinds: ["quickfix", "refactor", "source"] },
    );
  }, 60_000);

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    editor = monaco.editor.create(host, {
      model: monaco.editor.createModel("alpha\nbeta\n", LANGUAGE_ID),
      minimap: { enabled: false },
      occurrencesHighlight: "off",
    });
    recordActionRuns(editor);
    windowKeys = [];
    window.addEventListener("keydown", recordWindowKey);
    commandOutcome = () => "executed";
    openFileStructure = vi.fn();
    registerActions(defaultKeymapSettings("mac"));
    editor.focus();
    resetChordState();
  });

  afterEach(() => {
    window.removeEventListener("keydown", recordWindowKey);
    disposables.forEach((disposable) => disposable.dispose());
    disposables = [];
    const model = editor.getModel();
    editor.dispose();
    model?.dispose();
    host.remove();
  });

  function recordWindowKey(event: KeyboardEvent): void {
    windowKeys.push(event.key);
  }

  it("never lets a Monaco default keybinding shadow an app shortcut reachable in the editor", () => {
    const keymap = defaultKeymapSettings("mac");
    const shadowed: string[] = [];

    for (const { commandId, shortcut } of editorReachableShortcuts(keymap)) {
      resetChordState();
      const { reachedWindow } = press(shortcut);
      const handledByCodevo = ranEditorActions.some((id) => id.startsWith("mockor."));
      if (!reachedWindow && !handledByCodevo) shadowed.push(`${commandId} (${shortcut})`);
    }

    expect(shadowed).toEqual([]);
  });

  it("dispatches the Cmd+K Cmd+\\ split-down chord from inside the editor", () => {
    press("Cmd+K Cmd+\\");

    expect(ranCommands).toEqual(["editor.splitDown"]);
  });

  it.each([
    ["Cmd+E", "editor.recentFiles"],
    ["F8", "editor.nextProblem"],
    ["Shift+F8", "editor.previousProblem"],
    ["Shift+Alt+O", "editor.action.organizeImports"],
    ["Cmd+Shift+O", "agent.goToTurn"],
    ["Cmd+Alt+F", "agent.openFilesSurface"],
    ["Cmd+Enter", "git.commit"],
    ["Cmd+K W", "editor.closeGroup"],
  ])("routes %s to %s through the command registry", (shortcut, commandId) => {
    const { reachedWindow } = press(shortcut);

    expect(reachedWindow || ranCommands.includes(commandId)).toBe(true);
    expect(ranCommands.filter((id) => id !== commandId)).toEqual([]);
  });

  it("re-registers the bridge when a shortcut is rebound in settings", () => {
    registerActions({ ...defaultKeymapSettings("mac"), "editor.splitDown": "Cmd+K Cmd+D" });
    resetChordState();

    press("Cmd+K Cmd+\\");
    expect(ranCommands).toEqual([]);

    resetChordState();
    press("Cmd+K Cmd+D");
    expect(ranCommands).toEqual(["editor.splitDown"]);
  });

  it("keeps Monaco's comment toggle for the outside-editor Cmd+/ shortcut", () => {
    editor.setPosition({ column: 1, lineNumber: 1 });

    press("Cmd+/");

    expect(editor.getModel()?.getLineContent(1)).toBe("// alpha");
    expect(ranCommands).toEqual([]);
  });

  it("falls back to Monaco's default when the Codevo command is disabled", () => {
    commandOutcome = () => "disabled";
    editor.setPosition({ column: 1, lineNumber: 1 });

    press("Cmd+Enter");

    expect(ranCommands).toEqual(["git.commit"]);
    expect(editor.getModel()?.getLineCount()).toBe(4);
  });

  it("owns the key without Monaco's default when the Codevo command runs", () => {
    editor.setPosition({ column: 1, lineNumber: 1 });

    press("Cmd+Enter");

    expect(ranCommands).toEqual(["git.commit"]);
    expect(editor.getModel()?.getLineCount()).toBe(3);
  });

  it("only offers Monaco defaults whose when-clause matches the editor context", () => {
    const cmdEnter = monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter;

    expect(defaultEditorCommandsForKeybinding(cmdEnter, editor)).toContain(
      "editor.action.insertLineAfter",
    );

    editor.updateOptions({ readOnly: true });

    expect(defaultEditorCommandsForKeybinding(cmdEnter, editor)).not.toContain(
      "editor.action.insertLineAfter",
    );
  });

  describe("with the find widget focused", () => {
    async function focusFindInput(): Promise<HTMLElement | null> {
      await editor.getAction("actions.find")?.run();
      const input = host.querySelector<HTMLElement>(".find-widget .find-part .input");
      input?.focus();
      expect(document.activeElement).toBe(input);
      expect(editor.hasTextFocus()).toBe(false);
      ranEditorActions = [];
      ranCommands = [];
      return input;
    }

    it("hands Cmd+Enter to the window instead of committing or editing the document", async () => {
      const input = await focusFindInput();

      const { reachedWindow } = press("Cmd+Enter", input);

      expect(ranCommands).toEqual([]);
      expect(ranEditorActions.filter((id) => id.startsWith("mockor.keymap."))).toEqual([]);
      expect(reachedWindow || ranEditorActions.length === 0).toBe(true);
      expect(editor.getModel()?.getLineCount()).toBe(3);
    });

    it("keeps Cmd+Alt+F toggling Replace instead of opening the Files surface", async () => {
      const input = await focusFindInput();
      const findState = () =>
        editor
          .getContribution<
            Monaco.editor.IEditorContribution & {
              getState(): { readonly isReplaceRevealed: boolean };
            }
          >("editor.contrib.findController")
          ?.getState();
      expect(findState()?.isReplaceRevealed).toBe(false);

      press("Cmd+Alt+F", input);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(ranCommands).toEqual([]);
      expect(findState()?.isReplaceRevealed).toBe(true);
    });
  });

  it("leaves F1 unbound instead of opening Monaco's command palette", () => {
    const { reachedWindow } = press("F1");

    expect(reachedWindow).toBe(true);
    expect(ranEditorActions).toEqual([]);
  });

  describe("Monaco's quick-input pickers", () => {
    function visibleQuickInputWidgets(): Element[] {
      return [...document.querySelectorAll<HTMLElement>(".quick-input-widget")].filter(
        (widget) => widget.style.display !== "none",
      );
    }

    it.each(["Ctrl+G", "Cmd+L"])(
      "routes %s to Codevo's Go to Line palette instead of Monaco's widget",
      async (shortcut) => {
        press(shortcut);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(ranCommands).toEqual(["editor.gotoLine"]);
        expect(visibleQuickInputWidgets()).toEqual([]);
      },
    );

    it("routes a direct Monaco gotoLine trigger to Codevo's Go to Line palette", async () => {
      editor.trigger("mockor.windowChrome", "editor.action.gotoLine", null);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(ranCommands).toEqual(["editor.gotoLine"]);
      expect(visibleQuickInputWidgets()).toEqual([]);
    });

    it("never opens Monaco's Go to Line widget when the Codevo command is unavailable", async () => {
      commandOutcome = () => "missing";

      press("Ctrl+G");
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(ranCommands).toEqual(["editor.gotoLine"]);
      expect(visibleQuickInputWidgets()).toEqual([]);
    });

    it("routes the Cmd+Shift+O fallback to Codevo's file structure instead of Monaco's outline", async () => {
      commandOutcome = (commandId) =>
        commandId === "editor.fileStructure" ? "executed" : "disabled";

      press("Cmd+Shift+O");
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(ranCommands).toEqual(["agent.goToTurn", "editor.fileStructure"]);
      expect(visibleQuickInputWidgets()).toEqual([]);
    });

    it("routes a programmatic Monaco command palette to Codevo's command palette", async () => {
      await editor.getAction("editor.action.quickCommand")?.run();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(ranCommands).toEqual(["palette.open"]);
      expect(visibleQuickInputWidgets()).toEqual([]);
    });

    it("explains an unavailable file structure instead of silently swallowing Cmd+Shift+O", async () => {
      commandOutcome = () => "disabled";

      press("Cmd+Shift+O");
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(ranCommands).toEqual(["agent.goToTurn", "editor.fileStructure"]);
      expect(openFileStructure).toHaveBeenCalledTimes(1);
      expect(visibleQuickInputWidgets()).toEqual([]);
    });

    it("hides Monaco's Go to Symbol context menu entry", () => {
      expect(visibleContextMenuCommandIds()).not.toContain("editor.action.quickOutline");
    });

    it.each(["editor.action.gotoLine", "editor.action.quickCommand"])(
      "keeps Monaco's own %s picker in editors without Codevo actions",
      async (actionId) => {
        const plainHost = document.createElement("div");
        document.body.append(plainHost);
        const plain = monaco.editor.create(plainHost, {
          minimap: { enabled: false },
          model: monaco.editor.createModel("one\ntwo\n", LANGUAGE_ID),
          occurrencesHighlight: "off",
        });
        try {
          plain.focus();
          await plain.getAction(actionId)?.run();
          await new Promise((resolve) => setTimeout(resolve, 0));

          expect(ranCommands).toEqual([]);
          expect(
            [...plainHost.querySelectorAll<HTMLElement>(".quick-input-widget")].filter(
              (widget) => widget.style.display !== "none",
            ),
          ).toHaveLength(1);
        } finally {
          plainHost
            .querySelector(".quick-input-widget input")
            ?.dispatchEvent(
              new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
            );
          await new Promise((resolve) => setTimeout(resolve, 0));
          const model = plain.getModel();
          plain.dispose();
          model?.dispose();
          plainHost.remove();
        }
      },
    );

    it("routes the Go to Symbol context menu entry to Codevo's file structure", async () => {
      await editor.getAction("editor.action.quickOutline")?.run();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(ranCommands).toEqual(["editor.fileStructure"]);
      expect(visibleQuickInputWidgets()).toEqual([]);
    });
  });

  it("builds the context menu from Codevo actions and hides Monaco's bypassing duplicates", () => {
    const visible = visibleContextMenuCommandIds();

    expect(visible).toEqual(
      expect.arrayContaining([
        "mockor.goToDefinition.contextMenu",
        "mockor.goToDeclaration.contextMenu",
        "mockor.goToTypeDefinition.contextMenu",
        "mockor.goToImplementation.contextMenu",
        "mockor.findReferences.contextMenu",
        "mockor.rename.contextMenu",
        "mockor.formatDocument.contextMenu",
        "mockor.refactor.contextMenu",
        "mockor.sourceAction.contextMenu",
        "editor.action.clipboardCutAction",
        "editor.action.clipboardCopyAction",
      ]),
    );
    for (const hidden of [
      "editor.action.revealDefinition",
      "editor.action.revealDeclaration",
      "editor.action.goToTypeDefinition",
      "editor.action.goToImplementation",
      "editor.action.goToReferences",
      "editor.action.rename",
      "editor.action.formatDocument",
      "editor.action.refactor",
      "editor.action.sourceAction",
      "editor.action.quickCommand",
    ]) {
      expect(visible).not.toContain(hidden);
    }
  });

  it("labels Codevo context menu entries with their keymap shortcuts", () => {
    const keybindings = (
      editor as unknown as {
        _standaloneKeybindingService: {
          lookupKeybinding(commandId: string): { getLabel(): string | null } | undefined;
        };
      }
    )._standaloneKeybindingService;
    const label = (actionId: string) =>
      keybindings.lookupKeybinding(`${editor.getId()}:${actionId}`)?.getLabel();

    expect(label("mockor.goToDefinition.contextMenu")).toBe("⌘B");
    expect(label("mockor.rename.contextMenu")).toBe("F2");
    expect(label("mockor.findReferences.contextMenu")).toBe("⇧F12");
  });

  it("runs the Codevo command when a context menu entry is chosen", async () => {
    await editor.getAction("mockor.rename.contextMenu")?.run();
    await editor.getAction("mockor.refactor.contextMenu")?.run();
    await editor.getAction("mockor.sourceAction.contextMenu")?.run();
    await editor.getAction("mockor.findReferences.contextMenu")?.run();

    expect(ranCommands).toEqual([
      "editor.rename",
      "editor.action.refactor",
      "editor.action.sourceAction",
      "editor.findReferences",
    ]);
  });

  it("hides the context menu entries when the language has no provider", () => {
    editor.setModel(monaco.editor.createModel("plain", "plaintext"));

    const visible = visibleContextMenuCommandIds();

    expect(visible).not.toContain("mockor.goToDefinition.contextMenu");
    expect(visible).not.toContain("mockor.rename.contextMenu");
    expect(visible).not.toContain("editor.action.revealDefinition");
  });

  describe("on a read-only diff editor", () => {
    let diffHost: HTMLDivElement;
    let diffEditor: Monaco.editor.IStandaloneDiffEditor;
    let bridge: Monaco.IDisposable | null = null;
    let navigatedChanges: string[] = [];
    let closedSurfaces = 0;

    const hostActions = {
      closeSurface: () => {
        closedSurfaces += 1;
      },
      navigateChange: (target: "next" | "previous") => {
        navigatedChanges.push(target);
      },
    };

    function textareaOf(inner: Monaco.editor.ICodeEditor): Element | null {
      return inner.getDomNode()?.querySelector("textarea.inputarea") ?? null;
    }

    function modifiedTextarea(): Element | null {
      return textareaOf(diffEditor.getModifiedEditor());
    }

    function pressInDiff(shortcut: string, target: Element | null = modifiedTextarea()) {
      return press(shortcut, target);
    }

    function closeDiffQuickInput(): void {
      diffHost
        .querySelector(".quick-input-widget input")
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
        );
    }

    function resetDiffChordState(target: Element | null = modifiedTextarea()): void {
      closeDiffQuickInput();
      const inner = [diffEditor.getOriginalEditor(), diffEditor.getModifiedEditor()].find(
        (candidate) => textareaOf(candidate) === target,
      );
      inner?.focus();
      press("Escape", target);
      ranEditorActions = [];
      ranCommands = [];
    }

    function installBridge(
      keymap: KeymapSettings,
      host: Partial<typeof hostActions> = hostActions,
    ): void {
      bridge?.dispose();
      bridge = installDiffEditorKeymapBridge(diffEditor, {
        commandRunnerRef: {
          current: (commandId) => {
            ranCommands.push(commandId);
            return commandOutcome(commandId);
          },
        },
        defaultEditorCommandsForKeybinding,
        hostRef: { current: host },
        keymap,
        keymapPlatform: "mac",
        monaco,
      });
    }

    function visibleDiffQuickInputWidgets(): Element[] {
      return [...diffHost.querySelectorAll<HTMLElement>(".quick-input-widget")].filter(
        (widget) => widget.style.display !== "none",
      );
    }

    beforeEach(() => {
      diffHost = document.createElement("div");
      document.body.append(diffHost);
      diffEditor = monaco.editor.createDiffEditor(diffHost, {
        minimap: { enabled: false },
        occurrencesHighlight: "off",
        originalEditable: false,
        readOnly: true,
        renderSideBySide: true,
      });
      diffEditor.setModel({
        modified: monaco.editor.createModel("alpha\ngamma\nalpha\n", LANGUAGE_ID),
        original: monaco.editor.createModel("alpha\nbeta\nalpha\n", LANGUAGE_ID),
      });
      recordActionRuns(diffEditor.getOriginalEditor());
      recordActionRuns(diffEditor.getModifiedEditor());
      navigatedChanges = [];
      closedSurfaces = 0;
      installBridge(defaultKeymapSettings("mac"));
      diffEditor.getModifiedEditor().focus();
      resetDiffChordState();
    });

    afterEach(async () => {
      bridge?.dispose();
      bridge = null;
      closeDiffQuickInput();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const models = diffEditor.getModel();
      diffEditor.dispose();
      models?.original.dispose();
      models?.modified.dispose();
      diffHost.remove();
    });

    it.each(["modified", "original"] as const)(
      "never lets a Monaco default shadow an app shortcut in the %s side",
      (side) => {
        const inner =
          side === "modified" ? diffEditor.getModifiedEditor() : diffEditor.getOriginalEditor();
        inner.focus();
        const target = textareaOf(inner);
        const shadowed: string[] = [];

        for (const { commandId, shortcut } of editorReachableShortcuts(
          defaultKeymapSettings("mac"),
        )) {
          resetDiffChordState(target);
          const { reachedWindow } = press(shortcut, target);
          const handledByCodevo = ranEditorActions.some((id) => id.startsWith("mockor."));
          if (!reachedWindow && !handledByCodevo) shadowed.push(`${commandId} (${shortcut})`);
        }

        expect(shadowed).toEqual([]);
      },
    );

    it.each([
      ["Cmd+E", "editor.recentFiles"],
      ["F8", "editor.nextProblem"],
      ["Cmd+Enter", "git.commit"],
      ["Cmd+K W", "editor.closeGroup"],
      ["Cmd+K Cmd+\\", "editor.splitDown"],
      ["Cmd+P", "file.quickOpen"],
      ["Cmd+O", "class.quickOpen"],
      ["Cmd+[", "navigation.back"],
    ])("routes %s to %s through the command registry", (shortcut, commandId) => {
      const { reachedWindow } = pressInDiff(shortcut);

      expect(reachedWindow).toBe(false);
      expect(ranCommands).toEqual([commandId]);
    });

    it.each(["F2", "Cmd+B", "F12", "Shift+F12", "Shift+Alt+F", "Alt+Enter", "Cmd+Alt+B", "Cmd+U"])(
      "keeps the main-editor document command on %s unavailable instead of acting elsewhere",
      (shortcut) => {
        const before = diffEditor.getModifiedEditor().getValue();

        const { reachedWindow } = pressInDiff(shortcut);

        expect(reachedWindow).toBe(false);
        expect(ranCommands).toEqual([]);
        expect(ranEditorActions.every((id) => id.startsWith("mockor.secondary."))).toBe(true);
        expect(ranEditorActions).not.toEqual([]);
        expect(diffEditor.getModifiedEditor().getValue()).toBe(before);
      },
    );

    it("routes Codevo's next and previous change shortcuts to the host diff navigation", () => {
      pressInDiff("Alt+F5");
      pressInDiff("Shift+Alt+F5");

      expect(navigatedChanges).toEqual(["next", "previous"]);
      expect(ranCommands).toEqual([]);
    });

    it("falls back to Monaco's own diff navigation when the host has none", () => {
      installBridge(defaultKeymapSettings("mac"), {});
      const goToDiff = vi.spyOn(diffEditor, "goToDiff");
      resetDiffChordState();

      pressInDiff("Alt+F5");
      pressInDiff("Shift+Alt+F5");

      expect(goToDiff.mock.calls).toEqual([["next"], ["previous"]]);
    });

    it("leaves Monaco's own diff viewer keys to the diff editor", () => {
      pressInDiff("F7");

      expect(ranEditorActions.filter((id) => id.startsWith("mockor."))).toEqual([]);
      expect(ranCommands).toEqual([]);
    });

    it("closes the owning surface on Cmd+W instead of the main editor tab", () => {
      pressInDiff("Cmd+W");

      expect(closedSurfaces).toBe(1);
      expect(ranCommands).toEqual([]);
    });

    it("swallows Cmd+W when the host has no surface to close", () => {
      installBridge(defaultKeymapSettings("mac"), {});
      resetDiffChordState();

      const { reachedWindow } = pressInDiff("Cmd+W");

      expect(reachedWindow).toBe(false);
      expect(ranCommands).toEqual([]);
    });

    it("runs selection shortcuts against the diff editor's own model", () => {
      const modified = diffEditor.getModifiedEditor();
      modified.setSelection(new monaco.Selection(1, 1, 1, 6));

      pressInDiff("Cmd+D");

      expect(modified.getSelections()?.map((selection) => selection.startLineNumber)).toEqual([
        1, 3,
      ]);
      expect(ranCommands).toEqual([]);
    });

    it("keeps Monaco's Go to Line picker for the diff editor", async () => {
      pressInDiff("Cmd+L");
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(ranCommands).toEqual([]);
      expect(visibleDiffQuickInputWidgets()).toHaveLength(1);
    });

    it("re-registers the diff bridge when a shortcut is rebound in settings", () => {
      installBridge({ ...defaultKeymapSettings("mac"), "editor.splitDown": "Cmd+K Cmd+D" });
      resetDiffChordState();

      pressInDiff("Cmd+K Cmd+\\");
      expect(ranCommands).toEqual([]);

      resetDiffChordState();
      pressInDiff("Cmd+K Cmd+D");
      expect(ranCommands).toEqual(["editor.splitDown"]);
    });

    it("reports the diff editor's disposal so a stale bridge is released", async () => {
      const disposedHost = document.createElement("div");
      document.body.append(disposedHost);
      const disposable = monaco.editor.createDiffEditor(disposedHost, {
        minimap: { enabled: false },
        readOnly: true,
      });
      const models = {
        modified: monaco.editor.createModel("b\n", LANGUAGE_ID),
        original: monaco.editor.createModel("a\n", LANGUAGE_ID),
      };
      disposable.setModel(models);
      const released = vi.fn();
      onDiffEditorDisposed(disposable, released);
      await new Promise((resolve) => setTimeout(resolve, 50));

      disposable.dispose();
      models.original.dispose();
      models.modified.dispose();
      disposedHost.remove();

      expect(released).toHaveBeenCalledTimes(1);
    });

    it("hands the keys back to Monaco once the bridge is disposed", () => {
      bridge?.dispose();
      bridge = null;
      resetDiffChordState();

      pressInDiff("Cmd+E");
      pressInDiff("Alt+F5");

      expect(ranCommands).toEqual([]);
      expect(navigatedChanges).toEqual([]);
      expect(ranEditorActions.filter((id) => id.startsWith("mockor."))).toEqual([]);
    });
  });
});
