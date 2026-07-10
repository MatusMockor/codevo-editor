import { invoke } from "@tauri-apps/api/core";
import {
  createWorkspaceRoot,
  parseWorkspacePath,
  type WorkspacePathPolicy,
} from "../domain/workspacePath";

export type NativeUnicodeNormalizationPolicy =
  | "canonicalDecomposition"
  | "preserved"
  | "unknown";

export interface NativeWorkspaceDescriptor {
  workspaceId: string;
  selectedRootPath: string;
  canonicalRootPath: string;
  caseSensitive: boolean | null;
  unicodeNormalizationPolicy: NativeUnicodeNormalizationPolicy;
}

export interface WorkspaceIdentityDescriptor {
  workspaceId: string;
  selectedPath: string;
  canonicalRoot: string;
  caseSensitive: boolean | null;
  unicodeNormalizationPolicy: NativeUnicodeNormalizationPolicy;
  policy: WorkspacePathPolicy;
}

export type NativeWorkspaceOpenResult =
  | { status: "cancelled" }
  | { status: "opened"; descriptor: NativeWorkspaceDescriptor };

export type WorkspaceOpenResult =
  | { status: "cancelled" }
  | { status: "opened"; descriptor: WorkspaceIdentityDescriptor };

export interface WorkspaceIdentityGateway {
  openFromPicker(): Promise<WorkspaceOpenResult>;
  getDescriptor(workspaceId: string): Promise<NativeWorkspaceDescriptor>;
  unregister(workspaceId: string): Promise<void>;
}

export interface WorkspaceIdentityDescriptorResolver {
  descriptorForPath(path: string): WorkspaceIdentityDescriptor | null;
}

export class TauriWorkspaceIdentityGateway
  implements WorkspaceIdentityGateway, WorkspaceIdentityDescriptorResolver
{
  private readonly descriptors = new Map<string, WorkspaceIdentityDescriptor>();

  async openFromPicker(): Promise<WorkspaceOpenResult> {
    const result = await invoke<NativeWorkspaceOpenResult>(
      "open_workspace_from_picker",
    );

    if (result.status === "cancelled") {
      return result;
    }

    const descriptor = workspaceIdentityDescriptor(
      result.descriptor,
      result.descriptor.selectedRootPath,
    );
    this.descriptors.set(descriptor.workspaceId, descriptor);

    return {
      status: "opened",
      descriptor,
    };
  }

  descriptorForPath(path: string): WorkspaceIdentityDescriptor | null {
    let best: WorkspaceIdentityDescriptor | null = null;
    for (const descriptor of this.descriptors.values()) {
      if (!workspaceDescriptorContainsPath(descriptor, path)) {
        continue;
      }

      if (!best || descriptor.selectedPath.length > best.selectedPath.length) {
        best = descriptor;
      }
    }

    return best;
  }

  getDescriptor(workspaceId: string): Promise<NativeWorkspaceDescriptor> {
    return invoke<NativeWorkspaceDescriptor>("get_workspace_descriptor", {
      workspaceId,
    });
  }

  unregister(workspaceId: string): Promise<void> {
    this.descriptors.delete(workspaceId);
    return invoke<void>("unregister_workspace", { workspaceId });
  }
}

function workspaceDescriptorContainsPath(
  descriptor: WorkspaceIdentityDescriptor,
  path: string,
): boolean {
  return [descriptor.selectedPath, descriptor.canonicalRoot].some(
    (root) => workspaceRelativePathForRoot(descriptor, root, path) !== null,
  );
}

export function workspaceRelativePathForDescriptor(
  descriptor: WorkspaceIdentityDescriptor,
  path: string,
): string | null {
  for (const root of [descriptor.selectedPath, descriptor.canonicalRoot]) {
    const relativePath = workspaceRelativePathForRoot(descriptor, root, path);
    if (relativePath !== null) {
      return relativePath;
    }
  }

  return null;
}

function workspaceRelativePathForRoot(
  descriptor: WorkspaceIdentityDescriptor,
  rootPath: string,
  path: string,
): string | null {
  const root = createWorkspaceRoot(
    descriptor.workspaceId,
    rootPath,
    descriptor.policy,
  );
  if (!root.ok) {
    return null;
  }

  const parsed = parseWorkspacePath(root.value, path);
  return parsed.ok ? parsed.value.relativePath : null;
}

export function workspaceIdentityDescriptor(
  descriptor: NativeWorkspaceDescriptor,
  selectedPath: string = descriptor.canonicalRootPath,
): WorkspaceIdentityDescriptor {
  return {
    workspaceId: descriptor.workspaceId,
    selectedPath,
    canonicalRoot: descriptor.canonicalRootPath,
    caseSensitive: descriptor.caseSensitive,
    unicodeNormalizationPolicy: descriptor.unicodeNormalizationPolicy,
    policy: workspacePathPolicy(descriptor),
  };
}

function workspacePathPolicy(
  descriptor: NativeWorkspaceDescriptor,
): WorkspacePathPolicy {
  const unicodeNormalization =
    descriptor.unicodeNormalizationPolicy === "canonicalDecomposition"
      ? "NFD"
      : "none";

  if (descriptor.caseSensitive !== false) {
    return { caseSensitive: true, unicodeNormalization };
  }

  return {
    caseSensitive: false,
    foldCase: (value) => value.toLocaleLowerCase("en-US"),
    unicodeNormalization,
  };
}
