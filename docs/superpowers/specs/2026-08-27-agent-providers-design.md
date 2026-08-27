# Agent Providers Settings and CLI Updates

Date: 2026-08-27

## Purpose

Codevo exposes Claude Code and Codex as two closed agent providers. The Providers
settings surface reports their configured executable, installed version,
authentication state, health, and update availability. It can run a supervised update
only when the user opted into network-backed checks and the selected provider has no
live or starting turns.

The feature does not store credentials, tokens, raw command lines, process identifiers,
environment snapshots, or executable capabilities. Browser surfaces, subagent surfaces,
providers other than Claude Code and Codex, and automatic updates are out of scope.

## Architectural boundaries

Dependencies continue to point inward:

```text
React settings, composer, rail, notices
                    ↓
Provider health and update coordinators
                    ↓
Domain policies and narrow gateway ports
                    ↑
Strict Tauri IPC adapters
                    ↑
Typed Rust process plans and supervisors
```

The domain owns closed types, normalization, parsing, comparison, admission decisions,
and pure state transitions. Application coordinators own scheduling, exact async
authority, turn/update exclusion, notices, and bounded presentation snapshots. Tauri
adapters validate both sides of IPC. Rust owns executable identity, no-shell plans,
process groups, timeouts, output limits, installer discovery, and update execution.

`App.tsx`, `useWorkbenchController.ts`, `workbenchComposition.ts`, and Rust `lib.rs`
remain composition roots. They wire ports and do not own provider policy.

## Persisted provider settings

Provider settings are app-scoped and use the existing `SettingsGateway`. They are not
stored in a second repository or a component-local storage key.

```ts
type AgentProviderKind = "claudeCode" | "codex";

interface AgentProviderPreference {
  readonly enabled: boolean;
  readonly healthCheckIntervalSeconds: number;
  readonly checkForUpdates: boolean;
  readonly dismissedUpdateVersion: string | null;
}

interface AgentProviderPreferences {
  readonly claudeCode: AgentProviderPreference;
  readonly codex: AgentProviderPreference;
}
```

`AgentProviderKind` reuses the existing `AgentCliKind` rather than introducing a third
provider identity. `AppSettings` gains one `agentProviderPreferences` record. Existing
`agentCliPaths` and `agentCliKind` remain the source of configured paths and selected
composer provider.

Defaults per provider are:

| Setting                      | Default | Bounds and normalization                                                        |
| ---------------------------- | ------- | ------------------------------------------------------------------------------- |
| `enabled`                    | `true`  | Only an actual boolean is accepted; malformed values use the safe default.      |
| `healthCheckIntervalSeconds` | `300`   | Finite integer, clamped to `0..86400`; `0` means manual only.                   |
| `checkForUpdates`            | `false` | Only an actual boolean is accepted. Network-backed checks never run by default. |
| `dismissedUpdateVersion`     | `null`  | Exact bounded semantic version or `null`; malformed values become `null`.       |

The outer record must contain exactly `claudeCode` and `codex`. Each provider record
must contain exactly the four specified fields. Missing, extra, or malformed record
shapes fail closed to fresh defaults. Unknown providers are rejected rather than
retained. The normalizer returns fresh immutable values.

The following remain runtime-only and are never persisted:

- authentication state and account or plan label;
- installed version, installer identity, and update availability;
- health timestamps, failures, output tails, and progress;
- update operation identifiers and admission revisions;
- credentials, tokens, environment values, or raw process output.

Dismissal is exact-version scoped. Dismissing `0.150.1` suppresses only that version. A
newer valid version is eligible for a new notice. A successful update clears a dismissal
that no longer matches the available version.

### Persisted settings authority

An edited draft is not runtime authority. The application owns a monotonic app-settings
intent revision and exposes provider policy only through a successful persistence
receipt:

```ts
interface PersistedAgentProviderSettingsAuthority {
  readonly settingsRevision: number;
  readonly provider: AgentProviderKind;
  readonly preference: AgentProviderPreference;
  readonly cliPath: string | null;
}
```

