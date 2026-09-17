# Remote workspace release verification — beta 51

## Environment and scope

Verification used a rebuilt native macOS Tauri application with isolated identifier
`dev.mockor.editor.qa`, the real SSH connection, and the direct Linux runner at
`codex-ubuntu`. UI actions were performed in the native application, not against a
browser mock. The regular editor profile was not used. The final runner revision
is `efa444d6eed3f1e8fe94bb58d57229a10b9bbc40`.

## Native application end-to-end results

- Files listed the server checkout and loaded a disposable text file in Monaco.
  Saving changed the actual server bytes. A concurrent server edit caused a stale
  save rejection with actionable guidance; the unsaved draft remained intact.
  Comparison and adopting the server version worked, and closing the comparison
  produced no model-disposal error. Closing and reopening Files retained a draft.
- Terminal commands returned `codex-ubuntu` and the correct checkout. A shell
  variable survived hiding and reopening the panel, proving attachment to the
  same shell. Explicit Close terminated the session.
- History listed real commits and files, and displayed the contents of `sum.js`
  in the native diff editor after selecting an added file.
- Task Diff displayed a disposable untracked file created in the exact server
  conversation worktree, including its contents against the empty index version.
- Linking a disposable local project to `live-e2e` produced one sidebar group with
  two repositories. Switching local/server targets retained the model and thread
  list. Returning from another project restored the selected remote conversation.
- A native Codex continuation created task
  `e3274efd-f4a4-4599-9cde-8e3a0d041acb` and returned the requested marker.
- A native Claude continuation collected the real global instruction files,
  synchronized them through the runner, created task
  `3fff3788-cd90-4c14-9628-a11bd47308f6`, and returned the requested marker.

The QA application was closed afterwards. Temporary project associations were
restored and both disposable server files were removed.

## Defects caught by E2E and repaired

1. Native string rejections lost their detail before reaching remote error UI.
   Bounded error normalization now preserves actionable messages, and stale-file
   responses explain that the file or workspace changed.
2. The raw Monaco comparison adapter disposed models before detaching them.
   Remote comparison now uses explicit detach-before-dispose ownership.
3. The History diff lacked its required flex parent and had zero content height.
   Its scoped container now participates in the correct flex layout.
4. Prose documentation annotations such as `@param/@var` and `@throws` were
   interpreted as instruction-file imports by both desktop and server parsers.
   Both now recognize these narrow prose cases while retaining validation of
   quoted/standalone imports and real Markdown files.

Each code fix received an independent read-only review and regression coverage;
all four affected flows were then repeated successfully in the rebuilt native app.

## Server verification

Real Codex and Claude starts and continuations succeeded through the authenticated
API in isolated test worktrees. API checks also covered version-checked file save,
stale-save rejection, path escapes, commit diffs, terminal replay, resize, exact
project/task ownership rejection and explicit terminal close.

The final server revision passed 329 Linux tests with two platform skips and 310
macOS tests with 21 platform skips. Provider updater tests passed. Docker packaging
was tested separately and repaired for the new native terminal dependency; the
production server continues to run directly on Linux.

The final server update used an idle restart with a rollback backup. Health,
runner identity and the provider update timer were checked afterwards. No active
provider task was interrupted.

## Evidence and limits

Native observations: `/tmp/codevo-release51-e2e/native-evidence.txt` on the test Mac.
Server API observations: `/tmp/codevo-release-e2e.log` on the Linux server.
These temporary logs are not release artifacts and contain no published credentials.

This verifies the listed flows, not arbitrary multi-hour runs or every editor
feature. Remote text editing is limited to 64 KiB, and terminal support provides
one primary session per project/task. A runner restart ends terminal sessions;
client disconnect alone does not. Native E2E used the QA build; the distributable
release is built and its updater signature verified by the tagged release workflow.
