import { describe, expect, it, vi } from "vitest";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import { resolvePhpFrameworkLiteralNavigationTarget } from "./phpFrameworkLiteralNavigation";
import type { PhpFrameworkLiteralNavigationDependencies } from "./phpFrameworkLiteralNavigation";

const position = { column: 24, lineNumber: 3 };
const targetPosition = { column: 6, lineNumber: 4 };

function dependencies(
  overrides: Partial<PhpFrameworkLiteralNavigationDependencies> = {},
): PhpFrameworkLiteralNavigationDependencies {
  return {
    collectNamedRouteTargets: vi.fn(async () => []),
    findConfigTarget: vi.fn(async () => null),
    findEnvTarget: vi.fn(async () => null),
    findTranslationTarget: vi.fn(async () => null),
    findViewTarget: vi.fn(async () => null),
    ...overrides,
  };
}

describe("resolvePhpFrameworkLiteralNavigationTarget", () => {
  it("returns null when no active provider supports framework literals", async () => {
    const deps = dependencies({
      findConfigTarget: vi.fn(async () => ({
        key: "app.name",
        path: "/workspace/config/app.php",
        position: targetPosition,
      })),
    });

    await expect(
      resolvePhpFrameworkLiteralNavigationTarget(
        {
          activeDocument: null,
          offset: "<?php\nconfig('app.name');".indexOf("app.name") + 1,
          position,
          providers: [],
          source: "<?php\nconfig('app.name');",
        },
        deps,
      ),
    ).resolves.toBeNull();

    expect(deps.findConfigTarget).not.toHaveBeenCalled();
  });

  it("resolves a Laravel config helper literal through typed dependencies", async () => {
    const deps = dependencies({
      findConfigTarget: vi.fn(async () => ({
        key: "app.name",
        path: "/workspace/config/app.php",
        position: targetPosition,
      })),
    });
    const source = "<?php\nreturn config('app.name');";

    await expect(
      resolvePhpFrameworkLiteralNavigationTarget(
        {
          activeDocument: null,
          offset: source.indexOf("app.name") + 1,
          position,
          providers: [phpLaravelFrameworkProvider],
          source,
        },
        deps,
      ),
    ).resolves.toEqual({
      kind: "config",
      label: "app.name",
      path: "/workspace/config/app.php",
      position: targetPosition,
    });

    expect(deps.findConfigTarget).toHaveBeenCalledWith("app.name");
  });

  it("rejects unresolvable Laravel config literals before scanning targets", async () => {
    const deps = dependencies({
      findConfigTarget: vi.fn(async () => ({
        key: "../secrets.value",
        path: "/workspace/config/app.php",
        position: targetPosition,
      })),
    });
    const source = "<?php\nreturn config('../secrets.value');";

    await expect(
      resolvePhpFrameworkLiteralNavigationTarget(
        {
          activeDocument: null,
          offset: source.indexOf("../secrets.value") + 1,
          position,
          providers: [phpLaravelFrameworkProvider],
          source,
        },
        deps,
      ),
    ).resolves.toBeNull();

    expect(deps.findConfigTarget).not.toHaveBeenCalled();
  });

  it("resolves Laravel route helper literals case-insensitively from the active document", async () => {
    const deps = dependencies({
      collectNamedRouteTargets: vi.fn(async () => [
        {
          name: "Admin.Dashboard",
          path: "/workspace/routes/web.php",
          position: targetPosition,
        },
      ]),
    });
    const source = "<?php\nreturn route('admin.dashboard');";

    await expect(
      resolvePhpFrameworkLiteralNavigationTarget(
        {
          activeDocument: {
            content: source,
            path: "/workspace/app/Http/Controllers/DashboardController.php",
          },
          offset: source.indexOf("admin.dashboard") + 1,
          position,
          providers: [phpLaravelFrameworkProvider],
          source,
        },
        deps,
      ),
    ).resolves.toEqual({
      kind: "route",
      label: "Admin.Dashboard",
      path: "/workspace/routes/web.php",
      position: targetPosition,
    });

    expect(deps.collectNamedRouteTargets).toHaveBeenCalledWith(
      source,
      "/workspace/app/Http/Controllers/DashboardController.php",
    );
  });
});