Provider-affecting saves are serialized in intent order. A new intent captures the exact
previous persisted provider slice, the proposed slice, and its settings revision. The
coordinator awaits `saveAppSettings`, revalidates that exact revision, and only then
publishes the persisted authority. An older save cannot settle after and overwrite a
newer persisted intent because the next write begins only after the previous write has
settled.

On persistence failure, the coordinator rolls back only the provider preference, CLI
path, and selected-provider fields changed by that exact intent. It merges those fields
into the latest unrelated app settings rather than restoring an old full settings
snapshot. If a newer provider intent exists, the failed older intent cannot roll it
back. The failure is reported and no health timer, network-capable check, policy
registration, notice, or update is authorized from the unpersisted draft.

The existing hydrated settings are local revision zero authority. Before its first
backend registration, the coordinator mints positive registration intent revision one;
zero never crosses provider IPC. Hydration failure uses defaults and therefore keeps
update checks disabled. A persisted `checkForUpdates: true` becomes active only after
both the exact settings save and backend provider policy registration described below
succeed.

## Closed runtime contracts

### Authentication

```ts
type AgentProviderAuthState =
  | { readonly kind: "signedIn"; readonly label: string | null }
  | { readonly kind: "signedOut" }
  | { readonly kind: "unknown" };
```

The optional display label is trimmed, UTF-8 bounded to 256 bytes, and contains only a
provider-produced account or plan label. Empty, oversized, control-character-bearing,
or ambiguous output yields `unknown`. No token-shaped value is retained or displayed.
Unknown JSON keys or unknown auth variants are rejected at IPC and converted by the
application into the truthful `unknown` state.

Claude Code uses a closed capability-selected strategy:

```ts
type ClaudeAuthStatusCapability = "json" | "text" | "unavailable";
```

Known tested CLI versions map to a capability in a fixture-backed version table. `json`
uses `claude auth status --json`; `text` uses the closest documented fixed command,
`claude auth status`; `unavailable` returns `unknown` without another process. For an
otherwise valid version outside the table, Codevo probes the JSON form once. Only an
exact bounded “unsupported option” classification may transition to the fixed text
form. Authentication failure, signed-out output, timeout, garbage, or any other nonzero
exit cannot trigger fallback. The selected capability is cached only for the exact
binary descriptor, fingerprint, and provider configuration generation.

Codex uses `codex login status`. An installed CLI that supports neither closed Claude
strategy produces `unknown`; Codevo does not try arbitrary commands or parse general
startup output as authentication evidence.

### Installer identity

```ts
type AgentProviderInstaller =
  | {
      readonly kind: "npm";
      readonly packageName: "@anthropic-ai/claude-code" | "@openai/codex";
    }
  | {
      readonly kind: "homebrew";
      readonly cask: "claude-code" | "codex";
    }
  | { readonly kind: "unknown" };
```

An installer is recognized only when the package manager's resolved executable maps to
the canonical configured CLI executable and its captured fingerprint. Finding a global
package with the expected name is not enough. Symlink chains are resolved under the
same bounded descriptor-based policy used by the CLI version probe. Ambiguous,
conflicting, missing, or changed identity becomes `unknown`.

### Version and update availability

All installed and available versions use the existing bounded semantic-version parser.
Comparison is numeric per dot-separated component followed by a deterministic
prerelease comparison. Invalid or incomparable values never mean that an update is
available.

```ts
type AgentProviderUpdateAvailability =
  | { readonly kind: "checksDisabled" }
  | { readonly kind: "checking" }
  | { readonly kind: "current"; readonly installedVersion: string }
  | {
      readonly kind: "available";
      readonly installedVersion: string;
      readonly availableVersion: string;
      readonly installer: Exclude<AgentProviderInstaller, { readonly kind: "unknown" }>;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: "unknownInstaller" | "unsupportedProbe" | "invalidVersion" | "probeFailed";
    };
```

`checksDisabled` is the state when the persisted opt-in is false. `unavailable` is not
presented as current. Claude startup or version output may contribute a valid local
update hint, but absence of a hint never means current. Package-manager discovery is the
source of truth when an installer is known.

### Health state

