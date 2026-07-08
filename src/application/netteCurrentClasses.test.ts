import { describe, expect, it, vi } from "vitest";
import {
  currentNetteControlClassName,
  currentNettePresenterClassName,
  phpClassPositionInSource,
  phpNamespaceName,
  phpPrimaryClassName,
  resolveNetteControlVariableDefinition,
  type NetteCurrentClassContext,
} from "./netteCurrentClasses";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";

const ROOT = "/ws";
const NETTE_PROVIDER = {
  id: "nette",
  viewData: { supportsComponentFactoryVariables: true },
} as PhpFrameworkProvider;

const PRESENTATION_PRESENTER = `<?php
namespace App\\Presentation\\Invoice;

class InvoicePresenter
{
}
`;

const UI_PRESENTER_WITH_FACTORY = `<?php
namespace App\\UI\\Invoice;

class InvoicePresenter
{
    protected function createComponentGrid(): GridControl
    {
        return new GridControl();
    }
}
`;

const CONTROL_SOURCE = `<?php
namespace App\\UI\\Invoice;

class GridControl
{
}
`;

function makeContext({
  active = true,
  providers = [NETTE_PROVIDER],
  readFileContent,
  searchText = vi.fn(async () => []),
  templateRelativePath = "app/UI/Invoice/Components/GridControl/default.latte",
}: {
  active?: boolean | (() => boolean);
  providers?: readonly PhpFrameworkProvider[];
  readFileContent?: (path: string) => Promise<string>;
  searchText?: (rootPath: string, query: string, limit: number) => Promise<{ path: string }[]>;
  templateRelativePath?: string;
} = {}): NetteCurrentClassContext {
  const isActive = typeof active === "function" ? active : () => active;

  return {
    createComponentSearchLimit: 20,
    deps: {
      joinPath: (rootPath, relativePath) => `${rootPath}/${relativePath}`,
      openTarget: vi.fn(async () => true),
      readFileContent:
        readFileContent ??
        vi.fn(async (path: string) => {
          if (path.endsWith("GridControl.php")) {
            return CONTROL_SOURCE;
          }

          if (path.endsWith("InvoicePresenter.php")) {
            return PRESENTATION_PRESENTER;
          }

          throw new Error(`missing ${path}`);
        }),
      resolveDeclaredType: vi.fn((_source, typeHint) => {
        if (typeHint === "GridControl") {
          return "App\\UI\\Invoice\\GridControl";
        }

        return typeHint;
      }),
      searchText,
    },
    isRequestedRootActive: isActive,
    phpExtension: ".php",
    providers,
    requestedRoot: ROOT,
    templateRelativePath,
  };
}

describe("current Nette class helpers", () => {
  it("extracts PHP class names, namespaces and class positions", () => {
    expect(phpPrimaryClassName(PRESENTATION_PRESENTER)).toBe("InvoicePresenter");
    expect(phpNamespaceName(PRESENTATION_PRESENTER)).toBe(
      "App\\Presentation\\Invoice",
    );
    expect(
      phpClassPositionInSource(PRESENTATION_PRESENTER, "InvoicePresenter"),
    ).toEqual({ column: 7, lineNumber: 4 });
  });
});

describe("currentNetteControlClassName", () => {
  it("resolves the current control class from a component template path", async () => {
    const context = makeContext();

    await expect(currentNetteControlClassName(context)).resolves.toBe(
      "App\\UI\\Invoice\\GridControl",
    );
  });

  it("drops stale-root reads without returning a class", async () => {
    let active = true;
    const context = makeContext({
      active: () => active,
      readFileContent: vi.fn(async () => {
        active = false;
        return CONTROL_SOURCE;
      }),
    });

    await expect(currentNetteControlClassName(context)).resolves.toBeNull();
  });
});

describe("currentNettePresenterClassName", () => {
  it("resolves the current presenter class from a colocated template path", async () => {
    const context = makeContext({
      templateRelativePath: "app/Presentation/Invoice/default.latte",
    });

    await expect(currentNettePresenterClassName(context)).resolves.toBe(
      "App\\Presentation\\Invoice\\InvoicePresenter",
    );
  });

  it("falls back from control template to the factory owning presenter", async () => {
    const presenterPath = `${ROOT}/app/UI/Invoice/InvoicePresenter.php`;
    const context = makeContext({
      readFileContent: vi.fn(async (path: string) => {
        if (path.endsWith("GridControl.php")) {
          return CONTROL_SOURCE;
        }

        if (path === presenterPath) {
          return UI_PRESENTER_WITH_FACTORY;
        }

        throw new Error(`missing ${path}`);
      }),
      searchText: vi.fn(async () => [{ path: presenterPath }]),
    });

    await expect(currentNettePresenterClassName(context)).resolves.toBe(
      "App\\UI\\Invoice\\InvoicePresenter",
    );
  });

  it("does not scan factory presenters without component factory support", async () => {
    const searchText = vi.fn(async () => [
      { path: `${ROOT}/app/UI/Invoice/InvoicePresenter.php` },
    ]);
    const context = makeContext({
      providers: [{ id: "custom" } as PhpFrameworkProvider],
      searchText,
    });

    await expect(currentNettePresenterClassName(context)).resolves.toBeNull();
    expect(searchText).not.toHaveBeenCalled();
  });

  it("drops stale-root factory search results", async () => {
    let active = true;
    const context = makeContext({
      active: () => active,
      searchText: vi.fn(async () => {
        active = false;
        return [{ path: `${ROOT}/app/UI/Invoice/InvoicePresenter.php` }];
      }),
    });

    await expect(currentNettePresenterClassName(context)).resolves.toBeNull();
  });
});

describe("resolveNetteControlVariableDefinition", () => {
  it("opens the current control class declaration for $control", async () => {
    const context = makeContext();

    await expect(resolveNetteControlVariableDefinition(context)).resolves.toBe(
      true,
    );
    expect(context.deps.openTarget).toHaveBeenCalledWith(
      `${ROOT}/app/UI/Invoice/Components/GridControl/GridControl.php`,
      { column: 7, lineNumber: 4 },
      "$control",
    );
  });
});
