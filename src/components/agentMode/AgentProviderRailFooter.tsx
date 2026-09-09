import {
  ArrowUpCircle,
  BarChart3,
  Check,
  Download,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  Settings,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useRef, useState, type Ref } from "react";
import type {
  AgentProviderManagementSurface,
  AgentProviderManagementView,
} from "../../application/useAgentProviderManagement";
import type { AgentProviderUpdateState } from "../../domain/agentProviderHealth";
import type { AgentCliKind } from "../../domain/agentTask";
import {
  providerAvailableVersion,
  providerFooterPillModels,
  providerSettingsTitle,
  providerUpdating,
  type ProviderPillGlyph,
  type ProviderPillIntent,
  type ProviderPillModel,
} from "./agentSidebarPresentation";

export const AGENT_PROVIDER_UPDATED_PILL_MS = 6000;

export interface AgentProviderRailFooterProps {
  readonly management: AgentProviderManagementSurface;
  readonly providerEnabled: Readonly<Record<AgentCliKind, boolean>>;
  readonly usageButtonRef?: Ref<HTMLButtonElement>;
  readonly usageOpen: boolean;
  onOpenSourceControl(): void;
  onOpenSettings(): void;
  onOpenUsage(): void;
}

const PROVIDERS: ReadonlyArray<AgentCliKind> = ["claudeCode", "codex"];

export function AgentProviderRailFooter({
  management,
  onOpenSourceControl,
  onOpenSettings,
  onOpenUsage,
  providerEnabled,
  usageButtonRef,
  usageOpen,
}: AgentProviderRailFooterProps) {
  const enabled = PROVIDERS.filter((provider) => providerEnabled[provider]);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  const refreshPending = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshAll = (): void => {
    if (refreshPending.current || enabled.length === 0) return;
    refreshPending.current = true;
    setRefreshing(true);
    void Promise.allSettled([management.refreshAll()]).then(() => {
      refreshPending.current = false;
      if (!mounted.current) return;
      setRefreshing(false);
    });
  };

  return (
    <footer className="agent-provider-footer">
      <div aria-label="Agent provider status" className="agent-provider-footer__providers">
        {enabled.map((provider) => (
          <ProviderFooterActions
            key={provider}
            management={management}
            onOpenSettings={onOpenSettings}
            provider={provider}
          />
        ))}
      </div>
      <nav aria-label="Agent navigation" className="agent-provider-footer__navigation">
        <button
          aria-label="Open provider settings"
          className="agent-iconbutton"
          onClick={onOpenSettings}
          title={providerSettingsTitle(management, enabled)}
          type="button"
        >
          <Settings aria-hidden="true" size={16} />
        </button>
        <button
          aria-label="Open Source Control"
          className="agent-iconbutton"
          onClick={onOpenSourceControl}
          title="Source Control"
          type="button"
        >
          <GitBranch aria-hidden="true" size={16} />
        </button>
        <button
          aria-controls={usageOpen ? "agent-usage-panel-dialog" : undefined}
          aria-expanded={usageOpen}
          aria-label="Open Usage"
          className="agent-iconbutton"
          onClick={onOpenUsage}
          ref={usageButtonRef}
          title="Usage"
          type="button"
        >
          <BarChart3 aria-hidden="true" size={16} />
        </button>
        <button
          aria-busy={refreshing}
          aria-label="Check CLI updates"
          className="agent-iconbutton agent-provider-footer__refresh"
          disabled={refreshing || enabled.length === 0}
          onClick={refreshAll}
          title={refreshing ? "Checking CLI updates…" : "Check CLI updates"}
          type="button"
        >
          <RefreshCw
            aria-hidden="true"
            className={refreshing ? "agent-provider-spin" : undefined}
            size={16}
          />
        </button>
      </nav>
    </footer>
  );
}

