import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings, SettingsSection, WorkspaceSettings } from "../../domain/settings";
import { SettingsSearchInput } from "./SettingsSearchInput";
import { SettingsSearchResults } from "./SettingsSearchResults";
import { SettingsSectionSidebar } from "./SettingsSectionSidebar";
import { SettingsPageHost } from "./settingsPages";
import type { SettingsEnvironment, SettingsSaveInput } from "./settingsPageProps";
import {
  resolveSettingsRoute,
  type SettingsRowId,
  type SettingsSectionId,
} from "./settingsRegistry";
import type { SettingsSearchHit } from "./settingsSearch";
import { SETTINGS_PANEL_ID, SETTINGS_RESULTS_ID, settingsSectionTabId } from "./settingsScreenIds";
import { SettingsTargetContext } from "./settingsTargetContext";
import { useSettingsDraft } from "./useSettingsDraft";
import { useSettingsKeyboard } from "./useSettingsKeyboard";
import { useSettingsSearch } from "./useSettingsSearch";

export interface WorkbenchSettingsScreenProps {
  readonly env: SettingsEnvironment;
  readonly initialAppSettings: AppSettings;
  readonly initialSection: SettingsSection;
  readonly initialTrusted: boolean;
  readonly initialWorkspaceSettings: WorkspaceSettings;
  onClose(): void;
  onSave(input: SettingsSaveInput): Promise<void>;
}

export function WorkbenchSettingsScreen({
  env,
  initialAppSettings,
  initialSection,
  initialTrusted,
  initialWorkspaceSettings,
  onClose,
  onSave,
}: WorkbenchSettingsScreenProps) {
  const route = useMemo(() => resolveSettingsRoute(initialSection), [initialSection]);
  const [section, setSection] = useState<SettingsSectionId>(route.section);
  const [targetRowId, setTargetRowId] = useState<SettingsRowId | null>(route.row);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const { actions, draft } = useSettingsDraft({
    appSettings: initialAppSettings,
    hasWorkspace: env.hasWorkspace,
    onSave,
    trusted: initialTrusted,
    workspaceSettings: initialWorkspaceSettings,
  });

  useEffect(() => {
    setSection(route.section);
    setTargetRowId(route.row);
  }, [route]);

  const restoreFocusRef = useRef(activeElementForRestore());
  const deepLinkedRef = useRef(route.row !== null);

  useEffect(() => {
    if (!deepLinkedRef.current) {
      headingRef.current?.focus();
    }

    const restoreTo = restoreFocusRef.current;

    return () => {
      if (restoreTo === null) return;
      if (!restoreTo.isConnected) return;

      restoreTo.focus();
    };
  }, []);

  const selectSection = useCallback((next: SettingsSectionId): void => {
    setSection(next);
    setTargetRowId(null);
  }, []);

  const selectHit = useCallback((hit: SettingsSearchHit): void => {
    setSection(hit.row.section);
    setTargetRowId(hit.row.id);
  }, []);

  const search = useSettingsSearch({
    hasWorkspace: env.hasWorkspace,
    onClose,
    onSelect: selectHit,
  });

  const focusSearch = useCallback((): void => searchInputRef.current?.focus(), []);
  useSettingsKeyboard({
    onEscape: search.handleEscape,
    onFocusSearch: focusSearch,
    surfaceRef,
  });

  const onTargetHandled = useCallback((): void => setTargetRowId(null), []);
  const target = useMemo(() => ({ onTargetHandled, targetRowId }), [onTargetHandled, targetRowId]);

  return (
    <div className="settings-screen" ref={surfaceRef}>
      <SettingsSectionSidebar
        activeSection={section}
        onExit={onClose}
        onSelectSection={selectSection}
        panelId={SETTINGS_PANEL_ID}
        results={
          <SettingsSearchResults
            activeIndex={search.activeIndex}
            hidden={!search.searching}
            hits={search.hits}
            id={SETTINGS_RESULTS_ID}
            onActivate={search.setActiveIndex}
            onSelect={search.selectHit}
          />
        }
        search={
          <SettingsSearchInput
            activeOptionId={search.activeOptionId}
            expanded={search.searching}
            inputRef={searchInputRef}
            onKeyDown={search.handleKeyDown}
            onQueryChange={search.setQuery}
            query={search.query}
            resultsId={SETTINGS_RESULTS_ID}
          />
        }
        searching={search.searching}
      />
      <div
        aria-labelledby={settingsSectionTabId(section)}
        className="settings-screen__page"
        data-settings-page-scroll=""
        id={SETTINGS_PANEL_ID}
        role="tabpanel"
      >
        <div className="settings-screen__inner">
          <h1 className="settings-screen__title" ref={headingRef} tabIndex={-1}>
            Settings
          </h1>
          <SettingsTargetContext.Provider value={target}>
            <SettingsPageHost actions={actions} draft={draft} env={env} section={section} />
          </SettingsTargetContext.Provider>
        </div>
      </div>
    </div>
  );
}

function activeElementForRestore(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  if (!(document.activeElement instanceof HTMLElement)) return null;

  return document.activeElement;
}
