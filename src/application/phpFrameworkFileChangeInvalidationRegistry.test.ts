import { describe, expect, it, vi } from "vitest";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
import { phpNetteFrameworkProvider } from "../domain/phpFrameworkNetteProvider";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import { createPhpFrameworkFileChangeInvalidationContributionCatalog } from "./phpFrameworkFileChangeInvalidationContributionCatalog";
import type { PhpFrameworkFileChangeInvalidationContribution } from "./phpFrameworkFileChangeInvalidationContributions";
import { createPhpFrameworkFileChangeInvalidator } from "./phpFrameworkFileChangeInvalidationRegistry";

const ROOT = "/workspace";
const PATH = `${ROOT}/app/Changed.php`;

function contribution(
  id: string,
  kind: string,
  invalidate: PhpFrameworkFileChangeInvalidationContribution["invalidate"] = vi.fn(),
  priority = 0,
): PhpFrameworkFileChangeInvalidationContribution {
  return {
    id,
    priority,
    supports: (descriptor) => descriptor.kind === kind,
    invalidate,
  };
}

function createInvalidator(
  providers: readonly PhpFrameworkProvider[],
  contributions: readonly PhpFrameworkFileChangeInvalidationContribution[],
) {
  return createPhpFrameworkFileChangeInvalidator({
    contributions:
      createPhpFrameworkFileChangeInvalidationContributionCatalog(
        contributions,
      ),
    frameworkRuntime: { providers },
  });
}

describe("createPhpFrameworkFileChangeInvalidator", () => {
  it("is inert when no framework provider is active", () => {
    const invalidate = vi.fn();
    const invalidateForPath = createInvalidator(
      [],
      [contribution("blade-components", "bladeComponentNames", invalidate)],
    );

    invalidateForPath(ROOT, PATH);

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("runs active provider descriptors in their declared order", () => {
    const calls: string[] = [];
    const invalidateForPath = createInvalidator(
      [phpLaravelFrameworkProvider, phpNetteFrameworkProvider],
      [
        contribution("blade-components", "bladeComponentNames", () =>
          calls.push("components"),
        ),
        contribution("blade-view-data", "bladeViewDataEntries", () =>
          calls.push("viewData"),
        ),
        contribution("latte-expressions", "latteExpressionData", () =>
          calls.push("latte"),
        ),
        contribution("neon-config", "neonConfig", () => calls.push("neon")),
      ],
    );

    invalidateForPath(ROOT, PATH);

    expect(calls).toEqual(["components", "viewData", "latte", "neon"]);
  });

  it("passes the originating workspace root and changed path to adapters", () => {
    const invalidate = vi.fn();
    const invalidateForPath = createInvalidator(
      [phpNetteFrameworkProvider],
      [contribution("neon-config", "neonConfig", invalidate)],
    );

    invalidateForPath(ROOT, PATH);

    expect(invalidate).toHaveBeenCalledWith({ rootPath: ROOT, path: PATH });
  });

  it("keeps active framework invalidations isolated per project runtime", () => {
    const invalidateBlade = vi.fn();
    const invalidateLatte = vi.fn();
    const contributions = [
      contribution("blade-components", "bladeComponentNames", invalidateBlade),
      contribution("latte-expressions", "latteExpressionData", invalidateLatte),
    ];
    const invalidateLaravelPath = createInvalidator(
      [phpLaravelFrameworkProvider],
      contributions,
    );
    const invalidateNettePath = createInvalidator(
      [phpNetteFrameworkProvider],
      contributions,
    );

    invalidateLaravelPath("/workspace-laravel", "/workspace-laravel/app/A.php");
    invalidateNettePath("/workspace-nette", "/workspace-nette/app/B.php");

    expect(invalidateBlade).toHaveBeenCalledOnce();
    expect(invalidateBlade).toHaveBeenCalledWith({
      rootPath: "/workspace-laravel",
      path: "/workspace-laravel/app/A.php",
    });
    expect(invalidateLatte).toHaveBeenCalledOnce();
    expect(invalidateLatte).toHaveBeenCalledWith({
      rootPath: "/workspace-nette",
      path: "/workspace-nette/app/B.php",
    });
  });

  it("uses the highest-priority matching adapter without changing descriptor order", () => {
    const calls: string[] = [];
    const invalidateForPath = createInvalidator(
      [phpLaravelFrameworkProvider],
      [
        contribution(
          "fallback-components",
          "bladeComponentNames",
          () => calls.push("fallback"),
          1,
        ),
        contribution(
          "preferred-components",
          "bladeComponentNames",
          () => calls.push("preferred"),
          10,
        ),
        contribution("view-data", "bladeViewDataEntries", () =>
          calls.push("viewData"),
        ),
      ],
    );

    invalidateForPath(ROOT, PATH);

    expect(calls).toEqual(["preferred", "viewData"]);
  });
});
