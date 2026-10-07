import { describe, expect, it, vi } from "vitest";
import {
  AGENT_INLINE_IMAGE_BUSY_MESSAGE,
  isAgentInlineImageBusyError,
} from "../application/agentInlineImagePorts";
import {
  MAX_AGENT_INLINE_IMAGE_BYTES,
  MAX_AGENT_INLINE_IMAGE_PATH_BYTES,
} from "../domain/agentMarkdown/agentInlineImage";
import {
  AGENT_INLINE_IMAGE_RUNTIME_UNAVAILABLE,
  READ_AGENT_INLINE_IMAGE_IPC_COMMAND,
  TauriAgentInlineImageGateway,
  invokeReadAgentInlineImageIpc,
  type InvokeAgentInlineImageCommand,
} from "./tauriAgentInlineImageGateway";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const REQUEST = { workspaceId: "ws-1", threadId: "agt-1-0a1b", path: "/tmp/shots/x.png" } as const;

function responding(value: unknown) {
  return vi.fn<InvokeAgentInlineImageCommand>(async () => value);
}

describe("read_agent_inline_image wire contract", () => {
  it("pins the Rust command name, the busy message and the wire limits", () => {
    expect(READ_AGENT_INLINE_IMAGE_IPC_COMMAND).toBe("read_agent_inline_image");
    expect(AGENT_INLINE_IMAGE_BUSY_MESSAGE).toBe("Another image is being read. Try again shortly.");
    expect(MAX_AGENT_INLINE_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_AGENT_INLINE_IMAGE_PATH_BYTES).toBe(4096);
  });

  it("sends exactly the three request fields and returns the raw bytes", async () => {
    const invokeCommand = responding(PNG.buffer);

    const bytes = await invokeReadAgentInlineImageIpc(invokeCommand, {
      ...REQUEST,
      mime: "image/png",
    } as typeof REQUEST);

    expect(new Uint8Array(bytes)).toEqual(PNG);
    expect(invokeCommand.mock.calls).toEqual([
      [
        "read_agent_inline_image",
        { request: { workspaceId: "ws-1", threadId: "agt-1-0a1b", path: "/tmp/shots/x.png" } },
      ],
    ]);
    const args = invokeCommand.mock.calls[0]?.[1] ?? {};
    expect(Object.keys(args)).toEqual(["request"]);
    expect(Object.keys(args.request as object)).toEqual(["workspaceId", "threadId", "path"]);
  });

  it("copies exactly the viewed bytes of a Uint8Array response", async () => {
    const backing = new Uint8Array([0, 0, ...PNG, 0]);
    const bytes = await invokeReadAgentInlineImageIpc(
      responding(backing.subarray(2, 2 + PNG.byteLength)),
      REQUEST,
    );
    expect(new Uint8Array(bytes)).toEqual(PNG);
  });

  it("accepts a path and a response at the wire limits", async () => {
    const path = `/${"a".repeat(MAX_AGENT_INLINE_IMAGE_PATH_BYTES - 5)}.png`;
    const invokeCommand = responding(new ArrayBuffer(MAX_AGENT_INLINE_IMAGE_BYTES));

    const bytes = await invokeReadAgentInlineImageIpc(invokeCommand, { ...REQUEST, path });

    expect(bytes.byteLength).toBe(MAX_AGENT_INLINE_IMAGE_BYTES);
    expect(invokeCommand).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a relative path", { path: "shots/x.png" }],
    ["an empty path", { path: "" }],
    ["a file URL", { path: "file:///tmp/x.png" }],
    ["a newline in the path", { path: "/tmp/a\nb.png" }],
    ["a NUL in the path", { path: "/tmp/a\u0000b.png" }],
    ["a C1 control in the path", { path: "/tmp/a\u0085b.png" }],
    ["a path over 4096 bytes", { path: `/${"a".repeat(MAX_AGENT_INLINE_IMAGE_PATH_BYTES)}` }],
    ["a multi-byte path over 4096 bytes", { path: `/${"ž".repeat(2_048)}` }],
    ["a non-string path", { path: 7 as unknown as string }],
    ["an empty workspace id", { workspaceId: "" }],
    ["a control character in the workspace id", { workspaceId: "ws\u00001" }],
    ["an oversized workspace id", { workspaceId: "w".repeat(1_025) }],
    ["an empty thread id", { threadId: "" }],
    ["an unsafe thread id", { threadId: "../agt-1" }],
    ["an uppercase thread id", { threadId: "AGT-1-0A1B" }],
  ])("rejects %s before reaching the backend", async (_name, override) => {
    const invokeCommand = responding(PNG.buffer);

    await expect(
      invokeReadAgentInlineImageIpc(invokeCommand, { ...REQUEST, ...override }),
    ).rejects.toThrow(TypeError);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it.each([
    ["null", null],
    ["a string", "iVBORw0KGgo="],
    ["a number array", [0x89, 0x50, 0x4e, 0x47]],
    ["an object", { bytes: [1] }],
    ["a non-byte view", new Uint16Array([1, 2])],
    ["an empty buffer", new ArrayBuffer(0)],
    ["an empty view", new Uint8Array(0)],
    ["a buffer over 10 MiB", new ArrayBuffer(MAX_AGENT_INLINE_IMAGE_BYTES + 1)],
    ["a view over 10 MiB", new Uint8Array(MAX_AGENT_INLINE_IMAGE_BYTES + 1)],
  ])("rejects %s as the response", async (_name, value) => {
    await expect(invokeReadAgentInlineImageIpc(responding(value), REQUEST)).rejects.toThrow(
      /Invalid agent inline image value at result/,
    );
  });

  it("never echoes the requested path in a boundary error", async () => {
    const path = "relative/secret-shot.png";
    const error = await invokeReadAgentInlineImageIpc(responding(PNG.buffer), {
      ...REQUEST,
      path,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(TypeError);
    expect(String(error)).not.toContain(path);
  });

  it("passes a backend rejection through unchanged", async () => {
    const invokeCommand = vi.fn<InvokeAgentInlineImageCommand>(async () =>
      Promise.reject(AGENT_INLINE_IMAGE_BUSY_MESSAGE),
    );
    await expect(invokeReadAgentInlineImageIpc(invokeCommand, REQUEST)).rejects.toBe(
      AGENT_INLINE_IMAGE_BUSY_MESSAGE,
    );
  });
});

describe("isAgentInlineImageBusyError", () => {
  it.each([
    AGENT_INLINE_IMAGE_BUSY_MESSAGE,
    ` ${AGENT_INLINE_IMAGE_BUSY_MESSAGE}\n`,
    new Error(AGENT_INLINE_IMAGE_BUSY_MESSAGE),
  ])("classifies %s as the transient busy failure", (error) => {
    expect(isAgentInlineImageBusyError(error)).toBe(true);
  });

  it.each([
    "Runner is busy; retry shortly",
    "Runner request failed (HTTP 503).",
    "Another image is being read.",
    "The image could not be read.",
    new Error("The image is no longer available."),
    "",
    null,
    undefined,
    { message: AGENT_INLINE_IMAGE_BUSY_MESSAGE },
  ])("does not classify %s as transient", (error) => {
    expect(isAgentInlineImageBusyError(error)).toBe(false);
  });
});

describe("TauriAgentInlineImageGateway", () => {
  it("reads through the typed contract inside the native runtime", async () => {
    const invokeCommand = responding(PNG.buffer);
    const gateway = new TauriAgentInlineImageGateway(invokeCommand, () => true);

    expect(new Uint8Array(await gateway.readAgentInlineImage(REQUEST))).toEqual(PNG);
    expect(invokeCommand).toHaveBeenCalledWith("read_agent_inline_image", { request: REQUEST });
  });

  it("refuses outside the native runtime without invoking a command", async () => {
    const invokeCommand = responding(PNG.buffer);
    const gateway = new TauriAgentInlineImageGateway(invokeCommand, () => false);

    await expect(gateway.readAgentInlineImage(REQUEST)).rejects.toThrow(
      AGENT_INLINE_IMAGE_RUNTIME_UNAVAILABLE,
    );
    expect(invokeCommand).not.toHaveBeenCalled();
  });
});
