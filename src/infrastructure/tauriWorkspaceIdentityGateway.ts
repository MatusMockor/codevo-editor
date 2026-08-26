import { invoke } from "@tauri-apps/api/core";
import {
  createWorkspaceRoot,
  parseWorkspacePath,
  type WorkspacePathPolicy,
} from "../domain/workspacePath";
import type {
  NativeWorkspaceDescriptor,
  NativeWorkspaceOpenResult,
  NativeWorkspaceRegistrationReceipt,
  NativeWorkspaceRegistrationResult,
  WorkspaceIdentityDescriptor,
  WorkspaceIdentityDescriptorResolver,
  WorkspaceIdentityGateway,
  WorkspaceIdentityPathMatch,
  WorkspaceOpenResult,
} from "../application/workspaceIdentityGatewayPort";

export type {
  NativeUnicodeNormalizationPolicy,
  NativeWorkspaceDescriptor,
  NativeWorkspaceOpenResult,
  NativeWorkspaceRegistrationReceipt,
  NativeWorkspaceRegistrationResult,
  WorkspaceIdentityDescriptor,
  WorkspaceIdentityDescriptorResolver,
  WorkspaceIdentityGateway,
  WorkspaceIdentityPathMatch,
  WorkspaceOpenResult,
} from "../application/workspaceIdentityGatewayPort";
export { workspaceRelativePathForDescriptor } from "../application/workspaceIdentityPath";

interface WorkspaceIdentityGatewayLimits {
  readonly maxAliasesPerWorkspace?: number;
  readonly maxPendingOperations?: number;
  readonly maxWorkspaces?: number;
  readonly operationTimeoutMs?: number;
}

interface OperationAdmission {
  active: boolean;
  rejectDisposed: (error: Error) => void;
  readonly disposed: Promise<never>;
}

class WorkspaceRegistrationParseError extends Error {
  constructor(
    message: string,
    readonly registration: NativeWorkspaceRegistrationReceipt,
  ) {
    super(message);
  }
}

const DEFAULT_MAX_PENDING_IDENTITY_OPERATIONS = 16;
const DEFAULT_MAX_ALIASES_PER_WORKSPACE = 16;
const DEFAULT_MAX_MANAGED_WORKSPACES = 16;
const DEFAULT_IDENTITY_OPERATION_TIMEOUT_MS = 15_000;
const MAX_CACHED_IDENTITY_PATH_CHARACTERS = 4_096;
const MAX_IDENTITY_PATH_MATCH_CACHE_ENTRIES = 512;
const MAX_WORKSPACE_ID_UTF8_BYTES = 1_024;
const MAX_WORKSPACE_ROOT_UTF8_BYTES = 32_768;
const identityUtf8Encoder = new TextEncoder();

