import { History, MapPin } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { RecentLocation } from "../domain/recentLocations";
import { PaletteFooter } from "./PaletteFooter";

interface RecentLocationsPanelProps {
  isOpen: boolean;
  locations: RecentLocation[];
  onClose(): void;
  onOpen(location: RecentLocation): void;
}

function optionId(location: RecentLocation, index: number): string {
  return `recent-location-${index}-${location.path}:${location.line}`;
}

// PhpStorm-style Recent Locations dialog (Cmd+Shift+E). Unlike Recent Files
// (whole files), this lists the concrete POSITIONS the user recently visited or
// edited: file name + line + the text of that line as a context snippet, newest
// first. The list is already ordered/deduped by the controller, so this is
// presentation only: keyboard navigation, click/Enter to jump, Escape to close.
// The first row is pre-selected so a single Cmd+Shift+E + Enter jumps back to
// the most recent location.
export function RecentLocationsPanel({
  isOpen,
  locations,
  onClose,
  onOpen,
}: RecentLocationsPanelProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setActiveIndex(0);
      return;
    }

    setActiveIndex(0);
    listRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex((current) =>
      Math.min(current, Math.max(locations.length - 1, 0)),
    );
  }, [locations.length]);

  if (!isOpen) {
    return null;
  }

  const activeLocation = locations[activeIndex];

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      onClose();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) =>
        Math.min(current + 1, Math.max(locations.length - 1, 0)),
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter" && activeLocation) {
      event.preventDefault();
      onOpen(activeLocation);
    }
  };

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="Recent locations"
        className="quick-open"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-search">
          <History aria-hidden="true" size={17} />
          <div className="recent-files-heading">Recent Locations</div>
        </div>

        <div
          aria-activedescendant={
            activeLocation
              ? optionId(activeLocation, activeIndex)
              : undefined
          }
          aria-label="Recent locations"
          className="quick-open-results"
          onKeyDown={handleKeyDown}
          ref={listRef}
          role="listbox"
          tabIndex={0}
        >
          {locations.length === 0 ? (
            <div className="quick-open-state">No recent locations</div>
          ) : null}
          {locations.map((location, index) => (
            <button
              aria-selected={index === activeIndex}
              className={
                index === activeIndex
                  ? "quick-open-result active"
                  : "quick-open-result"
              }
              id={optionId(location, index)}
              key={optionId(location, index)}
              onClick={() => onOpen(location)}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
              title={`${location.relativePath}:${location.line}`}
              type="button"
            >
              <MapPin aria-hidden="true" size={16} />
              <span>
                <strong>{`${location.name}:${location.line}`}</strong>
                <small className="recent-location-snippet">
                  {location.snippet}
                </small>
                <small>{location.relativePath}</small>
              </span>
            </button>
          ))}
        </div>

        <PaletteFooter />
      </section>
    </div>
  );
}
