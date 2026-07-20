import { describe, expect, it, vi } from "vitest";
import { composePhpFrameworkFileChangeInvalidationContributions } from "./phpFrameworkFileChangeInvalidationComposition";

describe("composePhpFrameworkFileChangeInvalidationContributions", () => {
  it("owns concrete Blade and Nette callback wiring outside the generic registry", () => {
    const contributions =
      composePhpFrameworkFileChangeInvalidationContributions({
        invalidateBladeComponentNamesForPath: vi.fn(),
        invalidateBladeViewDataEntriesForPath: vi.fn(),
        invalidateLatteExpressionDataForPath: vi.fn(),
        invalidateNeonConfigForPath: vi.fn(),
      });

    expect(contributions.map(({ id }) => id)).toEqual([
      "blade-component-names",
      "blade-view-data-entries",
      "latte-expression-data",
      "neon-config",
    ]);
  });

  it("delegates cache cleanup to the framework-owned callback", () => {
    const invalidateNeonConfigForPath = vi.fn();
    const contributions =
      composePhpFrameworkFileChangeInvalidationContributions({
        invalidateBladeComponentNamesForPath: vi.fn(),
        invalidateBladeViewDataEntriesForPath: vi.fn(),
        invalidateLatteExpressionDataForPath: vi.fn(),
        invalidateNeonConfigForPath,
      });
    const neon = contributions.find(({ id }) => id === "neon-config");

    neon?.invalidate({
      rootPath: "/workspace-a",
      path: "/workspace-a/config/services.neon",
    });

    expect(invalidateNeonConfigForPath).toHaveBeenCalledWith(
      "/workspace-a",
      "/workspace-a/config/services.neon",
    );
  });
});
