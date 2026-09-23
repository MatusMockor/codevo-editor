import { Fragment, memo, type KeyboardEvent, type ReactNode } from "react";
import {
  agentInlineCodePathMention,
  agentProsePathMentions,
  type AgentPathMentionSegment,
} from "../../domain/agentMarkdown/agentFilePathMention";
import type { AgentMarkdownLink } from "../../domain/agentMarkdown/agentMarkdownLink";
import {
  AGENT_MARKDOWN_IMAGE_PLACEHOLDER,
  agentMarkdownCodeText,
  agentMarkdownImageLabel,
  agentMarkdownNodeHighlights,
  type AgentMarkdownBlock,
  type AgentMarkdownNode,
} from "../../domain/agentMarkdown/agentMarkdownTree";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { AgentMarkdownCodeBlock } from "./AgentMarkdownCodeBlock";
import { AgentMarkdownCodeBody } from "./AgentMarkdownCodeBody";
import type { AgentMarkdownLinkEvent } from "./agentMarkdownLinks";
import {
  MAX_AGENT_PATH_LINKS_PER_BLOCK,
  MAX_AGENT_PATH_SCAN_CHARS_PER_BLOCK,
  type AgentMarkdownPathLinks,
} from "./agentMarkdownPathLinks";
import { HighlightRun } from "./agentThreadHighlight";

const PATH_LINK_MODIFIER = "agent-md__path-link";

export type AgentMarkdownLinkActivation = (
  event: AgentMarkdownLinkEvent,
  link: AgentMarkdownLink,
) => void;

interface BlockRenderContext {
  readonly onActivateLink: AgentMarkdownLinkActivation;
  readonly query: string;
  readonly current: number | null;
  readonly textClipboard: TextClipboardGateway | null;
  readonly pathLinks: AgentMarkdownPathLinks | null;
  nextHitIndex: number;
  pathLinkBudget: number;
  pathScanBudget: number;
  insideLink: boolean;
}

export const AgentMarkdownBlockView = memo(function AgentMarkdownBlockView({
  block,
  current,
  hitOffset,
  onActivateLink,
  pathLinks = null,
  query,
  textClipboard,
}: {
  readonly block: AgentMarkdownBlock;
  readonly current: number | null;
  readonly hitOffset: number;
  readonly onActivateLink: AgentMarkdownLinkActivation;
  readonly pathLinks?: AgentMarkdownPathLinks | null;
  readonly query: string;
  readonly textClipboard: TextClipboardGateway | null;
}) {
  const context: BlockRenderContext = {
    onActivateLink,
    query,
    current,
    textClipboard,
    pathLinks,
    nextHitIndex: hitOffset,
    pathLinkBudget: MAX_AGENT_PATH_LINKS_PER_BLOCK,
    pathScanBudget: MAX_AGENT_PATH_SCAN_CHARS_PER_BLOCK,
    insideLink: false,
  };
  return (
    <>{block.nodes.map((node, index) => renderNode(node, `${block.key}n${index}`, context))}</>
  );
});

function renderNode(node: AgentMarkdownNode, key: string, context: BlockRenderContext): ReactNode {
  switch (node.kind) {
    case "text":
      return renderText(node.text, key, context);
    case "container":
      return renderContainer(node, key, context);
    case "link":
      return renderLink(node.target, renderLinkChildren(node.children, key, context), key, context);
    case "list":
      return renderList(node, key, context);
    case "cell": {
      const Tag = node.header ? "th" : "td";
      return (
        <Tag
          className={node.header ? "agent-md__th" : "agent-md__td"}
          data-align={node.align ?? undefined}
          key={key}
        >
          {renderChildren(node.children, key, context)}
        </Tag>
      );
    }
    case "codeBlock":
      return renderCodeBlock(node, key, context);
    case "image":
      return renderImage(node, key, context);
    case "checkbox":
      return (
        <input
          aria-label={node.checked ? "Completed task" : "Open task"}
          checked={node.checked}
          className="agent-md__checkbox"
          disabled
          key={key}
          readOnly
          type="checkbox"
        />
      );
    case "lineBreak":
      return <br key={key} />;
    case "rule":
      return <hr className="agent-md__rule" key={key} />;
    default:
      return unsupportedNode(node);
  }
}

