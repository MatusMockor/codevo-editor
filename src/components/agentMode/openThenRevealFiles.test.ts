import { describe, expect, it, vi } from "vitest";
import { openThenRevealFiles } from "./openThenRevealFiles";

describe("openThenRevealFiles", () => {
  it("reveals the files surface after a successful open", async () => {
    const reveal = vi.fn();

    await expect(openThenRevealFiles(async () => true, reveal)).resolves.toBe(true);

    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it("does not reveal the files surface when the open is refused", async () => {
    const reveal = vi.fn();

    await expect(openThenRevealFiles(async () => false, reveal)).resolves.toBe(false);

    expect(reveal).not.toHaveBeenCalled();
  });

  it("does not reveal the files surface when the open rejects", async () => {
    const reveal = vi.fn();
    const failure = new Error("open failed");

    await expect(openThenRevealFiles(async () => Promise.reject(failure), reveal)).rejects.toBe(
      failure,
    );

    expect(reveal).not.toHaveBeenCalled();
  });

  it("reveals only after the open settles", async () => {
    const order: string[] = [];
    let settle: (opened: boolean) => void = () => undefined;
    const pending = openThenRevealFiles(
      () =>
        new Promise<boolean>((resolve) => {
          settle = resolve;
        }),
      () => order.push("reveal"),
    );

    order.push("before-settle");
    settle(true);
    await pending;

    expect(order).toEqual(["before-settle", "reveal"]);
  });
});