function ProviderFooterActions({
  management,
  onOpenSettings,
  provider,
}: {
  readonly management: AgentProviderManagementSurface;
  readonly onOpenSettings: () => void;
  readonly provider: AgentCliKind;
}) {
  const view = management.providers[provider];
  const updatedVisible = useUpdatedPillVisible(view.updateState);
  const failedVersion = useFailedUpdateVersion(view);
  const dismissedVersion =
    management.authority(provider)?.preference.dismissedUpdateVersion ?? null;
  const pills = providerFooterPillModels({
    dismissedVersion,
    provider,
    view,
    updatedVisible,
    failedVersion,
  });

  const run = (intent: ProviderPillIntent): void => {
    switch (intent.kind) {
      case "update":
        void management.update(provider, intent.version);
        return;
      case "openSettings":
        onOpenSettings();
        return;
      case "register":
        void management.retryRegistration(provider);
        return;
      case "none":
        return;
      default:
        unsupportedIntent(intent);
    }
  };

  return (
    <>
      {pills.map((pill) => (
        <ProviderPillView
          key={pill.id}
          onRun={() => run(pill.intent)}
          pill={pill}
          provider={provider}
        />
      ))}
    </>
  );
}

function useUpdatedPillVisible(state: AgentProviderUpdateState): boolean {
  const succeeded = state.kind === "succeeded";
  const [visible, setVisible] = useState(false);
  const previous = useRef(succeeded);

  useEffect(() => {
    const became = succeeded && !previous.current;
    previous.current = succeeded;
    if (!became) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), AGENT_PROVIDER_UPDATED_PILL_MS);
    return () => clearTimeout(timer);
  }, [succeeded]);

  return visible && succeeded;
}

function useFailedUpdateVersion(view: AgentProviderManagementView): string | null {
  const updating = providerUpdating(view.updateState);
  const offered = providerAvailableVersion(view.health);
  const [started, setStarted] = useState<string | null>(null);

  useEffect(() => {
    if (!updating || offered === null) return;
    setStarted(offered);
  }, [updating, offered]);

  if (view.updateState.kind !== "failed") return null;
  return started;
}

function ProviderPillView({
  onRun,
  pill,
  provider,
}: {
  readonly onRun: () => void;
  readonly pill: ProviderPillModel;
  readonly provider: AgentCliKind;
}) {
  const className = `agent-provider-footer__pill agent-provider-footer__pill--${pill.tone}`;
  const title = pill.title ?? undefined;
  const content = (
    <>
      <ProviderPillGlyphView glyph={pill.glyph} />
      <span className="agent-provider-footer__pill-label">{pill.label}</span>
    </>
  );

  if (pill.intent.kind === "none") {
    return (
      <span
        aria-busy={pill.busy}
        className={className}
        data-pill={pill.id}
        data-provider={provider}
        role="status"
        title={title}
      >
        {content}
      </span>
    );
  }

  return (
    <button
      aria-label={pill.name}
      className={className}
      data-pill={pill.id}
      data-provider={provider}
      disabled={pill.disabled}
      onClick={onRun}
      title={title}
      type="button"
    >
      {content}
    </button>
  );
}

function ProviderPillGlyphView({ glyph }: { readonly glyph: ProviderPillGlyph }) {
  const props = { "aria-hidden": true, className: "agent-provider-footer__pill-glyph", size: 14 };
  switch (glyph) {
    case "spinner":
      return <LoaderCircle {...props} className={`${props.className} agent-provider-spin`} />;
    case "check":
      return <Check {...props} />;
    case "update":
      return <ArrowUpCircle {...props} />;
    case "manual":
      return <Download {...props} />;
    case "register":
      return <ShieldCheck {...props} />;
    case "retry":
      return <TriangleAlert {...props} />;
    default:
      return unsupportedGlyph(glyph);
  }
}

function unsupportedGlyph(glyph: never): never {
  throw new TypeError(`Unsupported provider pill glyph: ${String(glyph)}`);
}

function unsupportedIntent(intent: never): never {
  throw new TypeError(`Unsupported provider pill intent: ${String(intent)}`);
}
