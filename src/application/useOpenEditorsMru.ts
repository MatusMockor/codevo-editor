import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export interface OpenEditorMruEntry {
  readonly name: string;
  readonly path: string;
}

interface OpenEditorMruSession {
  readonly activeIndex: number;
  readonly entries: readonly OpenEditorMruEntry[];
  readonly returnFocus: HTMLElement | null;
}

interface UseOpenEditorsMruOptions {
  readonly activePath: string | null;
  readonly entries: readonly OpenEditorMruEntry[];
  readonly groupId: string;
  readonly onActivate: (path: string) => void;
  readonly projectId: string;
  readonly stripRef: RefObject<HTMLElement | null>;
}

const MAX_RETAINED_SCOPES = 64;
const retainedOrderByScope = new Map<string, string[]>();

export function __resetOpenEditorsMruForTests(): void {
  retainedOrderByScope.clear();
}

export function useOpenEditorsMru({
  activePath,
  entries,
  groupId,
  onActivate,
  projectId,
  stripRef,
}: UseOpenEditorsMruOptions) {
  const scope = JSON.stringify([projectId, groupId]);
  const entriesKey = JSON.stringify(entries.map((entry) => [entry.path, entry.name]));
  const activePathRef = useRef(activePath);
  const entriesRef = useRef(entries);
  const onActivateRef = useRef(onActivate);
  const orderRef = useRef<string[]>([]);
  const committedPathRef = useRef<string | null>(null);
  const dismissedUntilControlReleaseRef = useRef(false);
  const sessionRef = useRef<OpenEditorMruSession | null>(null);
  const [session, setSessionState] = useState<OpenEditorMruSession | null>(null);

  activePathRef.current = activePath;
  entriesRef.current = entries;
  onActivateRef.current = onActivate;

  const setSession = useCallback((next: OpenEditorMruSession | null) => {
    sessionRef.current = next;
    setSessionState(next);
  }, []);

  const commitEntry = useCallback(
    (entry: OpenEditorMruEntry | undefined) => {
      const currentSession = sessionRef.current;
      if (!entry || !currentSession) {
        return;
      }
      if (!isActiveGroup(stripRef.current)) {
        committedPathRef.current = null;
        setSession(null);
        focusActiveEditorSurface(stripRef.current);
        return;
      }
      const nextOrder = promotePath(orderRef.current, entry.path);
      orderRef.current = nextOrder;
      retainScope(scope, nextOrder);
      committedPathRef.current = entry.path;
      setSession(null);
      onActivateRef.current(entry.path);
      if (entry.path === activePathRef.current) {
        committedPathRef.current = null;
        focusEditorSurface(stripRef.current);
      }
    },
    [scope, setSession, stripRef],
  );

  useLayoutEffect(() => {
    const currentEntries = entriesRef.current;
    const paths = currentEntries.map((entry) => entry.path);
    const retained = retainedOrderByScope.get(scope) ?? [];
    const nextOrder = reconcileOpenOrder(retained, paths, activePath);
    orderRef.current = nextOrder;
    retainScope(scope, nextOrder);
    setSessionState((current) => {
      if (!current) {
        sessionRef.current = null;
        return null;
      }
      const nextEntries = orderEntries(nextOrder, currentEntries);
      if (nextEntries.length === 0) {
        sessionRef.current = null;
        return null;
      }
      const selectedPath = current.entries[current.activeIndex]?.path;
      const selectedIndex = Math.max(
        nextEntries.findIndex((entry) => entry.path === selectedPath),
        0,
      );
      const next = {
        ...current,
        activeIndex: selectedIndex,
        entries: nextEntries,
      };
      sessionRef.current = next;
      return next;
    });
  }, [activePath, entriesKey, scope]);

  useLayoutEffect(() => {
    if (committedPathRef.current !== activePath) {
      return;
    }
    committedPathRef.current = null;
    focusEditorSurface(stripRef.current);
  }, [activePath, stripRef]);

  useEffect(() => {
    const stripElement = stripRef.current;
    const discardInactiveSession = () => {
      if (!sessionRef.current || isActiveGroup(stripRef.current)) {
        return false;
      }
      committedPathRef.current = null;
      setSession(null);
      focusActiveEditorSurface(stripRef.current);
      return true;
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      discardInactiveSession();
      const currentSession = sessionRef.current;
      if (event.key === "Escape" && currentSession) {
        event.preventDefault();
        event.stopImmediatePropagation();
        dismissedUntilControlReleaseRef.current = true;
        setSession(null);
        restoreFocus(currentSession.returnFocus);
        return;
      }
      if (
        event.key !== "Tab" ||
        !event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        dismissedUntilControlReleaseRef.current ||
        isInsideModal(event.target) ||
        !isActiveGroup(stripRef.current)
      ) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      if (currentSession) {
        const direction = event.shiftKey ? -1 : 1;
        const activeIndex =
          (currentSession.activeIndex + direction + currentSession.entries.length) %
          currentSession.entries.length;
        setSession({ ...currentSession, activeIndex });
        return;
      }

      const orderedEntries = orderEntries(orderRef.current, entriesRef.current);
      if (orderedEntries.length < 2) {
        return;
      }
      const activeIndex = event.shiftKey ? orderedEntries.length - 1 : 1;
      setSession({
        activeIndex,
        entries: orderedEntries,
        returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      });
    };

    const handleKeyUp = (event: globalThis.KeyboardEvent) => {
      const currentSession = sessionRef.current;
      if (event.key !== "Control") {
        return;
      }
      dismissedUntilControlReleaseRef.current = false;
      if (!currentSession) {
        return;
      }
      if (discardInactiveSession()) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      commitEntry(currentSession.entries[currentSession.activeIndex]);
    };

    const handleBlur = () => {
      const currentSession = sessionRef.current;
      if (!currentSession) {
        return;
      }
      setSession(null);
      dismissedUntilControlReleaseRef.current = false;
      if (isActiveGroup(stripRef.current)) {
        restoreFocus(currentSession.returnFocus);
      } else {
        committedPathRef.current = null;
        focusActiveEditorSurface(stripRef.current);
      }
    };

    const group = stripElement?.closest(".editor-group");
    const activeGroupObserver = group
      ? new MutationObserver(() => {
          discardInactiveSession();
        })
      : null;
    activeGroupObserver?.observe(group!, {
      attributeFilter: ["class"],
      attributes: true,
    });
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      activeGroupObserver?.disconnect();
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      const currentSession = sessionRef.current;
      if (currentSession && isActiveGroup(stripElement)) {
        restoreFocus(currentSession.returnFocus);
      } else if (currentSession) {
        committedPathRef.current = null;
        focusActiveEditorSurface(stripElement);
      }
      setSession(null);
    };
  }, [commitEntry, scope, setSession, stripRef]);

  const cancel = () => {
    const currentSession = sessionRef.current;
    if (!currentSession) {
      return;
    }
    setSession(null);
    if (!isActiveGroup(stripRef.current)) {
      committedPathRef.current = null;
      focusActiveEditorSurface(stripRef.current);
      return;
    }
    restoreFocus(currentSession.returnFocus);
  };

  const select = (path: string) => {
    const currentSession = sessionRef.current;
    const entry = currentSession?.entries.find((candidate) => candidate.path === path);
    if (!entry) {
      return;
    }
    commitEntry(entry);
  };

  return {
    activeIndex: session?.activeIndex ?? 0,
    cancel,
    entries: session?.entries ?? [],
    isOpen: session !== null,
    select,
  };
}

