import { describe, expect, it, vi } from "vitest";
import {
  nettePresenterActionMethodCandidates,
  nettePresenterClassCandidatePathsForLink,
  parseNetteLinkTarget,
} from "../domain/latteLinkNavigation";
import {
  nettePresenterLinkDiagnostics,
  type NettePresenterLinkDiagnosticContext,
} from "./nettePresenterLinkDiagnostics";
import { normalizeNettePresenterMappings } from "../domain/nettePresenterMapping";

const ROOT = "/ws";
const CURRENT_TEMPLATE = "app/UI/Product/default.latte";

describe("nettePresenterLinkDiagnostics", () => {
  it("accepts inherited datagrid signals from a complete factory hierarchy", async () => {
    const ownerPath = `${ROOT}/app/Components/UblabooDatagrid.php`;
    const diagnostics = await nettePresenterLinkDiagnostics(
      context({
        currentRelativePath: "app/Notifications/datagrid.latte",
        files: {},
        loadFactoryTemplateOwner: vi.fn(async () => ({
          className: "App\\Components\\UblabooDatagrid",
          dependencyPaths: [ownerPath],
          factoryPaths: [`${ROOT}/app/Notifications/DatagridFactory.php`],
          path: ownerPath,
          source:
            "<?php class UblabooDatagrid extends DataGrid { use GridSignals; }",
        })),
        readPhpClassSource: vi.fn(async (className) => {
          if (className === "GridSignals") {
            return {
              path: `${ROOT}/app/Components/GridSignals.php`,
              source:
                "<?php trait GridSignals { public function handleResetFilter(): void {} }",
            };
          }

          if (className === "DataGrid") {
            return {
              path: `${ROOT}/vendor/ublaboo/datagrid/src/DataGrid.php`,
              source:
                "<?php class DataGrid { public function handlePage(): void {} }",
            };
          }

          return null;
        }),
      }),
      `{link page!}\n{link resetFilter!}`,
    );

    expect(diagnostics).toEqual([]);
  });

  it("suppresses missing-signal diagnostics for an incomplete factory hierarchy", async () => {
    const ownerPath = `${ROOT}/app/Components/Grid.php`;
    const diagnostics = await nettePresenterLinkDiagnostics(
      context({
        currentRelativePath: "app/Notifications/datagrid.latte",
        files: {},
        loadFactoryTemplateOwner: vi.fn(async () => ({
          className: "App\\Components\\Grid",
          dependencyPaths: [ownerPath],
          factoryPaths: [`${ROOT}/app/Notifications/DatagridFactory.php`],
          path: ownerPath,
          source: "<?php class Grid extends MissingGridBase {}",
        })),
        readPhpClassSource: vi.fn(async () => null),
      }),
      `{link page!}`,
    );

    expect(diagnostics).toEqual([]);
  });

  it("warns for a missing signal only when the factory hierarchy is complete", async () => {
    const ownerPath = `${ROOT}/app/Components/Grid.php`;
    const diagnostics = await nettePresenterLinkDiagnostics(
      context({
        currentRelativePath: "app/Notifications/datagrid.latte",
        files: {},
        loadFactoryTemplateOwner: vi.fn(async () => ({
          className: "App\\Components\\Grid",
          dependencyPaths: [ownerPath],
          factoryPaths: [`${ROOT}/app/Notifications/DatagridFactory.php`],
          path: ownerPath,
          source: "<?php class Grid {}",
        })),
      }),
      `{link page!}`,
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "nette.missingPresenterMethod",
      data: {
        candidateMethodNames: ["handlePage"],
        kind: "missing-presenter-method",
        presenterPath: ownerPath,
        target: "page!",
      },
    });
  });

  it("warns when a static action link resolves to an existing presenter without an action or render method", async () => {
    const diagnostics = await runDiagnostics(
      `{link Product:show}`,
      {
        "app/UI/Product/ProductPresenter.php": `<?php
class ProductPresenter
{
    public function startup(): void {}
}
`,
      },
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "nette.missingPresenterMethod",
      data: {
        candidateMethodNames: ["actionShow", "renderShow"],
        kind: "missing-presenter-method",
        presenterPath: `${ROOT}/app/UI/Product/ProductPresenter.php`,
        target: "Product:show",
      },
      message:
        "Nette presenter link Product:show resolves to /ws/app/UI/Product/ProductPresenter.php, but actionShow or renderShow was not found.",
      severity: "warning",
      source: "Nette",
    });
  });

  it("accepts existing action and render methods for normal action links", async () => {
    const actionDiagnostics = await runDiagnostics(
      `{link Product:show}`,
      {
        "app/UI/Product/ProductPresenter.php": `<?php
class ProductPresenter
{
    public function actionShow(): void {}
}
`,
      },
    );
    const renderDiagnostics = await runDiagnostics(
      `{link Product:show}`,
      {
        "app/UI/Product/ProductPresenter.php": `<?php
class ProductPresenter
{
    public function renderShow(): void {}
}
`,
      },
    );

    expect(actionDiagnostics).toEqual([]);
    expect(renderDiagnostics).toEqual([]);
  });

  it("skips presenters whose action could be inherited from an app base presenter", async () => {
    const diagnostics = await runDiagnostics(
      `{link Product:show}`,
      {
        "app/UI/Product/ProductPresenter.php": `<?php
class ProductPresenter extends BasePresenter
{
}
`,
      },
    );

    expect(diagnostics).toEqual([]);
  });

  it("skips presenters whose action could be provided by a trait", async () => {
    const diagnostics = await runDiagnostics(
      `{link Product:show}`,
      {
        "app/UI/Product/ProductPresenter.php": `<?php
class ProductPresenter extends Presenter
{
    use ProductActions;
}
`,
      },
    );

    expect(diagnostics).toEqual([]);
  });

  it("skips presenters whose trait use appears after an existing method", async () => {
    const diagnostics = await runDiagnostics(
      `{link Product:show}`,
      {
        "app/UI/Product/ProductPresenter.php": `<?php
class ProductPresenter extends Presenter
{
    public function startup(): void {}

    use ProductActions;
}
`,
      },
    );

    expect(diagnostics).toEqual([]);
  });

  it("keeps direct Nette presenter subclasses eligible for local diagnostics", async () => {
    const diagnostics = await runDiagnostics(
      `{link Product:show}`,
      {
        "app/UI/Product/ProductPresenter.php": `<?php
class ProductPresenter extends \\Nette\\Application\\UI\\Presenter
{
}
`,
      },
    );

    expect(diagnostics).toHaveLength(1);
  });

  it("requires handle methods for signal links", async () => {
    const diagnostics = await runDiagnostics(
      `{link Product:delete!}`,
      {
        "app/UI/Product/ProductPresenter.php": `<?php
class ProductPresenter
{
    public function actionDelete(): void {}
    public function renderDelete(): void {}
}
`,
      },
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.data).toMatchObject({
      candidateMethodNames: ["handleDelete"],
      presenterPath: `${ROOT}/app/UI/Product/ProductPresenter.php`,
      target: "Product:delete!",
    });
  });

  it("accepts component-relative signal links handled by the component class", async () => {
    const loadFactoryTemplateOwner = vi.fn(async () => ({
      className: "App\\AmbiguousApiListing",
      dependencyPaths: [`${ROOT}/app/Components/AmbiguousApiListing.php`],
      factoryPaths: [`${ROOT}/app/Components/ApiListingFactory.php`],
      path: `${ROOT}/app/Components/AmbiguousApiListing.php`,
      source:
        "<?php class AmbiguousApiListing { use FirstSignals, SecondSignals; }",
    }));
    const diagnostics = await nettePresenterLinkDiagnostics(
      context({
        currentRelativePath:
          "app/modules/apiModule/Components/api_listing.latte",
        files: {
          "app/modules/apiModule/Components/ApiListingControl.php": `<?php
class ApiListingControl
{
    public function handleSelect($id): void {}
}
`,
        },
        loadFactoryTemplateOwner,
      }),
      `{link Select! 1}`,
    );

    expect(diagnostics).toEqual([]);
    expect(loadFactoryTemplateOwner).not.toHaveBeenCalled();
  });

  it("skips dynamic links, this links, and unsafe current-presenter relative targets", async () => {
    const readFileContent = vi.fn(async () => {
      throw new Error("should not read");
    });
    const diagnostics = await nettePresenterLinkDiagnostics(
      context({
        currentRelativePath: "templates/default.latte",
        files: {},
        readFileContent,
      }),
      `{link $target}
{link this}
{link show}`,
    );

    expect(diagnostics).toEqual([]);
    expect(readFileContent).not.toHaveBeenCalled();
  });

  it("skips missing presenter files", async () => {
    const readFileContent = vi.fn(async () => {
      throw new Error("missing");
    });
    const diagnostics = await nettePresenterLinkDiagnostics(
      context({ files: {}, readFileContent }),
      `{link Product:show}`,
    );

    expect(diagnostics).toEqual([]);
    expect(readFileContent).toHaveBeenCalled();
  });

  it("reads the same presenter only once for duplicate links", async () => {
    const readFileContent = vi.fn(async () => `<?php
class ProductPresenter
{
}
`);

    const diagnostics = await nettePresenterLinkDiagnostics(
      context({ files: {}, readFileContent }),
      `{link Product:show}
{plink Product:show}
<a n:href="Product:show">`,
    );

    expect(diagnostics).toHaveLength(3);
    expect(readFileContent).toHaveBeenCalledTimes(1);
  });

  it("drops diagnostics when the requested root becomes stale", async () => {
    let active = true;
    const readFileContent = vi.fn(async () => {
      active = false;

      return `<?php
class ProductPresenter
{
}
`;
    });

    const diagnostics = await nettePresenterLinkDiagnostics(
      context({
        files: {},
        isRequestedRootActive: () => active,
        readFileContent,
      }),
      `{link Product:show}`,
    );

    expect(diagnostics).toEqual([]);
  });

  it("checks a mapped presenter through the shared resolution service", async () => {
    const diagnostics = await nettePresenterLinkDiagnostics(
      {
        ...context({ files: {} }),
        deps: {
          ...context({ files: {} }).deps,
          readPhpClassSource: vi.fn(async () => ({
            path: `${ROOT}/app/modules/mailerModule/Presenters/MailTemplatesAdminPresenter.php`,
            source: `<?php
class MailTemplatesAdminPresenter
{
    public function actionShow(): void {}
}`,
          })),
        },
        loadPresenterMappings: async () =>
          normalizeNettePresenterMappings([
            [
              "RempMailer",
              "Crm\\RempMailerModule\\Presenters\\*Presenter",
            ],
          ]),
      },
      `{link :RempMailer:MailTemplatesAdmin:show}`,
    );

    expect(diagnostics).toEqual([]);
  });

  it("drops mapped diagnostics after mapping invalidation", async () => {
    let current = true;
    const base = context({ files: {} });
    const diagnostics = await nettePresenterLinkDiagnostics(
      {
        ...base,
        deps: {
          ...base.deps,
          readPhpClassSource: vi.fn(async () => {
            current = false;
            return {
              path: `${ROOT}/MailTemplatesAdminPresenter.php`,
              source: "<?php class MailTemplatesAdminPresenter {}",
            };
          }),
        },
        isPresenterMappingGenerationCurrent: () => current,
        loadPresenterMappings: async () =>
          normalizeNettePresenterMappings([
            [
              "RempMailer",
              "Crm\\RempMailerModule\\Presenters\\*Presenter",
            ],
          ]),
      },
      `{link :RempMailer:MailTemplatesAdmin:show}`,
    );

    expect(diagnostics).toEqual([]);
  });
});

