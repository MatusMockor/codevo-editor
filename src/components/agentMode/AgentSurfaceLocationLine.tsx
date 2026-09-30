import { ChevronRight, Folder, GitBranch, Server, type LucideIcon } from "lucide-react";
import type { AgentSurfaceLocation, AgentSurfaceLocationGlyph } from "./agentSurfaceLocation";

const GLYPHS: Readonly<Record<AgentSurfaceLocationGlyph, LucideIcon>> = {
  folder: Folder,
  branch: GitBranch,
  server: Server,
};

const LEFT_TO_RIGHT_MARK = "\u200e";

export function AgentSurfaceLocationLine({
  location,
}: {
  readonly location: AgentSurfaceLocation;
}) {
  if (location.kind === "hidden") return null;
  const Glyph = GLYPHS[location.glyph];
  return (
    <div
      aria-label={location.description}
      className="cv-rp-location"
      data-agent-surface-location={location.glyph}
      role="note"
    >
      <b className="cv-rp-location__project" title={location.projectLabel}>
        {location.projectLabel}
      </b>
      <ChevronRight aria-hidden="true" className="cv-rp-location__sep" size={11} />
      <span className="cv-rp-location__token" title={location.token}>
        <Glyph aria-hidden="true" className="cv-rp-location__glyph" size={12} />
        <span className="cv-rp-location__text">{location.token}</span>
      </span>
      {location.path !== null && (
        <span
          className="cv-rp-location__path"
          data-agent-surface-location-path=""
          title={location.path}
        >
          {`${LEFT_TO_RIGHT_MARK}${location.path}${LEFT_TO_RIGHT_MARK}`}
        </span>
      )}
    </div>
  );
}