function renderLinkChildren(
  children: ReadonlyArray<AgentMarkdownNode>,
  key: string,
  context: BlockRenderContext,
): ReadonlyArray<ReactNode> {
  const outer = context.insideLink;
  context.insideLink = true;
  const rendered = renderChildren(children, key, context);
  context.insideLink = outer;
  return rendered;
}

function renderText(text: string, key: string, context: BlockRenderContext): ReactNode {
  const segments = pathMentionSegments(text, context);
  if (segments !== null) return renderPathMentions(segments, key, context);
  return renderHighlightedText(text, key, context);
}

function pathMentionSegments(
  text: string,
  context: BlockRenderContext,
): ReadonlyArray<AgentPathMentionSegment> | null {
  const pathLinks = context.pathLinks;
  if (pathLinks === null || context.insideLink) return null;
  if (!text.includes("/") || text.length > context.pathScanBudget) return null;
  context.pathScanBudget -= text.length;
  const mentions = agentProsePathMentions(text, context.pathLinkBudget);
  if (mentions === null) return null;
  const segments = mentions.map((segment) =>
    segment.kind === "path" && !pathLinks.accepts(segment.link)
      ? ({ kind: "text", text: segment.text } as const)
      : segment,
  );
  if (!segments.some((segment) => segment.kind === "path")) return null;
  if (!preservesHighlights(text, segments, context.query)) return null;
  return segments;
}

function preservesHighlights(
  text: string,
  segments: ReadonlyArray<AgentPathMentionSegment>,
  query: string,
): boolean {
  const whole = agentMarkdownNodeHighlights({ kind: "text", text }, query);
  let split = 0;
  for (const segment of segments) {
    split += agentMarkdownNodeHighlights({ kind: "text", text: segment.text }, query);
  }
  return split === whole;
}

function renderPathMentions(
  segments: ReadonlyArray<AgentPathMentionSegment>,
  key: string,
  context: BlockRenderContext,
): ReactNode {
  return (
    <Fragment key={key}>
      {segments.map((segment, index) => {
        const segmentKey = `${key}m${index}`;
        const text = renderHighlightedText(segment.text, `${segmentKey}t`, context);
        if (segment.kind === "text") return text;
        context.pathLinkBudget -= 1;
        return renderLink(segment.link, text, segmentKey, context, PATH_LINK_MODIFIER);
      })}
    </Fragment>
  );
}

function renderHighlightedText(text: string, key: string, context: BlockRenderContext): ReactNode {
  const indexOffset = context.nextHitIndex;
  context.nextHitIndex += agentMarkdownNodeHighlights({ kind: "text", text }, context.query);
  return (
    <HighlightRun
      current={context.current}
      indexOffset={indexOffset}
      key={key}
      query={context.query}
      text={text}
    />
  );
}

function renderChildren(
  children: ReadonlyArray<AgentMarkdownNode>,
  key: string,
  context: BlockRenderContext,
): ReadonlyArray<ReactNode> {
  return children.map((child, index) => renderNode(child, `${key}c${index}`, context));
}

function renderInlineCode(
  node: Extract<AgentMarkdownNode, { kind: "container" }>,
  children: ReadonlyArray<ReactNode>,
  key: string,
  context: BlockRenderContext,
): ReactNode {
  const code = (
    <code className="agent-md__inline-code" key={key}>
      {children}
    </code>
  );
  const link = inlineCodePathLink(node, context);
  if (link === null) return code;
  context.pathLinkBudget -= 1;
  return renderLink(link, code, `${key}l`, context, PATH_LINK_MODIFIER);
}

function inlineCodePathLink(
  node: Extract<AgentMarkdownNode, { kind: "container" }>,
  context: BlockRenderContext,
): AgentMarkdownLink | null {
  if (context.pathLinks === null || context.insideLink || context.pathLinkBudget <= 0) return null;
  const [only, ...rest] = node.children;
  if (only?.kind !== "text" || rest.length > 0) return null;
  const link = agentInlineCodePathMention(only.text);
  if (link === null || !context.pathLinks.accepts(link)) return null;
  return link;
}

