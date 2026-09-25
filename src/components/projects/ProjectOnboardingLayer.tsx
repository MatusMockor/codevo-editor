import { useLayoutEffect, useRef, useState } from "react";
import type { RepositoryLookupGateway } from "../../application/repositoryLookupPorts";
import { useHomeDirectory, type HomeDirectoryResolver } from "../../application/useHomeDirectory";
import {
  useRepositoryHostStatus,
  type RepositoryHostStatuses,
} from "../../application/useRepositoryHostStatus";
import type { RecentFolderEntry } from "../../domain/recentFolders";
import type { RemoteRunnerServer } from "../../domain/remoteRunner";
import { resolveTauriWorkspaceHome } from "../../infrastructure/tauriHomeDirectory";
import { CommandSurface } from "../../ui/foundation/CommandList";
import { AgentAddProjectDialog } from "../agentMode/AgentAddProjectDialog";
import { MAX_PENDING_PROJECT_CLONES } from "../agentMode/agentProjectCreationSession";
import type { AgentWorkbenchAddProjectChrome } from "../agentMode/agentWorkbenchChrome";
import { ProjectRepositoryPicker } from "../agentMode/ProjectRepositoryPicker";
import { useRememberCloneParentOnCompletion } from "../agentMode/useAgentCloneDestinationPreference";
import { AgentRemoteAddProjectDialog } from "../agentMode/remoteAddProject/AgentRemoteAddProjectDialog";
import type { useAgentProjectCreation } from "../agentMode/useAgentProjectCreation";
import "../agentMode/remoteAddProject/remoteAddProject.css";
import { AddProjectPalette } from "./AddProjectPalette";
import { AgentExistingServerProjectDialog } from "./AgentExistingServerProjectDialog";
import { CloneRepositoryForm } from "./CloneRepositoryForm";

export type ProjectOnboardingCreation = Pick<
  ReturnType<typeof useAgentProjectCreation>,
  | "entryOpen"
  | "open"
  | "closeEntry"
  | "choose"
  | "capacityError"
  | "pendingClones"
  | "localDialogOpen"
  | "closeLocal"
  | "local"
  | "existingServerProjects"
  | "closeExisting"
  | "selectExisting"
  | "remoteAdd"
  | "addProject"
>;

export interface ProjectOnboardingLayerProps {
  readonly creation: ProjectOnboardingCreation;
  readonly chrome: AgentWorkbenchAddProjectChrome | null;
  readonly servers: readonly RemoteRunnerServer[];
  readonly selectedServerId: string | null;
  readonly lookupGateway: RepositoryLookupGateway | null;
  readonly resolveHome?: HomeDirectoryResolver;
}

type RepositoryPickerProvider = "github" | "gitlab";

const CAPACITY_NOTICE = `You can keep up to ${MAX_PENDING_PROJECT_CLONES} clones open. Finish or remove one before starting another.`;
const LOCAL_ENVIRONMENT_LABEL = "This computer";
const DEFAULT_SHORTHAND_HOST = "github.com";
const NO_RECENT: readonly RecentFolderEntry[] = [];

