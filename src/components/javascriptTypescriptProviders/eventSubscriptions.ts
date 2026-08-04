import type {
  LanguageServerRefreshEvent,
  LanguageServerRefreshGateway,
  LanguageServerWorkspaceEditEvent,
  LanguageServerWorkspaceEditGateway,
} from "../../domain/languageServerFeatures";

interface ProviderEventSubscriptionDisposable {
  dispose(): void;
}

export interface JavaScriptTypeScriptProviderEventSubscriptionContext {
  readonly refreshGateway?: LanguageServerRefreshGateway;
  readonly workspaceEditGateway?: LanguageServerWorkspaceEditGateway;
  reportError(error: unknown): void;
}

export interface JavaScriptTypeScriptProviderEventSubscriptionHandlers {
  isRegistrationActive(): boolean;
  onRefresh(event: LanguageServerRefreshEvent): void;
  onWorkspaceEdit(event: LanguageServerWorkspaceEditEvent): void;
}

/**
 * Owns the Observer lifecycle for optional language-server event gateways.
 * Late subscription settlement is disposed immediately after provider teardown.
 */
export function subscribeJavaScriptTypeScriptProviderEvents(
  context: JavaScriptTypeScriptProviderEventSubscriptionContext,
  handlers: JavaScriptTypeScriptProviderEventSubscriptionHandlers,
  disposables: ProviderEventSubscriptionDisposable[],
): void {
  if (context.refreshGateway) {
    subscribeProviderEventGateway(
      disposables,
      (listener) => context.refreshGateway!.subscribeRefreshEvents(listener),
      handlers.onRefresh,
      handlers.isRegistrationActive,
      (error) => context.reportError(error),
    );
  }

  if (context.workspaceEditGateway) {
    subscribeProviderEventGateway(
      disposables,
      (listener) => context.workspaceEditGateway!.subscribeWorkspaceEdits(listener),
      handlers.onWorkspaceEdit,
      handlers.isRegistrationActive,
      (error) => context.reportError(error),
    );
  }
}

function subscribeProviderEventGateway<TEvent>(
  disposables: ProviderEventSubscriptionDisposable[],
  subscribe: (listener: (event: TEvent) => void) => Promise<() => void>,
  listener: (event: TEvent) => void,
  isRegistrationActive: () => boolean,
  reportError: (error: unknown) => void,
): void {
  let unsubscribe: (() => void) | null = null;
  let disposed = false;
  disposables.push({
    dispose: () => {
      disposed = true;
      unsubscribe?.();
      unsubscribe = null;
    },
  });

  subscribe(listener)
    .then((settledUnsubscribe) => {
      if (disposed) {
        settledUnsubscribe();
        return;
      }
      unsubscribe = settledUnsubscribe;
    })
    .catch((error) => {
      if (isRegistrationActive()) {
        reportError(error);
      }
    });
}
