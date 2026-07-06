export type UnsubscribeLike = () => void | Promise<void>;

export function createSafeUnsubscribe(
  unsubscribe: UnsubscribeLike,
): UnsubscribeLike {
  let disposed = false;

  return () => {
    if (disposed) {
      return;
    }

    disposed = true;

    try {
      const result = unsubscribe();

      if (isPromiseLike(result)) {
        result.catch(ignoreTauriUnlistenRace);
      }
    } catch (error) {
      ignoreTauriUnlistenRace(error);
    }
  };
}

function isPromiseLike(value: unknown): value is Promise<void> {
  return Boolean(
    value &&
      typeof value === "object" &&
      "catch" in value &&
      typeof (value as Promise<void>).catch === "function",
  );
}

function ignoreTauriUnlistenRace(_error: unknown): void {
  // Tauri can reject while tearing down an event listener that was already
  // removed by a concurrent cleanup. The listener is gone either way, so this
  // is not actionable for the user and should not escape as a global toast.
}
