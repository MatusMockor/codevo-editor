import { useEffect, useRef, useState } from "react";

/**
 * A debounced snapshot of the active document's editable content. `path` is the
 * absolute document path (globally unique per workspace root) and `content` is
 * the full file text at the moment the debounce window settled.
 */
export interface PhpEditTick {
  content: string;
  path: string;
}

/**
 * Coalesces per-keystroke content changes for a single document into ONE
 * debounced tick.
 *
 * The PHP gutter and syntax-diagnostics consumers each used to arm their own
 * independent `setTimeout(160ms)` on every keystroke, so a single edit fired
 * three separate timers that each re-snapshotted the same content and each
 * scheduled a redundant full-file parse on the main thread. This hook arms a
 * SINGLE timer per edit and publishes one shared snapshot once the user pauses,
 * so all consumers parse from the same coalesced snapshot instead of racing
 * three timers.
 *
 * Returns `null` until the first debounce window settles for the given path (or
 * when `path`/`content` is `null`, i.e. no eligible document). A `null` path
 * (e.g. the document is not PHP, or there is no active document) clears any
 * pending timer and resets the tick to `null` synchronously so a consumer never
 * acts on a stale snapshot after the document becomes ineligible.
 *
 * Per-tab isolation: the tick carries the absolute path it was captured for, so
 * a consumer re-checks the live model path before mutating shared state. The
 * hook itself keys purely on `path` + `content`, never on object identity, so a
 * file switch produces a distinct snapshot.
 */
export function useDebouncedPhpEditTick(
  path: string | null,
  content: string | null,
  delayMs = 160,
): PhpEditTick | null {
  const [tick, setTick] = useState<PhpEditTick | null>(null);
  // Hold the latest published tick in a ref so the debounce effect can avoid
  // re-publishing an identical snapshot (same path + content), which would
  // otherwise hand consumers a fresh object identity and re-run their parses
  // even though nothing changed.
  const tickRef = useRef<PhpEditTick | null>(null);

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  useEffect(() => {
    if (path === null || content === null) {
      tickRef.current = null;
      setTick(null);
      return;
    }

    const timeout = window.setTimeout(() => {
      const current = tickRef.current;

      if (current && current.path === path && current.content === content) {
        return;
      }

      const next: PhpEditTick = { content, path };
      tickRef.current = next;
      setTick(next);
    }, delayMs);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [content, delayMs, path]);

  return tick;
}
