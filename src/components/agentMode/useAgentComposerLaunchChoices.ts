import { useCallback, useLayoutEffect, useState } from "react";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import type { LaunchChoice, LaunchScope } from "./agentComposerLaunch";

const MAX_CHOICES = 64;
interface Choices {
  readonly scopes: ReadonlyMap<string, LaunchChoice>;
  readonly lastDraft: { readonly environment: string; readonly choice: LaunchChoice } | null;
}

/** Remember visited draft choices without transferring an existing conversation's provider. */
export function useAgentComposerLaunchChoices(scope: LaunchScope) {
  const [choices, setChoices] = useState<Choices>(() => ({ scopes: new Map(), lastDraft: null }));
  const isDraft = !scope.key.startsWith("thread:");
  const environment = draftEnvironment(scope.rootKey);
  const remembered = choices.scopes.get(scope.key);
  const inherited =
    isDraft && choices.lastDraft !== null && choices.lastDraft.environment !== environment
      ? { key: scope.key, launch: choices.lastDraft.choice.launch }
      : null;
  const choice = remembered ?? inherited;
  const inheritedLaunch = remembered === undefined ? (inherited?.launch ?? null) : null;
  useLayoutEffect(() => {
    if (inheritedLaunch === null) return;
    setChoices((previous) =>
      previous.scopes.has(scope.key)
        ? previous
        : {
            ...previous,
            scopes: rememberChoice(previous.scopes, { key: scope.key, launch: inheritedLaunch }),
          },
    );
  }, [scope.key, inheritedLaunch]);
  const change = useCallback(
    (launch: AgentLaunchOptions) => {
      setChoices((previous) => {
        const next = { key: scope.key, launch };
        const scopes = rememberChoice(previous.scopes, next);
        return {
          scopes,
          lastDraft: isDraft ? { environment, choice: next } : previous.lastDraft,
        };
      });
    },
    [scope.key, isDraft, environment],
  );
  return { choice, change };
}

function draftEnvironment(rootKey: string | null): string {
  if (rootKey?.startsWith("remote:") !== true) return "local";
  // Encoded server IDs contain no separators, so the prefix keeps server identity exact.
  return rootKey.split(":").slice(0, 2).join(":");
}

function rememberChoice(previous: ReadonlyMap<string, LaunchChoice>, choice: LaunchChoice) {
  const scopes = new Map(previous);
  scopes.delete(choice.key);
  scopes.set(choice.key, choice);
  while (scopes.size > MAX_CHOICES) scopes.delete(scopes.keys().next().value!);
  return scopes;
}
