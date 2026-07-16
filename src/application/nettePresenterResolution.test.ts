import { describe, expect, it, vi } from "vitest";
import {
  nettePresenterClassCandidatePathsForLink,
  parseNetteLinkTarget,
} from "../domain/latteLinkNavigation";
import { normalizeNettePresenterMappings } from "../domain/nettePresenterMapping";
import {
  resolveNettePresenterOwner,
  type NettePresenterResolutionContext,
} from "./nettePresenterResolution";

const ROOT = "/ws";
const MAPPINGS = normalizeNettePresenterMappings([
  ["*", "Crm\\*Module\\Presenters\\*Presenter"],
  ["RempMailer", "Crm\\RempMailerModule\\Presenters\\*Presenter"],
  [
    "Efabrica",
    ["Efabrica\\Crm", "*Module\\Presenters", "**Presenter"],
  ],
  ["O2Integration", "Crm\\O2IntegrationModule\\Presenters\\*Presenter"],
]);

describe("resolveNettePresenterOwner", () => {
  it("uses a complete factory hierarchy for a bare datagrid signal", async () => {
    const ownerPath = `${ROOT}/app/Components/UblabooDatagrid.php`;
    const dataGridPath = `${ROOT}/vendor/ublaboo/datagrid/src/DataGrid.php`;
    const owner = await resolveNettePresenterOwner(
      context({
        currentRelativePath: "app/Notifications/datagrid.latte",
        loadFactoryTemplateOwner: vi.fn(async () => ({
          className: "App\\Components\\UblabooDatagrid",
          dependencyPaths: [ownerPath],
          factoryPaths: [`${ROOT}/app/Notifications/DatagridFactory.php`],
          path: ownerPath,
          source: "<?php class UblabooDatagrid extends DataGrid {}",
        })),
        readPhpClassSource: vi.fn(async (className) =>
          className === "DataGrid"
            ? {
                path: dataGridPath,
                source:
                  "<?php class DataGrid { public function handlePage(): void {} }",
              }
            : null,
        ),
      }),
      parsed("page!"),
    );

    expect(owner?.path).toBe(ownerPath);
    expect(owner?.factoryHierarchy?.sources.map((source) => source.path)).toEqual([
      ownerPath,
      dataGridPath,
    ]);
  });

  it("keeps explicit presenter signals on presenter resolution semantics", async () => {
    const loadFactoryTemplateOwner = vi.fn(async () => {
      throw new Error("explicit presenter signals must not load a factory owner");
    });
    const owner = await resolveNettePresenterOwner(
      context({
        files: {
          "app/UI/Product/ProductPresenter.php":
            "<?php class ProductPresenter { public function handleDelete(): void {} }",
        },
        loadFactoryTemplateOwner,
        mappings: [],
      }),
      parsed("Product:delete!"),
    );

    expect(owner?.path).toBe(`${ROOT}/app/UI/Product/ProductPresenter.php`);
    expect(loadFactoryTemplateOwner).not.toHaveBeenCalled();
  });

  it("keeps a conventional component ahead of a complete factory owner", async () => {
    const componentRelativePath =
      "app/modules/crossSellModule/Component/CrossSellTransferTimeline/CrossSellTransferTimeline.php";
    const loadFactoryTemplateOwner = vi.fn(async () => ({
      className: "App\\Components\\FactoryTimeline",
      dependencyPaths: [`${ROOT}/app/Components/FactoryTimeline.php`],
      factoryPaths: [`${ROOT}/app/Components/TimelineFactory.php`],
      path: `${ROOT}/app/Components/FactoryTimeline.php`,
      source:
        "<?php class FactoryTimeline { public function handleCancel(): void {} }",
    }));
    const owner = await resolveNettePresenterOwner(
      context({
        currentRelativePath:
          "app/modules/crossSellModule/Component/CrossSellTransferTimeline/cross_sell_transfer_timeline.latte",
        files: {
          [componentRelativePath]:
            "<?php class CrossSellTransferTimeline { public function handleCancel(): void {} }",
        },
        loadFactoryTemplateOwner,
        mappings: [],
      }),
      parsed("cancel!"),
    );

    expect(owner?.path).toBe(`${ROOT}/${componentRelativePath}`);
    expect(loadFactoryTemplateOwner).not.toHaveBeenCalled();
  });

  it("does not let an ambiguous factory suppress a valid conventional component", async () => {
    const componentRelativePath =
      "app/modules/crossSellModule/Component/CrossSellTransferTimeline/CrossSellTransferTimeline.php";
    const loadFactoryTemplateOwner = vi.fn(async () => ({
      className: "App\\Components\\AmbiguousTimeline",
      dependencyPaths: [`${ROOT}/app/Components/AmbiguousTimeline.php`],
      factoryPaths: [`${ROOT}/app/Components/TimelineFactory.php`],
      path: `${ROOT}/app/Components/AmbiguousTimeline.php`,
      source:
        "<?php class AmbiguousTimeline { use FirstSignals, SecondSignals; }",
    }));
    const owner = await resolveNettePresenterOwner(
      context({
        currentRelativePath:
          "app/modules/crossSellModule/Component/CrossSellTransferTimeline/cross_sell_transfer_timeline.latte",
        files: {
          [componentRelativePath]:
            "<?php class CrossSellTransferTimeline { public function handleCancel(): void {} }",
        },
        loadFactoryTemplateOwner,
        mappings: [],
      }),
      parsed("cancel!"),
    );

    expect(owner?.path).toBe(`${ROOT}/${componentRelativePath}`);
    expect(loadFactoryTemplateOwner).not.toHaveBeenCalled();
  });

  it("resolves the exact ebox RempMailer link before wildcard and convention", async () => {
    const readPhpClassSource = vi.fn(async (className: string) =>
      className ===
      "Crm\\RempMailerModule\\Presenters\\MailTemplatesAdminPresenter"
        ? {
            path: `${ROOT}/app/modules/mailerModule/Presenters/MailTemplatesAdminPresenter.php`,
            source: "<?php function actionShow() {}",
          }
        : null,
    );
    const owner = await resolveNettePresenterOwner(
      context({ readPhpClassSource }),
      parsed(":RempMailer:MailTemplatesAdmin:show"),
    );

    expect(owner?.path).toContain("MailTemplatesAdminPresenter.php");
    expect(readPhpClassSource.mock.calls.map(([name]) => name)).toEqual([
      "Crm\\RempMailerModule\\Presenters\\MailTemplatesAdminPresenter",
    ]);
  });

  it("does not fall through an exact mapping to wildcard or convention", async () => {
    const wildcardClass =
      "Crm\\O2IntegrationModule\\Presenters\\DashboardPresenter";
    const readPhpClassSource = vi.fn(async (className: string) =>
      className === wildcardClass
        ? { path: `${ROOT}/vendor/DashboardPresenter.php`, source: "<?php" }
        : null,
    );
    const owner = await resolveNettePresenterOwner(
      context({
        mappings: normalizeNettePresenterMappings([
          ["O2Integration", "Missing\\*Presenter"],
          ["*", "Crm\\*Module\\Presenters\\*Presenter"],
        ]),
        readPhpClassSource,
      }),
      parsed(":O2Integration:Dashboard:default"),
    );

    expect(owner).toBeNull();
    expect(readPhpClassSource).toHaveBeenNthCalledWith(
      1,
      "Missing\\DashboardPresenter",
    );
    expect(readPhpClassSource).not.toHaveBeenCalledWith(wildcardClass);
    expect(readPhpClassSource).toHaveBeenCalledTimes(1);
  });

  it("preserves current-module semantics for relative presenter links", async () => {
    const readPhpClassSource = vi.fn(async (className: string) => ({
      path: `${ROOT}/${className}.php`,
      source: "<?php",
    }));
    const owner = await resolveNettePresenterOwner(
      context({
        currentRelativePath:
          "app/modules/mailerModule/templates/MailLogs/default.latte",
        files: {
          "app/modules/mailerModule/Presenters/MailLogsPresenter.php": String.raw`<?php
namespace Crm\RempMailerModule\Presenters;
class MailLogsPresenter {}`,
        },
        readPhpClassSource,
      }),
      parsed("MailTemplatesAdmin:show"),
    );

    expect(owner).not.toBeNull();
    expect(readPhpClassSource).toHaveBeenCalledWith(
      "Crm\\RempMailerModule\\Presenters\\MailTemplatesAdminPresenter",
    );
  });

  it("resolves Efabrica double-star mappings and convention fallback", async () => {
    const expected =
      "Efabrica\\Crm\\PaymentsModule\\Presenters\\Dashboard\\DashboardPresenter";
    const mapped = await resolveNettePresenterOwner(
      context({
        readPhpClassSource: vi.fn(async (className: string) =>
          className === expected
            ? { path: `${ROOT}/mapped.php`, source: "<?php" }
            : null,
        ),
      }),
      parsed(":Efabrica:Payments:Dashboard:default"),
    );
    const fallback = await resolveNettePresenterOwner(
      context({
        files: { "app/UI/Product/ProductPresenter.php": "<?php class ProductPresenter {}" },
        mappings: [],
        readPhpClassSource: undefined,
      }),
      parsed("Product:show"),
    );

    expect(mapped?.path).toBe(`${ROOT}/mapped.php`);
    expect(fallback?.path).toBe(`${ROOT}/app/UI/Product/ProductPresenter.php`);
  });

  it("refuses ambiguous applicable mappings instead of guessing by order", async () => {
    const readPhpClassSource = vi.fn(async () => null);
    const owner = await resolveNettePresenterOwner(
      context({
        files: {
          "app/UI/Dashboard/DashboardPresenter.php":
            "<?php class DashboardPresenter {}",
        },
        mappings: [
          ...normalizeNettePresenterMappings([
            ["Api", "App\\Api\\*Presenter"],
          ]),
          ...normalizeNettePresenterMappings([
            ["Api", "Vendor\\Api\\*Presenter"],
          ]),
        ],
        readPhpClassSource,
      }),
      parsed(":Api:Dashboard:default"),
    );

    expect(owner).toBeNull();
    expect(readPhpClassSource).not.toHaveBeenCalled();
  });

  it("drops a resolution when its mapping generation becomes stale", async () => {
    let current = true;
    const owner = await resolveNettePresenterOwner(
      {
        ...context({
          readPhpClassSource: vi.fn(async () => {
            current = false;
            return { path: `${ROOT}/mapped.php`, source: "<?php" };
          }),
        }),
        isPresenterMappingGenerationCurrent: () => current,
      },
      parsed(":RempMailer:Dashboard:default"),
    );

    expect(owner).toBeNull();
  });
});

