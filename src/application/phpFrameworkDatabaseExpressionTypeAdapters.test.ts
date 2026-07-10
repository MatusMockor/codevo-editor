import { describe, expect, it, vi } from "vitest";
import { createPhpFrameworkDatabaseExpressionTypeAdapters } from "./phpFrameworkDatabaseExpressionTypeAdapters";

describe("phpFrameworkDatabaseExpressionTypeAdapters", () => {
  it("selects the generic adapter without Laravel", async () => {
    const resolveReceiverType = vi.fn(
      async () => "Illuminate\\Database\\DatabaseManager",
    );
    const adapter = createPhpFrameworkDatabaseExpressionTypeAdapters(false);

    await expect(
      adapter.methodCallType({ methodName: "table", resolveReceiverType }),
    ).resolves.toBeNull();
    expect(
      adapter.staticCallType({
        className: "Illuminate\\Support\\Facades\\DB",
        methodName: "table",
      }),
    ).toBeNull();
    expect(resolveReceiverType).not.toHaveBeenCalled();
  });

  it("selects the Laravel adapter when Laravel is active", async () => {
    const adapter = createPhpFrameworkDatabaseExpressionTypeAdapters(true);

    await expect(
      adapter.methodCallType({
        methodName: "table",
        resolveReceiverType: async () =>
          "Illuminate\\Database\\DatabaseManager",
      }),
    ).resolves.toBe("Illuminate\\Database\\Query\\Builder");
  });
});
