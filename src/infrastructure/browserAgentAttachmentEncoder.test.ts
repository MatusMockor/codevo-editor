// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserAgentAttachmentEncoder } from "./browserAgentAttachmentEncoder";

const bytes = () => new Uint8Array([137, 80, 78, 71]);
const signal = () => new AbortController().signal;

function controlled() {
  const reader = new FileReader();
  const read = vi.spyOn(reader, "readAsDataURL").mockImplementation(() => undefined);
  const abort = vi.spyOn(reader, "abort").mockImplementation(() => undefined);
  Object.defineProperty(reader, "readyState", { value: FileReader.LOADING });
  const create = vi.fn(() => reader);
  const encoder = new BrowserAgentAttachmentEncoder(create);
  const load = (result: string | ArrayBuffer | null) => {
    Object.defineProperty(reader, "result", { configurable: true, value: result });
    reader.dispatchEvent(new ProgressEvent("load"));
  };
  return { reader, read, abort, create, encoder, load };
}

afterEach(() => vi.useRealTimers());

describe("BrowserAgentAttachmentEncoder", () => {
  it("uses the real asynchronous reader and encodes every byte", async () => {
    const encoder = new BrowserAgentAttachmentEncoder();
    expect(await encoder.encode(bytes(), signal())).toBe("iVBORw==");
  });

  it("returns before native read completion and clears its handlers after settlement", async () => {
    vi.useFakeTimers();
    const f = controlled();
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    let finished = false;
    const pending = f.encoder.encode(bytes(), controller.signal).then((result) => {
      finished = true;
      return result;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(f.read).toHaveBeenCalledOnce();
    expect(f.read.mock.calls[0]![0]).toMatchObject({
      size: 4,
      type: "application/octet-stream",
    });
    f.load("data:application/octet-stream;base64,iVBORw==");
    expect(await pending).toBe("iVBORw==");
    expect(f.reader.onload).toBeNull();
    expect(f.reader.onerror).toBeNull();
    expect(f.reader.onabort).toBeNull();
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, 5 * 1024 * 1024 + 1])("rejects %i bytes before reading", async (size) => {
    const f = controlled();
    await expect(f.encoder.encode(new Uint8Array(size), signal())).rejects.toThrow("5 MiB");
    expect(f.create).not.toHaveBeenCalled();
  });

  it("rejects prior cancellation without allocating a reader", async () => {
    const f = controlled();
    const controller = new AbortController();
    controller.abort();
    await expect(f.encoder.encode(bytes(), controller.signal)).rejects.toThrow("cancelled");
    expect(f.create).not.toHaveBeenCalled();
  });

  it("aborts pending work on cancellation and ignores a retained late callback", async () => {
    vi.useFakeTimers();
    const f = controlled();
    const controller = new AbortController();
    const pending = f.encoder.encode(bytes(), controller.signal);
    const late = f.reader.onload;
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect(f.abort).toHaveBeenCalledOnce();
    late?.call(f.reader, new ProgressEvent("load") as ProgressEvent<FileReader>);
    expect(f.reader.onload).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a stuck read on timeout and releases capacity", async () => {
    vi.useFakeTimers();
    const f = controlled();
    const pending = f.encoder.encode(bytes(), signal());
    const failed = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(30_000);
    await failed;
    expect(f.abort).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    const next = f.encoder.encode(bytes(), signal());
    f.load("data:application/octet-stream;base64,iVBORw==");
    expect(await next).toBe("iVBORw==");
  });

  it("bounds concurrent encodings and releases each admission after cancellation", async () => {
    const readers: ReturnType<typeof controlled>[] = [];
    const encoder = new BrowserAgentAttachmentEncoder(() => {
      const f = controlled();
      readers.push(f);
      return f.reader;
    });
    const controller = new AbortController();
    const pending = Array.from({ length: 8 }, () =>
      encoder.encode(bytes(), controller.signal).catch((error: unknown) => error),
    );
    await expect(encoder.encode(bytes(), signal())).rejects.toThrow("busy");
    expect(readers).toHaveLength(8);
    controller.abort();
    await Promise.all(pending);
    expect(readers.every((f) => f.abort.mock.calls.length === 1)).toBe(true);
    const next = encoder.encode(bytes(), signal());
    readers[8]!.load("data:application/octet-stream;base64,iVBORw==");
    expect(await next).toBe("iVBORw==");
  });

  it.each([null, new ArrayBuffer(4), "invalid", "data:application/octet-stream;base64,AA=="])(
    "rejects malformed native result %s without retaining callbacks",
    async (result) => {
      const f = controlled();
      const pending = f.encoder.encode(bytes(), signal());
      f.load(result);
      await expect(pending).rejects.toThrow("invalid data");
      expect(f.reader.onload).toBeNull();
    },
  );

  it("handles read errors, native abort, construction failure and synchronous read failure", async () => {
    for (const event of ["error", "abort"] as const) {
      const f = controlled();
      const pending = f.encoder.encode(bytes(), signal());
      f.reader.dispatchEvent(new ProgressEvent(event));
      await expect(pending).rejects.toThrow();
      expect(f.reader.onload).toBeNull();
    }
    const create = vi.fn(() => {
      throw new Error("Reader unavailable");
    });
    const encoder = new BrowserAgentAttachmentEncoder(create);
    for (let i = 0; i < 9; i++)
      await expect(encoder.encode(bytes(), signal())).rejects.toThrow("Reader unavailable");
    const f = controlled();
    f.read.mockImplementation(() => {
      throw new Error("Read unavailable");
    });
    await expect(f.encoder.encode(bytes(), signal())).rejects.toThrow("could not be encoded");
    expect(f.abort).toHaveBeenCalledOnce();
    expect(f.reader.onload).toBeNull();
  });
});
