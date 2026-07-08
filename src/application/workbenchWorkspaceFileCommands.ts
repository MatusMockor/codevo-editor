import type { Command } from "./commandRegistry";

interface WorkbenchWorkspaceFileCommandsOptions {
  isWorkspaceTrusted: boolean | undefined;
  openWorkspace: Command["run"];
  refreshWorkspace: Command["run"];
  toggleWorkspaceTrust: Command["run"];
  createFile: Command["run"];
  createDirectory: Command["run"];
  renameActiveDocument: Command["run"];
  deleteActiveDocument: Command["run"];
}

export function workbenchWorkspaceFileCommands({
  isWorkspaceTrusted,
  openWorkspace,
  refreshWorkspace,
  toggleWorkspaceTrust,
  createFile,
  createDirectory,
  renameActiveDocument,
  deleteActiveDocument,
}: WorkbenchWorkspaceFileCommandsOptions): Command[] {
  return [
    {
      id: "workspace.open",
      title: "Open Workspace",
      category: "Workspace",
      isEnabled: () => true,
      run: openWorkspace,
    },
    {
      id: "workspace.refresh",
      title: "Refresh Workspace",
      category: "Workspace",
      isEnabled: (context) => context.hasWorkspace,
      run: refreshWorkspace,
    },
    {
      id: "workspace.trust",
      title: isWorkspaceTrusted ? "Revoke Workspace Trust" : "Trust Workspace",
      category: "Workspace",
      isEnabled: (context) => context.hasWorkspace,
      run: toggleWorkspaceTrust,
    },
    {
      id: "file.new",
      title: "New File",
      category: "File",
      isEnabled: (context) => context.hasWorkspace,
      run: createFile,
    },
    {
      id: "folder.new",
      title: "New Folder",
      category: "File",
      isEnabled: (context) => context.hasWorkspace,
      run: createDirectory,
    },
    {
      id: "file.rename",
      title: "Rename Active File",
      category: "File",
      isEnabled: (context) => context.hasActiveDocument,
      run: renameActiveDocument,
    },
    {
      id: "file.delete",
      title: "Delete Active File",
      category: "File",
      isEnabled: (context) => context.hasActiveDocument,
      run: deleteActiveDocument,
    },
  ];
}
