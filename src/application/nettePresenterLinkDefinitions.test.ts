import { describe, expect, it, vi } from "vitest";
import {
  nettePresenterActionMethodCandidates,
  nettePresenterClassCandidatePathsForLink,
  parseNetteLinkTarget,
} from "../domain/latteLinkNavigation";
import { normalizeNettePresenterMappings } from "../domain/nettePresenterMapping";
import {
  resolveNettePresenterLink,
  type NettePresenterLinkDefinitionContext,
} from "./nettePresenterLinkDefinitions";
import type { NettePresenterDiscoveryContext } from "./nettePresenterLinkDiscovery";
import type { NetteFactoryTemplateOwner } from "./netteFactoryTemplateOwners";

describe("resolveNettePresenterLink", () => {
  it("opens an inherited datagrid signal at its exact factory hierarchy source", async () => {
    const ownerPath = "/ws/app/Components/UblabooDatagrid.php";
    const dataGridPath = "/ws/vendor/ublaboo/datagrid/src/DataGrid.php";
    const openTarget = vi.fn(async () => true);
    const context = mappedDefinitionContext(
      openTarget,
      vi.fn(async (className) =>
        className === "DataGrid"
          ? {
              path: dataGridPath,
              source: `<?php
class DataGrid
{
    public function handlePage(): void {}
}`,
            }
          : null,
      ),
      () => true,
      vi.fn(async () => ({
        className: "App\\Components\\UblabooDatagrid",
        dependencyPaths: [ownerPath],
        factoryPaths: ["/ws/app/Notifications/DatagridFactory.php"],
        path: ownerPath,
        source: "<?php class UblabooDatagrid extends DataGrid {}",
      })),
      "app/Notifications/datagrid.latte",
    );

    await expect(
      resolveNettePresenterLink(context, parseNetteLinkTarget("page!"), "page!"),
    ).resolves.toBe(true);
    expect(openTarget).toHaveBeenCalledWith(
      dataGridPath,
      { column: 21, lineNumber: 4 },
      "page!",
    );
  });

  it("resolves singular Component signals without taking ownership of presenter actions", async () => {
    const componentPath =
      "/ws/app/modules/crossSellModule/Component/CrossSellTransferTimeline/CrossSellTransferTimeline.php";
    const presenterPath =
      "/ws/app/modules/crossSellModule/Presenters/CrossSellAdminPresenter.php";
    const openTarget = vi.fn(async () => true);
    const loadFactoryTemplateOwner = vi.fn(async () => ({
      className: "App\\FactoryTimeline",
      dependencyPaths: ["/ws/app/FactoryTimeline.php"],
      factoryPaths: ["/ws/app/TimelineFactory.php"],
      path: "/ws/app/FactoryTimeline.php",
      source:
        "<?php class FactoryTimeline { public function handleCancel(): void {} }",
    }));
    const context: NettePresenterLinkDefinitionContext = {
      currentRelativePath:
        "app/modules/crossSellModule/Component/CrossSellTransferTimeline/cross_sell_transfer_timeline.latte",
      deps: {
        getActiveDocument: () => null,
        joinPath: (root, relative) => `${root}/${relative}`,
        listDirectory: vi.fn(async () => []),
        openTarget,
        readFileContent: vi.fn(async (path: string) => {
          if (path === componentPath) {
            return `<?php
class CrossSellTransferTimeline
{
    public function handleCancel(): void {}
}`;
          }

          if (path === presenterPath) {
            return "<?php class CrossSellAdminPresenter { public function actionShow(): void {} }";
          }

          throw new Error(`missing ${path}`);
        }),
        toRelativePath: (_root, path) => path,
      },
      frameworkCapabilities: {
        isPresenterSourcePath: () => true,
        parsePresenterLinkTarget: parseNetteLinkTarget,
        presenterActionMethodCandidates: nettePresenterActionMethodCandidates,
        presenterClassCandidatePathsForLink:
          nettePresenterClassCandidatePathsForLink,
        presenterLinkTargetsFromSource: () => [],
        presenterScanDirectories: [],
      },
      isDirectorySkipped: () => false,
      isRequestedRootActive: () => true,
      loadFactoryTemplateOwner,
      maxDepth: 1,
      maxPresenters: 1,
      requestedRoot: "/ws",
    };

    await expect(
      resolveNettePresenterLink(
        context,
        parseNetteLinkTarget("cancel!"),
        "cancel!",
      ),
    ).resolves.toBe(true);
    await expect(
      resolveNettePresenterLink(
        context,
        parseNetteLinkTarget(":CrossSell:CrossSellAdmin:show"),
        ":CrossSell:CrossSellAdmin:show",
      ),
    ).resolves.toBe(true);

    expect(openTarget).toHaveBeenNthCalledWith(
      1,
      componentPath,
      { column: 21, lineNumber: 4 },
      "cancel!",
    );
    expect(openTarget).toHaveBeenNthCalledWith(
      2,
      presenterPath,
      expect.objectContaining({ lineNumber: 1 }),
      ":CrossSell:CrossSellAdmin:show",
    );
    expect(loadFactoryTemplateOwner).not.toHaveBeenCalled();
  });

  it("opens the mapped presenter action through the shared resolution service", async () => {
    const source = `<?php
class MailTemplatesAdminPresenter
{
    public function actionShow(string $code): void {}
}`;
    const openTarget = vi.fn(async () => true);
    const parsed = parseNetteLinkTarget(
      ":RempMailer:MailTemplatesAdmin:show",
    );

    await expect(resolveNettePresenterLink(
      {
        currentRelativePath: "app/components/widget.latte",
        deps: {
          getActiveDocument: () => null,
          joinPath: (root, relative) => `${root}/${relative}`,
          listDirectory: vi.fn(async () => []),
          openTarget,
          readFileContent: vi.fn(async () => {
            throw new Error("mapping should resolve first");
          }),
          readPhpClassSource: vi.fn(async (className) =>
            className ===
            "Crm\\RempMailerModule\\Presenters\\MailTemplatesAdminPresenter"
              ? { path: "/ws/MailTemplatesAdminPresenter.php", source }
              : null,
          ),
          toRelativePath: (_root, path) => path,
        },
        frameworkCapabilities: {
          isPresenterSourcePath: () => true,
          parsePresenterLinkTarget: parseNetteLinkTarget,
          presenterActionMethodCandidates:
            nettePresenterActionMethodCandidates,
          presenterClassCandidatePathsForLink:
            nettePresenterClassCandidatePathsForLink,
          presenterLinkTargetsFromSource: () => [],
          presenterScanDirectories: [],
        },
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
        maxPresenters: 1,
        requestedRoot: "/ws",
      },
      parsed,
      ":RempMailer:MailTemplatesAdmin:show",
    )).resolves.toBe(true);

    expect(openTarget).toHaveBeenCalledWith(
      "/ws/MailTemplatesAdminPresenter.php",
      { column: 21, lineNumber: 4 },
      ":RempMailer:MailTemplatesAdmin:show",
    );
  });

  it("does not open a definition after mapping invalidation", async () => {
    let current = true;
    const openTarget = vi.fn(async () => true);
    const context = mappedDefinitionContext(
      openTarget,
      vi.fn(async () => {
        current = false;
        return {
          path: "/ws/MailTemplatesAdminPresenter.php",
          source: "<?php function actionShow() {}",
        };
      }),
      () => current,
    );

    await expect(resolveNettePresenterLink(
      context,
      parseNetteLinkTarget(":RempMailer:MailTemplatesAdmin:show"),
      ":RempMailer:MailTemplatesAdmin:show",
    )).resolves.toBe(false);
    expect(openTarget).not.toHaveBeenCalled();
  });
});

