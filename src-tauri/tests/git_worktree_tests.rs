#![cfg(unix)]
#![allow(dead_code)]

use std::{
    fmt::Debug,
    fs,
    io::Cursor,
    os::unix::fs::symlink,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};

#[path = "../src/git_worktree.rs"]
mod git_worktree;

use git_worktree::{
    agent_branch_name, agent_worktree_path, ensure_worktree_path_in_base, parse_worktree_list,
    prunable_worktree_path_in_base, read_bounded_stream, remove_agent_worktree_with_disposal,
    safe_agent_task_id, CommandGitWorktreeGateway, CreatedAgentWorktree, GitWorktreeDescriptor,
    GitWorktreeGateway, WorktreeRemovalHooks, MAX_AGENT_TASK_ID_BYTES, MAX_LISTED_WORKTREE_ENTRIES,
    MAX_WORKTREES_PER_REPOSITORY, MAX_WORKTREE_LIST_OUTPUT_BYTES, WORKTREE_BASE_DIR_NAME,
};

#[track_caller]
fn ok<T, E: Debug>(result: Result<T, E>, message: &str) -> T {
    assert!(result.is_ok(), "{message}: {:?}", result.as_ref().err());
    result.unwrap()
}

#[track_caller]
fn failure<T: Debug>(result: Result<T, String>, message: &str) -> String {
    assert!(result.is_err(), "{message}: {result:?}");
    result.unwrap_err()
}

