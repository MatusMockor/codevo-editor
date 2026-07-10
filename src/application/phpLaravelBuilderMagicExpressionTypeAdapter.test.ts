import { describe, expect, it, vi } from "vitest";
import { phpLaravelBuilderMagicExpressionTypeAdapter } from "./phpLaravelBuilderMagicExpressionTypeAdapter";

describe("phpLaravelBuilderMagicExpressionTypeAdapter", () => {
  it("short-circuits a builder local scope before later checks", async () => {
    const calls: string[] = [];
    const adapter = phpLaravelBuilderMagicExpressionTypeAdapter({
      phpClassHasLaravelDynamicWhere: vi.fn(async () => {
        calls.push("dynamic");
        return true;
      }),
      phpClassHasLaravelLocalScope: vi.fn(async () => {
        calls.push("scope");
        return true;
      }),
    });

    await expect(
      adapter.methodCallType({
        methodName: "published",
        resolveBuilderModelType: vi.fn(async () => {
          calls.push("builder");
          return "App\\Models\\Post";
        }),
        resolveReceiverModelTypeCandidate: vi.fn(async () => {
          calls.push("receiver");
          return "App\\Models\\Post";
        }),
      }),
    ).resolves.toBe("Illuminate\\Database\\Eloquent\\Builder");
    expect(calls).toEqual(["builder", "scope"]);
  });

  it("checks builder scope then dynamic where before receiver fallback", async () => {
    const calls: string[] = [];
    const adapter = phpLaravelBuilderMagicExpressionTypeAdapter({
      phpClassHasLaravelDynamicWhere: vi.fn(async () => {
        calls.push("dynamic");
        return false;
      }),
      phpClassHasLaravelLocalScope: vi.fn(async (className) => {
        calls.push(`scope:${className}`);
        return className === "App\\Models\\Receiver";
      }),
    });

    await expect(
      adapter.methodCallType({
        methodName: "published",
        resolveBuilderModelType: vi.fn(async () => {
          calls.push("builder");
          return "App\\Models\\Builder";
        }),
        resolveReceiverModelTypeCandidate: vi.fn(async () => {
          calls.push("receiver");
          return "App\\Models\\Receiver";
        }),
      }),
    ).resolves.toBe("Illuminate\\Database\\Eloquent\\Builder");
    expect(calls).toEqual([
      "builder",
      "scope:App\\Models\\Builder",
      "dynamic",
      "receiver",
      "scope:App\\Models\\Receiver",
    ]);
  });

  it("never checks dynamic where on a receiver fallback", async () => {
    const phpClassHasLaravelDynamicWhere = vi.fn(async () => true);
    const phpClassHasLaravelLocalScope = vi.fn(async () => false);
    const adapter = phpLaravelBuilderMagicExpressionTypeAdapter({
      phpClassHasLaravelDynamicWhere,
      phpClassHasLaravelLocalScope,
    });

    await expect(
      adapter.methodCallType({
        methodName: "whereTitle",
        resolveBuilderModelType: vi.fn(async () => null),
        resolveReceiverModelTypeCandidate: vi.fn(
          async () => "App\\Models\\Post",
        ),
      }),
    ).resolves.toBeNull();
    expect(phpClassHasLaravelLocalScope).toHaveBeenCalledWith(
      "App\\Models\\Post",
      "whereTitle",
    );
    expect(phpClassHasLaravelDynamicWhere).not.toHaveBeenCalled();
  });

  it("guards static calls and checks scope before dynamic where", async () => {
    const calls: string[] = [];
    const adapter = phpLaravelBuilderMagicExpressionTypeAdapter({
      phpClassHasLaravelDynamicWhere: vi.fn(async () => {
        calls.push("dynamic");
        return true;
      }),
      phpClassHasLaravelLocalScope: vi.fn(async () => {
        calls.push("scope");
        return false;
      }),
    });

    await expect(
      adapter.staticCallType({ className: null, methodName: "whereTitle" }),
    ).resolves.toBeNull();
    expect(calls).toEqual([]);

    await expect(
      adapter.staticCallType({
        className: "App\\Models\\Post",
        methodName: "whereTitle",
      }),
    ).resolves.toBe("Illuminate\\Database\\Eloquent\\Builder");
    expect(calls).toEqual(["scope", "dynamic"]);
  });
});