function mappedDefinitionContext(
  openTarget: (path: string, position: { column: number; lineNumber: number }, label: string) => Promise<boolean>,
  readPhpClassSource: NonNullable<
    NettePresenterDiscoveryContext["deps"]["readPhpClassSource"]
  >,
  isPresenterMappingGenerationCurrent: () => boolean,
  loadFactoryTemplateOwner: (
    templatePath: string,
  ) => Promise<NetteFactoryTemplateOwner | null> = vi.fn(async () => null),
  currentRelativePath = "app/components/widget.latte",
): NettePresenterLinkDefinitionContext {
  return {
    currentRelativePath,
    deps: {
      getActiveDocument: () => null,
      joinPath: (root, relative) => `${root}/${relative}`,
      listDirectory: vi.fn(async () => []),
      openTarget,
      readFileContent: vi.fn(async () => {
        throw new Error("mapping should resolve first");
      }),
      readPhpClassSource,
      resolveDeclaredType: (_source, typeHint) => typeHint,
      toRelativePath: (_root, path) => path,
    },
    frameworkCapabilities: {
      isPresenterSourcePath: () => true,
      parsePresenterLinkTarget: parseNetteLinkTarget,
      presenterActionMethodCandidates: nettePresenterActionMethodCandidates,
      presenterClassCandidatePathsForLink:
        nettePresenterClassCandidatePathsForLink,
      presenterLinkTargetsFromSource: () => [],
      presenterScanDirectories: [],
    },
    isDirectorySkipped: () => false,
    isPresenterMappingGenerationCurrent,
    isRequestedRootActive: () => true,
    loadFactoryTemplateOwner,
    loadPresenterMappings: async () =>
      normalizeNettePresenterMappings([
        ["RempMailer", "Crm\\RempMailerModule\\Presenters\\*Presenter"],
      ]),
    maxDepth: 1,
    maxPresenters: 1,
    requestedRoot: "/ws",
  };
}
