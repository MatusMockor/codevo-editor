import "./remoteAddProject.css";
import { ArrowLeft, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type {
  RemoteAddProjectController,
  RemoteAddProjectServerProject,
  RemoteAddProjectStep,
} from "../../../application/useRemoteAddProject";
import { ProjectRepositoryPicker } from "../ProjectRepositoryPicker";
import { RemoteAddProjectFooter } from "./RemoteAddProjectFooter";
import { RemoteAddProjectRepositoryHosts } from "./RemoteAddProjectRepositoryEntry";
import { RemoteAddProjectSourceGlyph } from "./RemoteAddProjectSources";
import { RemoteAddProjectStepBody } from "./RemoteAddProjectStepBody";
import {
  MAX_REMOTE_ADD_PROJECT_ROWS,
  remoteAddProjectMaxEntryChars,
  remoteAddProjectPlaceholder,
  remoteAddProjectSourceRows,
  remoteAddProjectStepTitle,
  type RemoteAddProjectSourceRow,
} from "./remoteAddProjectPresentation";

export const REMOTE_ADD_PROJECT_LISTBOX_ID = "agent-remote-add-project-listbox";
export const REMOTE_ADD_PROJECT_OPTION_PREFIX = "agent-remote-add-project-option-";

export interface AgentRemoteAddProjectDialogProps {
  readonly controller: RemoteAddProjectController;
  onClose(): void;
}

export function AgentRemoteAddProjectDialog({
  controller,
  onClose,
}: AgentRemoteAddProjectDialogProps) {
  const { availability, open, serverProjects, step } = controller;
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const stepKey = stepIdentity(step);
  const stepEntry = useRef(remoteAddProjectStepEntry(step));
  stepEntry.current = remoteAddProjectStepEntry(step);

  useEffect(() => {
    if (!open) return;
    setQuery(stepEntry.current);
    setActiveIndex(0);
  }, [open, stepKey]);

  useEffect(() => {
    if (!open) return;
    const field = inputRef.current ?? sectionRef.current?.querySelector("input") ?? null;
    field?.focus();
  }, [open, stepKey]);

  const sourceRows = useMemo(() => remoteAddProjectSourceRows(availability), [availability]);
  const visibleSources = useMemo(() => matchingSources(sourceRows, query), [query, sourceRows]);
  const matchedProjects = useMemo(
    () => matchingProjects(serverProjects, query),
    [query, serverProjects],
  );
  const visibleProjects = useMemo(
    () => matchedProjects.slice(0, MAX_REMOTE_ADD_PROJECT_ROWS),
    [matchedProjects],
  );

  const listStep = step.kind === "sources" || step.kind === "serverProjects";
  const rowCount = listRowCount(step.kind, visibleSources.length, visibleProjects.length);
  const boundedIndex = rowCount === 0 ? -1 : Math.min(activeIndex, rowCount - 1);

  const activate = useCallback(() => {
    if (step.kind === "sources") {
      const row = visibleSources[boundedIndex];
      if (row === undefined || row.availability.status !== "ready") return;
      controller.chooseSource(row.kind);
      return;
    }
    if (step.kind === "serverProjects") {
      const project = visibleProjects[boundedIndex];
      if (project === undefined) return;
      controller.selectServerProject(project.key);
      return;
    }
    if (step.kind === "urlEntry" || step.kind === "repository") {
      if (query.trim() === "") return;
      controller.submitEntry(query);
    }
  }, [boundedIndex, controller, query, step.kind, visibleProjects, visibleSources]);

  const primary = useCallback(() => {
    if (step.kind !== "confirm") {
      activate();
      return;
    }
    if (step.submitting || step.nameError !== null || step.branchError !== null) return;
    controller.confirmClone();
  }, [activate, controller, step]);

  const handleSectionKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Enter" || event.repeat || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      primary();
    },
    [onClose, primary],
  );

  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        if (event.repeat || event.metaKey || event.ctrlKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        activate();
        return;
      }
      if (event.key === "Backspace") {
        if (query !== "" || event.repeat || step.kind === "sources") return;
        event.preventDefault();
        controller.back();
        return;
      }
      if (rowCount === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % rowCount);
        return;
      }
      if (event.key !== "ArrowUp") return;
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + rowCount) % rowCount);
    },
    [activate, controller, query, rowCount, step.kind],
  );

  if (!open) return null;
  if (
    (step.kind === "repository" || step.kind === "sources") &&
    controller.repositoryGateway &&
    controller.chooseRepository
  ) {
    return (
      <div className="palette-backdrop" onMouseDown={onClose} role="presentation">
        <section
          className="quick-open agent-remote-add-project"
          aria-label="Find a repository on the server"
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
        >
          <ProjectRepositoryPicker
            gateway={controller.repositoryGateway}
            environmentLabel="Selected server"
            initialProvider={step.kind === "repository" ? step.provider : undefined}
            onChoose={controller.chooseRepository}
            onBack={step.kind === "sources" ? onClose : controller.back}
            onUseUrl={() =>
              step.kind === "sources" ? controller.chooseSource("gitUrl") : controller.useGitUrl()
            }
          />
        </section>
      </div>
    );
  }

  return (
    <div className="palette-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-label="Add project or clone repository"
        className="quick-open agent-remote-add-project"
        onKeyDown={handleSectionKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        ref={sectionRef}
      >
        <div className="agent-remote-add-project__crumb">
          <button
            aria-label="Go back"
            className="agent-iconbutton"
            disabled={step.kind === "sources"}
            onClick={controller.back}
            title="Go back"
            type="button"
          >
            <ArrowLeft aria-hidden="true" size={15} />
          </button>
          <span className="agent-remote-add-project__title">{remoteAddProjectStepTitle(step)}</span>
        </div>

        {step.kind !== "confirm" && (
          <div className="palette-search">
            <StepGlyph step={step} />
            <input
              aria-activedescendant={
                listStep && boundedIndex >= 0
                  ? `${REMOTE_ADD_PROJECT_OPTION_PREFIX}${boundedIndex}`
                  : undefined
              }
              aria-autocomplete={listStep ? "list" : undefined}
              aria-controls={listStep ? REMOTE_ADD_PROJECT_LISTBOX_ID : undefined}
              aria-expanded={listStep ? rowCount > 0 : undefined}
              aria-label={remoteAddProjectPlaceholder(step)}
              autoFocus
              maxLength={remoteAddProjectMaxEntryChars(step)}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleInputKeyDown}
              placeholder={remoteAddProjectPlaceholder(step)}
              ref={inputRef}
              role={listStep ? "combobox" : undefined}
              spellCheck={false}
              value={query}
            />
            {step.kind === "repository" && (
              <RemoteAddProjectRepositoryHosts
                host={step.host}
                hosts={step.hosts}
                onChooseHost={controller.chooseHost}
                truncated={step.hostsTruncated}
              />
            )}
          </div>
        )}

        <div className="quick-open-results agent-remote-add-project__body">
          <RemoteAddProjectStepBody
            activeIndex={boundedIndex}
            controller={controller}
            hiddenCount={matchedProjects.length - visibleProjects.length}
            listboxId={REMOTE_ADD_PROJECT_LISTBOX_ID}
            onHighlight={setActiveIndex}
            optionPrefix={REMOTE_ADD_PROJECT_OPTION_PREFIX}
            primary={primary}
            projects={visibleProjects}
            sources={visibleSources}
            step={step}
          />
        </div>

        <RemoteAddProjectFooter
          disabled={primaryDisabled(step, rowCount, query)}
          listStep={listStep}
          onPrimary={primary}
          step={step}
        />
      </section>
    </div>
  );
}