function reconcileOpenOrder(
  retained: readonly string[],
  openPaths: readonly string[],
  activePath: string | null,
): string[] {
  const openSet = new Set(openPaths);
  const retainedOpen = retained.filter((path) => openSet.has(path));
  const retainedSet = new Set(retainedOpen);
  const synchronized = [...retainedOpen, ...openPaths.filter((path) => !retainedSet.has(path))];
  if (!activePath || !openSet.has(activePath)) {
    return synchronized;
  }
  return promotePath(synchronized, activePath);
}

function promotePath(order: readonly string[], path: string): string[] {
  return [path, ...order.filter((candidate) => candidate !== path)];
}

function orderEntries(
  order: readonly string[],
  entries: readonly OpenEditorMruEntry[],
): OpenEditorMruEntry[] {
  const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));
  return order.flatMap((path) => {
    const entry = entriesByPath.get(path);
    return entry ? [entry] : [];
  });
}

function retainScope(scope: string, order: string[]) {
  retainedOrderByScope.delete(scope);
  retainedOrderByScope.set(scope, order);
  while (retainedOrderByScope.size > MAX_RETAINED_SCOPES) {
    const oldestScope = retainedOrderByScope.keys().next().value;
    if (typeof oldestScope !== "string") {
      return;
    }
    retainedOrderByScope.delete(oldestScope);
  }
}

function isActiveGroup(strip: HTMLElement | null): boolean {
  const group = strip?.closest(".editor-group");
  if (!group) {
    return false;
  }
  return group.classList.contains("active");
}

function isInsideModal(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return (
    target.closest(
      [
        '[role="dialog"][aria-modal="true"]',
        '[aria-label="Command palette"]',
        '[aria-label="Quick open"]',
        '[aria-label="Go to symbol in workspace"]',
        '[aria-label="File structure"]',
      ].join(","),
    ) !== null
  );
}

function focusEditorSurface(strip: HTMLElement | null) {
  const group = strip?.closest(".editor-group");
  focusGroupEditorSurface(group);
}

function focusActiveEditorSurface(strip: HTMLElement | null) {
  const editorArea = strip?.closest(".editor-area");
  const group =
    editorArea?.querySelector(".editor-group.active") ??
    strip?.ownerDocument.querySelector(".editor-group.active");
  focusGroupEditorSurface(group);
}

function focusGroupEditorSurface(group: Element | null | undefined) {
  const panel = group?.querySelector<HTMLElement>(".editor-panel");
  if (!panel) {
    return;
  }
  const textInput = panel.querySelector<HTMLElement>(
    "textarea.inputarea, [contenteditable='true'].inputarea",
  );
  if (textInput) {
    textInput.focus();
    return;
  }
  panel.tabIndex = -1;
  panel.focus();
}

function restoreFocus(element: HTMLElement | null) {
  if (!element?.isConnected) {
    return;
  }
  element.focus();
}
