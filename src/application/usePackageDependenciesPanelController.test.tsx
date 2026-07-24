// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorDocument, NpmPackageDescriptor } from "../domain/workspace";
import type { WorkspaceSourceDiscoveryGateway } from "../domain/workspaceSourceDiscovery";
import { usePackageDependenciesPanelController } from "./usePackageDependenciesPanelController";
import type { PackageOperationsGateway } from "../domain/packageOperations";

describe("usePackageDependenciesPanelController", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: ReturnType<typeof usePackageDependenciesPanelController>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    globalThis.document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("navigates to an exact dependency key using a bounded workspace read", async () => {
    const gateway = sourceGateway('{\n  "dependencies": {\n    "express": "^5"\n  }\n}');
    const onOpenLocation = vi.fn(async () => true);
    await render({ gateway, onOpenLocation });

    await act(async () => void (await latest.onOpenDependency(latest.tree[0]!.items[0]!)));

    expect(gateway.readSourceTextBounded).toHaveBeenCalledWith(
      "/workspace",
      "package.json",
      256 * 1024,
    );
    expect(onOpenLocation).toHaveBeenCalledWith(
      "/workspace/package.json",
      3,
      5,
      expect.any(Function),
    );
  });

  it("uses a dirty package.json overlay instead of stale disk content", async () => {
    const gateway = sourceGateway("not read");
    await render({
      documents: [packageJsonDocument('{\n  "dependencies": { "express": "next" }\n}')],
      gateway,
    });

    await act(async () => void (await latest.onOpenDependency(latest.tree[0]!.items[0]!)));

    expect(gateway.readSourceTextBounded).not.toHaveBeenCalled();
    expect(latest.error).toBeNull();
  });

  it("bounds dirty manifests and reports navigation failures", async () => {
    const gateway = sourceGateway();
    await render({
      documents: [packageJsonDocument(" ".repeat(256 * 1024 + 1))],
      gateway,
    });
    await act(async () => void (await latest.onOpenDependency(latest.tree[0]!.items[0]!)));
    expect(latest.error).toContain("too large");
    expect(gateway.readSourceTextBounded).not.toHaveBeenCalled();

    await render({
      gateway: sourceGateway('{"dependencies":{"express":"^5"}}'),
      onOpenLocation: async () => {
        throw new Error("closed");
      },
    });
    await act(async () => void (await latest.onOpenDependency(latest.tree[0]!.items[0]!)));
    expect(latest.error).toBe("Could not open package.json.");
  });

  it("defensively rejects an oversized successful bounded read", async () => {
    const gateway = sourceGateway("é".repeat(128 * 1024 + 1));
    const onOpenLocation = vi.fn(async () => true);
    await render({ gateway, onOpenLocation });

    await act(async () => void (await latest.onOpenDependency(latest.tree[0]!.items[0]!)));

    expect(latest.error).toContain("too large");
    expect(onOpenLocation).not.toHaveBeenCalled();
  });

  it("drops an old read after a same-component workspace switch", async () => {
    let resolveRead!: (value: { status: "ok"; content: string }) => void;
    const gateway = sourceGateway();
    vi.mocked(gateway.readSourceTextBounded).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    let switchWorkspace!: () => void;
    await act(async () => {
      root.render(
        <Harness
          gateway={gateway}
          onReady={(controller, switchOwner) => {
            latest = controller;
            switchWorkspace = switchOwner;
          }}
        />,
      );
    });
    act(() => latest.onQueryChange("express"));
    expect(latest.query).toBe("express");
    let result!: boolean;
    let pending!: Promise<void>;
    act(() => {
      pending = Promise.resolve(latest.onOpenDependency(latest.tree[0]!.items[0]!)).then(
        (value) => {
          result = value === true;
        },
      );
    });
    await act(async () => switchWorkspace());
    await act(async () => resolveRead({ status: "ok", content: "{}" }));
    await pending;

    expect(result).toBe(false);
    expect(latest.error).toBeNull();
    expect(latest.query).toBe("");
  });

  it("passes an owner guard through navigation and drops its result after a workspace switch", async () => {
    let resolveOpen!: (opened: boolean) => void;
    let shouldCommit!: () => boolean;
    const onOpenLocation = vi.fn(
      async (_path: string, _line: number, _column: number, commit: () => boolean) => {
        shouldCommit = commit;
        return new Promise<boolean>((resolve) => {
          resolveOpen = resolve;
        });
      },
    );
    let switchWorkspace!: () => void;
    await act(async () => {
      root.render(
        <Harness
          gateway={sourceGateway('{"dependencies":{"express":"^5"}}')}
          onOpenLocation={onOpenLocation}
          onReady={(controller, switchOwner) => {
            latest = controller;
            switchWorkspace = switchOwner;
          }}
        />,
      );
    });

    let result!: boolean;
    let pending!: Promise<void>;
    act(() => {
      pending = Promise.resolve(latest.onOpenDependency(latest.tree[0]!.items[0]!)).then(
        (value) => {
          result = value === true;
        },
      );
    });
    await vi.waitFor(() => expect(onOpenLocation).toHaveBeenCalledOnce());
    expect(shouldCommit()).toBe(true);

    await act(async () => switchWorkspace());
    expect(shouldCommit()).toBe(false);
    await act(async () => resolveOpen(true));
    await pending;

    expect(result).toBe(false);
    expect(latest.error).toBeNull();
  });

  it("previews before confirmation, runs once, and refreshes after success", async () => {
    const operationsGateway = packageOperationsGateway();
    const onRefresh = vi.fn();
    await render({ onRefresh, operationsGateway });

    await act(async () => void (await latest.onUpdateDependency(latest.tree[0]!.items[0]!)));
    expect(operationsGateway.previewPackageOperation).toHaveBeenCalledWith({
      operation: "update",
      packageName: "express",
      workspaceId: "one",
    });
    expect(operationsGateway.runPackageOperation).not.toHaveBeenCalled();
    expect(latest.pendingOperation?.preview.description).toBe("Update express");

    await act(async () => void (await latest.onConfirmOperation()));
    expect(operationsGateway.runPackageOperation).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(latest.pendingOperation).toBeNull();
    expect(latest.status).toBe("Packages updated");
  });

  it("validates bounded install names and enforces workspace trust", async () => {
    const operationsGateway = packageOperationsGateway();
    await render({ operationsGateway });
    await act(async () => void (await latest.onInstallPackage("INVALID NAME", false)));
    expect(latest.error).toContain("valid npm package name");
    expect(operationsGateway.previewPackageOperation).not.toHaveBeenCalled();

    await render({ operationsGateway, trusted: false });
    await act(async () => void (await latest.onCheckOutdated()));
    expect(latest.error).toContain("Trust this workspace");
    expect(operationsGateway.previewPackageOperation).not.toHaveBeenCalled();
  });

  it("fails closed when package.json has unsaved changes", async () => {
    const operationsGateway = packageOperationsGateway();
    await render({
      documents: [packageJsonDocument('{"dependencies":{"express":"next"}}')],
      operationsGateway,
    });

    await act(async () => void (await latest.onUpdateDependency(latest.tree[0]!.items[0]!)));

    expect(latest.error).toBe(
      "Save or discard package.json changes before running package operations.",
    );
    expect(operationsGateway.previewPackageOperation).not.toHaveBeenCalled();
    expect(operationsGateway.runPackageOperation).not.toHaveBeenCalled();
  });

  it("rechecks dirty package.json state before confirming a preview", async () => {
    const operationsGateway = packageOperationsGateway();
    await render({ operationsGateway });
    await act(async () => void (await latest.onUpdateDependency(latest.tree[0]!.items[0]!)));
    expect(latest.pendingOperation).not.toBeNull();

    await render({
      documents: [packageJsonDocument('{"dependencies":{"express":"next"}}')],
      operationsGateway,
    });
    await act(async () => void (await latest.onConfirmOperation()));

    expect(latest.error).toContain("Save or discard package.json changes");
    expect(operationsGateway.runPackageOperation).not.toHaveBeenCalled();
  });

  it("drops stale previews and run results after a workspace switch", async () => {
    let resolvePreview!: (
      value: Awaited<ReturnType<PackageOperationsGateway["previewPackageOperation"]>>,
    ) => void;
    const operationsGateway = packageOperationsGateway();
    vi.mocked(operationsGateway.previewPackageOperation).mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePreview = resolve;
      }),
    );
    let switchWorkspace!: () => void;
    await act(async () => {
      root.render(
        <Harness
          gateway={sourceGateway()}
          operationsGateway={operationsGateway}
          onReady={(controller, switchOwner) => {
            latest = controller;
            switchWorkspace = switchOwner;
          }}
        />,
      );
    });
    let previewPromise!: Promise<unknown>;
    act(() => {
      previewPromise = Promise.resolve(latest.onCheckOutdated());
    });
    await act(async () => switchWorkspace());
    await act(async () =>
      resolvePreview({
        arguments: ["outdated"],
        description: "Check outdated packages",
        manager: "pnpm",
        mutatesManifest: false,
      }),
    );
    await previewPromise;
    expect(latest.pendingOperation).toBeNull();
    expect(latest.status).toBeNull();
  });

  it("keeps a failed operation preview available and exposes the error", async () => {
    const operationsGateway = packageOperationsGateway();
    vi.mocked(operationsGateway.runPackageOperation).mockResolvedValueOnce({
      message: "Registry unavailable",
      status: "unavailable",
    });
    const onRefresh = vi.fn();
    await render({ onRefresh, operationsGateway });
    await act(async () => void (await latest.onRemoveDependency(latest.tree[0]!.items[0]!)));
    await act(async () => void (await latest.onConfirmOperation()));
    expect(latest.error).toBe("Registry unavailable");
    expect(latest.pendingOperation).not.toBeNull();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  async function render(overrides: Partial<Parameters<typeof Harness>[0]> = {}): Promise<void> {
    await act(async () => {
      root.render(
        <Harness
          gateway={overrides.gateway ?? sourceGateway()}
          documents={overrides.documents}
          onOpenLocation={overrides.onOpenLocation}
          onRefresh={overrides.onRefresh}
          operationsGateway={overrides.operationsGateway}
          trusted={overrides.trusted}
          onReady={(controller) => {
            latest = controller;
          }}
        />,
      );
    });
  }
});

