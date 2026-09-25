import { Folder, Link2, Monitor, TriangleAlert } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import type { CloneFormRequest, CloneRepositoryCard } from "../../domain/cloneForm";
import type { DirectoryListingGateway } from "../../domain/directoryListing";
import { Button } from "../../ui/foundation/Button";
import {
  CommandFooter,
  CommandFooterHint,
  CommandInput,
  CommandSurface,
} from "../../ui/foundation/CommandList";
import { FieldFrame } from "../../ui/foundation/FieldFrame";
import { IconButton } from "../../ui/foundation/IconButton";
import { AgentAddProjectDialog } from "../agentMode/AgentAddProjectDialog";
import { RemoteAddProjectSourceGlyph } from "../agentMode/remoteAddProject/RemoteAddProjectSources";
import { useCloneRepositoryForm } from "./useCloneRepositoryForm";
import "./projects.css";

export interface CloneRepositoryFormProps {
  readonly initialUrl: string;
  readonly environmentLabel: string;
  readonly directoryGateway: DirectoryListingGateway;
  readonly home: string | null;
  readonly shorthandHost: string | null;
  readonly lastParentPath: string | null;
  readonly projectRootPaths: readonly string[];
  readonly busy: boolean;
  readonly error: string | null;
  onBack(): void;
  onClone(request: CloneFormRequest, source: Readonly<{ host: string; path: string }>): void;
  onOpenExisting(rootPath: string): void;
}

const DESTINATION_HINT = "The repository is cloned into this folder.";
const URL_PLACEHOLDER = "Enter Git clone URL or owner/repo";
const MAX_ERROR_CHARS = 500;
const NO_PROJECT_ROOTS: readonly string[] = [];

export function CloneRepositoryForm(props: CloneRepositoryFormProps) {
  const form = useCloneRepositoryForm({
    initialUrl: props.initialUrl,
    home: props.home,
    shorthandHost: props.shorthandHost,
    lastParent: props.lastParentPath,
    directoryGateway: props.directoryGateway,
    projectRootPaths: props.projectRootPaths,
  });
  const [picking, setPicking] = useState(false);
  const listboxId = useId();
  const destinationId = useId();
  const branchId = useId();
  const { state } = form;
  const existingProjectRoot = state.existingProjectRoot;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    form.touchUrl();
    if (props.busy || state.request === null || state.source === null) return;
    props.onClone(state.request, state.source);
  };
  if (picking)
    return (
      <AgentAddProjectDialog
        gateway={props.directoryGateway}
        initialPath={state.destinationTarget?.parentPath ?? props.home}
        mode="selectDirectory"
        onAdd={(path) => {
          form.chooseParent(path);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
        onOpenExisting={() => undefined}
        projectRootPaths={NO_PROJECT_ROOTS}
      />
    );
  return (
    <CommandSurface label="Clone repository" onClose={props.onBack}>
      <form className="cv-clone-form" noValidate onSubmit={submit}>
        <CommandInput
          activeDescendantId={null}
          expanded={false}
          label="Repository URL"
          lead="back"
          listboxId={listboxId}
          onBack={props.onBack}
          onChange={form.setUrl}
          onKeyDown={(event) => {
            if (event.key === "Enter") form.touchUrl();
          }}
          placeholder={URL_PLACEHOLDER}
          trailing={
            <span className="cv-projects-environment cv-projects-environment--static">
              <Monitor aria-hidden="true" size={14} />
              {props.environmentLabel}
            </span>
          }
          value={form.url}
        />
        <div className="cv-clone-form__body">
          <RepositoryCard card={state.repository} />
          <div className="cv-clone-form__fields">
            <div className="cv-clone-form__destination">
              <FieldFrame
                error={state.destinationError ?? undefined}
                hint={state.destinationError === null ? DESTINATION_HINT : undefined}
                id={destinationId}
                label="Destination"
              >
                <div
                  className="cv-clone-form__input"
                  data-invalid={state.destinationError !== null}
                >
                  <input
                    aria-invalid={state.destinationError !== null}
                    autoComplete="off"
                    className="cv-clone-form__control"
                    disabled={props.busy}
                    id={destinationId}
                    maxLength={4162}
                    onChange={(event) => form.setDestination(event.currentTarget.value)}
                    placeholder="~/code/repository"
                    spellCheck={false}
                    value={state.destination}
                  />
                  <IconButton
                    disabled={props.busy}
                    icon={<Folder size={14} />}
                    label="Choose folder"
                    onClick={() => setPicking(true)}
                    size="xs"
                  />
                </div>
              </FieldFrame>
              {existingProjectRoot === null ? null : (
                <Button
                  onClick={() => props.onOpenExisting(existingProjectRoot)}
                  size="sm"
                  variant="ghost"
                >
                  Open existing
                </Button>
              )}
            </div>
            <FieldFrame
              error={state.branchError ?? undefined}
              id={branchId}
              label="Branch"
              optional
            >
              <div className="cv-clone-form__input" data-invalid={state.branchError !== null}>
                <input
                  aria-invalid={state.branchError !== null}
                  autoComplete="off"
                  className="cv-clone-form__control"
                  disabled={props.busy}
                  id={branchId}
                  maxLength={255}
                  onChange={(event) => form.setBranch(event.currentTarget.value)}
                  placeholder="Default branch"
                  spellCheck={false}
                  value={form.branch}
                />
              </div>
            </FieldFrame>
          </div>
          {props.error === null ? null : (
            <p className="cv-clone-form__error" role="alert">
              {props.error.slice(0, MAX_ERROR_CHARS)}
            </p>
          )}
          <div className="cv-clone-form__actions">
            <Button disabled={props.busy} onClick={props.onBack} variant="ghost">
              Back
            </Button>
            <Button disabled={props.busy || state.request === null} type="submit" variant="primary">
              {props.busy ? "Starting…" : "Clone"}
            </Button>
          </div>
        </div>
        <CommandFooter>
          <CommandFooterHint keys={["Tab"]} label="Next field" />
          <CommandFooterHint keys={["Enter"]} label="Clone" />
          <CommandFooterHint keys={["Esc"]} label="Back" />
        </CommandFooter>
      </form>
    </CommandSurface>
  );
}

function RepositoryCard({ card }: { readonly card: CloneRepositoryCard }) {
  return (
    <div aria-live="polite" className="cv-clone-card" data-kind={card.kind}>
      <span aria-hidden="true" className="cv-clone-card__icon">
        <RepositoryCardIcon card={card} />
      </span>
      <span className="cv-clone-card__text">
        <span className="cv-clone-card__title">{card.title}</span>
        <span className="cv-clone-card__detail">{card.detail}</span>
      </span>
    </div>
  );
}

function RepositoryCardIcon({ card }: { readonly card: CloneRepositoryCard }) {
  switch (card.kind) {
    case "ok":
      return <RemoteAddProjectSourceGlyph kind={card.glyph} />;
    case "bad":
      return <TriangleAlert size={16} />;
    case "empty":
      return <Link2 size={16} />;
    default:
      return unsupportedCard(card);
  }
}

function unsupportedCard(card: never): never {
  throw new TypeError(`Unsupported repository card: ${JSON.stringify(card)}.`);
}
