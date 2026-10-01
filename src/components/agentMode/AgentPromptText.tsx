import { Fragment, memo, useMemo, type MouseEvent, type ReactNode } from "react";
import { agentPromptLinkSegments, type AgentPromptSegment } from "../../domain/agentPromptLinks";
import { highlightRanges } from "../../domain/agentThreadHighlight";
import type { AgentThreadSearchRange } from "../../domain/agentThreadSearch";
import {
  activateAgentMarkdownLink,
  type AgentExternalLinkOpener,
  type AgentMarkdownLinkEvent,
} from "./agentMarkdownLinks";
import { HighlightRun } from "./agentThreadHighlight";
import { highlightSliceNodes } from "./agentThreadHighlightSlice";

export interface AgentPromptTextProps {
  readonly current: number | null;
  readonly openExternalLink: AgentExternalLinkOpener | null;
  readonly query: string;
  readonly text: string;
}

export const AgentPromptText = memo(function AgentPromptText({
  current,
  openExternalLink,
  query,
  text,
}: AgentPromptTextProps) {
  const segments = useMemo(
    () => (openExternalLink === null ? null : agentPromptLinkSegments(text)),
    [openExternalLink, text],
  );
  const ranges = useMemo(() => highlightRanges(text, query), [query, text]);
  if (openExternalLink === null || segments === null || !segments.some(isLink)) {
    return <HighlightRun current={current} query={query} text={text} />;
  }
  return (
    <>
      {segments.map((segment) => (
        <Fragment key={segment.start}>
          {promptSegment(segment, text, ranges, current, openExternalLink)}
        </Fragment>
      ))}
    </>
  );
});

function promptSegment(
  segment: AgentPromptSegment,
  text: string,
  ranges: ReadonlyArray<AgentThreadSearchRange>,
  current: number | null,
  openExternalLink: AgentExternalLinkOpener,
): ReactNode {
  const nodes = highlightSliceNodes(text, segment, ranges, current);
  switch (segment.kind) {
    case "text":
      return nodes;
    case "link":
      return (
        <AgentPromptLink openExternalLink={openExternalLink} url={segment.url}>
          {nodes}
        </AgentPromptLink>
      );
    default:
      return unsupportedSegment(segment);
  }
}

function AgentPromptLink({
  children,
  openExternalLink,
  url,
}: {
  readonly children: ReactNode;
  readonly openExternalLink: AgentExternalLinkOpener;
  readonly url: string;
}) {
  const activate = (event: AgentMarkdownLinkEvent): void =>
    activateAgentMarkdownLink(
      event,
      { kind: "external", url },
      { openExternal: openExternalLink, localFiles: null },
    );
  return (
    <a
      className="agent-prompt__link"
      data-agent-link="external"
      href={url}
      onAuxClick={activate}
      onClick={activate}
      onContextMenu={suppressNativeLinkMenu}
      rel="noopener noreferrer"
      title={url}
    >
      {children}
    </a>
  );
}

function suppressNativeLinkMenu(event: MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault();
}

function isLink(segment: AgentPromptSegment): boolean {
  return segment.kind === "link";
}

function unsupportedSegment(segment: never): never {
  throw new TypeError(`Unsupported prompt segment: ${JSON.stringify(segment)}.`);
}
