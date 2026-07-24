// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings, defaultWorkspaceSettings } from "../domain/settings";
import { waitForReact } from "../test/reactTestLifecycle";
import {
  WorkbenchSettingsDialogHost,
  type WorkbenchSettingsModel,
} from "./WorkbenchSettingsDialogHost";
import type { NodeLaunchConfigurationFileGateway } from "./useNodeLaunchConfigurationsDialogController";

describe("WorkbenchSettingsDialogHost", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("opens and closes Node launch configurations from JS/TS settings", async () => {
    const files = missingConfigurationGateway();
    await render(settingsModel(), files);

    clickButton("Edit Node launch configurations");
    await waitForReact(() => expect(nodeLaunchDialog()).not.toBeNull());

    expect(files.readDirectory).toHaveBeenCalledWith("/workspace/a");
    clickButton("Close Node launch configurations");
    expect(nodeLaunchDialog()).toBeNull();
  });

  it("reloads an open dialog for the newly selected workspace owner", async () => {
    const files = missingConfigurationGateway();
    await render(settingsModel(), files);
    clickButton("Edit Node launch configurations");
    await waitForReact(() => expect(files.readDirectory).toHaveBeenCalledWith("/workspace/a"));

    await render(settingsModel("b"), files);
    await waitForReact(() => expect(files.readDirectory).toHaveBeenCalledWith("/workspace/b"));

    expect(nodeLaunchDialog()).not.toBeNull();
  });

  async function render(
    workbench: WorkbenchSettingsModel,
    workspaceFiles: NodeLaunchConfigurationFileGateway,
  ) {
    await act(async () => {
      root.render(<ControlledSettingsHost workbench={workbench} workspaceFiles={workspaceFiles} />);
      await Promise.resolve();
    });
  }
});

function ControlledSettingsHost({
  workbench,
  workspaceFiles,
}: {
  readonly workbench: WorkbenchSettingsModel;
  readonly workspaceFiles: NodeLaunchConfigurationFileGateway;
}) {
  const [nodeLaunchConfigurationsOpen, setNodeLaunchConfigurationsOpen] = useState(false);
  return (
    <WorkbenchSettingsDialogHost
      systemFontGateway={{ listMonospaceFontFamilies: async () => [] }}
      workbench={{
        ...workbench,
        closeNodeLaunchConfigurations: () => setNodeLaunchConfigurationsOpen(false),
        nodeLaunchConfigurationsOpen,
        openNodeLaunchConfigurations: () => setNodeLaunchConfigurationsOpen(true),
      }}
      workspaceFiles={workspaceFiles}
    />
  );
}

function settingsModel(id = "a"): WorkbenchSettingsModel {
  const rootPath = `/workspace/${id}`;
  return {
    appSettings: defaultAppSettings(),
    closeNodeLaunchConfigurations: vi.fn(),
    gitRepositoryMappings: [],
    nodeLaunchConfigurationsOpen: false,
    openNodeLaunchConfigurations: vi.fn(),
    openJavaScriptTypeScriptServiceLog: vi.fn(async () => undefined),
    phpTools: null,
    restartJavaScriptTypeScriptService: vi.fn(async () => undefined),
    saveWorkbenchSettings: vi.fn(async () => undefined),
    settingsInitialSection: "general",
    settingsOpen: true,
    setSettingsOpen: vi.fn(),
    workspaceDescriptor: null,
    workspaceIdentityDescriptor: { workspaceId: `workspace-${id}` },
    workspaceRoot: rootPath,
    workspaceSettings: defaultWorkspaceSettings(),
    workspaceTrust: { rootPath, trusted: true },
  };
}

function missingConfigurationGateway(): NodeLaunchConfigurationFileGateway & {
  readDirectory: ReturnType<typeof vi.fn<NodeLaunchConfigurationFileGateway["readDirectory"]>>;
} {
  return {
    createDirectoryForWorkspace: vi.fn<
      NodeLaunchConfigurationFileGateway["createDirectoryForWorkspace"]
    >(async () => undefined),
    createTextFileWithContentForWorkspace: vi.fn<
      NodeLaunchConfigurationFileGateway["createTextFileWithContentForWorkspace"]
    >(async () => ({ status: "success", revision: null })),
    readDirectory: vi.fn<NodeLaunchConfigurationFileGateway["readDirectory"]>(async () => []),
    readTextFileSnapshot: vi.fn(async () => ({ content: "", revision: null })),
    writeTextFileForWorkspace: vi.fn<
      NodeLaunchConfigurationFileGateway["writeTextFileForWorkspace"]
    >(async () => ({
      status: "success",
      revision: null,
    })),
  };
}

function clickButton(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label || candidate.ariaLabel === label,
  );
  if (!button) throw new Error(`Button not found: ${label}`);
  act(() => button.click());
}

function nodeLaunchDialog(): HTMLElement | null {
  return document.querySelector('[role="dialog"][aria-label="Node launch configurations"]');
}
