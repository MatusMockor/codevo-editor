import { useEffect, type MutableRefObject } from "react";
import type { KeymapCommandId, KeymapSettings } from "../domain/keymap";
import {
  collectBareKeyShortcutKeys,
  detectKeymapPlatform,
  eventCanMatchKeymapShortcut,
  keymapCommands,
  lookupKeymapShortcutSequence,
} from "../domain/keymap";
import { KeyChordStateMachine, type KeyChordResetReason } from "../domain/keyChordStateMachine";
import { shortcutStrokeFromKeyboardEvent } from "../domain/shortcutSequence";
import type { AppSettings } from "../domain/settings";
import {
  type CommandContext,
  type CommandExecutionRunner,
  type CommandRegistry,
} from "./commandRegistry";
import {
  dispatchResolvedWorkbenchShortcutCommands,
  dispatchWorkbenchDefaultAliasCommand,
  dispatchWorkbenchShortcutCommand,
} from "./workbenchShortcutCommandDispatcher";

import {
  dispatchWorkbenchWindowZoomPhysicalShortcut,
  windowZoomShortcutNeedsCapture,
} from "./workbenchWindowZoomShortcutDispatcher";

interface BareKeyShortcutCache {
  keymap: KeymapSettings | null;
  keys: ReadonlySet<string>;
}

const KEY_CHORD_TIMEOUT_MS = 2_000;
const KEYMAP_COMMAND_IDS = keymapCommands.map((command) => command.id);

interface UseWorkbenchKeyboardShortcutsOptions {
  appSettingsRef: MutableRefObject<AppSettings>;
  bareKeyShortcutsRef: MutableRefObject<BareKeyShortcutCache>;
  closeFloatingSurface: () => boolean;
  commandContext: CommandContext;
  commandRegistry: CommandRegistry;
  keymap: KeymapSettings;
  runCommand: CommandExecutionRunner;
}

export function useWorkbenchKeyboardShortcuts({
  appSettingsRef,
  bareKeyShortcutsRef,
  closeFloatingSurface,
  commandContext,
  commandRegistry,
  keymap,
  runCommand,
}: UseWorkbenchKeyboardShortcutsOptions): void {
  useEffect(() => {
    const keymapPlatform = detectKeymapPlatform();
    let chordKeymap: KeymapSettings | null = null;
    let chordMachine: KeyChordStateMachine | null = null;
    let chordTimeout: number | null = null;
    let captureZoomChord = false;

    function clearChordTimeout() {
      if (chordTimeout === null) return;
      window.clearTimeout(chordTimeout);
      chordTimeout = null;
    }

    function resetChord(reason: KeyChordResetReason) {
      clearChordTimeout();
      chordMachine?.reset(reason);
      captureZoomChord = false;
    }

    function currentChordMachine(keymap: KeymapSettings) {
      if (chordMachine && chordKeymap === keymap) return chordMachine;
      if (chordMachine) resetChord("keymap-replaced");
      chordKeymap = keymap;
      chordMachine = new KeyChordStateMachine(
        (sequence) =>
          lookupKeymapShortcutSequence(keymap, sequence, KEYMAP_COMMAND_IDS, keymapPlatform),
        KEY_CHORD_TIMEOUT_MS,
      );
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
          if (result.type === "dispatch") {
            dispatchChord(result.commandIds, event);
          }
        },
        Math.max(0, expiresAt - performance.now()),
      );
    }

    function handleKeyDown(event: KeyboardEvent, captureWindowZoom = false) {
      if (event.isComposing) return;
      if (!captureWindowZoom && handledByModalSurface(event)) return;
      if (event.key === "Escape") {
        resetChord("escape");

        if (closeFloatingSurface()) {
          event.preventDefault();
          event.stopPropagation();
        }

        return;
      }

      const machine = currentChordMachine(keymap);
      const wasAwaitingSecond = machine.state.status === "awaitingSecond";

      // Keydown hot path: a held bare key (ArrowUp/ArrowDown, plain letters)
      // fires ~30 auto-repeat events/sec and can never match a keymap shortcut,
      // so skip configured shortcut matching below for such events. The
      // double-Shift detector and the explicit Escape handler above already
      // ran, so this only short-circuits the per-command matching.
      const bareKeyCache = bareKeyShortcutsRef.current;
      if (bareKeyCache.keymap !== keymap) {
        bareKeyCache.keymap = keymap;
        bareKeyCache.keys = collectBareKeyShortcutKeys(keymap);
      }

      if (!wasAwaitingSecond && !eventCanMatchKeymapShortcut(event, bareKeyCache.keys)) {
        return;
      }

      const stroke = shortcutStrokeFromKeyboardEvent(event);
      if (stroke && (!event.repeat || wasAwaitingSecond)) {
        const chordResult = machine.handleStroke(stroke, performance.now(), {
          repeat: event.repeat,
        });
        if (chordResult.type === "awaitingSecond") {
          event.preventDefault();
          scheduleChordExpiry(machine, event, chordResult.expiresAt);
          return;
        }
        if (chordResult.type === "dispatch") {
          clearChordTimeout();
          dispatchChord(chordResult.commandIds, event);
          return;
        }
        if (wasAwaitingSecond || chordResult.type === "cancelled") {
          clearChordTimeout();
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

      dispatchWorkbenchDefaultAliasCommand({
        commandContext,
        commandRegistry,
        event,
        keymap,
        platform: keymapPlatform,
        runCommand,
      });
    }

    function chordIsAwaitingSecond(): boolean {
      return chordMachine?.state.status === "awaitingSecond";
    }

    function handleZoomKeyDownCapture(event: KeyboardEvent) {
      if (event.isComposing) return;
      if (chordIsAwaitingSecond()) {
        if (!captureZoomChord) return;
        handleKeyDown(event, true);
        if (!chordIsAwaitingSecond()) captureZoomChord = false;
        if (event.defaultPrevented) event.stopImmediatePropagation();
        return;
      }
      captureZoomChord = false;
      if (
        dispatchWorkbenchWindowZoomPhysicalShortcut({
          commandContext,
          commandRegistry,
          event,
          keymap,
          platform: keymapPlatform,
          runCommand,
        })
      )
        return;
      if (!windowZoomShortcutNeedsCapture(keymap, event, keymapPlatform)) return;
      handleKeyDown(event, true);
      captureZoomChord = chordIsAwaitingSecond();
      if (event.defaultPrevented) event.stopImmediatePropagation();
    }

    function handleWindowBlur() {
      resetChord("blur");
    }

    window.addEventListener("keydown", handleZoomKeyDownCapture, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      resetChord("unmount");
      window.removeEventListener("keydown", handleZoomKeyDownCapture, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [
    appSettingsRef,
    bareKeyShortcutsRef,
    closeFloatingSurface,
    commandContext,
    commandRegistry,
    keymap,
    runCommand,
  ]);
}

function handledByModalSurface(event: KeyboardEvent): boolean {
  if (!event.defaultPrevented) return false;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  return target.closest('[role="dialog"][aria-modal="true"]') !== null;
}