export class TauriWorkspaceIdentityGateway
  implements WorkspaceIdentityGateway, WorkspaceIdentityDescriptorResolver
{
  private readonly descriptors = new Map<string, WorkspaceIdentityDescriptor>();
  private readonly aliases = new Map<string, readonly string[]>();
  private readonly pathMatches = new Map<string, WorkspaceIdentityPathMatch | null>();
  private readonly unregisterSequences = new Map<string, number>();
  private readonly operationAdmissions = new Set<OperationAdmission>();
  private readonly maxAliasesPerWorkspace: number;
  private readonly maxPendingOperations: number;
  private readonly maxWorkspaces: number;
  private readonly operationTimeoutMs: number;
  private aliasAdmissionQuarantined = false;
  private cleanupTransportReserved = false;
  private operationSequence = 0;
  private operationTail: Promise<void> = Promise.resolve();
  private outstandingTransports = 0;
  private pendingOperations = 0;
  private disposed = false;

  constructor(limits: WorkspaceIdentityGatewayLimits = {}) {
    this.maxAliasesPerWorkspace = positiveInteger(
      limits.maxAliasesPerWorkspace,
      DEFAULT_MAX_ALIASES_PER_WORKSPACE,
    );
    this.maxPendingOperations = positiveInteger(
      limits.maxPendingOperations,
      DEFAULT_MAX_PENDING_IDENTITY_OPERATIONS,
    );
    this.maxWorkspaces = positiveInteger(limits.maxWorkspaces, DEFAULT_MAX_MANAGED_WORKSPACES);
    this.operationTimeoutMs = positiveInteger(
      limits.operationTimeoutMs,
      DEFAULT_IDENTITY_OPERATION_TIMEOUT_MS,
    );
  }

  openFromPicker(): Promise<WorkspaceOpenResult> {
    if (this.aliasAdmissionQuarantined) {
      return Promise.reject(new Error("Workspace identity alias admission is quarantined."));
    }
    const sequence = this.nextOperationSequence();
    return this.serialize(async (admission) => {
      let result: NativeWorkspaceOpenResult;
      try {
        result = parseNativeWorkspaceOpenResult(
          await this.invokeBounded<unknown>("open_workspace_from_picker"),
        );
      } catch (error) {
        if (error instanceof WorkspaceRegistrationParseError) {
          await this.rollbackRegistration(error.registration);
        }
        throw error;
      }

      if (result.status === "cancelled") {
        this.assertActive(admission);
        return result;
      }

      if (!admission.active || this.disposed) {
        await this.rollbackRegistration(result.registration);
        this.assertActive(admission);
      }
      const descriptor = await this.admitDescriptor(
        result.descriptor,
        result.registration,
        sequence,
        admission,
      );

      return {
        status: "opened",
        descriptor,
      };
    });
  }

  openPath(path: string): Promise<WorkspaceIdentityDescriptor> {
    if (this.aliasAdmissionQuarantined) {
      return Promise.reject(new Error("Workspace identity alias admission is quarantined."));
    }
    try {
      assertBoundedIdentityText(path, "Workspace path", MAX_WORKSPACE_ROOT_UTF8_BYTES);
    } catch (error) {
      return Promise.reject(error);
    }
    const sequence = this.nextOperationSequence();
    return this.serialize(async (admission) => {
      let result: NativeWorkspaceRegistrationResult;
      try {
        result = parseNativeWorkspaceRegistrationResult(
          await this.invokeBounded<unknown>("register_workspace_path", {
            rootPath: path,
          }),
        );
      } catch (error) {
        if (error instanceof WorkspaceRegistrationParseError) {
          await this.rollbackRegistration(error.registration);
        }
        throw error;
      }
      if (!admission.active || this.disposed) {
        await this.rollbackRegistration(result.registration);
        this.assertActive(admission);
      }
      this.assertActive(admission);
      return this.admitDescriptor(result.descriptor, result.registration, sequence, admission);
    });
  }

  descriptorForPath(path: string): WorkspaceIdentityDescriptor | null {
    return this.matchForPath(path)?.descriptor ?? null;
  }

  matchForPath(path: string, workspaceId?: string): WorkspaceIdentityPathMatch | null {
    const cacheKey = identityPathMatchCacheKey(path, workspaceId);
    if (cacheKey !== null && this.pathMatches.has(cacheKey)) {
      return this.pathMatches.get(cacheKey) ?? null;
    }

    let best: WorkspaceIdentityPathMatch | null = null;
    let bestSpecificity: WorkspaceRootSpecificity | null = null;
    for (const [candidateWorkspaceId, aliases] of this.aliases) {
      if (workspaceId && candidateWorkspaceId !== workspaceId) {
        continue;
      }

      const descriptor = this.descriptors.get(candidateWorkspaceId);
      if (!descriptor) {
        continue;
      }

      const match = matchedWorkspaceAlias(descriptor, aliases, path);
      if (!match) {
        continue;
      }

      const specificity = canonicalRootSpecificity(descriptor);
      if (!specificity) {
        continue;
      }

      if (isMoreSpecific(specificity, bestSpecificity)) {
        best = match;
        bestSpecificity = specificity;
      }
    }

    if (cacheKey !== null) {
      this.cachePathMatch(cacheKey, best);
    }
    return best;
  }

  getDescriptor(workspaceId: string): Promise<NativeWorkspaceDescriptor> {
    try {
      assertBoundedIdentityText(workspaceId, "Workspace id", MAX_WORKSPACE_ID_UTF8_BYTES);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.serialize(async (admission) => {
      const descriptor = parseNativeWorkspaceDescriptor(
        await this.invokeBounded<unknown>("get_workspace_descriptor", {
          workspaceId,
        }),
      );
      if (descriptor.workspaceId !== workspaceId) {
        throw new Error("Workspace identity returned a descriptor for a different workspace.");
      }
      this.assertActive(admission);
      return descriptor;
    });
  }

  unregister(workspaceId: string): Promise<void> {
    try {
      assertBoundedIdentityText(workspaceId, "Workspace id", MAX_WORKSPACE_ID_UTF8_BYTES);
    } catch (error) {
      return Promise.reject(error);
    }
    const admissionError = this.operationAdmissionError();
    if (admissionError) {
      return Promise.reject(admissionError);
    }
    if (this.cleanupTransportReserved) {
      return Promise.reject(
        new Error("Workspace identity cleanup transport capacity has been reached."),
      );
    }
    this.cleanupTransportReserved = true;
    const sequence = this.nextOperationSequence();
    this.unregisterSequences.set(workspaceId, sequence);
    this.trimUnregisterSequences();
    this.descriptors.delete(workspaceId);
    this.aliases.delete(workspaceId);
    this.invalidatePathMatches();
    return this.serialize(async (admission) => {
      this.assertActive(admission);
      this.descriptors.delete(workspaceId);
      this.aliases.delete(workspaceId);
      await this.invokeReservedCleanup(workspaceId);
      this.assertActive(admission);
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.descriptors.clear();
    this.aliases.clear();
    this.invalidatePathMatches();
    this.unregisterSequences.clear();
    const error = new Error("Workspace identity gateway was disposed.");
    for (const admission of this.operationAdmissions) {
      admission.active = false;
      admission.rejectDisposed(error);
    }
  }

  private cacheDescriptor(
    nativeDescriptor: NativeWorkspaceDescriptor,
    admissionToken: number,
    operationSequence: number,
  ): WorkspaceIdentityDescriptor {
    const descriptor = workspaceIdentityDescriptor(
      nativeDescriptor,
      nativeDescriptor.selectedRootPath,
      admissionToken,
    );
    const unregisterSequence = this.unregisterSequences.get(descriptor.workspaceId) ?? 0;
    if (unregisterSequence > operationSequence) {
      return descriptor;
    }
    if (
      !this.descriptors.has(descriptor.workspaceId) &&
      this.descriptors.size >= this.maxWorkspaces
    ) {
      throw new Error("Workspace identity capacity has been reached.");
    }

    const previousDescriptor = this.descriptors.get(descriptor.workspaceId);
    const previousAliases = this.aliases.get(descriptor.workspaceId) ?? [];
    const aliases =
      previousDescriptor?.canonicalRoot === descriptor.canonicalRoot
        ? [...new Set([...previousAliases, ...descriptorAliases(descriptor)])]
        : descriptorAliases(descriptor);
    if (aliases.length > this.maxAliasesPerWorkspace) {
      this.aliasAdmissionQuarantined = true;
      throw new Error("Workspace identity alias capacity has been reached.");
    }

    this.descriptors.set(descriptor.workspaceId, descriptor);
    this.aliases.set(descriptor.workspaceId, aliases);
    this.invalidatePathMatches();
    return descriptor;
  }

  private cachePathMatch(cacheKey: string, match: WorkspaceIdentityPathMatch | null): void {
    this.pathMatches.set(cacheKey, match);
    while (this.pathMatches.size > MAX_IDENTITY_PATH_MATCH_CACHE_ENTRIES) {
      const oldestKey = this.pathMatches.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }
      this.pathMatches.delete(oldestKey);
    }
  }

  private invalidatePathMatches(): void {
    this.pathMatches.clear();
  }

  private async admitDescriptor(
    nativeDescriptor: NativeWorkspaceDescriptor,
    registration: NativeWorkspaceRegistrationReceipt,
    operationSequence: number,
    admission: OperationAdmission,
  ): Promise<WorkspaceIdentityDescriptor> {
    if (
      !this.descriptors.has(nativeDescriptor.workspaceId) &&
      this.descriptors.size >= this.maxWorkspaces
    ) {
      await this.rollbackRegistration(registration);
      this.assertActive(admission);
      throw new Error("Workspace identity capacity has been reached.");
    }
    try {
      return this.cacheDescriptor(nativeDescriptor, registration.admissionToken, operationSequence);
    } catch (error) {
      await this.rollbackRegistration(registration);
      this.assertActive(admission);
      throw error;
    }
  }

  private nextOperationSequence(): number {
    this.operationSequence += 1;
    return this.operationSequence;
  }

  private serialize<Result>(
    operation: (admission: OperationAdmission) => Promise<Result>,
  ): Promise<Result> {
    const admissionError = this.operationAdmissionError();
    if (admissionError) {
      return Promise.reject(admissionError);
    }

    let rejectDisposed!: (error: Error) => void;
    const admission: OperationAdmission = {
      active: true,
      disposed: new Promise<never>((_resolve, reject) => {
        rejectDisposed = reject;
      }),
      rejectDisposed: (error) => rejectDisposed(error),
    };
    void admission.disposed.catch(() => undefined);
    this.pendingOperations += 1;
    this.operationAdmissions.add(admission);
    const run = async () => {
      this.assertActive(admission);
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          admission.active = false;
          reject(
            new Error(`Workspace identity operation timed out after ${this.operationTimeoutMs}ms.`),
          );
        }, this.operationTimeoutMs);
      });
      try {
        return await Promise.race([operation(admission), timeout, admission.disposed]);
      } finally {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      }
    };
    const result = this.operationTail.then(run, run).finally(() => {
      admission.active = false;
      this.operationAdmissions.delete(admission);
      this.pendingOperations -= 1;
    });
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private assertActive(admission: OperationAdmission): void {
    if (!admission.active || this.disposed) {
      throw new Error(
        this.disposed
          ? "Workspace identity gateway was disposed."
          : "Workspace identity operation is no longer current.",
      );
    }
  }

  private operationAdmissionError(): Error | null {
    if (this.disposed) {
      return new Error("Workspace identity gateway was disposed.");
    }
    if (this.pendingOperations >= this.maxPendingOperations) {
      return new Error("Workspace identity operation capacity has been reached.");
    }
    return null;
  }

  private trimUnregisterSequences(): void {
    while (this.unregisterSequences.size > this.maxPendingOperations) {
      const oldestWorkspaceId = this.unregisterSequences.keys().next().value;
      if (oldestWorkspaceId === undefined) {
        return;
      }
      this.unregisterSequences.delete(oldestWorkspaceId);
    }
  }

  private invokeBounded<Result>(command: string, args?: Record<string, unknown>): Promise<Result> {
    if (this.outstandingTransports >= this.maxPendingOperations) {
      return Promise.reject(new Error("Workspace identity transport capacity has been reached."));
    }
    this.outstandingTransports += 1;
    let operation: Promise<Result>;
    try {
      operation = args === undefined ? invoke<Result>(command) : invoke<Result>(command, args);
    } catch (error) {
      this.outstandingTransports -= 1;
      throw error;
    }
    const release = () => {
      this.outstandingTransports -= 1;
    };
    void operation.then(release, release);
    return operation;
  }

  private invokeReservedCleanup(workspaceId: string): Promise<void> {
    let operation: Promise<void>;
    try {
      operation = invoke<void>("unregister_workspace", { workspaceId });
    } catch (error) {
      this.cleanupTransportReserved = false;
      throw error;
    }
    const release = () => {
      this.cleanupTransportReserved = false;
    };
    void operation.then(release, release);
    return operation;
  }

  private async rollbackRegistration(
    registration: NativeWorkspaceRegistrationReceipt,
  ): Promise<void> {
    const confirmed = await this.invokeBounded<unknown>("rollback_workspace_registration", {
      workspaceId: registration.workspaceId,
      admissionToken: registration.admissionToken,
    });
    if (confirmed !== true) {
      throw new Error("Workspace registration rollback was not confirmed.");
    }
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? (value as number) : fallback;
}

