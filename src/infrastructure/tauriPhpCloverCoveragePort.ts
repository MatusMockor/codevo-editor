import { invoke } from "@tauri-apps/api/core";
import type {
  PhpCloverCoveragePort,
  PhpCloverCoveragePortResult,
  PhpCloverCoverageRunRequest,
} from "../application/usePhpCloverCoverage";
import { createConservativeWorkspaceRootFromPath } from "../domain/workspacePath";
import {
  decodePhpCloverCoverageWireResponse,
  MAX_PHP_CLOVER_COVERAGE_IPC_BYTES,
  PHP_CLOVER_COVERAGE_IPC_COMMAND,
} from "./tauriPhpCloverCoverageIpcContract";

type InvokeCommand = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

const invokeCommand: InvokeCommand = (command, args) => invoke(command, args);
const MAX_OWNER_KEY_BYTES = 4 * 1024;
const MAX_ROOT_PATH_BYTES = 16 * 1024;

export class TauriPhpCloverCoveragePort implements PhpCloverCoveragePort {
  constructor(private readonly invokeCoverageCommand: InvokeCommand = invokeCommand) {}

  async runAndReadReport(
    request: PhpCloverCoverageRunRequest,
  ): Promise<PhpCloverCoveragePortResult> {
    const { owner } = validateRequest(request);
    const response = decodePhpCloverCoverageWireResponse(
      await this.invokeCoverageCommand(PHP_CLOVER_COVERAGE_IPC_COMMAND, {
        workspaceId: owner.ownerKey,
        rootPath: owner.executionRoot,
      }),
    );
    if (response.status === "error") throw new Error(response.message);
    if (response.status === "unavailable") {
      return { status: "unavailable", message: response.message };
    }
    if (response.status === "ok") {
      if (new TextEncoder().encode(response.content).byteLength > request.maxBytes) {
        return { status: "tooLarge" };
      }
      return { status: "ok", content: response.content };
    }
    return { status: response.status };
  }
}

function validateRequest(request: PhpCloverCoverageRunRequest): PhpCloverCoverageRunRequest {
  const value = record(request, "request");
  exactKeys(value, ["invalidationVersion", "maxBytes", "owner"], "request");
  if (!Number.isSafeInteger(request.invalidationVersion) || request.invalidationVersion < 0) {
    invalid("request.invalidationVersion", "a non-negative safe integer");
  }
  if (
    !Number.isSafeInteger(request.maxBytes) ||
    request.maxBytes <= 0 ||
    request.maxBytes > MAX_PHP_CLOVER_COVERAGE_IPC_BYTES
  ) {
    invalid(
      "request.maxBytes",
      `a positive safe integer no greater than ${MAX_PHP_CLOVER_COVERAGE_IPC_BYTES}`,
    );
  }
  const owner = record(request.owner, "request.owner");
  exactKeys(owner, ["ownerKey", "executionRoot"], "request.owner");
  boundedOwnerKey(request.owner.ownerKey);
  if (
    typeof request.owner.executionRoot !== "string" ||
    !hasOnlyUnicodeScalars(request.owner.executionRoot) ||
    new TextEncoder().encode(request.owner.executionRoot).byteLength > MAX_ROOT_PATH_BYTES
  ) {
    invalid(
      "request.owner.executionRoot",
      `an absolute workspace root of at most ${MAX_ROOT_PATH_BYTES} UTF-8 bytes`,
    );
  }
  const root = createConservativeWorkspaceRootFromPath(request.owner.executionRoot);
  if (!root.ok) invalid("request.owner.executionRoot", "a clean absolute workspace root");
  return request;
}

function boundedOwnerKey(value: unknown): void {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    !hasOnlyUnicodeScalars(value) ||
    /[\x00-\x1f\x7f]/.test(value) ||
    new TextEncoder().encode(value).byteLength > MAX_OWNER_KEY_BYTES
  ) {
    invalid(
      "request.owner.ownerKey",
      `a clean non-empty string of at most ${MAX_OWNER_KEY_BYTES} UTF-8 bytes`,
    );
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(path, "an object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid(path, "a plain object");
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      return invalid(path, "a plain data object with string keys");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      return invalid(`${path}.${key}`, "a data property");
    }
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const unexpected = Object.keys(value).find((key) => !expected.includes(key));
  if (unexpected) invalid(`${path}.${unexpected}`, "no unknown field");
  const missing = expected.find((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing) invalid(`${path}.${missing}`, "a required field");
}

function hasOnlyUnicodeScalars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0xd800 || code > 0xdfff) continue;
    if (code > 0xdbff || index + 1 >= value.length) return false;
    const low = value.charCodeAt(++index);
    if (low < 0xdc00 || low > 0xdfff) return false;
  }
  return true;
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(`Invalid PHP Clover coverage request at ${path}: expected ${expectation}.`);
}
