import { describe, expect, it, vi } from "vitest";
import type { PhpIdentifierContext } from "../domain/phpNavigation";
import type { EditorDocument } from "../domain/workspace";
import {
  activePhpFrameworkIdentifierNavigationAdapters,
  type PhpFrameworkIdentifierNavigationActivationAdapter,
} from "./phpFrameworkIdentifierNavigationAdapters";
import {
  createDefaultPhpFrameworkIdentifierNavigationActivationAdapters,
  createPhpFrameworkIdentifierNavigationAdapters,
} from "./phpFrameworkIdentifierNavigationAdapterComposition";
import { createPhpLaravelIdentifierNavigationActivationAdapter } from "./phpLaravelIdentifierNavigationActivationAdapter";
import type { PhpLaravelIdentifierDefinitionNavigationAdapterDependencies } from "./phpLaravelIdentifierDefinitionNavigationAdapter";
import { createPhpNetteIdentifierNavigationActivationAdapter } from "./phpNetteIdentifierNavigationActivationAdapter";

const ROOT = "/workspace";

const activeDocument: EditorDocument = {
  content: `<?php
use App\\Http\\Controllers\\DashboardController;

Route::get('/dashboard', [DashboardController::class, 'index']);
`,
  language: "php",
  name: "web.php",
  path: `${ROOT}/routes/web.php`,
  savedContent: "",
};

const routeActionContext: PhpIdentifierContext = {
  className: "DashboardController",
  kind: "laravelRouteActionMethod",
  methodName: "missing",
};

function makeDeps(
  overrides: Partial<PhpLaravelIdentifierDefinitionNavigationAdapterDependencies> = {},
): PhpLaravelIdentifierDefinitionNavigationAdapterDependencies {
  const falseHandler = vi.fn(async () => false);

  return {
    activeDocument,
    goToPhpFrameworkLiteralDefinition: falseHandler,
    goToPhpFrameworkAuthorizationAbilityDefinition: falseHandler,
    goToPhpFrameworkMiddlewareAliasDefinition: falseHandler,
    goToPhpLaravelRelationStringDefinition: falseHandler,
    openDirectPhpMethodTarget: vi.fn(async () => false),
    ...overrides,
  };
}

