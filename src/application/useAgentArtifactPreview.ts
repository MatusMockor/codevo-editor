import { useCallback, useEffect, useRef, useState } from "react";
import { agentArtifactByteLimit, type AgentArtifactMetadata } from "../domain/agentArtifact";
import {
  classifyAgentArtifactFailure,
  type AgentArtifactFailureReason,
} from "../domain/agentArtifactFailure";
import { attempt } from "./agentProjectAuthority";
import {
  AGENT_ARTIFACT_SOURCE,
  type AgentArtifactFailureReporter,
  type AgentArtifactLoader,
  type AgentArtifactOwner,
  type AgentArtifactPreviewPort,
} from "./agentArtifactPorts";

/** A blank frame must resolve into an explicit state well before the user gives up. */
export const AGENT_ARTIFACT_FRAME_TIMEOUT_MS = 20_000;
/** The native preview token dies after 30 minutes; expire the frame before it 404s. */
export const AGENT_ARTIFACT_PREVIEW_TTL_MS = 25 * 60 * 1_000;

export type AgentArtifactFrameState = "pending" | "settled";

export type AgentArtifactPreviewState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly metadata: AgentArtifactMetadata;
      readonly url: string;
      readonly frame: AgentArtifactFrameState;
    }
  | { readonly kind: "failed"; readonly reason: AgentArtifactFailureReason };

export interface AgentArtifactPreviewInput {
  readonly owner: AgentArtifactOwner;
  readonly path: string;
  readonly loader: AgentArtifactLoader;
  readonly preview: AgentArtifactPreviewPort;
  readonly reportError?: AgentArtifactFailureReporter | null;
  readonly frameTimeoutMs?: number;
  readonly previewTtlMs?: number;
}

export interface AgentArtifactPreviewSurface {
  readonly state: AgentArtifactPreviewState;
  retry(): void;
  notifyFrameLoaded(): void;
}

const LOADING: AgentArtifactPreviewState = { kind: "loading" };

function hex(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function useAgentArtifactPreview({
  owner,
  path,
  loader,
  preview,
  reportError = null,
  frameTimeoutMs = AGENT_ARTIFACT_FRAME_TIMEOUT_MS,
  previewTtlMs = AGENT_ARTIFACT_PREVIEW_TTL_MS,
}: AgentArtifactPreviewInput): AgentArtifactPreviewSurface {
  const [state, setState] = useState<AgentArtifactPreviewState>(LOADING);
  const [generation, setGeneration] = useState(0);
  const frameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ttlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportRef = useRef<AgentArtifactFailureReporter | null>(reportError);
  useEffect(() => {
    reportRef.current = reportError;
  }, [reportError]);

  const clearTimers = useCallback((): void => {
    if (frameTimerRef.current !== null) clearTimeout(frameTimerRef.current);
    if (ttlTimerRef.current !== null) clearTimeout(ttlTimerRef.current);
    frameTimerRef.current = null;
    ttlTimerRef.current = null;
  }, []);

  const fail = useCallback(
    (reason: AgentArtifactFailureReason, error: unknown): void => {
      clearTimers();
      reportRef.current?.(AGENT_ARTIFACT_SOURCE, error);
      setState({ kind: "failed", reason });
    },
    [clearTimers],
  );

  const notifyFrameLoaded = useCallback((): void => {
    if (frameTimerRef.current !== null) clearTimeout(frameTimerRef.current);
    frameTimerRef.current = null;
    setState((current) => (current.kind === "ready" ? { ...current, frame: "settled" } : current));
  }, []);

  const retry = useCallback((): void => {
    clearTimers();
    setGeneration((current) => current + 1);
  }, [clearTimers]);

  useEffect(() => {
    let current = true;
    let release: (() => void) | null = null;
    clearTimers();
    setState(LOADING);
    void (async () => {
      const resolved = await attempt(() => loader.resolve(owner, path));
      if (!current) return;
      if (!resolved.ok) {
        fail(classifyAgentArtifactFailure(resolved.error), resolved.error);
        return;
      }
      const metadata = resolved.value;
      if (metadata.sizeBytes > agentArtifactByteLimit(metadata.mediaType)) {
        fail("tooLarge", new Error("Artifact exceeds preview limit."));
        return;
      }
      const bytes = await attempt(() => loader.read(owner, metadata.id));
      if (!current) return;
      if (!bytes.ok) {
        fail(classifyAgentArtifactFailure(bytes.error), bytes.error);
        return;
      }
      if (bytes.value.byteLength !== metadata.sizeBytes) {
        fail("changedOnDisk", new Error("Artifact size no longer matches its snapshot."));
        return;
      }
      const digest = await attempt(() => crypto.subtle.digest("SHA-256", bytes.value));
      if (!current) return;
      if (!digest.ok) {
        fail(classifyAgentArtifactFailure(digest.error), digest.error);
        return;
      }
      if (hex(digest.value) !== metadata.sha256) {
        fail("changedOnDisk", new Error("Artifact content no longer matches its snapshot."));
        return;
      }
      if (metadata.mediaType !== "text/html") {
        const url = URL.createObjectURL(new Blob([bytes.value], { type: metadata.mediaType }));
        release = () => URL.revokeObjectURL(url);
        setState({ kind: "ready", metadata, url, frame: "settled" });
        return;
      }
      const prepared = await attempt(() => preview.prepare(bytes.value));
      if (!prepared.ok) {
        if (current) fail("previewFailed", prepared.error);
        return;
      }
      const dispose = () => {
        void prepared.value.dispose().catch(() => undefined);
      };
      if (!current) {
        dispose();
        return;
      }
      release = dispose;
      // Every failure path returns the token; only 8 live natively, each for up to 30 minutes.
      const returnToken = (): void => {
        release?.();
        release = null;
      };
      frameTimerRef.current = setTimeout(() => {
        frameTimerRef.current = null;
        if (!current) return;
        returnToken();
        fail("previewFailed", new Error("The preview frame did not load in time."));
      }, frameTimeoutMs);
      ttlTimerRef.current = setTimeout(() => {
        ttlTimerRef.current = null;
        if (!current) return;
        returnToken();
        fail("expired", new Error("The preview token expired."));
      }, previewTtlMs);
      setState({ kind: "ready", metadata, url: prepared.value.url, frame: "pending" });
    })();
    return () => {
      current = false;
      clearTimers();
      release?.();
    };
  }, [clearTimers, fail, frameTimeoutMs, generation, loader, owner, path, preview, previewTtlMs]);

  return { state, retry, notifyFrameLoaded };
}
