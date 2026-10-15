import {
  ArrowLeft,
  ClipboardCopy,
  Code2,
  Eye,
  FolderTree,
  Link2,
  RefreshCw,
  WrapText,
} from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import {
  useAgentFilePreview,
  type AgentFilePreviewState,
} from "../../../../application/rightPanel/useAgentFilePreview";
import {
  agentFileViewerDocumentKey,
  type AgentFileViewerDocument,
  type AgentFileViewerMarkdownMode,
  type AgentFileViewerTarget,
} from "../../../../application/rightPanel/useAgentFileViewerSessions";
import { codeLanguageForPath } from "../../../../domain/codeHighlight/codeLanguage";
import { IconButton } from "../../../../ui/foundation/IconButton";
import { FileViewerPreviewBody } from "./FileViewerPreviewBody";
import { fileViewerCrumbs } from "./fileViewerModel";
import { useFileViewerWrap } from "./useFileViewerWrap";
import "./fileViewer.css";

export const FILE_VIEWER_UNAVAILABLE_MESSAGE = "File preview is unavailable.";
export const FILE_VIEWER_EXTERNAL_NOTE =
  "Read-only snapshot of a file outside this project's files.";
const COPY_NOTICE_MS = 1_500;

export interface AgentFileViewerTreeToggle {
  readonly shown: boolean;
  onToggle(): void;
}

export interface AgentFileViewerProps {
  readonly owner: string | null;
  readonly target: AgentFileViewerTarget;
  readonly refreshKey: number;
  readonly treeToggle: AgentFileViewerTreeToggle | null;
  onBack(): void;
  onRefresh(): void;
  onRevealDirectory(directory: string): void;
  onMarkdownModeChange(mode: AgentFileViewerMarkdownMode): void;
  onScrollTopChange(target: AgentFileViewerTarget, scrollTop: number): void;
  copyText(text: string): Promise<void>;
}