function identityPathMatchCacheKey(path: string, workspaceId: string | undefined): string | null {
  if (
    path.length > MAX_CACHED_IDENTITY_PATH_CHARACTERS ||
    (workspaceId !== undefined && workspaceId.length > MAX_WORKSPACE_ID_UTF8_BYTES)
  ) {
    return null;
  }
  return JSON.stringify([workspaceId ?? null, path]);
}

function parseNativeWorkspaceOpenResult(value: unknown): NativeWorkspaceOpenResult {
  if (!isIdentityRecord(value)) {
    throw new Error("Workspace picker returned an invalid result.");
  }
  if (value.status === "cancelled" && Object.keys(value).length === 1) {
    return { status: "cancelled" };
  }
  if (Object.prototype.hasOwnProperty.call(value, "registration")) {
    const registration = parseNativeWorkspaceRegistrationReceipt(value.registration);
    if (
      value.status !== "opened" ||
      !hasExactIdentityKeys(value, ["status", "descriptor", "registration"]) ||
      !Object.prototype.hasOwnProperty.call(value, "descriptor")
    ) {
      throw new WorkspaceRegistrationParseError(
        "Workspace picker returned an invalid result.",
        registration,
      );
    }
    let descriptor: NativeWorkspaceDescriptor;
    try {
      descriptor = parseNativeWorkspaceDescriptor(value.descriptor);
    } catch {
      throw new WorkspaceRegistrationParseError(
        "Workspace picker returned an invalid descriptor.",
        registration,
      );
    }
    if (descriptor.workspaceId !== registration.workspaceId) {
      throw new WorkspaceRegistrationParseError(
        "Workspace picker registration owner does not match its descriptor.",
        registration,
      );
    }
    return { status: "opened", descriptor, registration };
  }
  throw new Error("Workspace picker returned an invalid result.");
}

