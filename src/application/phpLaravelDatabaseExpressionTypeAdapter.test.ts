import { describe, expect, it, vi } from "vitest";
import { phpLaravelDatabaseExpressionTypeAdapter } from "./phpLaravelDatabaseExpressionTypeAdapter";

describe("phpLaravelDatabaseExpressionTypeAdapter", () => {
  it("resolves connection table factories to Query Builder", async () => {
    const resolveReceiverType = vi.fn(
      async () => "Illuminate\\Database\\DatabaseManager",
    );

    await expect(
      phpLaravelDatabaseExpressionTypeAdapter.methodCallType({
        methodName: "table",
        resolveReceiverType,
      }),
    ).resolves.toBe("Illuminate\\Database\\Query\\Builder");
    expect(resolveReceiverType).toHaveBeenCalledTimes(1);
  });

  it("continues Query Builder fluent calls", async () => {
    const resolveReceiverType = vi.fn(
      async () => "Illuminate\\Database\\Query\\Builder",
    );

    await expect(
      phpLaravelDatabaseExpressionTypeAdapter.methodCallType({
        methodName: "where",
        resolveReceiverType,
      }),
    ).resolves.toBe("Illuminate\\Database\\Query\\Builder");
    expect(resolveReceiverType).toHaveBeenCalledTimes(1);
  });

  it("does not resolve receivers for unrelated methods", async () => {
    const resolveReceiverType = vi.fn(async () => null);

    await expect(
      phpLaravelDatabaseExpressionTypeAdapter.methodCallType({
        methodName: "find",
        resolveReceiverType,
      }),
    ).resolves.toBeNull();
    expect(resolveReceiverType).not.toHaveBeenCalled();
  });

  it("resolves DB facade and DatabaseManager static table factories", () => {
    expect(
      phpLaravelDatabaseExpressionTypeAdapter.staticCallType({
        className: "Illuminate\\Support\\Facades\\DB",
        methodName: "table",
      }),
    ).toBe("Illuminate\\Database\\Query\\Builder");
    expect(
      phpLaravelDatabaseExpressionTypeAdapter.staticCallType({
        className: "Illuminate\\Database\\DatabaseManager",
        methodName: "table",
      }),
    ).toBe("Illuminate\\Database\\Query\\Builder");
  });
});