describe("phpFrameworkIdentifierNavigationAdapters", () => {
  it("selects adapters by provider id and preserves registry order", () => {
    const laravel = vi.fn(async () => false);
    const nette = vi.fn(async () => false);
    const registry: readonly PhpFrameworkIdentifierNavigationActivationAdapter[] = [
      {
        providerId: "laravel",
        create: () => ({
          adapters: [{ goToDefinition: laravel }],
          contextualAdapters: [{ goToDefinition: laravel }],
        }),
      },
      {
        providerId: "nette",
        create: () => ({
          adapters: [{ goToDefinition: nette }],
          contextualAdapters: [{ goToDefinition: nette }],
        }),
      },
    ];

    const active = activePhpFrameworkIdentifierNavigationAdapters(
      {
        hasProvider: (providerId) =>
          providerId === "laravel" || providerId === "nette",
      },
      registry,
    );

    expect(active.adapters.map((adapter) => adapter.goToDefinition)).toEqual([
      laravel,
      nette,
    ]);
    expect(
      active.contextualAdapters.map((adapter) => adapter.goToDefinition),
    ).toEqual([laravel, nette]);
  });

  it("creates default activation adapters in Laravel then Nette order", () => {
    const activationAdapters =
      createDefaultPhpFrameworkIdentifierNavigationActivationAdapters({
        laravel: makeDeps(),
        nette: {
          activeDocument,
          activeEditorPositionRef: { current: { column: 1, lineNumber: 1 } },
          providePhpNetteInjectionDefinition: vi.fn(async () => false),
        },
      });

    expect(activationAdapters.map((adapter) => adapter.providerId)).toEqual([
      "laravel",
      "nette",
    ]);
  });

  it("selects no adapters for a generic provider", () => {
    const active = activePhpFrameworkIdentifierNavigationAdapters(
      { hasProvider: (providerId) => providerId === "generic" },
      [
        {
          providerId: "laravel",
          create: () => ({ adapters: [], contextualAdapters: [] }),
        },
        {
          providerId: "nette",
          create: () => ({ adapters: [], contextualAdapters: [] }),
        },
      ],
    );

    expect(active.adapters).toEqual([]);
    expect(active.contextualAdapters).toEqual([]);
  });

  it("returns no adapters without the Laravel provider", () => {
    const adapters = createPhpFrameworkIdentifierNavigationAdapters(
      {
        activationAdapters: [
          createPhpLaravelIdentifierNavigationActivationAdapter(makeDeps()),
        ],
        frameworkRuntime: { hasProvider: () => false },
      },
    );

    expect(adapters.adapters).toHaveLength(0);
    expect(adapters.contextualAdapters).toHaveLength(0);
  });

  it("creates a direct Laravel adapter without route action class fallback", async () => {
    const openDirectPhpMethodTarget = vi.fn(async () => false);
    const openPhpClassTarget = vi.fn(async () => true);
    const adapters = createPhpFrameworkIdentifierNavigationAdapters(
      {
        activationAdapters: [
          createPhpLaravelIdentifierNavigationActivationAdapter(
            makeDeps({
              openDirectPhpMethodTarget,
              openPhpClassTarget,
            }),
          ),
        ],
        frameworkRuntime: { hasProvider: () => true },
      },
    );

    await expect(
      adapters.adapters[0].goToDefinition(routeActionContext),
    ).resolves.toBe(false);
    expect(openDirectPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Http\\Controllers\\DashboardController",
      "missing",
    );
    expect(openPhpClassTarget).not.toHaveBeenCalled();
  });

  it("creates a contextual Laravel adapter with route action class fallback", async () => {
    const openDirectPhpMethodTarget = vi.fn(async () => false);
    const openPhpClassTarget = vi.fn(async () => true);
    const adapters = createPhpFrameworkIdentifierNavigationAdapters(
      {
        activationAdapters: [
          createPhpLaravelIdentifierNavigationActivationAdapter(
            makeDeps({
              openDirectPhpMethodTarget,
              openPhpClassTarget,
            }),
          ),
        ],
        frameworkRuntime: { hasProvider: () => true },
      },
    );

    await expect(
      adapters.contextualAdapters[0].goToDefinition(routeActionContext),
    ).resolves.toBe(true);
    expect(openDirectPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Http\\Controllers\\DashboardController",
      "missing",
    );
    expect(openPhpClassTarget).toHaveBeenCalledWith(
      "App\\Http\\Controllers\\DashboardController",
      "DashboardController",
    );
  });

  it("wires the Nette injection adapter only for the Nette provider", async () => {
    const source = "<?php class P { public function __construct(Catalog $catalog) {} }";
    const providePhpNetteInjectionDefinition = vi.fn(async () => true);
    const adapters = createPhpFrameworkIdentifierNavigationAdapters(
      {
        activationAdapters: [
          createPhpLaravelIdentifierNavigationActivationAdapter(
            makeDeps({
              activeDocument: { ...activeDocument, content: source },
            }),
          ),
          createPhpNetteIdentifierNavigationActivationAdapter({
            activeDocument: { ...activeDocument, content: source },
            activeEditorPositionRef: {
              current: { column: source.indexOf("Catalog") + 2, lineNumber: 1 },
            },
            providePhpNetteInjectionDefinition,
          }),
        ],
        frameworkRuntime: { hasProvider: (id) => id === "nette" },
      },
    );

    expect(adapters.adapters).toHaveLength(1);
    expect(adapters.contextualAdapters).toHaveLength(1);
    await expect(
      adapters.contextualAdapters[0].goToDefinition({
        kind: "classIdentifier",
        name: "Catalog",
      }),
    ).resolves.toBe(true);
    expect(providePhpNetteInjectionDefinition).toHaveBeenCalledWith(
      source,
      source.indexOf("Catalog") + 1,
    );
  });

  it("does not wire Nette injection navigation for a non-Nette provider", () => {
    const adapters = createPhpFrameworkIdentifierNavigationAdapters(
      {
        activationAdapters: [
          createPhpLaravelIdentifierNavigationActivationAdapter(makeDeps()),
          createPhpNetteIdentifierNavigationActivationAdapter({
            activeDocument,
            activeEditorPositionRef: { current: { column: 1, lineNumber: 1 } },
            providePhpNetteInjectionDefinition: vi.fn(async () => true),
          }),
        ],
        frameworkRuntime: { hasProvider: (id) => id === "laravel" },
      },
    );

    expect(adapters.adapters).toHaveLength(1);
    expect(adapters.contextualAdapters).toHaveLength(1);
  });
});
