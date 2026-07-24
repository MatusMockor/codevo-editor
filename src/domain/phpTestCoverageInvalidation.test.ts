import { describe, expect, it } from "vitest";
import type { WorkspaceFileChangeEvent } from "./workspaceFileChange";
import { workspaceFileChangeInvalidatesPhpTestCoverage } from "./phpTestCoverageInvalidation";

describe("workspaceFileChangeInvalidatesPhpTestCoverage", () => {
  it.each([
    "src/Presenter/HomePresenter.php",
    "tests/HomePresenterTest.PHP",
    "composer.json",
    "composer.lock",
    "phpunit.xml",
    "phpunit.xml.dist",
    "phpunit.dist.xml",
  ])("invalidates a coverage input change at %s", (relativePath) => {
    expect(workspaceFileChangeInvalidatesPhpTestCoverage(event({ relativePath }))).toBe(true);
  });

  it("invalidates either side of a rename", () => {
    expect(
      workspaceFileChangeInvalidatesPhpTestCoverage(
        event({
          kind: "renamed",
          previousRelativePath: "src/Old.php",
          relativePath: "archive/Old.txt",
        }),
      ),
    ).toBe(true);
  });

  it("invalidates rescans and structural directory changes", () => {
    expect(workspaceFileChangeInvalidatesPhpTestCoverage(event({ kind: "rescanRequired" }))).toBe(
      true,
    );
    expect(
      workspaceFileChangeInvalidatesPhpTestCoverage(
        event({ fileKind: "directory", kind: "created", relativePath: "src/New" }),
      ),
    ).toBe(true);
  });

  it.each(["README.md", "src/client.ts", ".phpunit.result.cache", "phpstan.neon"])(
    "ignores an unrelated change at %s",
    (relativePath) => {
      expect(workspaceFileChangeInvalidatesPhpTestCoverage(event({ relativePath }))).toBe(false);
    },
  );
});

function event(overrides: Partial<WorkspaceFileChangeEvent> = {}): WorkspaceFileChangeEvent {
  return {
    kind: "modified",
    path: "/workspace/src/file.php",
    relativePath: "src/file.php",
    rootPath: "/workspace",
    ...overrides,
  };
}
