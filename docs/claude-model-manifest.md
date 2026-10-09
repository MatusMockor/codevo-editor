# Claude model catalog

Codevo automatically reads the public [t3code model manifest](https://raw.githubusercontent.com/pingdotgg/t3code/main/apps/server/src/provider/model-manifest.json).
No separate public repository, endpoint, token, or release configuration is required.
Only public model metadata is downloaded; project content is not sent.

The backend converts `providers.claudeAgent` into Codevo's internal catalog. It
resolves profiles, model aliases, the default model, current/legacy status, CLI
version bounds, effort choices and their CLI mappings, context windows, fast mode,
and thinking support. Unsupported Claude capabilities or malformed data reject the
whole update and preserve the last usable catalog.

From `providers.codex` only the curated `current`/`legacy` status per model slug is
read. A Codex catalog model is legacy when the Codex CLI reports an upgrade target or
the curated list marks its id legacy; the default model is never legacy from the
curated list alone. The two sections are parsed independently: a missing, malformed,
oversized, or unknown-status Codex section keeps the last good Codex statuses and
never affects the Claude catalog. All other providers are ignored.

The initial bundled fallback is `src/domain/claudeModelManifest.json`. On startup,
the backend reads its validated disk cache and refreshes asynchronously. Successful
fetches have a one-hour TTL; failures retry after five minutes when the catalog is
requested. Requests time out after ten seconds and are limited to 256 KiB. Refreshes
are single-flight, use HTTPS, and do not follow redirects.

The cache is `claude-model-manifest-t3-v3.json` in the application's data directory;
the retired `-v1` and `-v2` files are removed on startup.
It stores the normalized internal manifest, the curated Codex legacy model ids, and
the fetch time using an atomic replacement.
An older cache cannot replace a newer bundle, and older remote timestamps cannot
roll the catalog back. This source-specific filename excludes caches from the former
custom-endpoint implementation. Offline operation uses the last valid cache or bundle.

The frontend subscribes to catalog updates and requests a snapshot every minute
while mounted. Updated models appear without an application release. The backend
validates each launch against one immutable catalog snapshot and the selected
Claude CLI version. A model requiring a newer CLI is rejected before process start.
Saved canonical model choices remain parseable when the catalog changes; removed
choices cannot bypass launch validation.

The upstream repository controls model metadata and default choices. New upstream
schema or capabilities may require a Codevo adapter update. Offline regression tests
use a checked-in upstream fixture; the ignored live-source Rust smoke test can be run
explicitly to verify current network and schema compatibility.
