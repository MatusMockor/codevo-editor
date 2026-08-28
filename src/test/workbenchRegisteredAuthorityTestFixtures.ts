import { act } from "react";
import { vi } from "vitest";
import type { SmartModeSetRequest } from "../domain/intelligence";
import { defaultAppSettings, type WorkspaceSettingsIdentity } from "../domain/settings";
import type { WorkspaceIndexOperationRequest } from "../domain/indexProgress";
import type { LanguageServerPlan } from "../domain/languageServer";
import {
  emptyLanguageServerCapabilities,
  type LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";
import type { IntelligenceMode } from "../domain/workspace";
import type { WorkbenchWorkspaceGateways } from "../application/useWorkbenchController";
import type { WorkspaceIdentityDescriptor } from "../application/workspaceIdentityGatewayPort";
import {
  flushAsyncTurns,
  setupWorkbenchControllerTestHarness,
  type RenderControllerOptions,
} from "./workbenchControllerTestHarness";

export function trustedDescriptor(workspaceId: string, root: string, admissionToken = 1) {
  return {
    admissionToken,
    workspaceId,
    selectedPath: root,
    canonicalRoot: root,
    caseSensitive: true,
    unicodeNormalizationPolicy: "preserved" as const,
    policy: {
      caseSensitive: true as const,
      unicodeNormalization: "none" as const,
    },
  };
}

export function legacyTrustedDescriptor(
  workspaceId: string,
  root: string,
): WorkspaceIdentityDescriptor {
  return { ...trustedDescriptor(workspaceId, root), admissionToken: undefined };
}

export function registeredIdentityFixture(): WorkbenchWorkspaceGateways["identity"] {
  const descriptorsById = new Map<string, ReturnType<typeof trustedDescriptor>>();
  const descriptorsByPath = new Map<string, ReturnType<typeof trustedDescriptor>>();
  let nextAdmissionToken = 1;
  const descriptorForPath = (path: string) => {
    const existing = descriptorsByPath.get(path);
    if (existing) return existing;
    const workspaceId = path.replace(/^\/+/, "") || "workspace";
    const descriptor = trustedDescriptor(workspaceId, path, nextAdmissionToken);
    nextAdmissionToken += 1;
    descriptorsById.set(workspaceId, descriptor);
    descriptorsByPath.set(path, descriptor);
    return descriptor;
  };
  return {
    getDescriptor: vi.fn(async (workspaceId) => {
      const descriptor = descriptorsById.get(workspaceId);
      if (!descriptor) throw new Error(`Unknown test workspace identity: ${workspaceId}`);
      return {
        ...descriptor,
        canonicalRootPath: descriptor.canonicalRoot,
        selectedRootPath: descriptor.selectedPath,
      };
    }),
    openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
    openPath: vi.fn(async (path) => descriptorForPath(path)),
    unregister: vi.fn(async () => undefined),
  };
}

export function replacementWorkspaceIdentityGateway(
  ...descriptors: WorkspaceIdentityDescriptor[]
): WorkbenchWorkspaceGateways["identity"] {
  let nextDescriptor = 0;
  return {
    getDescriptor: vi.fn(async () => {
      const descriptor = descriptors[descriptors.length - 1]!;
      return {
        ...descriptor,
        canonicalRootPath: descriptor.canonicalRoot,
        selectedRootPath: descriptor.selectedPath,
      };
    }),
    openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
    openPath: vi.fn(
      async () => descriptors[nextDescriptor++] ?? descriptors[descriptors.length - 1]!,
    ),
    unregister: vi.fn(async () => undefined),
  };
}

export function singleRegisteredIdentityFixture(
  descriptor: WorkspaceIdentityDescriptor,
  unregister: (workspaceId: string) => Promise<void> = vi.fn(async () => undefined),
): WorkbenchWorkspaceGateways["identity"] {
  return {
    getDescriptor: vi.fn(async (workspaceId) => {
      if (workspaceId !== descriptor.workspaceId) throw new Error("Unexpected workspace identity");
      return {
        ...descriptor,
        canonicalRootPath: descriptor.canonicalRoot,
        selectedRootPath: descriptor.selectedPath,
      };
    }),
    openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
    openPath: vi.fn(async (path) => {
      if (path !== descriptor.selectedPath) throw new Error(`Unexpected workspace path: ${path}`);
      return descriptor;
    }),
    unregister,
  };
}

export function setupRegisteredWorkbenchControllerTestHarness() {
  const { renderController, ...harness } = setupWorkbenchControllerTestHarness();
  return {
    ...harness,
    renderController: (options: RenderControllerOptions = {}) =>
      renderAdmittedWorkspaceTabs(renderController, options),
  };
}

export function renderAdmittedWorkspaceTabs(
  renderController: ReturnType<typeof setupWorkbenchControllerTestHarness>["renderController"],
  options: RenderControllerOptions,
) {
  const appSettings = options.appSettings ?? defaultAppSettings();
  const paths = [...appSettings.workspaceTabs];
  if (appSettings.recentWorkspacePath && !paths.includes(appSettings.recentWorkspacePath)) {
    paths.push(appSettings.recentWorkspacePath);
  }
  const rendered = renderController({
    workspaceIdentityGateway: registeredIdentityFixture(),
    ...options,
  });
  const admitWorkspaceRoot = async (path: string) => {
    await rendered.getWorkbench().openWorkspaceRoot(path);
    await flushAsyncTurns(24);
  };
  const drainAdmissions = async () => {
    for (const path of paths) {
      await act(async () => admitWorkspaceRoot(path));
    }
    if (!appSettings.recentWorkspacePath) return;
    await act(async () => {
      await rendered.getWorkbench().activateWorkspaceTab(appSettings.recentWorkspacePath ?? "");
      await flushAsyncTurns(24);
    });
  };
  return { ...rendered, admitWorkspaceRoot, drainAdmissions };
}

export function smartModeRequest(
  descriptor: Pick<
    ReturnType<typeof trustedDescriptor>,
    "admissionToken" | "canonicalRoot" | "workspaceId"
  >,
  mode: IntelligenceMode,
): SmartModeSetRequest {
  return {
    admissionToken: descriptor.admissionToken,
    mode,
    rootPath: descriptor.canonicalRoot,
    workspaceId: descriptor.workspaceId,
  };
}

export function indexRequest(
  descriptor: Pick<
    ReturnType<typeof trustedDescriptor>,
    "admissionToken" | "canonicalRoot" | "workspaceId"
  >,
  operationGeneration: number,
): WorkspaceIndexOperationRequest {
  return {
    admissionToken: descriptor.admissionToken,
    operationGeneration,
    rootPath: descriptor.canonicalRoot,
    workspaceId: descriptor.workspaceId,
  };
}

export function workspaceSettingsIdentity(path: string): WorkspaceSettingsIdentity {
  return { canonicalKey: path, legacyRawKeys: [path] };
}

export function workspaceSettingsKey(identity: string | WorkspaceSettingsIdentity) {
  return typeof identity === "string" ? identity : identity.canonicalKey;
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export function createDeferred<T>(): Deferred<T> {
  let resolveValue: ((value: T) => void) | null = null;
  let rejectValue: ((error: unknown) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });
  return {
    promise,
    reject: (error) => rejectValue?.(error),
    resolve: (value) => resolveValue?.(value),
  };
}

export function workspaceAppSettings() {
  return { ...defaultAppSettings(), recentWorkspacePath: "/workspace" };
}

export function readyJavaScriptTypeScriptPlan(rootPath: string): LanguageServerPlan {
  return {
    command: {
      args: ["--stdio"],
      executable: "typescript-language-server",
      workingDirectory: rootPath,
    },
    initializeRequest: { id: 1, jsonrpc: "2.0", method: "initialize", params: {} },
    message: "TypeScript language server is ready.",
    provider: "typeScriptLanguageServer",
    status: "ready",
  };
}

export function runningStatus(rootPath: string, sessionId: number): LanguageServerRuntimeStatus {
  return { capabilities: emptyLanguageServerCapabilities(), kind: "running", rootPath, sessionId };
}

async function flushAfter(delay: number): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  });
  await flushAsyncTurns();
}

export const flushWorkspaceDirectoryRefresh = () => flushAfter(150);
export const flushSearchEverywhereDebounce = () => flushAfter(150);
export const flushFilePrefetch = () => flushAfter(150);
