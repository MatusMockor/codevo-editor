import { useEffect, type MutableRefObject } from "react";
import type { KeymapSettings } from "../domain/keymap";
import {
  collectBareKeyShortcutKeys,
  eventCanMatchKeymapShortcut,
} from "../domain/keymap";
import type { DoubleShiftDetector } from "../domain/doubleShiftDetector";
import type { AppSettings } from "../domain/settings";
import {
  type CommandContext,
  type CommandExecutionRunner,
  type CommandRegistry,
} from "./commandRegistry";
import { dispatchWorkbenchShortcutCommand } from "./workbenchShortcutCommandDispatcher";

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
  runCommand: CommandExecutionRunner;
}

export function useWorkbenchKeyboardShortcuts({
  actions,
  appSettingsRef,
  bareKeyShortcutsRef,
  commandContext,
  commandRegistry,
  doubleShiftDetectorRef,
  runCommand,
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
        runCommand("workbench.searchEverywhere", commandContext);
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
        runCommand("editor.goToDefinition", commandContext);
        return;
      }

      const keymap = appSettingsRef.current.keymap;

      // Keydown hot path: a held bare key (ArrowUp/ArrowDown, plain letters)
      // fires ~30 auto-repeat events/sec and can never match a keymap shortcut,
      // so skip configured shortcut matching below for such events. The
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
          commandRegistry,
          event,
          keymap,
          runCommand,
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
    runCommand,
  ]);
}