function renderContainer(
  node: Extract<AgentMarkdownNode, { kind: "container" }>,
  key: string,
  context: BlockRenderContext,
): ReactNode {
  const children =
    node.tag === "code"
      ? renderLinkChildren(node.children, key, context)
      : renderChildren(node.children, key, context);
  switch (node.tag) {
    case "p":
      return (
        <p className="agent-text__paragraph" key={key}>
          {children}
        </p>
      );
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const Tag = node.tag;
      return (
        <Tag className={`agent-md__heading agent-md__heading--${node.tag}`} key={key}>
          {children}
        </Tag>
      );
    }
    case "li":
      return (
        <li className="agent-md__item" key={key}>
          {children}
        </li>
      );
    case "blockquote":
      return (
        <blockquote className="agent-md__quote" key={key}>
          {children}
        </blockquote>
      );
    case "table":
      return (
        <div className="agent-md__table-scroll" key={key}>
          <table className="agent-md__table">{children}</table>
        </div>
      );
    case "thead":
      return <thead key={key}>{children}</thead>;
    case "tbody":
      return <tbody key={key}>{children}</tbody>;
    case "tr":
      return <tr key={key}>{children}</tr>;
    case "strong":
      return <strong key={key}>{children}</strong>;
    case "em":
      return <em key={key}>{children}</em>;
    case "del":
      return <del key={key}>{children}</del>;
    case "code":
      return renderInlineCode(node, children, key, context);
    default:
      return unsupportedTag(node.tag);
  }
}

function renderList(
  node: Extract<AgentMarkdownNode, { kind: "list" }>,
  key: string,
  context: BlockRenderContext,
): ReactNode {
  const children = renderChildren(node.children, key, context);
  if (node.ordered) {
    return (
      <ol className="agent-md__list agent-md__list--ordered" key={key} start={node.start}>
        {children}
      </ol>
    );
  }
  return (
    <ul className="agent-md__list" key={key}>
      {children}
    </ul>
  );
}

function renderCodeBlock(
  node: Extract<AgentMarkdownNode, { kind: "codeBlock" }>,
  key: string,
  context: BlockRenderContext,
): ReactNode {
  const code = agentMarkdownCodeText(node);
  const indexOffset = context.nextHitIndex;
  context.nextHitIndex += agentMarkdownNodeHighlights(node, context.query);
  return (
    <AgentMarkdownCodeBlock
      clipboard={context.textClipboard}
      code={code}
      key={key}
      language={node.language}
    >
      <AgentMarkdownCodeBody
        code={code}
        current={context.current}
        indexOffset={indexOffset}
        language={node.language}
        query={context.query}
      />
    </AgentMarkdownCodeBlock>
  );
}

function renderImage(
  node: Extract<AgentMarkdownNode, { kind: "image" }>,
  key: string,
  context: BlockRenderContext,
): ReactNode {
  const alt = agentMarkdownImageLabel(node.alt);
  const label =
    alt === null
      ? AGENT_MARKDOWN_IMAGE_PLACEHOLDER
      : renderHighlightedText(alt, `${key}l`, context);
  if (node.src === null) {
    return (
      <span className="agent-md__image" key={key}>
        {label}
      </span>
    );
  }
  return renderLink({ kind: "external", url: node.src }, label, key, context, "agent-md__image");
}

function renderLink(
  link: AgentMarkdownLink,
  children: ReactNode,
  key: string,
  context: BlockRenderContext,
  modifier?: string,
): ReactNode {
  const activate = (event: AgentMarkdownLinkEvent): void => context.onActivateLink(event, link);
  const scripted = link.kind === "localFile";
  const activateByKey = (event: KeyboardEvent<HTMLAnchorElement>): void => {
    if (event.key !== "Enter") return;
    activate(event);
  };
  return (
    <a
      className={modifier === undefined ? "agent-md__link" : `agent-md__link ${modifier}`}
      data-agent-link={link.kind}
      href={agentMarkdownLinkHref(link)}
      key={key}
      onAuxClick={activate}
      onClick={activate}
      onKeyDown={scripted ? activateByKey : undefined}
      rel="noopener"
      role={scripted ? "link" : undefined}
      tabIndex={scripted ? 0 : undefined}
    >
      {children}
    </a>
  );
}

function agentMarkdownLinkHref(link: AgentMarkdownLink): string | undefined {
  switch (link.kind) {
    case "external":
      return link.url;
    case "localFile":
    case "none":
      return undefined;
    default:
      return unsupportedLink(link);
  }
}

function unsupportedLink(link: never): never {
  throw new Error(`Unsupported markdown link: ${String(link)}`);
}

function unsupportedNode(node: never): never {
  throw new Error(`Unsupported markdown node: ${String(node)}`);
}

function unsupportedTag(tag: never): never {
  throw new Error(`Unsupported markdown container: ${String(tag)}`);
}
