import { ShieldCheck, Terminal, X } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { TerminalProfile } from "../domain/terminal";
import { workspaceRelativePath } from "../domain/pathDerivation";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { WorkbenchPanelProps } from "./workbenchPanelViews";

export type BottomPanelProps = BottomPanelVisibility &
  Pick<
    WorkbenchPanelProps,
    | "onClose"
    | "onOpenProblem"
    | "onResizeStart"
    | "onRevealDirectoryInTree"
    | "onTerminalSessionReady"
    | "onTrustWorkspace"
    | "providerSignIn"
    | "terminalGateway"
    | "terminalOwnerKey"
    | "terminalShellIntegrationEnabled"
    | "terminalTheme"
    | "workspaceRoot"
    | "workspaceTrusted"
  >;

interface BottomPanelVisibility {
  readonly hidden?: boolean;
}

const LazyTerminalTabsPanel = lazy(() =>
  import("./TerminalTabsPanel").then((module) => ({
    default: module.TerminalTabsPanel,
  })),
);

export function BottomPanel({
  hidden = false,
  onClose,
  onOpenProblem,
  onResizeStart,
  onRevealDirectoryInTree,
  onTerminalSessionReady,
  onTrustWorkspace,
  providerSignIn,
  terminalGateway,
  terminalOwnerKey = null,
  terminalShellIntegrationEnabled,
  terminalTheme,
  workspaceRoot,
  workspaceTrusted,
}: BottomPanelProps) {
  const [terminalProfiles, setTerminalProfiles] = useState<TerminalProfile[]>([]);
  const [selectedTerminalProfileId, setSelectedTerminalProfileId] = useState<string | null>(null);
  const [terminalCwd, setTerminalCwd] = useState<string | null>(null);
  const [terminalToolbarHost, setTerminalToolbarHost] = useState<HTMLDivElement | null>(null);
  const workspaceRootRef = useRef(workspaceRoot);
  workspaceRootRef.current = workspaceRoot;

  useEffect(() => {
    setTerminalCwd(null);
  }, [selectedTerminalProfileId, workspaceRoot]);

  useEffect(() => {
    let cancelled = false;

    terminalGateway
      .listProfiles()
      .then((profiles) => {
        if (cancelled) {
          return;
        }

        setTerminalProfiles(profiles);
        setSelectedTerminalProfileId((current) => {
          if (profiles.some((profile) => profile.id === current)) {
            return current;
          }

          return profiles[0]?.id ?? null;
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setTerminalProfiles([]);
        setSelectedTerminalProfileId(null);
      });

    return () => {
      cancelled = true;
    };
  }, [terminalGateway]);

  return (
    <section
      aria-label="Panel"
      className="bottom-panel bottom-panel--agent"
      data-active-view="terminal"
      hidden={hidden}
      style={{ "--terminal-surface-background": terminalTheme.background } as CSSProperties}
    >
      <div
        aria-label="Resize panel"
        aria-orientation="horizontal"
        className="bottom-panel-resize-handle"
        onPointerDown={onResizeStart}
        role="separator"
      />
      <header className="bottom-panel-header">
        <div className="bottom-panel-header__leading">
          <span className="bottom-panel-terminal-title">
            <Terminal aria-hidden="true" size={14} />
            Terminal
          </span>
        </div>
        {workspaceRoot && !workspaceTrusted ? (
          <button
            className="bottom-panel-text-action"
            onClick={onTrustWorkspace}
            title="Trust workspace"
            type="button"
          >
            <ShieldCheck aria-hidden="true" size={14} />
            Trust
          </button>
        ) : null}
        {terminalCwd &&
        workspaceRoot &&
        onRevealDirectoryInTree &&
        workspaceRelativePath(workspaceRoot, terminalCwd) !== null ? (
          <button
            aria-label={`Reveal ${terminalCwd} in file tree`}
            className="bottom-panel-text-action bottom-panel-terminal-cwd"
            onClick={() => onRevealDirectoryInTree(terminalCwd)}
            title={terminalCwd}
            type="button"
          >
            {terminalCwd}
          </button>
        ) : terminalCwd ? (
          <span className="bottom-panel-subtitle bottom-panel-terminal-cwd" title={terminalCwd}>
            {terminalCwd}
          </span>
        ) : null}
        {terminalProfiles.length > 0 ? (
          <select
            aria-label="Terminal profile"
            className="terminal-profile-select"
            onChange={(event) => setSelectedTerminalProfileId(event.target.value)}
            value={selectedTerminalProfileId ?? ""}
          >
            {terminalProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label}
              </option>
            ))}
          </select>
        ) : null}
        <div className="bottom-panel-terminal-toolbar" ref={setTerminalToolbarHost} />
        <button
          aria-label="Hide panel"
          className="bottom-panel-action bottom-panel-hide"
          onClick={onClose}
          title="Hide panel"
          type="button"
        >
          <X aria-hidden="true" size={14} />
        </button>
      </header>
      <div className="bottom-panel-body">
        <Suspense
          fallback={<div aria-label="Terminal" className="terminal-panel" role="tabpanel" />}
        >
          <LazyTerminalTabsPanel
            isActive={!hidden}
            key={terminalTabsOwnerKey(terminalOwnerKey, workspaceRoot)}
            onActiveCwdChange={setTerminalCwd}
            onActiveProfileChange={(profileId) =>
              setSelectedTerminalProfileId(profileId ?? terminalProfiles[0]?.id ?? null)
            }
            onOpenLink={(path, line, column) => {
              const requestedRoot = workspaceRoot;

              if (!requestedRoot) {
                return;
              }

              if (!workspaceRootKeysEqual(workspaceRootRef.current, requestedRoot)) {
                return;
              }

              const position = {
                column: column ?? 1,
                lineNumber: line ?? 1,
              };
              return onOpenProblem({
                id: `terminal:${path}:${position.lineNumber}:${position.column}`,
                message: path,
                navigationTarget: {
                  path,
                  range: { end: position, start: position },
                },
                severity: "info",
                source: "Terminal",
              });
            }}
            onActiveSessionReady={onTerminalSessionReady}
            ownerKey={terminalTabsOwnerKey(terminalOwnerKey, workspaceRoot)}
            profileId={selectedTerminalProfileId}
            profileLabel={
              terminalProfiles.find(({ id }) => id === selectedTerminalProfileId)?.label ?? null
            }
            shellIntegrationEnabled={terminalShellIntegrationEnabled}
            rootPath={workspaceRoot}
            terminalGateway={terminalGateway}
            terminalTheme={terminalTheme}
            toolbarHost={terminalToolbarHost}
            providerSignIn={providerSignIn}
          />
        </Suspense>
      </div>
    </section>
  );
}

function terminalTabsOwnerKey(ownerKey: string | null, rootPath: string | null): string {
  return ownerKey && rootPath ? JSON.stringify([ownerKey, rootPath]) : "no-workspace";
}
