// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentArtifactFailureReporter,
  AgentArtifactFilePort,
  AgentArtifactLoader,
  AgentArtifactOwner,
  AgentArtifactPreviewPort,
} from "../../application/agentArtifactPorts";
import {
  AGENT_ARTIFACT_FOREIGN_WORKSPACE,
  AGENT_ARTIFACT_REMOTE_FILE_REASON,
} from "../../application/createAgentArtifactFilePort";
import { AGENT_ARTIFACT_FRAME_TIMEOUT_MS } from "../../application/useAgentArtifactPreview";
import type { AgentArtifactMetadata } from "../../domain/agentArtifact";
import { detectKeymapPlatform } from "../../domain/keymap";
import { AgentOutputArtifacts, AgentArtifactPreviewScope } from "./AgentOutputArtifacts";
import { AGENT_ARTIFACT_FILES_UNAVAILABLE } from "./AgentArtifactFileActions";
import { agentArtifactRevealLabel } from "./agentArtifactSupport";

const metadata: AgentArtifactMetadata = {
  id: "a".repeat(64),
  taskId: "task",
  name: "image.png",
  mediaType: "image/png",
  sizeBytes: 3,
  sha256: "b".repeat(64),
};
const htmlMetadata: AgentArtifactMetadata = {
  ...metadata,
  mediaType: "text/html",
  name: "design.html",
};
const owner: AgentArtifactOwner = {
  kind: "remote",
  serverId: "server",
  runnerId: "runner",
  taskId: "task",
};
const localOwner: AgentArtifactOwner = {
  kind: "local",
  rootKey: "/workspace/app",
  ownerId: "owner",
  repositoryRoot: "/workspace/app",
  threadId: "agt-1-0a1b",
  turnId: "agt-2-0a1b",
};

