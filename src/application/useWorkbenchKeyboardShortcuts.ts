import { useEffect, useMemo, type MutableRefObject } from "react";
import type { KeymapCommandId, KeymapSettings } from "../domain/keymap";
import {
  collectBareKeyShortcutKeys,
  defaultShortcutForCommand,
  detectKeymapPlatform,
  eventCanMatchKeymapShortcut,
  keymapCommands,
  lookupKeymapShortcutSequence,
  shortcutForCommand,
} from "../domain/keymap";
import { KeyChordStateMachine, type KeyChordResetReason } from "../domain/keyChordStateMachine";
import { shortcutStrokeFromKeyboardEvent } from "../domain/shortcutSequence";
import type { DoubleShiftDetector } from "../domain/doubleShiftDetector";
import type { AppSettings } from "../domain/settings";
import {
  type CommandContext,
  type CommandExecutionRunner,
  type CommandRegistry,
} from "./commandRegistry";
import { editorTextFocusOwner } from "./editorTextFocus";
import {
  dispatchResolvedWorkbenchShortcutCommands,
  dispatchWorkbenchShortcutCommand,
} from "./workbenchShortcutCommandDispatcher";

interface BareKeyShortcutCache {
  keymap: KeymapSettings | null;
  keys: ReadonlySet<string>;
}

const GO_TO_DEFINITION_DEFAULT_ALIAS = "F12";
const KEY_CHORD_TIMEOUT_MS = 2_000;
const EDITOR_TEXT_FOCUS_COMMAND_IDS: ReadonlySet<KeymapCommandId> = new Set([
  "editor.action.refactor",
  "testing.debugAtCursor",
  "testing.runAtCursor",
  "testing.runCurrentFile",
]);
const KEYMAP_COMMAND_IDS = keymapCommands.map((command) => command.id);

interface WorkbenchKeyboardShortcutActions {
  closeFloatingSurface: () => boolean;
  openSearchEverywhere: () => unknown;
}

export function useWorkbenchKeyboardShortcutActions(
  closeFloatingSurface: () => boolean,
  openSearchEverywhere: () => unknown,
): WorkbenchKeyboardShortcutActions {
  return useMemo(
    () => ({ closeFloatingSurface, openSearchEverywhere }),
    [closeFloatingSurface, openSearchEverywhere],
  );
}

interface UseWorkbenchKeyboardShortcutsOptions {
  actions: WorkbenchKeyboardShortcutActions;
  appSettingsRef: MutableRefObject<AppSettings>;
  bareKeyShortcutsRef: MutableRefObject<BareKeyShortcutCache>;
  commandContext: CommandContext;
  commandRegistry: CommandRegistry;
  doubleShiftDetectorRef: MutableRefObject<DoubleShiftDetector>;
  editorSurfaceIdentity: object;
  keymap: KeymapSettings;
  runCommand: CommandExecutionRunner;
}

