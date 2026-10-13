import { describe, expect, it, vi } from "vitest";
import { MAX_AGENT_OUTSIDE_LINKED_FILE_BYTES } from "../domain/agentMarkdown/agentLocalFileLinkFailure";
import {
  AGENT_LINKED_FILE_RUNTIME_UNAVAILABLE,
  MAX_AGENT_LINKED_FILE_PATH_BYTES,
  READ_AGENT_LINKED_TEXT_FILE_IPC_COMMAND,
  TauriAgentLinkedFileGateway,
  invokeReadAgentLinkedTextFileIpc,
  type InvokeAgentLinkedFileCommand,
} from "./tauriAgentLinkedFileGateway";

const PATH = "/Users/me/handoffs/02-cms-slideshow.md";
const FILE = { kind: "file", canonicalPath: `/private${PATH}`, content: "# Odovzdávka\n" };

function responding(value: unknown) {
  return vi.fn<InvokeAgentLinkedFileCommand>(async () => value);
}

describe("read_agent_linked_text_file wire contract", () => {
  it("pins the Rust command name and the limits both sides enforce", () => {
    expect(READ_AGENT_LINKED_TEXT_FILE_IPC_COMMAND).toBe("read_agent_linked_text_file");
    expect(MAX_AGENT_LINKED_FILE_PATH_BYTES).toBe(4096);
    expect(MAX_AGENT_OUTSIDE_LINKED_FILE_BYTES).toBe(10 * 1024 * 1024);
  });

  it("sends exactly the path and returns the resolved file with its text", async () => {
    const invokeCommand = responding(FILE);

    await expect(invokeReadAgentLinkedTextFileIpc(invokeCommand, PATH)).resolves.toEqual(FILE);

    expect(invokeCommand.mock.calls).toEqual([
      ["read_agent_linked_text_file", { request: { path: PATH } }],
    ]);
  });

  it("accepts an empty file and text of exactly the size limit", async () => {
    const empty = { ...FILE, content: "" };
    const largest = { ...FILE, content: "a".repeat(MAX_AGENT_OUTSIDE_LINKED_FILE_BYTES) };

    await expect(invokeReadAgentLinkedTextFileIpc(responding(empty), PATH)).resolves.toEqual(empty);
    const read = await invokeReadAgentLinkedTextFileIpc(responding(largest), PATH);
    expect(read.kind === "file" && read.content.length).toBe(MAX_AGENT_OUTSIDE_LINKED_FILE_BYTES);
  });

  it("bounds the text by its UTF-8 bytes, not by its character count", async () => {
    const perCharacter = 3;
    const fitting = "中".repeat(MAX_AGENT_OUTSIDE_LINKED_FILE_BYTES / perCharacter - 1);
    const oversized = `${fitting}中中`;
    expect(oversized.length).toBeLessThan(MAX_AGENT_OUTSIDE_LINKED_FILE_BYTES);

    const read = await invokeReadAgentLinkedTextFileIpc(
      responding({ ...FILE, content: fitting }),
      PATH,
    );
    expect(read.kind === "file" && read.content.length).toBe(fitting.length);
    await expect(
      invokeReadAgentLinkedTextFileIpc(responding({ ...FILE, content: oversized }), PATH),
    ).rejects.toThrow("Invalid agent linked file value at result.content");
  });

  it.each([
    "doesNotExist",
    "folder",
    "specialFile",
    "tooLarge",
    "notText",
    "notLocal",
    "unreadable",
    "unavailable",
    "busy",
  ] as const)("accepts the closed refusal %s", async (kind) => {
    await expect(invokeReadAgentLinkedTextFileIpc(responding({ kind }), PATH)).resolves.toEqual({
      kind,
    });
  });

  it.each([
    ["an empty path", ""],
    ["a relative path", "handoffs/a.md"],
    ["a home-relative path", "~/handoffs/a.md"],
    ["a NUL byte", "/Users/me/a\u0000.md"],
    ["a line break", "/Users/me/a\n.md"],
    ["an over-long path", `/${"a".repeat(MAX_AGENT_LINKED_FILE_PATH_BYTES)}`],
    ["an over-long multi-byte path", `/${"ž".repeat(MAX_AGENT_LINKED_FILE_PATH_BYTES / 2)}`],
  ])("rejects %s before invoking the backend", async (_label, path) => {
    const invokeCommand = responding({ kind: "doesNotExist" });

    await expect(invokeReadAgentLinkedTextFileIpc(invokeCommand, path)).rejects.toThrow(
      "Invalid agent linked file value at request.path",
    );

    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("accepts a path of exactly the limit", async () => {
    const path = `/${"a".repeat(MAX_AGENT_LINKED_FILE_PATH_BYTES - 1)}`;

    await expect(
      invokeReadAgentLinkedTextFileIpc(responding({ kind: "doesNotExist" }), path),
    ).resolves.toEqual({ kind: "doesNotExist" });
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["a string", "file"],
    ["an array", [{ kind: "folder" }]],
    ["an unknown kind", { kind: "symlink" }],
    ["a missing kind", { canonicalPath: PATH, content: "" }],
    ["a file without its path", { kind: "file", content: "" }],
    ["a file without its text", { kind: "file", canonicalPath: PATH }],
    ["a file with a relative path", { ...FILE, canonicalPath: "a.md" }],
    ["a file with a control character", { ...FILE, canonicalPath: "/a\u0007.md" }],
    ["a file with bytes instead of text", { ...FILE, content: [35, 32] }],
    [
      "a file over the size limit",
      { ...FILE, content: "a".repeat(MAX_AGENT_OUTSIDE_LINKED_FILE_BYTES + 1) },
    ],
    ["a file with an unknown field", { ...FILE, executable: true }],
    ["a refusal with an unknown field", { kind: "folder", canonicalPath: PATH }],
  ])("rejects a response that is %s", async (_label, value) => {
    await expect(invokeReadAgentLinkedTextFileIpc(responding(value), PATH)).rejects.toThrow(
      "Invalid agent linked file value at result",
    );
  });
});

describe("TauriAgentLinkedFileGateway", () => {
  it("reads through the native command when the runtime is available", async () => {
    const invokeCommand = responding({ kind: "folder" });
    const gateway = new TauriAgentLinkedFileGateway(invokeCommand, () => true);

    await expect(gateway.readOutsideTextFile(PATH)).resolves.toEqual({ kind: "folder" });

    expect(invokeCommand).toHaveBeenCalledExactlyOnceWith("read_agent_linked_text_file", {
      request: { path: PATH },
    });
  });

  it("fails closed without the native runtime", async () => {
    const invokeCommand = responding(FILE);
    const gateway = new TauriAgentLinkedFileGateway(invokeCommand, () => false);

    await expect(gateway.readOutsideTextFile(PATH)).rejects.toThrow(
      AGENT_LINKED_FILE_RUNTIME_UNAVAILABLE,
    );

    expect(invokeCommand).not.toHaveBeenCalled();
  });
});
