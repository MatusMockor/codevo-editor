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
});
