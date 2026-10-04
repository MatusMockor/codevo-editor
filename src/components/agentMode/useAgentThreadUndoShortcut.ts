import { useEffect, useRef, type RefObject } from "react";
import { detectKeymapPlatform, type KeymapPlatform } from "../../domain/keymap";
import { useLatest } from "../../ui/foundation/useLatest";

export interface AgentThreadUndoShortcutScope {
  readonly surface: HTMLElement;
  readonly platform: KeymapPlatform;
  readonly ownsLastInteraction: boolean;
}

const OWN_UNDO_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="dialog"]',
  ".agent-popover",
  ".monaco-editor",
  ".xterm",
].join(", ");

const OPEN_MODAL_SELECTOR = '[aria-modal="true"], dialog[open]';

const TRANSIENT_OVERLAY_SELECTOR = [
  '[role="menu"]',
  '[role="menubar"]',
  '[role="dialog"]',
  ".agent-popover",
].join(", ");

export function agentThreadUndoInteractionOwned(
  target: EventTarget | null,
  surface: HTMLElement | null,
  previous: boolean,
): boolean {
  if (surface === null) return false;
  if (!(target instanceof Element)) return previous;
  if (surface.contains(target)) return true;
  if (target.closest(TRANSIENT_OVERLAY_SELECTOR) !== null) return previous;
  return false;
}

export function agentThreadUndoShortcutApplies(
  event: KeyboardEvent,
  scope: AgentThreadUndoShortcutScope,
): boolean {
  if (event.defaultPrevented) return false;
  if (event.isComposing || event.keyCode === 229) return false;
  if (event.key !== "z" && event.key !== "Z") return false;
  if (event.shiftKey || event.altKey) return false;
  if (!primaryModifierOnly(event, scope.platform)) return false;
  if (!surfaceIsInteractive(scope.surface)) return false;
  const document = scope.surface.ownerDocument;
  if (document.querySelector(OPEN_MODAL_SELECTOR) !== null) return false;
  if (!focusYieldsUndo(event.target, scope)) return false;
  return focusYieldsUndo(document.activeElement, scope);
}

export function useAgentThreadUndoShortcut(
  surfaceRef: RefObject<HTMLElement | null>,
  onUndo: (() => void) | null,
  platform: KeymapPlatform = detectKeymapPlatform(),
): void {
  const onUndoRef = useLatest(onUndo);
  const ownsLastInteractionRef = useRef(false);
  const enabled = onUndo !== null;

  useEffect(() => {
    const recordLastInteraction = (event: Event): void => {
      ownsLastInteractionRef.current = agentThreadUndoInteractionOwned(
        event.target,
        surfaceRef.current,
        ownsLastInteractionRef.current,
      );
    };
    document.addEventListener("pointerdown", recordLastInteraction, true);
    document.addEventListener("focusin", recordLastInteraction, true);
    return () => {
      document.removeEventListener("pointerdown", recordLastInteraction, true);
      document.removeEventListener("focusin", recordLastInteraction, true);
    };
  }, [surfaceRef]);

  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      const surface = surfaceRef.current;
      if (surface === null) return;
      const scope = { surface, platform, ownsLastInteraction: ownsLastInteractionRef.current };
      if (!agentThreadUndoShortcutApplies(event, scope)) return;
      const undo = onUndoRef.current;
      if (undo === null) return;
      event.preventDefault();
      if (event.repeat) return;
      undo();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, onUndoRef, platform, surfaceRef]);
}

function primaryModifierOnly(event: KeyboardEvent, platform: KeymapPlatform): boolean {
  if (platform === "mac") return event.metaKey && !event.ctrlKey;
  return event.ctrlKey && !event.metaKey;
}

function surfaceIsInteractive(surface: HTMLElement): boolean {
  if (!surface.isConnected) return false;
  if (surface.closest("[inert], [hidden]") !== null) return false;
  if (typeof surface.checkVisibility !== "function") return true;
  return surface.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true });
}

function focusYieldsUndo(target: EventTarget | null, scope: AgentThreadUndoShortcutScope): boolean {
  const surface = scope.surface;
  const document = surface.ownerDocument;
  if (target === null || target === document || target === document.defaultView) {
    return scope.ownsLastInteraction;
  }
  if (target === document.body || target === document.documentElement) {
    return scope.ownsLastInteraction;
  }
  if (!(target instanceof Element)) return false;
  if (target.closest(OWN_UNDO_SELECTOR) !== null) return false;
  return surface.contains(target);
}