function parseNativeWorkspaceRegistrationResult(value: unknown): NativeWorkspaceRegistrationResult {
  if (!isIdentityRecord(value)) {
    throw new Error("Workspace identity returned an invalid registration result.");
  }
  if (!Object.prototype.hasOwnProperty.call(value, "registration")) {
    throw new Error("Workspace identity returned an invalid registration result.");
  }
  const registration = parseNativeWorkspaceRegistrationReceipt(value.registration);
  if (!hasExactIdentityKeys(value, ["descriptor", "registration"])) {
    throw new WorkspaceRegistrationParseError(
      "Workspace identity returned an invalid registration result.",
      registration,
    );
  }
  let descriptor: NativeWorkspaceDescriptor;
  try {
    descriptor = parseNativeWorkspaceDescriptor(value.descriptor);
  } catch {
    throw new WorkspaceRegistrationParseError(
      "Workspace identity returned an invalid registration descriptor.",
      registration,
    );
  }
  if (descriptor.workspaceId !== registration.workspaceId) {
    throw new WorkspaceRegistrationParseError(
      "Workspace registration owner does not match its descriptor.",
      registration,
    );
  }
  return { descriptor, registration };
}

function parseNativeWorkspaceRegistrationReceipt(
  value: unknown,
): NativeWorkspaceRegistrationReceipt {
  if (
    !isIdentityRecord(value) ||
    !hasExactIdentityKeys(value, ["workspaceId", "admissionToken", "createdIdentity"]) ||
    typeof value.workspaceId !== "string" ||
    !Number.isSafeInteger(value.admissionToken) ||
    (value.admissionToken as number) <= 0 ||
    typeof value.createdIdentity !== "boolean"
  ) {
    throw new Error("Workspace identity returned an invalid registration receipt.");
  }
  assertBoundedIdentityText(value.workspaceId, "Workspace id", MAX_WORKSPACE_ID_UTF8_BYTES);
  return {
    workspaceId: value.workspaceId,
    admissionToken: value.admissionToken as number,
    createdIdentity: value.createdIdentity,
  };
}

