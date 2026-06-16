# macOS Signing And Notarization Plan

Date: 2026-06-16
Status: Release plan documented, credentials not configured

This plan covers direct macOS distribution for `Mockor Editor` as a Developer ID signed and notarized `.dmg`. App Store distribution is out of scope for this slice.

## Source Baseline

- Tauri macOS signing docs, last updated 2026-05-17: https://v2.tauri.app/distribute/sign/macos/
- Tauri distribution overview: https://v2.tauri.app/distribute/
- Tauri environment variables reference: https://v2.tauri.app/reference/environment-variables/
- Apple Developer ID overview: https://developer.apple.com/developer-id/
- Apple notarization workflow docs: https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- Apple custom notarization workflow docs: https://developer.apple.com/documentation/security/customizing-the-notarization-workflow

Key external requirements from those sources:

- Direct macOS `.dmg` distribution requires code signing and notarization.
- A free Apple Developer account can sign only for testing and development; notarization requires a paid Apple Developer Program account.
- Direct distribution outside the Mac App Store needs a `Developer ID Application` certificate.
- Apple notarization can be driven by App Store Connect API credentials or Apple ID plus app-specific password credentials.
- `notarytool` submits the artifact to Apple; `stapler` attaches and validates the notarization ticket.

## Current Local State

Verified on the current machine:

```text
security find-identity -v -p codesigning
```

Result: `0 valid identities found`

```text
xcode-select -p
```

Result: `/Library/Developer/CommandLineTools`

```text
xcodebuild -version
```

Result: fails because the active developer directory is Command Line Tools, not Xcode.app.

```text
xcrun notarytool --help
```

Result: available. Subcommands include `store-credentials`, `submit`, `info`, `wait`, `history`, and `log`.

```text
xcrun stapler help
```

Result: available. Supported actions include `staple` and `validate` for UDIF disk images, signed app bundles, and signed flat installer packages.

```text
npm run tauri info
```

Result: Tauri 2.11.2, Xcode Command Line Tools installed, Xcode.app not installed.

The app currently builds an unsigned debug DMG at:

```text
src-tauri/target/debug/bundle/dmg/Mockor Editor_0.1.0_aarch64.dmg
```

Current debug artifacts are not a release baseline:

- `codesign -dv --verbose=4` reports ad-hoc signing and `TeamIdentifier=not set` for the debug `.app`.
- `codesign --verify --deep --strict` fails on the debug `.app`.
- `xcrun stapler validate` reports no ticket for the debug `.dmg`.
- `spctl -a -vvv -t open --context context:primary-signature` rejects the debug `.dmg` because it has no usable signature.

## Release Target

Primary target:

- macOS direct download `.dmg`
- Developer ID signed
- notarized and stapled
- initially `aarch64-apple-darwin`

Architecture decision still pending:

- Keep Apple Silicon-only releases while the app is early and local testing is Apple Silicon-only.
- Add `x86_64-apple-darwin` or universal builds only after Intel smoke coverage exists.

## Required Secrets And Credentials

Developer account:

- paid Apple Developer Program membership
- Team ID
- Account Holder access for creating the Developer ID certificate, or a certificate already exported by the Account Holder

Signing certificate:

- `Developer ID Application` certificate for direct distribution
- local keychain install for local release builds, or exported `.p12` for CI
- exported `.p12` password when using CI

Tauri/local signing inputs:

- `APPLE_SIGNING_IDENTITY`

Tauri CI signing inputs:

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `KEYCHAIN_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- optional `APPLE_PROVIDER_SHORT_NAME` for Apple IDs associated with more than one provider

Notarization inputs, choose one path:

- App Store Connect API: `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`
- Apple ID: `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`

Preferred path: App Store Connect API credentials for CI, because they avoid storing a personal Apple ID password flow in release automation.

## Tauri Configuration Policy

Current `src-tauri/tauri.conf.json` has no `bundle.macOS` block. The Tauri schema supports these macOS release fields:

- `bundle.macOS.signingIdentity`
- `bundle.macOS.hardenedRuntime`
- `bundle.macOS.providerShortName`
- `bundle.macOS.entitlements`

Policy:

- Keep signing identity out of committed config until the final release identity is known.
- Prefer `APPLE_SIGNING_IDENTITY` locally and in CI secrets.
- Keep `hardenedRuntime` at the Tauri default, which is `true`.
- Do not add an entitlements file until a concrete runtime requirement appears.
- Add `bundle.macOS.providerShortName` only if Apple account membership or notary provider selection requires it.
- Prefer `APPLE_PROVIDER_SHORT_NAME` for provider selection in CI when possible.

This keeps the repository portable across local machines and CI accounts, while preserving a clear extension point for release-only config.

## Entitlements Review

No macOS entitlements are required by the current app surface:

- file access is user-selected through app commands and Tauri plugins
- terminal and PHPactor launches use host processes behind workspace trust
- no camera, microphone, contacts, calendar, location, Apple Events, iCloud, push notification, or app sandbox scope is currently used

Release rule:

- Add entitlements only when a specific macOS capability requires them.
- Do not enable App Sandbox without a separate design for terminal, host-tool discovery, and workspace filesystem access.
- Do not ship `com.apple.security.get-task-allow` in release artifacts.
- Re-run packaged smoke tests after any entitlement change.
- Re-check sidecar signing if PHP, PHPactor, Intelephense, Watchman, ripgrep, or helper binaries become bundled.

## Local Release Flow

Prerequisites:

1. Install Xcode.app or confirm current Command Line Tools are sufficient for the selected release process.
2. Install a valid `Developer ID Application` certificate in the login keychain.
3. Confirm the identity is visible:

```sh
security find-identity -v -p codesigning
```

4. Export the selected identity:

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Matus Mockor (TEAMID)"
```

