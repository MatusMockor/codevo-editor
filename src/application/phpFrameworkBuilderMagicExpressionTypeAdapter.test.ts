import { describe, expect, it, vi } from "vitest";
import { genericPhpFrameworkBuilderMagicExpressionTypeAdapter } from "./phpFrameworkBuilderMagicExpressionTypeAdapter";

describe("phpFrameworkBuilderMagicExpressionTypeAdapter", () => {
  it("keeps the generic implementation inert", async () => {
    const resolveBuilderModelType = vi.fn(async () => "App\\Models\\Post");
    const resolveReceiverModelTypeCandidate = vi.fn(
      async () => "App\\Models\\Post",
    );

    await expect(
      genericPhpFrameworkBuilderMagicExpressionTypeAdapter.methodCallType({
        methodName: "published",
        resolveBuilderModelType,
        resolveReceiverModelTypeCandidate,
      }),
    ).resolves.toBeNull();
    await expect(
      genericPhpFrameworkBuilderMagicExpressionTypeAdapter.staticCallType({
        className: "App\\Models\\Post",
        methodName: "published",
      }),
    ).resolves.toBeNull();

    expect(resolveBuilderModelType).not.toHaveBeenCalled();
    expect(resolveReceiverModelTypeCandidate).not.toHaveBeenCalled();
  });
});
