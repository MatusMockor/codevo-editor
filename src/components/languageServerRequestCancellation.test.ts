import { describe, expect, it, vi } from "vitest";
import {
  FEATURE_REQUEST_CANCELLED,
  FEATURE_REQUEST_TIMED_OUT,
  runBoundedLanguageServerRequest,
} from "./languageServerRequestCancellation";

describe("language server request cancellation", () => {
  it("settles immediately and cancels exactly once when token cancellation precedes the deadline", async () => {
    vi.useFakeTimers();
    const pending = deferred<string>();
    const cancel = vi.fn(async () => undefined);
    const token = cancellationToken();
    const request = runBoundedLanguageServerRequest(
      Object.assign(pending.promise, { requestId: 73, sessionId: 9 }),
      token,
      "/workspace",
      100,
      cancel,
    );

    token.fire();
    token.fire();

    expect(request.requestId).toBe(73);
    await expect(request).resolves.toBe(FEATURE_REQUEST_CANCELLED);
    expect(cancel).toHaveBeenCalledExactlyOnceWith("/workspace", 9, 73);
    expect(token.hasListener()).toBe(false);
    vi.useRealTimers();
  });

  it("cancels once when the deadline wins and ignores a later token event", async () => {
    vi.useFakeTimers();
    const pending = deferred<string>();
    const cancel = vi.fn(async () => undefined);
    const token = cancellationToken();
    const request = runBoundedLanguageServerRequest(
      Object.assign(pending.promise, { requestId: 74, sessionId: 9 }),
      token,
      "/workspace",
      100,
      cancel,
    );

    await vi.advanceTimersByTimeAsync(100);
    await expect(request).resolves.toBe(FEATURE_REQUEST_TIMED_OUT);
    token.fire();

    expect(cancel).toHaveBeenCalledExactlyOnceWith("/workspace", 9, 74);
    vi.useRealTimers();
  });

  it("keeps a late settlement isolated after the deadline", async () => {
    vi.useFakeTimers();
    const pending = deferred<string>();
    const cancel = vi.fn(async () => undefined);
    const request = runBoundedLanguageServerRequest(
      Object.assign(pending.promise, { requestId: 75, sessionId: 9 }),
      undefined,
      "/workspace",
      100,
      cancel,
    );

    await vi.advanceTimersByTimeAsync(100);
    await expect(request).resolves.toBe(FEATURE_REQUEST_TIMED_OUT);
    pending.resolve("late");
    await Promise.resolve();

    expect(cancel).toHaveBeenCalledExactlyOnceWith("/workspace", 9, 75);
    await expect(request).resolves.toBe(FEATURE_REQUEST_TIMED_OUT);
    vi.useRealTimers();
  });

  it("cleans up subscriptions across a thousand cancelled never-settling requests", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(async () => undefined);
    const tokens = Array.from({ length: 1_000 }, () => cancellationToken());
    const requests = tokens.map((token, index) =>
      runBoundedLanguageServerRequest(
        Object.assign(new Promise<string>(() => undefined), {
          requestId: index + 1,
          sessionId: 9,
        }),
        token,
        "/workspace",
        100,
        cancel,
      ),
    );

    tokens.forEach((token) => token.fire());

    await expect(Promise.all(requests)).resolves.toEqual(
      Array.from({ length: 1_000 }, () => FEATURE_REQUEST_CANCELLED),
    );
    expect(cancel).toHaveBeenCalledTimes(1_000);
    expect(tokens.every((token) => !token.hasListener())).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});

function cancellationToken() {
  let listener: (() => void) | undefined;

  return {
    fire: () => listener?.(),
    hasListener: () => listener !== undefined,
    isCancellationRequested: false,
    onCancellationRequested: (nextListener: () => void) => {
      listener = nextListener;
      return {
        dispose: () => {
          listener = undefined;
        },
      };
    },
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
