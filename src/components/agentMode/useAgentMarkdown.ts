import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { createAgentMarkdownSession } from "../../application/agentMarkdownSession";
import { sharedAgentMarkdownDocumentCache } from "../../application/agentMarkdownDocumentCache";
import type { AgentMarkdownViewport } from "../../application/agentMarkdownViewport";
import type { AgentMarkdownRenderer } from "../../domain/agentMarkdown/agentMarkdownRenderer";
import {
  resolveAgentMarkdownPresentation,
  type AgentMarkdownPresentation,
  type AgentMarkdownView,
} from "../../domain/agentMarkdown/agentMarkdownTree";
import {
  loadAgentMarkdownRenderer,
  peekAgentMarkdownRenderer,
  subscribeAgentMarkdownRenderer,
} from "../../infrastructure/markdown/agentMarkdownRendererAdapter";

export type AgentMarkdownGate = "parse" | "defer";

export type AgentMarkdownRendererState =
  | { readonly kind: "ready"; readonly renderer: AgentMarkdownRenderer }
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable" };

const DEFERRED: AgentMarkdownPresentation = { kind: "deferred" };
const PENDING: AgentMarkdownPresentation = { kind: "pending" };
const UNAVAILABLE: AgentMarkdownPresentation = { kind: "plain", reason: "renderer-unavailable" };
const LOADING: AgentMarkdownRendererState = { kind: "loading" };
const UNAVAILABLE_RENDERER: AgentMarkdownRendererState = { kind: "unavailable" };

function peekNothing(): null {
  return null;
}

export function usePreloadAgentMarkdownRenderer(): void {
  useEffect(() => {
    loadAgentMarkdownRenderer().catch(() => undefined);
  }, []);
}

export function useAgentMarkdownRenderer(
  override: AgentMarkdownRenderer | null | undefined,
): AgentMarkdownRendererState {
  const loaded = useSyncExternalStore(
    subscribeAgentMarkdownRenderer,
    peekAgentMarkdownRenderer,
    peekNothing,
  );
  const overridden = override !== undefined && override !== null;
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (overridden) return;
    let owned = true;
    loadAgentMarkdownRenderer().catch(() => {
      if (!owned) return;
      setUnavailable(true);
    });
    return () => {
      owned = false;
    };
  }, [overridden]);

  return useMemo(() => {
    const active = override ?? loaded;
    if (active !== null && active !== undefined) return { kind: "ready", renderer: active };
    if (unavailable) return UNAVAILABLE_RENDERER;
    return LOADING;
  }, [loaded, override, unavailable]);
}

export function useAgentMarkdownGate(
  viewport: AgentMarkdownViewport | null,
  host: RefObject<HTMLElement | null>,
  live: boolean,
  required: boolean,
): AgentMarkdownGate {
  const [entered, setEntered] = useState(live || required);
  const open = entered || live || required || viewport === null;

  useEffect(() => {
    if (entered) return;
    if (!live && !required) return;
    setEntered(true);
  }, [entered, live, required]);

  useLayoutEffect(() => {
    if (open) return;
    if (viewport === null) return;
    const element = host.current;
    if (element === null) return;
    if (viewport.contains(element)) {
      setEntered(true);
      return;
    }
    return viewport.observe(element, () => setEntered(true));
  }, [host, open, viewport]);

  return open ? "parse" : "defer";
}

export function useAgentMarkdown(
  renderer: AgentMarkdownRendererState,
  text: string,
  live: boolean,
  query: string,
  gate: AgentMarkdownGate,
): AgentMarkdownPresentation {
  const active = renderer.kind === "ready" ? renderer.renderer : null;
  const session = useMemo(
    () => (active === null || !live ? null : createAgentMarkdownSession(active)),
    [active, live],
  );
  const view = useMemo(() => {
    if (active === null) return null;
    if (gate === "defer") return null;
    if (session !== null) return session.update(text, true);
    return sharedAgentMarkdownDocumentCache().read(active, text);
  }, [active, gate, session, text]);

  return useMemo(
    () => agentMarkdownPresentation(renderer, gate, view, text, query),
    [gate, query, renderer, text, view],
  );
}

function agentMarkdownPresentation(
  renderer: AgentMarkdownRendererState,
  gate: AgentMarkdownGate,
  view: AgentMarkdownView | null,
  text: string,
  query: string,
): AgentMarkdownPresentation {
  switch (renderer.kind) {
    case "loading":
      return PENDING;
    case "unavailable":
      return UNAVAILABLE;
    case "ready":
      if (gate === "defer") return DEFERRED;
      return resolveAgentMarkdownPresentation(view, text, query);
    default:
      return unsupportedRendererState(renderer);
  }
}

function unsupportedRendererState(state: never): never {
  throw new Error(`Unsupported markdown renderer state: ${String(state)}`);
}
