import type { ReactElement } from "react";
import { agentProviderLabel } from "./agentMode/agentSidebarPresentation";
import {
  agentProviderUpdateVersionTransition,
  type AgentProviderUpdateToastView,
} from "./agentProviderUpdateToastPresenter";

export function AgentProviderUpdateRows({
  views,
}: {
  readonly views: readonly AgentProviderUpdateToastView[];
}): ReactElement {
  return (
    <ul className="toast-update-rows">
      {views.map((view) => (
        <AgentProviderUpdateRow key={view.provider} view={view} />
      ))}
    </ul>
  );
}

function AgentProviderUpdateRow({
  view,
}: {
  readonly view: AgentProviderUpdateToastView;
}): ReactElement {
  const version = agentProviderUpdateVersionTransition(view);
  return (
    <li className="toast-update-row">
      <span className="toast-update-row__label">
        <span className="toast-update-row__provider">{agentProviderLabel(view.provider)}</span>
        {view.manual ? <span className="toast-update-row__note">Manual update</span> : null}
      </span>
      <span className="toast-update-row__version">
        {version.from === null ? null : (
          <>
            <span className="toast-update-row__from">{version.from}</span>
            <span aria-hidden="true" className="toast-update-row__arrow">
              →
            </span>
            <span className="toast-visually-hidden"> to </span>
          </>
        )}
        <span className="toast-update-row__to">{version.to}</span>
      </span>
    </li>
  );
}
