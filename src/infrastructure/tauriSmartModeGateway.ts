import { invoke } from "@tauri-apps/api/core";
import type { SmartModeGateway, SmartModeSetRequest, SmartModeState } from "../domain/intelligence";

const MAX_ROOT_PATH_UTF8_BYTES = 32_768;
const MAX_STATE_MESSAGE_UTF8_BYTES = 4_096;
const MAX_WORKSPACE_ID_UTF8_BYTES = 1_024;
const utf8Encoder = new TextEncoder();

export class TauriSmartModeGateway implements SmartModeGateway {
  getState(rootPath: string): Promise<SmartModeState> {
    assertBoundedText(rootPath, MAX_ROOT_PATH_UTF8_BYTES, "Smart mode root path");
    return invoke<unknown>("get_smart_mode_state", { rootPath }).then(parseSmartModeState);
  }

  setMode(request: SmartModeSetRequest): Promise<SmartModeState> {
    assertSetRequest(request);
    return invoke<unknown>("set_smart_mode", { request }).then(parseSmartModeState);
  }
}

function parseSmartModeState(value: unknown): SmartModeState {
  if (!isRecord(value) || !hasExactKeys(value, ["message", "mode", "status"])) {
    throw new TypeError("Smart mode returned an invalid state.");
  }
  assertBoundedText(value.message, MAX_STATE_MESSAGE_UTF8_BYTES, "Smart mode message");
  if (value.mode === "basic" && value.status === "off") {
    return { message: value.message, mode: value.mode, status: value.status };
  }
  if ((value.mode === "lightSmart" || value.mode === "fullSmart") && value.status === "ready") {
    return { message: value.message, mode: value.mode, status: value.status };
  }
  throw new TypeError("Smart mode returned an invalid state.");
}

function assertSetRequest(request: SmartModeSetRequest): void {
  if (
    !isRecord(request) ||
    !hasExactKeys(request, ["admissionToken", "mode", "rootPath", "workspaceId"])
  ) {
    throw new TypeError("Smart mode request must use the exact wire contract.");
  }
  if (!Number.isSafeInteger(request.admissionToken) || request.admissionToken <= 0) {
    throw new TypeError("Smart mode admission token is invalid.");
  }
  if (request.mode !== "basic" && request.mode !== "lightSmart" && request.mode !== "fullSmart") {
    throw new TypeError("Smart mode is invalid.");
  }
  assertBoundedText(request.rootPath, MAX_ROOT_PATH_UTF8_BYTES, "Smart mode root path");
  assertBoundedText(request.workspaceId, MAX_WORKSPACE_ID_UTF8_BYTES, "Smart mode workspace id");
}

function assertBoundedText(
  value: unknown,
  maxBytes: number,
  label: string,
): asserts value is string {
  if (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxBytes &&
    !value.includes("\0") &&
    utf8Encoder.encode(value).byteLength <= maxBytes
  ) {
    return;
  }
  throw new TypeError(`${label} is invalid.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}