export function ProjectOnboardingLayer({
  chrome,
  creation,
  lookupGateway,
  resolveHome = resolveTauriWorkspaceHome,
  selectedServerId,
  servers,
}: ProjectOnboardingLayerProps) {
  const [serverChoice, setServerChoice] = useState<Readonly<{ id: string | null }> | null>(null);
  const [cloneSeed, setCloneSeed] = useState("");
  const [picker, setPicker] = useState<RepositoryPickerProvider | null>(null);
  if (!creation.entryOpen && serverChoice !== null) setServerChoice(null);
  const invoker = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!creation.entryOpen) return;
    const active = document.activeElement;
    invoker.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }, [creation.entryOpen]);
  const home = useHomeDirectory(chrome === null ? null : resolveHome);
  const stageCloneParent = useRememberCloneParentOnCompletion(
    creation.pendingClones,
    chrome?.cloneDestination,
  );
  const hosts = useRepositoryHostStatus(
    lookupGateway,
    creation.entryOpen || creation.localDialogOpen || picker !== null,
  );
  const serverId = knownServerId(serverChoice?.id ?? selectedServerId, servers);
  const atCapacity = creation.pendingClones.length >= MAX_PENDING_PROJECT_CLONES;
  const cloneAvailable = chrome?.cloneGateway != null && !atCapacity;
  const openCloneForm = (url: string) => {
    setCloneSeed(url);
    creation.choose(null, "clone");
  };
  const closePicker = () => setPicker(null);
  return (
    <>
      {creation.entryOpen && (
        <AddProjectPalette
          cloneAvailable={cloneAvailable}
          home={home}
          hosts={hosts}
          notice={creation.capacityError ?? (atCapacity ? CAPACITY_NOTICE : null)}
          onClose={creation.closeEntry}
          onCloneForm={openCloneForm}
          onOpenFolder={() => creation.choose(null, "existing")}
          onOpenPath={(path) => {
            creation.closeEntry();
            creation.addProject.addProject(path);
          }}
          onRepositoryPicker={(provider) => {
            creation.closeEntry();
            setPicker(provider);
          }}
          onServerAction={(id, action) => creation.choose(id, action)}
          onServerChange={(id) => setServerChoice({ id })}
          recent={chrome?.recentFolders ?? NO_RECENT}
          serverId={serverId}
          servers={servers}
        />
      )}
      {picker !== null && (
        <CommandSurface label="Choose repository" onClose={closePicker} returnFocusRef={invoker}>
          <section className="quick-open agent-remote-add-project cv-projects-picker">
            <ProjectRepositoryPicker
              environmentLabel={LOCAL_ENVIRONMENT_LABEL}
              gateway={lookupGateway}
              initialProvider={picker}
              onBack={() => {
                closePicker();
                creation.open();
              }}
              onChoose={(repository) => {
                const url = repository.sshUrl ?? repository.httpsUrl;
                if (url === null) return;
                closePicker();
                openCloneForm(url);
              }}
              onUseUrl={() => {
                closePicker();
                openCloneForm("");
              }}
            />
          </section>
        </CommandSurface>
      )}
      {creation.localDialogOpen && chrome !== null && (
        <CloneRepositoryForm
          busy={creation.local.busy}
          directoryGateway={chrome.gateway}
          environmentLabel={LOCAL_ENVIRONMENT_LABEL}
          error={creation.local.error}
          home={home}
          initialUrl={cloneSeed}
          key={cloneSeed}
          lastParentPath={chrome.cloneDestination?.lastParentPath ?? null}
          onBack={() => {
            creation.closeLocal();
            creation.open();
          }}
          onClone={(request) => {
            stageCloneParent(request.name, request.parentPath);
            void creation.local.start(request);
          }}
          onOpenExisting={(rootPath) => {
            creation.closeLocal();
            creation.addProject.addProject(rootPath);
          }}
          projectRootPaths={creation.addProject.projectRootPaths}
          shorthandHost={shorthandHost(hosts)}
        />
      )}
      {creation.existingServerProjects !== null && (
        <AgentExistingServerProjectDialog
          onClose={creation.closeExisting}
          onSelect={creation.selectExisting}
          projects={creation.existingServerProjects}
        />
      )}
      <AgentRemoteAddProjectDialog
        controller={creation.remoteAdd}
        onClose={creation.remoteAdd.close}
      />
      {creation.addProject.open && chrome !== null && (
        <AgentAddProjectDialog
          gateway={chrome.gateway}
          onAdd={creation.addProject.addProject}
          onClose={creation.addProject.closeDialog}
          onNotice={creation.addProject.reportNotice}
          onOpenExisting={creation.addProject.addProject}
          projectRootPaths={creation.addProject.projectRootPaths}
        />
      )}
    </>
  );
}

function knownServerId(id: string | null, servers: readonly RemoteRunnerServer[]): string | null {
  if (id === null) return null;
  return servers.some((server) => server.id === id) ? id : null;
}

function shorthandHost(hosts: RepositoryHostStatuses): string {
  const github = hosts.github;
  if (github.kind === "ready" || github.kind === "signedOut") return github.host;
  return DEFAULT_SHORTHAND_HOST;
}
