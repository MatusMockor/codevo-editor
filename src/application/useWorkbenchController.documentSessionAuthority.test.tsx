// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { defaultAppSettings, defaultWorkspaceSettings } from "../domain/settings";
import type { FileEntry } from "../domain/workspace";
import { waitForReact } from "../test/reactTestLifecycle";
import {
  flushAsyncTurns,
  setupWorkbenchControllerTestHarness,
  type WorkbenchController,
} from "../test/workbenchControllerTestHarness";
import type {
  NativeWorkspaceDescriptor,
  WorkspaceIdentityDescriptor,
} from "./workspaceIdentityGatewayPort";
import type { WorkspaceIdentityDescriptorResolver } from "../infrastructure/tauriWorkspaceIdentityGateway";
import type { WorkbenchWorkspaceGateways } from "./workbenchControllerContracts";

describe("useWorkbenchController document-session authority", () => {
  const { renderController } = setupWorkbenchControllerTestHarness();

  it("activates cached exact owners across A-B-A without accepting an old group lease", async () => {
    const identity = identityGateway();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path) => `// ${path}`),
      workspaceIdentityGateway: identity,
    });
    await waitForReact(() => expect(getWorkbench().workspaceRoot).toBe("/workspace-a"));

    await openFile(getWorkbench, "/workspace-a/src/a.ts");
    const firstARevision = getWorkbench().documentSessionAuthorityRevision;
    await switchWorkspace(getWorkbench, "/workspace-b");
    await openFile(getWorkbench, "/workspace-b/src/b.ts");
    const ownerBRevision = getWorkbench().documentSessionAuthorityRevision;
    expect(ownerBRevision).not.toBe(firstARevision);
    await switchWorkspace(getWorkbench, "/workspace-a");
    const returnedARevision = getWorkbench().documentSessionAuthorityRevision;
    expect(returnedARevision).not.toBe(ownerBRevision);

    const firstA = getWorkbench().resolveActiveDocumentSessionAuthority();
    expect(firstA?.path).toBe("/workspace-a/src/a.ts");
    expect(getWorkbench().isEditorGroupDocumentSessionAuthorityCurrent(firstA!)).toBe(true);
    const firstALiveAttachment = getWorkbench().attachEditorGroupLiveDocument(
      firstA!,
      {
        captureCurrentContent: () => getWorkbench().activeDocument?.content ?? null,
        holderIncarnation: Object.freeze({}),
        modelIncarnation: Object.freeze({}),
      },
      liveRevision(1, getWorkbench().activeDocument?.content.length ?? 0),
    );
    expect(firstALiveAttachment).not.toBeNull();
    expect(firstALiveAttachment?.observe(liveRevision(2))).toBe(true);

    await switchWorkspace(getWorkbench, "/workspace-b");
    const ownerB = getWorkbench().resolveActiveDocumentSessionAuthority();
    expect(ownerB?.path).toBe("/workspace-b/src/b.ts");
    expect(getWorkbench().isEditorGroupDocumentSessionAuthorityCurrent(firstA!)).toBe(false);
    expect(firstALiveAttachment?.observe(liveRevision(3))).toBe(false);
    expect(firstALiveAttachment?.release()).toBe(true);

    await switchWorkspace(getWorkbench, "/workspace-a");
    const secondA = getWorkbench().resolveActiveDocumentSessionAuthority();
    expect(secondA?.path).toBe("/workspace-a/src/a.ts");
    expect(secondA?.identity).not.toBe(firstA?.identity);
    expect(getWorkbench().isEditorGroupDocumentSessionAuthorityCurrent(ownerB!)).toBe(false);
    expect(getWorkbench().isDocumentSessionLifecycleAuthorityCurrent(secondA!)).toBe(true);
  });

  it("keeps legacy workspaces outside the exact document authority", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/legacy",
        workspaceTabs: ["/legacy"],
      },
      readTextFile: vi.fn(async () => "const legacy = true;"),
    });
    await waitForReact(() => expect(getWorkbench().workspaceRoot).toBe("/legacy"));

    await openFile(getWorkbench, "/legacy/src/legacy.ts");

    expect(
      getWorkbench().resolveDocumentSessionLifecycleAuthority("/legacy/src/legacy.ts"),
    ).toBeNull();
    expect(getWorkbench().resolveActiveDocumentSessionAuthority()).toBeNull();
  });

  it("activates exact authority only after a cold persisted session restore settles", async () => {
    const path = "/workspace-a/src/restored.ts";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a"],
      },
      readTextFile: vi.fn(async () => "export const restored = true;"),
      workspaceIdentityGateway: identityGateway(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        session: {
          activePath: path,
          bottomPanelView: "problems",
          openPaths: [path],
          sidebarView: "files",
        },
      },
    });
    const coldRevision = getWorkbench().documentSessionAuthorityRevision;

    await waitForReact(() => expect(getWorkbench().activePath).toBe(path));
    expect(getWorkbench().documentSessionAuthorityRevision).not.toBe(coldRevision);
    const authority = getWorkbench().resolveActiveDocumentSessionAuthority();
    expect(authority?.path).toBe(path);
    expect(getWorkbench().isDocumentSessionLifecycleAuthorityCurrent(authority!)).toBe(true);
  });
});

