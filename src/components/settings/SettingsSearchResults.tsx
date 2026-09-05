import { settingsSectionDescriptor } from "./settingsRegistry";
import type { SettingsSearchHit } from "./settingsSearch";
import { settingsSearchOptionId } from "./useSettingsSearch";

export interface SettingsSearchResultsProps {
  readonly activeIndex: number;
  readonly hidden: boolean;
  readonly hits: ReadonlyArray<SettingsSearchHit>;
  readonly id: string;
  onActivate(index: number): void;
  onSelect(hit: SettingsSearchHit): void;
}

export function SettingsSearchResults({
  activeIndex,
  hidden,
  hits,
  id,
  onActivate,
  onSelect,
}: SettingsSearchResultsProps) {
  return (
    <ul
      aria-label="Settings search results"
      className="settings-results"
      hidden={hidden}
      id={id}
      role="listbox"
    >
      {hits.map((hit, index) => (
        <li
          aria-selected={index === activeIndex}
          className="settings-results__item"
          id={settingsSearchOptionId(hit.row.id)}
          key={hit.row.id}
          onClick={() => onSelect(hit)}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onActivate(index)}
          role="option"
        >
          <span className="settings-results__title">{hit.row.title}</span>
          <span className="settings-results__section">
            {settingsSectionDescriptor(hit.row.section).label}
          </span>
        </li>
      ))}
      {hits.length === 0 && !hidden ? (
        <li className="settings-results__empty" role="presentation">
          No matching settings
        </li>
      ) : null}
    </ul>
  );
}
