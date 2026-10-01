import { describe, expect, it } from "vitest";
import { isWorkspaceDirectoryBusyError } from "./workspaceDirectoryReadErrors";

describe("isWorkspaceDirectoryBusyError", () => {
  it("recognises the backend busy code from errors and raw invoke rejections", () => {
    expect(
      isWorkspaceDirectoryBusyError(
        new Error("WORKSPACE_DIRECTORY_BUSY: this directory is already being read"),
      ),
    ).toBe(true);
    expect(
      isWorkspaceDirectoryBusyError(
        "WORKSPACE_DIRECTORY_BUSY: too many directory reads are already running",
      ),
    ).toBe(true);
    expect(isWorkspaceDirectoryBusyError("workspace_directory_busy: lower case")).toBe(true);
  });

  it("rejects other failures and codes that only mention busy elsewhere", () => {
    expect(isWorkspaceDirectoryBusyError(new Error("EACCES: permission denied"))).toBe(false);
    expect(isWorkspaceDirectoryBusyError("ENOENT: no such file or directory")).toBe(false);
    expect(
      isWorkspaceDirectoryBusyError(new Error("read failed: WORKSPACE_DIRECTORY_BUSY: nested")),
    ).toBe(false);
    expect(isWorkspaceDirectoryBusyError("WORKSPACE_DIRECTORY_BUSY")).toBe(false);
    expect(isWorkspaceDirectoryBusyError(null)).toBe(false);
    expect(isWorkspaceDirectoryBusyError(undefined)).toBe(false);
  });
});
