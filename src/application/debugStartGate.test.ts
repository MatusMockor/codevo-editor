import { describe, expect, it, vi } from "vitest";
import { createDebugStartGate } from "./debugStartGate";

describe("createDebugStartGate", () => {
  it("holds one synchronous admission across the complete async operation", async () => {
    const pending = deferred<number>();
    const gate = createDebugStartGate();
    const first = gate.run(
      () => false,
      () => pending.promise,
    );
    const second = gate.run(
      () => false,
      vi.fn(async () => 2),
    );

    expect(gate.occupied()).toBe(true);
    await expect(second).resolves.toEqual({ kind: "blocked" });
    pending.resolve(1);
    await expect(first).resolves.toEqual({ kind: "completed", value: 1 });
    expect(gate.occupied()).toBe(false);
  });

  it("fails closed when the lifecycle guard blocks or throws", async () => {
    const operation = vi.fn(async () => true);
    const gate = createDebugStartGate();

    await expect(gate.run(() => true, operation)).resolves.toEqual({
      kind: "blocked",
    });
    await expect(
      gate.run(() => {
        throw new Error("private guard detail");
      }, operation),
    ).resolves.toEqual({ kind: "blocked" });
    expect(operation).not.toHaveBeenCalled();
  });

  it("releases admission after a rejected operation", async () => {
    const gate = createDebugStartGate();
    await expect(
      gate.run(
        () => false,
        async () => {
          throw new Error("start failed");
        },
      ),
    ).rejects.toThrow("start failed");

    expect(gate.occupied()).toBe(false);
    await expect(
      gate.run(
        () => false,
        async () => "next",
      ),
    ).resolves.toEqual({
      kind: "completed",
      value: "next",
    });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
