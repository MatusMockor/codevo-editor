# Redesign P0 - Deferred Bugs B1, B2, B5, B6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four independent deferred bugs of redesign phase P0: agent-linked HTML preview reports "The file could not be read." (B1), the sidebar background label ignores the 3 s quiescence (B2), queued-message edit shows image attachments as icons (B5), and the Usage panel mis-sums Codex app-server usage (B6).

**Architecture:** B1 is a Rust persistence fix: generated-file commands still read threads from the retired v1 JSON thread store, while threads have lived in the v2 SQLite history since beta.55; they must read bounded ownership/ordering facts from `AgentHistoryStore`. B2 routes the sidebar row through the same quiescence hook as the conversation (one timer per running Claude row, only while it is in inferred-idle). B5 borrows object URLs from the existing bounded attachment-image cache through the existing `useAgentTurnAttachmentImagePort`. B6 replaces per-result summing with a pure per-thread measurement that turns thread-cumulative Codex app-server totals into per-turn deltas.

**Tech Stack:** Rust (Tauri 2, rusqlite, serde_json), TypeScript, React 19, Vitest (jsdom, fake timers), Codex app-server Computer Use for QA.

**Spec:** `docs/superpowers/specs/2026-09-23-codevo-redesign-design.md` (section 3.2 rows B1, B2, B5, B6; sections 5, 6, 7).

## Global Constraints

- Work directly on `main`. Never create a feature branch. Commit only in Task 9, after gates, review and QA. No push, no tag, no release in P0 (single release at the end of the program, P10).
- Commit messages contain no AI, Claude, Anthropic or `Co-Authored-By` attribution.
- Implementation and review agents: Opus 5.5 only. UI QA: Codex with Computer Use via `codex app-server` against the QA bundle `dev.mockor.editor.qa`.
- Subagents never run mutating git commands (`stash`, `checkout`, `reset`, `add`, `commit`); only the lead does git.
- Do not use CodeRabbit (`coderabbit`, `cr`) in this project.
- Preserve unrelated dirty worktree changes (`docs/redesign/`, the spec, and whatever P1 agents write in parallel). P1 owns tokens, palettes, the appearance setting and base components; P0 must not touch those files.
- Never run `prettier --write` on a directory; format only the files a task owns (`npx prettier --write <file> ...`).
- Do not update hotspot or exhaustive-deps baselines to silence a regression (`npm run size:hotspots:update`, `npm run lint:exhaustive-deps:update` are forbidden).
- No new code comments or docblocks; keep existing ones intact.
- Use guard clauses and early returns; no `else` branches in new code.
- Never start the app with `npm run debug` (it kills the TS servers of the running user app); QA uses the separate QA bundle only.
- When verifying commands, check exit codes (`set -o pipefail` or `; echo exit=$?`), never trust `cmd | tail` output alone.
- Node watch tests hold port 9229 when interrupted; run the full Vitest suite once, sequentially, and free port 9229 before a rerun (`lsof -ti tcp:9229 | xargs kill` only for orphaned `node` processes started by the test run).

## Review Focus

1. B1: a turn whose thread has more than 256 later turns, or a workspace opened through an alias whose selected root key has no history database - capture must fail closed as "older turn has no snapshot", and the lookup must not create an empty history database for the alias key (Task 1 tests `artifact_facts_bound_successors_and_fail_closed_past_the_window` and `artifact_facts_for_an_unknown_root_do_not_create_a_history_database`).
2. B1: a deleted thread (tombstoned) whose generated file is clicked from a still-open transcript - must not resolve (Task 1 test `artifact_facts_hide_a_deleted_thread`).
3. B2: the same thread starting a new turn whose first root reply produces an anchor identical to the previous turn's anchor - the row must not inherit the previous turn's settled verdict (Task 3 test `restarts the quiescence window when a new turn produces the same anchor`).
4. B5: switching threads or a remote thread while a queued edit is open - the local attachment store must never be read for a foreign or remote owner (Task 4 test `never reads the local attachment store for a remote or foreign thread`).
5. B6: a Codex thread whose earlier turns fall outside the selected period, or whose older turns were evicted from the loaded window - the in-period turn must count only its own delta, and an unknown baseline must mark usage incomplete instead of counting the cumulative total (Task 5 tests `measures only the in-period delta when the baseline turn is older than the period` and `marks the first loaded turn of a truncated thread as unmeasured instead of counting the cumulative total`).

---

## B1 root cause (evidence)

- The chip "Preview" for `docs/redesign/direction-*.html` (turn `agt-muef2eke-bc0b`, thread `agt-mue1wenj-7ede`, root `/Users/matusmockor/Developer/editor`) calls `resolve_agent_output_artifact`.
- `src-tauri/src/lib_composition/agent_output_artifact_commands.rs` `load_thread` reads `app.state::<Arc<AgentThreadStore>>().load(&key)`, the v1 JSON store under `agent-threads/<fnv(root)>/<thread>.json`.
- Since beta.55 (`354d5030c`, 2026-09-20) the frontend saves threads only through `save_agent_history_thread` into `agent-history/v2/<fnv(root)>/history.sqlite3`. On this machine `agent-threads/94a824d5cce1257f/` contains only `agt-mu7bwo9d-7a75.json` (frozen 2026-09-20); thread `agt-mue1wenj-7ede` exists only in the v2 SQLite `threads`/`turns` tables.
- So every thread created or continued after beta.55 fails in `load_thread` with `"Artifact thread is unavailable."` (or `"Artifact turn is unavailable."` for a migrated thread with newer turns). Neither string is in `contracts/agent-artifact-errors.json`, so `classifyAgentArtifactFailure` falls back to `readFailed` ("The file could not be read.", retryable, so Retry is shown).
- The store directory `~/Library/Application Support/dev.mockor.editor/agent-output-artifacts/` holds only two snapshots, both from 2026-09-16/18 (before beta.55), and none for `docs/redesign/*`. File size, nested `docs/redesign`, inline scripts, symlinks and hard links are not involved (`stat`: nlink=1, 100-126 KB, mtimes before the turn end).
- Consequence after the fix: previews for turns that were the newest terminal turn when clicked capture and open; previews for older turns whose snapshot was never captured correctly show "This turn has no saved snapshot of the file" (existing `snapshotMissing` policy).

## File Structure

| File | Task | Responsibility |
|---|---|---|
| Create `src-tauri/src/agent_history_store/artifact_turns.rs` | 1 | Bounded read of a thread header plus the target turn and its successors' status/timestamps from v2 history |
| Modify `src-tauri/src/agent_history_store/mod.rs` | 1 | Declare `artifact_turns`; expose `AgentHistoryStore::artifact_thread_facts` |
| Modify `src-tauri/src/agent_history_store/tests.rs` | 1 | Regression tests incl. root-cause proof |
| Modify `src-tauri/src/lib_composition/agent_output_artifact_commands.rs` | 2 | Read ownership/turn facts from `AgentHistoryStore`; pure helpers take `ArtifactTurnFact` |
| Modify `src/components/agentMode/useAgentBackgroundActivity.ts` | 3 | Export `useAgentForegroundQuiescence` |
| Create `src/components/agentMode/useAgentRowBackgroundActivity.ts` | 3 | Sidebar row background activity with shared quiescence |
| Modify `src/components/agentMode/agentSidebarPresentation.ts` | 3 | `agentRowStatus` / `agentThreadRowModel` accept a resolved background activity |
| Modify `src/components/agentMode/AgentThreadRow.tsx` | 3 | Use the row hook |
| Modify `src/components/agentMode/agentSidebarPresentation.test.ts`, `AgentThreadRow.test.tsx` | 3 | Tests |
| Modify `src/components/agentMode/agentComposerQueuedEdit.ts` | 4 | Pure image request/preview projection for queued edits |
| Create `src/components/agentMode/useAgentQueuedEditImagePreviews.ts` | 4 | Borrow thumbnails from the attachment image cache for the queued edit |
| Modify `src/components/agentMode/AgentModeView.tsx:377-381` | 4 | Wire the hook (5 lines) |
| Create `src/components/agentMode/agentComposerQueuedEdit.test.ts`, `useAgentQueuedEditImagePreviews.test.tsx` | 4 | Tests |
| Create `src/domain/agentTurnTokenUsage.ts` | 5 | Per-thread per-turn token measurement incl. app-server deltas |
| Modify `src/domain/agentUsage.ts` | 5 | Use measurements instead of per-result summing |
| Modify `src/domain/agentUsage.test.ts` | 5 | Tests |

Write-scope ownership for parallel execution: Tasks 1-2 (Rust, one agent), Task 3, Task 4 and Task 5 each have disjoint files and may run in parallel. Tasks 6-9 are lead-only and sequential.

---

### Task 1: B1 - bounded artifact facts from durable history (Rust store)

**Files:**
- Create: `src-tauri/src/agent_history_store/artifact_turns.rs`
- Modify: `src-tauri/src/agent_history_store/mod.rs` (module list at lines 1-7, impl block after `read_turns` at line 185)
- Test: `src-tauri/src/agent_history_store/tests.rs` (append)

**Interfaces:**
- Consumes: `legacy::{AgentThread, AgentThreadOwner, AgentThreadTarget, AgentTurnStatus, AGENT_THREAD_OWNER_MISMATCH_ERROR, MAX_AGENT_SAFE_INTEGER, agent_root_owner_id}`, `super::validate`, `super::sql`, `connection::database_path`.
- Produces:
  - `pub(crate) mod artifact_turns` with `pub(crate) const MAX_ARTIFACT_TURN_FACTS: usize = 256;`
  - `pub(crate) struct ArtifactTurnFact { pub turn_id: String, pub status: AgentTurnStatus, pub started_at_epoch_ms: u64, pub ended_at_epoch_ms: Option<u64> }` (`Clone, Debug, PartialEq`)
  - `pub(crate) struct ArtifactThreadFacts { pub thread_id: String, pub owner: AgentThreadOwner, pub target: AgentThreadTarget, pub turns: Vec<ArtifactTurnFact>, pub successors_truncated: bool }` (`Clone, Debug, PartialEq`); `turns[0]` is the requested turn when it exists, followed by later turns in ordinal order; empty when the turn is unknown.
  - `impl AgentHistoryStore { pub(crate) fn artifact_thread_facts(&self, root: &str, thread_id: &str, turn_id: &str) -> Result<Option<ArtifactThreadFacts>, String> }` - `Ok(None)` for no database, unknown thread or tombstoned thread.

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/src/agent_history_store/tests.rs`:

```rust
fn artifact_turn(index: usize, status: serde_json::Value, started: u64, ended: Option<u64>) -> AgentTurn {
    serde_json::from_value(json!({"turnId":format!("agt-turn-{index:04}"),"prompt":"question","status":status,"startedAtEpochMs":started,"endedAtEpochMs":ended,"events":[],"eventsTruncated":false,"lastStatusSequence":0,"lastOutputSequence":0,"launch":null,"cliVersion":null})).unwrap()
}

fn artifact_fact(index: usize, status: legacy::AgentTurnStatus, started: u64, ended: Option<u64>) -> artifact_turns::ArtifactTurnFact {
    artifact_turns::ArtifactTurnFact {
        turn_id: format!("agt-turn-{index:04}"),
        status,
        started_at_epoch_ms: started,
        ended_at_epoch_ms: ended,
    }
}

