import { memo, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Folder,
  FolderOpen,
  GitBranch,
  Server,
  SquarePen,
  type LucideIcon,
} from "lucide-react";
import { detectKeymapPlatform } from "../../domain/keymap";
import { Popover } from "../../ui/foundation/Popover";
import { agentArtifactRevealLabel } from "./agentArtifactSupport";
import type { AgentSurfaceLocationGlyph } from "./agentSurfaceLocation";
import { agentShortcutGlyphs } from "./agentThreadHeaderPresentation";
import type { AgentWorkspaceCard as AgentWorkspaceCardModel } from "./agentWorkspaceCardModel";
import "./agentSidebar.css";

const GLYPHS: Readonly<Record<AgentSurfaceLocationGlyph, LucideIcon>> = {
  folder: Folder,
  branch: GitBranch,
  server: Server,
};

const DETAILS_LABEL = "Workspace details";
const NEW_THREAD_IN_LABEL = "New thread in…";
const THREAD_TITLE = "Where the selected thread runs. Click for New thread in… and details.";
const DRAFT_TITLE = "Where this draft will run. Click for New thread in… and details.";
const LEFT_TO_RIGHT_MARK = "‎";

export interface AgentWorkspaceCardProps {
  readonly card: AgentWorkspaceCardModel | null;
  readonly newThreadInShortcut: string;
  onNewThreadIn(): void;
  onReveal(path: string): void;
}

export const AgentWorkspaceCard = memo(function AgentWorkspaceCard({
  card,
  newThreadInShortcut,
  onNewThreadIn,
  onReveal,
}: AgentWorkspaceCardProps) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const revealLabel = useMemo(() => agentArtifactRevealLabel(detectKeymapPlatform()), []);
  if (card === null) return null;
  const Glyph = GLYPHS[card.glyph];
  const close = (): void => setOpen(false);
  const chooseNewThreadIn = (): void => {
    close();
    onNewThreadIn();
  };
  const revealPath = card.revealPath;
  return (
    <div className="cv-sb-ws-slot">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={card.accessibleLabel}
        className="cv-sb-ws"
        data-open={open ? "true" : undefined}
        data-state={card.state}
        onClick={() => setOpen((current) => !current)}
        ref={anchorRef}
        title={card.state === "draft" ? DRAFT_TITLE : THREAD_TITLE}
        type="button"
      >
        <span aria-hidden="true" className="cv-favicon cv-favicon--lg" data-glyph={card.glyph}>
          {card.glyph === "server" ? <Server size={12} /> : card.monogram}
        </span>
        <span className="cv-sb-ws__text">
          <span className="cv-sb-ws__top">
            <b className="cv-sb-ws__project">{card.projectLabel}</b>
            <ChevronDown aria-hidden="true" className="cv-sb-ws__chev" size={13} />
          </span>
          <span className="cv-sb-ws__loc" data-glyph={card.glyph}>
            <Glyph aria-hidden="true" className="cv-sb-ws__glyph" size={12} />
            <b className="cv-sb-ws__lead">{card.lead}</b>
            {card.rest !== null && <span className="cv-sb-ws__rest">{`· ${card.rest}`}</span>}
          </span>
        </span>
      </button>
      <Popover
        anchorRef={anchorRef}
        className="cv-sb-wsmenu"
        label={DETAILS_LABEL}
        onClose={close}
        open={open}
        placement="bottom-start"
      >
        <button autoFocus className="cv-menu__item" onClick={chooseNewThreadIn} type="button">
          <span aria-hidden="true" className="cv-menu__icon">
            <SquarePen size={14} />
          </span>
          <span className="cv-menu__text">{NEW_THREAD_IN_LABEL}</span>
          {newThreadInShortcut !== "" && (
            <span className="cv-menu__end">{agentShortcutGlyphs(newThreadInShortcut)}</span>
          )}
        </button>
        <div className="cv-menu__separator" role="separator" />
        <p className="cv-menu__label">{card.state === "draft" ? "This draft" : "This thread"}</p>
        <dl className="cv-sb-wsmenu__details">
          <dt>Runs on</dt>
          <dd>{card.details.machine}</dd>
          <dt>Checkout</dt>
          <dd>{card.details.checkout}</dd>
          {card.details.branch !== null && (
            <>
              <dt>Branch</dt>
              <dd className="cv-sb-wsmenu__mono">{card.details.branch}</dd>
            </>
          )}
          {card.details.relation !== null && (
            <>
              <dt>Status</dt>
              <dd>{card.details.relation}</dd>
            </>
          )}
          {card.details.path !== null && (
            <>
              <dt>Path</dt>
              <dd className="cv-sb-wsmenu__mono" title={card.details.path}>
                {`${LEFT_TO_RIGHT_MARK}${card.details.path}${LEFT_TO_RIGHT_MARK}`}
              </dd>
            </>
          )}
        </dl>
        {revealPath !== null && (
          <button
            className="cv-menu__item"
            onClick={() => {
              close();
              onReveal(revealPath);
            }}
            type="button"
          >
            <span aria-hidden="true" className="cv-menu__icon">
              <FolderOpen size={14} />
            </span>
            <span className="cv-menu__text">{revealLabel}</span>
          </button>
        )}
      </Popover>
    </div>
  );
});
