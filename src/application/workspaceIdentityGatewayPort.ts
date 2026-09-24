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

export interface WorkspaceIdentityReleaseOwner {
  readonly workspaceId: string;
  readonly admissionToken: number | null;
  readonly canonicalRootPath: string;
}

export interface WorkspaceAdmissionAdoption {
  readonly workspaceId: string;
  readonly newToken: number;
  readonly replacedToken: number;
}

export type WorkspaceAdmissionAdoptionResult =
  | { readonly status: "adopted" }
  | { readonly status: "staleAdmission" }
  | { readonly status: "unknownWorkspace" }
  | { readonly status: "releasing" };

export type WorkspaceOwnerReleaseResult =
  | { readonly status: "released" }
  | { readonly status: "releasing" }
  | { readonly status: "retainedByOtherOwners" }
  | { readonly status: "unknownWorkspace" }
  | { readonly status: "staleOwner" };

export interface WorkspaceIdentityGateway {
  openFromPicker(): Promise<WorkspaceOpenResult>;
  openPath?(path: string): Promise<WorkspaceIdentityDescriptor>;
  getDescriptor(workspaceId: string): Promise<NativeWorkspaceDescriptor>;
  unregister(owner: WorkspaceIdentityReleaseOwner): Promise<WorkspaceOwnerReleaseResult>;
  adoptAdmission(adoption: WorkspaceAdmissionAdoption): Promise<WorkspaceAdmissionAdoptionResult>;
  rollbackAdmission(descriptor: WorkspaceIdentityDescriptor): Promise<WorkspaceOwnerReleaseResult>;
  settleClosedDescriptor?(descriptor: WorkspaceIdentityDescriptor): boolean;
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
