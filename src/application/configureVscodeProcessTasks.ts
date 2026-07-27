import {
  getFileName,
  joinWorkspacePath,
  type WorkspaceFileGateway,
  type WorkspaceOwnerFileGateway,
} from "../domain/workspace";

export const VSCODE_TASKS_CONFIGURATION_PATH = ".vscode/tasks.json";
export const VSCODE_TASKS_EMPTY_CONFIG_REVISION =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000";

export type VscodeProcessTasksConfigurationAction = "create" | "open";

export type VscodeProcessTasksConfigurationFiles = Pick<WorkspaceFileGateway, "readDirectory"> &
  Pick<
    WorkspaceOwnerFileGateway,
    "createDirectoryForWorkspace" | "createTextFileWithContentForWorkspace"
  >;

export interface ConfigureVscodeProcessTasksOptions {
  readonly action: VscodeProcessTasksConfigurationAction;
  readonly files: VscodeProcessTasksConfigurationFiles;
  readonly isCurrent: () => boolean;
  readonly openFile: (entry: {
    readonly kind: "file";
    readonly name: string;
    readonly path: string;
  }) => Promise<boolean>;
  readonly rootPath: string;
  readonly workspaceId: string;
}

const STARTER_TASKS_CONFIGURATION = `${JSON.stringify(
  {
    version: "2.0.0",
    tasks: [
      {
        label: "TypeScript: Check",
        type: "process",
        command: "tsc",
        args: ["--noEmit"],
        problemMatcher: "$tsc",
        group: "build",
      },
    ],
  },
  null,
  2,
)}\n`;

/**
 * Creates or opens the one workspace-owned VS Code tasks file. The caller owns
 * the workspace-generation lease and this use case revalidates it after every
 * asynchronous boundary before continuing.
 */
export async function configureVscodeProcessTasks({
  action,
  files,
  isCurrent,
  openFile,
  rootPath,
  workspaceId,
}: ConfigureVscodeProcessTasksOptions): Promise<boolean> {
  if (!isCurrent()) return false;
  const configurationPath = joinWorkspacePath(rootPath, VSCODE_TASKS_CONFIGURATION_PATH);

  if (action === "create") {
    const rootEntries = await files.readDirectory(rootPath);
    if (!isCurrent()) return false;
    const directoryExists = rootEntries.some(
      (entry) => entry.kind === "directory" && entry.name === ".vscode",
    );
    if (!directoryExists) {
      await files.createDirectoryForWorkspace(workspaceId, joinWorkspacePath(rootPath, ".vscode"));
      if (!isCurrent()) return false;
    }
    const result = await files.createTextFileWithContentForWorkspace(
      workspaceId,
      configurationPath,
      STARTER_TASKS_CONFIGURATION,
    );
    if (!isCurrent() || result.status !== "success") return false;
  }

  const opened = await openFile({
    kind: "file",
    name: getFileName(configurationPath),
    path: configurationPath,
  });
  return opened && isCurrent();
}
