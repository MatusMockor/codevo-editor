import type { MutableRefObject } from "react";
import type {
  AgentProviderHealthGateway,
  AgentProviderHealthState,
  AgentProviderPolicyGateway,
  AgentProviderPolicyRegistrationState,
  AgentProviderUpdateGateway,
  AgentProviderUpdateState,
} from "../../domain/agentProviderHealth";
import type { PersistedAgentProviderSettingsAuthority } from "../../domain/agentProviderSettings";
import type {
  AgentCliDiscoveryGateway,
  AgentCliDiscoveryResult,
  AgentCliExecutablePresentation,
} from "../../domain/agentSettings";
import type { AgentCliKind } from "../../domain/agentTask";
import type { AppSettings, SettingsGateway } from "../../domain/settings";
import type {
  AgentProviderAdmissionAuthority,
  ReadyAgentProviderAdmissionAuthority,
} from "../agentProviderAdmissionAuthority";
import type { AgentProviderSettingsIntent } from "../agentProviderSettingsIntent";

export type AgentProviderManagementToast =
  | {
      readonly kind: "updateAvailable";
      readonly provider: AgentCliKind;
      readonly version: string;
      readonly manual?: true;
    }
  | {
      readonly kind: "updateSucceeded";
      readonly provider: AgentCliKind;
      readonly version: string;
    }
  | {
      readonly kind: "updateAlreadyCurrent";
      readonly provider: AgentCliKind;
      readonly version: string;
    }
  | { readonly kind: "updateFailed"; readonly provider: AgentCliKind };

export type AgentProviderUpdateRefusal =
  | "disabled"
  | "notConfigured"
  | "policyUnavailable"
  | "statusUnknown"
  | "noUpdateAvailable"
  | "turnActive"
  | "signInActive"
  | "alreadyUpdating";

export type AgentProviderUpdateRegistrationOutcome =
  "registered" | "policyUnavailable" | "statusUnknown";

export type AgentProviderSettingsSaveOutcome =
  | { readonly kind: "persisted"; readonly policyRegistered: boolean }
  | {
      readonly kind: "rejected";
      readonly reason: "notHydrated" | "staleAuthority" | "persistenceFailed";
    };

export type AgentProviderRefreshOutcome =
  | { readonly kind: "complete"; readonly authority: ReadyAgentProviderAdmissionAuthority }
  | { readonly kind: "failed" }
  | { readonly kind: "stale" };

export interface AgentProviderManagementView {
  readonly executable: AgentCliExecutablePresentation;
  readonly health: AgentProviderHealthState;
  readonly policy: AgentProviderPolicyRegistrationState;
  readonly updateState: AgentProviderUpdateState;
  readonly liveTurnCount: number;
  readonly signInActive?: boolean;
}

export interface AgentProviderManagementSurface {
  readonly cliDiscovery: AgentCliDiscoveryResult;
  readonly providers: Readonly<Record<AgentCliKind, AgentProviderManagementView>>;
  readonly selectedProviderAuthority: SelectedAgentProviderAuthority | null;
  readonly toast: AgentProviderManagementToast | null;
  admissionAuthority(provider: AgentCliKind): AgentProviderAdmissionAuthority;
  authority(provider: AgentCliKind): PersistedAgentProviderSettingsAuthority | null;
  dismissToast(): void;
  dismissUpdate(provider: AgentCliKind, version: string): Promise<boolean>;
  refresh(provider: AgentCliKind): Promise<void>;
  refreshAll(): Promise<void>;
  refreshWithOutcome?(provider: AgentCliKind): Promise<AgentProviderRefreshOutcome>;
  retryRegistration(provider: AgentCliKind): Promise<void>;
  save(intent: AgentProviderSettingsIntent): Promise<boolean>;
  saveWithOutcome(intent: AgentProviderSettingsIntent): Promise<AgentProviderSettingsSaveOutcome>;
  update(
    provider: AgentCliKind,
    offeredVersion: string,
  ): Promise<AgentProviderUpdateRefusal | null>;
}

export interface SelectedAgentProviderAuthority {
  readonly settingsRevision: number;
  readonly provider: AgentCliKind;
}

export interface SelectedAgentProviderAuthorityPublication extends SelectedAgentProviderAuthority {
  readonly policyGateway: AgentProviderPolicyGateway;
  readonly healthGateway: AgentProviderHealthGateway;
  readonly updateGateway: AgentProviderUpdateGateway;
}

export interface AgentProviderManagementDependencies {
  readonly appSettingsRef: MutableRefObject<AppSettings>;
  readonly applyAppSettings: (settings: AppSettings) => void;
  readonly settingsGateway: Pick<SettingsGateway, "saveAppSettings">;
  readonly policyGateway: AgentProviderPolicyGateway;
  readonly healthGateway: AgentProviderHealthGateway;
  readonly updateGateway: AgentProviderUpdateGateway;
  readonly discoveryGateway: AgentCliDiscoveryGateway;
  readonly liveTurnCount: (provider: AgentCliKind) => number;
  readonly signInActive: (provider: AgentCliKind) => boolean;
  readonly reportError: (source: string, error: unknown) => void;
  readonly mintOperationId: (provider: AgentCliKind) => string;
  readonly settingsHydrated: boolean;
}
