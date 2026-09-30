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
