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

  it("passes an active request to each adapter", async () => {
    const context: PhpIdentifierContext = {
      kind: "classIdentifier",
      name: "ReportService",
    };
    const request = { canNavigate: vi.fn(() => true) };
    const first: PhpFrameworkIdentifierDefinitionNavigationAdapter = {
      goToDefinition: vi.fn(async () => false),
    };
    const second: PhpFrameworkIdentifierDefinitionNavigationAdapter = {
      goToDefinition: vi.fn(async () => true),
    };

    await expect(
      goToPhpFrameworkIdentifierDefinition(
        context,
        { adapters: [first, second] },
        request,
      ),
    ).resolves.toBe(true);

    expect(first.goToDefinition).toHaveBeenCalledWith(context, request);
    expect(second.goToDefinition).toHaveBeenCalledWith(context, request);
  });

  it("stops before later adapters when the request becomes stale", async () => {
    let requestActive = true;
    const request = { canNavigate: () => requestActive };
    const first: PhpFrameworkIdentifierDefinitionNavigationAdapter = {
      goToDefinition: vi.fn(async () => {
        requestActive = false;
        return false;
      }),
    };
    const second: PhpFrameworkIdentifierDefinitionNavigationAdapter = {
      goToDefinition: vi.fn(async () => true),
    };

    await expect(
      goToPhpFrameworkIdentifierDefinition(
        { kind: "classIdentifier", name: "ReportService" },
        { adapters: [first, second] },
        request,
      ),
    ).resolves.toBe(false);

    expect(first.goToDefinition).toHaveBeenCalledTimes(1);
    expect(second.goToDefinition).not.toHaveBeenCalled();
  });
});
