import type { WorkspacePathPolicy } from "../domain/workspacePath";

export type NativeUnicodeNormalizationPolicy = "canonicalDecomposition" | "preserved" | "unknown";

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
  { status: "cancelled" } | { status: "opened"; descriptor: NativeWorkspaceDescriptor };

export type WorkspaceOpenResult =
  { status: "cancelled" } | { status: "opened"; descriptor: WorkspaceIdentityDescriptor };

export interface WorkspaceIdentityGateway {
  openFromPicker(): Promise<WorkspaceOpenResult>;
  openPath?(path: string): Promise<WorkspaceIdentityDescriptor>;
  getDescriptor(workspaceId: string): Promise<NativeWorkspaceDescriptor>;
  unregister(workspaceId: string): Promise<void>;
}
