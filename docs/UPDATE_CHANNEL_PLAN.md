# Update Channel Plan

Date: 2026-06-16
Status: First-release update channel decision documented

This plan decides how `Mockor Editor` should publish and update packaged desktop releases.

## Source Baseline

- Tauri updater docs, last updated 2025-11-28: https://v2.tauri.app/plugin/updater/
- Tauri updater v2 changelog, checked at `2.10.1` on 2026-06-16: https://github.com/tauri-apps/tauri-plugin-updater/blob/v2/CHANGELOG.md
- Tauri GitHub Action docs: https://github.com/tauri-apps/tauri-action
- macOS signing plan: `docs/MACOS_SIGNING_NOTARIZATION_PLAN.md`
- sidecar/runtime packaging plan: `docs/SIDECAR_RUNTIME_PACKAGING_PLAN.md`

External facts used by this plan:

- Tauri updater can use a dynamic update server or a static JSON file.
- Tauri updater signatures are mandatory and cannot be disabled.
- Updater signing uses a Tauri key pair, separate from Apple Developer ID signing and notarization credentials.
- The updater public key is committed in `tauri.conf.json`; the private key is used only for release signing and must stay secret.
- Losing the updater private key prevents publishing updates to already installed users.
- Tauri can generate updater artifacts with `bundle.createUpdaterArtifacts`.
- On macOS, updater artifacts are `.app.tar.gz` plus `.sig`, while the user-facing manual installer remains the `.dmg`.
- Production updater endpoints must use HTTPS unless `dangerousInsecureTransportProtocol` is explicitly enabled, which this project must not do.
- Static JSON update metadata requires version, platform URL, and signature content.
- The `2.10.1` changelog includes newer updater capabilities such as `allowDowngrades`, proxy controls, invalid TLS acceptance for internal servers, and wider bundle support; this plan intentionally leaves those disabled unless a future release requirement designs them.

## Current Repository State

Updater is not configured today:

```text
@tauri-apps/plugin-updater: not installed
tauri-plugin-updater: not installed
src-tauri/tauri.conf.json -> plugins: null
src-tauri/tauri.conf.json -> bundle.createUpdaterArtifacts: default false
src-tauri/capabilities/default.json -> no updater permissions
src-tauri/src/lib.rs -> initializes dialog and opener plugins, not updater
```

Local CLI support exists:

```text
npm run tauri signer -- --help
```

Result: `signer` supports `generate` and `sign`.

Current build support:

```text
npm run tauri build -- --help
```

Result: release builds support `--target`, including `universal-apple-darwin`, and macOS bundle targets include `app` and `dmg`.

Current updater package versions observed on 2026-06-16:

```text
@tauri-apps/plugin-updater: 2.10.1
tauri-plugin-updater: 2.10.1
```

## Decision

First signed release policy:

- Publish manual downloads only.
- Ship a signed, notarized, stapled macOS DMG.
- Do not enable in-app auto-update yet.
- Do not add updater plugin dependencies, updater permissions, updater endpoints, or updater public keys until the release pipeline is real.
- Release notes must say users update by downloading a newer DMG.

Future update channel policy:

- Use Tauri updater v2.
- Use GitHub Releases static JSON first.
- Allow a CDN or dynamic update server only after release volume or staged rollout needs justify it.
- Generate and store a Tauri updater signing key pair before the first auto-update capable build is shipped.
- Build updater artifacts in CI with `TAURI_SIGNING_PRIVATE_KEY` and optional `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Keep Apple Developer ID signing/notarization and Tauri updater signing as separate gates.

Rationale:

- The app has no release host, updater keys, CI signing pipeline, or public artifact policy today.
- Enabling updater config without endpoints and keys would create a partial security surface.
- Manual DMG releases are enough while packaging, signing, runtime policy, and platform feasibility are still being hardened.
- Shipping an auto-update-capable build before key storage and rotation policy is settled would create avoidable long-term risk.

## Future Tauri Updater Implementation

Required dependencies:

```sh
npm run tauri add updater
```

or manual equivalents:

```sh
cargo add tauri-plugin-updater --target 'cfg(any(target_os = "macos", windows, target_os = "linux"))'
npm install @tauri-apps/plugin-updater
```

Required Rust setup:

- initialize `tauri_plugin_updater::Builder::new().build()` only on desktop targets
- choose Rust-owned update commands or frontend-owned plugin calls
- use a command plus IPC channel if the app wants controlled progress UI

Required config:

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "CONTENT FROM PUBLICKEY.PEM",
      "endpoints": [
        "https://github.com/<owner>/<repo>/releases/latest/download/latest.json"
      ]
    }
  }
}
```

Policy:

