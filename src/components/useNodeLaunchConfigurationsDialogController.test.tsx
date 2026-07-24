// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceFileRevision } from "../domain/workspace";
import { waitForReact } from "../test/reactTestLifecycle";
import type { NodeLaunchConfigurationsDialogProps } from "./NodeLaunchConfigurationsDialog";
import {
  useNodeLaunchConfigurationsDialogController,
  type NodeLaunchConfigurationFileGateway,
  type UseNodeLaunchConfigurationsDialogControllerOptions,
} from "./useNodeLaunchConfigurationsDialogController";

const ROOT_A = "/workspace/a";
const ROOT_B = "/workspace/b";
const REVISION: WorkspaceFileRevision = {
  device: "1",
  inode: "2",
  size: 1,
  modifiedSeconds: 3,
  modifiedNanoseconds: 4,
  contentHash: "loaded",
};
const CONFIGURATION = {
  name: "API",
  default: true,
  target: { kind: "script" as const, path: "src/server.ts" },
  args: ["--inspect"],
  env: { NODE_ENV: "development" },
};
const SOURCE = `${JSON.stringify({ version: 1, configurations: [CONFIGURATION] })}\n`;

describe("useNodeLaunchConfigurationsDialogController", () => {
  it("loads only while open and saves an existing file through its captured owner and revision", async () => {
    const files = gateway({ present: true });
    const harness = renderController({ workspaceFiles: files });

    expect(files.readDirectory).not.toHaveBeenCalled();
    harness.set({ isOpen: true });
    await waitForReact(() => expect(harness.props().configurations).toEqual([CONFIGURATION]));

    let saved = false;
    await act(async () => {
      saved = await harness.props().onSave([CONFIGURATION]);
    });

    expect(saved).toBe(true);
    expect(files.writeTextFileForWorkspace).toHaveBeenCalledWith(
      "workspace-a",
      "/workspace/a/.codevo/launch.json",
      expect.stringContaining('"name": "API"'),
      REVISION,
    );
    expect(files.createTextFileWithContentForWorkspace).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("creates a missing directory and file atomically through the captured owner", async () => {
    const files = gateway();
    const harness = renderController({ isOpen: true, workspaceFiles: files });
    await waitForReact(() => expect(harness.props().loading).toBe(false));

    let saved = false;
    await act(async () => {
      saved = await harness.props().onSave([CONFIGURATION]);
    });

    expect(saved).toBe(true);
    expect(files.createDirectoryForWorkspace).toHaveBeenCalledWith(
      "workspace-a",
      "/workspace/a/.codevo",
    );
    expect(files.createTextFileWithContentForWorkspace).toHaveBeenCalledWith(
      "workspace-a",
      "/workspace/a/.codevo/launch.json",
      expect.stringContaining('"name": "API"'),
    );
    expect(files.writeTextFileForWorkspace).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("rejects untrusted saves without mutating the workspace", async () => {
    const files = gateway();
    const harness = renderController({
      isOpen: true,
      workspaceFiles: files,
      workspaceTrusted: false,
    });
    await waitForReact(() => expect(harness.props().loading).toBe(false));

    let saved = true;
    await act(async () => {
      saved = await harness.props().onSave([CONFIGURATION]);
    });

    expect(saved).toBe(false);
    expect(harness.props().error).toMatch(/Trust this workspace/);
    expect(files.createDirectoryForWorkspace).not.toHaveBeenCalled();
    expect(files.createTextFileWithContentForWorkspace).not.toHaveBeenCalled();
    expect(files.writeTextFileForWorkspace).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("keeps the loaded model and reports false when an atomic create conflicts", async () => {
    const files = gateway();
    files.createTextFileWithContentForWorkspace.mockResolvedValueOnce({
      status: "conflict",
      message: "launch.json was created elsewhere",
    });
    const harness = renderController({ isOpen: true, workspaceFiles: files });
    await waitForReact(() => expect(harness.props().loading).toBe(false));

    let saved = true;
    await act(async () => {
      saved = await harness.props().onSave([CONFIGURATION]);
    });

    expect(saved).toBe(false);
    expect(harness.props().configurations).toEqual([]);
    expect(harness.props().error).toBe("launch.json was created elsewhere");
    expect(files.readDirectory).toHaveBeenCalledTimes(3);
    harness.unmount();
  });

  it("ignores a stale load after the selected workspace changes", async () => {
    let resolveSnapshot!: (value: { content: string; revision: WorkspaceFileRevision }) => void;
    const snapshot = new Promise<{ content: string; revision: WorkspaceFileRevision }>(
      (resolve) => {
        resolveSnapshot = resolve;
      },
    );
    const files = gateway({ present: true });
    files.readTextFileSnapshot.mockReturnValueOnce(snapshot);
    const harness = renderController({ isOpen: true, workspaceFiles: files });
    await waitForReact(() => expect(files.readTextFileSnapshot).toHaveBeenCalledTimes(1));

    harness.set({ rootPath: ROOT_B, workspaceId: "workspace-b" });
    resolveSnapshot({ content: SOURCE, revision: REVISION });
    await waitForReact(() => expect(harness.props().loading).toBe(false));

    expect(harness.props().configurations).toEqual([CONFIGURATION]);
    expect(files.readTextFileSnapshot).toHaveBeenCalledWith("/workspace/b/.codevo/launch.json");
    harness.unmount();
  });
});

interface Harness {
  props(): NodeLaunchConfigurationsDialogProps;
  set(options: Partial<UseNodeLaunchConfigurationsDialogControllerOptions>): void;
  unmount(): void;
}

function renderController(
  overrides: Partial<UseNodeLaunchConfigurationsDialogControllerOptions> = {},
): Harness {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { current: NodeLaunchConfigurationsDialogProps | null } = { current: null };
  let options: UseNodeLaunchConfigurationsDialogControllerOptions = {
    isOpen: false,
    onClose: vi.fn(),
    rootPath: ROOT_A,
    workspaceFiles: gateway(),
    workspaceId: "workspace-a",
    workspaceTrusted: true,
    ...overrides,
  };

  function Component() {
    captured.current = useNodeLaunchConfigurationsDialogController(options);
    return null;
  }

  const render = () => act(() => root.render(<Component />));
  render();
  return {
    props: () => {
      if (!captured.current) throw new Error("Controller is not mounted");
      return captured.current;
    },
    set: (next) => {
      options = { ...options, ...next };
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

function gateway({ present = false }: { present?: boolean } = {}): MockGateway {
  return {
    createDirectoryForWorkspace: vi.fn(async () => undefined),
    createTextFileWithContentForWorkspace: vi.fn(async () => ({
      status: "success",
      revision: REVISION,
    })),
    readDirectory: vi.fn(async (path: string) => {
      if (path.endsWith("/.codevo")) {
        return present
          ? [{ kind: "file" as const, name: "launch.json", path: `${path}/launch.json` }]
          : [];
      }
      return present
        ? [{ kind: "directory" as const, name: ".codevo", path: `${path}/.codevo` }]
        : [];
    }),
    readTextFileSnapshot: vi.fn(async () => ({ content: SOURCE, revision: REVISION })),
    writeTextFileForWorkspace: vi.fn(async () => ({ status: "success", revision: REVISION })),
  };
}

interface MockGateway extends NodeLaunchConfigurationFileGateway {
  createDirectoryForWorkspace: ReturnType<
    typeof vi.fn<NodeLaunchConfigurationFileGateway["createDirectoryForWorkspace"]>
  >;
  createTextFileWithContentForWorkspace: ReturnType<
    typeof vi.fn<NodeLaunchConfigurationFileGateway["createTextFileWithContentForWorkspace"]>
  >;
  readDirectory: ReturnType<typeof vi.fn<NodeLaunchConfigurationFileGateway["readDirectory"]>>;
  readTextFileSnapshot: ReturnType<
    typeof vi.fn<NonNullable<NodeLaunchConfigurationFileGateway["readTextFileSnapshot"]>>
  >;
  writeTextFileForWorkspace: ReturnType<
    typeof vi.fn<NodeLaunchConfigurationFileGateway["writeTextFileForWorkspace"]>
  >;
}
