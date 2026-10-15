import { ShieldCheck, Terminal, X } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import type { AgentProviderSignInSurface } from "../application/useAgentProviderSignIn";
import {
  cachedTerminalProfiles,
  loadTerminalProfiles,
} from "../application/terminalProfileCatalog";
import type { WorkbenchNotice } from "../domain/workbenchNotice";
import type { TerminalTheme } from "../domain/settings";
import type { TerminalGateway, TerminalProfile } from "../domain/terminal";
import { workspaceRelativePath } from "../domain/pathDerivation";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { LazyTerminalTabsPanel } from "./terminalTabsPanelChunk";

export interface BottomPanelProps {
  onClose(): void;
  onOpenProblem(notice: WorkbenchNotice): Promise<boolean>;
  onRevealDirectoryInTree?(path: string): void;
  onResizeStart(event: PointerEvent<HTMLDivElement>): void;
  onTerminalSessionReady?(sessionId: number | null): void;
  onTrustWorkspace(): void;
  providerSignIn?: AgentProviderSignInSurface;
  terminalGateway: TerminalGateway;
  terminalOwnerKey?: string | null;
  terminalShellIntegrationEnabled: boolean;
  terminalTheme: TerminalTheme;
  workspaceRoot: string | null;
  workspaceTrusted: boolean;
}

export function BottomPanel({
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
  const [terminalProfiles, setTerminalProfiles] = useState<readonly TerminalProfile[]>(
    () => cachedTerminalProfiles(terminalGateway) ?? [],
  );
  const [selectedTerminalProfileId, setSelectedTerminalProfileId] = useState<string | null>(() =>
    preferredTerminalProfileId(cachedTerminalProfiles(terminalGateway) ?? [], null),
  );
  const [terminalCwd, setTerminalCwd] = useState<string | null>(null);
  const [terminalToolbarHost, setTerminalToolbarHost] = useState<HTMLDivElement | null>(null);
  const workspaceRootRef = useRef(workspaceRoot);
  workspaceRootRef.current = workspaceRoot;

  useEffect(() => {
    setTerminalCwd(null);
  }, [selectedTerminalProfileId, workspaceRoot]);

  useEffect(() => {
    let cancelled = false;

    loadTerminalProfiles(terminalGateway)
      .then((profiles) => {
        if (cancelled) {
          return;
        }

        setTerminalProfiles(profiles);
        setSelectedTerminalProfileId((current) => preferredTerminalProfileId(profiles, current));
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
            isActive
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

function preferredTerminalProfileId(
  profiles: readonly TerminalProfile[],
  current: string | null,
): string | null {
  if (profiles.some((profile) => profile.id === current)) {
    return current;
  }

  return profiles[0]?.id ?? null;
}

function terminalTabsOwnerKey(ownerKey: string | null, rootPath: string | null): string {
  return ownerKey && rootPath ? JSON.stringify([ownerKey, rootPath]) : "no-workspace";
}
