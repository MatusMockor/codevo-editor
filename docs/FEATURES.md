# Feature implementation notes

This file documents how selected app features are implemented and how to use them in code.

## Toast notifications

The app uses a shared notice/toast pipeline.

### Files

- `src/application/workbenchNotice.ts`
  - `WorkbenchNotice` model and factory helpers.
- `src/components/useNoticeToastRenderers.tsx`
  - Maps notice payloads to toast UI renderers.
- `src/components/NoticeToastHost.tsx`
  - Displays toasts and tracks dismissals.
- `src/components/ToastNotification.tsx`
  - Reusable toast UI component with template types and action handlers.

### How to add/update a toast in code

1. Create a notice payload in your feature logic.
2. Choose a notice identity strategy:
   - Include `groupKey` for replaceable/grouped notices.
   - Omit `groupKey` for one-off one-time notices.
3. Push or replace the notice through the app's notice state owner.
4. Add or update a renderer in `useNoticeToastRenderers.tsx` for the notice payload.

### How to use grouped notices

- Use a stable key such as `feature-name:<scope>` for lifecycle-aware replacement.
- Dismissing a grouped notice is tracked by `group:` + group key.
- If source state still requires that grouped notice, it can be reintroduced.

## Adding feature notes

For new feature work, append a section in this file with:

- A short behavior description
- Affected files
- Integration points in state and commands/events
- Any side effects and error handling

Use the same pattern for other features that need contributor-facing implementation guidance.

## Remote add project and repository lookup

Selecting a server as the execution environment replaces the local folder browser with a stepped add-project dialog: sources, one entry field, confirm. Supported sources are a registered server project, a Git clone URL, and one exact GitHub `owner/repo` or GitLab `group/project` looked up through this machine's `gh` or `glab` account; lookup runs on the desktop, so it is available on macOS and Linux only. An unavailable source cannot be chosen or submitted, and a repository is accepted only when the looked-up provider and host are the ones that were asked for, so a renamed repository must be entered under its current path. A failed lookup offers **Use Git URL**, which moves to the Git URL step; an unreachable server, an unfinished host check, a missing provider CLI and a provider that is not signed in all offer **Retry** instead of a setup chip, with the command to run (`gh auth login`, `glab auth login`) in the reason line, and a truncated host list says so. A host signed in just now can need a few seconds before **Retry** finds it, because the desktop caches the CLI host status briefly. A repeated Enter on the entry that is already being looked up is ignored, so a held Enter runs one lookup, while a different entry supersedes the running one. A repository the host returns without any usable clone URL does not open confirm: the entry step reports "This host returned no usable clone URL. Use a Git URL instead." next to **Use Git URL**. Confirm validates the folder name under the server projects root, validates an optional branch against the runner's branch grammar, and offers only the clone protocols whose URL exists; HTTPS on a repository that is not public warns that the server clones anonymously, and only when an HTTPS clone URL exists. Enter starts the clone only from the folder name or branch field; Cmd/Ctrl+Enter is the primary shortcut. Submitting closes the dialog and the rail shows one bounded clone row, scoped to the workspace tab and the server, with status text, an indeterminate bar while queued or running, and cancel or dismiss. A refused submission stays in that row with its bounded reason. On success Codevo refreshes the server projects and selects the new project for the draft thread only once it is present in the refreshed list and only while the user selected nothing else meanwhile: choosing a project in the draft chooser, in the rail or in the scope menu, opening a thread, changing the composer's repository or switching servers all cancel the auto-selection, and the clone row then stays as "Clone finished" with **Dismiss**.

Not supported: repository search or suggestion lists, clone percentage (the runner reports status only), tracking a clone across an app restart, and GitHub Enterprise hosts. A provider without its CLI, without a login, or on a server without the `projectCloning` capability is shown disabled with a truthful one-line reason instead of being hidden.

### Main files

- `src/components/agentMode/remoteAddProject/` - dialog, step views, clone row, and the pure presentation helpers.
- `src/application/useRemoteAddProject.ts` - controller state machine, lookup and clone orchestration.
- `src/domain/repositoryLookup.ts`, `src/domain/repositoryCloneUrl.ts` - closed lookup contract and clone URL grammar.
