import { useMemo, useState } from "react";
import {
  agentProjectActionRows,
  agentScriptManifests,
  agentScriptRows,
  defaultAgentScriptsManifest,
} from "../../../../application/rightPanel/agentScriptsSurfaceModel";
import { useAgentRightPanelContext } from "../agentRightPanelContext";
import { AgentScriptsSurface } from "./AgentScriptsSurface";

export function AgentScriptsSurfaceContainer() {
  const { scripts, scriptsChrome: chrome, thread } = useAgentRightPanelContext();
  const [chosenManifest, setChosenManifest] = useState<string | null>(null);
  const entries = scripts?.entries;
  const manifests = useMemo(() => agentScriptManifests(entries ?? []), [entries]);
  const tasks = chrome?.vscodeProcessTasks ?? null;
  const actions = useMemo(() => (tasks === null ? null : agentProjectActionRows(tasks)), [tasks]);
  if (scripts === null || chrome === null) {
    return <p className="cv-rp-note">Scripts are unavailable here.</p>;
  }
  const selectedManifest = manifests.some((manifest) => manifest.relativePath === chosenManifest)
    ? chosenManifest
    : defaultAgentScriptsManifest(manifests);
  return (
    <AgentScriptsSurface
      actions={actions}
      actionsRunInProjectRoot={thread !== null && thread.thread.target.worktreePath !== null}
      configurationAction={tasks?.configurationAction ?? null}
      manifests={manifests}
      onConfigureActions={() => void tasks?.configure()}
      onReload={chrome.refreshScripts}
      onRun={(key) => void scripts.runScript(key)}
      onRunAction={(identity) => void tasks?.start(identity)}
      onSelectManifest={setChosenManifest}
      onShowOutput={chrome.openScriptTerminal}
      onStop={scripts.stopScript}
      onStopAction={() => void tasks?.stop()}
      rows={agentScriptRows(scripts, selectedManifest)}
      selectedManifest={selectedManifest}
      truncated={scripts.truncated}
    />
  );
}
