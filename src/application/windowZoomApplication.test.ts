import { describe, expect, it, vi } from "vitest";
import { WindowZoomApplication } from "./windowZoomApplication";

function deferred() {
  let resolve: () => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe("WindowZoomApplication", () => {
  it("serializes native application and coalesces pending levels to the latest reset", async () => {
    const pending = deferred();
    const setScale = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
    const application = new WindowZoomApplication({ setScale }, vi.fn());
    application.applyLevel(1);
    application.applyLevel(2);
    application.applyLevel(0);
    expect(setScale.mock.calls).toEqual([[1.2]]);
    pending.resolve();
    await pending.promise;
    await Promise.resolve();
    expect(setScale.mock.calls).toEqual([[1.2], [1]]);
  });

  it("reports the current failure and allows the next request to recover", async () => {
    const error = new Error("zoom unavailable");
    const setScale = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const reportError = vi.fn();
    const application = new WindowZoomApplication({ setScale }, reportError);
    application.applyLevel(2);
    await Promise.resolve();
    expect(reportError).toHaveBeenCalledWith(error);
    application.applyLevel(0);
    await Promise.resolve();
    expect(setScale.mock.calls).toEqual([[1.2 ** 2], [1]]);
  });

  it("ignores an obsolete failure and applies the newest level", async () => {
    const pending = deferred();
    const setScale = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
    const reportError = vi.fn();
    const application = new WindowZoomApplication({ setScale }, reportError);
    application.applyLevel(1);
    application.applyLevel(-1);
    pending.reject(new Error("obsolete"));
    await pending.promise.catch(() => undefined);
    await Promise.resolve();
    expect(reportError).not.toHaveBeenCalled();
    expect(setScale.mock.calls).toEqual([[1.2], [1.2 ** -1]]);
  });

  it("drops pending work and suppresses late failures after disposal", async () => {
    const pending = deferred();
    const setScale = vi.fn().mockReturnValue(pending.promise);
    const reportError = vi.fn();
    const application = new WindowZoomApplication({ setScale }, reportError);
    application.applyLevel(1);
    application.applyLevel(2);
    application.dispose();
    application.applyLevel(3);
    pending.reject(new Error("disposed"));
    await pending.promise.catch(() => undefined);
    expect(setScale.mock.calls).toEqual([[1.2]]);
    expect(reportError).not.toHaveBeenCalled();
  });
});
