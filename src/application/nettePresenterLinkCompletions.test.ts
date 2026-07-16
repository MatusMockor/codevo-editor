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

      throw new Error(`missing ${path}`);
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
