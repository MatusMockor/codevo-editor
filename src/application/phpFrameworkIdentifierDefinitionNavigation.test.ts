import { describe, expect, it, vi } from "vitest";
import type { PhpIdentifierContext } from "../domain/phpNavigation";
import {
  goToPhpFrameworkIdentifierDefinition,
  type PhpFrameworkIdentifierDefinitionNavigationAdapter,
} from "./phpFrameworkIdentifierDefinitionNavigation";

describe("phpFrameworkIdentifierDefinitionNavigation", () => {
  it("dispatches to adapters until one handles the context", async () => {
    const context: PhpIdentifierContext = {
      kind: "classIdentifier",
      name: "ReportService",
    };
    const first: PhpFrameworkIdentifierDefinitionNavigationAdapter = {
      goToDefinition: vi.fn(async () => false),
    };
    const second: PhpFrameworkIdentifierDefinitionNavigationAdapter = {
      goToDefinition: vi.fn(async () => true),
    };
    const third: PhpFrameworkIdentifierDefinitionNavigationAdapter = {
      goToDefinition: vi.fn(async () => true),
    };

    await expect(
      goToPhpFrameworkIdentifierDefinition(context, {
        adapters: [first, second, third],
      }),
    ).resolves.toBe(true);

    expect(first.goToDefinition).toHaveBeenCalledWith(context);
    expect(second.goToDefinition).toHaveBeenCalledWith(context);
    expect(third.goToDefinition).not.toHaveBeenCalled();
  });

  it("returns false when no adapter handles the context", async () => {
    const adapter: PhpFrameworkIdentifierDefinitionNavigationAdapter = {
      goToDefinition: vi.fn(async () => false),
    };

    await expect(
      goToPhpFrameworkIdentifierDefinition(
        { kind: "classIdentifier", name: "ReportService" },
        { adapters: [adapter] },
      ),
    ).resolves.toBe(false);
  });
});