describe("AgentOutputArtifacts", () => {
  let host: HTMLDivElement;
  let root: Root;
  let loader: AgentArtifactLoader;
  let preview: AgentArtifactPreviewPort;
  let files: AgentArtifactFilePort;
  let reportError: ReturnType<typeof vi.fn<AgentArtifactFailureReporter>>;
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
        url: "codevo-artifact-preview://localhost/token",
        dispose: vi.fn().mockResolvedValue(undefined),
      }),
    };
    loader = {
      resolve: vi.fn().mockResolvedValue(metadata),
      read: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
    };
    files = {
      openInEditor: vi.fn().mockResolvedValue(undefined),
      revealInFileManager: vi.fn().mockResolvedValue(undefined),
    };
    reportError = vi.fn<AgentArtifactFailureReporter>();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function render(
    currentOwner: AgentArtifactOwner = owner,
    overrides: { readonly files?: AgentArtifactFilePort | null } = {},
  ) {
    act(() =>
      root.render(
        <AgentArtifactPreviewScope>
          <AgentOutputArtifacts
            files={overrides.files === undefined ? files : overrides.files}
            loader={loader}
            owner={currentOwner}
            preview={preview}
            references={[{ path: "image.png", label: "Image" }]}
            reportError={reportError}
          />
        </AgentArtifactPreviewScope>,
      ),
    );
  }
  function chip(): HTMLButtonElement {
    return host.querySelector<HTMLButtonElement>(".agent-artifacts__chip")!;
  }
  function action(kind: "open" | "reveal"): HTMLButtonElement {
    return host.querySelector<HTMLButtonElement>(`[data-agent-artifact-action="${kind}"]`)!;
  }
  async function click() {
    await act(async () => {
      chip().click();
    });
  }
  async function settle() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("renders a disclosure with aria-expanded and a panel it controls", async () => {
    render();
    const button = chip();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const panelId = button.getAttribute("aria-controls")!;
    const panel = document.getElementById(panelId)!;
    expect(panel.getAttribute("role")).toBe("region");
    expect(panel.hasAttribute("hidden")).toBe(true);
    expect(button.dataset.agentArtifactPath).toBe("image.png");
    await click();
    expect(chip().getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(panelId)!.hasAttribute("hidden")).toBe(false);
  });

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

  it("reports a size mismatch as content that changed on disk", async () => {
    loader.read = vi.fn().mockResolvedValue(new ArrayBuffer(4));
    render();
    await click();
    expect(host.textContent).toContain("changed on disk");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledOnce();
    expect(host.querySelector(".agent-artifacts__retry")).toBeNull();
  });

  it("reports a hash mismatch as content that changed on disk", async () => {
    vi.mocked(crypto.subtle.digest).mockResolvedValue(new Uint8Array(32).buffer);
    render();
    await click();
    expect(host.textContent).toContain("changed on disk");
    expect(preview.prepare).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("reports an oversized artifact without reading it", async () => {
    loader.resolve = vi.fn().mockResolvedValue({ ...metadata, sizeBytes: 8 * 1024 * 1024 + 1 });
    render();
    await click();
    expect(loader.read).not.toHaveBeenCalled();
    expect(host.textContent).toContain("too large to preview");
    expect(host.querySelector(".agent-artifacts__retry")).toBeNull();
  });

  it("reports the backend's missing-snapshot refusal without offering a retry", async () => {
    loader.resolve = vi
      .fn()
      .mockRejectedValue(new Error("This older turn has no saved artifact snapshot."));
    render();
    await click();
    expect(host.textContent).toContain("no saved snapshot");
    expect(host.querySelector(".agent-artifacts__retry")).toBeNull();
    expect(reportError).toHaveBeenCalledOnce();
    expect(reportError.mock.calls[0]?.[0]).toBe("Agent generated files");
  });

  it("reports a busy artifact store with a retry that recovers", async () => {
    loader.read = vi
      .fn()
      .mockRejectedValueOnce(new Error("Artifact storage is busy. Try again."))
      .mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    render();
    await click();
    expect(host.textContent).toContain("The file store is busy");
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".agent-artifacts__retry")!.click();
    });
    await settle();
    expect(host.querySelector("img")?.src).toBe("blob:preview");
  });

  it("reports a refused native preview as a failed preview", async () => {
    loader.resolve = vi.fn().mockResolvedValue(htmlMetadata);
    preview.prepare = vi.fn().mockRejectedValue(new Error("Too many open previews."));
    render();
    await click();
    expect(host.textContent).toContain("preview did not load");
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector(".agent-artifacts__retry")).not.toBeNull();
  });

  it("renders HTML only in an opaque sandbox and settles when the frame loads", async () => {
    loader.resolve = vi.fn().mockResolvedValue(htmlMetadata);
    render();
    expect(host.querySelector("iframe")).toBeNull();
    await click();
    const frame = host.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.hasAttribute("srcdoc")).toBe(false);
    expect(host.textContent).toContain("Loading preview…");
    await act(async () => {
      frame.dispatchEvent(new Event("load"));
    });
    expect(host.textContent).not.toContain("Loading preview…");
    expect(host.textContent).toContain("network access is disabled");
  });

  it("announces the loading preview once across the whole load", async () => {
    loader.resolve = vi.fn().mockResolvedValue(htmlMetadata);
    render();
    await click();

    expect(host.textContent).toContain("Loading preview…");
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(0);
  });

  it("fails a frame that never loads within the bounded timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    loader.resolve = vi.fn().mockResolvedValue(htmlMetadata);
    render();
    await click();
    expect(host.querySelector("iframe")).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(AGENT_ARTIFACT_FRAME_TIMEOUT_MS - 1);
    });
    expect(host.querySelector("iframe")).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(host.textContent).toContain("preview did not load");
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector(".agent-artifacts__retry")).not.toBeNull();
  });

  it("expires a mounted preview before its native token dies", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    loader.resolve = vi.fn().mockResolvedValue(htmlMetadata);
    render();
    await click();
    await act(async () => {
      host.querySelector("iframe")!.dispatchEvent(new Event("load"));
    });
    await act(async () => {
      vi.advanceTimersByTime(25 * 60 * 1_000);
    });
    expect(host.textContent).toContain("preview expired");
    expect(host.querySelector(".agent-artifacts__retry")).not.toBeNull();
  });

  it("disposes a preview acquired after the owner was removed", async () => {
    let settlePrepare!: (value: { url: string; dispose: () => Promise<void> }) => void;
    const dispose = vi.fn().mockResolvedValue(undefined);
    preview.prepare = vi.fn(
      () =>
        new Promise<{ url: string; dispose: () => Promise<void> }>((resolve) => {
          settlePrepare = resolve;
        }),
    );
    loader.resolve = vi.fn().mockResolvedValue(htmlMetadata);
    render();
    await click();
    render({ ...owner, serverId: "B" });
    await act(async () =>
      settlePrepare({ url: "codevo-artifact-preview://localhost/token", dispose }),
    );
    expect(dispose).toHaveBeenCalledOnce();
    expect(host.querySelector("iframe")).toBeNull();
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

  it("opens and reveals the workspace file through the port", async () => {
    render(localOwner);
    await act(async () => {
      action("open").click();
    });
    expect(files.openInEditor).toHaveBeenCalledWith(localOwner, "image.png");
    await act(async () => {
      action("reveal").click();
    });
    expect(files.revealInFileManager).toHaveBeenCalledWith(localOwner, "image.png");
    expect(host.querySelector(".agent-artifacts__notice")).toBeNull();
  });

  it("surfaces a bounded notice when opening fails, exactly once", async () => {
    files.openInEditor = vi.fn().mockRejectedValue(new Error("nope"));
    render(localOwner);
    await act(async () => {
      action("open").click();
    });
    await settle();
    expect(host.querySelector(".agent-artifacts__notice")?.textContent).toContain(
      "could not be opened",
    );
    expect(host.querySelectorAll(".agent-artifacts__notice")).toHaveLength(1);
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("names a refused foreign workspace instead of a generic open failure", async () => {
    files.openInEditor = vi.fn().mockRejectedValue(new Error(AGENT_ARTIFACT_FOREIGN_WORKSPACE));
    render(localOwner);
    await act(async () => {
      action("open").click();
    });
    await settle();
    expect(host.querySelector(".agent-artifacts__notice")?.textContent).toBe(
      AGENT_ARTIFACT_FOREIGN_WORKSPACE,
    );
  });

  it("names the reveal action for the host platform", () => {
    expect(agentArtifactRevealLabel("mac")).toBe("Reveal in Finder");
    expect(agentArtifactRevealLabel("windows")).toBe("Reveal in File Explorer");
    expect(agentArtifactRevealLabel("linux")).toBe("Reveal in file manager");
    expect(agentArtifactRevealLabel("other")).toBe("Reveal in file manager");
    render(localOwner);
    const expected = agentArtifactRevealLabel(detectKeymapPlatform());
    expect(action("reveal").textContent).toBe(expected);
    expect(action("reveal").getAttribute("title")).toBe(expected);
  });

  it("disables the file actions with a truthful reason for remote turns", () => {
    render(owner);
    expect(action("open").disabled).toBe(true);
    expect(action("reveal").disabled).toBe(true);
    expect(host.textContent).toContain(AGENT_ARTIFACT_REMOTE_FILE_REASON);
    const described = action("open").getAttribute("aria-describedby")!;
    expect(document.getElementById(described)?.textContent).toBe(AGENT_ARTIFACT_REMOTE_FILE_REASON);
  });

  it("disables the file actions when no native file port is wired", () => {
    render(localOwner, { files: null });
    expect(action("open").disabled).toBe(true);
    expect(host.textContent).toContain(AGENT_ARTIFACT_FILES_UNAVAILABLE);
  });

  it("retains only one preview across different turns in the transcript", async () => {
    act(() =>
      root.render(
        <AgentArtifactPreviewScope>
          <AgentOutputArtifacts
            loader={loader}
            owner={owner}
            preview={preview}
            references={[{ path: "a.png", label: "First" }]}
          />
          <AgentOutputArtifacts
            loader={loader}
            owner={{ ...owner, taskId: "second" }}
            preview={preview}
            references={[{ path: "b.png", label: "Second" }]}
          />
        </AgentArtifactPreviewScope>,
      ),
    );
    const chips = () =>
      Array.from(host.querySelectorAll<HTMLButtonElement>(".agent-artifacts__chip"));
    await act(async () => {
      chips()[0]!.click();
    });
    expect(host.querySelectorAll(".agent-artifacts__image")).toHaveLength(1);
    await act(async () => {
      chips()[1]!.click();
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
    expect(host.querySelectorAll(".agent-artifacts__image")).toHaveLength(1);
    expect(host.querySelector('[aria-expanded="true"]')?.textContent).toContain("Second");
  });
});
