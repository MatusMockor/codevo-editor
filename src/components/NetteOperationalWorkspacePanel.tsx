import type { ReactNode } from "react";
import type { NetteOperationalSection } from "../application/netteOperationalPanelModel";
import type { NetteWorkspacePanelProps } from "./NetteWorkspacePanel";
import { NetteWorkspacePanel } from "./NetteWorkspacePanel";
import type { NetteWorkspacePresentersPanelProps } from "./NetteWorkspacePresentersPanel";
import { NetteWorkspacePresentersPanel } from "./NetteWorkspacePresentersPanel";
import type { NetteWorkspaceRoutesPanelProps } from "./NetteWorkspaceRoutesPanel";
import { NetteWorkspaceRoutesPanel } from "./NetteWorkspaceRoutesPanel";

export interface NetteOperationalWorkspacePanelProps {
  readonly activeSection: NetteOperationalSection;
  readonly onSectionChange: (section: NetteOperationalSection) => void;
  readonly presenters: NetteWorkspacePresentersPanelProps;
  readonly routes: NetteWorkspaceRoutesPanelProps;
  readonly services: NetteWorkspacePanelProps;
}

export function NetteOperationalWorkspacePanel({
  activeSection,
  onSectionChange,
  presenters,
  routes,
  services,
}: NetteOperationalWorkspacePanelProps): ReactNode {
  return (
    <section aria-label="Nette workspace" className="nette-operational-panel">
      <div
        aria-label="Nette intelligence sections"
        className="symfony-workspace-tabs"
        role="tablist"
      >
        {(["services", "presenters", "routes"] as const).map((section) => (
          <button
            aria-selected={activeSection === section}
            className={activeSection === section ? "bottom-panel-tab active" : "bottom-panel-tab"}
            key={section}
            onClick={() => onSectionChange(section)}
            role="tab"
            type="button"
          >
            {section === "services"
              ? "Services"
              : section === "presenters"
                ? "Presenters"
                : "Routes"}
          </button>
        ))}
      </div>
      {activeSection === "services" ? (
        <NetteWorkspacePanel {...services} />
      ) : activeSection === "presenters" ? (
        <NetteWorkspacePresentersPanel {...presenters} />
      ) : (
        <NetteWorkspaceRoutesPanel {...routes} />
      )}
    </section>
  );
}
