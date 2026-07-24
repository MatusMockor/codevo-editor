import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  PHP_CLOVER_COVERAGE_LIMITS,
  parsePhpCloverCoverage,
  type PhpCloverCoverageReport,
} from "../domain/phpCloverCoverage";
import { createConservativeWorkspaceRootFromPath } from "../domain/workspacePath";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";

export const MAX_PHP_CLOVER_REPORT_BYTES = PHP_CLOVER_COVERAGE_LIMITS.maxInputBytes;

export type PhpCloverCoveragePortResult =
  | { readonly status: "ok"; readonly content: string }
  | { readonly status: "missing" }
  | { readonly status: "tooLarge" }
  | { readonly status: "unavailable"; readonly message?: string };

export interface PhpCloverCoverageRunRequest {
  readonly invalidationVersion: number;
  readonly maxBytes: number;
  readonly owner: WorkspaceRuntimeOwner;
}

/**
 * Narrow future backend boundary. Implementations must run real PHP coverage and return the
 * produced Clover text atomically within `maxBytes`; ordinary PHPUnit/JUnit output is insufficient.
 */
export interface PhpCloverCoveragePort {
  runAndReadReport(request: PhpCloverCoverageRunRequest): Promise<PhpCloverCoveragePortResult>;
}

export interface UsePhpCloverCoverageOptions {
  readonly invalidationVersion: number;
  readonly isWorkspaceCurrent: (owner: WorkspaceRuntimeOwner) => boolean;
  readonly port: PhpCloverCoveragePort;
  readonly workspaceOwner: WorkspaceRuntimeOwner | null;
  readonly workspaceTrusted: boolean;
}

export interface PhpCloverCoverageState {
  readonly error: string | null;
  readonly isRunning: boolean;
  readonly report: PhpCloverCoverageReport | null;
  readonly unavailable: string | null;
  canRun(): boolean;
  clear(): void;
  run(): Promise<boolean>;
}

interface CoverageState {
  readonly error: string | null;
  readonly invalidationVersion: number;
  readonly report: PhpCloverCoverageReport | null;
  readonly unavailable: string | null;
}

interface Boundary {
  readonly activationEpoch: number;
  readonly invalidationVersion: number;
  readonly owner: WorkspaceRuntimeOwner;
  readonly port: PhpCloverCoveragePort;
  readonly workspaceKey: string;
}

interface ActiveRequest {
  readonly boundary: Boundary;
  readonly clearGeneration: number;
}

const TRUST_MESSAGE = "Trust this workspace to run PHP test coverage.";
const UNAVAILABLE_MESSAGE = "PHP Clover coverage is unavailable.";
const MISSING_MESSAGE = "PHP Clover coverage did not produce a report.";
const TOO_LARGE_MESSAGE = `PHP Clover coverage report exceeded ${MAX_PHP_CLOVER_REPORT_BYTES} bytes.`;

