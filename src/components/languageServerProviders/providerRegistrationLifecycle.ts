import type { LanguageServerRuntimeStatus } from "../../domain/languageServerRuntime";
import type { EditorDocument } from "../../domain/workspace";
import type { Disposable, MonacoApi } from "./providerRegistrationTypes";
import { disposeAll } from "./providerRegistrationTypes";

const activeRegistrationByMonaco = new WeakMap<object, symbol>();

export interface ProviderRegistrationLease extends Disposable {
  readonly isActive: () => boolean;
  readonly rollback: () => void;
}

export interface ProviderRegistrationAuthority {
  readonly isProviderRegistrationActive: () => boolean;
}

export function acquireProviderRegistrationLease(monaco: MonacoApi): ProviderRegistrationLease {
  const owner = Symbol("languageServerMonacoProviderRegistration");
  const previousOwner = activeRegistrationByMonaco.get(monaco);
  activeRegistrationByMonaco.set(monaco, owner);
  let disposed = false;

  return {
    dispose: () => {
      disposed = true;
      if (activeRegistrationByMonaco.get(monaco) === owner) {
        activeRegistrationByMonaco.delete(monaco);
      }
    },
    isActive: () => !disposed && activeRegistrationByMonaco.get(monaco) === owner,
    rollback: () => {
      disposed = true;
      if (activeRegistrationByMonaco.get(monaco) !== owner) {
        return;
      }
      if (previousOwner) {
        activeRegistrationByMonaco.set(monaco, previousOwner);
      } else {
        activeRegistrationByMonaco.delete(monaco);
      }
    },
  };
}

export function scopeProviderRegistrationContext<
  Context extends {
    getActiveDocument(): EditorDocument | null;
    getRuntimeStatus(): LanguageServerRuntimeStatus | null;
    getWorkspaceRoot?(): string | null;
  },
>(context: Context, lease: ProviderRegistrationLease): Context & ProviderRegistrationAuthority {
  const scoped = Object.create(context) as Context & ProviderRegistrationAuthority;
  Object.defineProperties(scoped, {
    getActiveDocument: {
      value: () => (lease.isActive() ? context.getActiveDocument() : null),
    },
    getRuntimeStatus: {
      value: () => (lease.isActive() ? context.getRuntimeStatus() : null),
    },
    getWorkspaceRoot: {
      value: () => (lease.isActive() ? (context.getWorkspaceRoot?.() ?? null) : null),
    },
    isProviderRegistrationActive: {
      value: lease.isActive,
    },
  });
  return scoped;
}

export function registerProviderFacade<
  Context extends {
    getActiveDocument(): EditorDocument | null;
    getRuntimeStatus(): LanguageServerRuntimeStatus | null;
    getWorkspaceRoot?(): string | null;
    reportError(error: unknown): void;
  },
>(
  monaco: MonacoApi,
  context: Context,
  register: (
    scopedContext: Context & ProviderRegistrationAuthority,
    trackForRollback: <Resource extends Disposable>(resource: Resource) => Resource,
  ) => readonly Disposable[],
): Disposable {
  const lease = acquireProviderRegistrationLease(monaco);
  const scopedContext = scopeProviderRegistrationContext(context, lease);
  const rollbackResources: Disposable[] = [];
  const trackForRollback = <Resource extends Disposable>(resource: Resource): Resource => {
    rollbackResources.push(resource);
    return resource;
  };

  try {
    const cleanupResources = register(scopedContext, trackForRollback);
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        lease.dispose();
        disposeAll(cleanupResources, scopedContext.reportError);
      },
    };
  } catch (error) {
    lease.rollback();
    try {
      disposeAll([...rollbackResources].reverse(), scopedContext.reportError);
    } catch {
      // Registration failure remains the primary error after best-effort
      // rollback; reporter failures must not mask it.
    }
    throw error;
  }
}
