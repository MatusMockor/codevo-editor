import { Copy, Terminal, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LanguageServerPlan } from "../domain/languageServer";
import { createPhpactorSetupGuide } from "../domain/languageServerSetup";

interface LanguageServerSetupProps {
  isOpen: boolean;
  plan: LanguageServerPlan | null;
  isInstallingManagedPhpactor?: boolean;
  onInstallManagedPhpactor?(): Promise<void> | void;
  onClose(): void;
}

export function LanguageServerSetup({
  isOpen,
  onClose,
  plan,
  isInstallingManagedPhpactor,
  onInstallManagedPhpactor,
}: LanguageServerSetupProps) {
  const [copiedCommandId, setCopiedCommandId] = useState<string | null>(null);
  const clearFeedbackTimeoutIdRef = useRef<number | null>(null);
  const guide = useMemo(() => createPhpactorSetupGuide(plan), [plan]);
  const managedInstallCommand = useMemo(
    () =>
      guide?.commands.find((command) => command.id === "managed-install") ?? null,
    [guide],
  );

  useEffect(() => () => {
    if (clearFeedbackTimeoutIdRef.current !== null) {
      clearTimeout(clearFeedbackTimeoutIdRef.current);
    }
  }, []);

  const setCopyFeedbackMessage = (commandId: string) => {
    setCopiedCommandId(commandId);

    if (clearFeedbackTimeoutIdRef.current !== null) {
      clearTimeout(clearFeedbackTimeoutIdRef.current);
    }

    clearFeedbackTimeoutIdRef.current = window.setTimeout(() => {
      setCopiedCommandId(null);
      clearFeedbackTimeoutIdRef.current = null;
    }, 2200);
  };

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
        {managedInstallCommand && onInstallManagedPhpactor ? (
          <div className="setup-command-install">
            <button
              aria-busy={isInstallingManagedPhpactor || false}
              className={[
                "setup-install-command",
                isInstallingManagedPhpactor
                  ? "setup-install-command--busy"
                  : "",
              ].join(" ")}
              disabled={isInstallingManagedPhpactor}
              onClick={async (event) => {
                event.stopPropagation();

                if (isInstallingManagedPhpactor) {
                  return;
                }

                await new Promise<void>((resolve) => {
                  window.setTimeout(resolve, 0);
                });

                try {
                  await onInstallManagedPhpactor();
                } catch {
                  // handled by caller
                }
              }}
              title="Install managed engine now"
              type="button"
            >
              {isInstallingManagedPhpactor ? (
                <>
                  <span
                    aria-hidden="true"
                    className="inline-loading-indicator"
                  />
                  Installing...
                </>
              ) : (
                "Install now"
              )}
            </button>
            {isInstallingManagedPhpactor ? (
              <div
                aria-live="polite"
                aria-relevant="additions text"
                className="setup-install-progress"
                role="status"
              >
                <div className="setup-install-progress-indicator" />
              </div>
            ) : null}
          </div>
        ) : null}
        {managedInstallCommand ? (
          <h4 className="setup-manual-install-title">Manual installation</h4>
        ) : null}
        {guide.commands.map((command) => (
          <div className="setup-command-block" key={command.id}>
            <div className="setup-command">
              <Terminal aria-hidden="true" size={16} />
              <div className="setup-command-content">
                <div className="setup-command-header">
                  <strong>{command.label}</strong>
                </div>
                <div className="setup-command-line">
                  <code>{command.command}</code>
                  <div className="setup-command-copy">
                    <button
                      aria-label={`Copy ${command.label}`}
                      className="setup-copy-command"
                      onClick={async () => {
                        if (!navigator.clipboard) {
                          return;
                        }

                        try {
                          await navigator.clipboard.writeText(command.command);
                          setCopyFeedbackMessage(command.id);
                        } catch {
                          setCopiedCommandId(null);
                        }
                      }}
                      title="Copy"
                      type="button"
                    >
                      <Copy aria-hidden="true" size={15} />
                    </button>
                    {copiedCommandId === command.id ? (
                      <div
                        aria-live="polite"
                        className="setup-copy-feedback"
                        role="status"
                      >
                        Copied
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  </div>
  );
}