function parsed(target: string) {
  const result = parseNetteLinkTarget(target);

  if (!result) {
    throw new Error(`Unable to parse ${target}`);
  }

  return result;
}

function context(
  options: {
    currentRelativePath?: string;
    files?: Record<string, string>;
    mappings?: typeof MAPPINGS;
    loadFactoryTemplateOwner?: NettePresenterResolutionContext["loadFactoryTemplateOwner"];
    readPhpClassSource?: NettePresenterResolutionContext["deps"]["readPhpClassSource"];
  } = {},
): NettePresenterResolutionContext {
  const files = options.files ?? {};

  return {
    currentRelativePath:
      options.currentRelativePath ?? "app/UI/Product/default.latte",
    deps: {
      joinPath: (root, relativePath) => `${root}/${relativePath}`,
      readFileContent: async (path) => {
        const relative = path.slice(ROOT.length + 1);
        const source = files[relative];

        if (source === undefined) {
          throw new Error(`missing ${path}`);
        }

        return source;
      },
      ...(options.readPhpClassSource
        ? { readPhpClassSource: options.readPhpClassSource }
        : {}),
      resolveDeclaredType: (_source, typeHint) => typeHint,
    },
    frameworkCapabilities: {
      presenterClassCandidatePathsForLink:
        nettePresenterClassCandidatePathsForLink,
    },
    isRequestedRootActive: () => true,
    loadFactoryTemplateOwner:
      options.loadFactoryTemplateOwner ?? vi.fn(async () => null),
    loadPresenterMappings: async () => options.mappings ?? MAPPINGS,
    requestedRoot: ROOT,
  };
}
