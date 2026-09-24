export interface PaletteProject {
  readonly key: string;
  readonly label: string;
  readonly path: string;
  readonly current: boolean;
}

export interface PaletteThread {
  readonly id: string;
  readonly title: string;
  readonly projectLabel: string;
  readonly updatedAtMs: number;
  readonly current: boolean;
}

export interface PaletteScript {
  readonly key: string;
  readonly name: string;
  readonly detail: string | null;
  readonly runnable: boolean;
}

export interface PaletteModelOption {
  readonly key: string;
  readonly group: string;
  readonly label: string;
  readonly current: boolean;
}

export interface PaletteBranch {
  readonly name: string;
  readonly current: boolean;
  readonly remote: boolean;
}

export interface PaletteBranchSource {
  readonly scopeKey: string;
  readonly scopeLabel: string;
  load(): Promise<readonly PaletteBranch[]>;
  switchTo(branch: PaletteBranch): Promise<void>;
}

export type PaletteBranchesView =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly scopeLabel: string;
      readonly branches: readonly PaletteBranch[];
    }
  | { readonly status: "unavailable"; readonly reason: string }
  | { readonly status: "error"; readonly message: string };

export interface AgentPaletteProvider {
  readonly projects: readonly PaletteProject[];
  readonly threads: readonly PaletteThread[];
  readonly scripts: readonly PaletteScript[];
  readonly scriptsTruncated: boolean;
  readonly activeProjectKey: string | null;
  openThread(threadId: string): boolean;
  switchProject(projectKey: string): boolean;
  newThreadIn(projectKey: string): boolean;
  runScript(scriptKey: string): boolean;
}

export interface ComposerPaletteModels {
  readonly options: readonly PaletteModelOption[];
  selectModel(key: string): boolean;
}

export interface PaletteProviderSlot<T> {
  publish(value: T): () => void;
  current(): T | null;
  subscribe(listener: () => void): () => void;
}

interface SlotEntry<T> {
  readonly value: T;
}

export function createPaletteProviderSlot<T>(): PaletteProviderSlot<T> {
  let entries: readonly SlotEntry<T>[] = [];
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  return {
    publish(value) {
      const entry: SlotEntry<T> = { value };
      entries = [...entries, entry];
      notify();
      return () => {
        if (!entries.includes(entry)) return;
        entries = entries.filter((candidate) => candidate !== entry);
        notify();
      };
    },
    current: () => entries[entries.length - 1]?.value ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const workbenchAgentPaletteProvider = createPaletteProviderSlot<AgentPaletteProvider>();
export const workbenchComposerPaletteModels = createPaletteProviderSlot<ComposerPaletteModels>();