function Harness({
  documents = [],
  gateway,
  onOpenLocation = async () => true,
  onRefresh = vi.fn(),
  onReady,
  operationsGateway = packageOperationsGateway(),
  trusted = true,
}: {
  documents?: EditorDocument[];
  gateway: WorkspaceSourceDiscoveryGateway;
  onOpenLocation?: Parameters<typeof usePackageDependenciesPanelController>[0]["onOpenLocation"];
  onRefresh?: Parameters<typeof usePackageDependenciesPanelController>[0]["onRefresh"];
  onReady(
    value: ReturnType<typeof usePackageDependenciesPanelController>,
    switchWorkspace: () => void,
  ): void;
  operationsGateway?: PackageOperationsGateway;
  trusted?: boolean;
}) {
  const [owner, setOwner] = useState({ rootPath: "/workspace", workspaceId: "one" });
  const controller = usePackageDependenciesPanelController({
    documents,
    gateway,
    onOpenLocation,
    onRefresh,
    operationsGateway,
    packageManager: "pnpm",
    packages: [dependency()],
    trusted,
    ...owner,
  });
  onReady(controller, () => setOwner({ rootPath: "/other", workspaceId: "two" }));
  return null;
}

function packageOperationsGateway(): PackageOperationsGateway {
  return {
    previewPackageOperation: vi.fn(async () => ({
      arguments: ["update", "express"],
      description: "Update express",
      manager: "pnpm" as const,
      mutatesManifest: true,
    })),
    runPackageOperation: vi.fn(async () => ({
      manifestChanged: true,
      message: "Packages updated",
      status: "ok" as const,
    })),
  };
}

function sourceGateway(content = "{}"): WorkspaceSourceDiscoveryGateway {
  return {
    enumerateJavaScriptSourceFiles: vi.fn(),
    readSourceTextBounded: vi.fn(async () => ({ status: "ok" as const, content })),
  };
}

function dependency(): NpmPackageDescriptor {
  return {
    declaredRange: "^5",
    dev: false,
    installedVersion: "5.1.0",
    installPath: "/workspace/node_modules/express",
    name: "express",
  };
}

function packageJsonDocument(content: string): EditorDocument {
  return {
    content,
    language: "json",
    name: "package.json",
    path: "/workspace/package.json",
    savedContent: "{}",
  };
}
