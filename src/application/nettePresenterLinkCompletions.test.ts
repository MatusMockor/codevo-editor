import { describe, expect, it, vi } from "vitest";
import {
  nettePresenterActionMethodCandidates,
  nettePresenterClassCandidatePathsForLink,
  parseNetteLinkTarget,
} from "../domain/latteLinkNavigation";
import {
  isNettePresenterDiscoverySourcePath,
  nettePresenterLinkTargetsFromSource,
  type NettePresenterCache,
  type NettePresenterInFlight,
} from "./nettePresenterLinkDiscovery";
import { lattePresenterLinkCompletions } from "./nettePresenterLinkCompletions";
import { normalizeNettePresenterMappings } from "../domain/nettePresenterMapping";

const ROOT = "/ws";

describe("lattePresenterLinkCompletions", () => {
  it("offers trait and inherited DataGrid handlers for a factory-owned template", async () => {
    const ownerPath = `${ROOT}/app/Components/UblabooDatagrid.php`;
    const traitPath = `${ROOT}/app/Components/GridSignals.php`;
    const dataGridPath = `${ROOT}/vendor/ublaboo/datagrid/src/DataGrid.php`;
    const base = emptyContext("app/Notifications/datagrid.latte");
    const completions = await lattePresenterLinkCompletions(
      {
        ...base,
        deps: {
          ...base.deps,
          readPhpClassSource: vi.fn(async (className) => {
            if (className === "GridSignals") {
              return {
                path: traitPath,
                source:
                  "<?php trait GridSignals { public function handleResetFilter(): void {} }",
              };
            }

            if (className === "DataGrid") {
              return {
                path: dataGridPath,
                source:
                  "<?php class DataGrid { public function handlePage(): void {} }",
              };
            }

            return null;
          }),
          resolveDeclaredType: (_source, typeHint) => typeHint,
        },
        loadFactoryTemplateOwner: vi.fn(async () => ({
          className: "App\\Components\\UblabooDatagrid",
          dependencyPaths: [ownerPath],
          factoryPaths: [`${ROOT}/app/Notifications/DatagridFactory.php`],
          path: ownerPath,
          source:
            "<?php class UblabooDatagrid extends DataGrid { use GridSignals; }",
        })),
      },
      { prefix: "", replaceEnd: 0, replaceStart: 0 },
    );

    expect(completions.map((completion) => completion.label)).toEqual([
      "page!",
      "resetFilter!",
    ]);
  });

  it("includes singular Component signals alongside presenter actions", async () => {
    const componentPath = `${ROOT}/app/modules/crossSellModule/Component/CrossSellTransferTimeline/CrossSellTransferTimeline.php`;
    const presenterPath = `${ROOT}/app/CrossSellAdminPresenter.php`;
    const loadFactoryTemplateOwner = vi.fn(async () => ({
      className: "App\\AmbiguousTimeline",
      dependencyPaths: [`${ROOT}/app/AmbiguousTimeline.php`],
      factoryPaths: [`${ROOT}/app/TimelineFactory.php`],
      path: `${ROOT}/app/AmbiguousTimeline.php`,
      source:
        "<?php class AmbiguousTimeline { use FirstSignals, SecondSignals; }",
    }));
    const completions = await lattePresenterLinkCompletions(
      {
        cache: {},
        currentRelativePath:
          "app/modules/crossSellModule/Component/CrossSellTransferTimeline/cross_sell_transfer_timeline.latte",
        deps: {
          getActiveDocument: () => null,
          joinPath: (root, relativePath) => `${root}/${relativePath}`,
          listDirectory: vi.fn(async (path: string) =>
            path === `${ROOT}/app`
              ? [{ kind: "file" as const, path: presenterPath }]
              : [],
          ),
          openTarget: vi.fn(async () => true),
          readFileContent: vi.fn(async (path: string) => {
            if (path === componentPath) {
              return "<?php class CrossSellTransferTimeline { public function handleCancel(): void {} }";
            }

            if (path === presenterPath) {
              return "<?php class CrossSellAdminPresenter { public function actionShow(): void {} }";
            }

            return Promise.reject(new Error(`missing ${path}`));
          }),
          toRelativePath: (root, path) => path.replace(`${root}/`, ""),
        },
        frameworkCapabilities: {
          isPresenterSourcePath: isNettePresenterDiscoverySourcePath,
          parsePresenterLinkTarget: parseNetteLinkTarget,
          presenterActionMethodCandidates: nettePresenterActionMethodCandidates,
          presenterClassCandidatePathsForLink:
            nettePresenterClassCandidatePathsForLink,
          presenterLinkTargetsFromSource: nettePresenterLinkTargetsFromSource,
          presenterScanDirectories: ["app"],
        },
        inFlight: new Map(),
        isDirectorySkipped: () => false,
        isRequestedRootActive: () => true,
        loadFactoryTemplateOwner,
        maxDepth: 1,
        maxPresenters: 10,
        requestedRoot: ROOT,
        ttlMs: 5_000,
      },
      { prefix: "", replaceEnd: 0, replaceStart: 0 },
    );

    expect(completions.map((completion) => completion.label)).toEqual(
      expect.arrayContaining(["cancel!", "CrossSellAdmin:show"]),
    );
    expect(loadFactoryTemplateOwner).not.toHaveBeenCalled();
  });

  it("does not use factory handlers when a conventional component exists without signals", async () => {
    const currentRelativePath =
      "app/modules/crossSellModule/Component/CrossSellTransferTimeline/cross_sell_transfer_timeline.latte";
    const componentPath = `${ROOT}/app/modules/crossSellModule/Component/CrossSellTransferTimeline/CrossSellTransferTimeline.php`;
    const base = emptyContext(currentRelativePath);
    const loadFactoryTemplateOwner = vi.fn(async () => ({
      className: "App\\FactoryTimeline",
      dependencyPaths: [`${ROOT}/app/FactoryTimeline.php`],
      factoryPaths: [`${ROOT}/app/TimelineFactory.php`],
      path: `${ROOT}/app/FactoryTimeline.php`,
      source:
        "<?php class FactoryTimeline { public function handleFactoryOnly(): void {} }",
    }));
    const completions = await lattePresenterLinkCompletions(
      {
        ...base,
        deps: {
          ...base.deps,
          readFileContent: vi.fn(async (path: string) => {
            if (path === componentPath) {
              return "<?php class CrossSellTransferTimeline {}";
            }

            return Promise.reject(new Error(`missing ${path}`));
          }),
        },
        loadFactoryTemplateOwner,
      },
      { prefix: "", replaceEnd: 0, replaceStart: 0 },
    );

    expect(completions).toEqual([]);
    expect(loadFactoryTemplateOwner).not.toHaveBeenCalled();
  });

  it("scans presenters once and offers relative targets for the current presenter", async () => {
    const source = `<?php
class HomePresenter
{
    public function renderDefault(): void {}
    public function actionEdit(): void {}
}
`;
    const cache: NettePresenterCache = {};
    const inFlight: NettePresenterInFlight = new Map();
    const listDirectory = vi.fn(async (path: string) => {
      if (path === `${ROOT}/app`) {
        return [{ kind: "file" as const, path: `${ROOT}/app/HomePresenter.php` }];
      }

      return Promise.reject(new Error(`missing ${path}`));
    });
    const readFileContent = vi.fn(async () => source);

    const completions = await lattePresenterLinkCompletions(
      {
        cache,
        currentRelativePath: "app/HomePresenter.php",
        deps: {
          getActiveDocument: () => ({ path: `${ROOT}/app/HomePresenter.php` }),
          joinPath: (root, relativePath) => `${root}/${relativePath}`,
          listDirectory,
          openTarget: vi.fn(async () => true),
          readFileContent,
          toRelativePath: (root, path) =>
            path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path,
        },
        frameworkCapabilities: {
          isPresenterSourcePath: isNettePresenterDiscoverySourcePath,
          parsePresenterLinkTarget: parseNetteLinkTarget,
          presenterActionMethodCandidates: nettePresenterActionMethodCandidates,
          presenterClassCandidatePathsForLink: nettePresenterClassCandidatePathsForLink,
          presenterLinkTargetsFromSource: nettePresenterLinkTargetsFromSource,
          presenterScanDirectories: ["app"],
        },
        inFlight,
        isDirectorySkipped: () => false,
        isRequestedRootActive: () => true,
        loadFactoryTemplateOwner: vi.fn(async () => null),
        maxDepth: 12,
        maxPresenters: 100,
        requestedRoot: ROOT,
        ttlMs: 5000,
      },
      { prefix: "", replaceEnd: 1, replaceStart: 1 },
    );

    expect(completions.map((completion) => completion.label)).toEqual([
      "default",
      "edit",
      "Home:default",
      "Home:edit",
    ]);
    expect(readFileContent).toHaveBeenCalledTimes(1);
  });

  it("reverse-maps presenter classes to logical completion names", async () => {
    const source = `<?php
namespace Crm\\RempMailerModule\\Presenters;
class MailTemplatesAdminPresenter
{
    public function actionShow(): void {}
}`;
    const completions = await lattePresenterLinkCompletions(
      {
        cache: {},
        currentRelativePath:
          "app/modules/mailerModule/Presenters/MailTemplatesAdminPresenter.php",
        deps: {
          getActiveDocument: () => ({
            path: `${ROOT}/app/modules/mailerModule/Presenters/MailTemplatesAdminPresenter.php`,
          }),
          joinPath: (root, relativePath) => `${root}/${relativePath}`,
          listDirectory: vi.fn(async (path: string) =>
            path === `${ROOT}/app`
              ? [{ kind: "file" as const, path: `${ROOT}/app/MailTemplatesAdminPresenter.php` }]
              : [],
          ),
          openTarget: vi.fn(async () => true),
          readFileContent: vi.fn(async () => source),
          toRelativePath: (root, path) => path.replace(`${root}/`, ""),
        },
        frameworkCapabilities: {
          isPresenterSourcePath: isNettePresenterDiscoverySourcePath,
          parsePresenterLinkTarget: parseNetteLinkTarget,
          presenterActionMethodCandidates: nettePresenterActionMethodCandidates,
          presenterClassCandidatePathsForLink: nettePresenterClassCandidatePathsForLink,
          presenterLinkTargetsFromSource: nettePresenterLinkTargetsFromSource,
          presenterScanDirectories: ["app"],
        },
        inFlight: new Map(),
        isDirectorySkipped: () => false,
        isRequestedRootActive: () => true,
        loadFactoryTemplateOwner: vi.fn(async () => null),
        loadPresenterMappings: async () =>
          normalizeNettePresenterMappings([
            [
              "RempMailer",
              "Crm\\RempMailerModule\\Presenters\\*Presenter",
            ],
          ]),
        maxDepth: 1,
        maxPresenters: 10,
        requestedRoot: ROOT,
        ttlMs: 5_000,
      },
      { prefix: "", replaceEnd: 0, replaceStart: 0 },
    );

    expect(completions.map((completion) => completion.label)).toEqual([
      ":RempMailer:MailTemplatesAdmin:show",
      "MailTemplatesAdmin:show",
      "show",
    ]);
    expect(completions.map((completion) => completion.insertText))
      .not.toContain("RempMailer:MailTemplatesAdmin:show");
  });

  it("preserves distinct safe absolute names for ambiguous reverse mappings", async () => {
    const source = `<?php
namespace Shared\\Presenters;
class DashboardPresenter
{
    public function actionShow(): void {}
}`;
    const completions = await lattePresenterLinkCompletions(
      {
        cache: {},
        currentRelativePath: "templates/widget.latte",
        deps: {
          getActiveDocument: () => ({ path: `${ROOT}/templates/widget.latte` }),
          joinPath: (root, relativePath) => `${root}/${relativePath}`,
          listDirectory: vi.fn(async (path: string) =>
            path === `${ROOT}/app`
              ? [{ kind: "file" as const, path: `${ROOT}/app/DashboardPresenter.php` }]
              : [],
          ),
          openTarget: vi.fn(async () => true),
          readFileContent: vi.fn(async () => source),
          toRelativePath: (root, path) => path.replace(`${root}/`, ""),
        },
        frameworkCapabilities: {
          isPresenterSourcePath: isNettePresenterDiscoverySourcePath,
          parsePresenterLinkTarget: parseNetteLinkTarget,
          presenterActionMethodCandidates: nettePresenterActionMethodCandidates,
          presenterClassCandidatePathsForLink: nettePresenterClassCandidatePathsForLink,
          presenterLinkTargetsFromSource: nettePresenterLinkTargetsFromSource,
          presenterScanDirectories: ["app"],
        },
        inFlight: new Map(),
        isDirectorySkipped: () => false,
        isRequestedRootActive: () => true,
        loadFactoryTemplateOwner: vi.fn(async () => null),
        loadPresenterMappings: async () => [
          ...normalizeNettePresenterMappings([
            ["Api", "Shared\\Presenters\\*Presenter"],
          ]),
          ...normalizeNettePresenterMappings([
            ["Legacy", "Shared\\Presenters\\*Presenter"],
          ]),
        ],
        maxDepth: 1,
        maxPresenters: 10,
        requestedRoot: ROOT,
        ttlMs: 5_000,
      },
      { prefix: "", replaceEnd: 0, replaceStart: 0 },
    );

    expect(completions.map((completion) => completion.label)).toEqual([
      ":Api:Dashboard:show",
      ":Legacy:Dashboard:show",
    ]);
  });
});

