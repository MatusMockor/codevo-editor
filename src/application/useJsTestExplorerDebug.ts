import { useCallback, useEffect, useRef, useState } from "react";
import type { DebugLaunchTarget } from "../domain/debug";
import {
  createJsTestDebugTarget,
  jsTestDebugScopeForExplorerNode,
  type JsTestDebugExplorerNode,
} from "../domain/jsTestDebugScope";
import type { WorkspaceTestDiscoveryGateway } from "../domain/jsTestDiscovery";
import { workspaceRelativePath } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  createWorkspaceRuntimeOwner,
  transferWorkspaceRuntimeOwner,
} from "../domain/workspaceRuntimeOwner";
import { detectJsTestRunnerContext } from "./jsTestRunnerDetection";
import { jsTestDebugLaunch } from "./jsTestDebugLaunch";

const MAX_RUNNER_FILE_BYTES = 1_024 * 1_024;
const MAX_VISIBLE_DEBUG_MESSAGE_BYTES = 4_096;

export interface UseJsTestExplorerDebugOptions {
  readonly debugStartBlocked: boolean;
  readonly discoveryGateway: WorkspaceTestDiscoveryGateway;
  readonly isDebugStartBlocked: () => boolean;
  readonly openDebugPanel: () => void;
  readonly rootPath: string | null;
  readonly startDebug: (launch: DebugLaunchTarget) => Promise<void>;
  readonly workspaceId: string | null;
  readonly workspaceTrusted: boolean;
}

export interface UseJsTestExplorerDebugResult {
  readonly blocked: boolean;
  readonly blockedReason: string | null;
  readonly error: string | null;
  readonly isDebugging: boolean;
  readonly unavailable: string | null;
  debug(node: JsTestDebugExplorerNode): Promise<void>;
}

interface DebugRequest {
  readonly id: number;
  readonly rootPath: string;
  readonly workspaceId: string;
}

export function useJsTestExplorerDebug(
  options: UseJsTestExplorerDebugOptions,
): UseJsTestExplorerDebugResult {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const nextRequestIdRef = useRef(0);
  const activeRequestRef = useRef<DebugRequest | null>(null);
  const mountedRef = useRef(true);
  const [isDebugging, setIsDebugging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeRequestRef.current = null;
    };
  }, []);

  useEffect(() => {
    activeRequestRef.current = null;
    setIsDebugging(false);
    setError(null);
    setUnavailable(null);
  }, [options.rootPath, options.workspaceId, options.workspaceTrusted]);

  const debug = useCallback(async (node: JsTestDebugExplorerNode) => {
    const current = optionsRef.current;
    if (activeRequestRef.current) return;
    if (!current.rootPath || !current.workspaceId || !current.workspaceTrusted) return;
    if (current.debugStartBlocked || current.isDebugStartBlocked()) {
      setUnavailable("Stop the active debug session before debugging a selected test.");
      setError(null);
      return;
    }
    const request: DebugRequest = {
      id: ++nextRequestIdRef.current,
      rootPath: current.rootPath,
      workspaceId: current.workspaceId,
    };
    activeRequestRef.current = request;
    setIsDebugging(true);
    setError(null);
    setUnavailable(null);
    try {
      if (workspaceRelativePath(request.rootPath, node.filePath) === null) {
        throw new Error("Selected test file no longer belongs to the active workspace.");
      }
      const scope = jsTestDebugScopeForExplorerNode(request.rootPath, node);
      const runnerContext = await detectJsTestRunnerContext(
        request.rootPath,
        (path) => readRunnerFile(current.discoveryGateway, request.rootPath, path),
        node.filePath,
      );
      if (
        !isCurrentRequest(request, optionsRef.current, activeRequestRef.current, mountedRef.current)
      )
        return;
      if (!runnerContext) {
        setUnavailable("Debug is unavailable because no Jest or Vitest runner was detected.");
        return;
      }
      if (optionsRef.current.isDebugStartBlocked()) {
        setUnavailable("Stop the active debug session before debugging a selected test.");
        return;
      }
      const owner = transferWorkspaceRuntimeOwner(
        createWorkspaceRuntimeOwner(request.workspaceId, request.rootPath),
        runnerContext.rootPath,
      );
      const target = createJsTestDebugTarget(owner, runnerContext.runner, scope);
      const launch = jsTestDebugLaunch(target, request.rootPath);
      if (
        !isCurrentRequest(request, optionsRef.current, activeRequestRef.current, mountedRef.current)
      )
        return;
      optionsRef.current.openDebugPanel();
      await optionsRef.current.startDebug(launch);
    } catch (cause) {
      if (
        isCurrentRequest(request, optionsRef.current, activeRequestRef.current, mountedRef.current)
      ) {
        setError(boundedMessage(cause));
      }
    } finally {
      if (mountedRef.current && activeRequestRef.current?.id === request.id) {
        activeRequestRef.current = null;
        setIsDebugging(false);
      }
    }
  }, []);

  const blockedReason = debugBlockedReason(options);
  return {
    blocked: blockedReason !== null,
    blockedReason,
    debug,
    error,
    isDebugging,
    unavailable,
  };
}

async function readRunnerFile(
  gateway: WorkspaceTestDiscoveryGateway,
  rootPath: string,
  path: string,
): Promise<string | null> {
  const relativePath = workspaceRelativePath(rootPath, path);
  if (relativePath === null) return null;
  try {
    const result = await gateway.readTextFileBounded(rootPath, relativePath, MAX_RUNNER_FILE_BYTES);
    return result.status === "ok" ? result.content : null;
  } catch {
    return null;
  }
}

function isCurrentRequest(
  request: DebugRequest,
  options: UseJsTestExplorerDebugOptions,
  active: DebugRequest | null,
  mounted: boolean,
): boolean {
  return (
    mounted &&
    active?.id === request.id &&
    options.workspaceTrusted &&
    options.workspaceId === request.workspaceId &&
    workspaceRootKeysEqual(options.rootPath, request.rootPath)
  );
}

function debugBlockedReason(options: UseJsTestExplorerDebugOptions): string | null {
  if (!options.rootPath) return "Open a workspace to debug a selected test.";
  if (!options.workspaceId) return "Reload the workspace before debugging a selected test.";
  if (!options.workspaceTrusted) return "Trust this workspace to debug selected tests.";
  if (options.debugStartBlocked) {
    return "Stop the active debug session before debugging a selected test.";
  }
  return null;
}

function boundedMessage(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  const message = raw.trim() || "Selected test debugging failed.";
  const encoder = new TextEncoder();
  const bytes = encoder.encode(message);
  if (bytes.byteLength <= MAX_VISIBLE_DEBUG_MESSAGE_BYTES) return message;
  const ellipsis = encoder.encode("…");
  let end = MAX_VISIBLE_DEBUG_MESSAGE_BYTES - ellipsis.byteLength;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  while (end > 0) {
    try {
      return `${decoder.decode(bytes.subarray(0, end))}…`;
    } catch {
      end -= 1;
    }
  }
  return "…";
}
