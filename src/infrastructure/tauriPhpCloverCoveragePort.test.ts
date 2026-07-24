import { describe, expect, it, vi } from "vitest";
import type { PhpCloverCoverageRunRequest } from "../application/usePhpCloverCoverage";
import { createWorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import {
  decodePhpCloverCoverageWireResponse,
  MAX_PHP_CLOVER_COVERAGE_IPC_BYTES,
  MAX_PHP_CLOVER_COVERAGE_IPC_MESSAGE_BYTES,
} from "./tauriPhpCloverCoverageIpcContract";
import { TauriPhpCloverCoveragePort } from "./tauriPhpCloverCoveragePort";

const request: PhpCloverCoverageRunRequest = {
  invalidationVersion: 3,
  maxBytes: MAX_PHP_CLOVER_COVERAGE_IPC_BYTES,
  owner: createWorkspaceRuntimeOwner("workspace-id", "/workspace"),
};

describe("TauriPhpCloverCoveragePort", () => {
  it("invokes the exact owner-bound command and returns bounded Clover content", async () => {
    const invoke = vi.fn(async () => ({ status: "ok", content: "<coverage/>" }));
    await expect(new TauriPhpCloverCoveragePort(invoke).runAndReadReport(request)).resolves.toEqual(
      {
        status: "ok",
        content: "<coverage/>",
      },
    );
    expect(invoke).toHaveBeenCalledExactlyOnceWith("run_php_test_coverage_clover", {
      workspaceId: "workspace-id",
      rootPath: "/workspace",
    });
  });

  it.each(["missing", "tooLarge", "unavailable"] as const)(
    "maps %s truthfully into the application port result",
    async (status) => {
      const wire =
        status === "unavailable" ? { status, message: "Xdebug is unavailable." } : { status };
      await expect(
        new TauriPhpCloverCoveragePort(vi.fn(async () => wire)).runAndReadReport(request),
      ).resolves.toEqual(
        status === "unavailable" ? { status, message: "Xdebug is unavailable." } : { status },
      );
    },
  );

  it("throws the exact bounded backend error instead of inventing a port status", async () => {
    const port = new TauriPhpCloverCoveragePort(
      vi.fn(async () => ({ status: "error", message: "PHPUnit failed." })),
    );
    await expect(port.runAndReadReport(request)).rejects.toThrow("PHPUnit failed.");
  });

  it("maps ok content beyond the caller's smaller UTF-8 budget to tooLarge", async () => {
    const port = new TauriPhpCloverCoveragePort(
      vi.fn(async () => ({ status: "ok", content: "ééé" })),
    );
    await expect(port.runAndReadReport({ ...request, maxBytes: 5 })).resolves.toEqual({
      status: "tooLarge",
    });
    await expect(port.runAndReadReport({ ...request, maxBytes: 6 })).resolves.toEqual({
      status: "ok",
      content: "ééé",
    });
  });

  it.each([
    ["zero maxBytes", { ...request, maxBytes: 0 }],
    ["oversized maxBytes", { ...request, maxBytes: MAX_PHP_CLOVER_COVERAGE_IPC_BYTES + 1 }],
    ["fractional maxBytes", { ...request, maxBytes: 2.5 }],
    ["negative invalidation", { ...request, invalidationVersion: -1 }],
    ["dirty owner id", { ...request, owner: { ...request.owner, ownerKey: " workspace" } }],
    ["control owner id", { ...request, owner: { ...request.owner, ownerKey: "bad\0id" } }],
    ["unpaired owner id", { ...request, owner: { ...request.owner, ownerKey: "bad\ud800" } }],
    ["relative root", { ...request, owner: { ...request.owner, executionRoot: "workspace" } }],
    ["unknown request key", { ...request, extra: true }],
    ["unknown owner key", { ...request, owner: { ...request.owner, extra: true } }],
    [
      "request accessor",
      Object.defineProperty({ ...request }, "maxBytes", {
        enumerable: true,
        get: () => MAX_PHP_CLOVER_COVERAGE_IPC_BYTES,
      }),
    ],
    [
      "owner accessor",
      {
        ...request,
        owner: Object.defineProperty({ ...request.owner }, "ownerKey", {
          enumerable: true,
          get: () => "workspace-id",
        }),
      },
    ],
    ["symbol request key", Object.assign({ ...request }, { [Symbol("extra")]: true })],
  ])("rejects %s before IPC", async (_name, unsafe) => {
    const invoke = vi.fn();
    await expect(
      new TauriPhpCloverCoveragePort(invoke).runAndReadReport(
        unsafe as unknown as PhpCloverCoverageRunRequest,
      ),
    ).rejects.toThrow("Invalid PHP Clover coverage request");
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("decodePhpCloverCoverageWireResponse", () => {
  it.each([
    ["non-object", null],
    ["array", []],
    ["unknown status", { status: "done" }],
    ["missing content", { status: "ok" }],
    ["empty content", { status: "ok", content: "" }],
    ["unknown ok field", { status: "ok", content: "<coverage/>", extra: true }],
    ["message on missing", { status: "missing", message: "missing" }],
    ["content on tooLarge", { status: "tooLarge", content: "x" }],
    ["missing unavailable message", { status: "unavailable" }],
    ["control error message", { status: "error", message: "bad\nmessage" }],
    ["unpaired content surrogate", { status: "ok", content: "\ud800" }],
    ["non-plain response", Object.assign(new (class {})(), { status: "missing" })],
    ["inherited status", Object.create({ status: "missing" })],
    [
      "status accessor",
      Object.defineProperty({}, "status", { enumerable: true, get: () => "missing" }),
    ],
    ["symbol response key", { status: "missing", [Symbol("extra")]: true }],
  ])("rejects malformed %s", (_name, wire) => {
    expect(() => decodePhpCloverCoverageWireResponse(wire)).toThrow(
      "Invalid PHP Clover coverage response",
    );
  });

  it("enforces exact UTF-8 byte limits for content and messages", () => {
    const contentAtLimit = "é".repeat(MAX_PHP_CLOVER_COVERAGE_IPC_BYTES / 2);
    expect(decodePhpCloverCoverageWireResponse({ status: "ok", content: contentAtLimit })).toEqual({
      status: "ok",
      content: contentAtLimit,
    });
    expect(() =>
      decodePhpCloverCoverageWireResponse({ status: "ok", content: `${contentAtLimit}x` }),
    ).toThrow(String(MAX_PHP_CLOVER_COVERAGE_IPC_BYTES));

    const messageAtLimit = "é".repeat(MAX_PHP_CLOVER_COVERAGE_IPC_MESSAGE_BYTES / 2);
    expect(
      decodePhpCloverCoverageWireResponse({ status: "error", message: messageAtLimit }),
    ).toEqual({ status: "error", message: messageAtLimit });
    expect(() =>
      decodePhpCloverCoverageWireResponse({ status: "error", message: `${messageAtLimit}x` }),
    ).toThrow(String(MAX_PHP_CLOVER_COVERAGE_IPC_MESSAGE_BYTES));
  });
});
