import type { WorkspacePathPolicy } from "../domain/workspacePath";

export type NativeUnicodeNormalizationPolicy = "canonicalDecomposition" | "preserved" | "unknown";

export interface NativeWorkspaceDescriptor {
  workspaceId: string;
  selectedRootPath: string;
  canonicalRootPath: string;
  caseSensitive: boolean | null;
  unicodeNormalizationPolicy: NativeUnicodeNormalizationPolicy;
}

export interface NativeWorkspaceRegistrationReceipt {
  admissionToken: number;
  createdIdentity: boolean;
  workspaceId: string;
}

export interface NativeWorkspaceRegistrationResult {
  descriptor: NativeWorkspaceDescriptor;
  registration: NativeWorkspaceRegistrationReceipt;
}

export interface WorkspaceIdentityDescriptor {
  admissionToken?: number;
  workspaceId: string;
  selectedPath: string;
  canonicalRoot: string;
  caseSensitive: boolean | null;
  unicodeNormalizationPolicy: NativeUnicodeNormalizationPolicy;
  policy: WorkspacePathPolicy;
}

export type NativeWorkspaceOpenResult =
  | { status: "cancelled" }
  | {
      status: "opened";
      descriptor: NativeWorkspaceDescriptor;
      registration: NativeWorkspaceRegistrationReceipt;
    };

export type WorkspaceOpenResult =
  { status: "cancelled" } | { status: "opened"; descriptor: WorkspaceIdentityDescriptor };

export interface WorkspaceIdentityGateway {
  openFromPicker(): Promise<WorkspaceOpenResult>;
  openPath?(path: string): Promise<WorkspaceIdentityDescriptor>;
  getDescriptor(workspaceId: string): Promise<NativeWorkspaceDescriptor>;
  unregister(workspaceId: string): Promise<void>;
}

export interface WorkspaceIdentityPathMatch {
  descriptor: WorkspaceIdentityDescriptor;
  matchedRoot: string;
  relativePath: string;
}

export interface WorkspaceIdentityDescriptorResolver {
  descriptorForPath(path: string): WorkspaceIdentityDescriptor | null;
  matchForPath?(path: string, workspaceId?: string): WorkspaceIdentityPathMatch | null;
}
