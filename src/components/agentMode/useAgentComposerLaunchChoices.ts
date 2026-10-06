import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import type { LaunchChoice, LaunchScope } from "./agentComposerLaunch";

const MAX_CHOICES = 64;
type ChoiceOrigin = "chosen" | "displayed";
interface OriginChoice extends LaunchChoice {
  readonly origin: ChoiceOrigin;
}
interface Choices {
  readonly scopes: ReadonlyMap<string, OriginChoice>;
  readonly lastDraft: { readonly environment: string; readonly choice: LaunchChoice } | null;
}
interface LatestDraft {
  readonly environment: string;
  readonly choice: OriginChoice;
}

/** Remember visited draft choices without transferring an existing conversation's provider. */
export function useAgentComposerLaunchChoices(
  scope: LaunchScope,
  displayedDefault: AgentLaunchOptions | null = null,
) {
  const [choices, setChoices] = useState<Choices>(() => ({ scopes: new Map(), lastDraft: null }));
  const latestDraft = useRef<LatestDraft | null>(null);
  const isDraft = !scope.key.startsWith("thread:");
  const environment = draftEnvironment(scope.rootKey);
  const remembered = honoredChoice(choices.scopes.get(scope.key) ?? null, displayedDefault);
  const carried = isDraft
    ? carriedDraftChoice(latestDraft.current, environment, displayedDefault)
    : null;
  const inherited = remembered === null ? carried : null;
  const inheritedLaunch = inherited?.launch ?? null;
  const inheritedOrigin = inherited?.origin ?? null;
  const choice: LaunchChoice | null =
    remembered ?? (inheritedLaunch === null ? null : { key: scope.key, launch: inheritedLaunch });
  useLayoutEffect(() => {
    if (inheritedLaunch === null || inheritedOrigin === null) return;
    const next = { key: scope.key, launch: inheritedLaunch, origin: inheritedOrigin };
    setChoices((previous) =>
      supersedesStoredChoice(previous.scopes.get(scope.key) ?? null, next)
        ? { ...previous, scopes: rememberChoice(previous.scopes, next) }
        : previous,
    );
  }, [scope.key, inheritedLaunch, inheritedOrigin]);
  const unchosen = choice === null;
  // Defaults may hydrate asynchronously. Keep them live for this draft; retain only a
  // snapshot for a future environment switch rather than freezing the current fallback.
  useLayoutEffect(() => {
    if (!isDraft || !unchosen || displayedDefault === null) return;
    latestDraft.current = {
      environment,
      choice: { key: scope.key, launch: displayedDefault, origin: "displayed" },
    };
  }, [isDraft, unchosen, displayedDefault, environment, scope.key]);
  const change = useCallback(
    (launch: AgentLaunchOptions) => {
      const next: OriginChoice = { key: scope.key, launch, origin: "chosen" };
      if (isDraft) latestDraft.current = { environment, choice: next };
      setChoices((previous) => {
        const scopes = rememberChoice(previous.scopes, next);
        return {
          scopes,
          lastDraft: isDraft ? { environment, choice: next } : previous.lastDraft,
        };
      });
    },
    [scope.key, isDraft, environment],
  );
  const resetDraft = useCallback((rootKey: string | null) => {
    latestDraft.current = null;
    const key = rootKey === null ? "draft" : `root:${rootKey}`;
    setChoices((previous) => {
      const scopes = new Map(previous.scopes);
      scopes.delete(key);
      return { scopes, lastDraft: null };
    });
  }, []);
  return { choice, change, resetDraft };
}

function honoredChoice(
  stored: OriginChoice | null,
  displayedDefault: AgentLaunchOptions | null,
): OriginChoice | null {
  if (stored === null) return null;
  if (stored.origin === "displayed" && displayedDefault === null) return null;
  return stored;
}

function carriedDraftChoice(
  latest: LatestDraft | null,
  environment: string,
  displayedDefault: AgentLaunchOptions | null,
): OriginChoice | null {
  if (latest === null) return null;
  if (latest.environment === environment) return null;
  return honoredChoice(latest.choice, displayedDefault);
}

function supersedesStoredChoice(stored: OriginChoice | null, next: OriginChoice): boolean {
  if (stored === null) return true;
  return stored.origin === "displayed" && next.origin === "chosen";
}

function draftEnvironment(rootKey: string | null): string {
  if (rootKey?.startsWith("remote:") !== true) return "local";
  // Encoded server IDs contain no separators, so the prefix keeps server identity exact.
  return rootKey.split(":").slice(0, 2).join(":");
}

function rememberChoice(previous: ReadonlyMap<string, OriginChoice>, choice: OriginChoice) {
  const scopes = new Map(previous);
  scopes.delete(choice.key);
  scopes.set(choice.key, choice);
  while (scopes.size > MAX_CHOICES) scopes.delete(scopes.keys().next().value!);
  return scopes;
}
