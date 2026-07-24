export type DebugStartGateResult<T> =
  { readonly kind: "blocked" } | { readonly kind: "completed"; readonly value: T };

export interface DebugStartGate {
  occupied(): boolean;
  run<T>(isBlocked: () => boolean, operation: () => Promise<T>): Promise<DebugStartGateResult<T>>;
}

/**
 * Serializes every application-level debug start from admission through its
 * final async ownership handoff. Presentation checks may call `occupied`, but
 * correctness lives in `run`'s synchronous claim.
 */
export function createDebugStartGate(): DebugStartGate {
  let active = false;

  return Object.freeze({
    occupied: () => active,
    run: async <T>(
      isBlocked: () => boolean,
      operation: () => Promise<T>,
    ): Promise<DebugStartGateResult<T>> => {
      if (active || safelyBlocked(isBlocked)) {
        return Object.freeze({ kind: "blocked" });
      }
      active = true;
      try {
        return Object.freeze({
          kind: "completed",
          value: await operation(),
        });
      } finally {
        active = false;
      }
    },
  });
}

function safelyBlocked(isBlocked: () => boolean): boolean {
  try {
    return isBlocked() !== false;
  } catch {
    return true;
  }
}