function liveRevision(version: number, utf16Length = 20 + version) {
  return {
    alternativeVersionId: version,
    contentVersion: version,
    mode: version === 1 ? ("retained" as const) : ("incremental" as const),
    modelVersionId: version,
    utf16Length,
  };
}

async function openFile(getWorkbench: () => WorkbenchController, path: string): Promise<void> {
  const entry: FileEntry = {
    kind: "file",
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
  };
  await act(async () => {
    await getWorkbench().openFile(entry);
  });
  await flushAsyncTurns();
}

async function switchWorkspace(
  getWorkbench: () => WorkbenchController,
  path: string,
): Promise<void> {
  await act(async () => {
    await getWorkbench().activateWorkspaceTab(path);
  });
  await waitForReact(() => expect(getWorkbench().workspaceRoot).toBe(path));
}

function identityGateway(): WorkbenchWorkspaceGateways["identity"] &
  WorkspaceIdentityDescriptorResolver {
  const descriptors = new Map<string, WorkspaceIdentityDescriptor>();
  const descriptorFor = (path: string) => descriptor(path.endsWith("-a") ? "a" : "b");
  return {
    descriptorForPath: (path) => match(path, descriptors)?.descriptor ?? null,
    getDescriptor: vi.fn(async (workspaceId) =>
      nativeDescriptor(descriptor(workspaceId.endsWith("-a") ? "a" : "b")),
    ),
    matchForPath: (path, workspaceId) => {
      const resolved = match(path, descriptors, workspaceId);
      return resolved
        ? {
            descriptor: resolved.descriptor,
            matchedRoot: resolved.descriptor.selectedPath,
            relativePath: resolved.relativePath,
          }
        : null;
    },
    openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
    openPath: vi.fn(async (path) => {
      const resolved = descriptorFor(path);
      descriptors.set(resolved.workspaceId, resolved);
      return resolved;
    }),
    unregister: vi.fn(async () => undefined),
  };
}

function match(
  path: string,
  descriptors: ReadonlyMap<string, WorkspaceIdentityDescriptor>,
  workspaceId?: string,
): { descriptor: WorkspaceIdentityDescriptor; relativePath: string } | null {
  for (const descriptor of descriptors.values()) {
    if (
      (!workspaceId || descriptor.workspaceId === workspaceId) &&
      (path === descriptor.selectedPath || path.startsWith(`${descriptor.selectedPath}/`))
    ) {
      return {
        descriptor,
        relativePath:
          path === descriptor.selectedPath ? "" : path.slice(descriptor.selectedPath.length + 1),
      };
    }
  }
  return null;
}

function descriptor(id: "a" | "b"): WorkspaceIdentityDescriptor {
  return {
    canonicalRoot: `/workspace-${id}`,
    caseSensitive: true,
    policy: { caseSensitive: true, unicodeNormalization: "none" },
    selectedPath: `/workspace-${id}`,
    unicodeNormalizationPolicy: "preserved",
    workspaceId: `workspace-${id}`,
  };
}

function nativeDescriptor(value: WorkspaceIdentityDescriptor): NativeWorkspaceDescriptor {
  return {
    canonicalRootPath: value.canonicalRoot,
    caseSensitive: value.caseSensitive,
    selectedRootPath: value.selectedPath,
    unicodeNormalizationPolicy: value.unicodeNormalizationPolicy,
    workspaceId: value.workspaceId,
  };
}
