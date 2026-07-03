import { CircleX, GitBranch, TriangleAlert } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
import type {
  StatusBarItemVisibility,
} from "../domain/settings";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { IntelligenceMode } from "../domain/workspace";

interface StatusBarProps {
  activeLanguage: string | null;
  activePath: string | null;
  cursorPosition?: EditorPosition | null;
  dirtyCount: number;
  errorCount?: number;
  gitBranch?: string | null;
  /**
   * Compact label naming the repository whose branch is shown, when the active
   * file lives in a nested repository (PhpStorm directory mapping). `null` for
   * the primary/single repository, which shows the branch bare, as before.
   */
  gitBranchRepositoryLabel?: string | null;
  ideActivityDetail?: string | null;
  ideActivityLabel: string | null;
  ideActivityState: IdeActivityState | null;
  intelligenceMode: IntelligenceMode;
  message: string | null;
  statusBar: StatusBarItemVisibility;
  warningCount?: number;
  workspaceInfoLabel: string | null;
  workspaceRoot: string | null;
  workspaceTrustLabel: string | null;
  onChangeVisibility(
    key: keyof StatusBarItemVisibility,
    visible: boolean,
  ): void;
  onOpenRuntimePanel?(): void;
  onShowGitBranches?(): void;
  onShowGoToLine?(): void;
  onShowProblems?(): void;
}

// Shared chrome for the clickable status-bar entries (problems, git branch,
// cursor position). Transparent so it inherits the theme-aware footer colours
// (no hard-coded palette), and laid out inline-flex with a small gap so an icon
// and its label sit together like the existing problems affordance.
const statusButtonStyle: CSSProperties = {
  alignItems: "center",
  background: "transparent",
  border: "none",
  color: "inherit",
  cursor: "pointer",
  display: "inline-flex",
  font: "inherit",
  gap: 4,
  padding: "0 12px",
};

// Transient status-bar text ("Saved User.php", "Stashed working tree changes",
// ...) comes from ~140 one-shot action call sites in the workbench controller
// with no self-clearing timer of their own, so without this it lingers until
// some *unrelated* later action happens to overwrite or clear it - stale,
// misleading chrome (e.g. a diff-preview message still showing minutes later).
// Auto-hiding here, the sole consumer of the `message` prop, keeps every call
// site simple: set the text, forget it.
const STATUS_MESSAGE_AUTO_HIDE_MS = 5000;

const statusBarItems: Array<{
  key: keyof StatusBarItemVisibility;
  label: string;
}> = [
  { key: "activePath", label: "File path" },
  { key: "workspaceInfo", label: "Project info" },
  { key: "index", label: "Index" },
  { key: "languageServer", label: "IDE engine" },
  { key: "workspaceTrust", label: "Trust" },
  { key: "mode", label: "Mode" },
  { key: "language", label: "Language" },
  { key: "cursorPosition", label: "Cursor position" },
  { key: "gitBranch", label: "Git branch" },
  { key: "dirtyCount", label: "Unsaved files" },
  { key: "message", label: "Messages" },
];

