import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AgentArtifactLoader,
  AgentArtifactOwner,
  AgentArtifactPreviewPort,
} from "../../application/agentArtifactPorts";
import {
  AGENT_ARTIFACT_REFERENCE_LIMIT,
  agentArtifactByteLimit,
  type AgentArtifactMetadata,
  type AgentArtifactReference,
} from "../../domain/agentArtifact";
import "./agentOutputArtifacts.css";

export interface AgentOutputArtifactsProps {
  readonly owner: AgentArtifactOwner;
  readonly references: readonly AgentArtifactReference[];
  readonly loader: AgentArtifactLoader;
  readonly preview: AgentArtifactPreviewPort;
}

const PreviewSelection = createContext<{
  readonly selected: string | null;
  readonly select: (value: string | null) => void;
} | null>(null);

/** One retained image or live HTML frame across the entire transcript. */
export function AgentArtifactPreviewScope({ children }: { readonly children: ReactNode }) {
  const [selected, select] = useState<string | null>(null);
  return (
    <PreviewSelection.Provider value={{ selected, select }}>{children}</PreviewSelection.Provider>
  );
}

type PreviewState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly metadata: AgentArtifactMetadata; readonly url: string };

export function AgentOutputArtifacts(props: AgentOutputArtifactsProps) {
  // Remounting prevents prior generations (including A → B → A) from publishing.
  return <ArtifactList key={JSON.stringify(props.owner)} {...props} />;
}

function ArtifactList({ owner, references, loader, preview }: AgentOutputArtifactsProps) {
  const [capturedOwner] = useState(owner);
  const selection = useContext(PreviewSelection);
  const identity = useId();
  const selected = selection?.selected?.startsWith(`${identity}:`)
    ? selection.selected.slice(identity.length + 1)
    : null;
  const setSelected = (path: string | null) =>
    selection?.select(path === null ? null : `${identity}:${path}`);
  const visible = references.slice(0, AGENT_ARTIFACT_REFERENCE_LIMIT);
  if (visible.length === 0 || selection === null) return null;
  return (
    <section aria-label="Generated files" className="agent-artifacts">
      <div className="agent-artifacts__list">
        {visible.map((reference) => (
          <button
            aria-pressed={selected === reference.path}
            key={reference.path}
            onClick={() => setSelected(selected === reference.path ? null : reference.path)}
            type="button"
          >
            {reference.label}
          </button>
        ))}
      </div>
      {selected !== null && visible.some((reference) => reference.path === selected) && (
        <ArtifactPreview
          key={selected}
          loader={loader}
          owner={capturedOwner}
          path={selected}
          preview={preview}
        />
      )}
    </section>
  );
}

function ArtifactPreview({
  owner,
  loader,
  path,
  preview,
}: {
  readonly owner: AgentArtifactOwner;
  readonly loader: AgentArtifactLoader;
  readonly preview: AgentArtifactPreviewPort;
  readonly path: string;
}) {
  const [state, setState] = useState<PreviewState>({ kind: "loading" });
  useEffect(() => {
    let current = true;
    let cleanup: (() => void) | null = null;
    setState({ kind: "loading" });
    void (async () => {
      try {
        const metadata = await loader.resolve(owner, path);
        if (!current) return;
        if (metadata.sizeBytes > agentArtifactByteLimit(metadata.mediaType))
          throw new Error("Size");
        const bytes = await loader.read(owner, metadata.id);
        if (!current) return;
        if (bytes.byteLength !== metadata.sizeBytes) throw new Error("Size mismatch");
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        if (!current) return;
        const hash = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        if (hash !== metadata.sha256) throw new Error("Content changed");
        let url: string;
        if (metadata.mediaType === "text/html") {
          const prepared = await preview.prepare(bytes);
          const dispose = () => {
            void prepared.dispose().catch(() => undefined);
          };
          if (!current) {
            dispose();
            return;
          }
          cleanup = dispose;
          url = prepared.url;
        } else {
          url = URL.createObjectURL(new Blob([bytes], { type: metadata.mediaType }));
          cleanup = () => URL.revokeObjectURL(url);
        }
        setState({ kind: "ready", metadata, url });
      } catch {
        if (current) setState({ kind: "error" });
      }
    })();
    return () => {
      current = false;
      cleanup?.();
    };
  }, [loader, owner, path, preview]);

  if (state.kind === "loading") return <p role="status">Loading preview…</p>;
  if (state.kind === "error") return <p role="status">This file could not be previewed.</p>;
  return state.metadata.mediaType === "text/html" ? (
    <div className="agent-artifacts__html">
      <p>Interactive preview · network access is disabled.</p>
      <iframe sandbox="allow-scripts" src={state.url} title={`Preview of ${state.metadata.name}`} />
    </div>
  ) : (
    <ArtifactImage name={state.metadata.name} url={state.url} />
  );
}

function ArtifactImage({ name, url }: { readonly name: string; readonly url: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    dialogRef.current?.close();
    triggerRef.current?.focus();
  };
  return (
    <>
      <button
        aria-label={`Enlarge ${name}`}
        className="agent-artifacts__image"
        onClick={() => dialogRef.current?.showModal()}
        ref={triggerRef}
        type="button"
      >
        <img alt={name} src={url} />
      </button>
      <dialog aria-label={name} className="agent-artifacts__dialog" ref={dialogRef}>
        <button aria-label="Close image preview" onClick={close} type="button">
          Close
        </button>
        <img alt={name} src={url} />
      </dialog>
    </>
  );
}