```ts
type AgentProviderHealthState =
  | { readonly kind: "disabled" }
  | { readonly kind: "notConfigured" }
  | { readonly kind: "checking"; readonly generation: number }
  | {
      readonly kind: "ready";
      readonly installedVersion: string | null;
      readonly auth: AgentProviderAuthState;
      readonly update: AgentProviderUpdateAvailability;
      readonly checkedAtEpochMs: number;
    }
  | {
      readonly kind: "failed";
      readonly reason: "invalidPath" | "policyRegistrationFailed" | "probeFailed" | "timedOut";
      readonly checkedAtEpochMs: number | null;
    };
```

The UI formats `checkedAtEpochMs` as “Checked just now” or a bounded relative label.
The label is derived at presentation time and is not persisted. A partial probe may
publish `ready` only when each unavailable field has an explicit closed unknown or
unavailable state. It never substitutes stale data from another provider, path, or
generation.

### Update lifecycle

```ts
type AgentProviderUpdateState =
  | { readonly kind: "idle" }
  | { readonly kind: "starting"; readonly operationId: string }
  | {
      readonly kind: "running";
      readonly operationId: string;
    }
  | {
      readonly kind: "succeeded";
      readonly previousVersion: string;
      readonly installedVersion: string;
    }
  | {
      readonly kind: "failed";
      readonly reason:
        | "admissionRefused"
        | "spawnFailed"
        | "timedOut"
        | "outputLimitExceeded"
        | "exited"
        | "uncertain";
      readonly outputTail: string;
      readonly outputTruncated: boolean;
    };
```

Operation identifiers are opaque, bounded, and private to the application layer. Output
tails are UTF-8 safe and bounded to 32 KiB. Update is one supervised await that returns a
closed bounded final result. The application owns the pending progress row locally; there
is no update output or status subscription channel and no shell terminal injection. A
foreign operation or invalid final result fails truthfully instead of inventing
completion.

## Strict IPC

The TypeScript domain defines minimal gateway ports:

```ts
interface AgentProviderHealthGateway {
  probeAgentProviderHealth(
    request: AgentProviderHealthProbeRequest,
  ): Promise<AgentProviderHealthProbeResult>;
}

interface AgentProviderUpdateGateway {
  updateAgentProvider(request: AgentProviderUpdateRequest): Promise<AgentProviderUpdateResult>;
}
```

Policy registration contains the closed provider kind, persisted settings revision,
validated absolute configured CLI path or `null`, enabled state, and persisted update
opt-in. Subsequent turn, health, and update requests contain only provider kind, the
exact registered backend generation, and an opaque operation identifier where required.
They do not resend path or opt-in and do not contain argv, package names, cask names,
environment maps, timeouts, output caps, shell strings, target versions, cached receipts,
or process recipes. Rust derives the plan from the registered policy and semantic
operation. Update startup consumes only the backend's cached exact candidate for the
current provider configuration generation; the frontend cannot nominate or modify an
update target.

### Backend provider policy registration

Persisted settings are registered through a separate strict semantic command before
they can authorize provider processes:

```ts
interface AgentProviderPolicyRegistrationRequest {
  readonly provider: AgentProviderKind;
  readonly settingsRevision: number;
  readonly expectedProviderGeneration: number | null;
  readonly enabled: boolean;
  readonly cliPath: string | null;
  readonly checkForUpdates: boolean;
}

interface AgentProviderPolicyRegistrationReceipt {
  readonly provider: AgentProviderKind;
  readonly settingsRevision: number;
  readonly providerGeneration: number;
}

interface AgentProviderCurrentPolicyRequest {
  readonly provider: AgentProviderKind;
}

type AgentProviderCurrentPolicyResult =
  | { readonly kind: "unregistered" }
  | {
      readonly kind: "registered";
      readonly receipt: AgentProviderPolicyRegistrationReceipt;
      readonly enabled: boolean;
      readonly cliPath: string | null;
      readonly checkForUpdates: boolean;
    };
```

The command contains no argv, installer, target version, environment, credential, or
runtime output. Rust normalizes the request before comparing it with registry state. A
revision newer than the stored revision atomically replaces the provider's registered
policy, increments a backend-owned generation, retires cached health and update
candidates from the old generation, and stores the normalized payload with its receipt.
A disabled or pathless policy is registered explicitly so stale prior configuration
cannot remain active.

