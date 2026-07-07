# Nette PhpStorm Parity - Threaded Work Plan

Date: 2026-07-07

## Goal

Move Nette support closer to PhpStorm behavior in Codevo Editor, focused on:

- NEON services and DI container resolution.
- Latte component and template variable context.
- Nette-specific diagnostics filtering with low false positives.

## Working Rule

The main Codex thread is the orchestrator only:

- split work into isolated Codex threads;
- keep thread ownership disjoint where possible;
- review and integrate thread results;
- run tests and QA after integration;
- do not use multi-agent workers for this effort.

If Codex thread creation is unavailable, continue locally and record that fallback in the final report. Do not silently replace Codex threads with multi-agent workers.

## Thread Slices

1. Nette DI Services
   - Improve service type resolution beyond simple class names.
   - Cover factories, anonymous generated services, setup calls, aliases, and cross-file NEON imports.
   - Add focused tests in the NEON/Nette intelligence area.

2. Latte Template Context
   - Improve template variables from presenters/components/render methods.
   - Improve `{control ...}`, `{include ...}`, `{block ...}`, `{varType ...}`, and member completions.
   - Keep Laravel/Blade behavior isolated.

3. Nette Diagnostics
   - Filter known Nette magic false positives conservatively.
   - Do not hide real PHP errors in app code.
   - Keep framework-specific filtering behind provider boundaries.

## Verification

Run at minimum:

- `npm run smoke -- nette`
- targeted Vitest files touched by each slice
- `npm run check`
- `git diff --check`
- full `npm test` before commit

For UI-sensitive behavior, test on:

- `/Users/matusmockor/Developer/Efabrica/boxes/ebox-crm`

## Completion Criteria

- Changes are committed and pushed only after green verification.
- Working tree is clean.
- Final report says which thread slices landed, what was deferred, and what QA was performed.
