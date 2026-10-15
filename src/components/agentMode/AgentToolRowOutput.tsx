import { useMemo } from "react";
import type { AgentToolRowKind } from "../../domain/agentToolRowPresentation";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { AgentCodeTokens } from "./AgentMarkdownCodeBody";
import { useRetainedHighlightedCode } from "./AgentMarkdownCodeBodyHighlight";
import { AgentMessageCopyButton } from "./AgentMessageCopyButton";
import { agentToolOutputFormat } from "./agentToolRowOutputFormat";

const RUNNING_OUTPUT_HIGHLIGHT_DELAY_MS = 150;

export function AgentToolRowOutput({
  inputSummary,
  output,
  rowKind,
  running,
  textClipboard,
}: {
  readonly inputSummary: string;
  readonly output: string;
  readonly rowKind: AgentToolRowKind;
  readonly running: boolean;
  readonly textClipboard: TextClipboardGateway | null;
}) {
  const format = useMemo(
    () => agentToolOutputFormat({ rowKind, inputSummary, output }),
    [inputSummary, output, rowKind],
  );
  const lines = useRetainedHighlightedCode(
    format.text,
    format.kind === "code" ? format.language : "plaintext",
    {
      enabled: format.kind === "code",
      delayMs: running ? RUNNING_OUTPUT_HIGHLIGHT_DELAY_MS : 0,
    },
  );
  return (
    <div className="agent-tool-row__output-frame">
      <pre
        className="agent-tool-row__output"
        data-language={format.kind === "code" ? format.language : undefined}
      >
        {lines === null ? format.text : <AgentCodeTokens lines={lines} />}
      </pre>
      {textClipboard !== null && (
        <div className="agent-tool-row__output-actions">
          <AgentMessageCopyButton clipboard={textClipboard} label="tool output" text={output} />
        </div>
      )}
    </div>
  );
}
