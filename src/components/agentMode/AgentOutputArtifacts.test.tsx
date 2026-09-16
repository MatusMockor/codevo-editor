// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentArtifactLoader,
  AgentArtifactOwner,
  AgentArtifactPreviewPort,
} from "../../application/agentArtifactPorts";
import type { AgentArtifactMetadata } from "../../domain/agentArtifact";
import { AgentOutputArtifacts, AgentArtifactPreviewScope } from "./AgentOutputArtifacts";

const metadata: AgentArtifactMetadata = {
  id: "a".repeat(64),
  taskId: "task",
  name: "image.png",
  mediaType: "image/png",
  sizeBytes: 3,
  sha256: "b".repeat(64),
};
const owner: AgentArtifactOwner = {
  kind: "remote",
  serverId: "server",
  runnerId: "runner",
  taskId: "task",
};
describe("AgentOutputArtifacts", () => {
  let host: HTMLDivElement;
  let root: Root;
  let loader: AgentArtifactLoader;
  let preview: AgentArtifactPreviewPort;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    Object.defineProperty(crypto, "subtle", {
      configurable: true,
      value: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).fill(187).buffer) },
    });
    preview = {
      prepare: vi.fn().mockResolvedValue({
        url: "artifact-preview://localhost/token",
        dispose: vi.fn().mockResolvedValue(undefined),
      }),
    };
    loader = {
      resolve: vi.fn().mockResolvedValue(metadata),
      read: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
    };
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });
  function render(currentOwner = owner) {
    act(() =>
      root.render(
        <AgentArtifactPreviewScope>
          <AgentOutputArtifacts
            owner={currentOwner}
            loader={loader}
            preview={preview}
            references={[{ path: "image.png", label: "Image" }]}
          />
        </AgentArtifactPreviewScope>,
      ),
    );
  }
  async function click() {
    await act(async () => {
      host.querySelector("button")!.click();
    });
  }
  it("loads only on request and revokes its one owned preview on close", async () => {
    render();
    expect(loader.resolve).not.toHaveBeenCalled();
    await click();
    expect(host.querySelector("img")?.src).toBe("blob:preview");
    await click();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });
  it("ignores pending A results after A → B → A", async () => {
    let resolve!: (value: AgentArtifactMetadata) => void;
    loader.resolve = vi.fn(
      () =>
        new Promise<AgentArtifactMetadata>((r) => {
          resolve = r;
        }),
    );
    render();
    await click();
    render({ ...owner, serverId: "B" });
    render(owner);
    await act(async () => resolve(metadata));
    expect(loader.read).not.toHaveBeenCalled();
    expect(host.querySelector("img")).toBeNull();
  });
  it("ignores late file bytes after unmount", async () => {
    let resolve!: (value: ArrayBuffer) => void;
    loader.read = vi.fn(
      () =>
        new Promise<ArrayBuffer>((r) => {
          resolve = r;
        }),
    );
    render();
    await click();
    await click();
    await act(async () => resolve(new Uint8Array([1, 2, 3]).buffer));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it("fails closed on mismatched or oversized bytes", async () => {
    loader.read = vi.fn().mockResolvedValue(new ArrayBuffer(4));
    render();
    await click();
    expect(host.textContent).toContain("could not be previewed");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it("renders HTML only in an opaque sandbox after explicit request", async () => {
    loader.resolve = vi
      .fn()
      .mockResolvedValue({ ...metadata, mediaType: "text/html", name: "design.html" });
    render();
    expect(host.querySelector("iframe")).toBeNull();
    await click();
    const frame = host.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.hasAttribute("srcdoc")).toBe(false);
    expect(host.textContent).toContain("network access is disabled");
  });
  it("rejects changed content before creating any preview", async () => {
    vi.mocked(crypto.subtle.digest).mockResolvedValue(new Uint8Array(32).buffer);
    render();
    await click();
    expect(host.textContent).toContain("could not be previewed");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(preview.prepare).not.toHaveBeenCalled();
  });
  it("disposes a preview acquired after the owner was removed", async () => {
    let settle!: (value: { url: string; dispose: () => Promise<void> }) => void;
    const dispose = vi.fn().mockResolvedValue(undefined);
    preview.prepare = vi.fn(
      () =>
        new Promise<{ url: string; dispose: () => Promise<void> }>((resolve) => {
          settle = resolve;
        }),
    );
    loader.resolve = vi.fn().mockResolvedValue({ ...metadata, mediaType: "text/html" });
    render();
    await click();
    render({ ...owner, serverId: "B" });
    await act(async () => settle({ url: "artifact-preview://localhost/token", dispose }));
    expect(dispose).toHaveBeenCalledOnce();
    expect(host.querySelector("iframe")).toBeNull();
  });
  it("does not read oversized artifacts", async () => {
    loader.resolve = vi.fn().mockResolvedValue({ ...metadata, sizeBytes: 8 * 1024 * 1024 + 1 });
    render();
    await click();
    expect(loader.read).not.toHaveBeenCalled();
    expect(host.textContent).toContain("could not be previewed");
  });
  it("enlarges the image in a modal and restores focus on close", async () => {
    const show = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    const close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: show,
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: close,
    });
    render();
    await click();
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Enlarge image.png"]')!;
    act(() => trigger.click());
    expect(show).toHaveBeenCalledOnce();
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Close image preview"]')!.click());
    expect(close).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(trigger);
  });
  it("retains only one preview across different turns in the transcript", async () => {
    act(() =>
      root.render(
        <AgentArtifactPreviewScope>
          <AgentOutputArtifacts
            owner={owner}
            loader={loader}
            preview={preview}
            references={[{ path: "a.png", label: "First" }]}
          />
          <AgentOutputArtifacts
            owner={{ ...owner, taskId: "second" }}
            loader={loader}
            preview={preview}
            references={[{ path: "b.png", label: "Second" }]}
          />
        </AgentArtifactPreviewScope>,
      ),
    );
    await act(async () => {
      host.querySelector<HTMLButtonElement>("button")!.click();
    });
    expect(host.querySelectorAll(".agent-artifacts__image")).toHaveLength(1);
    await act(async () => {
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent === "Second")!
        .click();
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
    expect(host.querySelectorAll(".agent-artifacts__image")).toHaveLength(1);
    expect(host.querySelector('[aria-pressed="true"]')?.textContent).toBe("Second");
  });
});
