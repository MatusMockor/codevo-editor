import { Copy, Terminal, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { LanguageServerPlan } from "../domain/languageServer";
import { createPhpactorSetupGuide } from "../domain/languageServerSetup";

interface LanguageServerSetupProps {
  isOpen: boolean;
  plan: LanguageServerPlan | null;
  onClose(): void;
}

export function LanguageServerSetup({
  isOpen,
  onClose,
  plan,
}: LanguageServerSetupProps) {
  const [copiedCommandId, setCopiedCommandId] = useState<string | null>(null);
  const guide = useMemo(() => createPhpactorSetupGuide(plan), [plan]);

  if (!isOpen || !guide) {
    return null;
  }

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label={guide.title}
        className="language-server-setup"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="setup-header">
          <span>{guide.title}</span>
          <button onClick={onClose} title="Close" type="button">
            <X aria-hidden="true" size={16} />
          </button>
        </header>

        <div className="setup-body">
          <p>{guide.message}</p>
          {guide.commands.map((command) => (
            <div className="setup-command" key={command.id}>
              <Terminal aria-hidden="true" size={16} />
              <span>
                <strong>{command.label}</strong>
                <code>{command.command}</code>
              </span>
              <button
                aria-label={`Copy ${command.label}`}
                onClick={async () => {
                  if (!navigator.clipboard) {
                    return;
                  }

                  try {
                    await navigator.clipboard.writeText(command.command);
                    setCopiedCommandId(command.id);
                  } catch {
                    setCopiedCommandId(null);
                  }
                }}
                title="Copy"
                type="button"
              >
                <Copy aria-hidden="true" size={15} />
              </button>
              {copiedCommandId === command.id ? <small>Copied</small> : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
