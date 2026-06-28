/**
 * PhpStorm-style "double Shift" trigger. A bare Shift tap followed by a second
 * bare Shift tap within `windowMs` fires the action. The detector is a pure,
 * timing-injectable unit (the caller passes `now`) so it is deterministic in
 * tests and free of any global state. It is deliberately strict about what
 * counts as a "bare" Shift tap so it never collides with Shift used as a
 * modifier (Shift+letter, Cmd+Shift+..., auto-repeat while a key is held).
 */
export interface DoubleShiftDetectorOptions {
  windowMs: number;
}

export interface DoubleShiftDetector {
  /**
   * Feeds a keydown into the detector. Returns true exactly once, on the second
   * qualifying Shift tap inside the window.
   */
  handleKeyDown(event: KeyboardEventLike, now: number): boolean;
  reset(): void;
}

interface KeyboardEventLike {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
}

function isBareShiftTap(event: KeyboardEventLike): boolean {
  return (
    event.key === "Shift" &&
    event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.repeat
  );
}

export function createDoubleShiftDetector(
  options: DoubleShiftDetectorOptions,
): DoubleShiftDetector {
  let lastShiftAt: number | null = null;

  const reset = () => {
    lastShiftAt = null;
  };

  return {
    reset,
    handleKeyDown(event, now) {
      if (!isBareShiftTap(event)) {
        // Any non-Shift key (or Shift used as a modifier) breaks the sequence.
        reset();
        return false;
      }

      if (lastShiftAt !== null && now - lastShiftAt <= options.windowMs) {
        reset();
        return true;
      }

      lastShiftAt = now;
      return false;
    },
  };
}
