# Provider Discovery and Beta Release Plan

Date: 2026-08-29

## S0 shared contracts

- Rust owns one app-lifetime `AgentCliDiscovery` service. It produces an immutable
  `EffectiveExecutableEnvironment` containing a bounded effective `PATH` and the exact
  discovered Claude and Codex executable identities. Refresh invalidates the cached
  path fingerprint and recomputes the same snapshot.
- Empty persisted CLI paths remain `null` and mean automatic discovery. A non-empty
  path remains a validated manual override. Every provider operation resolves through
  the registered provider policy backed by the discovery service; React never performs
  executable lookup.
- The effective executable environment exposes only the augmented `PATH` to other
  process adapters. Agent turns, provider probes, sign-in, updates, terminals, and
  package-script execution reuse that value and retain their existing typed no-shell
  plans and environment allowlists.
- Provider presentation is a closed union: `manual`, `detected`, or `notFound`.
  `detected` carries a bounded absolute display path and optional parsed version;
  `notFound` carries only the provider-specific fixed install command.
- Application updates use a separate strict updater port with `check`, `download`, and
  `installAndRestart` intents. A check cannot download. UI state is a closed reducer
  union and revalidates its request generation after every await.
- Version authority is `package.json`. The sync gate requires exact equality with
  `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
- Shared composition roots, dependency manifests, Tauri configuration, and capability
  registration are integrated sequentially after leaf contracts settle.

## Parallel ownership

1. Rust discovery service and unit tests.
2. TypeScript auto/manual settings semantics, discovery IPC presentation, provider UI,
   and tests.
3. Version synchronization script, version bump, changelog, and tests.
4. macOS release workflow and release documentation.
5. Updater domain/application/infrastructure leaf modules, General settings UI, and
   local fake-manifest tests.
6. Effective-PATH consumers for agent, terminal, and package-script process plans.

Composition, full gates, commits, pushes, packaging, and Finder-launched QA remain lead
ownership.