#[test]
fn artifact_facts_come_from_durable_history_that_the_retired_thread_files_never_see() {
    let fixture = Fixture::new();
    let mut saved = thread();
    saved.turns = vec![
        artifact_turn(1, json!({"kind":"exited","exitCode":0}), 10, Some(20)),
        artifact_turn(2, json!({"kind":"running"}), 30, None),
        artifact_turn(3, json!({"kind":"pending"}), 0, None),
    ];
    fixture.store.save(ROOT, &owner(), &saved, 0).unwrap();

    let retired = legacy::AgentThreadStore::new(fixture.base.clone())
        .load(ROOT)
        .unwrap();
    assert!(retired.threads.is_empty());

    let facts = fixture
        .store
        .artifact_thread_facts(ROOT, &saved.thread_id, "agt-turn-0001")
        .unwrap()
        .expect("the thread saved to durable history");
    assert_eq!(facts.thread_id, saved.thread_id);
    assert_eq!(facts.owner, saved.owner);
    assert_eq!(facts.target, saved.target);
    assert!(!facts.successors_truncated);
    assert_eq!(
        facts.turns,
        vec![
            artifact_fact(1, legacy::AgentTurnStatus::Exited { exit_code: 0 }, 10, Some(20)),
            artifact_fact(2, legacy::AgentTurnStatus::Running, 30, None),
            artifact_fact(3, legacy::AgentTurnStatus::Pending, 0, None),
        ]
    );
    let later = fixture
        .store
        .artifact_thread_facts(ROOT, &saved.thread_id, "agt-turn-0002")
        .unwrap()
        .expect("the thread saved to durable history");
    assert_eq!(later.turns.first().map(|turn| turn.turn_id.as_str()), Some("agt-turn-0002"));
    assert_eq!(later.turns.len(), 2);
}

#[test]
fn artifact_facts_report_an_unknown_turn_and_thread_without_inventing_them() {
    let fixture = Fixture::new();
    let mut saved = thread();
    saved.turns = vec![artifact_turn(1, json!({"kind":"exited","exitCode":0}), 10, Some(20))];
    fixture.store.save(ROOT, &owner(), &saved, 0).unwrap();

    let unknown_turn = fixture
        .store
        .artifact_thread_facts(ROOT, &saved.thread_id, "agt-turn-0099")
        .unwrap()
        .expect("the thread exists");
    assert!(unknown_turn.turns.is_empty());
    assert_eq!(
        fixture
            .store
            .artifact_thread_facts(ROOT, "agt-thread-9999", "agt-turn-0001")
            .unwrap(),
        None
    );
}

#[test]
fn artifact_facts_hide_a_deleted_thread() {
    let fixture = Fixture::new();
    let mut saved = thread();
    saved.turns = vec![artifact_turn(1, json!({"kind":"exited","exitCode":0}), 10, Some(20))];
    fixture.store.save(ROOT, &owner(), &saved, 0).unwrap();
    fixture.store.delete(ROOT, &owner(), &saved.thread_id).unwrap();

    assert_eq!(
        fixture
            .store
            .artifact_thread_facts(ROOT, &saved.thread_id, "agt-turn-0001")
            .unwrap(),
        None
    );
}

#[test]
fn artifact_facts_bound_successors_and_fail_closed_past_the_window() {
    let fixture = Fixture::new();
    let mut saved = thread();
    let total = artifact_turns::MAX_ARTIFACT_TURN_FACTS + 2;
    for index in 0..total {
        let status = if index == 0 {
            json!({"kind":"exited","exitCode":0})
        } else {
            json!({"kind":"pending"})
        };
        let ended = if index == 0 { Some(20) } else { None };
        saved.turns = vec![artifact_turn(index, status, 10, ended)];
        fixture
            .store
            .save(ROOT, &owner(), &saved, index as u64)
            .unwrap();
    }

    let facts = fixture
        .store
        .artifact_thread_facts(ROOT, &saved.thread_id, "agt-turn-0000")
        .unwrap()
        .expect("the saved thread");
    assert_eq!(facts.turns.len(), artifact_turns::MAX_ARTIFACT_TURN_FACTS);
    assert!(facts.successors_truncated);
}

#[test]
fn artifact_facts_for_an_unknown_root_do_not_create_a_history_database() {
    let fixture = Fixture::new();
    let other = "/workspace/alias";

    assert_eq!(
        fixture
            .store
            .artifact_thread_facts(other, "agt-thread-0001", "agt-turn-0001")
            .unwrap(),
        None
    );
    assert!(!connection::database_path(&fixture.base, other).exists());
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/matusmockor/Developer/editor/src-tauri && cargo test --lib artifact_facts 2>&1 | tail -20; echo exit=${PIPESTATUS[0]}`
Expected: FAIL to compile with `no method named artifact_thread_facts` and `failed to resolve: use of undeclared crate or module artifact_turns`.

- [ ] **Step 3: Implement the facts reader**

Create `src-tauri/src/agent_history_store/artifact_turns.rs`:

```rust
use super::{
    legacy::{self, AgentThread, AgentThreadOwner, AgentThreadTarget, AgentTurnStatus},
    sql,
};
use rusqlite::{Connection, OptionalExtension};

pub(crate) const MAX_ARTIFACT_TURN_FACTS: usize = 256;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ArtifactTurnFact {
    pub turn_id: String,
    pub status: AgentTurnStatus,
    pub started_at_epoch_ms: u64,
    pub ended_at_epoch_ms: Option<u64>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ArtifactThreadFacts {
    pub thread_id: String,
    pub owner: AgentThreadOwner,
    pub target: AgentThreadTarget,
    pub turns: Vec<ArtifactTurnFact>,
    pub successors_truncated: bool,
}

pub(super) fn read(
    connection: &Connection,
    root: &str,
    thread_id: &str,
    turn_id: &str,
) -> Result<Option<ArtifactThreadFacts>, String> {
    let deleted: bool = sql(connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM tombstones WHERE thread_id=?1)",
        [thread_id],
        |row| row.get(0),
    ))?;
    if deleted {
        return Ok(None);
    }
    let payload: Option<String> = sql(connection
        .query_row(
            "SELECT payload FROM threads WHERE thread_id=?1",
            [thread_id],
            |row| row.get(0),
        )
        .optional())?;
    let Some(payload) = payload else {
        return Ok(None);
    };
    let header: AgentThread = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
    super::validate(root, &header)?;
    if header.thread_id != thread_id {
        return Err(legacy::AGENT_THREAD_OWNER_MISMATCH_ERROR.into());
    }
    let (turns, successors_truncated) = turn_facts(connection, thread_id, turn_id)?;
    Ok(Some(ArtifactThreadFacts {
        thread_id: header.thread_id,
        owner: header.owner,
        target: header.target,
        turns,
        successors_truncated,
    }))
}

fn turn_facts(
    connection: &Connection,
    thread_id: &str,
    turn_id: &str,
) -> Result<(Vec<ArtifactTurnFact>, bool), String> {
    let ordinal: Option<i64> = sql(connection
        .query_row(
            "SELECT ordinal FROM turns WHERE thread_id=?1 AND turn_id=?2",
            [thread_id, turn_id],
            |row| row.get(0),
        )
        .optional())?;
    let Some(ordinal) = ordinal else {
        return Ok((Vec::new(), false));
    };
    let mut statement = sql(connection.prepare(
        "SELECT turn_id,json_extract(payload,'$.status'),json_extract(payload,'$.startedAtEpochMs'),json_extract(payload,'$.endedAtEpochMs') FROM turns WHERE thread_id=?1 AND ordinal>=?2 ORDER BY ordinal ASC LIMIT ?3",
    ))?;
    let rows = sql(statement.query_map(
        rusqlite::params![thread_id, ordinal, MAX_ARTIFACT_TURN_FACTS as i64 + 1],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, Option<i64>>(3)?,
            ))
        },
    ))?;
    let mut facts = Vec::new();
    for row in rows {
        let (id, status, started, ended) = sql(row)?;
        if facts.len() == MAX_ARTIFACT_TURN_FACTS {
            return Ok((facts, true));
        }
        facts.push(fact(id, &status, started, ended)?);
    }
    Ok((facts, false))
}

fn fact(
    turn_id: String,
    status: &str,
    started: Option<i64>,
    ended: Option<i64>,
) -> Result<ArtifactTurnFact, String> {
    crate::git_worktree::safe_agent_task_id(&turn_id)?;
    let status: AgentTurnStatus = serde_json::from_str(status)
        .map_err(|e| format!("Unable to decode saved agent turn status: {e}"))?;
    Ok(ArtifactTurnFact {
        turn_id,
        status,
        started_at_epoch_ms: epoch(started.unwrap_or(0))?,
        ended_at_epoch_ms: ended.map(epoch).transpose()?,
    })
}

