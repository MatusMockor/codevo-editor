import type { DebugCopyEvaluatePathTarget } from "./useDebugCopyValueComposition";

export interface DebugCopyValueSafeCommands {
  canCopyEvaluatePath(): boolean;
  canCopyValue(): boolean;
  copyEvaluatePath(): Promise<boolean>;
  copyValue(): Promise<boolean>;
}

interface DebugCopyValueBinding extends DebugCopyValueSafeCommands {
  copyEvaluatePathOnce(target: DebugCopyEvaluatePathTarget): Promise<boolean>;
}

export interface DebugCopyValueCommandBridge {
  readonly commands: DebugCopyValueSafeCommands;
  bind(binding: DebugCopyValueBinding): () => void;
  copyEvaluatePathOnce(target: DebugCopyEvaluatePathTarget): Promise<boolean>;
}

export function createDebugCopyValueCommandBridge(): DebugCopyValueCommandBridge {
  let current: DebugCopyValueBinding | null = null;
  const commands: DebugCopyValueSafeCommands = Object.freeze({
    canCopyEvaluatePath: () => current?.canCopyEvaluatePath() === true,
    canCopyValue: () => current?.canCopyValue() === true,
    copyEvaluatePath: async () => (await current?.copyEvaluatePath()) === true,
    copyValue: async () => (await current?.copyValue()) === true,
  });
  return {
    commands,
    bind(binding) {
      current = binding;
      return () => {
        if (current === binding) current = null;
      };
    },
    async copyEvaluatePathOnce(target) {
      return (await current?.copyEvaluatePathOnce(target)) === true;
    },
  };
}

export const unavailableDebugCopyValueCommands: DebugCopyValueSafeCommands = Object.freeze({
  canCopyEvaluatePath: () => false,
  canCopyValue: () => false,
  copyEvaluatePath: async () => false,
  copyValue: async () => false,
});
