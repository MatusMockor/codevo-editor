import { Boxes, CornerDownLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { ImplementationTarget } from "../domain/implementationTargets";

interface ImplementationChooserProps {
  isOpen: boolean;
  targets: ImplementationTarget[];
  title: string;
  onClose(): void;
  onOpen(target: ImplementationTarget): void;
}

export function ImplementationChooser({
  isOpen,
  onClose,
  onOpen,
  targets,
  title,
}: ImplementationChooserProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLElement | null>(null);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  const activeTarget = targets[activeIndex];

  useEffect(() => {
    if (!isOpen) {
      setActiveIndex(0);
      return;
    }

    containerRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex((current) =>
      Math.min(current, Math.max(targets.length - 1, 0)),
    );
  }, [targets.length]);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({
      block: "nearest",
    });
  }, [activeIndex]);

  if (!isOpen) {
    return null;
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) =>
        Math.min(current + 1, Math.max(targets.length - 1, 0)),
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter" && activeTarget) {
      event.preventDefault();
      onOpen(activeTarget);
    }
  };

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label={title}
        aria-modal="true"
        className="implementation-chooser"
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        ref={containerRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="implementation-chooser-header">
          <strong>{title}</strong>
          <CornerDownLeft aria-hidden="true" size={15} />
        </header>

        <div className="implementation-chooser-results" role="listbox">
          {targets.map((target, index) => (
            <button
              aria-selected={index === activeIndex}
              className={
                index === activeIndex
                  ? "implementation-choice active"
                  : "implementation-choice"
              }
              key={target.id}
              onClick={() => onOpen(target)}
              onMouseEnter={() => setActiveIndex(index)}
              ref={index === activeIndex ? activeRowRef : undefined}
              role="option"
              title={`${target.detail} ${target.path}`}
              type="button"
            >
              <Boxes aria-hidden="true" size={15} />
              <span>
                <strong>{target.label}</strong>
                <small>{target.detail}</small>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
