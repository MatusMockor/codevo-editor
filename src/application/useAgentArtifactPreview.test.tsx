// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentArtifactMetadata } from "../domain/agentArtifact";
import type {
  AgentArtifactLoader,
  AgentArtifactOwner,
  AgentArtifactPreviewPort,
} from "./agentArtifactPorts";
import {
  useAgentArtifactPreview,
  AGENT_ARTIFACT_FRAME_TIMEOUT_MS,
  AGENT_ARTIFACT_PREVIEW_TTL_MS,
  type AgentArtifactPreviewInput,
  type AgentArtifactPreviewSurface,
} from "./useAgentArtifactPreview";

const metadata: AgentArtifactMetadata = {
  id: "a".repeat(64),
  taskId: "agt-2-0a1b",
  name: "design.html",
  mediaType: "text/html",
  sizeBytes: 3,
  sha256: "b".repeat(64),
};
const owner: AgentArtifactOwner = {
  kind: "local",
  rootKey: "/workspace/app",
  ownerId: "owner",
  repositoryRoot: "/workspace/app",
  threadId: "agt-1-0a1b",
  turnId: "agt-2-0a1b",
};

let root: Root;
let surface: AgentArtifactPreviewSurface;
let dispose: ReturnType<typeof vi.fn<() => Promise<void>>>;
let props: AgentArtifactPreviewInput;

function Harness({ value }: { readonly value: AgentArtifactPreviewInput }) {
  surface = useAgentArtifactPreview(value);
  return null;
}

async function render(value: AgentArtifactPreviewInput = props): Promise<void> {
  await act(async () => root.render(<Harness value={value} />));
}

function loader(): AgentArtifactLoader {
  return {
    resolve: vi.fn().mockResolvedValue(metadata),
    read: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
  };
}

function previewPort(): AgentArtifactPreviewPort {
  return {
    prepare: vi.fn().mockResolvedValue({
      url: "codevo-artifact-preview://localhost/token",
      dispose,
    }),
  };
}

describe("useAgentArtifactPreview", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    root = createRoot(document.createElement("div"));
    Object.defineProperty(crypto, "subtle", {
      configurable: true,
      value: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).fill(187).buffer) },
    });
    dispose = vi.fn<() => Promise<void>>(async () => undefined);
    props = { owner, path: "design.html", loader: loader(), preview: previewPort() };
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("gives a long synchronous page time to paint before failing the frame", () => {
    expect(AGENT_ARTIFACT_FRAME_TIMEOUT_MS).toBe(20_000);
    expect(AGENT_ARTIFACT_PREVIEW_TTL_MS).toBeGreaterThan(AGENT_ARTIFACT_FRAME_TIMEOUT_MS);
  });

  it("releases the prepared token when the frame never loads", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await render();
    expect(surface.state.kind).toBe("ready");

    await act(async () => {
      vi.advanceTimersByTime(AGENT_ARTIFACT_FRAME_TIMEOUT_MS - 1);
    });
    expect(dispose).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(surface.state).toEqual({ kind: "failed", reason: "previewFailed" });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("releases the prepared token when the preview expires", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await render();
    act(() => surface.notifyFrameLoaded());

    await act(async () => {
      vi.advanceTimersByTime(AGENT_ARTIFACT_PREVIEW_TTL_MS);
    });

    expect(surface.state).toEqual({ kind: "failed", reason: "expired" });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("releases a timed-out token exactly once when the preview is retried", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await render();
    await act(async () => {
      vi.advanceTimersByTime(AGENT_ARTIFACT_FRAME_TIMEOUT_MS);
    });
    const second = vi.fn().mockResolvedValue(undefined);
    props.preview.prepare = vi.fn().mockResolvedValue({
      url: "codevo-artifact-preview://localhost/next",
      dispose: second,
    });

    await act(async () => surface.retry());

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(surface.state.kind).toBe("ready");
    expect(second).not.toHaveBeenCalled();
  });

  it("releases the prepared token on unmount", async () => {
    await render();
    expect(surface.state.kind).toBe("ready");

    await act(async () => root.unmount());

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("releases the prepared token when the owner changes", async () => {
    await render();

    await render({ ...props, owner: { ...owner, rootKey: "/workspace/other" } });

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("releases a token prepared after its owner was replaced", async () => {
    const pending: Array<(value: { url: string; dispose: () => Promise<void> }) => void> = [];
    props.preview.prepare = vi.fn(
      () =>
        new Promise<{ url: string; dispose: () => Promise<void> }>((resolve) => {
          pending.push(resolve);
        }),
    );
    await render();
    await render({ ...props, owner: { ...owner, rootKey: "/workspace/other" } });

    await act(async () =>
      pending[0]!({ url: "codevo-artifact-preview://localhost/late", dispose }),
    );

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
