export interface DebugAddToWatchFocusCapability {
  readonly identity: object;
  isCurrent(): boolean;
  canAddToWatch(): boolean;
  addToWatch(): boolean;
}

export interface DebugAddToWatchSafeCommands {
  canAddToWatch(): boolean;
  addToWatch(): boolean;
}

export interface DebugAddToWatchCommandBridge {
  readonly commands: DebugAddToWatchSafeCommands;
  setFocusedCapability(capability: DebugAddToWatchFocusCapability | null): () => void;
}

export function createDebugAddToWatchCommandBridge(): DebugAddToWatchCommandBridge {
  let current: Readonly<{ capability: DebugAddToWatchFocusCapability }> | null = null;
  let adding = false;
  const commands: DebugAddToWatchSafeCommands = Object.freeze({
    canAddToWatch: () => !adding && capabilityCanAdd(current?.capability),
    addToWatch: () => {
      if (adding) return false;
      const publication = current;
      const capability = publication?.capability;
      if (!capabilityIsCurrent(capability)) return false;

      // A command consumes the exact publication before calling application code.
      // Reentrant dispatch and A -> B -> A row replacement therefore fail closed.
      if (current === publication) current = null;
      adding = true;
      try {
        if (capability?.canAddToWatch() !== true || !capabilityIsCurrent(capability)) return false;
        return capability.addToWatch() === true;
      } catch {
        return false;
      } finally {
        adding = false;
      }
    },
  });
  return Object.freeze({
    commands,
    setFocusedCapability(capability: DebugAddToWatchFocusCapability | null) {
      if (!capability) return () => undefined;
      const publication = Object.freeze({ capability });
      current = publication;
      return () => {
        if (current === publication) current = null;
      };
    },
  });
}

function capabilityIsCurrent(
  capability: DebugAddToWatchFocusCapability | undefined,
): capability is DebugAddToWatchFocusCapability {
  if (!capability) return false;
  try {
    return capability.isCurrent() === true;
  } catch {
    return false;
  }
}

function capabilityCanAdd(capability: DebugAddToWatchFocusCapability | undefined): boolean {
  if (!capabilityIsCurrent(capability)) return false;
  try {
    return capability.canAddToWatch() === true;
  } catch {
    return false;
  }
}

export const unavailableDebugAddToWatchCommands: DebugAddToWatchSafeCommands = Object.freeze({
  canAddToWatch: () => false,
  addToWatch: () => false,
});
