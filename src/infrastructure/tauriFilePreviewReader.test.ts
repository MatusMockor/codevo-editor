import { describe, expect, it } from "vitest";
import { FilePreviewContractError } from "../domain/filePreview";
import {
  createTauriFilePreviewReader,
  FILE_PREVIEW_IPC_COMMAND,
  type InvokeFilePreviewCommand,
} from "./tauriFilePreviewReader";

interface RecordedCall {
  readonly command: string;
  readonly args: Record<string, unknown>;
}

function recordingInvoke(result: () => Promise<unknown>): {
  readonly calls: RecordedCall[];
  readonly invokeCommand: InvokeFilePreviewCommand;
} {
  const calls: RecordedCall[] = [];
  return {
    calls,
    invokeCommand: (command, args) => {
      calls.push({ command, args });
      return result();
    },
  };
}

describe("createTauriFilePreviewReader", () => {
  it("invokes the preview command with a strict request and parses the result", async () => {
    const { calls, invokeCommand } = recordingInvoke(() =>
      Promise.resolve({
        kind: "text",
        relativePath: "src/a.ts",
        contents: "x",
        byteLength: 1,
        truncated: false,
      }),
    );

    const preview = await createTauriFilePreviewReader(invokeCommand).read("/work", "src/a.ts");

    expect(preview).toEqual({
      kind: "text",
      relativePath: "src/a.ts",
      contents: "x",
      byteLength: 1,
      truncated: false,
    });
    expect(calls).toEqual([
      {
        command: FILE_PREVIEW_IPC_COMMAND,
        args: { request: { workspaceRoot: "/work", relativePath: "src/a.ts" } },
      },
    ]);
    expect(FILE_PREVIEW_IPC_COMMAND).toBe("workspace_read_file_preview");
  });

  it("rejects invalid requests without invoking the backend", async () => {
    const { calls, invokeCommand } = recordingInvoke(() => Promise.resolve(null));

    await expect(
      createTauriFilePreviewReader(invokeCommand).read("/work", "../secret"),
    ).rejects.toBeInstanceOf(FilePreviewContractError);
    expect(calls).toEqual([]);
  });

  it("fails closed on a payload for a different file", async () => {
    const { invokeCommand } = recordingInvoke(() =>
      Promise.resolve({ kind: "binary", relativePath: "other.bin", byteLength: 1 }),
    );

    await expect(
      createTauriFilePreviewReader(invokeCommand).read("/work", "a.bin"),
    ).rejects.toBeInstanceOf(FilePreviewContractError);
  });

  it("replaces legacy backend string errors with a safe fallback", async () => {
    const { invokeCommand } = recordingInvoke(() =>
      Promise.reject("No such file or directory (os error 2)"),
    );

    await expect(
      createTauriFilePreviewReader(invokeCommand).read("/work", "missing.ts"),
    ).rejects.toThrow("This file couldn't be opened. Try again.");
  });

  it.each(["notFound", "notRegularFile", "unreadable", "operationFailed"])(
    "parses the typed %s wire failure",
    async (kind) => {
      const reader = createTauriFilePreviewReader(() => Promise.reject({ kind }));
      await expect(reader.read("/work", "a.ts")).rejects.toMatchObject({ kind });
    },
  );

  it.each([{ kind: "unknown" }, { kind: "notFound", message: "os error 2" }, null])(
    "fails closed on an invalid error payload",
    async (payload) => {
      const reader = createTauriFilePreviewReader(() => Promise.reject(payload));
      await expect(reader.read("/work", "a.ts")).rejects.toMatchObject({
        kind: "operationFailed",
      });
    },
  );

  it("does not invoke when the signal is already aborted", async () => {
    const { calls, invokeCommand } = recordingInvoke(() => Promise.resolve(null));
    const controller = new AbortController();
    controller.abort();

    await expect(
      createTauriFilePreviewReader(invokeCommand).read("/work", "a.ts", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toEqual([]);
  });

  it("drops a result that settles after the signal aborted", async () => {
    const controller = new AbortController();
    const { invokeCommand } = recordingInvoke(() => {
      controller.abort();
      return Promise.resolve({ kind: "binary", relativePath: "a.bin", byteLength: 1 });
    });

    await expect(
      createTauriFilePreviewReader(invokeCommand).read("/work", "a.bin", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
