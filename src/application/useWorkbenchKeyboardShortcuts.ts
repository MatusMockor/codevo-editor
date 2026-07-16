import { useEffect, type MutableRefObject } from "react";
import type { KeymapSettings } from "../domain/keymap";
import {
  collectBareKeyShortcutKeys,
  defaultShortcutForCommand,
  eventCanMatchKeymapShortcut,
  shortcutForCommand,
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

const GO_TO_DEFINITION_DEFAULT_ALIAS = "F12";

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

      const keymap = appSettingsRef.current.keymap;

      // Keydown hot path: a held bare key (ArrowUp/ArrowDown, plain letters)
      // fires ~30 auto-repeat events/sec and can never match a keymap shortcut,
      // so skip configured shortcut matching below for such events. The
      // double-Shift detector and the explicit Escape handler above already
      // ran, so this only short-circuits the per-command matching.
      const bareKeyCache = bareKeyShortcutsRef.current;
      if (bareKeyCache.keymap !== keymap) {
        bareKeyCache.keymap = keymap;
        const bareKeys = new Set(collectBareKeyShortcutKeys(keymap));

        if (definitionUsesDefaultShortcut(keymap)) {
          bareKeys.add(GO_TO_DEFINITION_DEFAULT_ALIAS.toLowerCase());
        }

        bareKeyCache.keys = bareKeys;
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

      dispatchDefaultGoToDefinitionAlias({
        commandContext,
        commandRegistry,
        event,
        keymap,
        runCommand,
      });
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

function definitionUsesDefaultShortcut(keymap: KeymapSettings): boolean {
  return (
    shortcutForCommand(keymap, "editor.goToDefinition") ===
    defaultShortcutForCommand("editor.goToDefinition")
  );
}

function dispatchDefaultGoToDefinitionAlias({
  commandContext,
  commandRegistry,
  event,
  keymap,
  runCommand,
}: {
  commandContext: CommandContext;
  commandRegistry: CommandRegistry;
  event: KeyboardEvent;
  keymap: KeymapSettings;
  runCommand: CommandExecutionRunner;
}): boolean {
  if (!definitionUsesDefaultShortcut(keymap)) {
    return false;
  }

  return dispatchWorkbenchShortcutCommand({
    commandContext,
    commandIds: ["editor.goToDefinition"],
    commandRegistry,
    event,
    keymap: {
      ...keymap,
      "editor.goToDefinition": GO_TO_DEFINITION_DEFAULT_ALIAS,
    },
    runCommand,
  });
}
