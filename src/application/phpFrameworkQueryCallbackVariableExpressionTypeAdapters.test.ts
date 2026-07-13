import { describe, expect, it, vi } from "vitest";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import { createPhpFrameworkQueryCallbackVariableExpressionTypeAdapters } from "./phpFrameworkQueryCallbackVariableExpressionTypeAdapters";

const SOURCE = `<?php
Post::query()->whereHas('comments', function ($query): void {
    $query->where('active', true);
});
`;
const POSITION = { column: 17, lineNumber: 3 };

describe("phpFrameworkQueryCallbackVariableExpressionTypeAdapters", () => {
  it("selects the generic adapter without Laravel without resolving a model", async () => {
    const resolveBuilderModelType = vi.fn(async () => "App\\Models\\Comment");
    const adapter =
      createPhpFrameworkQueryCallbackVariableExpressionTypeAdapters(false);

    await expect(
      adapter.variableType({
        frameworkProviders: [],
        position: POSITION,
        resolveBuilderModelType,
        source: SOURCE,
        variableName: "query",
      }),
    ).resolves.toBeNull();
    expect(resolveBuilderModelType).not.toHaveBeenCalled();
  });

  it("selects the Laravel adapter when Laravel is active", async () => {
    const adapter =
      createPhpFrameworkQueryCallbackVariableExpressionTypeAdapters(true);

    await expect(
      adapter.variableType({
        frameworkProviders: [phpLaravelFrameworkProvider],
        position: POSITION,
        resolveBuilderModelType: async () => "App\\Models\\Comment",
        source: SOURCE,
        variableName: "query",
      }),
    ).resolves.toBe("Illuminate\\Database\\Eloquent\\Builder");
  });
});
