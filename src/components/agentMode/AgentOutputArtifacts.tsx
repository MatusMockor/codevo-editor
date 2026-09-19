import {
  ChevronDown,
  FileCode2,
  FileText,
  Image as ImageIcon,
  type LucideIcon,
} from "lucide-react";
import { createContext, useContext, useId, useState, type ReactNode } from "react";
import type {
  AgentArtifactFailureReporter,
  AgentArtifactFilePort,
  AgentArtifactLoader,
  AgentArtifactOwner,
  AgentArtifactPreviewPort,
} from "../../application/agentArtifactPorts";
import {
  AGENT_ARTIFACT_REFERENCE_LIMIT,
  type AgentArtifactReference,
} from "../../domain/agentArtifact";
import { AgentArtifactFileActions } from "./AgentArtifactFileActions";
import { AgentArtifactPreview } from "./AgentArtifactPreview";
import "./agentOutputArtifacts.css";

export interface AgentOutputArtifactsProps {
  readonly owner: AgentArtifactOwner;
  readonly references: readonly AgentArtifactReference[];
  readonly loader: AgentArtifactLoader;
  readonly preview: AgentArtifactPreviewPort;
  readonly files?: AgentArtifactFilePort | null;
  readonly reportError?: AgentArtifactFailureReporter | null;
  readonly frameTimeoutMs?: number;
  readonly previewTtlMs?: number;
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

export function AgentOutputArtifacts(props: AgentOutputArtifactsProps) {
  // Remounting prevents prior generations (including A → B → A) from publishing.
  return <ArtifactList key={JSON.stringify(props.owner)} {...props} />;
}

function ArtifactList({
  owner,
  references,
  loader,
  preview,
  files = null,
  reportError = null,
  frameTimeoutMs,
  previewTtlMs,
}: AgentOutputArtifactsProps) {
  const [capturedOwner] = useState(owner);
  const selection = useContext(PreviewSelection);
  const identity = useId();
  const selected = selection?.selected?.startsWith(`${identity}:`)
    ? selection.selected.slice(identity.length + 1)
    : null;
  const visible = references.slice(0, AGENT_ARTIFACT_REFERENCE_LIMIT);
  if (visible.length === 0 || selection === null) return null;
  const select = selection.select;
  return (
    <section aria-label="Generated files" className="agent-artifacts">
      <ul className="agent-artifacts__list">
        {visible.map((reference) => (
          <ArtifactRow
            expanded={selected === reference.path}
            files={files}
            frameTimeoutMs={frameTimeoutMs}
            key={reference.path}
            loader={loader}
            onToggle={() =>
              select(selected === reference.path ? null : `${identity}:${reference.path}`)
            }
            owner={capturedOwner}
            preview={preview}
            previewTtlMs={previewTtlMs}
            reference={reference}
            reportError={reportError}
          />
        ))}
      </ul>
    </section>
  );
}

function ArtifactRow({
  expanded,
  files,
  frameTimeoutMs,
  loader,
  onToggle,
  owner,
  preview,
  previewTtlMs,
  reference,
  reportError,
}: {
  readonly expanded: boolean;
  readonly files: AgentArtifactFilePort | null;
  readonly frameTimeoutMs: number | undefined;
  readonly loader: AgentArtifactLoader;
  readonly onToggle: () => void;
  readonly owner: AgentArtifactOwner;
  readonly preview: AgentArtifactPreviewPort;
  readonly previewTtlMs: number | undefined;
  readonly reference: AgentArtifactReference;
  readonly reportError: AgentArtifactFailureReporter | null;
}) {
  const rowId = useId();
  const buttonId = `${rowId}-toggle`;
  const panelId = `${rowId}-panel`;
  const Icon = artifactIcon(reference.path);
  return (
    <li className="agent-artifacts__item">
      <div className="agent-artifacts__row">
        <button
          aria-controls={panelId}
          aria-expanded={expanded}
          className="agent-artifacts__chip"
          data-agent-artifact-path={reference.path}
          id={buttonId}
          onClick={onToggle}
          type="button"
        >
          <Icon aria-hidden="true" className="agent-artifacts__glyph" size={14} />
          <span className="agent-artifacts__name">{reference.label}</span>
          <span className="agent-artifacts__verb">Preview</span>
          <ChevronDown aria-hidden="true" className="agent-artifacts__chevron" size={14} />
        </button>
        <AgentArtifactFileActions
          files={files}
          owner={owner}
          path={reference.path}
          reasonId={`${rowId}-reason`}
        />
      </div>
      <div
        aria-labelledby={buttonId}
        className="agent-artifacts__panel"
        hidden={!expanded}
        id={panelId}
        role="region"
      >
        {expanded && (
          <AgentArtifactPreview
            frameTimeoutMs={frameTimeoutMs}
            loader={loader}
            owner={owner}
            path={reference.path}
            preview={preview}
            previewTtlMs={previewTtlMs}
            reportError={reportError}
          />
        )}
      </div>
    </li>
  );
}

function artifactIcon(path: string): LucideIcon {
  if (/\.html?$/i.test(path)) return FileCode2;
  if (/\.(?:png|jpe?g|webp)$/i.test(path)) return ImageIcon;
  return FileText;
}