- `plugins.updater.pubkey` must contain the public key content, not a file path.
- endpoints must be HTTPS.
- `dangerousInsecureTransportProtocol` must remain absent or false.
- `dangerousAcceptInvalidCerts` and `dangerousAcceptInvalidHostnames` must remain absent or false.
- proxy bypass options must remain unset unless a corporate-network support case requires a separate design.
- use default `{{target}}` and `{{arch}}` keys for normal architecture-specific builds.
- use a custom target such as `macos-universal` only if universal DMG/updater artifacts become the release target.
- do not enable downgrades unless rollback requirements are formally designed.

Required capabilities:

- Prefer a Rust-owned update command for the first implementation.
- If frontend plugin APIs are used directly, add the narrowest updater permissions needed.
- Do not grant `updater:default` until the UI owns check, download, install, and relaunch UX.

## Signing Keys And Secrets

Generate updater keys:

```sh
npm run tauri signer generate -- -w ~/.tauri/mockor-editor-updater.key
```

Release CI secrets:

- `TAURI_SIGNING_PRIVATE_KEY`
- optional `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Key storage rules:

- store private key in a password manager and CI secret store
- keep an offline backup controlled by the release owner
- commit only the public key
- document key creation date, owner, and recovery path without storing secret material

Key rotation rules:

- do not rotate casually
- runtime public-key rotation requires an already trusted app version that accepts both current and future keys
- publish a rotation runbook before any auto-update capable release ships

## Artifact Policy

Manual first release artifacts:

- `Mockor Editor_0.1.0_aarch64.dmg`
- release notes
- checksum file if release process adds one

Future macOS updater artifacts:

- `Mockor Editor.app.tar.gz`
- `Mockor Editor.app.tar.gz.sig`
- static `latest.json`
- signed, notarized, stapled DMG for fresh installs

Future Windows/Linux artifacts:

- Windows installer plus `.sig` once Windows signing strategy exists
- Linux AppImage plus `.sig` once Linux packaging strategy exists

## Static JSON Policy

Initial update endpoint:

```text
https://github.com/<owner>/<repo>/releases/latest/download/latest.json
```

Static JSON requirements:

- `version` must be SemVer
- each platform entry uses `OS-ARCH`, for example `darwin-aarch64`
- each platform entry must include `url` and `signature`
- `signature` is the content of the `.sig` file, not a URL or path
- include `notes` and RFC 3339 `pub_date` when release automation can populate them
- validate the whole JSON before publishing

Tauri GitHub Action can generate and upload updater JSON when updater is configured, so it is the preferred first automation path.

## User Experience Policy

First release:

- no background update checks
- no in-app update install
- release notes and app docs tell users to download the next DMG manually

Future updater:

- expose an explicit `Check For Updates` command first
- show version, notes, download size when available, and install/relaunch confirmation
- avoid silent background install
- record update failures in a local Problems notice or update dialog
- relaunch only after user confirmation

## Security Review

- Tauri updater signature verification protects update artifacts.
- Apple Developer ID signing and notarization still protect the macOS app bundle and DMG distribution path.
- HTTPS protects metadata and artifact transport.
- Invalid TLS acceptance and insecure transport options are not allowed for production update channels.
- Static JSON on GitHub Releases keeps the first server surface small.
- Dynamic update server is deferred until rollback, staged rollout, or channel segmentation needs are concrete.
- Sidecars remain bundled inside app artifacts; they must follow `docs/SIDECAR_RUNTIME_PACKAGING_PLAN.md`.
- Remote sidecar self-update is not allowed.

## Smoke Matrix

Manual release smoke:

1. Build release DMG.
2. Sign, notarize, staple, and Gatekeeper-check the DMG.
3. Download or copy the DMG as a fresh user would.
4. Install and launch from Finder.
5. Confirm release notes state manual update policy.

Future updater smoke:

1. Generate updater key pair in a test environment.
2. Build version `0.1.0` without update availability.
3. Build version `0.1.1` with updater artifacts and `.sig`.
4. Publish test `latest.json` over HTTPS.
5. Install `0.1.0`, run `Check For Updates`, download, install, relaunch, and verify app version.
6. Publish invalid signature and verify the app rejects it.
7. Publish same or older version and verify no update is installed.
8. Test missing JSON, malformed JSON, missing platform, missing signature, and non-2XX endpoint behavior.
9. Test `darwin-aarch64`, `darwin-x86_64`, or custom `macos-universal` only after those release targets exist.

## Follow-Up Implementation Slices

- Create release identity and distribution location.
- Add CI release job for signed/notarized DMG.
- Generate and store Tauri updater signing keys.
- Add updater plugin dependencies and config.
- Add explicit `Check For Updates` UI.
- Add updater smoke tests with a local HTTPS/static JSON fixture or controlled staging endpoint.
- Decide platform matrix before publishing updater-capable artifacts.
