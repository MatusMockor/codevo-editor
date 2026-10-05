import { ArrowUp } from "lucide-react";
import { AgentProviderGlyph } from "../agentMode/AgentProviderGlyph";
import type { AgentNewThreadPreview as AgentNewThreadPreviewModel } from "./agentNewThreadDefaultsPresentation";

export interface AgentNewThreadPreviewProps {
  readonly preview: AgentNewThreadPreviewModel;
}

export function AgentNewThreadPreview({ preview }: AgentNewThreadPreviewProps) {
  return (
    <div className="settings-thread-preview">
      <p className="settings-thread-preview__caption">A new thread opens like this</p>
      <div aria-label={preview.summary} className="settings-thread-preview__composer" role="img">
        <span aria-hidden="true" className="settings-thread-preview__placeholder">
          Ask for changes, send follow-ups, or attach images
        </span>
        <span aria-hidden="true" className="settings-thread-preview__chips">
          {preview.chips.map((chip) => (
            <span
              className="settings-thread-preview__chip"
              data-chip={chip.kind}
              key={chip.kind}
              title={chip.label}
            >
              {chip.kind === "provider" ? (
                <AgentProviderGlyph decorative kind={preview.provider} />
              ) : null}
              <span className="settings-thread-preview__chip-label">{chip.label}</span>
            </span>
          ))}
          <span className="settings-thread-preview__send">
            <ArrowUp size={14} />
          </span>
        </span>
      </div>
    </div>
  );
}
