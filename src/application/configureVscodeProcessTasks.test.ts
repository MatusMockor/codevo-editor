import { describe, expect, it, vi } from "vitest";
import {
  configureVscodeProcessTasks,
  type ConfigureVscodeProcessTasksOptions,
} from "./configureVscodeProcessTasks";

const ROOT = "/workspace";
const WORKSPACE_ID = "workspace-1";

describe("configureVscodeProcessTasks", () => {
  it("creates a missing directory and bounded starter file through the workspace owner", async () => {
    const options = createOptions();

    await expect(configureVscodeProcessTasks(options)).resolves.toBe(true);

    expect(options.files.createDirectoryForWorkspace).toHaveBeenCalledExactlyOnceWith(
      WORKSPACE_ID,
      `${ROOT}/.vscode`,
    );
    expect(options.files.createTextFileWithContentForWorkspace).toHaveBeenCalledOnce();
    const [workspaceId, path, content] = vi.mocked(
      options.files.createTextFileWithContentForWorkspace,
    ).mock.calls[0]!;
    expect(workspaceId).toBe(WORKSPACE_ID);
    expect(path).toBe(`${ROOT}/.vscode/tasks.json`);
    expect(content.length).toBeLessThan(1_024);
    expect(JSON.parse(content)).toMatchObject({
      version: "2.0.0",
      tasks: [
        {
          args: ["--noEmit"],
          command: "tsc",
          problemMatcher: "$tsc",
          type: "process",
        },
      ],
    });
    expect(options.openFile).toHaveBeenCalledExactlyOnceWith({
      kind: "file",
      name: "tasks.json",
      path: `${ROOT}/.vscode/tasks.json`,
    });
  });

  it("does not recreate an existing .vscode directory", async () => {
    const options = createOptions();
    vi.mocked(options.files.readDirectory).mockResolvedValue([
      { kind: "directory", name: ".vscode", path: `${ROOT}/.vscode` },
    ]);

    await expect(configureVscodeProcessTasks(options)).resolves.toBe(true);

    expect(options.files.createDirectoryForWorkspace).not.toHaveBeenCalled();
    expect(options.files.createTextFileWithContentForWorkspace).toHaveBeenCalledOnce();
  });

  it("opens a present configuration without reading or mutating the workspace", async () => {
    const options = createOptions({ action: "open" });

    await expect(configureVscodeProcessTasks(options)).resolves.toBe(true);

    expect(options.files.readDirectory).not.toHaveBeenCalled();
    expect(options.files.createDirectoryForWorkspace).not.toHaveBeenCalled();
    expect(options.files.createTextFileWithContentForWorkspace).not.toHaveBeenCalled();
    expect(options.openFile).toHaveBeenCalledOnce();
  });

  it.each(["after-read", "after-directory", "after-create", "after-open"] as const)(
    "fails closed when workspace ownership changes %s",
    async (boundary) => {
      let current = true;
      const options = createOptions();
      if (boundary === "after-read") {
        vi.mocked(options.files.readDirectory).mockImplementation(async () => {
          current = false;
          return [];
        });
      } else if (boundary === "after-directory") {
        vi.mocked(options.files.createDirectoryForWorkspace).mockImplementation(async () => {
          current = false;
        });
      } else if (boundary === "after-create") {
        vi.mocked(options.files.createTextFileWithContentForWorkspace).mockImplementation(
          async () => {
            current = false;
            return { status: "success", revision: revision() };
          },
        );
      } else {
        vi.mocked(options.openFile).mockImplementation(async () => {
          current = false;
          return true;
        });
      }
      options.isCurrent = () => current;

      await expect(configureVscodeProcessTasks(options)).resolves.toBe(false);

      if (boundary === "after-read") {
        expect(options.files.createDirectoryForWorkspace).not.toHaveBeenCalled();
      }
      if (boundary === "after-directory") {
        expect(options.files.createTextFileWithContentForWorkspace).not.toHaveBeenCalled();
      }
      if (boundary === "after-create") {
        expect(options.openFile).not.toHaveBeenCalled();
      }
    },
  );

  it("does not open after a rejected create or an opener rejection", async () => {
    const rejectedCreate = createOptions();
    vi.mocked(rejectedCreate.files.createTextFileWithContentForWorkspace).mockResolvedValue({
      status: "error",
      message: "already exists",
    });
    await expect(configureVscodeProcessTasks(rejectedCreate)).resolves.toBe(false);
    expect(rejectedCreate.openFile).not.toHaveBeenCalled();

    const rejectedOpen = createOptions({ action: "open" });
    vi.mocked(rejectedOpen.openFile).mockResolvedValue(false);
    await expect(configureVscodeProcessTasks(rejectedOpen)).resolves.toBe(false);
  });
});

function createOptions(
  override: Partial<ConfigureVscodeProcessTasksOptions> = {},
): ConfigureVscodeProcessTasksOptions & {
  isCurrent: () => boolean;
} {
  return {
    action: "create",
    files: {
      createDirectoryForWorkspace: vi.fn(async () => undefined),
      createTextFileWithContentForWorkspace: vi.fn(async () => ({
        status: "success" as const,
        revision: revision(),
      })),
      readDirectory: vi.fn(async () => []),
    },
    isCurrent: () => true,
    openFile: vi.fn(async () => true),
    rootPath: ROOT,
    workspaceId: WORKSPACE_ID,
    ...override,
  };
}

function revision() {
  return {
    device: "1",
    inode: "2",
    size: 1,
    modifiedSeconds: 1,
    modifiedNanoseconds: 1,
    contentHash: "hash",
  };
}
