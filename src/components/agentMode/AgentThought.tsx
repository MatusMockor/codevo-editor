import { memo, useCallback, useId, useMemo } from "react";
import { Brain, ChevronDown } from "lucide-react";
import {
  agentThoughtPreview,
  MAX_AGENT_THOUGHT_PREVIEW_SOURCE_CHARS,
} from "../../domain/agentThoughtPreview";
import { agentMarkdownPlainReasonLabel } from "../../domain/agentMarkdown/agentMarkdownTree";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import type { AgentProseContext } from "./AgentAssistantText";
import { AgentMarkdownBlockView, type AgentMarkdownLinkActivation } from "./AgentMarkdown";
import { useAgentToolDisclosure } from "./AgentToolDisclosure";
import {
  agentThoughtDisclosureKey,
  type AgentActivityThought,
  type AgentThoughtPresentation,
} from "./agentActivityGrouping";
import { activateAgentMarkdownLink } from "./agentMarkdownLinks";
import { agentTextParagraphs } from "./agentModePresentation";
import { useAgentMarkdown } from "./useAgentMarkdown";
import "./agentThought.css";

interface AgentThoughtProps {
  readonly item: AgentActivityThought;
  readonly presentation: AgentThoughtPresentation;
  readonly prose: AgentProseContext;
  readonly textClipboard: TextClipboardGateway | null;
}

export const AgentThought = memo(function AgentThought({
  presentation,
  ...props
}: Omit<AgentThoughtProps, "presentation"> & {
  readonly presentation: AgentThoughtPresentation | null;
}) {
  const resolved = presentation ?? standaloneThought(props.item.key);
  if (resolved.layout === "body")
    return (
      <div className="agent-thought agent-thought--body">
        <AgentThoughtBody
          live={resolved.phase === "thinking"}
          prose={props.prose}
          text={props.item.text}
          textClipboard={props.textClipboard}
        />
      </div>
    );
  return <AgentThoughtRow {...props} presentation={resolved} />;
});

function standaloneThought(key: string): AgentThoughtPresentation {
  return { phase: "settled", layout: "row", disclosureKey: agentThoughtDisclosureKey("root", key) };
}

function AgentThoughtRow({ item, presentation, prose, textClipboard }: AgentThoughtProps) {
  const disclosure = useAgentToolDisclosure(presentation.disclosureKey);
  const bodyId = useId();
  const expanded = disclosure.expanded;
  const live = presentation.phase === "thinking";
  const source = item.text.slice(0, MAX_AGENT_THOUGHT_PREVIEW_SOURCE_CHARS);
  const preview = useMemo(() => agentThoughtPreview(source), [source]);

  return (
    <div className={live ? "agent-thought agent-thought--live" : "agent-thought"}>
      <button
        aria-controls={bodyId}
        aria-expanded={expanded}
        className="agent-tool-row agent-thought__toggle"
        onClick={disclosure.toggle}
        type="button"
      >
        <Brain aria-hidden="true" className="agent-tool-row__icon" size={15} />
        <span className="agent-thought__label">{live ? "Thinking" : "Thought"}</span>
        {!expanded && preview !== "" && <span className="agent-thought__preview">{preview}</span>}
        <ChevronDown aria-hidden="true" className="agent-thought__chevron" size={14} />
      </button>
      <div className="agent-thought__panel" hidden={!expanded} id={bodyId}>
        {expanded && (
          <AgentThoughtBody
            live={live}
            prose={prose}
            text={item.text}
            textClipboard={textClipboard}
          />
        )}
      </div>
    </div>
  );
}

function AgentThoughtBody({
  live,
  prose,
  text,
  textClipboard,
}: {
  readonly live: boolean;
  readonly prose: AgentProseContext;
  readonly text: string;
  readonly textClipboard: TextClipboardGateway | null;
}) {
  const presentation = useAgentMarkdown(prose.markdown, text, live, "", "parse");
  const { openExternalLink: openExternal, localFiles } = prose;
  const activateLink = useCallback<AgentMarkdownLinkActivation>(
    (event, link) => activateAgentMarkdownLink(event, link, { openExternal, localFiles }),
    [localFiles, openExternal],
  );

  if (presentation.kind === "rendered")
    return (
      <div className="agent-thought__body" data-agent-markdown="rendered">
        {presentation.blocks.map((block, index) => (
          <AgentMarkdownBlockView
            block={block}
            current={null}
            hitOffset={presentation.hitOffsets[index] ?? 0}
            key={block.key}
            onActivateLink={activateLink}
            query=""
            textClipboard={textClipboard}
          />
        ))}
      </div>
    );

  const note =
    presentation.kind === "plain" ? agentMarkdownPlainReasonLabel(presentation.reason) : null;
  return (
    <div className="agent-thought__body" data-agent-markdown={presentation.kind}>
      {agentTextParagraphs(text).map((paragraph, index) => (
        <p className="agent-text__paragraph" key={index}>
          {paragraph}
        </p>
      ))}
      {note !== null && (
        <p className="agent-note agent-md__note" role="note">
          {note}
        </p>
      )}
    </div>
  );
}
