import { CircleX, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import type {
  StatusBarItemVisibility,
} from "../domain/settings";
import type { IntelligenceMode } from "../domain/workspace";

interface StatusBarProps {
  activeLanguage: string | null;
  activePath: string | null;
  dirtyCount: number;
  errorCount?: number;
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
  onShowProblems?(): void;
}

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
  { key: "dirtyCount", label: "Unsaved files" },
  { key: "message", label: "Messages" },
];

export function StatusBar({
  activeLanguage,
  activePath,
  dirtyCount,
  errorCount = 0,
  ideActivityLabel,
  ideActivityState,
  intelligenceMode,
  message,
  onChangeVisibility,
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
  const activePathLabel = useMemo(
    () => activePathStatusLabel(workspaceRoot, activePath),
    [activePath, workspaceRoot],
  );

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
        style={{
          alignItems: "center",
          background: "transparent",
          border: "none",
          color: "inherit",
          cursor: "pointer",
          display: "inline-flex",
          font: "inherit",
          gap: 4,
          padding: "0 12px",
        }}
        title={problemsTitle}
        type="button"
      >
        <CircleX aria-hidden="true" size={13} />
        {errorCount}
        <TriangleAlert aria-hidden="true" size={13} />
        {warningCount}
      </button>
      {statusBar.activePath ? (
        <span title={activePathLabel}>
          {activePathLabel}
        </span>
      ) : null}
      {statusBar.workspaceInfo && workspaceInfoLabel ? (
        <span title={workspaceInfoLabel}>{workspaceInfoLabel}</span>
      ) : null}
      {(statusBar.index || statusBar.languageServer) && ideActivityLabel ? (
        <span
          className={`status-ide-activity ${ideActivityState ?? "idle"}`}
          title={ideActivityLabel}
        >
          {ideActivityLabel}
        </span>
      ) : null}
      {statusBar.workspaceTrust && workspaceTrustLabel ? (
        <span>{workspaceTrustLabel}</span>
      ) : null}
      {statusBar.mode ? (
        <span className="status-mode">{formatMode(intelligenceMode)}</span>
      ) : null}
      {statusBar.language && activeLanguage ? <span>{activeLanguage}</span> : null}
      {statusBar.dirtyCount && dirtyCount > 0 ? (
        <span>{dirtyCount} unsaved</span>
      ) : null}
      {statusBar.message && message ? (
        <span className="status-message">{message}</span>
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

export type IdeActivityState = "active" | "idle" | "problem" | "scanning";

function pluralize(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
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
