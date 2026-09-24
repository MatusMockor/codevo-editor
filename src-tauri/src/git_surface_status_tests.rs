use super::*;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

static NONCE: AtomicUsize = AtomicUsize::new(0);

struct TempRepository {
    root: PathBuf,
}

impl TempRepository {
    fn create(label: &str) -> Self {
        let nonce = NONCE.fetch_add(1, Ordering::SeqCst);
        let root = std::env::temp_dir().join(format!(
            "git-surface-unit-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create repository directory");
        let repository = Self {
            root: root.canonicalize().expect("canonical root"),
        };
        repository.git(&["init", "--initial-branch=main"]);
        repository.git(&["config", "user.name", "Test"]);
        repository.git(&["config", "user.email", "test@example.com"]);
        fs::write(repository.root.join("a.txt"), "one\ntwo\n").expect("seed file");
        repository.git(&["add", "a.txt"]);
        repository.git(&["commit", "-m", "initial"]);
        repository
    }

    fn git(&self, arguments: &[&str]) {
        let output = Command::new("git")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .arg("-C")
            .arg(&self.root)
            .args(arguments)
            .output()
            .expect("run git fixture command");
        assert!(
            output.status.success(),
            "git {arguments:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

impl Drop for TempRepository {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn parses_numstat_records_including_renames_and_binary_files() {
    let output = "3\t1\tsrc/a.ts\0-\t-\timage.png\0\
                  2\t0\t\0old/name.ts\0new/name.ts\0";
    let (stats, truncated) = parse_numstat_z(output, 10);
    assert!(!truncated);
    assert_eq!(
        stats,
        vec![
            LineStat {
                relative_path: "src/a.ts".into(),
                added: Some(3),
                deleted: Some(1)
            },
            LineStat {
                relative_path: "image.png".into(),
                added: None,
                deleted: None
            },
            LineStat {
                relative_path: "new/name.ts".into(),
                added: Some(2),
                deleted: Some(0)
            },
        ]
    );
}

#[test]
fn caps_numstat_records() {
    let output = "1\t1\ta\0".repeat(5);
    let (stats, truncated) = parse_numstat_z(&output, 3);
    assert_eq!(stats.len(), 3);
    assert!(truncated);
}

#[test]
fn rejects_commit_lines_without_a_hex_object_id() {
    let separator = '\u{1f}';
    let valid = format!(
        "{}{separator}abc1234{separator}1700000000{separator}feat: x",
        "a".repeat(40)
    );
    assert_eq!(
        parse_commit_line(&valid).map(|commit| commit.subject),
        Some("feat: x".to_string())
    );
    assert!(parse_commit_line(&format!("zz{separator}zz{separator}1{separator}x")).is_none());
}

#[test]
fn clips_subjects_on_utf8_boundaries() {
    assert_eq!(clip_utf8("ééé", 3), "é");
    assert_eq!(clip_utf8("abc", 10), "abc");
}

#[test]
fn reports_branch_default_base_line_stats_and_no_unpushed_without_remotes() {
    let repository = TempRepository::create("status");
    repository.git(&["checkout", "-b", "feat/x"]);
    fs::write(repository.root.join("a.txt"), "one\nTWO\nthree\n").expect("edit file");

    let status = git_surface_status(&repository.root).expect("surface status");

    assert_eq!(status.branch.as_deref(), Some("feat/x"));
    assert_eq!(status.default_base.as_deref(), Some("main"));
    assert!(!status.has_remote);
    assert!(status.unpushed.is_empty());
    assert_eq!(
        status.line_stats,
        vec![LineStat {
            relative_path: "a.txt".into(),
            added: Some(2),
            deleted: Some(1)
        }]
    );
    assert_eq!(
        status.local_branches,
        vec!["feat/x".to_string(), "main".to_string()]
    );
}

#[test]
fn lists_commits_that_no_remote_contains() {
    let repository = TempRepository::create("unpushed");
    let remote = TempRepository::create("unpushed-remote");
    repository.git(&[
        "remote",
        "add",
        "origin",
        remote.root.to_str().expect("utf8 path"),
    ]);
    repository.git(&["fetch", "origin"]);
    repository.git(&["commit", "--allow-empty", "-m", "local only"]);

    let status = git_surface_status(&repository.root).expect("surface status");

    assert!(status.has_remote);
    assert_eq!(
        status
            .unpushed
            .first()
            .map(|commit| commit.subject.as_str()),
        Some("local only")
    );
}

#[test]
fn skips_numstat_paths_with_control_characters() {
    let (stats, truncated) = parse_numstat_z("1\t0\tbad\nname\x001\t0\tgood\0", 10);
    assert!(!truncated);
    assert_eq!(
        stats
            .iter()
            .map(|stat| stat.relative_path.as_str())
            .collect::<Vec<_>>(),
        vec!["good"]
    );
}

#[test]
fn computes_ref_truncation_from_raw_records_before_filtering() {
    let mut output = String::from("origin/HEAD\n");
    for index in 0..MAX_SURFACE_BRANCHES {
        output.push_str(&format!("origin/b{index}\n"));
    }
    let (names, truncated) = parse_refs(&output, true);
    assert!(truncated);
    assert_eq!(names.len(), MAX_SURFACE_BRANCHES - 1);

    let exact = (0..MAX_SURFACE_BRANCHES)
        .map(|index| format!("b{index}\n"))
        .collect::<String>();
    let (names, truncated) = parse_refs(&exact, false);
    assert!(!truncated);
    assert_eq!(names.len(), MAX_SURFACE_BRANCHES);
}

#[test]
fn keeps_negative_timestamps_and_clamps_to_the_js_safe_integer_range() {
    let separator = '\u{1f}';
    let sha = "a".repeat(40);
    let line = |timestamp: &str| format!("{sha}{separator}abc{separator}{timestamp}{separator}x");
    let parsed = |timestamp: &str| {
        parse_commit_line(&line(timestamp)).map(|commit| commit.authored_at_epoch_seconds)
    };
    assert_eq!(parsed("-86400"), Some(-86_400));
    assert_eq!(parsed("99999999999999999"), Some(MAX_JS_SAFE_INTEGER));
    assert_eq!(parsed("-99999999999999999"), Some(-MAX_JS_SAFE_INTEGER));
}

#[test]
fn keeps_only_complete_nul_terminated_records_when_capped() {
    assert_eq!(complete_z_records("1\t0\ta\0", false), "1\t0\ta\0");
    assert_eq!(complete_z_records("1\t0\ta\x002\t0\tb", true), "1\t0\ta\0");
    assert_eq!(complete_z_records("1\t0\tpartial", true), "");
    assert_eq!(complete_z_records("1\t0\tpartial", false), "1\t0\tpartial");
}

#[test]
fn reports_capped_line_stats_as_truncated_with_the_complete_prefix() {
    let repository = TempRepository::create("capped");
    for index in 0..20 {
        fs::write(repository.root.join(format!("file-{index:02}.txt")), "x\n").expect("write");
    }
    repository.git(&["add", "-A"]);
    let deadline = SurfaceDeadline::after(SURFACE_STATUS_BUDGET);
    let head = head_state(&repository.root, &deadline);

    let (stats, truncated) = line_stats(&repository.root, &head, &deadline, 64);
    let (all, complete_truncated) = line_stats(&repository.root, &head, &deadline, 1 << 20);

    assert!(truncated);
    assert!(!stats.is_empty());
    assert!(stats.len() < 20);
    assert_eq!(stats.as_slice(), &all[..stats.len()]);
    assert_eq!(all.len(), 20);
    assert!(!complete_truncated);
}

#[test]
fn diffs_an_unborn_head_against_the_empty_tree() {
    let nonce = NONCE.fetch_add(1, Ordering::SeqCst);
    let root = std::env::temp_dir().join(format!(
        "git-surface-unit-unborn-{}-{nonce}",
        std::process::id()
    ));
    fs::create_dir_all(&root).expect("create repository directory");
    let repository = TempRepository {
        root: root.canonicalize().expect("canonical root"),
    };
    repository.git(&["init", "--initial-branch=main"]);
    fs::write(repository.root.join("new.txt"), "a\nb\n").expect("write file");
    repository.git(&["add", "new.txt"]);

    let status = git_surface_status(&repository.root).expect("surface status");

    assert_eq!(status.branch.as_deref(), Some("main"));
    assert!(!status.line_stats_truncated);
    assert!(!status.unpushed_truncated);
    assert_eq!(
        status.line_stats,
        vec![LineStat {
            relative_path: "new.txt".into(),
            added: Some(2),
            deleted: Some(0)
        }]
    );
}

#[test]
fn reports_optional_parts_as_incomplete_once_the_budget_is_exhausted() {
    let repository = TempRepository::create("budget");
    fs::write(repository.root.join("a.txt"), "changed\n").expect("edit file");
    let deadline = SurfaceDeadline::after(Duration::ZERO);

    let status = git_surface_status_within(&repository.root, &deadline).expect("surface status");

    assert_eq!(status.branch.as_deref(), Some("main"));
    assert!(status.line_stats.is_empty());
    assert!(status.line_stats_truncated);
    assert!(status.unpushed_truncated);
    assert!(status.branches_truncated);
    assert!(status.local_branches.is_empty());
    assert_eq!(status.upstream, None);
}

fn stat(path: &str, added: Option<u32>) -> LineStat {
    LineStat {
        relative_path: path.into(),
        added,
        deleted: added.map(|_| 0),
    }
}

#[test]
fn counts_added_lines_of_untracked_files_and_skips_binary_and_ignored_files() {
    let repository = TempRepository::create("untracked");
    fs::write(repository.root.join("a.txt"), "one\nTWO\n").expect("edit file");
    fs::write(repository.root.join(".gitignore"), "ignored.log\n").expect("write ignore");
    fs::write(repository.root.join("ignored.log"), "noise\n").expect("write ignored");
    fs::create_dir_all(repository.root.join("src")).expect("mkdir src");
    fs::write(repository.root.join("src/new.ts"), "a\nb\nc").expect("write new");
    fs::write(repository.root.join("empty.txt"), "").expect("write empty");
    fs::write(repository.root.join("logo.png"), [0x89, b'P', 0, 1, 2]).expect("write binary");
    std::os::unix::fs::symlink("/etc/hosts", repository.root.join("link")).expect("symlink");

    let status = git_surface_status(&repository.root).expect("surface status");

    assert!(!status.line_stats_truncated);
    assert_eq!(
        status.line_stats,
        vec![
            LineStat {
                relative_path: "a.txt".into(),
                added: Some(1),
                deleted: Some(1)
            },
            stat(".gitignore", Some(1)),
            stat("empty.txt", Some(0)),
            stat("link", None),
            stat("logo.png", None),
            stat("src/new.ts", Some(3)),
        ]
    );
}

#[test]
fn leaves_oversized_untracked_files_uncounted_and_marks_the_stats_partial() {
    let repository = TempRepository::create("untracked-large");
    fs::write(repository.root.join("big.txt"), "x\n".repeat(64)).expect("write big");
    fs::write(repository.root.join("small.txt"), "x\n").expect("write small");
    let deadline = SurfaceDeadline::after(SURFACE_STATUS_BUDGET);
    let limits = git_surface_untracked_stats::UntrackedStatLimits {
        files: 10,
        file_bytes: 16,
        total_bytes: 1024,
    };

    let (stats, partial) = untracked_line_stats(&repository.root, &deadline, 10, limits);

    assert!(partial);
    assert_eq!(stats, vec![stat("small.txt", Some(1))]);
}

#[test]
fn marks_untracked_stats_partial_when_the_file_or_byte_budget_runs_out() {
    let repository = TempRepository::create("untracked-budget");
    for index in 0..4 {
        fs::write(repository.root.join(format!("n{index}.txt")), "abc\n").expect("write");
    }
    let deadline = SurfaceDeadline::after(SURFACE_STATUS_BUDGET);
    let few_files = git_surface_untracked_stats::UntrackedStatLimits {
        files: 2,
        file_bytes: 1024,
        total_bytes: 1024,
    };
    let few_bytes = git_surface_untracked_stats::UntrackedStatLimits {
        files: 10,
        file_bytes: 1024,
        total_bytes: 8,
    };

    let (by_files, files_partial) =
        untracked_line_stats(&repository.root, &deadline, 10, few_files);
    let (by_slots, slots_partial) =
        untracked_line_stats(&repository.root, &deadline, 3, UNTRACKED_STAT_LIMITS);
    let (by_bytes, bytes_partial) =
        untracked_line_stats(&repository.root, &deadline, 10, few_bytes);
    let (all, all_partial) =
        untracked_line_stats(&repository.root, &deadline, 10, UNTRACKED_STAT_LIMITS);

    assert!(files_partial);
    assert_eq!(by_files.len(), 2);
    assert!(slots_partial);
    assert_eq!(by_slots.len(), 3);
    assert!(bytes_partial);
    assert_eq!(
        by_bytes,
        vec![stat("n0.txt", Some(1)), stat("n1.txt", Some(1))]
    );
    assert!(!all_partial);
    assert_eq!(all.len(), 4);
}
