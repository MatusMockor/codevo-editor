import type * as Monaco from "monaco-editor";

export type MonacoApi = typeof Monaco;
export type Disposable = Monaco.IDisposable;
export interface MonacoEventEmitter<T> {
  dispose(): void;
  event: Monaco.IEvent<T>;
  fire(event: T): void;
}

export interface MonacoWorkspaceSymbol {
  readonly containerName?: string;
  readonly kind: Monaco.languages.SymbolKind;
  readonly location: Monaco.languages.Location;
  readonly name: string;
}

export interface MonacoWorkspaceSymbolProvider {
  provideWorkspaceSymbols(query: string): Promise<MonacoWorkspaceSymbol[]>;
}

export interface MonacoWorkspaceSymbolRegistry {
  registerWorkspaceSymbolProvider?(provider: MonacoWorkspaceSymbolProvider): Disposable;
}

export function emptyDisposable(): Disposable {
  return { dispose: () => undefined };
}

export function disposeAll(disposables: readonly Disposable[]): void {
  for (const disposable of disposables) {
    disposable.dispose();
  }
}

export function createMonacoEventEmitter<T>(): MonacoEventEmitter<T> {
  const listeners = new Set<{
    listener: (event: T) => unknown;
    thisArgs?: unknown;
  }>();

  return {
    dispose: () => listeners.clear(),
    event: (listener: (event: T) => unknown, thisArgs?: unknown, disposables?: Disposable[]) => {
      const entry = { listener, thisArgs };
      listeners.add(entry);
      const disposable = {
        dispose: () => {
          listeners.delete(entry);
        },
      };
      disposables?.push(disposable);
      return disposable;
    },
    fire: (event) => {
      for (const entry of Array.from(listeners)) {
        entry.listener.call(entry.thisArgs, event);
      }
    },
  };
}
