import { describe, expect, it, vi } from "vitest";
import { disposeAll, registerTransactionally } from "./providerRegistrationTypes";

describe("provider registration transactions", () => {
  it("rolls back registered handles in reverse order and preserves the registration failure", () => {
    const order: string[] = [];
    const failure = new Error("registration failed");

    expect(() =>
      registerTransactionally((track) => {
        track({ dispose: () => order.push("first") });
        track({ dispose: () => order.push("second") });
        throw failure;
      }),
    ).toThrow(failure);
    expect(order).toEqual(["second", "first"]);
  });

  it("continues cleanup when both a disposer and the error reporter throw", () => {
    const firstFailure = new Error("first dispose failed");
    const reporterFailure = new Error("reporting failed");
    const finalDispose = vi.fn();

    expect(() =>
      disposeAll(
        [
          {
            dispose: () => {
              throw firstFailure;
            },
          },
          { dispose: finalDispose },
        ],
        () => {
          throw reporterFailure;
        },
      ),
    ).toThrow(reporterFailure);
    expect(finalDispose).toHaveBeenCalledOnce();
  });
});
