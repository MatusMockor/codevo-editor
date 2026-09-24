import type { PalettePageId } from "../../domain/commandPalette/palettePages";

export interface PaletteLaunchRequest {
  readonly page: PalettePageId;
  readonly query: string;
}

export interface CommandPaletteLaunch {
  request(value: PaletteLaunchRequest): void;
  take(): PaletteLaunchRequest | null;
  subscribe(listener: () => void): () => void;
}

export function createCommandPaletteLaunch(): CommandPaletteLaunch {
  let pending: PaletteLaunchRequest | null = null;
  const listeners = new Set<() => void>();
  return {
    request(value) {
      pending = value;
      for (const listener of [...listeners]) listener();
    },
    take() {
      const value = pending;
      pending = null;
      return value;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const workbenchCommandPaletteLaunch = createCommandPaletteLaunch();