Registration and reconciliation are safe when the WebView reloads while Rust survives.
The frontend first reads the strict current-policy result. An identical normalized
persisted payload reacquires the current stored receipt regardless of a reset or lower
frontend settings revision. It does not replace policy, increment generation, or retire
anything. This also makes a retry after a lost registration response idempotent.

A differing payload is a compare-and-swap replacement. It must include the exact current
`expectedProviderGeneration`, or `null` only when the current-policy result was
`unregistered`. A stale or absent expectation is a typed `generationConflict`
rejection. A conflicting payload with the same settings revision is a typed
`revisionConflict` rejection. An older revision without exact generation authority is a
typed `staleRevision` rejection; an exact generation CAS permits a reload with a reset
client counter to install a genuinely different persisted payload. Unknown fields remain
validation failures. Equality is semantic equality of the closed normalized fields, not
serialized JSON byte order.

Turn starts, health probes, and updates carry the exact `providerGeneration` receipt.
Rust accepts it only if it still names the current registered provider policy. An
internal backend continuation may atomically resolve the current generation only while
holding the corresponding provider lease; it may not re-resolve after an await or adopt
a replacement generation. Stale generation requests are definite typed rejections.

The settings sequence is:

1. create a settings intent revision without changing runtime authority;
2. persist the complete normalized app settings in serialized order;
3. revalidate the exact successful persistence receipt;
4. read the current backend policy and reconcile or CAS-replace each changed provider
   policy in Rust;
5. revalidate the settings receipt and backend generation receipt;
6. publish the new provider authority, schedule health, or enable network checks.

If registration fails after persistence, the desired setting remains persisted but the
runtime enters a closed `policyRegistrationFailed` state. Starts, probes, and updates
are refused until registration is retried successfully. It never falls back to the old
backend policy or treats persisted opt-in alone as network authority.

Every request, response, and event requires an exact key set. Paths, versions, labels,
operation identifiers, timestamps, sequence numbers, output tails, and enum variants are
bounded and validated before use. TypeScript validates outbound requests before invoke
and parses unknown inbound data once. Rust deserialization denies unknown fields and
revalidates semantic invariants. Unknown fields or variants fail closed.

## Typed no-shell Rust plans

Rust represents each executable action as a closed semantic command and converts it to
a private no-shell process plan. No IPC caller may provide raw arguments.

```rust
enum AgentProviderProbeOperation {
    InstalledVersion,
    AuthenticationStatus,
    InstallerDiscovery,
    AvailableVersion,
}

enum AgentProviderUpdateOperation {
    NpmInstallExact,
    HomebrewUpgrade,
}
```

Pure provider enums, parsers, and comparisons live in a process-independent Rust domain
module. A sealed process module is the only place that maps semantic intents to static
argv, environment allowlists, limits, and supervisors.

The concrete plan matrix is fixed:

| Operation             | Executable                           | Bounded argv                                                      |
| --------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| Claude auth JSON      | exact configured Claude executable   | `auth`, `status`, `--json`                                        |
| Claude auth text      | exact configured Claude executable   | `auth`, `status`                                                  |
| Codex auth            | exact configured Codex executable    | `login`, `status`                                                 |
| Installed version     | exact configured provider executable | existing provider-specific version argv                           |
| npm discovery         | resolved npm executable              | `ls`, `-g`, `--json`, both exact package names, `--depth`, `0`    |
| npm available version | resolved npm executable              | `view`, exact package name, `version`, `--json`                   |
| npm update            | resolved npm executable              | `install`, `--global`, exact package plus validated exact version |
| Homebrew discovery    | resolved brew executable             | `--caskroom`, exact cask (`claude-code` or `codex`)               |
| Homebrew availability | resolved brew executable             | `outdated`, `--json=v2`, `--cask`, exact cask                     |
| Homebrew update       | resolved brew executable             | `upgrade`, `--cask`, exact cask                                   |

Homebrew discovery accepts exactly one trimmed absolute caskroom line within the bounded
output limit, canonicalizes it, and requires the already descriptor-bound provider
executable identity to remain inside that canonical caskroom. Extra lines, relative
paths, unknown cask names, and binaries outside the resolved caskroom fail closed. Both
providers are casks, never formulae.