fn epoch(value: i64) -> Result<u64, String> {
    u64::try_from(value)
        .ok()
        .filter(|value| *value <= legacy::MAX_AGENT_SAFE_INTEGER)
        .ok_or_else(|| "Saved turn timestamp is out of bounds.".to_string())
}
```

In `src-tauri/src/agent_history_store/mod.rs` add the module declaration next to the others (after `mod catalog;`):

```rust
pub(crate) mod artifact_turns;
```

and add this method inside `impl AgentHistoryStore` directly after `read_turns`:

```rust
    pub(crate) fn artifact_thread_facts(
        &self,
        root: &str,
        thread_id: &str,
        turn_id: &str,
    ) -> Result<Option<artifact_turns::ArtifactThreadFacts>, String> {
        crate::git_worktree::safe_agent_task_id(thread_id)?;
        crate::git_worktree::safe_agent_task_id(turn_id)?;
        if !connection::database_path(&self.base_dir, root).is_file() {
            return Ok(None);
        }
        self.with_connection(root, &legacy::agent_root_owner_id(root), |connection| {
            let transaction = sql(connection.transaction())?;
            artifact_turns::read(&transaction, root, thread_id, turn_id)
        })
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/matusmockor/Developer/editor/src-tauri && cargo test --lib artifact_facts 2>&1 | tail -20; echo exit=${PIPESTATUS[0]}`
Expected: PASS, 5 tests, `exit=0`. If `artifact_facts_hide_a_deleted_thread` fails because `delete` requires attachment cleanup state, keep the assertion and fix the reader (the tombstone check is the contract), never weaken the test.

- [ ] **Step 5: Format and hand off (no commit)**

Run: `cd /Users/matusmockor/Developer/editor/src-tauri && cargo fmt -- src/agent_history_store/artifact_turns.rs src/agent_history_store/mod.rs src/agent_history_store/tests.rs; cargo clippy --lib -- -D warnings 2>&1 | tail -5; echo exit=${PIPESTATUS[0]}`
Expected: `exit=0`. Report the three changed files to the lead; do not run git.

---

### Task 2: B1 - generated-file commands read durable history (Rust commands)

**Files:**
- Modify: `src-tauri/src/lib_composition/agent_output_artifact_commands.rs` (imports lines 1-6; `load_thread` 50-87; `root` 88; `is_newest_terminal_turn` 115; `source_mtime_bound` 129; `source_mtime_limit` 147; `resolve_saved_output_artifact` 211-301; `validate_still_owned` 404-419; tests module 421+)

**Interfaces:**
- Consumes (Task 1): `AgentHistoryStore::artifact_thread_facts(&self, root: &str, thread_id: &str, turn_id: &str) -> Result<Option<ArtifactThreadFacts>, String>`, `ArtifactThreadFacts { thread_id, owner, target, turns, successors_truncated }`, `ArtifactTurnFact { turn_id, status, started_at_epoch_ms, ended_at_epoch_ms }`.
- Produces: `fn is_newest_terminal_turn(turns: &[ArtifactTurnFact], turn_id: &str) -> bool`, `fn source_mtime_bound(turns: &[ArtifactTurnFact], turn_id: &str) -> SourceMtimeBound`, `fn source_mtime_limit(turns: &[ArtifactTurnFact], turn_id: &str) -> Result<Option<u64>, String>`; IPC contracts unchanged (no TS change).

- [ ] **Step 1: Write the failing tests**

In the `#[cfg(test)] mod tests` of `agent_output_artifact_commands.rs`, replace the `use super::{...}` block and the three fixture helpers `ended`, `started`, `turn` with:

```rust
    use super::{
        errors, is_newest_terminal_turn, locate_contained, reveal_located_artifact_file,
        source_mtime_bound, source_mtime_limit, AgentTurnStatus, ArtifactTurnFact,
        OutputArtifactStore, RevealArtifactFile, SourceMtimeBound, TURN_END_MTIME_SKEW_MS,
    };
    use std::{
        cell::RefCell,
        fs,
        fs::File,
        path::{Path, PathBuf},
    };

    fn ended(turn_id: &str, ended_at_epoch_ms: Option<u64>) -> ArtifactTurnFact {
        ArtifactTurnFact {
            ended_at_epoch_ms,
            ..turn(turn_id, AgentTurnStatus::Exited { exit_code: 0 })
        }
    }

    fn started(turn_id: &str, status: AgentTurnStatus, started_at_epoch_ms: u64) -> ArtifactTurnFact {
        ArtifactTurnFact {
            started_at_epoch_ms,
            ..turn(turn_id, status)
        }
    }

    fn turn(turn_id: &str, status: AgentTurnStatus) -> ArtifactTurnFact {
        ArtifactTurnFact {
            turn_id: turn_id.into(),
            status,
            started_at_epoch_ms: 0,
            ended_at_epoch_ms: None,
        }
    }
```

and add this test to the same module:

```rust
    #[test]
    fn artifact_ownership_is_read_from_durable_history_not_the_retired_thread_files() {
        const SOURCE: &str = include_str!("agent_output_artifact_commands.rs");
        assert!(SOURCE.contains(concat!("artifact_thread", "_facts(")));
        assert!(!SOURCE.contains(concat!("AgentThread", "Store")));
    }
```

All other existing tests stay unchanged; they now exercise the helpers through `ArtifactTurnFact`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/matusmockor/Developer/editor/src-tauri && cargo test --lib agent_output_artifact_commands 2>&1 | tail -20; echo exit=${PIPESTATUS[0]}`
Expected: FAIL to compile (`unresolved import super::ArtifactTurnFact`, mismatched types `&[AgentTurn]` vs `[ArtifactTurnFact]`).

- [ ] **Step 3: Switch the commands to durable history**

Replace the first `use super::{...}` block (lines 1-6) with:

```rust
use super::{
    agent_attachment_commands::resolve_agent_attachment_owner,
    agent_history_commands::agent_history_store::{
        artifact_turns::{ArtifactThreadFacts, ArtifactTurnFact},
        AgentHistoryStore,
    },
    agent_thread_store_commands::agent_thread_store::AgentTurnStatus,
};
```

Replace `load_thread` with:

```rust
fn load_thread(
    app: &AppHandle,
    workspace_id: &WorkspaceId,
    thread_id: &str,
    turn_id: &str,
) -> Result<(ArtifactThreadFacts, PathBuf), String> {
    crate::git_worktree::safe_agent_task_id(thread_id)?;
    crate::git_worktree::safe_agent_task_id(turn_id)?;
    let resolved = resolve_agent_attachment_owner(app, workspace_id)?;
    let descriptor = app
        .state::<WorkspaceRegistry>()
        .descriptor(&resolved.workspace_id)
        .map_err(|e| e.to_string())?;
    let history = app.state::<Arc<AgentHistoryStore>>();
    for key in resolved.root_keys {
        let Some(thread) = history.artifact_thread_facts(&key, thread_id, turn_id)? else {
            continue;
        };
        let turn = thread
            .turns
            .first()
            .filter(|turn| turn.turn_id == turn_id)
            .ok_or("Artifact turn is unavailable.")?;
        if !turn.status.is_terminal() {
            return Err("Artifacts are available after the turn finishes.".into());
        }
        let repository = PathBuf::from(&thread.owner.repository_root)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if repository != descriptor.canonical_root_path {
            return Err("Artifact repository does not match its registered owner.".into());
        }
        return Ok((thread, repository));
    }
    Err("Artifact thread is unavailable.".into())
}
```

Change the signatures (bodies unchanged):

```rust
fn root(thread: &ArtifactThreadFacts, repository: PathBuf) -> Result<PathBuf, String> {
```
```rust
fn is_newest_terminal_turn(turns: &[ArtifactTurnFact], turn_id: &str) -> bool {
```
```rust
fn source_mtime_bound(turns: &[ArtifactTurnFact], turn_id: &str) -> SourceMtimeBound {
```
```rust
fn source_mtime_limit(turns: &[ArtifactTurnFact], turn_id: &str) -> Result<Option<u64>, String> {
```
```rust
fn validate_still_owned(
    app: &AppHandle,
    owner: &WorkspaceId,
    registration: &WorkspaceId,
    expected: &ArtifactThreadFacts,
    turn_id: &str,
) -> Result<(), String> {
```

In `resolve_saved_output_artifact` make the successor window fail closed. Replace:

```rust
    if !is_newest_terminal_turn(&thread.turns, &request.turn_id) {
        return Err(errors::SNAPSHOT_MISSING.into());
    }
```

with:

```rust
    if thread.successors_truncated || !is_newest_terminal_turn(&thread.turns, &request.turn_id) {
        return Err(errors::SNAPSHOT_MISSING.into());
    }
```

and inside the `revalidate` closure replace:

```rust
        if !is_newest_terminal_turn(&latest.turns, &request.turn_id) {
            return Err(errors::CONVERSATION_ADVANCED.into());
        }
```

with:

```rust
        if latest.successors_truncated || !is_newest_terminal_turn(&latest.turns, &request.turn_id)
        {
            return Err(errors::CONVERSATION_ADVANCED.into());
        }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/matusmockor/Developer/editor/src-tauri && cargo test --lib agent_output_artifact 2>&1 | tail -20; echo exit=${PIPESTATUS[0]}; cargo test --lib agent_artifact_errors 2>&1 | tail -5; echo exit=${PIPESTATUS[0]}`
Expected: PASS, `exit=0` twice (the production-source guard in `agent_artifact_errors.rs` still passes because no classified message is inlined).

- [ ] **Step 5: Format, lint and hand off (no commit)**

Run: `cd /Users/matusmockor/Developer/editor/src-tauri && cargo fmt -- src/lib_composition/agent_output_artifact_commands.rs && cargo clippy --all-targets -- -D warnings 2>&1 | tail -5; echo exit=${PIPESTATUS[0]}`
Expected: `exit=0`. Report the changed file to the lead.

---

### Task 3: B2 - sidebar row uses the shared 3 s quiescence

**Files:**
- Modify: `src/components/agentMode/useAgentBackgroundActivity.ts`
- Create: `src/components/agentMode/useAgentRowBackgroundActivity.ts`
- Modify: `src/components/agentMode/agentSidebarPresentation.ts:1-3` (imports), `:265-296` (`agentRowStatus`), `:741-758` (`agentThreadRowModel`)
- Modify: `src/components/agentMode/AgentThreadRow.tsx:1-20` (imports), `:58` (model)
- Test: `src/components/agentMode/agentSidebarPresentation.test.ts`, `src/components/agentMode/AgentThreadRow.test.tsx`

**Interfaces:**
- Consumes: `projectAgentBackgroundState`, `resolveAgentBackgroundActivity`, `AgentBackgroundState`, `AgentBackgroundActivity`, `AgentInferredIdleResolution` from `src/domain/agentBackgroundActivity.ts`; `AGENT_FOREGROUND_QUIESCENCE_MS = 3000`.
- Produces:
  - `export function useAgentForegroundQuiescence(owner: string, state: AgentBackgroundState): AgentInferredIdleResolution` (in `useAgentBackgroundActivity.ts`).
  - `export function useAgentRowBackgroundActivity(view: AgentThreadView, evidenceOf: AgentTurnLogEvidenceLookup): AgentBackgroundActivity | null`.
  - `agentRowStatus(view, evidenceOf = NO_AGENT_TURN_LOG_EVIDENCE, background?: AgentBackgroundActivity | null): AgentRowStatus` - `undefined` keeps the conservative immediate projection (`"pending"`), `null` means no background (non-Claude or idle).
  - `agentThreadRowModel(view, on, projectLabel = view.repositoryLabel, evidenceOf = NO_AGENT_TURN_LOG_EVIDENCE, background?: AgentBackgroundActivity | null): AgentThreadRowModel`.

- [ ] **Step 1: Write the failing presentation test**

In `src/components/agentMode/agentSidebarPresentation.test.ts` add imports:

```ts
import {
  projectAgentBackgroundState,
  resolveAgentBackgroundActivity,
} from "../../domain/agentBackgroundActivity";
import { NO_AGENT_TURN_LOG_EVIDENCE } from "../../domain/agentTurnContentLoss";
```

and add inside `describe("agent row status", ...)`:

```ts
  it("uses the quiescence verdict the row hands it instead of re-deciding inferred idle", () => {
    const spawn: AgentTurnEvent = {
      kind: "backgroundTask",
      taskId: "agent-1",
      taskType: "agent",
      status: "starting",
    };
    const answer: AgentTurnEvent = {
      kind: "assistantText",
      text: "A reviewer runs in the background.",
    };
    const running = view({ events: [spawn, answer] });
    const state = projectAgentBackgroundState([spawn, answer], true);

    expect(agentRowStatusLabel(agentRowStatus(running))).toBe("Working");
    expect(
      agentRowStatusLabel(
        agentRowStatus(
          running,
          NO_AGENT_TURN_LOG_EVIDENCE,
          resolveAgentBackgroundActivity(state, "pending"),
        ),
      ),
    ).toBe("Working");
    expect(
      agentRowStatusLabel(
        agentRowStatus(
          running,
          NO_AGENT_TURN_LOG_EVIDENCE,
          resolveAgentBackgroundActivity(state, "settled"),
        ),
      ),
    ).toBe("Working in background");
    expect(agentRowStatusLabel(agentRowStatus(running, NO_AGENT_TURN_LOG_EVIDENCE, null))).toBe(
      "Working",
    );
  });
```

- [ ] **Step 2: Write the failing row tests**

In `src/components/agentMode/AgentThreadRow.test.tsx` add imports:

```ts
import type { AgentTurnEvent } from "../../domain/agentThread";
import { AGENT_FOREGROUND_QUIESCENCE_MS } from "./useAgentBackgroundActivity";
```

and add inside `describe("AgentThreadRow", ...)`:

```tsx
  const spawn: AgentTurnEvent = {
    kind: "backgroundTask",
    taskId: "agent-1",
    taskType: "agent",
    status: "starting",
  };
  const answer: AgentTurnEvent = {
    kind: "assistantText",
    text: "The reviewer runs in the background.",
  };
  const runningWith = (
    events: ReadonlyArray<AgentTurnEvent>,
    turnId = "agt-1-t1",
    provider: AgentThread["provider"]["kind"] = "claudeCode",
  ): AgentThreadView => {
    const base = pinnedDone();
    const turn = base.thread.turns[0]!;
    return {
      ...base,
      thread: {
        ...base.thread,
        provider: { kind: provider, sessionId: null },
        turns: [
          { ...turn, turnId, status: { kind: "running" }, endedAtEpochMs: null, events: [...events] },
        ],
      },
    };
  };
  const statusLabel = (): string | null | undefined =>
    host.querySelector(".agent-row__status-label")?.textContent;

  it("shows background work only after the shared quiescence window", () => {
    render(runningWith([spawn, answer]));
    expect(statusLabel()).toBe("Working");
    act(() => vi.advanceTimersByTime(AGENT_FOREGROUND_QUIESCENCE_MS - 1));
    expect(statusLabel()).toBe("Working");
    act(() => vi.advanceTimersByTime(1));
    expect(statusLabel()).toBe("Working in background");
    render(runningWith([spawn, answer, { kind: "assistantText", text: "Still checking." }]));
    expect(statusLabel()).toBe("Working");
    act(() => vi.advanceTimersByTime(AGENT_FOREGROUND_QUIESCENCE_MS));
    expect(statusLabel()).toBe("Working in background");
  });

  it("restarts the quiescence window when a new turn produces the same anchor", () => {
    render(runningWith([spawn, answer]));
    act(() => vi.advanceTimersByTime(AGENT_FOREGROUND_QUIESCENCE_MS));
    expect(statusLabel()).toBe("Working in background");
    render(runningWith([spawn, answer], "agt-1-t2"));
    expect(statusLabel()).toBe("Working");
    act(() => vi.advanceTimersByTime(AGENT_FOREGROUND_QUIESCENCE_MS));
    expect(statusLabel()).toBe("Working in background");
  });

  it("never schedules background resolution for a Codex row", () => {
    render(runningWith([spawn, answer], "agt-1-t1", "codex"));
    act(() => vi.advanceTimersByTime(AGENT_FOREGROUND_QUIESCENCE_MS * 2));
    expect(statusLabel()).toBe("Working");
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/agentSidebarPresentation.test.ts src/components/agentMode/AgentThreadRow.test.tsx; echo exit=$?`
Expected: FAIL - the presentation test gets `"Working"` where `"Working in background"` is expected (the third argument is ignored), and `shows background work only after the shared quiescence window` stays `"Working"` after 3000 ms.

- [ ] **Step 4: Export the shared quiescence hook**

Replace the body of `src/components/agentMode/useAgentBackgroundActivity.ts` with:

```ts
import { useEffect, useMemo, useState } from "react";
import {
  projectAgentBackgroundState,
  resolveAgentBackgroundActivity,
  type AgentBackgroundActivity,
  type AgentBackgroundState,
  type AgentInferredIdleResolution,
} from "../../domain/agentBackgroundActivity";
import type { AgentTurnEvent } from "../../domain/agentThread";

export const AGENT_FOREGROUND_QUIESCENCE_MS = 3000;

export function useAgentBackgroundActivity(
  owner: string,
  events: ReadonlyArray<AgentTurnEvent>,
  processAlive: boolean,
  eventsTruncated: boolean,
): AgentBackgroundActivity {
  const state = useMemo(
    () => projectAgentBackgroundState(events, processAlive, eventsTruncated),
    [events, processAlive, eventsTruncated],
  );
  const inferredIdle = useAgentForegroundQuiescence(owner, state);
  return useMemo(
    () => resolveAgentBackgroundActivity(state, inferredIdle),
    [state, inferredIdle],
  );
}

export function useAgentForegroundQuiescence(
  owner: string,
  state: AgentBackgroundState,
): AgentInferredIdleResolution {
  const anchor =
    state.foreground.kind === "inferredIdle"
      ? JSON.stringify([owner, state.foreground.anchor])
      : null;
  return useQuiescentAnchor(anchor) ? "settled" : "pending";
}

function useQuiescentAnchor(anchor: string | null): boolean {
  const [settledAnchor, setSettledAnchor] = useState<string | null>(null);
  if (settledAnchor !== null && settledAnchor !== anchor) setSettledAnchor(null);

  useEffect(() => {
    if (anchor === null) return;
    const timer = setTimeout(() => setSettledAnchor(anchor), AGENT_FOREGROUND_QUIESCENCE_MS);
    return () => clearTimeout(timer);
  }, [anchor]);

  return anchor !== null && settledAnchor === anchor;
}
```

- [ ] **Step 5: Add the row hook**

Create `src/components/agentMode/useAgentRowBackgroundActivity.ts`:

```ts
import { useMemo } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  projectAgentBackgroundState,
  resolveAgentBackgroundActivity,
  type AgentBackgroundActivity,
  type AgentBackgroundState,
} from "../../domain/agentBackgroundActivity";
import { runningTurn } from "../../domain/agentThread";
import {
  agentTurnContentLost,
  type AgentTurnLogEvidenceLookup,
} from "../../domain/agentTurnContentLoss";
import { useAgentForegroundQuiescence } from "./useAgentBackgroundActivity";

const IDLE_STATE: AgentBackgroundState = {
  foreground: { kind: "running" },
  tasks: [],
  truncated: false,
};

export function useAgentRowBackgroundActivity(
  view: AgentThreadView,
  evidenceOf: AgentTurnLogEvidenceLookup,
): AgentBackgroundActivity | null {
  const thread = view.thread;
  const running = thread.provider.kind === "claudeCode" ? runningTurn(thread) : null;
  const active = running !== null;
  const events = running?.events ?? null;
  const lost =
    running !== null && agentTurnContentLost(running.eventsTruncated, evidenceOf(running.turnId));
  const state = useMemo(
    () => (events === null ? IDLE_STATE : projectAgentBackgroundState(events, true, lost)),
    [events, lost],
  );
  const owner = JSON.stringify([thread.owner.rootKey, thread.threadId, running?.turnId ?? null]);
  const inferredIdle = useAgentForegroundQuiescence(owner, state);
  return useMemo(
    () => (active ? resolveAgentBackgroundActivity(state, inferredIdle) : null),
    [active, state, inferredIdle],
  );
}
```

- [ ] **Step 6: Let the presentation accept the resolved activity**

In `src/components/agentMode/agentSidebarPresentation.ts` change the import on line 3 to:

```ts
import {
  projectAgentBackgroundActivity,
  type AgentBackgroundActivity,
} from "../../domain/agentBackgroundActivity";
```

add `type AgentTurn,` to the existing `../../domain/agentThread` type import list, and replace `agentRowStatus` with:

```ts
export function agentRowStatus(
  view: AgentThreadView,
  evidenceOf: AgentTurnLogEvidenceLookup = NO_AGENT_TURN_LOG_EVIDENCE,
  background?: AgentBackgroundActivity | null,
): AgentRowStatus {
  const running = runningTurn(view.thread);
  if (running !== null) {
    const activity =
      background === undefined ? immediateRowBackground(view, running, evidenceOf) : background;
    return {
      kind: "working",
      startedAtEpochMs: running.startedAtEpochMs,
      ...(activity?.foregroundSettled && activity.phase !== "inactive"
        ? {
            activity:
              activity.phase === "monitoring" ? ("monitoring" as const) : ("background" as const),
          }
        : {}),
    };
  }
  const last = lastTurnStatus(view.thread);
  if (last !== null && isFailedTurnStatus(last)) return { kind: "failed" };
  if (last !== null && isStoppedTurnStatus(last)) return { kind: "stopped" };
  if (view.unread && !view.thread.archived) return { kind: "done" };
  return { kind: "none" };
}

function immediateRowBackground(
  view: AgentThreadView,
  running: AgentTurn,
  evidenceOf: AgentTurnLogEvidenceLookup,
): AgentBackgroundActivity | null {
  if (view.thread.provider.kind !== "claudeCode") return null;
  const lost = agentTurnContentLost(running.eventsTruncated, evidenceOf(running.turnId));
  return projectAgentBackgroundActivity(running.events, true, lost);
}
```

and change `agentThreadRowModel` to:

```ts
export function agentThreadRowModel(
  view: AgentThreadView,
  on: boolean,
  projectLabel: string = view.repositoryLabel,
  evidenceOf: AgentTurnLogEvidenceLookup = NO_AGENT_TURN_LOG_EVIDENCE,
  background?: AgentBackgroundActivity | null,
): AgentThreadRowModel {
  const status = agentRowStatus(view, evidenceOf, background);
```

(the rest of the function body is unchanged).

- [ ] **Step 7: Use the hook in the row**

In `src/components/agentMode/AgentThreadRow.tsx` add the import:

```ts
import { useAgentRowBackgroundActivity } from "./useAgentRowBackgroundActivity";
```

and replace line 58:

```ts
  const model = agentThreadRowModel(view, on, projectLabel, evidenceOf);
```

with:

```ts
  const background = useAgentRowBackgroundActivity(view, evidenceOf);
  const model = agentThreadRowModel(view, on, projectLabel, evidenceOf, background);
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/agentSidebarPresentation.test.ts src/components/agentMode/AgentThreadRow.test.tsx src/components/agentMode/AgentThreadSession.background.test.tsx src/components/agentMode/AgentBackgroundActivity.test.tsx; echo exit=$?`
Expected: PASS, `exit=0`.

- [ ] **Step 9: Lint, format and hand off (no commit)**

Run: `cd /Users/matusmockor/Developer/editor && npx prettier --write src/components/agentMode/useAgentBackgroundActivity.ts src/components/agentMode/useAgentRowBackgroundActivity.ts src/components/agentMode/agentSidebarPresentation.ts src/components/agentMode/AgentThreadRow.tsx src/components/agentMode/agentSidebarPresentation.test.ts src/components/agentMode/AgentThreadRow.test.tsx && npx eslint --max-warnings 0 src/components/agentMode/useAgentBackgroundActivity.ts src/components/agentMode/useAgentRowBackgroundActivity.ts src/components/agentMode/agentSidebarPresentation.ts src/components/agentMode/AgentThreadRow.tsx; echo exit=$?`
Expected: `exit=0`. Report the six files to the lead.

---

### Task 4: B5 - queued-message edit shows image thumbnails

**Files:**
- Modify: `src/components/agentMode/agentComposerQueuedEdit.ts` (append)
- Create: `src/components/agentMode/useAgentQueuedEditImagePreviews.ts`
- Modify: `src/components/agentMode/AgentModeView.tsx:377-381` and its import block
- Test: `src/components/agentMode/agentComposerQueuedEdit.test.ts` (create), `src/components/agentMode/useAgentQueuedEditImagePreviews.test.tsx` (create)

**Interfaces:**
- Consumes: `useAgentTurnAttachmentImagePort(images: AgentAttachmentImagesSurface | null, reveal: null, owner: { workspaceId: string; threadId: string }): AgentTurnAttachmentImagePort | null` (existing, holds the thread in the bounded cache), `AgentAttachmentImageState`, `AgentComposerQueuedEdit`, `AgentComposerAttachmentDraft`.
- Produces:
  - `export interface AgentQueuedEditImageRequest { readonly attachmentId: string; readonly mime: AgentImageMime }`
  - `export function queuedEditImageRequests(drafts: ReadonlyArray<AgentComposerAttachmentDraft>): ReadonlyArray<AgentQueuedEditImageRequest>`
  - `export function withQueuedEditImagePreviews(edit: AgentComposerQueuedEdit, stateOf: (attachmentId: string) => AgentAttachmentImageState | undefined): AgentComposerQueuedEdit` (returns the same object when no image is ready)
  - `export interface AgentQueuedEditImageOwner { readonly workspaceId: string; readonly threadId: string }`
  - `export function queuedEditImageOwner(view: Pick<AgentThreadView, "thread" | "execution"> | null): AgentQueuedEditImageOwner | null`
  - `export function useAgentQueuedEditImagePreviews(edit: AgentComposerQueuedEdit | null, images: AgentAttachmentImagesSurface | null, owner: AgentQueuedEditImageOwner | null): AgentComposerQueuedEdit | null`

- [ ] **Step 1: Write the failing pure tests**

Create `src/components/agentMode/agentComposerQueuedEdit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  queuedEditAttachmentDraft,
  queuedEditImageRequests,
  withQueuedEditImagePreviews,
  type AgentComposerQueuedEdit,
} from "./agentComposerQueuedEdit";

const IMAGE_ID = "0".repeat(31) + "1";
const FILE_ID = "0".repeat(31) + "2";

function edit(): AgentComposerQueuedEdit {
  return {
    threadId: "agt-1-0a1b",
    lease: 1,
    prompt: "Describe the image",
    attachments: [
      queuedEditAttachmentDraft({
        key: "attachment-0",
        attachment: {
          kind: "image",
          attachmentId: IMAGE_ID,
          name: "pripona.png",
          mime: "image/png",
          bytes: 3,
          width: 1,
          height: 1,
          storedPath: "/data/pripona.png",
        },
      }),
      queuedEditAttachmentDraft({
        key: "attachment-1",
        attachment: {
          kind: "file",
          attachmentId: FILE_ID,
          name: "notes.txt",
          bytes: 5,
          storedPath: "/data/notes.txt",
        },
      }),
    ],
    onRemoveAttachment: () => undefined,
    onCancel: () => undefined,
    commit: async () => true,
  };
}

describe("queued edit image previews", () => {
  it("requests only stored images with a known media type", () => {
    expect(queuedEditImageRequests(edit().attachments)).toEqual([
      { attachmentId: IMAGE_ID, mime: "image/png" },
    ]);
  });

  it("fills a ready thumbnail and leaves other drafts untouched", () => {
    const original = edit();
    const previewed = withQueuedEditImagePreviews(original, (id) =>
      id === IMAGE_ID ? { kind: "ready", url: "blob:queued-0" } : undefined,
    );
    expect(previewed.attachments[0]?.previewUrl).toBe("blob:queued-0");
    expect(previewed.attachments[1]).toBe(original.attachments[1]);
    expect(previewed.onRemoveAttachment).toBe(original.onRemoveAttachment);
  });

  it("returns the same edit while nothing is ready", () => {
    const original = edit();
    expect(withQueuedEditImagePreviews(original, () => ({ kind: "loading" }))).toBe(original);
    expect(
      withQueuedEditImagePreviews(original, () => ({ kind: "unavailable", reason: "gone" })),
    ).toBe(original);
  });
});
```

- [ ] **Step 2: Write the failing hook test**

Create `src/components/agentMode/useAgentQueuedEditImagePreviews.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAttachmentGateway } from "../../application/agentAttachmentPorts";
import { useAgentAttachmentImages } from "../../application/useAgentAttachmentImages";
import { waitForReact } from "../../test/reactTestLifecycle";
import { AgentComposerQueuedEditBar } from "./AgentComposerQueuedEditBar";
import { queuedEditAttachmentDraft, type AgentComposerQueuedEdit } from "./agentComposerQueuedEdit";
import {
  queuedEditImageOwner,
  useAgentQueuedEditImagePreviews,
  type AgentQueuedEditImageOwner,
} from "./useAgentQueuedEditImagePreviews";

const THREAD_ID = "agt-1-0a1b";
const WORKSPACE_ID = "agent-root:0123456789abcdef";
const IMAGE_ID = "0".repeat(31) + "1";

function queuedEdit(threadId = THREAD_ID): AgentComposerQueuedEdit {
  return {
    threadId,
    lease: 1,
    prompt: "Describe the image",
    attachments: [
      queuedEditAttachmentDraft({
        key: "attachment-0",
        attachment: {
          kind: "image",
          attachmentId: IMAGE_ID,
          name: "pripona.png",
          mime: "image/png",
          bytes: 3,
          width: 1,
          height: 1,
          storedPath: "/data/pripona.png",
        },
      }),
    ],
    onRemoveAttachment: () => undefined,
    onCancel: () => undefined,
    commit: async () => true,
  };
}

describe("useAgentQueuedEditImagePreviews", () => {
  let host: HTMLDivElement;
  let root: Root;
  const created: string[] = [];
  const revoked: string[] = [];
  const readAgentAttachment = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer);
  const gateway = { readAgentAttachment } as unknown as AgentAttachmentGateway;

  function Probe({
    edit,
    owner,
  }: {
    readonly edit: AgentComposerQueuedEdit | null;
    readonly owner: AgentQueuedEditImageOwner | null;
  }) {
    const images = useAgentAttachmentImages({
      gateway,
      reportError: () => undefined,
      createObjectUrl: () => {
        const url = `blob:queued-${created.length}`;
        created.push(url);
        return url;
      },
      revokeObjectUrl: (url) => revoked.push(url),
    });
    const previewed = useAgentQueuedEditImagePreviews(edit, images, owner);
    return previewed === null ? null : createElement(AgentComposerQueuedEditBar, { edit: previewed });
  }

  const render = (
    edit: AgentComposerQueuedEdit | null,
    owner: AgentQueuedEditImageOwner | null,
  ): void => {
    act(() => root.render(createElement(Probe, { edit, owner })));
  };

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    created.length = 0;
    revoked.length = 0;
    readAgentAttachment.mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("shows the kept image as a thumbnail from the attachment store", async () => {
    render(queuedEdit(), { workspaceId: WORKSPACE_ID, threadId: THREAD_ID });

    await waitForReact(() => {
      const image = host.querySelector<HTMLImageElement>(".agent-composer-attachment__preview");
      expect(image?.getAttribute("src")).toBe("blob:queued-0");
    });
    expect(readAgentAttachment).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      threadId: THREAD_ID,
      attachmentId: IMAGE_ID,
    });
  });

  it("releases the borrowed thumbnail when the edit ends", async () => {
    render(queuedEdit(), { workspaceId: WORKSPACE_ID, threadId: THREAD_ID });
    await waitForReact(() => expect(created).toEqual(["blob:queued-0"]));

    render(null, { workspaceId: WORKSPACE_ID, threadId: THREAD_ID });

    await waitForReact(() => expect(revoked).toEqual(["blob:queued-0"]));
  });

  it("never reads the local attachment store for a remote or foreign thread", async () => {
    render(queuedEdit(), null);
    render(queuedEdit("agt-2-0c0d"), { workspaceId: WORKSPACE_ID, threadId: THREAD_ID });
    await act(async () => Promise.resolve());

    expect(readAgentAttachment).not.toHaveBeenCalled();
    expect(host.querySelector(".agent-composer-attachment__preview")).toBeNull();
    expect(
      queuedEditImageOwner({
        thread: {
          threadId: THREAD_ID,
          owner: { rootKey: "/r", ownerId: WORKSPACE_ID, repositoryRoot: "/r" },
        } as never,
        execution: { kind: "remote" } as never,
      }),
    ).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/agentComposerQueuedEdit.test.ts src/components/agentMode/useAgentQueuedEditImagePreviews.test.tsx; echo exit=$?`
Expected: FAIL with `does not provide an export named 'queuedEditImageRequests'` and `Failed to resolve import "./useAgentQueuedEditImagePreviews"`.

- [ ] **Step 4: Add the pure projection**

Append to `src/components/agentMode/agentComposerQueuedEdit.ts` and extend its imports:

```ts
import type { AgentAttachmentImageState } from "../../application/useAgentAttachmentImages";
import type { AgentImageMime } from "../../domain/agentAttachment";
```

```ts
export interface AgentQueuedEditImageRequest {
  readonly attachmentId: string;
  readonly mime: AgentImageMime;
}

export function queuedEditImageRequests(
  drafts: ReadonlyArray<AgentComposerAttachmentDraft>,
): ReadonlyArray<AgentQueuedEditImageRequest> {
  const requests: AgentQueuedEditImageRequest[] = [];
  for (const draft of drafts) {
    if (draft.kind !== "image" || draft.attachmentId === null || draft.mime === null) continue;
    requests.push({ attachmentId: draft.attachmentId, mime: draft.mime });
  }
  return requests;
}

export function withQueuedEditImagePreviews(
  edit: AgentComposerQueuedEdit,
  stateOf: (attachmentId: string) => AgentAttachmentImageState | undefined,
): AgentComposerQueuedEdit {
  let previewed = false;
  const attachments = edit.attachments.map((draft) => {
    if (draft.kind !== "image" || draft.attachmentId === null) return draft;
    const state = stateOf(draft.attachmentId);
    if (state?.kind !== "ready") return draft;
    previewed = true;
    return { ...draft, previewUrl: state.url };
  });
  if (!previewed) return edit;
  return { ...edit, attachments };
}
```

- [ ] **Step 5: Add the hook**

Create `src/components/agentMode/useAgentQueuedEditImagePreviews.ts`:

```ts
import { useEffect, useMemo } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentAttachmentImagesSurface } from "../../application/useAgentAttachmentImages";
import {
  queuedEditImageRequests,
  withQueuedEditImagePreviews,
  type AgentComposerQueuedEdit,
  type AgentQueuedEditImageRequest,
} from "./agentComposerQueuedEdit";
import { useAgentTurnAttachmentImagePort } from "./useAgentTurnAttachmentImages";

export interface AgentQueuedEditImageOwner {
  readonly workspaceId: string;
  readonly threadId: string;
}

const NO_OWNER: AgentQueuedEditImageOwner = { workspaceId: "", threadId: "" };
const NO_REQUESTS: ReadonlyArray<AgentQueuedEditImageRequest> = [];

export function queuedEditImageOwner(
  view: Pick<AgentThreadView, "thread" | "execution"> | null,
): AgentQueuedEditImageOwner | null {
  if (view === null || view.execution?.kind === "remote") return null;
  return { workspaceId: view.thread.owner.ownerId, threadId: view.thread.threadId };
}

export function useAgentQueuedEditImagePreviews(
  edit: AgentComposerQueuedEdit | null,
  images: AgentAttachmentImagesSurface | null,
  owner: AgentQueuedEditImageOwner | null,
): AgentComposerQueuedEdit | null {
  const workspaceId = owner?.workspaceId ?? "";
  const threadId = owner?.threadId ?? "";
  const owned = edit !== null && owner !== null && edit.threadId === threadId;
  const imageOwner = useMemo(
    () => (owned ? { workspaceId, threadId } : NO_OWNER),
    [owned, threadId, workspaceId],
  );
  const port = useAgentTurnAttachmentImagePort(owned ? images : null, null, imageOwner);
  const requests = useMemo(
    () => (edit === null ? NO_REQUESTS : queuedEditImageRequests(edit.attachments)),
    [edit],
  );
  const ensure = port?.ensure ?? null;
  useEffect(() => {
    if (ensure === null) return;
    for (const request of requests) ensure(request.attachmentId, request.mime);
  }, [ensure, requests]);
  const stateOf = port?.stateOf ?? null;
  return useMemo(
    () => (edit === null || stateOf === null ? edit : withQueuedEditImagePreviews(edit, stateOf)),
    [edit, stateOf],
  );
}
```

- [ ] **Step 6: Wire it in the agent view**

In `src/components/agentMode/AgentModeView.tsx` add the import:

```ts
import {
  queuedEditImageOwner,
  useAgentQueuedEditImagePreviews,
} from "./useAgentQueuedEditImagePreviews";
```

and replace:

```ts
  const queuedEdit = useAgentQueuedFollowUpEdit(agents, selectedThreadId);
  const composer = useAgentComposerControllerState({
    agents,
    groups: executionGroups,
    queuedEdit: queuedEdit.edit,
```

with:

```ts
  const queuedEdit = useAgentQueuedFollowUpEdit(agents, selectedThreadId);
  const previewedQueuedEdit = useAgentQueuedEditImagePreviews(
    queuedEdit.edit,
    agents.attachmentImages,
    queuedEditImageOwner(selectedThread),
  );
  const composer = useAgentComposerControllerState({
    agents,
    groups: executionGroups,
    queuedEdit: previewedQueuedEdit,
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/components/agentMode/agentComposerQueuedEdit.test.ts src/components/agentMode/useAgentQueuedEditImagePreviews.test.tsx src/components/agentMode/AgentComposerAttachments.test.tsx src/components/agentMode/AgentComposer.test.tsx; echo exit=$?`
Expected: PASS, `exit=0`. If `AgentComposer.test.tsx` does not exist, drop it from the command; do not create it.

- [ ] **Step 8: Lint, format and hand off (no commit)**

Run: `cd /Users/matusmockor/Developer/editor && npx prettier --write src/components/agentMode/agentComposerQueuedEdit.ts src/components/agentMode/useAgentQueuedEditImagePreviews.ts src/components/agentMode/AgentModeView.tsx src/components/agentMode/agentComposerQueuedEdit.test.ts src/components/agentMode/useAgentQueuedEditImagePreviews.test.tsx && npx eslint --max-warnings 0 src/components/agentMode/agentComposerQueuedEdit.ts src/components/agentMode/useAgentQueuedEditImagePreviews.ts src/components/agentMode/AgentModeView.tsx && npm run size:hotspots; echo exit=$?`
Expected: `exit=0` (`AgentModeView.tsx` grows by at most 8 lines and stays under the 2000-line limit). Report the five files to the lead.

---

### Task 5: B6 - Codex app-server usage as per-turn deltas

**Files:**
- Create: `src/domain/agentTurnTokenUsage.ts`
- Modify: `src/domain/agentUsage.ts:1-15` (imports), `:139-151` (turn loop), `:229-241` (`addTurn`), `:282-315` (`addCliUsage`)
- Test: `src/domain/agentUsage.test.ts`

**Interfaces:**
- Consumes: `AgentTurn`, `AgentTurnUsage`, `AgentAppServerTokenBreakdown` from `src/domain/agentThread.ts`.
- Produces:
  - `export interface AgentTurnTokens { readonly inputTokens: number; readonly outputTokens: number; readonly costUsd: number | null }`
  - `export type AgentTurnTokenMeasurement = { kind: "unreported" } | { kind: "ambiguous" } | { kind: "unknownBaseline" } | { kind: "measured"; tokens: AgentTurnTokens }`
  - `export function measureAgentTurnTokens(turns: ReadonlyArray<AgentTurn>, earlierTurnsMissing: boolean): ReadonlyArray<AgentTurnTokenMeasurement>` - index-aligned with `turns`.
- Rules (pinned by tests):
  - A result without `appServerUsage` (Claude, legacy Codex JSONL) is per-turn: input `contextTokens ?? inputTokens`, output `outputTokens`. It makes the app-server baseline unknown.
  - A result with `appServerUsage` measures `total - baseline.total` for `inputTokens` and `outputTokens`. Baseline is zero at the first loaded turn of a complete thread, unknown when earlier turns are missing (`turnsTruncated`), and the previous app-server `total` otherwise.
  - A decrease in either cumulative counter (new provider session or reset) makes that turn `unknownBaseline` and restarts the baseline from its total; nothing is ever counted twice.
  - Turns without a result (stopped, interrupted) keep the baseline, so their tokens are attributed to the next measured turn; a turn with several results is `ambiguous` and makes the baseline unknown.
  - Turn order is the persisted turn order of the thread.

- [ ] **Step 1: Write the failing tests**

In `src/domain/agentUsage.test.ts` add inside `describe("aggregateAgentUsage", ...)`:

```ts
  it("counts thread-cumulative Codex app-server totals as per-turn deltas", () => {
    const result = aggregateAgentUsage(
      [
        thread("codex", "project-a", [
          turn("one", NOW - 30_000, EXITED, NOW - 29_000, appServerUsage(100_000, 1_000)),
          turn("two", NOW - 20_000, EXITED, NOW - 19_000, appServerUsage(250_000, 3_000)),
          turn("three", NOW - 10_000, EXITED, NOW - 9_000, appServerUsage(400_000, 4_000)),
        ]),
      ],
      "today",
      NOW,
    );

    expect(result.providers.codex.total.cliUsage).toMatchObject({
      inputTokens: 400_000,
      outputTokens: 4_000,
      measuredTurns: 3,
      eligibleTurns: 3,
      incomplete: false,
    });
  });

  it("measures only the in-period delta when the baseline turn is older than the period", () => {
    const yesterday = NOW - 24 * 60 * 60 * 1_000;
    const threads = [
      thread("codex", "project-a", [
        turn("old", yesterday, EXITED, yesterday + 1_000, appServerUsage(100_000, 1_000)),
        turn("new", NOW - 10_000, EXITED, NOW - 9_000, appServerUsage(250_000, 3_000)),
      ]),
    ];

    expect(aggregateAgentUsage(threads, "today", NOW).providers.codex.total.cliUsage).toMatchObject(
      { inputTokens: 150_000, outputTokens: 2_000, measuredTurns: 1, incomplete: false },
    );
    expect(aggregateAgentUsage(threads, "7days", NOW).providers.codex.total.cliUsage).toMatchObject(
      { inputTokens: 250_000, outputTokens: 3_000, measuredTurns: 2 },
    );
  });

  it("marks the first loaded turn of a truncated thread as unmeasured instead of counting the cumulative total", () => {
    const truncated: AgentThread = {
      ...thread("codex", "project-a", [
        turn("first-loaded", NOW - 20_000, EXITED, NOW - 19_000, appServerUsage(900_000, 9_000)),
        turn("second", NOW - 10_000, EXITED, NOW - 9_000, appServerUsage(950_000, 9_500)),
      ]),
      turnsTruncated: true,
    };

    expect(aggregateAgentUsage([truncated], "today", NOW).providers.codex.total.cliUsage).toMatchObject(
      { inputTokens: 50_000, outputTokens: 500, measuredTurns: 1, eligibleTurns: 2, incomplete: true },
    );
  });

  it("restarts the baseline after a counter reset without double counting", () => {
    const result = aggregateAgentUsage(
      [
        thread("codex", "project-a", [
          turn("before", NOW - 30_000, EXITED, NOW - 29_000, appServerUsage(400_000, 4_000)),
          turn("reset", NOW - 20_000, EXITED, NOW - 19_000, appServerUsage(50_000, 1_000)),
          turn("after", NOW - 10_000, EXITED, NOW - 9_000, appServerUsage(80_000, 2_000)),
        ]),
      ],
      "today",
      NOW,
    );

    expect(result.providers.codex.total.cliUsage).toMatchObject({
      inputTokens: 430_000,
      outputTokens: 5_000,
      measuredTurns: 2,
      eligibleTurns: 3,
      incomplete: true,
    });
  });

  it("attributes the tokens of a turn without a result to the next measured turn", () => {
    const result = aggregateAgentUsage(
      [
        thread("codex", "project-a", [
          turn("one", NOW - 30_000, EXITED, NOW - 29_000, appServerUsage(100_000, 1_000)),
          turn("stopped", NOW - 20_000, { kind: "stopped" }, NOW - 19_000),
          turn("three", NOW - 10_000, EXITED, NOW - 9_000, appServerUsage(300_000, 3_000)),
        ]),
      ],
      "today",
      NOW,
    );

    expect(result.providers.codex.total.cliUsage).toMatchObject({
      inputTokens: 300_000,
      outputTokens: 3_000,
      measuredTurns: 2,
      eligibleTurns: 2,
      incomplete: false,
    });
  });

  it("never counts a cumulative total that may include older per-turn usage", () => {
    const result = aggregateAgentUsage(
      [
        thread("codex", "project-a", [
          turn("legacy", NOW - 20_000, EXITED, NOW - 19_000, usage(11, 13)),
          turn("app-server", NOW - 10_000, EXITED, NOW - 9_000, appServerUsage(500_000, 5_000)),
        ]),
      ],
      "today",
      NOW,
    );

    expect(result.providers.codex.total.cliUsage).toMatchObject({
      inputTokens: 11,
      outputTokens: 13,
      measuredTurns: 1,
      eligibleTurns: 2,
      incomplete: true,
    });
  });
```

and add these helpers at the bottom of the file (next to `usage`):

```ts
const EXITED: AgentTurnStatus = { kind: "exited", exitCode: 0 };

function appServerUsage(totalInput: number, totalOutput: number): AgentTurnEvent {
  const breakdown = (inputTokens: number, outputTokens: number) => ({
    inputTokens,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens,
    reasoningOutputTokens: 0,
    totalTokens: inputTokens + outputTokens,
  });
  return {
    kind: "result",
    text: "",
    isError: false,
    usage: {
      scope: "thread",
      appServerUsage: {
        last: breakdown(990, 10),
        total: breakdown(totalInput, totalOutput),
        contextWindow: 258_400,
      },
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cachedInputTokens: 0,
      reasoningOutputTokens: 0,
      contextTokens: 1_000,
    },
  };
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/domain/agentUsage.test.ts; echo exit=$?`
Expected: FAIL - `counts thread-cumulative Codex app-server totals as per-turn deltas` reports `inputTokens: 3000, outputTokens: 8000` (the current code sums last-request `contextTokens` and cumulative outputs).

- [ ] **Step 3: Add the pure measurement**

Create `src/domain/agentTurnTokenUsage.ts`:

```ts
import type { AgentAppServerTokenBreakdown, AgentTurn, AgentTurnUsage } from "./agentThread";

export interface AgentTurnTokens {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number | null;
}

export type AgentTurnTokenMeasurement =
  | { readonly kind: "unreported" }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "unknownBaseline" }
  | { readonly kind: "measured"; readonly tokens: AgentTurnTokens };

type ThreadTotalBaseline =
  | { readonly kind: "zero" }
  | { readonly kind: "unknown" }
  | { readonly kind: "known"; readonly total: AgentAppServerTokenBreakdown };

type ReportedUsage =
  | { readonly kind: "none" }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "single"; readonly usage: AgentTurnUsage };

const UNREPORTED: AgentTurnTokenMeasurement = { kind: "unreported" };
const AMBIGUOUS: AgentTurnTokenMeasurement = { kind: "ambiguous" };
const UNKNOWN_BASELINE: AgentTurnTokenMeasurement = { kind: "unknownBaseline" };
const ZERO: ThreadTotalBaseline = { kind: "zero" };
const UNKNOWN: ThreadTotalBaseline = { kind: "unknown" };
const NO_REPORT: ReportedUsage = { kind: "none" };
const AMBIGUOUS_REPORT: ReportedUsage = { kind: "ambiguous" };

export function measureAgentTurnTokens(
  turns: ReadonlyArray<AgentTurn>,
  earlierTurnsMissing: boolean,
): ReadonlyArray<AgentTurnTokenMeasurement> {
  let baseline = earlierTurnsMissing ? UNKNOWN : ZERO;
  const measurements: AgentTurnTokenMeasurement[] = [];
  for (const turn of turns) {
    const reported = reportedUsage(turn);
    if (reported.kind === "none") {
      measurements.push(UNREPORTED);
      continue;
    }
    if (reported.kind === "ambiguous") {
      baseline = UNKNOWN;
      measurements.push(AMBIGUOUS);
      continue;
    }
    const cumulative = reported.usage.appServerUsage;
    if (cumulative === undefined) {
      baseline = UNKNOWN;
      measurements.push(perTurn(reported.usage));
      continue;
    }
    measurements.push(delta(baseline, cumulative.total, reported.usage.costUsd ?? null));
    baseline = { kind: "known", total: cumulative.total };
  }
  return measurements;
}

function reportedUsage(turn: AgentTurn): ReportedUsage {
  let captured: AgentTurnUsage | null = null;
  for (const event of turn.events) {
    if (event.kind !== "result" || event.usage === null) continue;
    if (captured !== null) return AMBIGUOUS_REPORT;
    captured = event.usage;
  }
  if (captured === null) return NO_REPORT;
  return { kind: "single", usage: captured };
}

function perTurn(usage: AgentTurnUsage): AgentTurnTokenMeasurement {
  return measured(usage.contextTokens ?? usage.inputTokens, usage.outputTokens, usage.costUsd ?? null);
}

function delta(
  baseline: ThreadTotalBaseline,
  total: AgentAppServerTokenBreakdown,
  costUsd: number | null,
): AgentTurnTokenMeasurement {
  switch (baseline.kind) {
    case "zero":
      return measured(total.inputTokens, total.outputTokens, costUsd);
    case "unknown":
      return UNKNOWN_BASELINE;
    case "known": {
      const inputTokens = total.inputTokens - baseline.total.inputTokens;
      const outputTokens = total.outputTokens - baseline.total.outputTokens;
      if (inputTokens < 0 || outputTokens < 0) return UNKNOWN_BASELINE;
      return measured(inputTokens, outputTokens, costUsd);
    }
    default:
      return unsupportedBaseline(baseline);
  }
}

function measured(
  inputTokens: number,
  outputTokens: number,
  costUsd: number | null,
): AgentTurnTokenMeasurement {
  return { kind: "measured", tokens: { inputTokens, outputTokens, costUsd } };
}

function unsupportedBaseline(baseline: never): never {
  throw new TypeError(`Unsupported token baseline: ${JSON.stringify(baseline)}.`);
}
```

- [ ] **Step 4: Aggregate measurements instead of raw results**

In `src/domain/agentUsage.ts` add the import:

```ts
import { measureAgentTurnTokens, type AgentTurnTokenMeasurement } from "./agentTurnTokenUsage";
```

Replace the turn loop inside `aggregateAgentUsage`:

```ts
    for (const turn of thread.turns.slice(0, MAX_AGENT_TURNS_PER_THREAD)) {
      if (!turnFallsWithin(turn, startEpochMs, endEpochMs)) continue;
      const lost = agentTurnContentLost(turn.eventsTruncated, evidenceOf(turn.turnId));
      addTurn(provider.total, turn, endEpochMs, lost);
      addTurn(projectMetrics(provider, thread.owner.rootKey), turn, endEpochMs, lost);
    }
```

with:

```ts
    const turns = thread.turns.slice(0, MAX_AGENT_TURNS_PER_THREAD);
    const measurements = measureAgentTurnTokens(turns, thread.turnsTruncated);
    for (let index = 0; index < turns.length; index += 1) {
      const turn = turns[index];
      const measurement = measurements[index];
      if (turn === undefined || measurement === undefined) continue;
      if (!turnFallsWithin(turn, startEpochMs, endEpochMs)) continue;
      const lost = agentTurnContentLost(turn.eventsTruncated, evidenceOf(turn.turnId));
      addTurn(provider.total, turn, endEpochMs, lost, measurement);
      addTurn(projectMetrics(provider, thread.owner.rootKey), turn, endEpochMs, lost, measurement);
    }
```

Replace `addTurn` with:

```ts
function addTurn(
  metrics: MutableMetrics,
  turn: AgentTurn,
  windowEndEpochMs: number,
  contentLost: boolean,
  measurement: AgentTurnTokenMeasurement,
): void {
  metrics.turnsStarted += 1;
  classifyStatus(metrics, turn.status);
  addWallTime(metrics.wallTime, turn, windowEndEpochMs);
  addCliUsage(metrics.cliUsage, turn, contentLost, measurement);
  addStreamOutput(metrics.streamOutput, turn);
}
```

Replace `addCliUsage` with:

```ts
function addCliUsage(
  cliUsage: MutableCliTokens,
  turn: AgentTurn,
  contentLost: boolean,
  measurement: AgentTurnTokenMeasurement,
): void {
  if (turn.status.kind !== "exited") return;
  cliUsage.eligibleTurns += 1;
  if (contentLost) cliUsage.incomplete = true;
  if (measurement.kind === "unreported") return;
  if (measurement.kind !== "measured") {
    cliUsage.incomplete = true;
    return;
  }
  const tokens = measurement.tokens;
  cliUsage.measuredTurns += 1;
  cliUsage.inputTokens = safeSum(cliUsage.inputTokens, tokens.inputTokens);
  cliUsage.outputTokens = safeSum(cliUsage.outputTokens, tokens.outputTokens);
  if (tokens.costUsd !== null) {
    cliUsage.costUsd = safeFiniteSum(cliUsage.costUsd, tokens.costUsd);
    cliUsage.costMeasuredTurns += 1;
  }
  if (cliUsage.inputTokens === null || cliUsage.outputTokens === null) {
    cliUsage.incomplete = true;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /Users/matusmockor/Developer/editor && npx vitest run src/domain/agentUsage.test.ts src/components/agentMode/AgentUsagePanel.test.tsx; echo exit=$?`
Expected: PASS, `exit=0` (the existing Claude cache test, the ambiguous/overflow test and the legacy Codex `usage(11, 13)` expectations are unchanged). If `AgentUsagePanel.test.tsx` does not exist, drop it from the command.

- [ ] **Step 6: Lint, format and hand off (no commit)**

Run: `cd /Users/matusmockor/Developer/editor && npx prettier --write src/domain/agentTurnTokenUsage.ts src/domain/agentUsage.ts src/domain/agentUsage.test.ts && npx eslint --max-warnings 0 src/domain/agentTurnTokenUsage.ts src/domain/agentUsage.ts; echo exit=$?`
Expected: `exit=0`. Report the three files to the lead.

---

### Task 6: Full repository gates (lead)

**Files:** none changed; if a gate fails, route the fix back to the owning task's agent.

**Interfaces:**
- Consumes: all changes of Tasks 1-5.
- Produces: a gate log with exit codes for the review and commit tasks.

- [ ] **Step 1: Confirm only owned files changed**

Run: `cd /Users/matusmockor/Developer/editor && git status --short && git diff --stat`
Expected: only the files listed in the File Structure table plus pre-existing untracked `docs/redesign/`, the spec, this plan, and any P1-owned files; no build output, logs or scratch files.

- [ ] **Step 2: Run the TypeScript gates**

Run each command separately and record its exit code:

```bash
cd /Users/matusmockor/Developer/editor
npm run check; echo check=$?
npm run lint -- --max-warnings 0; echo lint=$?
npm run lint:exhaustive-deps; echo deps=$?
npm run build; echo build=$?
npm run size:hotspots; echo hotspots=$?
npm run format:check; echo format=$?
npm run format:check:changed; echo formatChanged=$?
npm test -- --run; echo test=$?
npm run test:coverage; echo coverage=$?
git diff --check; echo diffcheck=$?
```

Expected: every value is `0`. If `npm test` fails only in Node watch tests with `EADDRINUSE 9229`, free the port (`lsof -ti tcp:9229`, kill only orphaned `node` test processes) and rerun the suite once, sequentially.

- [ ] **Step 3: Run the Rust gates**

```bash
cd /Users/matusmockor/Developer/editor/src-tauri
cargo check --all-targets; echo check=$?
cargo test --lib; echo lib=$?
cargo test --tests; echo tests=$?
cargo fmt --all -- --check; echo fmt=$?
cargo clippy --all-targets -- -D warnings; echo clippy=$?
```

Expected: every value is `0`.

---

### Task 7: Independent read-only review (Opus 5.5)

**Files:** none (read-only reviewer); fixes go back to the owning task agent.

**Interfaces:**
- Consumes: `git diff` of Tasks 1-5, this plan, the spec section 3.2.
- Produces: a list of P0/P1/P2 findings with file:line evidence.

- [ ] **Step 1: Dispatch the reviewer**

Dispatch one Opus 5.5 subagent (not an author of Tasks 1-5) with this prompt:

```text
Read-only adversarial review of Codevo redesign P0 (bugs B1, B2, B5, B6) in /Users/matusmockor/Developer/editor. Do not modify files and do not run mutating git commands. Read CLAUDE.md, docs/superpowers/plans/2026-09-24-redesign-p0-deferred-bugs.md and `git diff` (plus the new untracked files listed in the plan's File Structure).
Verify each finding in code before reporting it. Report findings as P0 (wrong behavior or data loss), P1 (isolation, boundedness, race, missing regression test), P2 (quality), each with file:line and a concrete failing scenario. Focus:
1. B1: every path that previously read the v1 AgentThreadStore now reads AgentHistoryStore; tombstoned, unknown, foreign-root, alias-root and >256-successor threads fail closed; artifact_thread_facts never creates a database for an unknown root; turn order and the newest-terminal-turn and mtime rules are unchanged; no classified error string is inlined.
2. B2: the sidebar row and the conversation resolve inferred idle with the same 3 s rule and the same anchor semantics; owner key covers root, thread and turn; at most one timer per running Claude row and none for Codex or idle rows; no timer leaks on unmount; hook order is stable in AgentThreadRow.
3. B5: object URLs are only borrowed from useAgentAttachmentImages (created and revoked there), never created in the queued-edit path; remote and foreign threads never read the local store; the thread hold is released when the edit ends; composer props identity does not churn when no image changes.
4. B6: per-turn deltas never double count across legacy per-turn results, app-server cumulative totals, truncated windows, stopped turns, counter resets and period boundaries; Claude numbers are unchanged; existing tests still pin the old invariants.
5. Gates: hotspot sizes flat, no baseline updates, no comments added, no else branches.
Return the findings list only.
```

- [ ] **Step 2: Resolve findings**

For each P0/P1 finding: confirm it in code, send the fix to the owning task agent with a failing test first, then rerun that task's focused tests. Record rejected findings with a one-line reason for the final report.

- [ ] **Step 3: Rerun the gates**

Repeat Task 6 Steps 2-3 after the last fix. Expected: all exit codes `0`.

---

### Task 8: QA build and Codex Computer Use QA

**Files:**
- Create (outside the repo): `/Users/matusmockor/tmp/codevo-qa-p0/` fixture project, `/Users/matusmockor/tmp/codevo-qa/qa_prompt_p0.txt`

**Interfaces:**
- Consumes: the reviewed tree from Task 7.
- Produces: a Slovak QA report with PASS/FAIL/BLOCKED per step and screenshots in `/Users/matusmockor/tmp/codevo-qa/shots-p0/`.

- [ ] **Step 1: Build the QA bundle**

Run: `cd /Users/matusmockor/Developer/editor && npx tauri build --debug --bundles app --config '{"identifier":"dev.mockor.editor.qa","productName":"Codevo QA"}'; echo exit=$?; ls -d "src-tauri/target/debug/bundle/macos/Codevo QA.app"`
Expected: the `.app` path is listed. `exit=1` caused only by the missing updater signing key is acceptable; any compile error is not.

- [ ] **Step 2: Prepare the fixture project**

```bash
mkdir -p /Users/matusmockor/tmp/codevo-qa-p0/docs/redesign
cp /Users/matusmockor/Developer/editor/docs/redesign/direction-a-monolith.html /Users/matusmockor/tmp/codevo-qa-p0/docs/redesign/
cp "/Users/matusmockor/Library/Application Support/dev.mockor.editor/agent-attachments/threads/agt-mue1wenj-7ede/80a516998265ce1fa50740897debe6f7.png" /Users/matusmockor/tmp/codevo-qa-p0/pripona.png
printf '# QA P0\n\nRiadok 2\nRiadok 3\n' > /Users/matusmockor/tmp/codevo-qa-p0/README.md
cd /Users/matusmockor/tmp/codevo-qa-p0 && git init -q && git add -A && git -c user.name=qa -c user.email=qa@example.invalid commit -qm fixture
```

Expected: `docs/redesign/direction-a-monolith.html` is 101287 bytes in the fixture.

- [ ] **Step 3: Launch the QA app (lead, own Bash in the GUI session)**

Run: `open "/Users/matusmockor/Developer/editor/src-tauri/target/debug/bundle/macos/Codevo QA.app" && sleep 5 && pgrep -f "Codevo QA.app/Contents/MacOS" | head -1`
Expected: a PID. Put it into the prompt below in place of `<PID>` before running Step 4. Open project `/Users/matusmockor/tmp/codevo-qa-p0` in agent mode and trust it if the tester cannot.

- [ ] **Step 4: Write the QA prompt**

Write `/Users/matusmockor/tmp/codevo-qa/qa_prompt_p0.txt`:

```text
You are a UI QA tester using Computer Use on macOS. Report in Slovak.

HARD RULES
- FIRST ACTION: use Computer Use to get the app state / take one screenshot of the QA app. If Computer Use tools are unavailable, denied, or the first screenshot/app-state call fails, STOP IMMEDIATELY and reply only: "COMPUTER_USE_UNAVAILABLE: <exact error>". Do not retry, do not try workarounds, do not use shell commands to substitute.
- ATTACH ONLY. The QA app is ALREADY RUNNING: the app named "Codevo QA" (bundle id dev.mockor.editor.qa, process id <PID>, /Users/matusmockor/Developer/editor/src-tauri/target/debug/bundle/macos/Codevo QA.app). Never launch, open, build, restart or close any app.
- NEVER touch the app "Codevo Editor" (bundle id dev.mockor.editor) - that is the user's live session. Only interact with "Codevo QA".
- Do not edit any files, do not run git commands, do not change settings outside what a step asks.
- Save screenshots for each step into /Users/matusmockor/tmp/codevo-qa/shots-p0/ (create it) with names like 01-preview.png, and list them in the report.
- If a step is blocked (agent CLI not authenticated, trust dialog you cannot pass), mark it BLOCKED with the reason and continue. Total time budget ~40 minutes.

SETUP
Project /Users/matusmockor/tmp/codevo-qa-p0 (git) must be open in agent mode. It contains docs/redesign/direction-a-monolith.html (~100 KB), README.md and pripona.png.

STEPS (for each: what you did, expected, observed, PASS/FAIL, screenshot)
1. B1 preview. Start a NEW Claude Code thread and send exactly: "Odpovedz len týmto riadkom: [Smer A](docs/redesign/direction-a-monolith.html)". When the turn finishes, a generated-file chip "Smer A" with "Preview" appears under the reply. Click "Preview". Expected: the HTML page renders inside the preview (dark mockup of an editor), NOT the text "The file could not be read." and no "Retry". Close the preview and open it again: it opens again.
2. B1 older turn. In the same thread send "Odpovedz len OK." and wait until it finishes. Scroll up to the first turn and click "Preview" on "Smer A" again. Expected: the preview still opens (its snapshot was saved in step 1). Report the exact text if it does not.
3. B2 sidebar label. Start a NEW Claude Code thread and send: "Spusti na pozadí (run_in_background) príkaz: sleep 60 && echo hotovo. Hneď potom odpovedz jednou vetou, že beží na pozadí, a nič ďalšie nerob." Watch the thread row in the left sidebar during the next 15 seconds (take a screenshot every ~2 s). Expected: while the lead is writing, the row says "Working"; about 3 seconds after the reply stops streaming it changes to "Working in background" or "Monitoring" and then stays stable, with no flicker back and forth, and the conversation banner shows background work at about the same moment. Stop the thread afterwards.
4. B5 queued edit thumbnail. Start a NEW Claude Code thread and send: "Napíš veľmi dlhý podrobný text (aspoň 1500 slov) o histórii Slovenska." While it is generating, type "Popíš obrázok." and attach /Users/matusmockor/tmp/codevo-qa-p0/pripona.png with the attachment (paperclip) button, then submit so the message is QUEUED ("Queued", "1 attachment"). Click the pencil on the queued message. Expected: the bar "Editing queued message" above the composer shows the image as a real thumbnail (the picture itself), not a generic image icon. Click the thumbnail: a larger preview opens. Press Escape twice to close the preview and cancel the edit. Stop the thread.
5. B6 usage. Start a NEW Codex thread and send: "Prečítaj README.md a spočítaj jeho riadky, odpovedz číslom." When it finishes, open Usage (bar-chart button in the left sidebar footer), period "Today", and write down the Codex numbers (Processed tokens and Codex input/output, and the Details line "N of M turns reported CLI usage"). Close Usage. In the same thread send "Zopakuj posledné číslo." and after it finishes open Usage again and write down the same numbers. Expected: both turns are reported ("2 of 2 turns reported CLI usage"), no "usage evidence is incomplete", and the second reading grows by a plausible amount for one short turn (it must not roughly double the first reading).

REPORT FORMAT
For each step: status (PASS/FAIL/BLOCKED), expected vs observed in one or two sentences, the exact numbers for step 5, screenshot filenames. Then other visual bugs noticed. Keep it factual.
```

- [ ] **Step 5: Run the QA orchestrator**

Run in the background and poll for the report (Codex can exceed 10 minutes):

```bash
python3 /Users/matusmockor/tmp/codevo-qa/qa_orchestrator_v2.py /Users/matusmockor/tmp/codevo-qa/qa_prompt_p0.txt /Users/matusmockor/tmp/codevo-qa-p0 > /tmp/qa-p0.log 2>&1
```

Watch `/tmp/qa-p0.log` only for `===== QA REPORT =====`, `COMPUTER_USE_UNAVAILABLE`, `[qa] ERROR`, `TIMEOUT` and `[qa] turn completed`. If Computer Use is unavailable from this context, hand the prompt to the user to run in their interactive Codex session and wait for the pasted report.

- [ ] **Step 6: Verify B6 numbers against the QA data**

Run (read-only):

```bash
DB=$(ls -d "/Users/matusmockor/Library/Application Support/dev.mockor.editor.qa/agent-history/v2"/*/history.sqlite3 | head -1)
sqlite3 -readonly "$DB" "select t.ordinal, json_extract(je.value,'$.usage.appServerUsage.total.inputTokens'), json_extract(je.value,'$.usage.appServerUsage.total.outputTokens') from turns t join threads h on h.thread_id=t.thread_id, json_each(json_extract(t.payload,'$.events')) je where json_extract(h.payload,'$.provider.kind')='codex' and json_extract(je.value,'$.kind')='result' order by t.thread_id, t.ordinal"
```

Expected: for the QA Codex thread, the Usage panel's Codex input equals the last turn's cumulative `total.inputTokens` and output equals its `total.outputTokens` (both turns measured from a zero baseline). Any mismatch is a B6 FAIL.

- [ ] **Step 7: Handle findings and clean up**

For each FAIL: verify the root cause in code, fix through the owning task agent with a regression test, rerun Tasks 6-7, rebuild and rerun only the failing QA steps. When QA passes: quit the QA app (`osascript -e 'quit app "Codevo QA"'`), and delete `/tmp/qa-p0.log`, `/Users/matusmockor/tmp/codevo-qa-p0` and `/Users/matusmockor/tmp/codevo-qa/shots-p0` after the report is recorded.

---

### Task 9: Commit to main (lead)

**Files:** the files listed in the File Structure table only.

**Interfaces:**
- Consumes: green gates (Task 6), resolved review (Task 7), passing QA (Task 8).
- Produces: four commits on `main`; no push, no tag, no release.

- [ ] **Step 1: Check for concurrent commits and foreign hunks**

Run: `cd /Users/matusmockor/Developer/editor && git log --oneline -5 && git status --short && git diff --stat`
Expected: no unexpected commits since `a5fb1e5d5`; every modified file belongs to a P0 task or is left unstaged (P1, `docs/redesign/`, the spec).

- [ ] **Step 2: Commit B1**

```bash
cd /Users/matusmockor/Developer/editor
git add src-tauri/src/agent_history_store/artifact_turns.rs src-tauri/src/agent_history_store/mod.rs src-tauri/src/agent_history_store/tests.rs src-tauri/src/lib_composition/agent_output_artifact_commands.rs
git commit -m "fix(artifacts): read generated-file ownership from durable history

Previews of agent-linked files failed with 'The file could not be read.' for
every thread saved since durable history shipped, because the artifact
commands still looked threads up in the retired JSON thread files. They now
read bounded thread and turn facts from the history database and fail closed
past the successor window."
```

- [ ] **Step 3: Commit B2**

```bash
git add src/components/agentMode/useAgentBackgroundActivity.ts src/components/agentMode/useAgentRowBackgroundActivity.ts src/components/agentMode/agentSidebarPresentation.ts src/components/agentMode/AgentThreadRow.tsx src/components/agentMode/agentSidebarPresentation.test.ts src/components/agentMode/AgentThreadRow.test.tsx
git commit -m "fix(sidebar): resolve background work with the conversation's quiescence"
```

- [ ] **Step 4: Commit B5**

```bash
git add src/components/agentMode/agentComposerQueuedEdit.ts src/components/agentMode/useAgentQueuedEditImagePreviews.ts src/components/agentMode/AgentModeView.tsx src/components/agentMode/agentComposerQueuedEdit.test.ts src/components/agentMode/useAgentQueuedEditImagePreviews.test.tsx
git commit -m "fix(composer): show image thumbnails while editing a queued message"
```

- [ ] **Step 5: Commit B6**

```bash
git add src/domain/agentTurnTokenUsage.ts src/domain/agentUsage.ts src/domain/agentUsage.test.ts
git commit -m "fix(usage): count Codex app-server usage as per-turn deltas"
```

- [ ] **Step 6: Verify**

Run: `git log --oneline -5 && git status --short`
Expected: four new commits on `main`, none containing AI attribution; remaining changes are only unrelated user/P1 files. Do not push or tag.

---

## Self-Review

1. Spec coverage (section 3.2): B1 -> Tasks 1-2 (root cause fixed, preview opens, QA step 1-2); B2 -> Task 3 (same 3 s quiescence, QA step 3); B5 -> Task 4 (thumbnails, QA step 4); B6 -> Task 5 (per-turn deltas from cumulative totals, no double counting across old and new events, QA step 5 + DB cross-check). Section 5/6/7: Opus implementation and review (Task 7), gates after the phase (Task 6), QA bundle `dev.mockor.editor.qa` with Codex Computer Use (Task 8), release deferred to P10 (no release task). B3 and B4 belong to P4/P6 and are out of scope.
2. Placeholder scan: the only substituted value is `<PID>` in the QA prompt, produced by Task 8 Step 3; no TBD/TODO steps.
3. Type consistency: `ArtifactTurnFact`/`ArtifactThreadFacts`/`artifact_thread_facts` are identical in Tasks 1-2; `useAgentForegroundQuiescence`, `useAgentRowBackgroundActivity`, `agentRowStatus(view, evidenceOf, background)` identical in Task 3; `queuedEditImageRequests`, `withQueuedEditImagePreviews`, `queuedEditImageOwner`, `useAgentQueuedEditImagePreviews` identical in Task 4; `measureAgentTurnTokens`, `AgentTurnTokenMeasurement` identical in Task 5.
4. Review Focus: each of the five lines has a named test in its owning task (Tasks 1, 3, 4, 5).

## Open questions

- B1 leaves the unclassified native refusals (`"Artifact thread is unavailable."`, `"Artifact turn is unavailable."`, `"Artifact repository does not match its registered owner."`) mapped to the generic, retryable `readFailed`. A follow-up could classify them as non-retryable in `contracts/agent-artifact-errors.json`; it is left out of P0 to keep the contract unchanged.
- B1 does not backfill snapshots: previews of older turns in existing threads (for example the original `docs/redesign` turn) will show the existing "no saved snapshot" message after the fix, because a later turn has already finished. Confirm this is acceptable.
- B6 treats any decrease of the cumulative counters as a reset of the provider session. A stale (older) snapshot stored after a newer one would be indistinguishable from a reset; turn order is the persisted order, so this is not expected in practice.