/** Owner-safe, runner-neutral application lifecycle for a real Clover coverage port. */
export function usePhpCloverCoverage(options: UsePhpCloverCoverageOptions): PhpCloverCoverageState {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const mountedRef = useRef(true);
  const activeRef = useRef<ActiveRequest | null>(null);
  const clearGenerationRef = useRef(0);
  const activationRef = useRef({
    epoch: 0,
    invalidationVersion: -1,
    ownerKey: "",
    port: null as PhpCloverCoveragePort | null,
    root: "",
    trusted: false,
  });
  updateActivationFence(activationRef.current, options);
  const [states, setStates] = useState<Record<string, CoverageState>>({});

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const canRun = useCallback((): boolean => {
    if (activeRef.current) return false;
    return exactBoundary(optionsRef.current, activationRef.current.epoch) !== null;
  }, []);

  const run = useCallback(async (): Promise<boolean> => {
    if (activeRef.current) return false;
    const boundary = exactBoundary(optionsRef.current, activationRef.current.epoch);
    if (!boundary) return false;
    const request: ActiveRequest = {
      boundary,
      clearGeneration: clearGenerationRef.current,
    };
    activeRef.current = request;

    try {
      if (
        !requestIsCurrent(
          request,
          optionsRef.current,
          activeRef.current,
          mountedRef.current,
          activationRef.current.epoch,
          clearGenerationRef.current,
        )
      ) {
        return false;
      }
      setStates((current) => ({
        ...current,
        [boundary.workspaceKey]: {
          error: null,
          invalidationVersion: boundary.invalidationVersion,
          report: current[boundary.workspaceKey]?.report ?? null,
          unavailable: null,
        },
      }));
      const result = await boundary.port.runAndReadReport(
        Object.freeze({
          invalidationVersion: boundary.invalidationVersion,
          maxBytes: MAX_PHP_CLOVER_REPORT_BYTES,
          owner: boundary.owner,
        }),
      );
      if (
        !requestIsCurrent(
          request,
          optionsRef.current,
          activeRef.current,
          mountedRef.current,
          activationRef.current.epoch,
          clearGenerationRef.current,
        )
      ) {
        return false;
      }
      if (result?.status !== "ok") {
        publishFailure(
          request,
          failureForResult(result),
          setStates,
          result?.status === "unavailable",
        );
        return false;
      }
      if (utf8ByteLength(result.content) > MAX_PHP_CLOVER_REPORT_BYTES) {
        publishFailure(request, TOO_LARGE_MESSAGE, setStates);
        return false;
      }

      let report: PhpCloverCoverageReport;
      try {
        report = parsePhpCloverCoverage(result.content, boundary.owner.executionRoot, {
          maxInputBytes: MAX_PHP_CLOVER_REPORT_BYTES,
        });
      } catch {
        publishFailure(request, "PHP Clover coverage report is invalid.", setStates);
        return false;
      }
      if (
        !requestIsCurrent(
          request,
          optionsRef.current,
          activeRef.current,
          mountedRef.current,
          activationRef.current.epoch,
          clearGenerationRef.current,
        )
      ) {
        return false;
      }
      setStates((current) => ({
        ...current,
        [boundary.workspaceKey]: {
          error: null,
          invalidationVersion: boundary.invalidationVersion,
          report,
          unavailable: null,
        },
      }));
      return true;
    } catch {
      if (
        requestIsCurrent(
          request,
          optionsRef.current,
          activeRef.current,
          mountedRef.current,
          activationRef.current.epoch,
          clearGenerationRef.current,
        )
      ) {
        publishFailure(request, "PHP Clover coverage failed.", setStates);
      }
      return false;
    } finally {
      if (activeRef.current === request) activeRef.current = null;
      if (mountedRef.current) setStates((current) => ({ ...current }));
    }
  }, []);

  const clear = useCallback(() => {
    clearGenerationRef.current += 1;
    const workspaceKey = workspaceKeyForOwner(optionsRef.current.workspaceOwner);
    if (!workspaceKey) return;
    setStates((current) => {
      if (!(workspaceKey in current)) return current;
      const next = { ...current };
      delete next[workspaceKey];
      return next;
    });
  }, []);

  const boundary = exactBoundary(options, activationRef.current.epoch);
  const state = boundary ? states[boundary.workspaceKey] : null;
  const stateIsCurrent = state?.invalidationVersion === options.invalidationVersion;
  return {
    canRun,
    clear,
    error: stateIsCurrent ? (state?.error ?? null) : null,
    isRunning: activeRef.current?.boundary.workspaceKey === boundary?.workspaceKey,
    report: stateIsCurrent ? (state?.report ?? null) : null,
    run,
    unavailable: !options.workspaceTrusted
      ? TRUST_MESSAGE
      : stateIsCurrent
        ? (state?.unavailable ?? null)
        : null,
  };
}

function updateActivationFence(
  fence: {
    epoch: number;
    invalidationVersion: number;
    ownerKey: string;
    port: PhpCloverCoveragePort | null;
    root: string;
    trusted: boolean;
  },
  options: UsePhpCloverCoverageOptions,
): void {
  const ownerKey = String(options.workspaceOwner?.ownerKey ?? "");
  const root = options.workspaceOwner?.executionRoot ?? "";
  if (
    fence.invalidationVersion === options.invalidationVersion &&
    fence.ownerKey === ownerKey &&
    fence.port === options.port &&
    fence.root === root &&
    fence.trusted === options.workspaceTrusted
  ) {
    return;
  }
  fence.epoch += 1;
  fence.invalidationVersion = options.invalidationVersion;
  fence.ownerKey = ownerKey;
  fence.port = options.port;
  fence.root = root;
  fence.trusted = options.workspaceTrusted;
}

