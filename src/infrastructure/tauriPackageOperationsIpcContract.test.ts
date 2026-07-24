import { describe, expect, it, vi } from "vitest";
import {
  decodePackageOperationsIpcResult,
  invokePackageOperationsIpc,
  PACKAGE_OPERATIONS_IPC_COMMANDS,
  validatePackageOperationRequest,
} from "./tauriPackageOperationsIpcContract";

const request = {
  workspaceId: "workspace-1",
  operation: "install" as const,
  packageName: "@types/node",
  development: true,
};

describe("package operations Tauri IPC contract", () => {
  it("validates and forwards a preview request without widening the wire shape", async () => {
    const invoke = vi.fn(async () => ({
      manager: "pnpm",
      arguments: ["add", "--save-dev", "@types/node"],
      description: "Install @types/node with pnpm.",
      mutatesManifest: true,
    }));

    await expect(
      invokePackageOperationsIpc(invoke, PACKAGE_OPERATIONS_IPC_COMMANDS.preview, request),
    ).resolves.toEqual({
      manager: "pnpm",
      arguments: ["add", "--save-dev", "@types/node"],
      description: "Install @types/node with pnpm.",
      mutatesManifest: true,
    });
    expect(invoke).toHaveBeenCalledWith("preview_workspace_package_operation", request);
  });

  it("decodes all tagged run responses", () => {
    expect(
      decodePackageOperationsIpcResult(PACKAGE_OPERATIONS_IPC_COMMANDS.run, {
        status: "ok",
        message: "Installed.",
        manifestChanged: true,
      }),
    ).toEqual({ status: "ok", message: "Installed.", manifestChanged: true });
    expect(
      decodePackageOperationsIpcResult(PACKAGE_OPERATIONS_IPC_COMMANDS.run, {
        status: "unavailable",
        message: "pnpm is unavailable",
      }),
    ).toEqual({ status: "unavailable", message: "pnpm is unavailable" });
    expect(
      decodePackageOperationsIpcResult(PACKAGE_OPERATIONS_IPC_COMMANDS.run, {
        status: "error",
        message: "Command failed",
      }),
    ).toEqual({ status: "error", message: "Command failed" });
  });

  it.each(["install", "update", "remove", "outdated"] as const)(
    "accepts the %s operation",
    (operation) => {
      const packageName = operation === "outdated" ? {} : { packageName: "react" };
      expect(
        validatePackageOperationRequest({ workspaceId: "w", operation, ...packageName }),
      ).toEqual({
        workspaceId: "w",
        operation,
        ...packageName,
      });
    },
  );

  it.each([
    [{ workspaceId: "", operation: "install" }, "workspaceId"],
    [{ workspaceId: "w", operation: "publish" }, "operation"],
    [{ workspaceId: "w", operation: "install", packageName: "React" }, "packageName"],
    [{ workspaceId: "w", operation: "install", packageName: "../react" }, "packageName"],
    [{ workspaceId: "w", operation: "install", packageName: "@scope" }, "packageName"],
    [{ workspaceId: "w", operation: "install", development: "yes" }, "development"],
    [{ workspaceId: "w", operation: "install" }, "packageName"],
    [{ workspaceId: "w", operation: "update" }, "packageName"],
    [{ workspaceId: "w", operation: "remove" }, "packageName"],
    [{ workspaceId: "w", operation: "outdated", packageName: "react" }, "packageName"],
    [
      { workspaceId: "w", operation: "update", packageName: "react", development: false },
      "development",
    ],
    [
      { workspaceId: "w", operation: "remove", packageName: "react", development: true },
      "development",
    ],
    [{ workspaceId: "w", operation: "outdated", development: false }, "development"],
    [{ workspaceId: "w", operation: "install", unexpected: true }, "unexpected"],
  ])("rejects an invalid outbound request at %s", (candidate, field) => {
    expect(() => validatePackageOperationRequest(candidate)).toThrow(field as string);
  });

  it("rejects oversized outbound strings before invoking Tauri", async () => {
    const invoke = vi.fn();
    await expect(
      invokePackageOperationsIpc(invoke, PACKAGE_OPERATIONS_IPC_COMMANDS.run, {
        workspaceId: "w".repeat(1_025),
        operation: "outdated",
      }),
    ).rejects.toThrow("workspaceId");
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    [{ manager: "npm", arguments: [], description: "Preview", mutatesManifest: false, extra: 1 }],
    [{ manager: "cargo", arguments: [], description: "Preview", mutatesManifest: false }],
    [{ manager: "npm", arguments: "outdated", description: "Preview", mutatesManifest: false }],
    [
      {
        manager: "npm",
        arguments: Array.from({ length: 65 }, () => "arg"),
        description: "Preview",
        mutatesManifest: false,
      },
    ],
    [
      {
        manager: "npm",
        arguments: ["x".repeat(2_049)],
        description: "Preview",
        mutatesManifest: false,
      },
    ],
    [{ manager: "npm", arguments: [], description: "Preview", mutatesManifest: "no" }],
  ])("rejects malformed or unbounded preview payloads", (candidate) => {
    expect(() =>
      decodePackageOperationsIpcResult(PACKAGE_OPERATIONS_IPC_COMMANDS.preview, candidate),
    ).toThrow("Invalid package operations IPC value");
  });

  it.each([
    [{ status: "success", message: "ok" }],
    [{ status: "ok", message: "ok" }],
    [{ status: "ok", message: "ok", manifestChanged: "yes" }],
    [{ status: "error", message: "bad", manifestChanged: false }],
    [{ status: "unavailable", message: "x".repeat(65_537) }],
    [{ status: "error", message: "💥".repeat(16_385) }],
  ])("rejects malformed or unbounded run payloads", (candidate) => {
    expect(() =>
      decodePackageOperationsIpcResult(PACKAGE_OPERATIONS_IPC_COMMANDS.run, candidate),
    ).toThrow("Invalid package operations IPC value");
  });
});
