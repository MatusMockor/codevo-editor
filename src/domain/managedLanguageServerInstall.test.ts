import { describe, expect, it } from "vitest";
import {
  MAX_MANAGED_LANGUAGE_SERVER_INSTALL_ERROR_UTF8_BYTES,
  MAX_MANAGED_LANGUAGE_SERVER_INSTALL_ROOT_PATH_UTF8_BYTES,
  MAX_MANAGED_LANGUAGE_SERVER_INSTALL_WORKSPACE_ID_UTF8_BYTES,
  parseManagedLanguageServerInstallCompletionEvent,
  parseManagedLanguageServerInstallRequest,
} from "./managedLanguageServerInstall";

const request = {
  admissionToken: 7,
  rootPath: "/workspace/project",
  workspaceId: "workspace-1",
};

describe("managed language server install contract", () => {
  it("round trips an exact request into a fresh closed value", () => {
    const parsed = parseManagedLanguageServerInstallRequest(request);

    expect(parsed).toEqual(request);
    expect(parsed).not.toBe(request);
  });

  it("round trips exact success and failure events", () => {
    expect(parseManagedLanguageServerInstallCompletionEvent({ ...request, error: null })).toEqual({
      ...request,
      error: null,
    });
    expect(
      parseManagedLanguageServerInstallCompletionEvent({ ...request, error: "Install failed" }),
    ).toEqual({ ...request, error: "Install failed" });
  });

  it.each([
    null,
    [],
    { admissionToken: 7, rootPath: "/workspace/project" },
    { ...request, extra: true },
    { ...request, admissionToken: 0 },
    { ...request, admissionToken: -1 },
    { ...request, admissionToken: 1.5 },
    { ...request, admissionToken: Number.MAX_SAFE_INTEGER + 1 },
    { ...request, rootPath: "" },
    { ...request, rootPath: "relative/project" },
    { ...request, rootPath: " /workspace/project" },
    { ...request, rootPath: "/workspace\0project" },
    { ...request, workspaceId: "" },
    { ...request, workspaceId: "workspace\n1" },
  ])("rejects a malformed request %#", (value) => {
    expect(() => parseManagedLanguageServerInstallRequest(value)).toThrow(TypeError);
  });

  it("measures request strings by UTF-8 bytes", () => {
    expect(() =>
      parseManagedLanguageServerInstallRequest({
        ...request,
        rootPath: "é".repeat(MAX_MANAGED_LANGUAGE_SERVER_INSTALL_ROOT_PATH_UTF8_BYTES / 2 + 1),
      }),
    ).toThrow(TypeError);
    expect(() =>
      parseManagedLanguageServerInstallRequest({
        ...request,
        workspaceId: "é".repeat(
          MAX_MANAGED_LANGUAGE_SERVER_INSTALL_WORKSPACE_ID_UTF8_BYTES / 2 + 1,
        ),
      }),
    ).toThrow(TypeError);
  });

  it.each([
    { ...request },
    { ...request, error: null, extra: true },
    { ...request, error: undefined },
    { ...request, error: "" },
    { ...request, error: " Install failed" },
    { ...request, error: "Install\nfailed" },
    { ...request, error: 1 },
  ])("rejects a malformed completion event %#", (value) => {
    expect(() => parseManagedLanguageServerInstallCompletionEvent(value)).toThrow(TypeError);
  });

  it("rejects an oversized UTF-8 failure", () => {
    expect(() =>
      parseManagedLanguageServerInstallCompletionEvent({
        ...request,
        error: "é".repeat(MAX_MANAGED_LANGUAGE_SERVER_INSTALL_ERROR_UTF8_BYTES / 2 + 1),
      }),
    ).toThrow(TypeError);
  });
});