Network-capable availability commands run only when the exact provider preference has
`checkForUpdates: true`. Update execution requires a current `available` receipt and an
explicit user action. There is no timer-triggered or startup-triggered installation.

Each plan has:

- an exact executable descriptor and pre-spawn fingerprint revalidation;
- a fixed working directory independent of the workspace;
- no shell and no interpolation;
- a minimal environment allowlist needed by the package manager, never a caller-supplied
  environment map;
- stdin closed;
- a five-second timeout for version/auth/discovery probes and a ten-minute timeout for
  updates;
- stdout and stderr caps of 64 KiB per probe and a 1 MiB total update stream with only a
  32 KiB tail retained by the UI;
- one process group owned by an RAII guard;
- bounded global concurrency of two probes and one update;
- complete process-group termination and reap on timeout, cancellation, disconnect,
  spawn failure, panic, or drop.

The 1 MiB update output cap is a hard total across stdout and stderr, not a retention
hint. Crossing it immediately stops publication, kills the complete process group,
drains and reaps it, and settles with `outputLimitExceeded`. The final state contains
only the UTF-8-safe 32 KiB tail and `outputTruncated: true`. The update lease is released
only after reap. Codevo never continues an installer whose output exceeded the
supervision bound and never reports truncated output as complete.

JSON output from npm and Homebrew is parsed with exact bounded shapes. Maximum JSON input
is 64 KiB, maximum nesting depth is 16, and only the two known packages or casks are
accepted. Garbage, truncation, unexpected package names, duplicate contradictory
entries, or nonzero exits are explicit failures. A captured output tail may be displayed
after redacting control characters and token-like material; raw output is never persisted.

The Tauri command facade dispatches blocking discovery and process work away from the UI
runtime and holds no global registry mutex during filesystem or process operations.

## Turn and update admission

The application owns a monotonic provider revision per provider:

```ts
type AgentProviderPolicyRegistrationState =
  | { readonly kind: "unregistered" }
  | { readonly kind: "registering"; readonly settingsRevision: number }
  | {
      readonly kind: "registered";
      readonly settingsRevision: number;
      readonly providerGeneration: number;
    }
  | {
      readonly kind: "failed";
      readonly settingsRevision: number;
      readonly reason:
        "registrationFailed" | "revisionConflict" | "staleRevision" | "generationConflict";
    };

type AgentProviderAdmissionDisposition =
  | { readonly kind: "ready" }
  | { readonly kind: "disabled" }
  | { readonly kind: "updating" }
  | {
      readonly kind: "policyUnavailable";
      readonly reason: "unregistered" | "registrationFailed";
    };

type AgentProviderAdmissionAuthority =
  | {
      readonly provider: AgentProviderKind;
      readonly revision: number;
      readonly disposition: { readonly kind: "ready" };
      readonly cliPath: string;
      readonly providerGeneration: number;
    }
  | {
      readonly provider: AgentProviderKind;
      readonly revision: number;
      readonly disposition: { readonly kind: "disabled" };
    }
  | {
      readonly provider: AgentProviderKind;
      readonly revision: number;
      readonly disposition: { readonly kind: "updating" };
      readonly cliPath: string;
      readonly providerGeneration: number;
    }
  | {
      readonly provider: AgentProviderKind;
      readonly revision: number;
      readonly disposition: {
        readonly kind: "policyUnavailable";
        readonly reason: "unregistered" | "registrationFailed";
      };
    };
```

Enabling, disabling, changing the CLI path, beginning an update, settling an update, or
replacing the health coordinator increments that provider's revision. A turn captures
the exact authority during admission. Admission rejects disabled providers with “Enable
this provider in Settings before starting a turn.” It rejects updating providers with
“This provider is updating. Wait for the update to finish.” An unregistered policy is
rejected with “Provider settings are not registered yet. Retry provider setup.” A failed
registration is rejected with “Provider settings could not be registered. Retry in
Settings.” These checks apply to new threads and follow-ups, using the thread's provider
for a follow-up. The settings card and rail use the same closed disposition and show the
retry action; they never present failed or unregistered policy as healthy.

Turn dispatch revalidates the captured provider, revision, path, and ready disposition:

