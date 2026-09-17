import { WrapText } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { AgentMessageCopyButton } from "./AgentMessageCopyButton";

export function AgentMarkdownCodeBlock({
  children,
  clipboard,
  code,
  language,
}: {
  readonly children: ReactNode;
  readonly clipboard: TextClipboardGateway | null;
  readonly code: string;
  readonly language: string | null;
}) {
  const [wrapped, setWrapped] = useState(true);
  return (
    <div className="agent-md__code" data-language={language ?? undefined}>
      <div className="agent-md__code-bar">
        <span className="agent-md__code-lang">{language ?? ""}</span>
        <div className="agent-md__code-actions">
          <button
            aria-label="Wrap lines"
            aria-pressed={wrapped}
            className="agent-message-copy"
            onClick={() => setWrapped((value) => !value)}
            title={wrapped ? "Disable line wrap" : "Enable line wrap"}
            type="button"
          >
            <WrapText aria-hidden="true" size={13} />
          </button>
          <AgentMessageCopyButton
            clipboard={clipboard}
            label={language === null ? "code block" : `${language} code block`}
            text={code}
          />
        </div>
      </div>
      <pre className="agent-md__code-body" data-wrap={wrapped}>
        <code>{children}</code>
      </pre>
    </div>
  );
}
