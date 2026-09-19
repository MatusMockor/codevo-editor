import { FolderOpen, Link2 } from "lucide-react";
import type { RemoteProjectSourceKind } from "../../../domain/repositoryLookup";
import { remoteAddProjectSourceRetryable } from "./remoteAddProjectMessages";
import {
  remoteAddProjectRowClassName,
  type RemoteAddProjectSourceRow,
} from "./remoteAddProjectPresentation";

export interface RemoteAddProjectSourcesProps {
  readonly rows: readonly RemoteAddProjectSourceRow[];
  readonly activeIndex: number;
  readonly listboxId: string;
  readonly optionPrefix: string;
  onActivate(kind: RemoteProjectSourceKind): void;
  onHighlight(index: number): void;
  onRetry(): void;
}

export function RemoteAddProjectSources({
  activeIndex,
  listboxId,
  onActivate,
  onHighlight,
  onRetry,
  optionPrefix,
  rows,
}: RemoteAddProjectSourcesProps) {
  return (
    <>
      <div className="search-everywhere-section-label">Sources</div>
      <div
        aria-label="Sources"
        className="agent-remote-add-project__list"
        id={listboxId}
        role="listbox"
      >
        {rows.map((row, index) => (
          <button
            aria-disabled={row.availability.status !== "ready"}
            aria-selected={index === activeIndex}
            className={remoteAddProjectRowClassName(index === activeIndex)}
            id={`${optionPrefix}${index}`}
            key={row.kind}
            onClick={() => {
              if (row.availability.status !== "ready") return;
              onActivate(row.kind);
            }}
            onMouseEnter={() => onHighlight(index)}
            role="option"
            type="button"
          >
            <RemoteAddProjectSourceGlyph kind={row.kind} />
            <span>
              <strong>{row.title}</strong>
              <small>{row.reason ?? row.description}</small>
            </span>
            <RemoteAddProjectSourceState row={row} />
          </button>
        ))}
      </div>
      {rows.some(isRetryable) && (
        <button className="agent-linkbutton" onClick={onRetry} type="button">
          Retry
        </button>
      )}
    </>
  );
}

export function RemoteAddProjectSourceGlyph({ kind }: { readonly kind: RemoteProjectSourceKind }) {
  if (kind === "github") return <GitHubGlyph />;
  if (kind === "gitlab") return <GitLabGlyph />;
  if (kind === "gitUrl") return <Link2 aria-hidden="true" size={15} />;
  return <FolderOpen aria-hidden="true" size={15} />;
}

function RemoteAddProjectSourceState({ row }: { readonly row: RemoteAddProjectSourceRow }) {
  if (row.availability.status === "checking")
    return <span className="agent-remote-add-project__pending">Checking…</span>;
  if (row.availability.status === "unavailable" && !isRetryable(row))
    return <span className="agent-remote-add-project__chip">Setup required</span>;
  return <span className="agent-remote-add-project__meta" />;
}

function isRetryable(row: RemoteAddProjectSourceRow): boolean {
  if (row.availability.status !== "unavailable") return false;
  return remoteAddProjectSourceRetryable(row.availability.reason);
}

function GitHubGlyph() {
  return (
    <svg aria-hidden="true" fill="currentColor" height="15" viewBox="0 0 16 16" width="15">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function GitLabGlyph() {
  return (
    <svg aria-hidden="true" fill="currentColor" height="15" viewBox="0 0 16 16" width="15">
      <path d="M8 14.5 10.9 5.6H5.1z" opacity="0.95" />
      <path d="M8 14.5 5.1 5.6h-4zM8 14.5l2.9-8.9h4z" opacity="0.75" />
      <path
        d="M1.1 5.6.2 8.3c-.1.3 0 .5.2.7L8 14.5zM14.9 5.6l.9 2.7c.1.3 0 .5-.2.7L8 14.5z"
        opacity="0.55"
      />
      <path
        d="M1.1 5.6h4L3.4.4c-.1-.3-.5-.3-.6 0zM14.9 5.6h-4L12.6.4c.1-.3.5-.3.6 0z"
        opacity="0.95"
      />
    </svg>
  );
}
