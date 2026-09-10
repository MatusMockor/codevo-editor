import { memo, type ReactNode } from "react";
import {
  AGENT_MARKDOWN_IMAGE_PLACEHOLDER,
  agentMarkdownCodeText,
  agentMarkdownImageLabel,
  agentMarkdownNodeHighlights,
  type AgentMarkdownBlock,
  type AgentMarkdownNode,
} from "../../domain/agentMarkdown/agentMarkdownTree";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { AgentMessageCopyButton } from "./AgentMessageCopyButton";
import { HighlightRun } from "./agentThreadHighlight";

interface BlockRenderContext {
  readonly query: string;
  readonly current: number | null;
  readonly textClipboard: TextClipboardGateway | null;
  nextHitIndex: number;
}

export const AgentMarkdownBlockView = memo(function AgentMarkdownBlockView({
  block,
  current,
  hitOffset,
  query,
  textClipboard,
}: {
  readonly block: AgentMarkdownBlock;
  readonly current: number | null;
  readonly hitOffset: number;
  readonly query: string;
  readonly textClipboard: TextClipboardGateway | null;
}) {
  const context: BlockRenderContext = {
    query,
    current,
    textClipboard,
    nextHitIndex: hitOffset,
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
      return (
        <a className="agent-md__link" href={node.href ?? undefined} key={key} rel="noopener">
          {renderChildren(node.children, key, context)}
        </a>
      );
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

function renderText(text: string, key: string, context: BlockRenderContext): ReactNode {
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

function renderContainer(
  node: Extract<AgentMarkdownNode, { kind: "container" }>,
  key: string,
  context: BlockRenderContext,
): ReactNode {
  const children = renderChildren(node.children, key, context);
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
      return (
        <code className="agent-md__inline-code" key={key}>
          {children}
        </code>
      );
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
    <div className="agent-md__code" data-language={node.language ?? undefined} key={key}>
      <div className="agent-md__code-bar">
        <span className="agent-md__code-lang">{node.language ?? ""}</span>
        <AgentMessageCopyButton
          clipboard={context.textClipboard}
          label={node.language === null ? "code block" : `${node.language} code block`}
          text={code}
        />
      </div>
      <pre className="agent-md__code-body">
        <code>
          <HighlightRun
            current={context.current}
            indexOffset={indexOffset}
            query={context.query}
            text={code}
          />
        </code>
      </pre>
    </div>
  );
}

function renderImage(
  node: Extract<AgentMarkdownNode, { kind: "image" }>,
  key: string,
  context: BlockRenderContext,
): ReactNode {
  const alt = agentMarkdownImageLabel(node.alt);
  const label =
    alt === null ? AGENT_MARKDOWN_IMAGE_PLACEHOLDER : renderText(alt, `${key}l`, context);
  if (node.src === null) {
    return (
      <span className="agent-md__image" key={key}>
        {label}
      </span>
    );
  }
  return (
    <a className="agent-md__link agent-md__image" href={node.src} key={key} rel="noopener">
      {label}
    </a>
  );
}

function unsupportedNode(node: never): never {
  throw new Error(`Unsupported markdown node: ${String(node)}`);
}

function unsupportedTag(tag: never): never {
  throw new Error(`Unsupported markdown container: ${String(tag)}`);
}
