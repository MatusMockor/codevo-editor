use super::*;
use std::{
    ffi::CString,
    fs,
    os::unix::{ffi::OsStrExt, fs::symlink},
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT_TEMP: AtomicU64 = AtomicU64::new(1);

struct Fixture {
    root: PathBuf,
}

impl Fixture {
    fn new(label: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "mockor-explorer-listing-{label}-{}-{}",
            std::process::id(),
            NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        Self { root }
    }

    fn write(&self, relative: &str, content: &str) -> &Self {
        let path = self.root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
        self
    }

    fn dir(&self, relative: &str) -> &Self {
        fs::create_dir_all(self.root.join(relative)).unwrap();
        self
    }

    fn listing(&self, relative: &str) -> Vec<(String, bool)> {
        let registry = WorkspaceRegistry::new();
        let id = registry.register(&self.root).unwrap().workspace_id;
        read_directory_bounded(&registry, &id, Path::new(relative), 100)
            .unwrap()
            .entries
            .into_iter()
            .map(|entry| (entry.name, entry.ignored))
            .collect()
    }

    fn case_insensitive(&self) -> bool {
        let registry = WorkspaceRegistry::new();
        registry.register(&self.root).unwrap().case_sensitive == Some(false)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn ignored_flag(entries: &[(String, bool)], name: &str) -> bool {
    entries
        .iter()
        .find(|(entry, _)| entry == name)
        .map(|(_, ignored)| *ignored)
        .unwrap_or_else(|| panic!("{name} must be listed, got {entries:?}"))
}

fn pa_ai_be_fixture() -> Fixture {
    let fixture = Fixture::new("pa-ai-be");
    fixture
        .write(
            ".gitignore",
            "node_modules/\ndist/\n.idea/\nstorage/\n.gitsecret/keys/random_seed\n!*.secret\nsrc/environment.ts\nsrc/environment.prod.ts\n",
        )
        .write(".git/HEAD", "ref: refs/heads/dev\n")
        .write(".git/info/exclude", "local-notes.md\n")
        .write(".gitsecret/paths/mapping.cfg", "src/environment.prod.ts:hash\n")
        .write(".idea/workspace.xml", "<project/>")
        .write(".vscode/launch.json", "{}")
        .write("dist/index.js", "")
        .write("node_modules/express/index.js", "")
        .write("storage/cache.bin", "")
        .write("local-notes.md", "")
        .write("package.json", "{}")
        .write("src/environment.prod.ts", "export default {};")
        .write("src/environment.prod.ts.secret", "encrypted")
        .write("src/environment.sample.ts", "export default {};")
        .write("src/environment.ts", "export default {};")
        .write("src/index.ts", "")
        .write("src/generated/.gitignore", "*.gen.ts\n!keep.gen.ts\n")
        .write("src/generated/api.gen.ts", "")
        .write("src/generated/keep.gen.ts", "");
    fixture
}

#[test]
fn gitignored_files_and_directories_are_listed_and_flagged_like_vscode() {
    let fixture = pa_ai_be_fixture();

    let top = fixture.listing("");
    for name in [".idea", "dist", "node_modules", "storage", "local-notes.md"] {
        assert!(ignored_flag(&top, name), "{name} must be flagged ignored");
    }
    for name in [".gitsecret", ".vscode", "src", ".gitignore", "package.json"] {
        assert!(!ignored_flag(&top, name), "{name} must not be flagged");
    }

    let src = fixture.listing("src");
    assert!(ignored_flag(&src, "environment.ts"));
    assert!(ignored_flag(&src, "environment.prod.ts"));
    assert!(!ignored_flag(&src, "environment.prod.ts.secret"));
    assert!(!ignored_flag(&src, "environment.sample.ts"));
    assert!(!ignored_flag(&src, "index.ts"));

    let generated = fixture.listing("src/generated");
    assert!(ignored_flag(&generated, "api.gen.ts"));
    assert!(!ignored_flag(&generated, "keep.gen.ts"));

    assert!(ignored_flag(
        &fixture.listing("node_modules/express"),
        "index.js"
    ));
}

#[test]
fn only_the_git_directory_is_hidden_by_the_shared_listing() {
    let fixture = pa_ai_be_fixture();
    fixture
        .dir(".svn")
        .write(".DS_Store", "")
        .write("Thumbs.db", "");

    let names = fixture
        .listing("")
        .into_iter()
        .map(|(name, _)| name)
        .collect::<Vec<_>>();
    assert!(!names.iter().any(|name| name == ".git"), "{names:?}");
    for listed in [".svn", ".DS_Store", "Thumbs.db"] {
        assert!(names.iter().any(|name| name == listed), "{listed}");
    }
}

#[test]
fn children_of_an_ignored_directory_cannot_be_reincluded_by_a_nested_gitignore() {
    let fixture = Fixture::new("reinclude");
    fixture
        .write(".gitignore", "build/\n")
        .write("build/.gitignore", "!*\n")
        .write("build/out.js", "");

    assert!(ignored_flag(&fixture.listing("build"), "out.js"));
}

#[test]
fn gitignore_takes_precedence_over_info_exclude() {
    let fixture = Fixture::new("precedence");
    fixture
        .write(".git/info/exclude", "local.txt\nscratch.txt\n")
        .write(".gitignore", "!local.txt\n")
        .write("local.txt", "")
        .write("scratch.txt", "");

    let top = fixture.listing("");
    assert!(!ignored_flag(&top, "local.txt"));
    assert!(ignored_flag(&top, "scratch.txt"));
}

#[test]
fn directory_only_patterns_do_not_flag_files_with_the_same_name() {
    let fixture = Fixture::new("directory-only");
    fixture
        .write(".gitignore", "logs/\n")
        .write("logs", "")
        .dir("src/logs");

    assert!(!ignored_flag(&fixture.listing(""), "logs"));
    assert!(ignored_flag(&fixture.listing("src"), "logs"));
}

#[test]
fn worktree_git_file_and_fifo_gitignore_are_treated_as_absent() {
    let fixture = pa_ai_be_fixture();
    fs::remove_dir_all(fixture.root.join(".git")).unwrap();
    fixture.write(".git", "gitdir: /elsewhere/.git/worktrees/app\n");
    let fifo = CString::new(fixture.root.join("src/.gitignore").as_os_str().as_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);

    let src = fixture.listing("src");
    assert!(ignored_flag(&src, "environment.ts"));
    assert!(!ignored_flag(&src, "index.ts"));
    assert!(!ignored_flag(&fixture.listing(""), "local-notes.md"));
}

#[test]
fn pattern_case_follows_the_workspace_filesystem() {
    let fixture = Fixture::new("pattern-case");
    fixture.write(".gitignore", "Build/\n").dir("build");

    assert_eq!(
        ignored_flag(&fixture.listing(""), "build"),
        fixture.case_insensitive()
    );
}

#[test]
fn oversized_ignore_rules_fail_closed_to_an_undecorated_listing() {
    let fixture = Fixture::new("oversized");
    let oversized = format!(
        "secret.txt\n{}",
        "#".repeat(ignore_decoration::GITIGNORE_BYTE_LIMIT as usize + 1)
    );
    fixture
        .write("secret.txt", "")
        .write(".gitignore", &oversized);

    let top = fixture.listing("");
    assert!(!ignored_flag(&top, "secret.txt"));
    assert!(!ignored_flag(&top, ".gitignore"));
}

#[test]
fn ignore_rules_beyond_the_line_limit_fail_closed_to_an_undecorated_listing() {
    let fixture = Fixture::new("line-limit");
    let mut rules = "secret.txt\n".to_string();
    rules.push_str(&"#\n".repeat(ignore_decoration::GITIGNORE_LINE_LIMIT));
    fixture.write("secret.txt", "").write(".gitignore", &rules);

    assert!(!ignored_flag(&fixture.listing(""), "secret.txt"));
}

#[test]
fn symlinked_gitignore_is_not_followed() {
    let fixture = Fixture::new("symlinked-gitignore");
    let outside = Fixture::new("symlinked-gitignore-outside");
    outside.write("rules", "*\n");
    symlink(outside.root.join("rules"), fixture.root.join(".gitignore")).unwrap();
    fixture.write("index.ts", "");

    assert!(!ignored_flag(&fixture.listing(""), "index.ts"));
}

#[test]
fn nested_repository_ignored_files_are_listed_and_flagged_by_their_own_gitignore() {
    let fixture = Fixture::new("nested-repository");
    fixture
        .write(".DS_Store", "")
        .write("docker-compose.yml", "")
        .write("pa-data-be/.git/HEAD", "ref: refs/heads/main\n")
        .write(
            "pa-data-be/.gitignore",
            "node_modules/\nsrc/environment.ts\nsrc/environment.prod.ts\n",
        )
        .write("pa-data-be/node_modules/express/index.js", "")
        .write("pa-data-be/src/environment.prod.ts", "")
        .write("pa-data-be/src/environment.prod.ts.secret", "")
        .write("pa-data-be/src/environment.sample.ts", "")
        .write("pa-data-be/src/environment.ts", "")
        .write("pa-data-be/src/index.ts", "");

    let root = fixture.listing("");
    assert!(!ignored_flag(&root, "pa-data-be"));
    let repository = fixture.listing("pa-data-be");
    assert!(ignored_flag(&repository, "node_modules"));
    assert!(!repository.iter().any(|(name, _)| name == ".git"));
    let src = fixture.listing("pa-data-be/src");
    assert_eq!(src.len(), 5, "{src:?}");
    assert!(ignored_flag(&src, "environment.ts"));
    assert!(ignored_flag(&src, "environment.prod.ts"));
    assert!(!ignored_flag(&src, "environment.prod.ts.secret"));
    assert!(!ignored_flag(&src, "environment.sample.ts"));
    assert!(!ignored_flag(&src, "index.ts"));
}

#[test]
fn outer_repository_rules_stop_at_a_nested_repository_boundary() {
    let fixture = Fixture::new("nested-boundary");
    fixture
        .write(".git/HEAD", "ref: refs/heads/main\n")
        .write(".git/info/exclude", "notes.txt\n")
        .write(".gitignore", "*.log\n")
        .write("debug.log", "")
        .write("notes.txt", "")
        .write("inner/.git/HEAD", "ref: refs/heads/main\n")
        .write("inner/.git/info/exclude", "scratch.txt\n")
        .write("inner/.gitignore", "*.tmp\n")
        .write("inner/debug.log", "")
        .write("inner/notes.txt", "")
        .write("inner/scratch.txt", "")
        .write("inner/cache.tmp", "")
        .write("inner/sub/debug.log", "")
        .write("inner/sub/cache.tmp", "");

    let top = fixture.listing("");
    assert!(ignored_flag(&top, "debug.log"));
    assert!(ignored_flag(&top, "notes.txt"));
    let inner = fixture.listing("inner");
    assert!(!ignored_flag(&inner, "debug.log"));
    assert!(!ignored_flag(&inner, "notes.txt"));
    assert!(ignored_flag(&inner, "scratch.txt"));
    assert!(ignored_flag(&inner, "cache.tmp"));
    let sub = fixture.listing("inner/sub");
    assert!(!ignored_flag(&sub, "debug.log"));
    assert!(ignored_flag(&sub, "cache.tmp"));
}

#[test]
fn worktree_style_git_file_marks_a_nested_repository_boundary() {
    let fixture = Fixture::new("nested-git-file");
    fixture
        .write(".gitignore", "*.log\n")
        .write("linked/.git", "gitdir: /elsewhere/.git/worktrees/linked\n")
        .write("linked/debug.log", "");

    assert!(!ignored_flag(&fixture.listing("linked"), "debug.log"));
}

#[test]
fn a_nested_repository_inside_an_ignored_directory_stays_ignored() {
    let fixture = Fixture::new("nested-ignored");
    fixture
        .write(".gitignore", "node_modules/\n")
        .write("node_modules/pkg/.git/HEAD", "ref: refs/heads/main\n")
        .write("node_modules/pkg/index.js", "");

    assert!(ignored_flag(&fixture.listing(""), "node_modules"));
    assert!(ignored_flag(
        &fixture.listing("node_modules/pkg"),
        "index.js"
    ));
}

#[test]
fn a_nested_repository_ignored_by_the_outer_repository_uses_its_own_rules() {
    let fixture = Fixture::new("nested-outer-ignored");
    fixture
        .write(".git/HEAD", "ref: refs/heads/main\n")
        .write(".gitignore", "vendor/\n")
        .write("vendor/lib/.git/HEAD", "ref: refs/heads/main\n")
        .write("vendor/lib/.gitignore", "*.gen.ts\n")
        .write("vendor/lib/index.ts", "")
        .write("vendor/lib/api.gen.ts", "")
        .write("vendor/lib/src/main.ts", "")
        .write("vendor/other/index.ts", "");

    assert!(ignored_flag(&fixture.listing(""), "vendor"));
    let vendor = fixture.listing("vendor");
    assert!(ignored_flag(&vendor, "lib"));
    assert!(ignored_flag(&vendor, "other"));
    assert!(ignored_flag(&fixture.listing("vendor/other"), "index.ts"));
    let lib = fixture.listing("vendor/lib");
    assert!(!ignored_flag(&lib, "index.ts"));
    assert!(ignored_flag(&lib, "api.gen.ts"));
    assert!(!ignored_flag(&fixture.listing("vendor/lib/src"), "main.ts"));
}

#[test]
fn symlinked_or_fifo_git_markers_do_not_create_a_repository_boundary() {
    let fixture = Fixture::new("marker-symlink");
    let outside = Fixture::new("marker-symlink-outside");
    outside.write("repo/.git/HEAD", "ref: refs/heads/main\n");
    fixture
        .write(".gitignore", "*.log\n")
        .write("linked/debug.log", "")
        .write("piped/debug.log", "");
    symlink(
        outside.root.join("repo/.git"),
        fixture.root.join("linked/.git"),
    )
    .unwrap();
    let fifo = CString::new(fixture.root.join("piped/.git").as_os_str().as_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);

    assert!(ignored_flag(&fixture.listing("linked"), "debug.log"));
    assert!(ignored_flag(&fixture.listing("piped"), "debug.log"));
}

#[test]
fn unscanned_dependency_folder_matching_follows_the_workspace_filesystem_case() {
    let fixture = Fixture::new("unscanned-case");
    fixture
        .write(".gitignore", "Node_Modules/\n")
        .write("Node_Modules/pkg/.git/HEAD", "ref: refs/heads/main\n")
        .write("Node_Modules/pkg/index.js", "");

    assert_eq!(
        ignored_flag(&fixture.listing("Node_Modules/pkg"), "index.js"),
        fixture.case_insensitive()
    );
}
