import { describe, expect, it } from "vitest";
import type { WorkspaceFileChangeEvent } from "./workspaceFileChange";
import { workspaceFileChangeInvalidatesSymfonyDiscovery } from "./symfonyWorkspaceDiscoveryInvalidation";

describe("Symfony workspace discovery invalidation", () => {
  it.each([
    "composer.json",
    "composer.lock",
    "bin/console",
    ".env",
    ".env.local",
    ".env.test.local.php",
    "config/routes.yaml",
    "config/packages/framework.yaml",
    "src/Controller/HomeController.php",
  ])("invalidates a relevant file change at %s", (relativePath) => {
    expect(workspaceFileChangeInvalidatesSymfonyDiscovery(event({ relativePath }))).toBe(true);
  });

  it("normalizes Windows separators", () => {
    expect(
      workspaceFileChangeInvalidatesSymfonyDiscovery(
        event({ relativePath: "src\\Controller\\HomeController.php" }),
      ),
    ).toBe(true);
  });

  it("invalidates a rename when either the previous or current path is relevant", () => {
    expect(
      workspaceFileChangeInvalidatesSymfonyDiscovery(
        event({
          kind: "renamed",
          previousRelativePath: "src/Controller/OldController.php",
          relativePath: "archive/OldController.txt",
        }),
      ),
    ).toBe(true);
    expect(
      workspaceFileChangeInvalidatesSymfonyDiscovery(
        event({
          kind: "renamed",
          previousRelativePath: "archive/routes.txt",
          relativePath: "config/routes.yaml",
        }),
      ),
    ).toBe(true);
  });

  it.each(["created", "deleted", "renamed"] as const)(
    "invalidates a %s relevant directory subtree",
    (kind) => {
      expect(
        workspaceFileChangeInvalidatesSymfonyDiscovery(
          event({ fileKind: "directory", kind, relativePath: "config/packages" }),
        ),
      ).toBe(true);
      expect(
        workspaceFileChangeInvalidatesSymfonyDiscovery(
          event({ fileKind: "directory", kind, relativePath: "src/Controller" }),
        ),
      ).toBe(true);
    },
  );

  it("invalidates a renamed directory through its previous subtree", () => {
    expect(
      workspaceFileChangeInvalidatesSymfonyDiscovery(
        event({
          fileKind: "directory",
          kind: "renamed",
          previousRelativePath: "config/routes",
          relativePath: "archive/routes",
        }),
      ),
    ).toBe(true);
  });

  it("invalidates a watcher rescan without a known path", () => {
    expect(
      workspaceFileChangeInvalidatesSymfonyDiscovery(
        event({ kind: "rescanRequired", relativePath: "" }),
      ),
    ).toBe(true);
  });

  it.each([
    "package.json",
    "README.md",
    "src/assets/app.ts",
    "src/templates/home.twig",
    "vendor/package/File.php",
    "nested/composer.json",
  ])("ignores an unrelated file change at %s", (relativePath) => {
    expect(workspaceFileChangeInvalidatesSymfonyDiscovery(event({ relativePath }))).toBe(false);
  });

  it("ignores directory metadata modifications and unrelated subtrees", () => {
    expect(
      workspaceFileChangeInvalidatesSymfonyDiscovery(
        event({ fileKind: "directory", kind: "modified", relativePath: "config" }),
      ),
    ).toBe(false);
    expect(
      workspaceFileChangeInvalidatesSymfonyDiscovery(
        event({ fileKind: "directory", kind: "created", relativePath: "public/assets" }),
      ),
    ).toBe(false);
  });
});

function event(overrides: Partial<WorkspaceFileChangeEvent> = {}): WorkspaceFileChangeEvent {
  return {
    kind: "modified",
    path: "/workspace/config/routes.yaml",
    relativePath: "config/routes.yaml",
    rootPath: "/workspace",
    ...overrides,
  };
}
