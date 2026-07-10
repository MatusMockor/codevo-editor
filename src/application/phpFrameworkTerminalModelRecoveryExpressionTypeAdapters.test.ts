import { describe, expect, it, vi } from "vitest";
import { createPhpFrameworkTerminalModelRecoveryExpressionTypeAdapters } from "./phpFrameworkTerminalModelRecoveryExpressionTypeAdapters";

describe("phpFrameworkTerminalModelRecoveryExpressionTypeAdapters", () => {
  it("selects the inert generic adapter", async () => {
    const resolvePropertyOrRelationType = vi.fn(
      async () => "App\\Models\\Comment",
    );
    const resolveExpressionType = vi.fn(async () => "App\\Models\\Post");
    const resolveCollectionModelType = vi.fn(
      async () => "App\\Models\\Fallback",
    );
    const adapter = createPhpFrameworkTerminalModelRecoveryExpressionTypeAdapters(
      false,
      { resolvePropertyOrRelationType },
    );

    await expect(
      adapter.collectionTerminalModelType({
        receiverExpression: "$model->comments",
        resolveCollectionModelType,
        resolveExpressionType,
      }),
    ).resolves.toBeNull();
    expect(resolvePropertyOrRelationType).not.toHaveBeenCalled();
    expect(resolveExpressionType).not.toHaveBeenCalled();
    expect(resolveCollectionModelType).not.toHaveBeenCalled();
  });

  it("selects the Laravel adapter", async () => {
    const resolvePropertyOrRelationType = vi.fn(
      async () => "App\\Models\\Comment",
    );
    const adapter = createPhpFrameworkTerminalModelRecoveryExpressionTypeAdapters(
      true,
      { resolvePropertyOrRelationType },
    );

    await expect(
      adapter.collectionTerminalModelType({
        receiverExpression: "$model->comments",
        resolveCollectionModelType: vi.fn(async () => null),
        resolveExpressionType: vi.fn(async () => "App\\Models\\Post"),
      }),
    ).resolves.toBe("App\\Models\\Comment");
    expect(resolvePropertyOrRelationType).toHaveBeenCalledWith(
      "App\\Models\\Post",
      "comments",
      true,
    );
  });
});