function parseNativeWorkspaceDescriptor(value: unknown): NativeWorkspaceDescriptor {
  if (
    !isIdentityRecord(value) ||
    !hasExactIdentityKeys(value, [
      "workspaceId",
      "selectedRootPath",
      "canonicalRootPath",
      "caseSensitive",
      "unicodeNormalizationPolicy",
    ])
  ) {
    throw new Error("Workspace identity returned an invalid descriptor.");
  }
  assertBoundedIdentityText(value.workspaceId, "Workspace id", MAX_WORKSPACE_ID_UTF8_BYTES);
  assertBoundedIdentityText(
    value.selectedRootPath,
    "Selected workspace root",
    MAX_WORKSPACE_ROOT_UTF8_BYTES,
  );
  assertBoundedIdentityText(
    value.canonicalRootPath,
    "Canonical workspace root",
    MAX_WORKSPACE_ROOT_UTF8_BYTES,
  );
  if (
    (value.caseSensitive !== null && typeof value.caseSensitive !== "boolean") ||
    (value.unicodeNormalizationPolicy !== "canonicalDecomposition" &&
      value.unicodeNormalizationPolicy !== "preserved" &&
      value.unicodeNormalizationPolicy !== "unknown")
  ) {
    throw new Error("Workspace identity returned an invalid descriptor.");
  }
  return {
    workspaceId: value.workspaceId,
    selectedRootPath: value.selectedRootPath,
    canonicalRootPath: value.canonicalRootPath,
    caseSensitive: value.caseSensitive,
    unicodeNormalizationPolicy: value.unicodeNormalizationPolicy,
  };
}

