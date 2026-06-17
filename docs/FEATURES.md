# Feature implementation notes

This file documents how selected app features are implemented and how to use them in code.

## Toast notifications

The editor uses a shared notice/toast pipeline.

### Files

- `src/application/workbenchNotice.ts`  
  - `WorkbenchNotice` model and factory helpers.
- `src/application/useWorkbenchController.ts`  
  - Maintains toast/notices state.
- `src/application/useNoticeToastRenderers.tsx`  
  - Maps notice payloads to toast UI renderers.
- `src/components/NoticeToastHost.tsx`  
  - Displays toasts and tracks dismissals.

### How to add/update a toast in code

1. Create a notice payload in your feature logic.
2. Choose a notice identity strategy:
   - Include `groupKey` for replaceable/grouped notices.
   - Omit `groupKey` for one-off one-time notices.
3. Push/replace notices in `useWorkbenchController`.
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
