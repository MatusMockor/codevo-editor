import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  artisanMakeCommand,
  artisanMakeGenerators,
  sanitizeArtisanMakeName,
  type ArtisanMakeGeneratorType,
} from "../domain/artisanMakeCommand";
import { PaletteFooter } from "./PaletteFooter";

interface ArtisanMakePaletteProps {
  isOpen: boolean;
  onClose(): void;
  runInActiveTerminal(command: string): void;
}

export function ArtisanMakePalette({
  isOpen,
  onClose,
  runInActiveTerminal,
}: ArtisanMakePaletteProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [selectedType, setSelectedType] =
    useState<ArtisanMakeGeneratorType | null>(null);
  const hasSubmittedRef = useRef(false);

  useEffect(() => {
    setActiveIndex(0);
    setName("");
    setQuery("");
    setSelectedType(null);
    hasSubmittedRef.current = false;
  }, [isOpen]);

  const filteredGenerators = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return artisanMakeGenerators;
    }

    return artisanMakeGenerators.filter((generator) =>
      `${generator.label} make:${generator.type}`
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!isOpen) {
    return null;
  }

  const safeName = sanitizeArtisanMakeName(name);
  const nameInvalid = name.length > 0 && !safeName;
  const activeGenerator = filteredGenerators[activeIndex];

  const selectGenerator = (type: ArtisanMakeGeneratorType) => {
    setName("");
    setSelectedType(type);
  };

  const moveSelection = (offset: number) => {
    if (filteredGenerators.length === 0) {
      return;
    }

    setActiveIndex(
      (current) =>
        (current + offset + filteredGenerators.length) %
        filteredGenerators.length,
    );
  };

  const submit = () => {
    if (!selectedType || hasSubmittedRef.current) {
      return;
    }

    const command = artisanMakeCommand(selectedType, name);

    if (!command) {
      return;
    }

    hasSubmittedRef.current = true;
    runInActiveTerminal(command);
    onClose();
  };

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="Artisan make"
        className="command-palette artisan-make-palette"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClose();
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {selectedType ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="palette-search">
              <Search aria-hidden="true" size={17} />
              <input
                aria-invalid={nameInvalid}
                autoFocus
                onChange={(event) => setName(event.currentTarget.value)}
                placeholder="Name"
                value={name}
              />
            </div>
            {!safeName ? (
              <div className="quick-open-state" role="alert">
                {nameInvalid
                  ? "Use letters, numbers, underscores, forward slashes, or backslashes."
                  : "Enter a generator name."}
              </div>
            ) : null}
            <div className="palette-results">
              <button
                className="palette-command active"
                disabled={!safeName}
                type="submit"
              >
                <span>
                  <strong>Create {selectedType}</strong>
                  <small>php artisan make:{selectedType}</small>
                </span>
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="palette-search">
              <Search aria-hidden="true" size={17} />
              <input
                autoFocus
                onChange={(event) => setQuery(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    moveSelection(1);
                    return;
                  }

                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    moveSelection(-1);
                    return;
                  }

                  if (event.key === "Enter" && activeGenerator) {
                    event.preventDefault();
                    selectGenerator(activeGenerator.type);
                  }
                }}
                placeholder="Filter generators"
                value={query}
              />
            </div>
            <div className="palette-results">
              {filteredGenerators.length === 0 ? (
                <div className="quick-open-state">No matching generators</div>
              ) : null}
              {filteredGenerators.map((generator, index) => (
                <button
                  className={
                    index === activeIndex
                      ? "palette-command active"
                      : "palette-command"
                  }
                  key={generator.type}
                  onClick={() => selectGenerator(generator.type)}
                  onMouseEnter={() => setActiveIndex(index)}
                  type="button"
                >
                  <span>
                    <strong>{generator.label}</strong>
                    <small>make:{generator.type}</small>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
        <PaletteFooter />
      </section>
    </div>
  );
}