function assertBoundedIdentityText(
  value: unknown,
  label: string,
  maxUtf8Bytes: number,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxUtf8Bytes ||
    value.includes("\0") ||
    identityUtf8Encoder.encode(value).byteLength > maxUtf8Bytes
  ) {
    throw new Error(`${label} is invalid or exceeds its UTF-8 limit.`);
  }
}

function isIdentityRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactIdentityKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function descriptorAliases(descriptor: WorkspaceIdentityDescriptor): string[] {
  return [...new Set([descriptor.selectedPath, descriptor.canonicalRoot])];
}

function matchedWorkspaceAlias(
  descriptor: WorkspaceIdentityDescriptor,
  aliases: readonly string[],
  path: string,
): WorkspaceIdentityPathMatch | null {
  let best: WorkspaceIdentityPathMatch | null = null;
  let bestSpecificity: WorkspaceRootSpecificity | null = null;
  for (const alias of aliases) {
    const relativePath = workspaceRelativePathForRoot(descriptor, alias, path);
    if (relativePath === null) {
      continue;
    }

    const specificity = workspaceRootSpecificity(descriptor, alias);
    if (!specificity || !isMoreSpecific(specificity, bestSpecificity)) {
      continue;
    }

    best = { descriptor, matchedRoot: alias, relativePath };
    bestSpecificity = specificity;
  }

  return best;
}

interface WorkspaceRootSpecificity {
  depth: number;
  pathLength: number;
}

function canonicalRootSpecificity(
  descriptor: WorkspaceIdentityDescriptor,
): WorkspaceRootSpecificity | null {
  return workspaceRootSpecificity(descriptor, descriptor.canonicalRoot);
}

function workspaceRootSpecificity(
  descriptor: WorkspaceIdentityDescriptor,
  rootPath: string,
): WorkspaceRootSpecificity | null {
  const root = createWorkspaceRoot(descriptor.workspaceId, rootPath, descriptor.policy);
  if (!root.ok) {
    return null;
  }

  const normalizedPath = root.value.nativePath;
  return {
    depth: normalizedPath.split("/").filter(Boolean).length,
    pathLength: normalizedPath.length,
  };
}

function isMoreSpecific(
  candidate: WorkspaceRootSpecificity,
  current: WorkspaceRootSpecificity | null,
): boolean {
  if (!current) {
    return true;
  }

  if (candidate.depth !== current.depth) {
    return candidate.depth > current.depth;
  }

  return candidate.pathLength > current.pathLength;
}

function workspaceRelativePathForRoot(
  descriptor: WorkspaceIdentityDescriptor,
  rootPath: string,
  path: string,
): string | null {
  const root = createWorkspaceRoot(descriptor.workspaceId, rootPath, descriptor.policy);
  if (!root.ok) {
    return null;
  }

  const parsed = parseWorkspacePath(root.value, path);
  return parsed.ok ? parsed.value.relativePath : null;
}

export function workspaceIdentityDescriptor(
  descriptor: NativeWorkspaceDescriptor,
  selectedPath: string = descriptor.canonicalRootPath,
  admissionToken?: number,
): WorkspaceIdentityDescriptor {
  return {
    ...(admissionToken === undefined ? {} : { admissionToken }),
    workspaceId: descriptor.workspaceId,
    selectedPath,
    canonicalRoot: descriptor.canonicalRootPath,
    caseSensitive: descriptor.caseSensitive,
    unicodeNormalizationPolicy: descriptor.unicodeNormalizationPolicy,
    policy: workspacePathPolicy(descriptor),
  };
}

function workspacePathPolicy(descriptor: NativeWorkspaceDescriptor): WorkspacePathPolicy {
  const unicodeNormalization =
    descriptor.unicodeNormalizationPolicy === "canonicalDecomposition" ? "NFD" : "none";

  if (descriptor.caseSensitive !== false) {
    return { caseSensitive: true, unicodeNormalization };
  }

  return {
    caseSensitive: false,
    foldCase: (value) => value.toLocaleLowerCase("en-US"),
    unicodeNormalization,
  };
}
