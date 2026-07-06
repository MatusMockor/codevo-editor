import { describe, expect, it, vi } from "vitest";
import { createSafeUnsubscribe } from "./safeUnsubscribe";

describe("createSafeUnsubscribe", () => {
  it("runs the wrapped unsubscribe at most once", () => {
    const unsubscribe = vi.fn();
    const safeUnsubscribe = createSafeUnsubscribe(unsubscribe);

    safeUnsubscribe();
    safeUnsubscribe();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("does not throw when Tauri listener cleanup races synchronously", () => {
    const safeUnsubscribe = createSafeUnsubscribe(() => {
      throw new TypeError(
        "undefined is not an object (evaluating 'listeners[eventId].handlerId')",
      );
    });

    expect(() => safeUnsubscribe()).not.toThrow();
  });

  it("does not leak rejected async listener cleanup", async () => {
    const safeUnsubscribe = createSafeUnsubscribe(() =>
      Promise.reject(
        new TypeError(
          "undefined is not an object (evaluating 'listeners[eventId].handlerId')",
        ),
      ),
    );

    safeUnsubscribe();

    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
