import type {
  RemoteAddProjectController,
  RemoteAddProjectServerProject,
  RemoteAddProjectStep,
} from "../../../application/useRemoteAddProject";
import { RemoteAddProjectConfirm } from "./RemoteAddProjectConfirm";
import { RemoteAddProjectRepositoryEntry } from "./RemoteAddProjectRepositoryEntry";
import { RemoteAddProjectServerProjects } from "./RemoteAddProjectServerProjects";
import { RemoteAddProjectSources } from "./RemoteAddProjectSources";
import {
  unsupportedRemoteAddProjectStep,
  type RemoteAddProjectSourceRow,
} from "./remoteAddProjectPresentation";

export interface RemoteAddProjectStepBodyProps {
  readonly activeIndex: number;
  readonly controller: RemoteAddProjectController;
  readonly hiddenCount: number;
  readonly listboxId: string;
  readonly optionPrefix: string;
  readonly primary: () => void;
  readonly projects: readonly RemoteAddProjectServerProject[];
  readonly sources: readonly RemoteAddProjectSourceRow[];
  readonly step: RemoteAddProjectStep;
  onHighlight(index: number): void;
}

export function RemoteAddProjectStepBody({
  activeIndex,
  controller,
  hiddenCount,
  listboxId,
  onHighlight,
  optionPrefix,
  primary,
  projects,
  sources,
  step,
}: RemoteAddProjectStepBodyProps) {
  switch (step.kind) {
    case "sources":
      return (
        <RemoteAddProjectSources
          activeIndex={activeIndex}
          listboxId={listboxId}
          onActivate={controller.chooseSource}
          onHighlight={onHighlight}
          onRetry={controller.retrySources}
          optionPrefix={optionPrefix}
          rows={sources}
        />
      );
    case "serverProjects":
      return (
        <RemoteAddProjectServerProjects
          activeIndex={activeIndex}
          hiddenCount={hiddenCount}
          listboxId={listboxId}
          onActivate={controller.selectServerProject}
          onHighlight={onHighlight}
          optionPrefix={optionPrefix}
          projects={projects}
        />
      );
    case "urlEntry":
      return (
        <RemoteAddProjectRepositoryEntry
          lookup={step.lookup}
          onUseGitUrl={controller.useGitUrl}
          source="gitUrl"
        />
      );
    case "repository":
      return (
        <RemoteAddProjectRepositoryEntry
          lookup={step.lookup}
          onUseGitUrl={controller.useGitUrl}
          source={step.provider}
        />
      );
    case "confirm":
      return (
        <RemoteAddProjectConfirm
          onBranch={controller.setBranch}
          onName={controller.setName}
          onOpenExisting={controller.openExisting}
          onProtocol={controller.setProtocol}
          onSubmit={primary}
          step={step}
        />
      );
    default:
      return unsupportedRemoteAddProjectStep(step);
  }
}
