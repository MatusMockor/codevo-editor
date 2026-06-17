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
  indexLabel: string | null;
  intelligenceMode: IntelligenceMode;
  languageServerLabel: string | null;
  message: string | null;
  statusBar: StatusBarItemVisibility;
  workspaceInfoLabel: string | null;
  workspaceRoot: string | null;
  workspaceTrustLabel: string | null;
  onChangeVisibility(
    key: keyof StatusBarItemVisibility,
    visible: boolean,
  ): void;
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
  indexLabel,
  intelligenceMode,
  languageServerLabel,
  message,
  onChangeVisibility,
  statusBar,
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

  return (
    <footer className="status-bar" onContextMenu={openMenu}>
      {statusBar.activePath ? (
        <span title={activePathLabel}>
          {activePathLabel}
        </span>
      ) : null}
      {statusBar.workspaceInfo && workspaceInfoLabel ? (
        <span title={workspaceInfoLabel}>{workspaceInfoLabel}</span>
      ) : null}
      {statusBar.index && indexLabel ? <span>{indexLabel}</span> : null}
      {statusBar.languageServer && languageServerLabel ? (
        <span>{languageServerLabel}</span>
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
