import { useEffect, type MutableRefObject } from "react";
import type { KeymapCommandId, KeymapSettings } from "../domain/keymap";
import {
  collectBareKeyShortcutKeys,
  eventCanMatchKeymapShortcut,
} from "../domain/keymap";
import type { DoubleShiftDetector } from "../domain/doubleShiftDetector";
import type { AppSettings } from "../domain/settings";
import type { CommandContext, CommandRegistry } from "./commandRegistry";
import { dispatchWorkbenchShortcutCommand } from "./workbenchShortcutCommandDispatcher";

const REGISTRY_SHORTCUT_COMMAND_IDS: readonly KeymapCommandId[] = [
  "app.quit",
  "editor.save",
  "editor.closeTab",
  "editor.rename",
  "editor.quickFix",
  "editor.formatDocument",
  "editor.formatSelection",
  "editor.gotoLine",
  "workbench.openSettings",
  "workbench.openAppearanceSettings",
  "panel.toggle",
  "panel.toggleTodo",
  "terminal.show",
  "runtime.show",
  "editor.fontZoomIn",
  "editor.fontZoomOut",
  "editor.fontZoomReset",
  "editor.toggleFontLigatures",
  "editor.nextProblem",
  "editor.previousProblem",
  "navigation.back",
  "navigation.forward",
  "workbench.searchEverywhere",
  "commands.show",
  "class.quickOpen",
  "file.quickOpen",
  "editor.recentFiles",
  "editor.recentLocations",
  "markdown.openPreview",
  "git.stashChanges",
  "git.showStashes",
  "git.switchBranch",
  "git.newBranch",
  "git.commit",
  "bookmark.toggle",
  "bookmark.showPanel",
  "bookmark.next",
  "bookmark.previous",
  "editor.toggleGitBlame",
  "editor.showFileHistory",
  "editor.showLocalHistory",
  "editor.fileStructure",
  "editor.goToDefinition",
  "editor.goToSourceDefinition",
  "editor.goToDeclaration",
  "editor.goToTypeDefinition",
  "editor.goToImplementation",
  "editor.goToSuperMethod",
  "editor.findReferences",
  "editor.findFileReferences",
  "editor.goToSymbol",
  "php.goToTest",
  "php.runTest",
  "php.runTestFile",
  "search.text",
];

interface BareKeyShortcutCache {
  keymap: KeymapSettings | null;
  keys: ReadonlySet<string>;
}

interface WorkbenchKeyboardShortcutActions {
  closeFloatingSurface: () => boolean;
  openSearchEverywhere: () => unknown;
}

interface UseWorkbenchKeyboardShortcutsOptions {
  actions: WorkbenchKeyboardShortcutActions;
  appSettingsRef: MutableRefObject<AppSettings>;
  bareKeyShortcutsRef: MutableRefObject<BareKeyShortcutCache>;
  commandContext: CommandContext;
  commandRegistry: CommandRegistry;
  doubleShiftDetectorRef: MutableRefObject<DoubleShiftDetector>;
}

export function useWorkbenchKeyboardShortcuts({
  actions,
  appSettingsRef,
  bareKeyShortcutsRef,
  commandContext,
  commandRegistry,
  doubleShiftDetectorRef,
}: UseWorkbenchKeyboardShortcutsOptions): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        doubleShiftDetectorRef.current.reset();

        if (actions.closeFloatingSurface()) {
          event.preventDefault();
          event.stopPropagation();
        }

        return;
      }

      // PhpStorm double-Shift -> Search Everywhere. The detector consumes every
      // keydown so an intervening key cancels a pending first tap; it returns
      // true only on the qualifying second bare Shift tap inside the window.
      if (doubleShiftDetectorRef.current.handleKeyDown(event, Date.now())) {
        event.preventDefault();
        actions.openSearchEverywhere();
        return;
      }

      if (
        event.key === "F12" &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        event.preventDefault();

        const command = commandRegistry.get("editor.goToDefinition");

        if (command?.isEnabled(commandContext)) {
          void command.run();
        }

        return;
      }

      const keymap = appSettingsRef.current.keymap;

      // Keydown hot path: a held bare key (ArrowUp/ArrowDown, plain letters)
      // fires ~30 auto-repeat events/sec and can never match a keymap shortcut,
      // so skip the ~35-iteration matching loop below for such events. The
      // double-Shift detector and the explicit Escape/F12 handlers above
      // already ran, so this only short-circuits the per-command matching.
      const bareKeyCache = bareKeyShortcutsRef.current;
      if (bareKeyCache.keymap !== keymap) {
        bareKeyCache.keymap = keymap;
        bareKeyCache.keys = collectBareKeyShortcutKeys(keymap);
      }

      if (!eventCanMatchKeymapShortcut(event, bareKeyCache.keys)) {
        return;
      }

      if (
        dispatchWorkbenchShortcutCommand({
          commandContext,
          commandIds: REGISTRY_SHORTCUT_COMMAND_IDS,
          commandRegistry,
          event,
          keymap,
        })
      ) {
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    actions,
    appSettingsRef,
    bareKeyShortcutsRef,
    commandContext,
    commandRegistry,
    doubleShiftDetectorRef,
  ]);
}
