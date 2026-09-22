import { useEffect, useId, useRef } from "react";
import { ArrowLeft, Search } from "lucide-react";
import type { RepositoryLookupGateway } from "../../application/repositoryLookupPorts";
import { useProjectRepositorySearch } from "../../application/useProjectRepositorySearch";
import {
  REPOSITORY_LOOKUP_LIMITS,
  type RepositoryInfo,
  type RepositoryProvider,
} from "../../domain/repositoryLookup";
import { RemoteAddProjectSourceGlyph } from "./remoteAddProject/RemoteAddProjectSources";
import "./projectRepositoryPicker.css";
import "./projectMachinePicker.css";
import { AgentPickerMenu } from "./AgentPickerMenu";
import { agentPickerOption } from "./agentPickerOption";

export interface ProjectRepositoryPickerProps {
  readonly gateway: RepositoryLookupGateway | null;
  readonly environmentLabel: string;
  readonly initialProvider?: RepositoryProvider;
  onChoose(repository: RepositoryInfo): void;
  onBack(): void;
  onUseUrl(): void;
}

export function ProjectRepositoryPicker({
  gateway,
  environmentLabel,
  initialProvider,
  onChoose,
  onBack,
  onUseUrl,
}: ProjectRepositoryPickerProps) {
  const hostPickerId = useId();
  const model = useProjectRepositorySearch(gateway, environmentLabel, initialProvider);
  const section = useRef<HTMLElement | null>(null);
  useEffect(() => {
    section.current?.focus();
  }, [model.provider]);
  const providerState = model.provider ? model.hosts?.[model.provider] : null;
  const authenticated =
    providerState?.status === "ready"
      ? providerState.hosts.filter((entry) => entry.auth === "authenticated")
      : [];
  const providerLabel = model.provider === "github" ? "GitHub" : "GitLab";
  const cli = model.provider === "github" ? "gh" : "glab";
  const back = () => (model.provider && !initialProvider ? model.selectProvider(null) : onBack());
  return (
    <section
      className="project-repository-picker"
      aria-label="Choose repository"
      ref={section}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>("button, select, input"),
        ].filter((control) => !control.hasAttribute("disabled"));
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === event.currentTarget)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <header className="project-repository-picker__header">
        <button className="agent-iconbutton" aria-label="Back" onClick={back} type="button">
          <ArrowLeft size={16} />
        </button>
        <strong>{model.provider ? `${providerLabel} repositories` : "Clone repository"}</strong>
        <span>{environmentLabel}</span>
      </header>
      {!model.provider ? (
        <div className="project-repository-picker__sources">
          {(["github", "gitlab"] as const).map((provider) => {
            const state = model.hosts?.[provider];
            const ready =
              state?.status === "ready" &&
              state.hosts.some((entry) => entry.auth === "authenticated");
            return (
              <button
                key={provider}
                disabled={!model.hosts && !model.hostsError && gateway !== null}
                type="button"
                className="project-repository-picker__row"
                onClick={() => model.selectProvider(provider)}
              >
                <RemoteAddProjectSourceGlyph kind={provider} />
                <strong>{provider === "github" ? "GitHub" : "GitLab"}</strong>
                <span>
                  {ready
                    ? "Connected"
                    : model.hosts || model.hostsError || !gateway
                      ? "Setup required"
                      : "Checking…"}
                </span>
              </button>
            );
          })}
          <button type="button" className="project-repository-picker__row" onClick={onUseUrl}>
            <RemoteAddProjectSourceGlyph kind="gitUrl" />
            <strong>Git URL</strong>
            <span>Clone by URL</span>
          </button>
        </div>
      ) : authenticated.length > 0 ? (
        <>
          <form
            className="project-repository-picker__search"
            onSubmit={(event) => {
              event.preventDefault();
              void model.submit();
            }}
          >
            {authenticated.length > 1 && (
              <div className="project-repository-picker__host">
                <span>Repository host</span>
                <div
                  className="project-machine-picker"
                  onKeyDownCapture={(event) => {
                    if (
                      event.key === "Tab" &&
                      event.shiftKey &&
                      event.target instanceof HTMLElement &&
                      event.target.closest('[role="listbox"]')
                    )
                      event.preventDefault();
                  }}
                >
                  <AgentPickerMenu
                    id={hostPickerId}
                    label="Repository host"
                    options={authenticated.map((entry) =>
                      agentPickerOption(entry.host, entry.host),
                    )}
                    value={model.host}
                    disabled={false}
                    tone={null}
                    prefix={null}
                    describedBy={null}
                    align="start"
                    onChange={model.selectHost}
                  />
                </div>
              </div>
            )}
            <div className="project-repository-picker__query">
              <Search aria-hidden="true" size={16} />
              <input
                aria-label="Search repositories"
                placeholder={gateway?.search ? "Search repositories…" : "owner/repository"}
                maxLength={REPOSITORY_LOOKUP_LIMITS.pathChars}
                value={model.query}
                onChange={(event) => model.editQuery(event.currentTarget.value)}
              />
            </div>
          </form>
          <p className="project-repository-picker__hint">
            Uses the signed-in account on {environmentLabel}.
          </p>
          {providerState?.status === "ready" && providerState.truncated && (
            <p role="status">Some configured hosts are not shown.</p>
          )}
          {model.search.status === "pending" && <p role="status">Searching repositories…</p>}
          {model.search.message && <p role="status">{model.search.message}</p>}
          <div className="project-repository-picker__results" aria-label="Repositories">
            {model.search.repositories.map((repository) => (
              <button
                type="button"
                className="project-repository-picker__result"
                key={`${repository.provider}:${repository.host}:${repository.fullPath}`}
                disabled={model.search.status === "pending"}
                onClick={() => onChoose(repository)}
              >
                <strong>{repository.fullPath}</strong>
                <span>{repository.description}</span>
                <small>{repository.visibility}</small>
              </button>
            ))}
          </div>
          {model.search.nextPage !== null && (
            <button
              className="agent-linkbutton"
              type="button"
              onClick={() => void model.submit(model.search.nextPage!)}
            >
              Load more
            </button>
          )}
        </>
      ) : (
        <div className="project-repository-picker__setup" role="status">
          {!gateway ? (
            <p>
              Repository search is unavailable on {environmentLabel}. Use a Git URL or update this
              environment.
            </p>
          ) : !model.hosts && !model.hostsError ? (
            <p>Checking accounts on {environmentLabel}…</p>
          ) : providerState?.status === "failed" || model.hostsError ? (
            <p>Could not check accounts on {environmentLabel}. Check the connection and retry.</p>
          ) : (
            <>
              <p>
                {providerState?.status === "cliMissing"
                  ? `Install ${cli} on ${environmentLabel}, then sign in.`
                  : `Sign in to ${providerLabel} on ${environmentLabel}.`}
              </p>
              <p>
                In a terminal on {environmentLabel}, run <code>{cli} auth login</code>, then retry.
              </p>
            </>
          )}
        </div>
      )}
      <footer>
        <button className="agent-linkbutton" type="button" onClick={() => void model.loadHosts()}>
          Retry account check
        </button>
        {model.provider && (
          <button className="agent-linkbutton" type="button" onClick={onUseUrl}>
            Use Git URL
          </button>
        )}
      </footer>
    </section>
  );
}
