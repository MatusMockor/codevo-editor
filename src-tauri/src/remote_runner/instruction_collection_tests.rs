use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "codevo-instructions-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn write(&self, path: &str, content: &str) {
        let file = self.0.join(path);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, content).unwrap();
    }
    fn snapshot(&self) -> Result<InstructionSnapshot, String> {
        collect(
            &self.0.join("global"),
            Some(&fs::open_root(&self.0.join("project"))?),
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn includes_ignored_nested_rules_and_relative_imports_without_credentials() {
    let fixture = Fixture::new();
    fixture.write("global/CLAUDE.md", "@rules/general.md");
    fixture.write("global/rules/general.md", "global rules");
    fixture.write("global/settings.json", "secret");
    fixture.write("project/.gitignore", "CLAUDE.local.md");
    fixture.write("project/CLAUDE.md", "@docs/style.md");
    fixture.write("project/docs/style.md", "@../CLAUDE.md");
    fixture.write("project/CLAUDE.local.md", "local rules");
    fixture.write("project/nested/.claude/rules/code.md", "nested rules");
    fixture.write("project/node_modules/pkg/CLAUDE.md", "excluded");
    let snapshot = fixture.snapshot().unwrap();
    assert_eq!(snapshot.files.len(), 6);
    assert!(!snapshot
        .files
        .iter()
        .any(|f| f.content == "secret" || f.content == "excluded"));
}

#[test]
fn rejects_external_and_non_markdown_imports() {
    for import in [
        "@../secret.md",
        "@/tmp/secret.md",
        "@~/.claude/secret.md",
        "@.env",
    ] {
        let fixture = Fixture::new();
        fixture.write("project/CLAUDE.md", import);
        assert!(fixture.snapshot().is_err(), "{import}");
    }
}

#[test]
fn ignores_imports_inside_code() {
    assert_eq!(
        imports("`@secret`\n```\n@secret\n```\n@rules.md").unwrap(),
        vec!["rules.md"]
    );
}

#[test]
fn rejects_symlink_instruction_and_import() {
    for path in ["CLAUDE.md", "import.md"] {
        let fixture = Fixture::new();
        fixture.write("outside.md", "secret");
        fixture.write("project/CLAUDE.md", "@import.md");
        let link = fixture.0.join("project").join(path);
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink(fixture.0.join("outside.md"), link).unwrap();
        assert!(fixture.snapshot().is_err());
    }
}

#[test]
fn enforces_size_and_count_limits() {
    let fixture = Fixture::new();
    fixture.write("project/CLAUDE.md", &"a".repeat(65537));
    assert!(fixture.snapshot().is_err());
    fixture.write("project/CLAUDE.md", "root");
    for i in 0..128 {
        fixture.write(&format!("project/.claude/rules/{i}.md"), "rule");
    }
    assert!(fixture.snapshot().is_err());
}

#[test]
fn rejects_non_utf8_and_unsafe_paths() {
    let fixture = Fixture::new();
    fixture.write("project/CLAUDE.md", "");
    std::fs::write(fixture.0.join("project/CLAUDE.md"), [0xff]).unwrap();
    assert!(fixture.snapshot().is_err());
    assert!(safe_path(Path::new("a/../b.md")).is_err());
    assert!(safe_path(Path::new("a\\b.md")).is_err());
}

#[test]
fn captures_only_registered_directory_after_path_replacement() {
    let fixture = Fixture::new();
    fixture.write("project/CLAUDE.md", "authorized");
    let root = fs::open_root(&fixture.0.join("project")).unwrap();
    std::fs::rename(fixture.0.join("project"), fixture.0.join("previous")).unwrap();
    fixture.write("project/CLAUDE.md", "replacement");
    let snapshot = collect(&fixture.0.join("global"), Some(&root)).unwrap();
    assert_eq!(snapshot.files[0].content, "authorized");
}

#[test]
fn supports_quoted_import_and_repeated_descriptor_collection() {
    let fixture = Fixture::new();
    fixture.write("project/CLAUDE.md", "@\"docs/my rules.md\"");
    fixture.write("project/docs/my rules.md", "rules");
    let root = fs::open_root(&fixture.0.join("project")).unwrap();
    for _ in 0..2 {
        assert_eq!(
            collect(&fixture.0.join("global"), Some(&root))
                .unwrap()
                .files
                .len(),
            2
        );
    }
}

#[test]
fn revalidation_detects_file_edits_and_directory_additions() {
    let fixture = Fixture::new();
    fixture.write("project/CLAUDE.md", "before");
    let root = Arc::new(fs::open_root(&fixture.0.join("project")).unwrap());
    let (_, file_stamp) = fs::read(&root, Path::new("CLAUDE.md")).unwrap();
    fixture.write("project/CLAUDE.md", "after!");
    assert!(file_stamp.validate().is_err());
    let directory_stamp = fs::Stamp::capture_directory(&root, Path::new(""), &root).unwrap();
    fixture.write("project/CLAUDE.local.md", "new rules");
    assert!(directory_stamp.validate().is_err());
}

#[test]
fn concurrent_scans_have_independent_directory_offsets() {
    let fixture = Fixture::new();
    for index in 0..100 {
        fixture.write(&format!("project/{index}.md"), "rule");
    }
    let root = Arc::new(fs::open_root(&fixture.0.join("project")).unwrap());
    std::thread::scope(|scope| {
        let mut handles = Vec::new();
        for _ in 0..4 {
            let root = root.clone();
            handles.push(scope.spawn(move || {
                for _ in 0..20 {
                    assert_eq!(fs::names(&root, 100).unwrap().len(), 100);
                }
            }));
        }
        for handle in handles {
            handle.join().unwrap();
        }
    });
}

#[test]
fn rejects_expired_collection_deadline() {
    assert!(check_deadline(Instant::now() - Duration::from_secs(1)).is_err());
}

#[test]
fn import_stamp_rejects_replaced_unscanned_global_ancestor() {
    let fixture = Fixture::new();
    fixture.write("global/docs/nested/helper.md", "original rules");
    let root = Arc::new(fs::open_root(&fixture.0.join("global")).unwrap());
    let (_, stamp) = fs::read(&root, Path::new("docs/nested/helper.md")).unwrap();
    std::fs::rename(
        fixture.0.join("global/docs/nested"),
        fixture.0.join("global/docs/previous"),
    )
    .unwrap();
    fixture.write("global/docs/nested/helper.md", "replacement rules");
    assert!(stamp.validate().is_err());
}
