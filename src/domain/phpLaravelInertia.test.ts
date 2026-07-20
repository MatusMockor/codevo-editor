import { describe, expect, it } from "vitest";
import {
  phpFrameworkInertiaLiteralTarget,
  phpFrameworkInertiaReferenceAt,
  phpFrameworkProvidersForProject,
  phpFrameworkSupportsInertia,
} from "./phpFrameworkProviders";
import { phpLaravelFrameworkProvider } from "./phpFrameworkLaravelProvider";
import {
  phpLaravelInertiaReferenceContextAt,
  resolveLaravelInertiaComponentTarget,
} from "./phpLaravelInertia";
import type { PhpProjectDescriptor } from "./workspace";

describe("phpLaravelInertia", () => {
  it("detects supported Inertia component literals", () => {
    const samples = [
      ["Inertia::render('Users/Index')", "Inertia::render"],
      ["inertia('Users/Index')", "inertia"],
      ["Route::inertia('/users', 'Users/Index')", "Route::inertia"],
      ["Inertia::render(component: 'Users/Index')", "Inertia::render"],
      [
        "Route::inertia(uri: '/users', component: 'Users/Index')",
        "Route::inertia",
      ],
      [
        "Inertia::render(\n    'Users/Index',\n    ['filter' => nested(1, 2)],\n)",
        "Inertia::render",
      ],
    ] as const;

    for (const [expression, call] of samples) {
      const source = `<?php\nreturn ${expression};`;

      expect(
        phpLaravelInertiaReferenceContextAt(
          source,
          positionAfter(source, "Users/Ind"),
        ),
      ).toMatchObject({
        call,
        name: "Users/Index",
        prefix: "Users/Ind",
      });
    }
  });

  it("handles partial strings and nested arguments without confusing argument order", () => {
    const partial = "<?php\nreturn Inertia::render(component: 'Users/Ind";
    const route =
      "<?php\nRoute::inertia(uri: nested('/users', fallback('/')), component: 'Users/Index');";

    expect(
      phpLaravelInertiaReferenceContextAt(
        partial,
        positionAfter(partial, "Users/Ind"),
      ),
    ).toMatchObject({ name: "Users/Ind", prefix: "Users/Ind" });
    expect(
      phpLaravelInertiaReferenceContextAt(
        route,
        positionAfter(route, "Users/Ind"),
      )?.call,
    ).toBe("Route::inertia");
  });

  it("ignores unrelated calls and non-literal component expressions", () => {
    const samples = [
      "Inertia::share('Users/Index')",
      "Inertia::render('Users/' . $page)",
      "inertia($component)",
      "Route::inertia('Users/Index')",
      "Route::inertia('/users', $component)",
      "object()->inertia('Users/Index')",
    ];

    for (const expression of samples) {
      const source = `<?php\n${expression};`;
      const offset = source.indexOf("Users/Index");

      expect(
        phpLaravelInertiaReferenceContextAt(
          source,
          offset < 0
            ? { column: source.length + 1, lineNumber: 2 }
            : positionAfter(source, "Users/Ind"),
        ),
      ).toBeNull();
    }
  });

  it("orders page directories and extensions deterministically", () => {
    expect(resolveLaravelInertiaComponentTarget("Users/Index")).toEqual({
      relativeFilePaths: [
        "resources/js/Pages/Users/Index.vue",
        "resources/js/Pages/Users/Index.tsx",
        "resources/js/Pages/Users/Index.jsx",
        "resources/js/Pages/Users/Index.ts",
        "resources/js/Pages/Users/Index.js",
        "resources/js/pages/Users/Index.vue",
        "resources/js/pages/Users/Index.tsx",
        "resources/js/pages/Users/Index.jsx",
        "resources/js/pages/Users/Index.ts",
        "resources/js/pages/Users/Index.js",
      ],
    });
  });

  it("rejects traversal and unsafe component names", () => {
    for (const name of [
      "../Admin",
      "Users/../Admin",
      "Users..Admin",
      "Users Index",
      "Users\\Index",
      "Users/$id",
      "/Users/Index",
    ]) {
      expect(resolveLaravelInertiaComponentTarget(name)).toBeNull();
    }
  });

  it("gates the provider capability on inertiajs/inertia-laravel", () => {
    const providers = [phpLaravelFrameworkProvider];
    const active = phpFrameworkProvidersForProject(
      phpProjectDescriptor({
        packageName: "laravel/laravel",
        packages: [{ name: "inertiajs/inertia-laravel" }],
      }),
      providers,
    );
    const inactive = phpFrameworkProvidersForProject(
      phpProjectDescriptor({
        packageName: "laravel/laravel",
        packages: [],
      }),
      providers,
    );
    const source = "<?php\nreturn Inertia::render('Dashboard');";
    const position = positionAfter(source, "Dash");

    expect(phpFrameworkSupportsInertia(active)).toBe(true);
    expect(phpFrameworkSupportsInertia(inactive)).toBe(false);
    expect(
      phpFrameworkInertiaReferenceAt(source, position, active),
    ).toMatchObject({
      name: "Dashboard",
    });
    expect(
      phpFrameworkInertiaReferenceAt(source, position, inactive),
    ).toBeNull();
    expect(
      phpFrameworkInertiaLiteralTarget("Dashboard", active),
    ).not.toBeNull();
    expect(phpFrameworkInertiaLiteralTarget("Dashboard", inactive)).toBeNull();
  });
});

function positionAfter(source: string, needle: string) {
  const offset = source.indexOf(needle) + needle.length;
  const before = source.slice(0, offset);
  const lines = before.split("\n");

  return {
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
    lineNumber: lines.length,
  };
}

function phpProjectDescriptor(
  overrides: Omit<Partial<PhpProjectDescriptor>, "packages"> & {
    packages?: Array<{ name: string }>;
  },
): PhpProjectDescriptor {
  const { packages = [], ...descriptorOverrides } = overrides;

  return {
    classmapRoots: [],
    hasComposer: true,
    packageName: null,
    packages: packages.map((composerPackage) => ({
      classmapRoots: [],
      dev: false,
      installPath: null,
      name: composerPackage.name,
      packageType: null,
      psr4Roots: [],
      version: null,
    })),
    phpPlatformVersion: null,
    phpVersionConstraint: null,
    psr4Roots: [],
    ...descriptorOverrides,
  };
}
