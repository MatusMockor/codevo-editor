import { describe, expect, it } from "vitest";
import { PhpGutterTargetsCoordinator } from "./phpGutterTargetsCoordinator";

const SOURCE = `<?php

interface SearchRepository
{
    public function search(): void;
}
`;

describe("PhpGutterTargetsCoordinator", () => {
  it("shares unchanged implementation targets between pane consumers", () => {
    const coordinator = new PhpGutterTargetsCoordinator();

    const leftPane = coordinator.resolveImplementation(
      "/workspace",
      "/workspace/Repo.php",
      SOURCE,
    );
    const rightPane = coordinator.resolveImplementation(
      "/workspace",
      "/workspace/Repo.php",
      SOURCE,
    );

    expect(rightPane).toBe(leftPane);
  });

  it("isolates identical paths and content between workspaces", () => {
    const coordinator = new PhpGutterTargetsCoordinator();

    const firstWorkspace = coordinator.resolveTest(
      "/workspace-a",
      "/tests/SampleTest.php",
      SOURCE,
    );
    const secondWorkspace = coordinator.resolveTest(
      "/workspace-b",
      "/tests/SampleTest.php",
      SOURCE,
    );

    expect(secondWorkspace).not.toBe(firstWorkspace);
  });

  it("recomputes targets when document content changes", () => {
    const coordinator = new PhpGutterTargetsCoordinator();

    const initialTargets = coordinator.resolveImplementation(
      "/workspace",
      "/workspace/Repo.php",
      SOURCE,
    );
    const editedTargets = coordinator.resolveImplementation(
      "/workspace",
      "/workspace/Repo.php",
      `${SOURCE}\nclass Repo implements SearchRepository {}`,
    );

    expect(editedTargets).not.toBe(initialTargets);
  });
});