fn scratch_path(label: &str) -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    std::env::temp_dir().join(format!(
        "codevo-git-worktree-{label}-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ))
}

struct TempDirectory {
    path: PathBuf,
}

impl TempDirectory {
    fn create(label: &str) -> Self {
        let path = scratch_path(label);
        let _ = fs::remove_dir_all(&path);
        assert!(
            fs::create_dir_all(&path).is_ok(),
            "fixture directory must be creatable"
        );
        let canonical = ok(
            fs::canonicalize(&path),
            "fixture directory must canonicalize",
        );
        Self { path: canonical }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

struct TempRepository {
    directory: TempDirectory,
}

impl TempRepository {
    fn create(label: &str) -> Self {
        let directory = TempDirectory::create(label);
        let repository = Self { directory };
        repository.run_git(&["init", "-q"]);
        let readme = repository.path().join("README.md");
        assert!(
            fs::write(&readme, "codevo worktree fixture\n").is_ok(),
            "fixture file must be writable"
        );
        repository.run_git(&["add", "README.md"]);
        repository.run_git(&["commit", "-q", "-m", "initial"]);
        repository
    }

    fn path(&self) -> &Path {
        self.directory.path()
    }

    #[track_caller]
    fn run_git(&self, arguments: &[&str]) {
        let output = fixture_git(self.path(), arguments);
        assert!(
            output.status.success(),
            "git {arguments:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[track_caller]
    fn git_output(&self, arguments: &[&str]) -> String {
        let output = fixture_git(self.path(), arguments);
        assert!(
            output.status.success(),
            "git {arguments:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).to_string()
    }

    fn local_branches(&self) -> Vec<String> {
        self.git_output(&["branch", "--list", "--format=%(refname:short)"])
            .lines()
            .map(|line| line.trim().to_string())
            .filter(|line| !line.is_empty())
            .collect()
    }
}

#[track_caller]
fn fixture_git(root: &Path, arguments: &[&str]) -> std::process::Output {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(arguments)
        .env("LC_ALL", "C")
        .env("LANG", "C")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .env("GIT_AUTHOR_NAME", "Codevo Fixture")
        .env("GIT_AUTHOR_EMAIL", "fixture@codevo.test")
        .env("GIT_COMMITTER_NAME", "Codevo Fixture")
        .env("GIT_COMMITTER_EMAIL", "fixture@codevo.test")
        .output();

    ok(output, "git must be available on PATH")
}

fn descriptor_for<'a>(
    descriptors: &'a [GitWorktreeDescriptor],
    path: &Path,
) -> Option<&'a GitWorktreeDescriptor> {
    descriptors
        .iter()
        .find(|descriptor| Path::new(&descriptor.worktree_path) == path)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RemovalStep {
    StopAgentTasks,
    DisposeRuntimes,
    RemoveWorktree,
    RevokeTrust,
}

#[derive(Default)]
struct RemovalJournal {
    steps: Mutex<Vec<RemovalStep>>,
    forced: Mutex<Vec<bool>>,
}

impl RemovalJournal {
    fn record(&self, step: RemovalStep) {
        if let Ok(mut steps) = self.steps.lock() {
            steps.push(step);
        }
    }

    fn record_force(&self, force: bool) {
        if let Ok(mut forced) = self.forced.lock() {
            forced.push(force);
        }
    }

    fn steps(&self) -> Vec<RemovalStep> {
        let Ok(steps) = self.steps.lock() else {
            return Vec::new();
        };
        steps.clone()
    }

    fn forced(&self) -> Vec<bool> {
        let Ok(forced) = self.forced.lock() else {
            return Vec::new();
        };
        forced.clone()
    }
}

struct RecordingHooks {
    journal: Arc<RemovalJournal>,
    failing: Option<RemovalStep>,
}

impl RecordingHooks {
    fn new(journal: Arc<RemovalJournal>, failing: Option<RemovalStep>) -> Self {
        Self { journal, failing }
    }

    fn run(&self, step: RemovalStep) -> Result<(), String> {
        self.journal.record(step);

        if self.failing == Some(step) {
            return Err(format!("{step:?} refused"));
        }

        Ok(())
    }
}

impl WorktreeRemovalHooks for RecordingHooks {
    fn stop_agent_tasks(&self, _worktree_path: &Path) -> Result<(), String> {
        self.run(RemovalStep::StopAgentTasks)
    }

    fn dispose_runtimes(&self, _worktree_path: &Path) -> Result<(), String> {
        self.run(RemovalStep::DisposeRuntimes)
    }

    fn revoke_trust(&self, _worktree_path: &Path) -> Result<(), String> {
        self.run(RemovalStep::RevokeTrust)
    }
}

struct RecordingGateway {
    journal: Arc<RemovalJournal>,
    fails: bool,
}

impl RecordingGateway {
    fn new(journal: Arc<RemovalJournal>, fails: bool) -> Self {
        Self { journal, fails }
    }
}

impl GitWorktreeGateway for RecordingGateway {
    fn list_worktrees(
        &self,
        _repository_root: &Path,
    ) -> Result<Vec<GitWorktreeDescriptor>, String> {
        Err("list is not part of the removal sequence".to_string())
    }

    fn add_agent_worktree(
        &self,
        _repository_root: &Path,
        _task_id: &str,
    ) -> Result<CreatedAgentWorktree, String> {
        Err("add is not part of the removal sequence".to_string())
    }

    fn remove_worktree(
        &self,
        _repository_root: &Path,
        _worktree_path: &Path,
        force: bool,
    ) -> Result<(), String> {
        self.journal.record(RemovalStep::RemoveWorktree);
        self.journal.record_force(force);

        if self.fails {
            return Err("git refused to remove the worktree".to_string());
        }

        Ok(())
    }

    fn prune_worktrees(&self, _repository_root: &Path) -> Result<Vec<String>, String> {
        Err("prune is not part of the removal sequence".to_string())
    }
}

#[test]
fn safe_agent_task_id_accepts_minted_identifiers() {
    assert_eq!(
        ok(safe_agent_task_id("agt-mf3k9x-1a2b"), "minted id is valid"),
        "agt-mf3k9x-1a2b"
    );
    assert_eq!(
        ok(safe_agent_task_id("a1b"), "minimum length is valid"),
        "a1b"
    );
    assert_eq!(ok(safe_agent_task_id("0ab"), "digit start is valid"), "0ab");

    let longest = "a".repeat(MAX_AGENT_TASK_ID_BYTES);
    assert_eq!(
        ok(safe_agent_task_id(&longest), "maximum length is valid"),
        longest
    );
}

#[test]
fn safe_agent_task_id_rejects_unsafe_candidates() {
    let candidates = [
        "", "a", "ab", "-abc", "--abc", "ag--t", "Agt-1", "agt_1", "agt.1", "agt/1", "agt 1",
        " agt-1", "agt-1 ", "agt-1\n", "../etc", "agt-ř1", "@{-1}",
    ];

    for candidate in candidates {
        failure(
            safe_agent_task_id(candidate),
            &format!("candidate {candidate:?} must be rejected"),
        );
    }

    let too_long = "a".repeat(MAX_AGENT_TASK_ID_BYTES + 1);
    failure(
        safe_agent_task_id(&too_long),
        "overlong candidate must be rejected",
    );
}

#[test]
fn agent_naming_is_derived_from_the_task_id() {
    assert_eq!(agent_branch_name("agt-1a2b"), "agent/agt-1a2b");
    assert_eq!(
        agent_worktree_path(Path::new("/repos/app"), "agt-1a2b"),
        PathBuf::from("/repos/app/.worktrees/agt-1a2b")
    );
}

#[test]
fn add_agent_worktree_creates_the_directory_and_branch() {
    let repository = TempRepository::create("add");
    let gateway = CommandGitWorktreeGateway::new();

    let created = ok(
        gateway.add_agent_worktree(repository.path(), "agt-create-1"),
        "worktree must be created",
    );

    assert_eq!(created.branch, "agent/agt-create-1");
    assert_eq!(
        created.worktree_path,
        repository
            .path()
            .join(WORKTREE_BASE_DIR_NAME)
            .join("agt-create-1")
    );
    assert!(
        created.worktree_path.join("README.md").is_file(),
        "the worktree must be checked out"
    );
    assert!(
        repository
            .local_branches()
            .contains(&"agent/agt-create-1".to_string()),
        "the agent branch must exist"
    );
}

#[test]
fn add_agent_worktree_rejects_invalid_task_ids() {
    let repository = TempRepository::create("add-invalid");
    let gateway = CommandGitWorktreeGateway::new();

    failure(
        gateway.add_agent_worktree(repository.path(), "../escape"),
        "path traversal must be rejected",
    );
    failure(
        gateway.add_agent_worktree(repository.path(), "-force"),
        "option-like ids must be rejected",
    );
    assert!(
        !repository.path().join(WORKTREE_BASE_DIR_NAME).exists(),
        "a rejected request must not create the worktree base directory"
    );
}

#[test]
fn add_agent_worktree_rejects_an_existing_target() {
    let repository = TempRepository::create("add-existing");
    let gateway = CommandGitWorktreeGateway::new();

    ok(
        gateway.add_agent_worktree(repository.path(), "agt-dup-1"),
        "first add must succeed",
    );

    let message = failure(
        gateway.add_agent_worktree(repository.path(), "agt-dup-1"),
        "second add must be rejected",
    );
    assert!(
        message.contains("already exists"),
        "unexpected message: {message}"
    );
}

#[test]
fn add_agent_worktree_rejects_relative_repository_roots() {
    let gateway = CommandGitWorktreeGateway::new();

    failure(
        gateway.add_agent_worktree(Path::new("relative/repo"), "agt-rel-1"),
        "relative roots must be rejected",
    );
}

#[test]
fn add_agent_worktree_enforces_the_repository_cap() {
    let repository = TempRepository::create("add-cap");
    let gateway = CommandGitWorktreeGateway::new();

    for index in 1..MAX_WORKTREES_PER_REPOSITORY {
        let task_id = format!("agt-cap-{index}");
        ok(
            gateway.add_agent_worktree(repository.path(), &task_id),
            "add below the cap must succeed",
        );
    }

    let listed = ok(
        gateway.list_worktrees(repository.path()),
        "list must succeed",
    );
    assert_eq!(listed.len(), MAX_WORKTREES_PER_REPOSITORY);

    let message = failure(
        gateway.add_agent_worktree(repository.path(), "agt-cap-overflow"),
        "add beyond the cap must be rejected",
    );
    assert!(message.contains("maximum"), "unexpected message: {message}");
}

#[test]
fn list_worktrees_reports_primary_linked_locked_and_prunable_entries() {
    let repository = TempRepository::create("list");
    let gateway = CommandGitWorktreeGateway::new();

    let linked = ok(
        gateway.add_agent_worktree(repository.path(), "agt-list-linked"),
        "linked worktree must be created",
    );
    let locked = ok(
        gateway.add_agent_worktree(repository.path(), "agt-list-locked"),
        "locked worktree must be created",
    );
    let prunable = ok(
        gateway.add_agent_worktree(repository.path(), "agt-list-prunable"),
        "prunable worktree must be created",
    );

    let locked_path = locked.worktree_path.to_string_lossy().to_string();
    repository.run_git(&["worktree", "lock", &locked_path]);
    assert!(
        fs::remove_dir_all(&prunable.worktree_path).is_ok(),
        "the prunable worktree directory must be removable"
    );

    let descriptors = ok(
        gateway.list_worktrees(repository.path()),
        "list must succeed",
    );
    assert_eq!(descriptors.len(), 4);

    let primary = descriptors.first();
    assert!(primary.is_some(), "the primary worktree must be listed");
    let primary = ok(primary.ok_or("missing"), "primary entry");
    assert_eq!(Path::new(&primary.worktree_path), repository.path());
    assert!(
        primary.is_primary,
        "the first entry is the primary worktree"
    );
    assert!(!primary.locked);
    assert!(!primary.prunable);
    assert!(primary.head.is_some(), "the primary head must be reported");

    let linked_descriptor = descriptor_for(&descriptors, &linked.worktree_path);
    assert!(linked_descriptor.is_some(), "the linked worktree is listed");
    let linked_descriptor = ok(linked_descriptor.ok_or("missing"), "linked entry");
    assert!(!linked_descriptor.is_primary);
    assert_eq!(
        linked_descriptor.branch,
        Some("agent/agt-list-linked".to_string())
    );
    assert!(!linked_descriptor.locked);
    assert!(!linked_descriptor.prunable);

    let locked_descriptor = descriptor_for(&descriptors, &locked.worktree_path);
    assert!(locked_descriptor.is_some(), "the locked worktree is listed");
    let locked_descriptor = ok(locked_descriptor.ok_or("missing"), "locked entry");
    assert!(locked_descriptor.locked, "the lock must be reported");

    let prunable_descriptor = descriptor_for(&descriptors, &prunable.worktree_path);
    assert!(
        prunable_descriptor.is_some(),
        "the prunable worktree is listed"
    );
    let prunable_descriptor = ok(prunable_descriptor.ok_or("missing"), "prunable entry");
    assert!(
        prunable_descriptor.prunable,
        "the missing directory must be reported as prunable"
    );
}

#[test]
fn parse_worktree_list_handles_detached_and_unknown_attributes() {
    let output = concat!(
        "worktree /repos/app\n",
        "HEAD 0123456789abcdef0123456789abcdef01234567\n",
        "branch refs/heads/main\n",
        "\n",
        "worktree /repos/app/.worktrees/agt-1\n",
        "HEAD 0123456789abcdef0123456789abcdef01234567\n",
        "detached\n",
        "future-attribute something\n",
        "\n",
    );

    let descriptors = ok(parse_worktree_list(output), "porcelain output must parse");
    assert_eq!(descriptors.len(), 2);

    let primary = ok(descriptors.first().ok_or("missing"), "primary entry");
    assert!(primary.is_primary);
    assert_eq!(primary.branch, Some("main".to_string()));

    let detached = ok(descriptors.get(1).ok_or("missing"), "detached entry");
    assert!(!detached.is_primary);
    assert_eq!(detached.branch, None);
    assert_eq!(detached.worktree_path, "/repos/app/.worktrees/agt-1");
}

#[test]
fn parse_worktree_list_rejects_output_without_a_leading_record() {
    failure(
        parse_worktree_list("HEAD 0123456789abcdef\n"),
        "an orphan attribute must be rejected",
    );
}

#[test]
fn parse_worktree_list_rejects_more_entries_than_the_cap() {
    let mut output = String::new();

    for index in 0..=MAX_LISTED_WORKTREE_ENTRIES {
        output.push_str(&format!("worktree /repos/app/.worktrees/agt-{index}\n\n"));
    }

    failure(
        parse_worktree_list(&output),
        "an oversized entry count must be rejected",
    );
}

#[test]
fn parse_worktree_list_rejects_an_overlong_branch_reference() {
    let reference = "a".repeat(4096);
    let output = format!("worktree /repos/app\nbranch refs/heads/{reference}\n");

    failure(
        parse_worktree_list(&output),
        "an overlong branch must be rejected",
    );
}

#[test]
fn read_bounded_stream_accepts_output_at_the_limit() {
    let payload = vec![b'x'; MAX_WORKTREE_LIST_OUTPUT_BYTES];
    let read = ok(
        read_bounded_stream(Cursor::new(payload.clone()), MAX_WORKTREE_LIST_OUTPUT_BYTES),
        "output at the limit must be accepted",
    );

    assert_eq!(read.len(), payload.len());
}

#[test]
fn read_bounded_stream_rejects_output_beyond_the_limit() {
    let payload = vec![b'x'; MAX_WORKTREE_LIST_OUTPUT_BYTES + 1];

    let message = failure(
        read_bounded_stream(Cursor::new(payload), MAX_WORKTREE_LIST_OUTPUT_BYTES),
        "oversized output must fail closed",
    );
    assert!(
        message.contains("exceeded"),
        "unexpected message: {message}"
    );
}

#[test]
fn ensure_worktree_path_in_base_accepts_an_agent_worktree() {
    let repository = TempRepository::create("contain-ok");
    let gateway = CommandGitWorktreeGateway::new();

    let created = ok(
        gateway.add_agent_worktree(repository.path(), "agt-contain-1"),
        "worktree must be created",
    );

    let resolved = ok(
        ensure_worktree_path_in_base(repository.path(), &created.worktree_path),
        "the agent worktree must be accepted",
    );
    assert_eq!(resolved, created.worktree_path);
}

#[test]
fn ensure_worktree_path_in_base_rejects_escapes() {
    let repository = TempRepository::create("contain-reject");
    let outside = TempDirectory::create("contain-outside");
    let gateway = CommandGitWorktreeGateway::new();

    let created = ok(
        gateway.add_agent_worktree(repository.path(), "agt-contain-2"),
        "worktree must be created",
    );

    let base = repository.path().join(WORKTREE_BASE_DIR_NAME);
    let escape_link = base.join("escape");
    assert!(
        symlink(outside.path(), &escape_link).is_ok(),
        "the escaping symlink must be creatable"
    );

    let sibling = repository.path().join("src");
    assert!(
        fs::create_dir_all(&sibling).is_ok(),
        "the sibling directory must be creatable"
    );

    let rejected: Vec<PathBuf> = vec![
        repository.path().to_path_buf(),
        base.clone(),
        sibling,
        outside.path().to_path_buf(),
        escape_link,
        created.worktree_path.join("..").join(".."),
        base.join("..").join("src"),
        repository.path().join("missing-worktree"),
    ];

    for candidate in rejected {
        failure(
            ensure_worktree_path_in_base(repository.path(), &candidate),
            &format!("{} must be rejected", candidate.display()),
        );
    }
}

#[test]
fn remove_worktree_deletes_the_directory_and_keeps_the_branch() {
    let repository = TempRepository::create("remove");
    let gateway = CommandGitWorktreeGateway::new();

    let created = ok(
        gateway.add_agent_worktree(repository.path(), "agt-remove-1"),
        "worktree must be created",
    );

    ok(
        gateway.remove_worktree(repository.path(), &created.worktree_path, false),
        "removal must succeed",
    );

    assert!(
        !created.worktree_path.exists(),
        "the worktree directory must be gone"
    );
    assert!(
        repository
            .local_branches()
            .contains(&"agent/agt-remove-1".to_string()),
        "the agent branch must survive removal"
    );

    let descriptors = ok(
        gateway.list_worktrees(repository.path()),
        "list must succeed",
    );
    assert_eq!(descriptors.len(), 1);
}

#[test]
fn remove_worktree_rejects_paths_outside_the_worktree_base() {
    let repository = TempRepository::create("remove-outside");
    let outside = TempDirectory::create("remove-outside-target");
    let gateway = CommandGitWorktreeGateway::new();

    ok(
        gateway.add_agent_worktree(repository.path(), "agt-remove-2"),
        "worktree must be created",
    );

    let candidates: Vec<PathBuf> = vec![
        repository.path().to_path_buf(),
        repository.path().join(WORKTREE_BASE_DIR_NAME),
        repository
            .path()
            .join(WORKTREE_BASE_DIR_NAME)
            .join("..")
            .join(".."),
        outside.path().to_path_buf(),
    ];

    for candidate in candidates {
        failure(
            gateway.remove_worktree(repository.path(), &candidate, true),
            &format!("{} must be refused", candidate.display()),
        );
    }

    assert!(
        outside.path().is_dir(),
        "an unrelated directory must survive"
    );
    assert!(repository.path().is_dir(), "the repository must survive");
}

#[test]
fn remove_worktree_requires_force_for_a_dirty_worktree() {
    let repository = TempRepository::create("remove-dirty");
    let gateway = CommandGitWorktreeGateway::new();

    let created = ok(
        gateway.add_agent_worktree(repository.path(), "agt-remove-3"),
        "worktree must be created",
    );
    assert!(
        fs::write(created.worktree_path.join("scratch.txt"), "agent output\n").is_ok(),
        "the worktree must be writable"
    );

    failure(
        gateway.remove_worktree(repository.path(), &created.worktree_path, false),
        "a dirty worktree must not be removed without force",
    );
    assert!(
        created.worktree_path.is_dir(),
        "the dirty worktree must survive"
    );

    ok(
        gateway.remove_worktree(repository.path(), &created.worktree_path, true),
        "forced removal must succeed",
    );
    assert!(
        !created.worktree_path.exists(),
        "the forced removal must delete the directory"
    );
}

#[test]
fn prune_worktrees_returns_the_pruned_paths() {
    let repository = TempRepository::create("prune");
    let gateway = CommandGitWorktreeGateway::new();

    let kept = ok(
        gateway.add_agent_worktree(repository.path(), "agt-prune-kept"),
        "kept worktree must be created",
    );
    let pruned = ok(
        gateway.add_agent_worktree(repository.path(), "agt-prune-gone"),
        "pruned worktree must be created",
    );
    assert!(
        fs::remove_dir_all(&pruned.worktree_path).is_ok(),
        "the worktree directory must be removable"
    );

    let reported = ok(
        gateway.prune_worktrees(repository.path()),
        "prune must succeed",
    );
    assert_eq!(
        reported,
        vec![pruned.worktree_path.to_string_lossy().to_string()]
    );

    let descriptors = ok(
        gateway.list_worktrees(repository.path()),
        "list must succeed",
    );
    assert_eq!(descriptors.len(), 2);
    assert!(
        descriptor_for(&descriptors, &kept.worktree_path).is_some(),
        "the live worktree must survive prune"
    );
    assert!(
        repository
            .local_branches()
            .contains(&"agent/agt-prune-gone".to_string()),
        "the branch must survive prune"
    );
}

#[test]
fn prune_worktrees_reports_nothing_when_every_worktree_is_live() {
    let repository = TempRepository::create("prune-clean");
    let gateway = CommandGitWorktreeGateway::new();

    ok(
        gateway.add_agent_worktree(repository.path(), "agt-prune-live"),
        "worktree must be created",
    );

    let reported = ok(
        gateway.prune_worktrees(repository.path()),
        "prune must succeed",
    );
    assert!(reported.is_empty(), "nothing is prunable: {reported:?}");
}

#[test]
fn removal_orchestrator_runs_the_disposal_order() {
    let journal = Arc::new(RemovalJournal::default());
    let gateway = RecordingGateway::new(Arc::clone(&journal), false);
    let hooks = RecordingHooks::new(Arc::clone(&journal), None);

    ok(
        remove_agent_worktree_with_disposal(
            &gateway,
            &hooks,
            Path::new("/repos/app"),
            Path::new("/repos/app/.worktrees/agt-1"),
            true,
        ),
        "the removal sequence must succeed",
    );

    assert_eq!(
        journal.steps(),
        vec![
            RemovalStep::StopAgentTasks,
            RemovalStep::DisposeRuntimes,
            RemovalStep::RemoveWorktree,
            RemovalStep::RevokeTrust,
        ]
    );
    assert_eq!(journal.forced(), vec![true]);
}

#[test]
fn removal_orchestrator_aborts_when_stopping_agent_tasks_fails() {
    let journal = Arc::new(RemovalJournal::default());
    let gateway = RecordingGateway::new(Arc::clone(&journal), false);
    let hooks = RecordingHooks::new(Arc::clone(&journal), Some(RemovalStep::StopAgentTasks));

    failure(
        remove_agent_worktree_with_disposal(
            &gateway,
            &hooks,
            Path::new("/repos/app"),
            Path::new("/repos/app/.worktrees/agt-1"),
            false,
        ),
        "the sequence must abort",
    );

    assert_eq!(journal.steps(), vec![RemovalStep::StopAgentTasks]);
}

#[test]
fn removal_orchestrator_aborts_when_runtime_disposal_fails() {
    let journal = Arc::new(RemovalJournal::default());
    let gateway = RecordingGateway::new(Arc::clone(&journal), false);
    let hooks = RecordingHooks::new(Arc::clone(&journal), Some(RemovalStep::DisposeRuntimes));

    failure(
        remove_agent_worktree_with_disposal(
            &gateway,
            &hooks,
            Path::new("/repos/app"),
            Path::new("/repos/app/.worktrees/agt-1"),
            false,
        ),
        "the sequence must abort",
    );

    assert_eq!(
        journal.steps(),
        vec![RemovalStep::StopAgentTasks, RemovalStep::DisposeRuntimes]
    );
}

#[test]
fn removal_orchestrator_aborts_when_git_removal_fails() {
    let journal = Arc::new(RemovalJournal::default());
    let gateway = RecordingGateway::new(Arc::clone(&journal), true);
    let hooks = RecordingHooks::new(Arc::clone(&journal), None);

    failure(
        remove_agent_worktree_with_disposal(
            &gateway,
            &hooks,
            Path::new("/repos/app"),
            Path::new("/repos/app/.worktrees/agt-1"),
            false,
        ),
        "the sequence must abort",
    );

    assert_eq!(
        journal.steps(),
        vec![
            RemovalStep::StopAgentTasks,
            RemovalStep::DisposeRuntimes,
            RemovalStep::RemoveWorktree,
        ]
    );
}

#[test]
fn removal_orchestrator_tolerates_a_failed_trust_revocation() {
    let journal = Arc::new(RemovalJournal::default());
    let gateway = RecordingGateway::new(Arc::clone(&journal), false);
    let hooks = RecordingHooks::new(Arc::clone(&journal), Some(RemovalStep::RevokeTrust));

    ok(
        remove_agent_worktree_with_disposal(
            &gateway,
            &hooks,
            Path::new("/repos/app"),
            Path::new("/repos/app/.worktrees/agt-1"),
            false,
        ),
        "a failed revocation must not fail the removal",
    );

    assert_eq!(
        journal.steps(),
        vec![
            RemovalStep::StopAgentTasks,
            RemovalStep::DisposeRuntimes,
            RemovalStep::RemoveWorktree,
            RemovalStep::RevokeTrust,
        ]
    );
}

#[test]
fn removal_orchestrator_uses_the_real_gateway_against_a_repository() {
    let repository = TempRepository::create("removal-real");
    let journal = Arc::new(RemovalJournal::default());
    let gateway = CommandGitWorktreeGateway::new();
    let hooks = RecordingHooks::new(Arc::clone(&journal), None);

    let created = ok(
        gateway.add_agent_worktree(repository.path(), "agt-real-1"),
        "worktree must be created",
    );

    ok(
        remove_agent_worktree_with_disposal(
            &gateway,
            &hooks,
            repository.path(),
            &created.worktree_path,
            false,
        ),
        "the removal sequence must succeed",
    );

    assert!(
        !created.worktree_path.exists(),
        "the worktree directory must be gone"
    );
    assert_eq!(
        journal.steps(),
        vec![
            RemovalStep::StopAgentTasks,
            RemovalStep::DisposeRuntimes,
            RemovalStep::RevokeTrust,
        ]
    );
    assert!(
        repository
            .local_branches()
            .contains(&"agent/agt-real-1".to_string()),
        "the agent branch must survive"
    );
}

#[test]
fn prunable_path_validation_accepts_only_descendants_of_the_worktree_base() {
    let root = Path::new("/repo");
    let base = root.join(WORKTREE_BASE_DIR_NAME);

    assert!(prunable_worktree_path_in_base(root, &base.join("agt-1")));
    assert!(prunable_worktree_path_in_base(
        root,
        &base.join("agt-1/nested")
    ));
    assert!(!prunable_worktree_path_in_base(root, root));
    assert!(!prunable_worktree_path_in_base(root, &base));
    assert!(!prunable_worktree_path_in_base(
        root,
        Path::new("/elsewhere/worktree")
    ));
    assert!(!prunable_worktree_path_in_base(
        root,
        Path::new("/repo/.worktrees-evil/agt-1")
    ));
    assert!(!prunable_worktree_path_in_base(
        root,
        &base.join("agt-1/../../src")
    ));
    assert!(!prunable_worktree_path_in_base(
        root,
        Path::new("relative/.worktrees/agt-1")
    ));
}
