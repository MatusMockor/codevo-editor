import { useEffect, type MutableRefObject } from "react";
import type { KeymapCommandId, KeymapSettings } from "../domain/keymap";
import {
  collectBareKeyShortcutKeys,
  eventCanMatchKeymapShortcut,
  matchesShortcut,
} from "../domain/keymap";
import type { DoubleShiftDetector } from "../domain/doubleShiftDetector";
import type { AppSettings } from "../domain/settings";
import type { CommandContext, CommandRegistry } from "./commandRegistry";
import { handleWorkbenchManualShortcut } from "./workbenchManualShortcutHandler";
import { dispatchWorkbenchShortcutCommand } from "./workbenchShortcutCommandDispatcher";

const REGISTRY_SHORTCUT_COMMAND_IDS: readonly KeymapCommandId[] = [
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
  "git.stashChanges",
  "git.showStashes",
  "git.switchBranch",
  "git.newBranch",
  "git.commit",
  "bookmark.showPanel",
  "bookmark.next",
  "bookmark.previous",
  "editor.goToSymbol",
  "search.text",
];

interface BareKeyShortcutCache {
  keymap: KeymapSettings | null;
  keys: ReadonlySet<string>;
}

interface WorkbenchKeyboardShortcutActions {
  closeActiveSurface: () => unknown;
  closeFloatingSurface: () => boolean;
  goToDeclaration: () => unknown;
  goToDefinition: () => unknown;
  goToImplementation: () => unknown;
  goToSourceDefinition: () => unknown;
  goToSuperMethod: () => unknown;
  goToTestForActiveDocument: () => unknown;
  goToTypeDefinition: () => unknown;
  openFileHistory: () => unknown;
  openFileReferencesPanel: () => unknown;
  openFileStructure: () => unknown;
  openLocalHistory: () => unknown;
  openReferencesPanel: () => unknown;
  openSearchEverywhere: () => unknown;
  quitApplication: () => unknown;
  runTestForActiveDocument: () => unknown;
  saveActiveDocument: () => unknown;
  toggleBookmarkAtCursor: () => unknown;
  toggleGitBlame: () => unknown;
}

interface UseWorkbenchKeyboardShortcutsOptions {
  actions: WorkbenchKeyboardShortcutActions;
  appSettingsRef: MutableRefObject<AppSettings>;
  bareKeyShortcutsRef: MutableRefObject<BareKeyShortcutCache>;
  commandContext: CommandContext;
  commandRegistry: CommandRegistry;
  doubleShiftDetectorRef: MutableRefObject<DoubleShiftDetector>;
  workspaceRoot: string | null;
}

export function useWorkbenchKeyboardShortcuts({
  actions,
  appSettingsRef,
  bareKeyShortcutsRef,
  commandContext,
  commandRegistry,
  doubleShiftDetectorRef,
  workspaceRoot,
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

      if (event.key === "F12") {
        event.preventDefault();
        void actions.goToDefinition();
        return;
      }

      if (matchesShortcut(event, "Cmd+Q")) {
        event.preventDefault();
        actions.quitApplication();
        return;
      }

      const keymap = appSettingsRef.current.keymap;

      // Keydown hot path: a held bare key (ArrowUp/ArrowDown, plain letters)
      // fires ~30 auto-repeat events/sec and can never match a keymap shortcut,
      // so skip the ~35-iteration matching loop below for such events. The
      // double-Shift detector and the explicit Escape/F12/Cmd+Q handlers above
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

      if (
        handleWorkbenchManualShortcut({
          actions,
          event,
          keymap,
          workspaceRoot,
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
    workspaceRoot,
  ]);
}
