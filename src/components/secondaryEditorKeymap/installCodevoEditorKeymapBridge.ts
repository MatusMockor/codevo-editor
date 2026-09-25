import type * as Monaco from "monaco-editor";
import {
  defaultShortcutForCommand,
  keymapCommandIdsForShortcut,
  keymapCommands,
  shortcutForCommand,
  type KeymapCommandId,
  type KeymapPlatform,
  type KeymapSettings,
} from "../../domain/keymap";
import {
  EDITOR_SURFACE_OWNED_KEYMAP_COMMAND_IDS,
  EDITOR_TEXT_FOCUS,
  registerKeymapCommandBridge,
  type CommandExecutionRunnerRef,
  type DefaultEditorCommandsForKeybinding,
} from "../editorSurfaceCore/editorKeymapCommandBridge";
import { monacoKeybindingsForShortcut } from "../monacoKeybindings";
import {
  secondaryEditorKeymapRoute,
  type EditorChangeNavigationTarget,
  type SecondaryEditorKeymapRoute,
} from "./secondaryEditorKeymapRoutes";

export interface CodevoEditorKeymapHostActions {
  closeSurface?(): void;
  navigateChange?(target: EditorChangeNavigationTarget): void;
}

export interface CodevoEditorKeymapBridgeOptions {
  readonly commandRunnerRef: CommandExecutionRunnerRef;
  readonly defaultEditorCommandsForKeybinding: DefaultEditorCommandsForKeybinding;
  readonly hostRef: { readonly current: CodevoEditorKeymapHostActions };
  readonly keymap: KeymapSettings;
  readonly keymapPlatform: KeymapPlatform;
  readonly monaco: typeof Monaco;
}

const NO_RESERVED_SHORTCUTS: ReadonlySet<string> = new Set();
const DEFINITION_ALIAS_SHORTCUT = "F12";
const COMMAND_LABELS: ReadonlyMap<string, string> = new Map(
  keymapCommands.map((command) => [command.id, command.label]),
);

export function installDiffEditorKeymapBridge(
  diffEditor: Monaco.editor.IStandaloneDiffEditor,
  options: CodevoEditorKeymapBridgeOptions,
): Monaco.IDisposable {
  const hostRef = {
    get current(): CodevoEditorKeymapHostActions {
      const host = options.hostRef.current;
      return {
        closeSurface: host.closeSurface,
        navigateChange: host.navigateChange ?? ((target) => diffEditor.goToDiff(target)),
      };
    },
  };
  const bridges = [diffEditor.getOriginalEditor(), diffEditor.getModifiedEditor()].map((editor) =>
    installCodevoEditorKeymapBridge(editor, { ...options, hostRef }),
  );
  return disposeAll(bridges);
}

export function installCodevoEditorKeymapBridge(
  editor: Monaco.editor.IStandaloneCodeEditor,
  options: CodevoEditorKeymapBridgeOptions,
): Monaco.IDisposable {
  return disposeAll([
    ...registerKeymapCommandBridge({
      ...options,
      editor,
      reservedShortcuts: NO_RESERVED_SHORTCUTS,
    }),
    ...registerSecondaryEditorOwnedCommands(editor, options),
  ]);
}

function registerSecondaryEditorOwnedCommands(
  editor: Monaco.editor.IStandaloneCodeEditor,
  options: CodevoEditorKeymapBridgeOptions,
): readonly Monaco.IDisposable[] {
  const { keymap, keymapPlatform, monaco } = options;

  return [...EDITOR_SURFACE_OWNED_KEYMAP_COMMAND_IDS].flatMap((commandId) => {
    const keybindings = [
      ...monacoKeybindingsForShortcut(
        monaco,
        shortcutForCommand(keymap, commandId, keymapPlatform),
        keymapPlatform,
      ),
      ...definitionAliasKeybindings(commandId, options),
    ];
    if (keybindings.length === 0) return [];
    const route = secondaryEditorKeymapRoute(commandId);

    return [
      editor.addAction({
        id: `mockor.secondary.${commandId}`,
        keybindingContext: EDITOR_TEXT_FOCUS,
        keybindings,
        label: COMMAND_LABELS.get(commandId) ?? commandId,
        run: () => runSecondaryEditorRoute(editor, commandId, route, options),
      }),
    ];
  });
}

function definitionAliasKeybindings(
  commandId: KeymapCommandId,
  { keymap, keymapPlatform, monaco }: CodevoEditorKeymapBridgeOptions,
): readonly number[] {
  if (commandId !== "editor.goToDefinition") return [];
  if (keymapCommandIdsForShortcut(keymap, DEFINITION_ALIAS_SHORTCUT, keymapPlatform).length > 0) {
    return [];
  }
  const definitionShortcut = shortcutForCommand(keymap, commandId, keymapPlatform);
  if (definitionShortcut !== defaultShortcutForCommand(commandId, keymapPlatform)) return [];
  return [monaco.KeyCode.F12];
}

function runSecondaryEditorRoute(
  editor: Monaco.editor.IStandaloneCodeEditor,
  commandId: KeymapCommandId,
  route: SecondaryEditorKeymapRoute,
  { commandRunnerRef, hostRef }: CodevoEditorKeymapBridgeOptions,
): void {
  switch (route.kind) {
    case "editorAction":
      if (editor.getModel()) editor.trigger("keyboard", route.actionId, {});
      return;
    case "workbenchCommand":
      commandRunnerRef.current?.(commandId);
      return;
    case "changeNavigation":
      hostRef.current.navigateChange?.(route.target);
      return;
    case "closeSurface":
      hostRef.current.closeSurface?.();
      return;
    case "unavailable":
      return;
    default: {
      const unreachable: never = route;
      return unreachable;
    }
  }
}

function disposeAll(disposables: readonly Monaco.IDisposable[]): Monaco.IDisposable {
  let disposed = false;
  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      disposables.forEach((disposable) => disposable.dispose());
    },
  };
}

export function onDiffEditorDisposed(
  diffEditor: Monaco.editor.IStandaloneDiffEditor,
  listener: () => void,
): Monaco.IDisposable {
  return diffEditor.getModifiedEditor().onDidDispose(listener);
}