5. Configure notarization credentials using App Store Connect API credentials:

```sh
export APPLE_API_ISSUER="issuer-id"
export APPLE_API_KEY="key-id"
export APPLE_API_KEY_PATH="/secure/path/AuthKey_KEYID.p8"
```

6. Build a release DMG:

```sh
npm run tauri build -- --bundles dmg
```

Expected release artifact:

```text
src-tauri/target/release/bundle/dmg/Mockor Editor_0.1.0_aarch64.dmg
```

## CI Release Flow

CI should import the `.p12` certificate into a temporary keychain and expose release credentials only to protected release jobs.

Required job properties:

- macOS runner
- protected branch or tag trigger
- secret-scoped environment
- no certificate material printed to logs
- temporary keychain cleanup at job completion

Minimum CI steps:

1. Decode `APPLE_CERTIFICATE` into a `.p12` file.
2. Create and unlock a temporary keychain.
3. Import the `.p12` with `APPLE_CERTIFICATE_PASSWORD`.
4. Run `security set-key-partition-list` for `codesign`.
5. Verify `security find-identity -v -p codesigning`.
6. Run `npm ci`.
7. Run `npm run tauri build -- --bundles dmg`.
8. Upload only the signed, notarized, stapled DMG and build logs.

## Manual Notarization Fallback

Tauri can notarize during the build when Apple credentials are present. Keep a manual fallback for diagnosis:

```sh
DMG_PATH="src-tauri/target/release/bundle/dmg/Mockor Editor_0.1.0_aarch64.dmg"
xcrun notarytool submit "$DMG_PATH" \
  --issuer "$APPLE_API_ISSUER" \
  --key-id "$APPLE_API_KEY" \
  --key "$APPLE_API_KEY_PATH" \
  --wait
xcrun stapler staple "$DMG_PATH"
xcrun stapler validate "$DMG_PATH"
```

Apple ID fallback:

```sh
DMG_PATH="src-tauri/target/release/bundle/dmg/Mockor Editor_0.1.0_aarch64.dmg"
xcrun notarytool submit "$DMG_PATH" \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_PASSWORD" \
  --wait
xcrun stapler staple "$DMG_PATH"
xcrun stapler validate "$DMG_PATH"
```

If notarization fails:

```sh
xcrun notarytool log "$SUBMISSION_ID" \
  --issuer "$APPLE_API_ISSUER" \
  --key-id "$APPLE_API_KEY" \
  --key "$APPLE_API_KEY_PATH"
```

## Release Verification Gate

Run these checks before publishing a macOS DMG:

```sh
codesign --verify --deep --strict --verbose=2 "src-tauri/target/release/bundle/macos/Mockor Editor.app"
codesign -dv --verbose=4 "src-tauri/target/release/bundle/macos/Mockor Editor.app"
codesign -d --entitlements :- "src-tauri/target/release/bundle/macos/Mockor Editor.app"
spctl -a -vvv -t exec "src-tauri/target/release/bundle/macos/Mockor Editor.app"
xcrun stapler validate "src-tauri/target/release/bundle/dmg/Mockor Editor_0.1.0_aarch64.dmg"
spctl -a -vvv -t open --context context:primary-signature "src-tauri/target/release/bundle/dmg/Mockor Editor_0.1.0_aarch64.dmg"
spctl -a -vvv -t install "src-tauri/target/release/bundle/dmg/Mockor Editor_0.1.0_aarch64.dmg"
hdiutil imageinfo "src-tauri/target/release/bundle/dmg/Mockor Editor_0.1.0_aarch64.dmg"
```

Then perform the packaged smoke checklist from `docs/PACKAGING_RUNTIME_READINESS.md` on a fresh macOS user profile or clean VM.

## Failure Handling

Certificate not found:

- rerun `security find-identity -v -p codesigning`
- verify the private key is present under Keychain Access `My Certificates`
- verify the certificate is a `Developer ID Application` certificate

Notarization rejected:

- fetch the notary log
- fix every reported unsigned, modified-after-signing, invalid entitlement, or nested-binary issue
- rebuild from a clean release artifact

Stapling fails:

- verify notarization status first
- retry stapling only after Apple reports success
- validate the final DMG after stapling

Gatekeeper rejects the artifact:

- run `spctl` on both `.app` and `.dmg`
- verify the DMG was not modified after stapling
- rebuild and notarize a fresh artifact

## Residual Risks

- No valid local signing identity is installed today.
- Xcode.app is not installed today; Command Line Tools are present.
- Release signing cannot be completed without paid Apple Developer Program credentials.
- CI release automation is not implemented yet.
- The current debug DMG is unsigned and not notarized.
- Future bundled sidecars must be signed as nested code and may require extra verification.
- License, homepage, and update-channel metadata are still pending Phase 8 decisions.

## Done Criteria For A Future Signing Implementation

- valid Developer ID identity visible in local or CI keychain
- release `npm run tauri build -- --bundles dmg` completes with signing and notarization credentials
- stapled DMG validates with `xcrun stapler validate`
- `.app` validates with `codesign` and `spctl`
- `.dmg` validates with `spctl -t install`
- packaged smoke checklist passes from a downloaded or quarantined artifact
- release documentation records the certificate type, credential path, and supported architectures without exposing secrets
