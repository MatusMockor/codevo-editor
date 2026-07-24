import { describe, expect, it, vi } from "vitest";
import { observeLanguageServerRequestCancellation } from "./languageServerRequestCancellation";

describe("language server request cancellation", () => {
  it("cancels a pending request exactly once", async () => {
    let resolveRequest: (value: string) => void = () => undefined;
    const result = new Promise<string>((resolve) => {
      resolveRequest = resolve;
    });
    const cancel = vi.fn(async () => undefined);
    const token = cancellationToken();
    const requestId = 42;
    const request = observeLanguageServerRequestCancellation(
      Object.assign(result, { requestId }),
      token,
      "/workspace",
      cancel,
    );

    token.fire();
    token.fire();
    expect(cancel).toHaveBeenCalledExactlyOnceWith("/workspace", requestId);

    resolveRequest("done");
    await expect(request).resolves.toBe("done");
  });

  it("does not cancel a resolved request", async () => {
    const cancel = vi.fn(async () => undefined);
    const token = cancellationToken();
    const request = observeLanguageServerRequestCancellation(
      Object.assign(Promise.resolve("done"), { requestId: 42 }),
      token,
      "/workspace",
      cancel,
    );

    await expect(request).resolves.toBe("done");
    token.fire();

    expect(cancel).not.toHaveBeenCalled();
  });
});

function cancellationToken() {
  let listener: (() => void) | undefined;

  return {
    fire: () => listener?.(),
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
