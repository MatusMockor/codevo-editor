import { expect, vi } from "vitest";
import type { WorkspaceFileRevision } from "../domain/workspace";

interface LocalHistorySaveWritersFixtureOptions {
  readonly absolutePath: string;
  readonly initialRevision: WorkspaceFileRevision;
  readonly relativePath: string;
  readonly workspaceId: string;
}

export function createLocalHistorySaveWritersFixture({
  absolutePath,
  initialRevision,
  relativePath,
  workspaceId,
}: LocalHistorySaveWritersFixtureOptions) {
  const writeTextFileForWorkspaceRelativePath = vi.fn(async () => ({
    status: "success" as const,
    revision: initialRevision,
  }));
  const writeTextFileForWorkspace = vi.fn(async () => ({
    status: "success" as const,
    revision: { ...initialRevision, contentHash: "reverted" },
  }));

  return {
    assertPreparedWrites(firstContent: string, secondContent: string) {
      expect(writeTextFileForWorkspaceRelativePath).toHaveBeenNthCalledWith(
        1,
        workspaceId,
        relativePath,
        firstContent,
        initialRevision,
      );
      expect(writeTextFileForWorkspaceRelativePath).toHaveBeenNthCalledWith(
        2,
        workspaceId,
        relativePath,
        secondContent,
        initialRevision,
      );
      expect(writeTextFileForWorkspaceRelativePath).toHaveBeenCalledTimes(2);
      expect(writeTextFileForWorkspace).not.toHaveBeenCalled();
    },
    assertRevertWrite(content: string) {
      expect(writeTextFileForWorkspace).toHaveBeenLastCalledWith(
        workspaceId,
        absolutePath,
        content,
        initialRevision,
      );
      expect(writeTextFileForWorkspace).toHaveBeenCalledTimes(1);
      expect(writeTextFileForWorkspaceRelativePath).toHaveBeenCalledTimes(2);
    },
    workspaceFiles: {
      writeTextFileForWorkspace,
    },
    workspaceOwnerFiles: {
      writeTextFileForWorkspaceRelativePath,
    },
  };
}
