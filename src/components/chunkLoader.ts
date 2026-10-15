export interface ChunkLoader<Module> {
  load(): Promise<Module>;
  preload(): void;
}

export function createChunkLoader<Module>(importChunk: () => Promise<Module>): ChunkLoader<Module> {
  let pending: Promise<Module> | null = null;
  const load = (): Promise<Module> => {
    if (pending) return pending;
    const request = importChunk().catch((error: unknown) => {
      if (pending === request) pending = null;
      throw error;
    });
    pending = request;
    return request;
  };
  return {
    load,
    preload: () => {
      void load().catch(() => undefined);
    },
  };
}
