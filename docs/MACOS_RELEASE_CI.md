# macOS Release CI

Date: 2026-07-02
Status: Mac-only workflow validated with a real local unsigned debug build; `signed-release` still needs Apple secrets before it can pass

This document describes `.github/workflows/macos-release.yml`.

## Scope

The workflow is intentionally macOS-only. Windows and Linux packaging are out of scope for the current release track.

The workflow has two manual modes:

- `smoke`: run checks and build an unsigned debug DMG artifact.
- `signed-release`: run checks, import Apple signing credentials, build a signed/notarized release DMG, verify it, and upload the DMG artifact.

## Sources Checked

- Tauri GitHub pipeline docs: https://v2.tauri.app/distribute/pipelines/github/
- Tauri macOS signing docs: https://v2.tauri.app/distribute/sign/macos/
- GitHub-hosted runner reference: https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- GitHub setup-node docs: https://github.com/actions/setup-node
- GitHub checkout release notes: https://github.com/actions/checkout/releases
- GitHub upload-artifact release notes: https://github.com/actions/upload-artifact/releases

## Runner Policy

The workflow uses `macos-15` directly instead of `macos-latest` so the job is not affected by the June 2026 `macos-latest` migration to macOS 26.

GitHub's hosted runner reference lists `macos-15` as an arm64 macOS runner label, matching the current first release target:

```text
aarch64-apple-darwin
```

## Smoke Mode

Smoke mode does not require Apple credentials.

It runs:

```sh
npm ci
npm run check
npm test
npm run build
cargo test
npm run tauri build -- --debug
hdiutil imageinfo <debug-dmg>
```

`cargo fmt --check` is intentionally not part of the gate: `main` currently has pre-existing formatting drift, and `pr-checks.yml` (the existing PR gate) does not check formatting either. Adding a stricter gate here would fail the workflow on unrelated code, which would defeat the "must work without secrets" requirement.

It uploads:

- debug DMG
- debug `.app` bundle

These artifacts are not release artifacts.

### Opening The Unsigned Debug Build Locally

The debug `.app`/`.dmg` produced by `smoke` mode is ad-hoc signed (no Developer ID, no notarization). macOS Gatekeeper blocks it by default when downloaded from a browser or CI artifact zip (`com.apple.quarantine` extended attribute). To run it locally:

1. Download and unzip the `codevo-editor-macos-debug` artifact from the workflow run.
2. Either right-click (or Control-click) `Codevo Editor.app` in Finder, choose "Open", then confirm "Open" in the Gatekeeper dialog, or clear the quarantine flag from a terminal:
   ```sh
   xattr -dr com.apple.quarantine "Codevo Editor.app"
   ```
3. This is a debug build for smoke-testing packaging only; it is not a distributable release artifact.

For a transition test on a Mac that already has `Mockor Editor.app`, remove or replace that old bundle before copying `Codevo Editor.app` into `/Applications`. The rename changes the bundle filename, so macOS can otherwise retain both applications side by side. Apply the same one-time manual removal step before the first Codevo-branded release/manual upgrade; this workflow does not implement updater migration machinery.

## Signed Release Mode

Signed release mode requires these repository secrets:

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `KEYCHAIN_PASSWORD`
- `APPLE_API_ISSUER`
- `APPLE_API_KEY`
- `APPLE_API_KEY_CONTENT`

`APPLE_CERTIFICATE` is a base64-encoded `.p12`.

`APPLE_API_KEY_CONTENT` is the content of the App Store Connect `.p8` key. The workflow writes it to a temporary file and exposes `APPLE_API_KEY_PATH` for Tauri; Tauri's signing/notarization step reads that path, not the raw content, so this indirection is required.

If any of the seven secrets above are missing, the "Validate signing secrets" step fails fast with one `::error::` annotation per missing secret, before any signing material is touched or any build runs.

### Setting Up The Secrets

Requires a paid Apple Developer Program membership and Account Holder (or delegated) access to create a `Developer ID Application` certificate.

