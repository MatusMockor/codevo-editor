export interface DebugSetVariableFocusCapability {
  readonly identity: object;
  isCurrent(): boolean;
  beginEdit(): boolean;
}

export interface DebugSetVariableSafeCommands {
  canBeginEdit(): boolean;
  beginEdit(): boolean;
}

export interface DebugSetVariableCommandBridge {
  readonly commands: DebugSetVariableSafeCommands;
  setFocusedCapability(capability: DebugSetVariableFocusCapability | null): () => void;
}

export function createDebugSetVariableCommandBridge(): DebugSetVariableCommandBridge {
  let current: Readonly<{ capability: DebugSetVariableFocusCapability }> | null = null;
  const commands: DebugSetVariableSafeCommands = Object.freeze({
    canBeginEdit: () => capabilityIsCurrent(current?.capability),
    beginEdit: () => {
      const capability = current?.capability;
      return capabilityIsCurrent(capability) && capability?.beginEdit() === true;
    },
  });
  return Object.freeze({
    commands,
    setFocusedCapability(capability: DebugSetVariableFocusCapability | null) {
      if (!capability) {
        return () => undefined;
      }
      const publication = Object.freeze({ capability });
      current = publication;
      return () => {
        if (current === publication) current = null;
      };
    },
  });
}

function capabilityIsCurrent(capability: DebugSetVariableFocusCapability | undefined): boolean {
  if (!capability) return false;
  try {
    return capability.isCurrent() === true;
  } catch {
    return false;
  }
}

export const unavailableDebugSetVariableCommands: DebugSetVariableSafeCommands = Object.freeze({
  canBeginEdit: () => false,
  beginEdit: () => false,
});
