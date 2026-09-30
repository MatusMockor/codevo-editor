import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentLocalFileLinkFailure } from "../../domain/agentMarkdown/agentLocalFileLinkFailure";
import type { AgentMarkdownLinkActivation } from "./AgentMarkdown";
import {
  activateAgentMarkdownLink,
  agentLocalFileLinkKey,
  type AgentExternalLinkOpener,
  type AgentLocalFileLinkMemory,
  type AgentLocalFileLinkScope,
  type AgentUnavailableLinks,
} from "./agentMarkdownLinks";

export const MAX_REMEMBERED_UNAVAILABLE_LINKS = 32;

export interface AgentMarkdownLinkActivationState {
  readonly activateLink: AgentMarkdownLinkActivation;
  readonly unavailableLinks: AgentUnavailableLinks | null;
}

interface RememberedLinks {
  readonly scope: AgentLocalFileLinkScope | null;
  readonly failures: AgentUnavailableLinks;
}

const NO_FAILURES: AgentUnavailableLinks = new Map();

export function useAgentMarkdownLinkActivation(
  openExternal: AgentExternalLinkOpener,
  localFiles: AgentLocalFileLinkScope | null,
): AgentMarkdownLinkActivationState {
  const [remembered, setRemembered] = useState<RememberedLinks>({
    scope: localFiles,
    failures: NO_FAILURES,
  });
  const latestScope = useRef(localFiles);
  useLayoutEffect(() => {
    latestScope.current = localFiles;
  }, [localFiles]);
  const failures = remembered.scope === localFiles ? remembered.failures : NO_FAILURES;
  const memory = useMemo<AgentLocalFileLinkMemory>(
    () => ({
      failureFor: (link) => failures.get(agentLocalFileLinkKey(link)) ?? null,
      remember: (link, failure) => {
        if (latestScope.current !== localFiles) return;
        setRemembered((current) =>
          rememberFailure(current, localFiles, agentLocalFileLinkKey(link), failure),
        );
      },
    }),
    [failures, localFiles],
  );
  const activateLink = useCallback<AgentMarkdownLinkActivation>(
    (event, link) => activateAgentMarkdownLink(event, link, { openExternal, localFiles, memory }),
    [localFiles, memory, openExternal],
  );
  return { activateLink, unavailableLinks: failures.size === 0 ? null : failures };
}

function rememberFailure(
  current: RememberedLinks,
  scope: AgentLocalFileLinkScope | null,
  key: string,
  failure: AgentLocalFileLinkFailure | null,
): RememberedLinks {
  const base = current.scope === scope ? current.failures : NO_FAILURES;
  if (failure === null && !base.has(key)) return current;
  const next = new Map(base);
  next.delete(key);
  if (failure !== null) next.set(key, failure);
  while (next.size > MAX_REMEMBERED_UNAVAILABLE_LINKS) {
    const oldest = next.keys().next().value;
    if (oldest === undefined) break;
    next.delete(oldest);
  }
  return { scope, failures: next };
}