export function AgentFileViewer(props: AgentFileViewerProps) {
  const { target } = props;
  const document = target.document;
  const workspace = document.kind === "workspace" ? document : null;
  const fetched = useAgentFilePreview({
    owner: props.owner,
    root: workspace?.root ?? null,
    relativePath: workspace?.relativePath ?? null,
    refreshKey: props.refreshKey,
  });
  const state: AgentFilePreviewState =
    document.kind === "external"
      ? { kind: "loaded", preview: document.preview, refreshing: false }
      : fetched;
  const [wrap, toggleWrap] = useFileViewerWrap();
  const [notice, setNotice] = useState<string | null>(null);
  const label = documentLabel(document);
  const language = codeLanguageForPath(label);
  const markdown = language === "markdown";
  const markdownMode = target.markdownMode;
  const preview = state.kind === "loaded" ? state.preview : null;
  const copyable = preview?.kind === "text" && !preview.truncated ? preview.contents : null;

  useEffect(() => {
    if (notice === null) return undefined;
    const timer = setTimeout(() => setNotice(null), COPY_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const copy = (text: string, done: string) => {
    props.copyText(text).then(
      () => setNotice(done),
      () => setNotice("Copy failed."),
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    props.onBack();
  };

  return (
    <section
      aria-label={`File ${label}`}
      className="cv-file-viewer"
      data-file-viewer-document={document.kind}
      data-file-viewer-path={label}
      onKeyDown={onKeyDown}
    >
      <header className="cv-rp-sub cv-file-viewer__head">
        <IconButton
          icon={<ArrowLeft size={14} />}
          label="Back to files"
          onClick={props.onBack}
          size="xs"
        />
        <FileViewerCrumbs document={document} onRevealDirectory={props.onRevealDirectory} />
        <div className="cv-rp-sub__tools">
          {notice !== null && (
            <span className="cv-file-viewer__notice" role="status">
              {notice}
            </span>
          )}
          {props.treeToggle !== null && (
            <IconButton
              icon={<FolderTree size={14} />}
              label={props.treeToggle.shown ? "Hide file tree" : "Show file tree"}
              onClick={props.treeToggle.onToggle}
              pressed={props.treeToggle.shown}
              size="xs"
            />
          )}
          {markdown && (
            <IconButton
              icon={markdownMode === "rendered" ? <Code2 size={14} /> : <Eye size={14} />}
              label={
                markdownMode === "rendered" ? "Show Markdown source" : "Show rendered Markdown"
              }
              onClick={() =>
                props.onMarkdownModeChange(markdownMode === "rendered" ? "source" : "rendered")
              }
              size="xs"
            />
          )}
          <IconButton
            icon={<WrapText size={14} />}
            label="Wrap lines"
            onClick={toggleWrap}
            pressed={wrap}
            size="xs"
          />
          <IconButton
            icon={<Link2 size={14} />}
            label="Copy path"
            onClick={() => copy(absolutePath(document), "Path copied.")}
            size="xs"
          />
          <IconButton
            disabled={copyable === null}
            icon={<ClipboardCopy size={14} />}
            label="Copy contents"
            onClick={() => {
              if (copyable !== null) copy(copyable, "Contents copied.");
            }}
            size="xs"
          />
          {workspace !== null && (
            <IconButton
              icon={<RefreshCw size={14} />}
              label="Reload file"
              onClick={props.onRefresh}
              size="xs"
            />
          )}
        </div>
      </header>
      {document.kind === "external" && (
        <p className="cv-file-viewer__note" role="note">
          {FILE_VIEWER_EXTERNAL_NOTE}
        </p>
      )}
      <div className="cv-file-viewer__body" data-file-viewer-state={state.kind}>
        {state.kind === "unavailable" && (
          <p className="cv-file-viewer__state">{FILE_VIEWER_UNAVAILABLE_MESSAGE}</p>
        )}
        {state.kind === "loading" && (
          <p className="cv-file-viewer__state" role="status">
            Loading file…
          </p>
        )}
        {state.kind === "failed" && (
          <p className="cv-file-viewer__state cv-file-viewer__state--error" role="alert">
            {state.message}
          </p>
        )}
        {preview !== null && (
          <FileViewerPreviewBody
            key={agentFileViewerDocumentKey(document)}
            language={language}
            markdownMode={markdown ? markdownMode : null}
            onScrollTopChange={(scrollTop) => props.onScrollTopChange(target, scrollTop)}
            preview={preview}
            target={target}
            wrap={wrap}
          />
        )}
      </div>
    </section>
  );
}

function FileViewerCrumbs({
  document,
  onRevealDirectory,
}: {
  readonly document: AgentFileViewerDocument;
  onRevealDirectory(directory: string): void;
}) {
  if (document.kind === "external") {
    return (
      <nav aria-label="File path" className="cv-file-viewer__crumbs">
        <span aria-current="page" className="cv-file-viewer__crumb-current" title={document.path}>
          {document.path}
        </span>
      </nav>
    );
  }
  return (
    <nav aria-label="File path" className="cv-file-viewer__crumbs">
      {fileViewerCrumbs(document.root, document.relativePath).map((crumb, index) => {
        const directory = crumb.directory;
        const key = `${index}:${crumb.label}`;
        if (directory === null) {
          return (
            <span aria-current="page" className="cv-file-viewer__crumb-current" key={key}>
              {crumb.label}
            </span>
          );
        }
        return (
          <button
            className="cv-file-viewer__crumb"
            key={key}
            onClick={() => onRevealDirectory(directory)}
            title={directory}
            type="button"
          >
            {crumb.label}
          </button>
        );
      })}
    </nav>
  );
}

function documentLabel(document: AgentFileViewerDocument): string {
  return document.kind === "external" ? document.path : document.relativePath;
}

function absolutePath(document: AgentFileViewerDocument): string {
  if (document.kind === "external") return document.path;
  const root = document.root.endsWith("/") ? document.root.slice(0, -1) : document.root;
  return `${root}/${document.relativePath}`;
}
