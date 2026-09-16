import { describe, expect, it, vi } from "vitest";
import { TauriRemoteRunnerGateway } from "./tauriRemoteRunnerGateway";
import { isRemoteRunnerInstructionSnapshot } from "../domain/remoteRunnerInstructions";
import { validateRemoteRunnerValue } from "../domain/remoteRunnerValidation";

const file = { scope: "global", path: "CLAUDE.md", content: "Follow these rules." } as const;
const snapshot = { version: 1, files: [file] } as const;
const id = "12345678-1234-4234-8234-123456789abc";

describe("remote instruction transport", () => {
  it("collects globals without a project, or a specific registered local root", async () => {
    const invoke = vi.fn().mockResolvedValue(snapshot);
    const gateway = new TauriRemoteRunnerGateway(invoke);
    expect(await gateway.collectInstructions({})).toEqual(snapshot);
    expect(await gateway.collectInstructions({ rootPath: "/local/project" })).toEqual(snapshot);
    expect(invoke.mock.calls).toEqual([
      ["remote_runner_collect_instructions", { request: {} }],
      ["remote_runner_collect_instructions", { request: { rootPath: "/local/project" } }],
    ]);
  });
  it("accepts empty snapshots so deletions replace the previous complete set", () => {
    expect(isRemoteRunnerInstructionSnapshot({ version: 1, files: [] })).toBe(true);
  });
  it.each(["createTask", "continueTask", "enqueueMessage"] as const)(
    "accepts snapshots on %s requests without exposing them in responses",
    (operation) => {
      const request = {
        serverId: "linux",
        ...(operation === "createTask" ? { provider: "claude" } : { taskId: id }),
        idempotencyKey: id,
        parts: [{ type: "text", text: "hello" }],
        instructions: snapshot,
      };
      expect(() => validateRemoteRunnerValue(operation, "request", request)).not.toThrow();
      expect(() =>
        validateRemoteRunnerValue(operation, "request", {
          ...request,
          instructions: { ...snapshot, token: "private" },
        }),
      ).toThrow("request");
    },
  );
  it.each([
    "a\u0085.md",
    "dir./CLAUDE.md",
    "dir /CLAUDE.md",
    "package.json",
    ".claude/settings.json",
    "../CLAUDE.md",
    "/CLAUDE.md",
    "foo//CLAUDE.md",
    "foo/./CLAUDE.md",
    "a\\CLAUDE.md",
    "C:CLAUDE.md",
    "a/.GiT/config",
    "a\u0000b",
    "x/".repeat(32) + "CLAUDE.md",
    "x".repeat(513),
  ])("rejects unsafe or excessive paths: %s", (path) => {
    expect(isRemoteRunnerInstructionSnapshot({ ...snapshot, files: [{ ...file, path }] })).toBe(
      false,
    );
  });
  it.each([
    { version: 2, files: [] },
    { version: 1, files: [{ ...file, mode: "overwrite" }] },
    { version: 1, files: [{ ...file, scope: "system" }] },
    { version: 1, files: [{ ...file, content: "bad\0text" }] },
    { version: 1, files: [{ ...file, content: "ž".repeat(32769) }] },
    { version: 1, files: [file, { ...file, path: "claude.md" }] },
    {
      version: 1,
      files: [
        { ...file, path: "é.md" },
        { ...file, path: "e\u0301.md" },
      ],
    },
    { version: 1, files: Array.from({ length: 129 }, (_, i) => ({ ...file, path: `${i}.md` })) },
    {
      version: 1,
      files: Array.from({ length: 9 }, (_, i) => ({
        ...file,
        path: `${i}.md`,
        content: "x".repeat(65536),
      })),
    },
  ])("rejects malformed, duplicate, and unbounded snapshots", async (response) => {
    const gateway = new TauriRemoteRunnerGateway(vi.fn().mockResolvedValue(response));
    await expect(gateway.collectInstructions({})).rejects.toThrow("response");
  });
  it("accepts the same path in separate scopes and exact UTF-8 byte boundaries", () => {
    expect(
      isRemoteRunnerInstructionSnapshot({
        version: 1,
        files: [
          { ...file, content: "ž".repeat(32768) },
          { ...file, scope: "project", path: "RULES.MD" },
        ],
      }),
    ).toBe(true);
  });
  it("accepts boolean instruction capability while rejecting malformed capability", () => {
    const descriptor = {
      protocolVersion: 1,
      runnerId: "runner",
      name: "Runner",
      capabilities: {
        taskExecution: true,
        eventReplay: true,
      },
    };
    for (const instructionSync of [true, false]) {
      expect(() =>
        validateRemoteRunnerValue("getRunner", "response", {
          ...descriptor,
          capabilities: { ...descriptor.capabilities, instructionSync },
        }),
      ).not.toThrow();
    }
    expect(() =>
      validateRemoteRunnerValue("getRunner", "response", {
        ...descriptor,
        capabilities: { ...descriptor.capabilities, instructionSync: "true" },
      }),
    ).toThrow("response");
  });
  it("rejects unknown collector authority before IPC", async () => {
    const invoke = vi.fn();
    const gateway = new TauriRemoteRunnerGateway(invoke);
    await expect(gateway.collectInstructions({ rootPath: "bad\0root" })).rejects.toThrow("request");
    expect(invoke).not.toHaveBeenCalled();
  });
});
