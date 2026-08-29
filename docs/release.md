# Codevo Editor release process

The macOS release workflow is manual and publishes only an existing tag whose name
matches the version in `package.json`. It does not create or move tags.

## Release modes

- `smoke` builds and uploads a debug DMG as a workflow artifact. It does not create a
  GitHub Release and does not require secrets.
- `beta` publishes a GitHub prerelease when the package version contains `beta`. It
  uses Apple signing and notarization when all Apple secrets are present. With none of
  those secrets present, it publishes assets whose names and release title explicitly
  say `unsigned`.
- `signed-release` requires Apple signing and notarization and publishes a GitHub
  Release.

Both `beta` and `signed-release` publish a DMG, a signed `.app.tar.gz` updater bundle,
its `.sig`, and `latest.json`. The GitHub Release body is the matching version section
from `CHANGELOG.md`. A beta version is always marked as a prerelease, including when
Apple signing secrets are configured.

An unsigned beta is not an unsigned updater feed: the macOS application and DMG lack
Apple signing, but the updater archive still requires the Tauri updater signature.

## One-time updater key setup

Generate the updater keypair outside the repository. Choose a strong password when
prompted:

```bash
npm run tauri signer generate -- -w "$HOME/.tauri/codevo-editor-updater.key"
```

Keep both generated key files backed up securely. Put the public key in
`src-tauri/tauri.conf.json` as part of the updater configuration. Store the private key
and its password as GitHub Actions secrets:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < "$HOME/.tauri/codevo-editor-updater.key"
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

The workflow fails before building in both release modes if either updater secret is
missing. Never commit either the private key or its password.

## Apple signing and notarization secrets

`signed-release` requires all of these repository secrets:

- `APPLE_API_ISSUER`
- `APPLE_API_KEY`
- `APPLE_API_KEY_CONTENT`
- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `KEYCHAIN_PASSWORD`

`APPLE_CERTIFICATE` is the base64-encoded Developer ID Application `.p12` content.
`APPLE_API_KEY_CONTENT` is the App Store Connect API `.p8` content. Configure them with
`gh secret set NAME` or the repository's Actions secrets UI.

For `beta`, configure either all seven Apple secrets or none. A partial set fails
closed instead of silently producing a differently signed release.

## Publish Beta 1

Start from a clean, reviewed `main` whose synchronized version is
`0.2.0-beta.1`. Run the release gates locally, then create and push the exact annotated
tag:

```bash
git switch main
git pull --ff-only origin main
npm run check
git tag -a v0.2.0-beta.1 -m "Codevo Editor 0.2.0-beta.1"
git push origin v0.2.0-beta.1
```

Dispatch the workflow from that tag. Use `beta` for Beta 1:

```bash
set -euo pipefail
release_tag=v0.2.0-beta.1
release_mode=beta
release_commit="$(git rev-list -n 1 "$release_tag")"
dispatch_id="$(uuidgen | tr '[:upper:]' '[:lower:]')"
expected_title="macOS Release $release_mode $release_tag $dispatch_id"
gh workflow run macos-release.yml \
  --ref "$release_tag" \
  -f mode="$release_mode" \
  -f dispatch_id="$dispatch_id"

for attempt in $(seq 1 30); do
  matching_runs="$(gh run list \
    --workflow macos-release.yml \
    --commit "$release_commit" \
    --event workflow_dispatch \
    --limit 100 \
    --json databaseId,displayTitle \
    --jq ".[] | select(.displayTitle == \"$expected_title\") | .databaseId")"
  matching_count="$(printf '%s\n' "$matching_runs" | awk 'NF { count++ } END { print count + 0 }')"
  if [ "$matching_count" -gt 0 ]; then
    break
  fi
  sleep 2
done
if [ "$matching_count" -ne 1 ]; then
  echo "Unable to identify exactly one workflow run for dispatch $dispatch_id" >&2
  exit 1
fi
run_id="$matching_runs"
gh run watch "$run_id" --exit-status
```

For a signed non-beta release, use its matching tag and set
`release_mode=signed-release`. For a smoke run, use any reviewed ref and set
`release_mode=smoke`. The command derives the expected run title from that single
variable and always supplies a fresh dispatch UUID. The workflow refuses a release-mode
branch dispatch or a tag that does not exactly equal `v<package.json version>`.

Do not run `gh release create` manually. The workflow validates the build, creates a
draft, verifies the exact non-empty asset set, and only then publishes it. A failed
publish attempt removes only its unpublished draft and leaves the tag intact. A rerun
after a release was successfully published fails instead of replacing assets.

## Install a published macOS build

Download the DMG for an exact release tag:

```bash
release_tag=v0.2.0-beta.1
release_dir="$(mktemp -d)"
gh release download "$release_tag" --pattern '*.dmg' --dir "$release_dir"
```

Install it for the current user and launch it:

```bash
dmg_path="$(find "$release_dir" -maxdepth 1 -name '*.dmg' -print -quit)"
mount_dir="$(mktemp -d)"
hdiutil attach "$dmg_path" -nobrowse -mountpoint "$mount_dir"
mkdir -p "$HOME/Applications"
ditto "$mount_dir/Codevo Editor.app" "$HOME/Applications/Codevo Editor.app"
hdiutil detach "$mount_dir"
rmdir "$mount_dir"
open "$HOME/Applications/Codevo Editor.app"
```

Prefer an Apple-signed release for normal installation. An unsigned beta is clearly
labelled and is intended only for trusted testing; macOS Gatekeeper can refuse it.

## Published updater contract

`latest.json` contains the release version, the same changelog notes used by the
GitHub Release, an RFC 3339 publication timestamp, and the current macOS runner
architecture. Its updater URL points to the exact tagged `.app.tar.gz` asset, and its
signature comes from the matching `.sig` generated by the Tauri CLI.

GitHub's `/releases/latest` endpoint excludes prereleases. Consequently, a Beta 1
`latest.json` is published and can be downloaded from its exact
`/releases/download/v0.2.0-beta.1/latest.json` URL, but an application configured only
with `/releases/latest/download/latest.json` will not discover that beta. Beta-channel
auto-discovery remains unsupported until the application has a separate prerelease
channel endpoint; stable releases do use `/releases/latest`.
