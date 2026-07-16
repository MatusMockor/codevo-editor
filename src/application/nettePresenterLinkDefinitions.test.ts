import { describe, expect, it, vi } from "vitest";
import {
  nettePresenterActionMethodCandidates,
  nettePresenterClassCandidatePathsForLink,
  parseNetteLinkTarget,
} from "../domain/latteLinkNavigation";
import { normalizeNettePresenterMappings } from "../domain/nettePresenterMapping";
import { resolveNettePresenterLink } from "./nettePresenterLinkDefinitions";
import type { NettePresenterDiscoveryContext } from "./nettePresenterLinkDiscovery";

describe("resolveNettePresenterLink", () => {
  it("resolves singular Component signals without taking ownership of presenter actions", async () => {
    const componentPath =
      "/ws/app/modules/crossSellModule/Component/CrossSellTransferTimeline/CrossSellTransferTimeline.php";
    const presenterPath =
      "/ws/app/modules/crossSellModule/Presenters/CrossSellAdminPresenter.php";
    const openTarget = vi.fn(async () => true);
    const context: Omit<
      NettePresenterDiscoveryContext,
      "cache" | "inFlight" | "ttlMs"
    > = {
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
): Omit<NettePresenterDiscoveryContext, "cache" | "inFlight" | "ttlMs"> {
  return {
    currentRelativePath: "app/components/widget.latte",
    deps: {
      getActiveDocument: () => null,
      joinPath: (root, relative) => `${root}/${relative}`,
      listDirectory: vi.fn(async () => []),
      openTarget,
      readFileContent: vi.fn(async () => {
        throw new Error("mapping should resolve first");
      }),
      readPhpClassSource,
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
    loadPresenterMappings: async () =>
      normalizeNettePresenterMappings([
        ["RempMailer", "Crm\\RempMailerModule\\Presenters\\*Presenter"],
      ]),
    maxDepth: 1,
    maxPresenters: 1,
    requestedRoot: "/ws",
  };
}
