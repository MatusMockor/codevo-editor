import { describe, expect, it, vi } from "vitest";
import { createMonacoRuntimeLoader } from "./monacoRuntimeLoader";

describe("createMonacoRuntimeLoader", () => {
  it("shares one initialization across concurrent and later editor demands", async () => {
    const configureMonacoEnvironment = vi.fn();
    const loadEnvironment = vi.fn(async () => ({ configureMonacoEnvironment }));
    const initialize = createMonacoRuntimeLoader(loadEnvironment);

    const first = initialize();
    const second = initialize();
    expect(second).toBe(first);
    await Promise.all([first, second]);
    await initialize();

    expect(loadEnvironment).toHaveBeenCalledTimes(1);
    expect(configureMonacoEnvironment).toHaveBeenCalledTimes(1);
  });

  it("allows a later demand to retry a failed environment import", async () => {
    const configureMonacoEnvironment = vi.fn();
    const loadEnvironment = vi
      .fn<() => Promise<{ configureMonacoEnvironment(): void }>>()
      .mockRejectedValueOnce(new Error("chunk failed"))
      .mockResolvedValue({ configureMonacoEnvironment });
    const initialize = createMonacoRuntimeLoader(loadEnvironment);

    await expect(initialize()).rejects.toThrow("chunk failed");
    await expect(initialize()).resolves.toBeUndefined();

    expect(loadEnvironment).toHaveBeenCalledTimes(2);
    expect(configureMonacoEnvironment).toHaveBeenCalledTimes(1);
  });
});
