import { useEffect, useRef } from "react";
import type { AgentHistoryCatalogSurface } from "../../application/useAgentHistoryCatalog";
import { Button } from "../../ui/foundation/Button";
import "./agentHistoryCatalog.css";

export function AgentHistoryCatalog({
  catalog,
  onSelect,
}: {
  readonly catalog: AgentHistoryCatalogSurface;
  readonly onSelect: (threadId: string) => void;
}) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const page = catalog.page;
  if (catalog.projects.length === 0) return null;
  return (
    <section aria-label="Saved conversations" className="agent-history-catalog">
      <Button
        aria-expanded={page !== null}
        onClick={() => {
          if (page) catalog.close();
          else void catalog.choose(catalog.projects[0].rootKey);
        }}
        size="sm"
        variant="ghost"
      >
        Saved conversations
      </Button>
      {page && (
        <>
          <label>
            Project{" "}
            <select
              aria-label="Saved conversation project"
              value={page.rootKey}
              onChange={(event) => void catalog.choose(event.target.value)}
            >
              {catalog.projects.map((project) => (
                <option key={project.rootKey} value={project.rootKey}>
                  {project.label}
                </option>
              ))}
            </select>
          </label>
          {page.loading && <p role="status">Loading saved conversations…</p>}
          {page.error && <p role="alert">{page.error}</p>}
          <ul>
            {page.threads.map((thread) => (
              <li key={thread.threadId}>
                <button
                  type="button"
                  disabled={page.loading}
                  onClick={() => {
                    void catalog.open(thread.threadId).then((opened) => {
                      if (opened && mounted.current) onSelect(thread.threadId);
                    });
                  }}
                >
                  {thread.title || "Untitled conversation"}
                </button>
              </li>
            ))}
          </ul>
          {!page.loading && !page.error && page.threads.length === 0 && (
            <p>No saved conversations.</p>
          )}
          <Button
            disabled={page.loading || !page.hasEarlier}
            onClick={() => void catalog.older()}
            size="sm"
            variant="ghost"
          >
            Older conversations
          </Button>
          <Button
            disabled={page.loading}
            onClick={() => void catalog.latest()}
            size="sm"
            variant="ghost"
          >
            Back to newest
          </Button>
        </>
      )}
    </section>
  );
}
