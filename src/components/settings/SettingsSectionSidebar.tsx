import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "./settingsRegistry";
import { settingsSectionTabId } from "./settingsScreenIds";

export interface SettingsSectionSidebarProps {
  readonly activeSection: SettingsSectionId;
  readonly panelId: string;
  readonly results: ReactNode;
  readonly search: ReactNode;
  readonly searching: boolean;
  onSelectSection(section: SettingsSectionId): void;
}

export function SettingsSectionSidebar({
  activeSection,
  onSelectSection,
  panelId,
  results,
  search,
  searching,
}: SettingsSectionSidebarProps) {
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([]);

  const moveTo = (index: number): void => {
    const section = SETTINGS_SECTIONS[index];

    if (section === undefined) return;

    onSelectSection(section.id);
    tabsRef.current[index]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const next = nextTabIndex(event.key, index, SETTINGS_SECTIONS.length);

    if (next === null) return;

    event.preventDefault();
    moveTo(next);
  };

  return (
    <div className="settings-screen__sidebar">
      {search}
      {results}
      <div
        aria-label="Settings sections"
        aria-orientation="vertical"
        className="settings-nav"
        hidden={searching}
        role="tablist"
      >
        {SETTINGS_SECTIONS.map((section, index) => {
          const Icon = section.icon;
          const selected = section.id === activeSection;

          return (
            <button
              aria-controls={panelId}
              aria-selected={selected}
              className="settings-nav__item"
              id={settingsSectionTabId(section.id)}
              key={section.id}
              onClick={() => onSelectSection(section.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              ref={(element) => {
                tabsRef.current[index] = element;
              }}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              <Icon aria-hidden="true" size={16} />
              {section.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function nextTabIndex(key: string, index: number, count: number): number | null {
  if (key === "ArrowDown" || key === "ArrowRight") return (index + 1) % count;
  if (key === "ArrowUp" || key === "ArrowLeft") return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;

  return null;
}
