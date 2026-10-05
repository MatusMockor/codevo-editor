import { LoaderCircle } from "lucide-react";
import { useId, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import type { AgentProviderManagementView } from "../../application/useAgentProviderManagement";
import type { AgentNewThreadDefaults } from "../../domain/agentNewThreadDefaults";
import type { AgentCliKind } from "../../domain/agentSettings";
import { AgentProviderGlyph } from "../agentMode/AgentProviderGlyph";
import {
  newThreadArrowTarget,
  newThreadEffortOptions,
  newThreadEffortValue,
  newThreadModelOptions,
  newThreadModelValue,
  newThreadSelectionNote,
  newThreadTabStop,
  newThreadTileFootnote,
  newThreadTileState,
  withNewThreadEffort,
  withNewThreadModel,
  type AgentNewThreadArrowStep,
  type AgentNewThreadModelContext,
  type AgentNewThreadProviderSelection,
  type AgentNewThreadTileState,
  type AgentProviderEnablement,
} from "./agentNewThreadDefaultsPresentation";
import {
  providerHeadline,
  providerLabel,
  providerStatusTone,
} from "./agentProviderCardPresentation";
import { AGENT_PROVIDERS } from "./agentProviderSettingsPersistence";
import { SettingsSelect } from "./primitives/SettingsSelect";
import { settingsRowDescriptor } from "./settingsRegistry";
import { useSettingsRowTarget } from "./settingsTargetContext";

const ROW_ID = "agents.defaultProvider";
const TILE_CONTROL_SELECTOR = "button, select, option";

const STEP_BY_KEY: Readonly<Record<string, AgentNewThreadArrowStep>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

export interface AgentNewThreadStartTilesProps {
  readonly defaults: AgentNewThreadDefaults;
  readonly enabled: AgentProviderEnablement;
  readonly modelContext: AgentNewThreadModelContext;
  readonly preview: ReactNode;
  readonly selection: AgentNewThreadProviderSelection;
  readonly views: Readonly<Record<AgentCliKind, AgentProviderManagementView>>;
  onChangeDefaults(defaults: AgentNewThreadDefaults): void;
  onSelectProvider(provider: AgentCliKind): void;
}

export function AgentNewThreadStartTiles({
  defaults,
  enabled,
  modelContext,
  onChangeDefaults,
  onSelectProvider,
  preview,
  selection,
  views,
}: AgentNewThreadStartTilesProps) {
  const descriptor = settingsRowDescriptor(ROW_ID);
  const elementRef = useSettingsRowTarget(ROW_ID);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;
  const tabStop = newThreadTabStop(selection, enabled);
  const note = newThreadSelectionNote(selection);

  const select = (provider: AgentCliKind): void => {
    if (newThreadTileState(provider, selection, enabled) !== "available") return;

    onSelectProvider(provider);
  };

  const move = (from: AgentCliKind, step: AgentNewThreadArrowStep): void => {
    const target = newThreadArrowTarget(from, step, enabled);

    if (target === null) return;

    select(target);
    groupRef.current?.querySelector<HTMLButtonElement>(`[data-provider="${target}"]`)?.focus();
  };

  return (
    <div
      className="settings-thread-start"
      data-settings-row={ROW_ID}
      ref={elementRef}
      tabIndex={-1}
    >
      <div className="settings-thread-start__head">
        <h3 className="settings-row__title" id={titleId}>
          {descriptor.title}
        </h3>
        <p className="settings-row__description" id={descriptionId}>
          {descriptor.description}
        </p>
      </div>
      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        className="settings-thread-start__tiles"
        ref={groupRef}
        role="radiogroup"
      >
        {AGENT_PROVIDERS.map((provider) => (
          <AgentNewThreadTile
            defaults={defaults}
            key={provider}
            modelContext={modelContext}
            onChangeDefaults={onChangeDefaults}
            onMove={(step) => move(provider, step)}
            onSelect={() => select(provider)}
            provider={provider}
            state={newThreadTileState(provider, selection, enabled)}
            tabbable={tabStop === provider}
            view={views[provider]}
          />
        ))}
      </div>
      {note === null ? null : (
        <p className="settings-thread-start__note" role="status">
          {note}
        </p>
      )}
      {preview}
    </div>
  );
}

interface AgentNewThreadTileProps {
  readonly defaults: AgentNewThreadDefaults;
  readonly modelContext: AgentNewThreadModelContext;
  readonly provider: AgentCliKind;
  readonly state: AgentNewThreadTileState;
  readonly tabbable: boolean;
  readonly view: AgentProviderManagementView;
  onChangeDefaults(defaults: AgentNewThreadDefaults): void;
  onMove(step: AgentNewThreadArrowStep): void;
  onSelect(): void;
}

function AgentNewThreadTile({
  defaults,
  modelContext,
  onChangeDefaults,
  onMove,
  onSelect,
  provider,
  state,
  tabbable,
  view,
}: AgentNewThreadTileProps) {
  const baseId = useId();
  const nameId = `${baseId}-name`;
  const statusId = `${baseId}-status`;
  const footId = `${baseId}-foot`;
  const label = providerLabel(provider);
  const providerEnabled = state !== "disabled";
  const tone = providerStatusTone(providerEnabled, view);
  const headline = providerHeadline(view, providerEnabled);
  const effortOptions = newThreadEffortOptions(provider, defaults, modelContext);
  const effortChoosable = effortOptions.length > 1;

  const commit = (next: AgentNewThreadDefaults | null): void => {
    if (next === null) return;

    onChangeDefaults(next);
  };

  const selectFromSurface = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target;

    if (target instanceof Element && target.closest(TILE_CONTROL_SELECTOR) !== null) return;

    onSelect();
  };

  const moveWithArrow = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const step = STEP_BY_KEY[event.key];

    if (step === undefined) return;

    event.preventDefault();
    onMove(step);
  };

  return (
    <div className="settings-thread-tile" data-state={state} onClick={selectFromSurface}>
      <button
        aria-checked={state === "checked"}
        aria-describedby={`${statusId} ${footId}`}
        aria-disabled={providerEnabled ? undefined : true}
        aria-labelledby={nameId}
        className="settings-thread-tile__radio"
        data-provider={provider}
        onClick={onSelect}
        onKeyDown={moveWithArrow}
        role="radio"
        tabIndex={tabbable ? 0 : -1}
        type="button"
      >
        <span className="settings-provider__glyph" data-tone={tone}>
          <AgentProviderGlyph decorative kind={provider} />
        </span>
        <span className="settings-thread-tile__text">
          <span className="settings-thread-tile__name" id={nameId}>
            {label}
          </span>
          <span className="settings-thread-tile__status" id={statusId} title={headline}>
            {tone === "checking" ? (
              <LoaderCircle
                aria-hidden="true"
                className="settings-provider__dot settings-spin"
                data-tone={tone}
                size={10}
              />
            ) : (
              <span aria-hidden="true" className="settings-provider__dot" data-tone={tone} />
            )}
            <span className="settings-thread-tile__status-text">{headline}</span>
          </span>
        </span>
        <span aria-hidden="true" className="settings-thread-tile__indicator" />
      </button>
      <div className="settings-thread-tile__fields">
        <span className="settings-thread-tile__label">Model and effort</span>
        <div className="settings-thread-tile__pair">
          <SettingsSelect
            disabled={!providerEnabled}
            label={`${label} model`}
            onChange={(value) =>
              commit(withNewThreadModel(defaults, provider, value, modelContext))
            }
            options={newThreadModelOptions(provider, defaults, modelContext)}
            value={newThreadModelValue(provider, defaults, modelContext)}
            width="auto"
          />
          <SettingsSelect
            disabled={!providerEnabled || !effortChoosable}
            label={`${label} effort`}
            onChange={(value) =>
              commit(withNewThreadEffort(defaults, provider, value, modelContext))
            }
            options={effortOptions}
            value={newThreadEffortValue(provider, defaults, modelContext)}
            width="auto"
          />
        </div>
      </div>
      <p className="settings-thread-tile__foot" id={footId}>
        {newThreadTileFootnote(provider, state)}
      </p>
    </div>
  );
}
