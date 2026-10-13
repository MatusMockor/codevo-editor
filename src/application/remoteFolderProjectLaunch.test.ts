import { describe, expect, it } from "vitest";
import { projectFixture } from "../components/agentMode/agentThreadsSurfaceTestFixtures";
import {
  REMOTE_FOLDER_BASE_UNAVAILABLE,
  REMOTE_FOLDER_NEEDS_IN_PLACE,
  REMOTE_PROJECT_KIND_CHANGED,
  remoteProjectIsolationPreview,
  remoteProjectLaunchRefusal,
  remoteProjectLaunchRefusalMessage,
  type RemoteProjectLaunch,
} from "./remoteFolderProjectLaunch";

const launch = (overrides: Partial<RemoteProjectLaunch> = {}): RemoteProjectLaunch => ({
  captured: "folder",
  current: "folder",
  isolation: "in-place",
  base: undefined,
  ...overrides,
});

describe("remote folder project launch", () => {
  it("admits a folder project only in place and without a start base", () => {
    expect(remoteProjectLaunchRefusal(launch())).toBeNull();
    expect(remoteProjectLaunchRefusal(launch({ current: "unread" }))).toBeNull();
    expect(remoteProjectLaunchRefusal(launch({ isolation: "worktree" }))).toBe("needsInPlace");
    expect(remoteProjectLaunchRefusal(launch({ base: { kind: "checkout-head" } }))).toBe(
      "baseUnavailable",
    );
    expect(
      remoteProjectLaunchRefusal(launch({ base: { kind: "origin-branch", branch: "main" } })),
    ).toBe("baseUnavailable");
  });

  it.each([undefined, "repository"] as const)(
    "leaves a %s project free to choose isolation and a base",
    (captured) => {
      for (const current of ["unread", "repository"] as const) {
        expect(
          remoteProjectLaunchRefusal(launch({ captured, current, isolation: "worktree" })),
        ).toBeNull();
        expect(
          remoteProjectLaunchRefusal(
            launch({ captured, current, isolation: "worktree", base: { kind: "checkout-head" } }),
          ),
        ).toBeNull();
        expect(remoteProjectLaunchRefusal(launch({ captured, current }))).toBeNull();
      }
    },
  );

  it("fails closed when the listed kind differs from the captured one", () => {
    expect(remoteProjectLaunchRefusal(launch({ captured: "repository" }))).toBe("projectChanged");
    expect(remoteProjectLaunchRefusal(launch({ captured: undefined }))).toBe("projectChanged");
    expect(remoteProjectLaunchRefusal(launch({ current: "repository" }))).toBe("projectChanged");
    expect(
      remoteProjectLaunchRefusal(
        launch({ captured: undefined, current: "folder", isolation: "worktree" }),
      ),
    ).toBe("projectChanged");
  });

  it.each([undefined, "repository", "folder"] as const)(
    "fails closed when a %s project is no longer listed",
    (captured) => {
      expect(remoteProjectLaunchRefusal(launch({ captured, current: "unlisted" }))).toBe(
        "projectChanged",
      );
      expect(
        remoteProjectLaunchRefusal(
          launch({ captured, current: "unlisted", isolation: "worktree" }),
        ),
      ).toBe("projectChanged");
      expect(
        remoteProjectLaunchRefusal(
          launch({ captured, current: "unlisted", base: { kind: "checkout-head" } }),
        ),
      ).toBe("projectChanged");
    },
  );

  it("names every refusal with its own copy", () => {
    expect(remoteProjectLaunchRefusalMessage("projectChanged")).toBe(REMOTE_PROJECT_KIND_CHANGED);
    expect(remoteProjectLaunchRefusalMessage("needsInPlace")).toBe(REMOTE_FOLDER_NEEDS_IN_PLACE);
    expect(remoteProjectLaunchRefusalMessage("baseUnavailable")).toBe(
      REMOTE_FOLDER_BASE_UNAVAILABLE,
    );
  });
});

describe("remote project isolation preview", () => {
  const root = "remote:server:runner:project";

  it("keeps a repository project ready with its runner's isolation policy", () => {
    expect(
      remoteProjectIsolationPreview(
        root,
        projectFixture({ rootKey: root, isolationPolicy: "in-place" }),
      ),
    ).toEqual({
      repositoryRoot: root,
      repositoryStatus: { kind: "ready" },
      recommended: { kind: "in-place" },
      inPlaceGuard: { kind: "safe" },
      inPlaceAllowed: true,
      confirmationKey: null,
    });
    expect(
      remoteProjectIsolationPreview(
        root,
        projectFixture({ rootKey: root, isolationPolicy: "worktree" }),
      ),
    ).toEqual({
      repositoryRoot: root,
      repositoryStatus: { kind: "ready" },
      recommended: { kind: "worktree", reason: "policy" },
      inPlaceGuard: { kind: "safe" },
      inPlaceAllowed: false,
      confirmationKey: null,
    });
    expect(remoteProjectIsolationPreview(root, undefined)).toEqual({
      repositoryRoot: root,
      repositoryStatus: { kind: "ready" },
      recommended: { kind: "worktree", reason: "policy" },
      inPlaceGuard: { kind: "safe" },
      inPlaceAllowed: false,
      confirmationKey: null,
    });
  });

  it("reports a folder project as not a repository", () => {
    const preview = remoteProjectIsolationPreview(
      root,
      projectFixture({ rootKey: root, isolationPolicy: "in-place", remoteProjectKind: "folder" }),
    );
    expect(preview.repositoryStatus).toEqual({ kind: "notRepository" });
    expect(preview.recommended).toEqual({ kind: "in-place" });
    expect(preview.inPlaceAllowed).toBe(true);
    expect(
      remoteProjectIsolationPreview(
        root,
        projectFixture({
          rootKey: root,
          isolationPolicy: "in-place",
          remoteProjectKind: "repository",
        }),
      ).repositoryStatus,
    ).toEqual({ kind: "ready" });
  });
});