1. after project lease acquisition;
2. after in-place preflight;
3. after worktree creation;
4. before publishing or invoking any subsequent side effect;
5. immediately before `startAgentTask`.

If authority is lost after creating a worktree, dispatch performs the existing exact
worktree compensation. A stale dispatch never uses a newly configured path merely
because the provider kind matches.

The update coordinator captures provider revision, canonical binary descriptor,
fingerprint, installed version, installer, and available version. It rejects update when
any turn for that provider is pending, starting, running, or awaiting start
acknowledgement. Turns from the other provider do not block it.

TypeScript checks are not the final exclusion boundary. Rust maintains a shared
provider-operation runtime with the registered monotonic provider generation and RAII
`ProviderTurnLease`, `ProviderHealthLease`, and `ProviderUpdateLease` values:

- turn startup acquires a provider run permit before spawn and retains it until the
  complete process group is terminal and reaped;
- health probing acquires a bounded shared health lease tied to the exact provider
  configuration generation and cannot publish or cache a candidate after replacement;
- update startup atomically acquires the exclusive update permit only when no run permit
  exists for that provider;
- a held update permit makes a concurrent turn start a definite typed rejection;
- a held run permit makes a concurrent update a definite typed rejection;
- permit guards release on all errors, cancellation, panic, and drop;
- shutdown revokes all generations, cancels probes and updates, kills and reaps owned
  process groups, and drains the registry;
- no registry mutex is held during descriptor checks, filesystem work, process spawn, or
  waits.

Immediately before the irreversible installer spawn, Rust revalidates the configured
binary descriptor, fingerprint, installer, available version, and configuration
generation against its cached candidate. A mismatch returns `admissionRefused`; it never
updates whichever executable now happens to occupy the path.

Replacing policy retires stale cached candidates immediately. Existing turns retain
their old run lease until their process group is terminal and reaped, but no new turn,
health probe, or update may acquire that retired generation. Disabling a provider does
not silently kill an existing turn; it prevents new work and updates while cleanup
remains owned by the original turn lease.

## Scheduling and exact async authority

Each provider has an independent health generation. A probe authority contains provider,
configured path, persisted settings revision, registered backend provider generation,
health generation, and captured gateway.
The coordinator revalidates all fields after every await and immediately before state,
notice, or timestamp publication. A late Claude result cannot update Codex, and an A to
B to A path sequence is three distinct generations.

Health scheduling follows these rules:

- disabled or unconfigured providers have no timer;
- interval `0` has no timer but permits manual refresh;
- a positive interval is clamped before scheduling;
- at most one probe per provider is in flight;
- manual refresh coalesces with the exact in-flight generation;
- changing path, enabled state, interval, update opt-in, or gateway cancels ownership of
  the old generation;
- timers are cleared on replacement and unmount;
- successful update triggers a new version and health generation only after the update
  process is terminal and reaped.

Startup probes health for enabled, configured providers. Network-backed availability is
included only for opted-in providers. No check is performed on each keystroke or render.

## UI behavior

Settings keeps the existing Agents section and presents a Providers group with one card
for Claude Code and one for Codex. Each card contains:

- enabled toggle;
- validated resolved CLI path;
- installed version or a truthful unavailable state;
- signed-in, signed-out, or unknown authentication state;
- health interval input with `0` documented as manual;
- check-for-updates opt-in, default off;
- “Checked just now” or bounded relative timestamp;
- manual Refresh button;
- available version and Update button when supported;
- bounded progress or failure output during and after update.

Disabling a provider removes its rail item and models from the composer picker. It also
prevents dispatch even if a stale component still submits that provider. If the selected
provider is disabled, the UI chooses the first enabled provider for the draft launch. It
does not mutate the persisted enabled flags. If both providers are disabled, the composer
is disabled and offers a Settings action.

The model picker receives an explicit enabled-provider projection. It does not read
settings through a global lookup. Favorites for disabled providers remain persisted but
hidden, so re-enabling restores them.

When an available version is not dismissed, startup or a completed health check may show
one dismissible notice: “Update available: Codex v0.150.1”. Its actions are a closed
union for opening Providers settings or starting the exact offered update. Dismiss stores
only that exact version. Notices from stale generations are ignored.