export function useWorkbenchKeyboardShortcuts({
  actions,
  appSettingsRef,
  bareKeyShortcutsRef,
  commandContext,
  commandRegistry,
  doubleShiftDetectorRef,
  editorSurfaceIdentity,
  keymap,
  runCommand,
}: UseWorkbenchKeyboardShortcutsOptions): void {
  useEffect(() => {
    // Both identities are effect fences. Every observed keymap or editor
    // surface transition tears down a pending chord, including A→B→A.
    void editorSurfaceIdentity;
    const keymapPlatform = detectKeymapPlatform();
    let chordEditorOwner: Element | null = null;
    let chordContextEditorOwner: Element | null = null;
    let chordKeymap: KeymapSettings | null = null;
    let chordMachine: KeyChordStateMachine | null = null;
    let chordTimeout: number | null = null;

    function clearChordTimeout() {
      if (chordTimeout === null) return;
      window.clearTimeout(chordTimeout);
      chordTimeout = null;
    }

    function resetChord(reason: KeyChordResetReason) {
      clearChordTimeout();
      chordMachine?.reset(reason);
      chordEditorOwner = null;
    }

    function currentChordMachine(keymap: KeymapSettings, editorOwner: Element | null) {
      chordContextEditorOwner = editorOwner;
      if (chordMachine && chordKeymap === keymap) return chordMachine;
      if (chordMachine) resetChord("keymap-replaced");
      chordKeymap = keymap;
      chordMachine = new KeyChordStateMachine((sequence) => {
        const lookup = lookupKeymapShortcutSequence(
          keymap,
          sequence,
          KEYMAP_COMMAND_IDS,
          keymapPlatform,
        );
        const commandIsInContext = (commandId: KeymapCommandId) =>
          !EDITOR_TEXT_FOCUS_COMMAND_IDS.has(commandId) || chordContextEditorOwner !== null;
        return {
          exact: lookup.exact.filter(commandIsInContext),
          prefix: lookup.prefix.filter(commandIsInContext),
        };
      }, KEY_CHORD_TIMEOUT_MS);
      return chordMachine;
    }

    function dispatchChord(commandIds: readonly string[], event: KeyboardEvent): boolean {
      return dispatchResolvedWorkbenchShortcutCommands({
        commandContext,
        commandIds: commandIds as readonly KeymapCommandId[],
        commandRegistry,
        event,
        runCommand,
      });
    }

    function scheduleChordExpiry(
      machine: KeyChordStateMachine,
      event: KeyboardEvent,
      expiresAt: number,
    ) {
      clearChordTimeout();
      chordTimeout = window.setTimeout(
        () => {
          chordTimeout = null;
          if (appSettingsRef.current.keymap !== chordKeymap) {
            resetChord("keymap-replaced");
            return;
          }
          const now = performance.now();
          const result = machine.expire(now);
          if (result.type === "unmatched" && machine.state.status === "awaitingSecond") {
            scheduleChordExpiry(machine, event, machine.state.expiresAt);
            return;
          }
          chordEditorOwner = null;
          if (result.type === "dispatch") {
            dispatchChord(result.commandIds, event);
          }
        },
        Math.max(0, expiresAt - performance.now()),
      );
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        doubleShiftDetectorRef.current.reset();
        resetChord("escape");

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

      const machine = currentChordMachine(keymap, editorTextFocusOwner(event));
      const wasAwaitingSecond = machine.state.status === "awaitingSecond";
      const editorOwner = editorTextFocusOwner(event);

      if (wasAwaitingSecond && chordEditorOwner && chordEditorOwner !== editorOwner) {
        resetChord("editor-replaced");
        return;
      }

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

      if (!wasAwaitingSecond && !eventCanMatchKeymapShortcut(event, bareKeyCache.keys)) {
        return;
      }

      const stroke = shortcutStrokeFromKeyboardEvent(event);
      if (!editorOwner && stroke) {
        const exactCommands = lookupKeymapShortcutSequence(
          keymap,
          [stroke],
          KEYMAP_COMMAND_IDS,
          keymapPlatform,
        ).exact;
        if (
          exactCommands.length > 0 &&
          exactCommands.every((commandId) => EDITOR_TEXT_FOCUS_COMMAND_IDS.has(commandId))
        ) {
          return;
        }
      }
      if (stroke && (!event.repeat || wasAwaitingSecond)) {
        const chordResult = machine.handleStroke(stroke, performance.now(), {
          repeat: event.repeat,
        });
        if (chordResult.type === "awaitingSecond") {
          chordEditorOwner = editorOwner;
          event.preventDefault();
          scheduleChordExpiry(machine, event, chordResult.expiresAt);
          return;
        }
        if (chordResult.type === "dispatch") {
          clearChordTimeout();
          chordEditorOwner = null;
          dispatchChord(chordResult.commandIds, event);
          return;
        }
        if (wasAwaitingSecond || chordResult.type === "cancelled") {
          clearChordTimeout();
          chordEditorOwner = null;
          event.preventDefault();
          return;
        }
      } else if (wasAwaitingSecond) {
        resetChord("wrong-second-stroke");
        event.preventDefault();
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

    function handleWindowBlur() {
      resetChord("blur");
    }

    function handleFocusIn(event: FocusEvent) {
      if (!chordEditorOwner || chordMachine?.state.status !== "awaitingSecond") return;
      if (event.target instanceof Node && chordEditorOwner.contains(event.target)) return;
      resetChord("editor-replaced");
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("focusin", handleFocusIn, true);
    return () => {
      resetChord("unmount");
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("focusin", handleFocusIn, true);
    };
  }, [
    actions,
    appSettingsRef,
    bareKeyShortcutsRef,
    commandContext,
    commandRegistry,
    doubleShiftDetectorRef,
    editorSurfaceIdentity,
    keymap,
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