function StepGlyph({ step }: { readonly step: RemoteAddProjectStep }) {
  if (step.kind === "repository") return <RemoteAddProjectSourceGlyph kind={step.provider} />;
  if (step.kind === "urlEntry") return <RemoteAddProjectSourceGlyph kind="gitUrl" />;
  return <Search aria-hidden="true" size={17} />;
}

function primaryDisabled(step: RemoteAddProjectStep, rowCount: number, query: string): boolean {
  if (step.kind === "confirm")
    return step.submitting || step.nameError !== null || step.branchError !== null;
  if (step.kind === "sources" || step.kind === "serverProjects") return rowCount === 0;
  return query.trim() === "";
}

function remoteAddProjectStepEntry(step: RemoteAddProjectStep): string {
  if (step.kind === "urlEntry" || step.kind === "repository") return step.entry;
  return "";
}

function listRowCount(kind: RemoteAddProjectStep["kind"], sources: number, projects: number) {
  if (kind === "sources") return sources;
  if (kind === "serverProjects") return projects;
  return 0;
}

function matchingSources(
  rows: readonly RemoteAddProjectSourceRow[],
  query: string,
): readonly RemoteAddProjectSourceRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return rows;
  return rows.filter((row) => row.title.toLowerCase().includes(needle));
}

function matchingProjects(
  projects: readonly RemoteAddProjectServerProject[],
  query: string,
): readonly RemoteAddProjectServerProject[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return projects;
  return projects.filter((project) => project.label.toLowerCase().includes(needle));
}

function stepIdentity(step: RemoteAddProjectStep): string {
  if (step.kind === "repository") return `repository:${step.provider}`;
  return step.kind;
}