During update, the rail footer shows the provider and a progress indicator. Output may
also be presented in a dedicated bounded progress row. It must not impersonate a normal
interactive workspace terminal because its process is a supervised provider operation,
not a shell. Completion re-probes the executable and reports the observed installed
version. A zero exit without the expected new version is failure, not success.

## Failure behavior

- Invalid or missing path: health reports the exact path state and admission remains
  blocked by the existing configured-path rule.
- Unsupported auth command: auth is `unknown`; version probing and turns remain
  independent.
- Unknown installer: update availability is unavailable and no Update button is shown.
- Checks disabled: no npm view or Homebrew outdated process is started.
- Probe timeout or garbage: retain no partial claim; report a bounded failure and permit
  manual retry.
- Update admission race: backend returns a definite refusal without spawning anything.
- Spawn failure or nonzero exit: state is failed with a sanitized bounded tail.
- Output cap exhaustion: kill and reap the complete process group, report
  `outputLimitExceeded`, retain only the bounded tail, and mark it truncated.
- Timeout, cancellation, disconnect, or panic: kill and reap the process group, release
  the permit, and report failure or uncertainty truthfully.
- Version mismatch after update: report failure and show the newly observed version if
  it parses, without claiming the requested update succeeded.
- Settings persistence failure: keep the existing persistence error behavior; do not
  start a network check based only on an unsaved opt-in.

## Test matrix

### Domain and settings

- exact two-provider settings record and exact per-provider fields;
- defaults, interval values `0`, `300`, and `86400`, clamping, fractional and non-finite
  values;
- malformed booleans and versions fail closed;
- unknown providers and extra keys are rejected;
- dismissal suppresses only the exact version;
- numeric version ordering and prerelease edge cases;
- every auth, installer, availability, health, update, and admission union is exhaustively
  handled.

### TypeScript IPC adapters

- validate exact outbound requests before invoke;
- reject extra, missing, oversized, negative, unknown, and malformed inbound fields;
- reject unbounded labels, output, operation identifiers, and timestamps;
- stale, duplicate, or foreign final results fail closed;
- native-runtime absence is a truthful gateway failure.

### Application coordinators and admission

- disabled provider rejects new thread and follow-up;
- updating provider rejects new thread and follow-up;
- update rejects pending, starting, running, and unacknowledged turns of the same provider;
- another provider's running turn does not block update;
- provider disable, path change, or update begin during each dispatch await boundary;
- authority loss after worktree creation runs exact compensation;
- A to B to A path and provider settings generations reject late results;
- manual refresh coalescing, timer replacement, interval zero, and unmount cleanup;
- successful update re-probes before success and stale completion cannot publish;
- settings persistence rejection cannot authorize a network-backed check.
- persisted settings success cannot authorize a check until the matching backend policy
  registration receipt is current;
- save failure rolls back only exact provider fields and preserves concurrent unrelated
  app setting edits;
- stale save, registration receipt, and backend provider generation cannot publish;
- unregistered and failed policy states block admission and expose the exact retry reason;

### Rust plans and parsers

- fake provider executables for supported signed-in, signed-out, unsupported, nonzero,
  timeout, garbage, oversized, and control-character output;
- fixture-backed Claude capability selection for JSON, text, and unavailable versions;
- JSON unsupported-option classification falls back exactly once to text, while auth
  failure, timeout, signed-out, and garbage never fall back;
- npm and Homebrew JSON for exact match, missing, ambiguous, malformed, oversized,
  duplicate, and unrelated package entries;
- configured executable maps exactly to installer binary identity;
- no network-capable command when opt-in is false;
- argv is fixed for every semantic operation and never passes through a shell;
- environment allowlist, stdin closure, timeouts, output caps, and concurrency caps;
- process group reaped on exit, timeout, cancellation, spawn failure, panic, and drop;
- run and update permits exclude one another under concurrent start races;
- stale health leases cannot cache or publish after configuration replacement;
- policy replace rejects conflicting same-revision and unauthorized older revisions,
  and retires cached candidates on an accepted replacement;
- identical same-revision registration returns the original generation receipt after a
  simulated lost response;