1. **`APPLE_SIGNING_IDENTITY`**
   - Create (or locate) a `Developer ID Application` certificate in Xcode (Settings > Accounts > Manage Certificates) or in the Apple Developer portal (Certificates, IDs & Profiles).
   - The identity string is the certificate common name, e.g. `Developer ID Application: Your Name (TEAMID1234)`. Find it with:
     ```sh
     security find-identity -v -p codesigning
     ```

2. **`APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD`**
   - In Keychain Access, find the `Developer ID Application` certificate (it must include the private key), right-click it, choose "Export", and save as a `.p12` file. Set an export password: that password is `APPLE_CERTIFICATE_PASSWORD`.
   - Base64-encode the `.p12` for the `APPLE_CERTIFICATE` secret:
     ```sh
     base64 -i DeveloperIDApplication.p12 | pbcopy
     ```
   - Paste the clipboard contents as the `APPLE_CERTIFICATE` secret value.

3. **`KEYCHAIN_PASSWORD`**
   - Any new, random password used only to protect the temporary CI keychain for the duration of the job. Generate one, e.g. `openssl rand -base64 24`.

4. **`APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_CONTENT`** (App Store Connect API key, used for notarization)
   - In App Store Connect (Users and Access > Integrations > App Store Connect API), create a key with at least the "Developer" role.
   - `APPLE_API_ISSUER` is the Issuer ID shown on that page.
   - `APPLE_API_KEY` is the Key ID shown for the created key.
   - Download the private key `.p8` file (Apple only allows downloading it once) and set `APPLE_API_KEY_CONTENT` to its full file contents, e.g.:
     ```sh
     cat AuthKey_XXXXXXXXXX.p8 | pbcopy
     ```

5. Add all seven values in the GitHub repository under Settings > Secrets and variables > Actions > New repository secret, using the exact names listed above.

The workflow imports the certificate into a temporary keychain, builds:

```sh
npm run tauri build -- --bundles dmg
```

Then verifies:

```sh
codesign --verify --deep --strict --verbose=2 <app>
codesign -dv --verbose=4 <app>
codesign -d --entitlements :- <app>
spctl -a -vvv -t exec <app>
xcrun stapler validate <dmg>
spctl -a -vvv -t open --context context:primary-signature <dmg>
spctl -a -vvv -t install <dmg>
hdiutil imageinfo <dmg>
```

## Secret Boundary

The workflow:

- writes certificate and API key material only under `$RUNNER_TEMP`
- deletes the temporary keychain at job completion
- uploads only the release DMG
- does not commit signing identity, private keys, certificates, or notarization credentials

## Running The Workflow

The workflow only runs on manual dispatch, never automatically on push/PR/tag:

1. In the GitHub repository, open the Actions tab.
2. Select "macOS Release" in the left sidebar.
3. Click "Run workflow", choose the branch, pick `mode`:
   - `smoke` needs no secrets and always produces an unsigned debug artifact.
   - `signed-release` needs all seven Apple secrets configured first.
4. Click "Run workflow" to start the job.

## Finding The Artifact

After a run completes, open the workflow run page and scroll to the "Artifacts" section at the bottom:

- `smoke` mode uploads `codevo-editor-macos-debug` containing the debug `.app` and `.dmg`.
- `signed-release` mode uploads `codevo-editor-macos-signed-release` containing the signed, notarized, stapled release `.dmg`.

Artifacts are retained per the repository's default GitHub Actions artifact retention setting.

## Follow-Up

- Add protected GitHub environment rules before using `signed-release`.
- Add GitHub Release upload after the first signed DMG is verified manually.
- Add packaged GUI smoke automation after a stable fixture app launch flow exists.
- Keep updater disabled until `docs/UPDATE_CHANNEL_PLAN.md` prerequisites are complete.
- Tag-triggered `signed-release` runs (e.g. on `v*` tags) are deferred until the first manual signed-release dry run is verified; `workflow_dispatch` is intentionally the only trigger for now to avoid an accidental release attempt before secrets and the protected environment exist.