function exactBoundary(
  options: UsePhpCloverCoverageOptions,
  activationEpoch: number,
): Boundary | null {
  const first = readBoundary(options, activationEpoch);
  const second = readBoundary(options, activationEpoch);
  return first && second && boundariesEqual(first, second) ? first : null;
}

function readBoundary(
  options: UsePhpCloverCoverageOptions,
  activationEpoch: number,
): Boundary | null {
  const owner = options.workspaceOwner;
  if (
    !owner ||
    typeof owner.ownerKey !== "string" ||
    !owner.ownerKey.trim() ||
    typeof owner.executionRoot !== "string" ||
    !validPort(options.port) ||
    !options.workspaceTrusted ||
    !Number.isSafeInteger(options.invalidationVersion) ||
    options.invalidationVersion < 0 ||
    !createConservativeWorkspaceRootFromPath(owner.executionRoot).ok ||
    !safeWorkspaceCurrent(options, owner)
  ) {
    return null;
  }
  return Object.freeze({
    activationEpoch,
    invalidationVersion: options.invalidationVersion,
    owner,
    port: options.port,
    workspaceKey: `${String(owner.ownerKey)}\0${owner.executionRoot}`,
  });
}

function requestIsCurrent(
  request: ActiveRequest,
  options: UsePhpCloverCoverageOptions,
  active: ActiveRequest | null,
  mounted: boolean,
  activationEpoch: number,
  clearGeneration: number,
): boolean {
  if (!mounted || active !== request || request.clearGeneration !== clearGeneration) {
    return false;
  }
  const boundary = exactBoundary(options, activationEpoch);
  return boundary !== null && boundariesEqual(request.boundary, boundary);
}

function boundariesEqual(left: Boundary, right: Boundary): boolean {
  return (
    left.activationEpoch === right.activationEpoch &&
    left.invalidationVersion === right.invalidationVersion &&
    left.owner.ownerKey === right.owner.ownerKey &&
    left.owner.executionRoot === right.owner.executionRoot &&
    left.port === right.port &&
    left.workspaceKey === right.workspaceKey
  );
}

function safeWorkspaceCurrent(
  options: UsePhpCloverCoverageOptions,
  owner: WorkspaceRuntimeOwner,
): boolean {
  try {
    return options.isWorkspaceCurrent(owner) === true;
  } catch {
    return false;
  }
}

function failureForResult(result: PhpCloverCoveragePortResult | null | undefined): string {
  if (result?.status === "tooLarge") return TOO_LARGE_MESSAGE;
  if (result?.status === "missing") return MISSING_MESSAGE;
  if (result?.status === "unavailable" && safeUnavailableMessage(result.message)) {
    return result.message;
  }
  return UNAVAILABLE_MESSAGE;
}

function safeUnavailableMessage(message: unknown): message is string {
  return (
    typeof message === "string" &&
    message.length > 0 &&
    message.length <= 2_048 &&
    message === message.trim() &&
    !/[\x00-\x1f\x7f]/.test(message)
  );
}

function workspaceKeyForOwner(owner: WorkspaceRuntimeOwner | null): string | null {
  if (
    !owner ||
    typeof owner.ownerKey !== "string" ||
    !owner.ownerKey.trim() ||
    typeof owner.executionRoot !== "string" ||
    !createConservativeWorkspaceRootFromPath(owner.executionRoot).ok
  ) {
    return null;
  }
  return `${String(owner.ownerKey)}\0${owner.executionRoot}`;
}

function validPort(port: PhpCloverCoveragePort): boolean {
  return port !== null && typeof port === "object" && typeof port.runAndReadReport === "function";
}

function publishFailure(
  request: ActiveRequest,
  message: string,
  setStates: Dispatch<SetStateAction<Record<string, CoverageState>>>,
  unavailable = message === UNAVAILABLE_MESSAGE,
): void {
  setStates((current) => ({
    ...current,
    [request.boundary.workspaceKey]: {
      error: unavailable ? null : message,
      invalidationVersion: request.boundary.invalidationVersion,
      report: null,
      unavailable: unavailable ? message : null,
    },
  }));
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