async function runDiagnostics(
  source: string,
  files: Record<string, string>,
) {
  return nettePresenterLinkDiagnostics(context({ files }), source);
}

function context(
  options: {
    currentRelativePath?: string;
    files: Record<string, string>;
    isRequestedRootActive?: () => boolean;
    loadFactoryTemplateOwner?: NettePresenterLinkDiagnosticContext["loadFactoryTemplateOwner"];
    readFileContent?: (path: string) => Promise<string>;
    readPhpClassSource?: NettePresenterLinkDiagnosticContext["deps"]["readPhpClassSource"];
  },
): NettePresenterLinkDiagnosticContext {
  return {
    currentRelativePath: options.currentRelativePath ?? CURRENT_TEMPLATE,
    deps: {
      joinPath: (root, relativePath) => `${root}/${relativePath}`,
      readFileContent:
        options.readFileContent ??
        (async (path) => {
          const relativePath = path.startsWith(`${ROOT}/`)
            ? path.slice(ROOT.length + 1)
            : path;
          const source = options.files[relativePath];

          if (source === undefined) {
            throw new Error(`missing ${path}`);
          }

          return source;
        }),
      readPhpClassSource: options.readPhpClassSource,
      resolveDeclaredType: (_source, typeHint) => typeHint,
    },
    frameworkCapabilities: {
      parsePresenterLinkTarget: parseNetteLinkTarget,
      presenterActionMethodCandidates: nettePresenterActionMethodCandidates,
      presenterClassCandidatePathsForLink: nettePresenterClassCandidatePathsForLink,
    },
    isRequestedRootActive: options.isRequestedRootActive ?? (() => true),
    loadFactoryTemplateOwner:
      options.loadFactoryTemplateOwner ?? vi.fn(async () => null),
    requestedRoot: ROOT,
  };
}