function emptyContext(currentRelativePath: string) {
  return {
    cache: {},
    currentRelativePath,
    deps: {
      getActiveDocument: () => null,
      joinPath: (root: string, relativePath: string) => `${root}/${relativePath}`,
      listDirectory: vi.fn(async () => []),
      openTarget: vi.fn(async () => true),
      readFileContent: vi.fn(async () => {
        return Promise.reject(new Error("missing"));
      }),
      toRelativePath: (root: string, path: string) => path.replace(`${root}/`, ""),
    },
    frameworkCapabilities: {
      isPresenterSourcePath: isNettePresenterDiscoverySourcePath,
      parsePresenterLinkTarget: parseNetteLinkTarget,
      presenterActionMethodCandidates: nettePresenterActionMethodCandidates,
      presenterClassCandidatePathsForLink: nettePresenterClassCandidatePathsForLink,
      presenterLinkTargetsFromSource: nettePresenterLinkTargetsFromSource,
      presenterScanDirectories: [] as string[],
    },
    inFlight: new Map(),
    isDirectorySkipped: () => false,
    isRequestedRootActive: () => true,
    loadFactoryTemplateOwner: vi.fn(async () => null),
    maxDepth: 1,
    maxPresenters: 1,
    requestedRoot: ROOT,
    ttlMs: 5_000,
  };
}

