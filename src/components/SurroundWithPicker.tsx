import { useEffect, useRef } from "react";
import {
  surroundWithTemplates,
  type SurroundWithTemplateId,
} from "../domain/surroundWith";

interface SurroundWithPickerProps {
  isOpen: boolean;
  onClose(): void;
  onSelect(id: SurroundWithTemplateId): void;
}

/**
 * A small PhpStorm-style quick-pick listing the available "Surround With"
 * templates. It deliberately reuses the command-palette styling so it feels
 * native to the workbench. Selection is keyboard- and mouse-driven and the
 * picker dismisses itself on Escape or backdrop click.
 */
export function SurroundWithPicker({
  isOpen,
  onClose,
  onSelect,
}: SurroundWithPickerProps) {
  const firstButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    firstButtonRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="Surround with"
        className="command-palette surround-with-picker"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClose();
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-results">
          {surroundWithTemplates.map((template, index) => (
            <button
              className="palette-command"
              key={template.id}
              onClick={() => onSelect(template.id)}
              ref={index === 0 ? firstButtonRef : undefined}
              type="button"
            >
              <span>
                <strong>{template.label}</strong>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
