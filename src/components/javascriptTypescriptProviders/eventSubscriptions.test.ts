import { describe, expect, it, vi } from "vitest";
import type {
  LanguageServerRefreshEvent,
  LanguageServerWorkspaceEditEvent,
} from "../../domain/languageServerFeatures";
import { subscribeJavaScriptTypeScriptProviderEvents } from "./eventSubscriptions";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

describe("subscribeJavaScriptTypeScriptProviderEvents", () => {
  it("forwards both event families and owns their settled unsubscribe functions", async () => {
    const refreshUnsubscribe = vi.fn();
    const workspaceEditUnsubscribe = vi.fn();
    const onRefresh = vi.fn();
    const onWorkspaceEdit = vi.fn();
    const disposables: Array<{ dispose(): void }> = [];
    const refreshEvent: LanguageServerRefreshEvent = {
      feature: "codeLens",
      rootPath: "/project",
      sessionId: 1,
    };
    const workspaceEditEvent = {
      edit: { changes: {} },
      label: null,
      rootPath: "/project",
      sessionId: 1,
    } satisfies LanguageServerWorkspaceEditEvent;

    subscribeJavaScriptTypeScriptProviderEvents(
      {
        refreshGateway: {
          subscribeRefreshEvents: async (listener) => {
            listener(refreshEvent);
            return refreshUnsubscribe;
          },
        },
        reportError: vi.fn(),
        workspaceEditGateway: {
          subscribeWorkspaceEdits: async (listener) => {
            listener(workspaceEditEvent);
            return workspaceEditUnsubscribe;
          },
        },
      },
      { isRegistrationActive: () => true, onRefresh, onWorkspaceEdit },
      disposables,
    );
    await Promise.resolve();

    expect(onRefresh).toHaveBeenCalledWith(refreshEvent);
    expect(onWorkspaceEdit).toHaveBeenCalledWith(workspaceEditEvent);
    disposables.forEach((disposable) => disposable.dispose());
    expect(refreshUnsubscribe).toHaveBeenCalledOnce();
    expect(workspaceEditUnsubscribe).toHaveBeenCalledOnce();
  });

  it("unsubscribes a subscription that settles after provider disposal", async () => {
    const subscription = deferred<() => void>();
    const unsubscribe = vi.fn();
    const disposables: Array<{ dispose(): void }> = [];
    subscribeJavaScriptTypeScriptProviderEvents(
      {
        refreshGateway: { subscribeRefreshEvents: () => subscription.promise },
        reportError: vi.fn(),
      },
      { isRegistrationActive: () => false, onRefresh: vi.fn(), onWorkspaceEdit: vi.fn() },
      disposables,
    );

    disposables[0]?.dispose();
    subscription.resolve(unsubscribe);
    await Promise.resolve();

    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("reports active subscription failures with the context receiver", async () => {
    const failure = new Error("subscription failed");
    const context = {
      errors: [] as unknown[],
      refreshGateway: { subscribeRefreshEvents: () => Promise.reject(failure) },
      reportError(error: unknown) {
        this.errors.push(error);
      },
    };
    subscribeJavaScriptTypeScriptProviderEvents(
      context,
      { isRegistrationActive: () => true, onRefresh: vi.fn(), onWorkspaceEdit: vi.fn() },
      [],
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(context.errors).toEqual([failure]);
  });

  it("lets synchronous gateway failures reach transactional registration rollback", () => {
    const failure = new Error("synchronous subscribe failure");
    expect(() =>
      subscribeJavaScriptTypeScriptProviderEvents(
        {
          refreshGateway: {
            subscribeRefreshEvents: () => {
              throw failure;
            },
          },
          reportError: vi.fn(),
        },
        { isRegistrationActive: () => true, onRefresh: vi.fn(), onWorkspaceEdit: vi.fn() },
        [],
      ),
    ).toThrow(failure);
  });
});