describe("lattePresenterLinkCompletions — named parameters", () => {
  const productSource = `<?php
class ProductPresenter extends BasePresenter
{
    #[Persistent]
    public ?string $lang = null;

    public function actionShow(string $sort): void {}
}`;
  const basePresenterSource = `<?php
class BasePresenter
{
    #[Persistent]
    public int $page = 1;
}`;

  function parameterContext(
    overrides: { readFileContent?: (path: string) => Promise<string> } = {},
  ) {
    const base = emptyContext("app/Presenters/HomePresenter.php");

    return {
      ...base,
      deps: {
        ...base.deps,
        readFileContent: vi.fn(async (path: string) => {
          if (path === `${ROOT}/app/Presenters/ProductPresenter.php`) {
            return productSource;
          }

          return Promise.reject(new Error(`missing ${path}`));
        }),
        readPhpClassSource: vi.fn(async (className: string) =>
          className === "BasePresenter"
            ? {
                path: `${ROOT}/app/Presenters/BasePresenter.php`,
                source: basePresenterSource,
              }
            : null,
        ),
        resolveDeclaredType: (_source: string, typeHint: string | null) =>
          typeHint,
        ...overrides,
      },
    };
  }

  it("offers action parameters and inherited persistent parameters for a target", async () => {
    const completions = await lattePresenterLinkCompletions(parameterContext(), {
      parameter: { target: "Product:show" },
      prefix: "",
      replaceEnd: 21,
      replaceStart: 21,
    });

    expect(
      completions.map((completion) => [completion.label, completion.detail]),
    ).toEqual([
      ["sort", "action parameter"],
      ["lang", "persistent"],
      ["page", "persistent"],
    ]);
    expect(completions[0]).toMatchObject({
      insertText: "sort",
      kind: "link",
      replaceEnd: 21,
      replaceStart: 21,
    });
  });

  it("filters parameter completions by prefix", async () => {
    const completions = await lattePresenterLinkCompletions(parameterContext(), {
      parameter: { target: "Product:show" },
      prefix: "pa",
      replaceEnd: 23,
      replaceStart: 21,
    });

    expect(completions.map((completion) => completion.label)).toEqual(["page"]);
  });

  it("lets an action parameter win over a same-named persistent parameter", async () => {
    const clashSource = `<?php
class ProductPresenter
{
    #[Persistent]
    public ?string $lang = null;

    public function actionShow(string $lang): void {}
}`;
    const completions = await lattePresenterLinkCompletions(
      parameterContext({
        readFileContent: vi.fn(async () => clashSource),
      }),
      {
        parameter: { target: "Product:show" },
        prefix: "",
        replaceEnd: 21,
        replaceStart: 21,
      },
    );

    expect(
      completions.map((completion) => [completion.label, completion.detail]),
    ).toEqual([["lang", "action parameter"]]);
  });

  it("offers persistent parameters of the current presenter for a `this` target", async () => {
    const base = emptyContext("app/Presenters/ProductPresenter.php");
    const completions = await lattePresenterLinkCompletions(
      {
        ...base,
        deps: {
          ...base.deps,
          readFileContent: vi.fn(async (path: string) => {
            if (path === `${ROOT}/app/Presenters/ProductPresenter.php`) {
              return productSource;
            }

            return Promise.reject(new Error(`missing ${path}`));
          }),
        },
      },
      {
        parameter: { target: "this" },
        prefix: "",
        replaceEnd: 10,
        replaceStart: 10,
      },
    );

    expect(completions.map((completion) => completion.label)).toEqual(["lang"]);
    expect(completions[0]?.detail).toBe("persistent");
  });

  it("offers component signal parameters and component persistent parameters", async () => {
    const componentPath = `${ROOT}/app/Components/CartControl/CartControl.php`;
    const base = emptyContext("app/Components/CartControl/cart_control.latte");
    const completions = await lattePresenterLinkCompletions(
      {
        ...base,
        deps: {
          ...base.deps,
          readFileContent: vi.fn(async (path: string) => {
            if (path === componentPath) {
              return `<?php
class CartControl
{
    #[Persistent]
    public int $visibleCount = 5;

    public function handleShowMore(int $count): void {}
}`;
            }

            return Promise.reject(new Error(`missing ${path}`));
          }),
        },
      },
      {
        parameter: { target: "showMore!" },
        prefix: "",
        replaceEnd: 15,
        replaceStart: 15,
      },
    );

    expect(
      completions.map((completion) => [completion.label, completion.detail]),
    ).toEqual([
      ["count", "action parameter"],
      ["visibleCount", "persistent"],
    ]);
  });

  it("returns nothing after the requested root becomes inactive", async () => {
    let active = true;
    const context = parameterContext({
      readFileContent: vi.fn(async () => {
        active = false;
        return productSource;
      }),
    });

    await expect(
      lattePresenterLinkCompletions(
        { ...context, isRequestedRootActive: () => active },
        {
          parameter: { target: "Product:show" },
          prefix: "",
          replaceEnd: 21,
          replaceStart: 21,
        },
      ),
    ).resolves.toEqual([]);
  });
});