- N registrations followed by frontend reload reacquire the current receipt for an
  identical persisted payload despite a reset client counter;
- after frontend reload, a differing persisted payload replaces only with the exact
  current generation CAS;
- conflicting same-revision payloads return `revisionConflict`, and unauthorized older
  revisions without exact generation authority return `staleRevision`;
- turn, health, and update requests reject stale backend provider generations;
- descriptor or fingerprint replacement before spawn refuses the update;
- update IPC cannot select a version or installer and rejects unknown fields;
- nonzero update, successful update, and zero-exit version mismatch.
- fake oversized update output crosses the total cap, kills and reaps the process group,
  returns `outputLimitExceeded`, and exposes only a bounded tail with
  `outputTruncated: true`;
- shutdown during health, turn startup, and update reaps every process and lease.

### UI

- two provider cards render all closed health and auth states;
- disabled provider is absent from model rails and model rows;
- disabling the active provider selects the first enabled draft provider;
- both disabled produces a disabled composer and Settings action;
- disabled favorites remain stored but hidden;
- interval input supports zero and bounds values;
- update opt-in, Refresh, dismissal, Update, running progress, failure tail, and success
  notice;
- stale toast and stale update completion do not render;
- unregistered and registration-failed provider cards, rail indicators, admission
  reasons, and retry actions;
- keyboard focus and Escape behavior remain correct.

Tests use real reducers, parsers, stores, and coordinators. Only Tauri invoke, clocks,
process executables, and other third-party boundaries are faked.

## Disjoint implementation ownership

One writer owns each row until review and integration:

| Stream                        | Owned files                                                                                                                                                       | Forbidden overlap                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Domain and persisted settings | `src/domain/agentSettings.ts`, `src/domain/agentSettings.test.ts`, `src/domain/settings.ts`, `src/domain/settings.test.ts`, new provider contract module and test | React, application hooks, infrastructure, Rust        |
| Rust health and update core   | New focused Rust provider modules and unit tests                                                                                                                  | TypeScript, `lib.rs`, existing agent task composition |
| Rust exclusion integration    | Provider-operation registry, agent task admission/spawner integration and tests                                                                                   | Provider parsers, TypeScript, UI                      |
| TypeScript IPC adapters       | New provider health/update Tauri gateways, IPC contracts, and tests                                                                                               | Domain policy, React, Rust                            |
| Application health/update     | New focused health scheduler and update coordinator with tests                                                                                                    | UI components, persistence normalizers, Rust          |
| Turn admission                | `src/application/agentTurnAdmission.ts`, `src/application/useAgentTurnDispatch.ts`, and their tests                                                               | Provider UI, settings domain, Rust                    |
| Provider settings UI          | `AgentsSettingsPanel`, `AgentsSettingsSection`, their tests, and narrowly owned settings CSS                                                                      | Composer, application coordinators, domain            |
| Composer and rail UI          | Model picker, composer wiring, rail footer, notices, their tests, and narrowly owned agent-mode CSS                                                               | Settings components, domain, Rust                     |
| Composition integration       | `workbenchComposition.ts`, controller contracts and agent composition hooks, settings host/dialog wiring, `App.tsx`, Rust command registration                    | Leaf implementations owned by other streams           |

Shared composition files are assigned only after leaf contracts settle. Every stream gets
an independent read-only adversarial review. The lead resolves findings, runs focused
tests, full gates, and commits each complete reviewed slice locally. Nothing is pushed.

## Acceptance criteria

The slice is complete only when:

- both provider cards use persisted normalized settings and exact runtime health;
- auth probes retain no credentials and fail unknown safely;
- update checks make no network-capable process call without persisted opt-in;
- unknown installer identity cannot produce an update command;
- turns and updates are mutually exclusive in both application and Rust race boundaries;
- all processes are typed, bounded, no-shell, process-group owned, and reaped;
- disabled providers are absent from the picker and rejected by authoritative admission;
- update notices, dismissal, progress, failure, and post-update re-probe are truthful;
- all specified domain, IPC, race, process, and UI tests pass;
- repository gates pass without warning suppression or hotspot baseline increases;
- no scratch, preview, screenshot, binary, or generated artifact is committed;
- no commit is pushed.