function StatusBarComponent({
  activeLanguage,
  activePath,
  cursorPosition = null,
  dirtyCount,
  errorCount = 0,
  gitBranch = null,
  gitBranchRepositoryLabel = null,
  ideActivityDetail = null,
  ideActivityLabel,
  ideActivityState,
  intelligenceMode,
  message,
  onChangeVisibility,
  onOpenRuntimePanel,
  onShowGitBranches,
  onShowGoToLine,
  onShowProblems,
  statusBar,
  warningCount = 0,
  workspaceInfoLabel,
  workspaceRoot,
  workspaceTrustLabel,
}: StatusBarProps) {
  const [menuPosition, setMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [visibleMessage, setVisibleMessage] = useState(message);
  const activePathLabel = useMemo(
    () => activePathStatusLabel(workspaceRoot, activePath),
    [activePath, workspaceRoot],
  );

  useEffect(() => {
    setVisibleMessage(message);

    if (!message) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setVisibleMessage(null);
    }, STATUS_MESSAGE_AUTO_HIDE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [message]);

  useEffect(() => {
    if (!menuPosition) {
      return;
    }

    const closeMenu = () => setMenuPosition(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("mousedown", closeMenu);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", closeMenu);

    return () => {
      window.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", closeMenu);
    };
  }, [menuPosition]);

  const openMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setMenuPosition({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 210)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 300)),
    });
  };

  const problemsTitle =
    errorCount === 0 && warningCount === 0
      ? "No problems"
      : `${errorCount} ${pluralize(errorCount, "error")}, ${warningCount} ${pluralize(warningCount, "warning")}`;

  return (
    <footer className="status-bar" onContextMenu={openMenu}>
      <button
        aria-label={problemsTitle}
        className="status-problems"
        onClick={onShowProblems}
        style={statusButtonStyle}
        title={problemsTitle}
        type="button"
      >
        <CircleX aria-hidden="true" size={13} />
        {errorCount}
        <TriangleAlert aria-hidden="true" size={13} />
        {warningCount}
      </button>
      {statusBar.gitBranch && gitBranch ? (
        <button
          aria-label={gitBranchTitle(gitBranch, gitBranchRepositoryLabel)}
          className="status-git-branch"
          onClick={onShowGitBranches}
          style={statusButtonStyle}
          title={gitBranchTitle(gitBranch, gitBranchRepositoryLabel)}
          type="button"
        >
          <GitBranch aria-hidden="true" size={13} />
          {gitBranchLabel(gitBranch, gitBranchRepositoryLabel)}
        </button>
      ) : null}
      {statusBar.activePath ? (
        <span title={activePathLabel}>
          {activePathLabel}
        </span>
      ) : null}
      {statusBar.workspaceInfo && workspaceInfoLabel ? (
        <span title={workspaceInfoLabel}>{workspaceInfoLabel}</span>
      ) : null}
      {(statusBar.index || statusBar.languageServer) && ideActivityLabel ? (
        <button
          aria-label={ideActivityLabel}
          className={`status-ide-activity ${ideActivityState ?? "idle"}`}
          onClick={onOpenRuntimePanel}
          style={statusButtonStyle}
          title={ideActivityTitle(ideActivityLabel, ideActivityDetail)}
          type="button"
        >
          <span
            aria-hidden="true"
            className={`status-ide-activity-dot ${ideActivityState ?? "idle"}`}
          />
          {ideActivityLabel}
        </button>
      ) : null}
      {statusBar.workspaceTrust && workspaceTrustLabel ? (
        <span>{workspaceTrustLabel}</span>
      ) : null}
      {statusBar.mode ? (
        <span className="status-mode">{formatMode(intelligenceMode)}</span>
      ) : null}
      {statusBar.cursorPosition && cursorPosition ? (
        <button
          aria-label={cursorPositionLabel(cursorPosition)}
          className="status-cursor-position"
          onClick={onShowGoToLine}
          style={statusButtonStyle}
          title="Go to Line/Column"
          type="button"
        >
          {cursorPositionLabel(cursorPosition)}
        </button>
      ) : null}
      {statusBar.language && activeLanguage ? <span>{activeLanguage}</span> : null}
      {statusBar.dirtyCount && dirtyCount > 0 ? (
        <span>{dirtyCount} unsaved</span>
      ) : null}
      {statusBar.message && visibleMessage ? (
        <span className="status-message">{visibleMessage}</span>
      ) : null}

      {menuPosition ? (
        <div
          className="status-bar-menu"
          onMouseDown={(event) => event.stopPropagation()}
          role="menu"
          style={{
            left: menuPosition.x,
            top: menuPosition.y,
          }}
        >
          {statusBarItems.map((item) => (
            <label className="status-bar-menu-item" key={item.key} role="menuitemcheckbox">
              <input
                checked={statusBar[item.key]}
                onChange={(event) =>
                  onChangeVisibility(item.key, event.currentTarget.checked)
                }
                type="checkbox"
              />
              <span>{item.label}</span>
            </label>
          ))}
        </div>
      ) : null}
    </footer>
  );
}

export const StatusBar = memo(StatusBarComponent);

export type IdeActivityState = "active" | "idle" | "problem" | "scanning";

// The headline label plus an optional per-runtime mini-overview (PHPactor/TS
// Server/Index lines), so hovering the chip shows what is actually running for
// the active project without opening the Runtime panel.
function ideActivityTitle(
  label: string,
  detail: string | null,
): string {
  if (!detail) {
    return label;
  }

  return `${label}\n\n${detail}`;
}

function pluralize(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}

// A file in a nested repository (directory mapping) shows a compact
// `repo: branch` label so the branch is unambiguous; the primary/single repo
// shows the branch bare (pre-multi-repo look). The full context stays in the
// tooltip either way.
function gitBranchLabel(
  branch: string,
  repositoryLabel: string | null,
): string {
  if (!repositoryLabel) {
    return branch;
  }

  return `${repositoryLabel}: ${branch}`;
}

function gitBranchTitle(
  branch: string,
  repositoryLabel: string | null,
): string {
  if (!repositoryLabel) {
    return `Git branch: ${branch}`;
  }

  return `Git branch: ${branch} (${repositoryLabel})`;
}

function cursorPositionLabel(position: EditorPosition): string {
  return `Ln ${position.lineNumber}, Col ${position.column}`;
}

function formatMode(mode: IntelligenceMode): string {
  if (mode === "lightSmart") {
    return "Smart Index";
  }

  if (mode === "fullSmart") {
    return "IDE Mode";
  }

  return "Editor Mode";
}

function activePathStatusLabel(
  workspaceRoot: string | null,
  activePath: string | null,
): string {
  if (workspaceRoot && activePath) {
    return relativeWorkspacePath(workspaceRoot, activePath);
  }

  if (workspaceRoot) {
    return workspaceName(workspaceRoot);
  }

  return "No workspace";
}

function relativeWorkspacePath(workspaceRoot: string, path: string): string {
  const normalizedRoot = normalizePath(workspaceRoot).replace(/\/+$/, "");
  const normalizedPath = normalizePath(path);
  const rootPrefix = `${normalizedRoot}/`;

  if (normalizedPath === normalizedRoot) {
    return workspaceName(workspaceRoot);
  }

  if (normalizedPath.startsWith(rootPrefix)) {
    return normalizedPath.slice(rootPrefix.length);
  }

  return normalizedPath.split("/").slice(-2).join("/");
}

function workspaceName(path: string): string {
  const normalized = normalizePath(path).replace(/\/+$/, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

function normalizePath(path: string): string {
  return path.split("\\").join("/");
}
