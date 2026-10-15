#[cfg(test)]
use crate::file_fuzzy_matcher::compare_ranked_paths;
#[cfg(test)]
use std::os::fd::AsRawFd;

use crate::workspace_registry::WorkspaceRegistry;
use std::{
    ffi::{CStr, CString},
    fs::File,
    io,
    os::fd::{FromRawFd, RawFd},
};

mod atomic_create;
mod contracts;
mod descriptor_admission;
mod directory_stream;
mod entry_mutation_primitives;
mod file_index;
mod mutation_settlement;
mod search_policy;
mod workspace_file_search;
#[cfg(test)]
#[path = "workspace_file_commands/workspace_search_tests.rs"]
mod workspace_search_tests;

pub use contracts::{
    DescriptorFileEntry, DescriptorFileSearchResponse, DescriptorFileSearchResult,
    FileCommandResult, FileRevision, MutationResult,
};
use descriptor_admission::*;
use directory_stream::{DirectoryEntry, DirectoryStream, DirectoryStreamEntry};
use entry_mutation_primitives::*;
pub use file_index::WorkspaceFileIndexCache;
use search_policy::entry_rank;
use workspace_file_search::PreparedDescriptorFileSearch;
#[cfg(test)]
use workspace_file_search::{
    collect_ranked_files, collect_ranked_files_with_truncation, file_score,
};

#[cfg(target_os = "macos")]
const RENAME_EXCL: libc::c_uint = 0x0000_0004;
const WORKSPACE_FILE_SEARCH_VISITED_LIMIT: usize = 200_000;

#[cfg(target_os = "macos")]
fn clear_errno() {
    unsafe {
        *libc::__error() = 0;
    }
}

#[cfg(target_os = "linux")]
fn clear_errno() {
    unsafe {
        *libc::__errno_location() = 0;
    }
}

fn directory_entries(directory: &File) -> io::Result<Vec<DirectoryEntry>> {
    let mut stream = DirectoryStream::open(directory)?;
    let mut entries = Vec::new();
    loop {
        match stream.next_entry(directory)? {
            DirectoryStreamEntry::Entry(entry) => entries.push(entry),
            DirectoryStreamEntry::Skipped => {}
            DirectoryStreamEntry::End => break,
        }
    }
    Ok(entries)
}

pub struct WorkspaceFileRepository<'a> {
    registry: &'a WorkspaceRegistry,
}

mod repository;

enum CommandFailure {
    Conflict(String),
    Partial(String, Option<FileRevision>),
    Io(io::Error),
}

enum MutationFailure {
    Partial(String),
    Io(io::Error),
}
impl From<io::Error> for MutationFailure {
    fn from(value: io::Error) -> Self {
        Self::Io(value)
    }
}
fn mutation_result(result: Result<(), MutationFailure>) -> MutationResult {
    match result {
        Ok(()) => MutationResult::Success,
        Err(MutationFailure::Partial(message)) => MutationResult::Partial { message },
        Err(MutationFailure::Io(error)) => MutationResult::Error {
            message: error.to_string(),
        },
    }
}

fn unique_quarantine_name(parent: RawFd, target: &CStr) -> io::Result<CString> {
    for _ in 0..128_u32 {
        let mut random = [0_u8; 16];
        if unsafe { libc::getentropy(random.as_mut_ptr().cast(), random.len()) } != 0 {
            return Err(io::Error::last_os_error());
        }
        let token = random
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let name = CString::new(format!(
            ".{}.rename-{token}",
            String::from_utf8_lossy(target.to_bytes())
        ))
        .unwrap();
        match stat_at(parent, &name) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(name),
            Ok(_) => {}
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not allocate a unique rename quarantine",
    ))
}

#[cfg(not(test))]
fn run_test_hook(_event: &str, _parent: RawFd, _first: &CStr, _second: &CStr) {}

#[cfg(test)]
type TestHookCallback = Box<dyn FnOnce(&str, RawFd, &CStr, &CStr)>;

#[cfg(test)]
thread_local! {
    static TEST_HOOK: std::cell::RefCell<Option<(&'static str, TestHookCallback)>> =
        std::cell::RefCell::new(None);
}

#[cfg(test)]
fn run_test_hook(event: &str, parent: RawFd, first: &CStr, second: &CStr) {
    TEST_HOOK.with(|hook| {
        if hook
            .borrow()
            .as_ref()
            .is_none_or(|(expected, _)| *expected != event)
        {
            return;
        }
        if let Some((_, callback)) = hook.borrow_mut().take() {
            callback(event, parent, first, second);
        }
    });
}

fn create_unique_file(
    parent: RawFd,
    target: &CStr,
    mode: libc::mode_t,
) -> io::Result<(File, CString)> {
    for _ in 0..128_u32 {
        let mut random = [0_u8; 16];
        if unsafe { libc::getentropy(random.as_mut_ptr().cast(), random.len()) } != 0 {
            return Err(io::Error::last_os_error());
        }
        let token = random
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let name = CString::new(format!(
            ".{}.save-{token}",
            String::from_utf8_lossy(target.to_bytes()),
        ))
        .unwrap();
        let fd = unsafe {
            libc::openat(
                parent,
                name.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC | libc::O_NOFOLLOW,
                (mode & 0o7777) as libc::c_uint,
            )
        };
        if fd >= 0 {
            return Ok((unsafe { File::from_raw_fd(fd) }, name));
        }
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::AlreadyExists {
            return Err(error);
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not allocate a unique save file",
    ))
}

fn rename_at(
    from_parent: RawFd,
    from: &CStr,
    to_parent: RawFd,
    to: &CStr,
    exclusive: bool,
) -> io::Result<()> {
    let result = if exclusive {
        rename_with_flags(from_parent, from, to_parent, to, rename_no_replace_flag())
    } else {
        unsafe { libc::renameat(from_parent, from.as_ptr(), to_parent, to.as_ptr()) }
    };
    if result != 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn rename_with_flags(
    from_parent: RawFd,
    from: &CStr,
    to_parent: RawFd,
    to: &CStr,
    flags: libc::c_uint,
) -> libc::c_int {
    unsafe { libc::renameatx_np(from_parent, from.as_ptr(), to_parent, to.as_ptr(), flags) }
}

#[cfg(target_os = "linux")]
fn rename_with_flags(
    from_parent: RawFd,
    from: &CStr,
    to_parent: RawFd,
    to: &CStr,
    flags: libc::c_uint,
) -> libc::c_int {
    unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            from_parent,
            from.as_ptr(),
            to_parent,
            to.as_ptr(),
            flags,
        ) as libc::c_int
    }
}

#[cfg(target_os = "macos")]
fn rename_no_replace_flag() -> libc::c_uint {
    RENAME_EXCL
}

#[cfg(target_os = "linux")]
fn rename_no_replace_flag() -> libc::c_uint {
    libc::RENAME_NOREPLACE
}

struct TempCleanup {
    parent: RawFd,
    name: CString,
    expected: libc::stat,
    armed: bool,
}
impl TempCleanup {
    fn finish_before_return(&mut self) -> Result<(), String> {
        self.armed = false;
        cleanup_owned_entry_by_identity(
            self.parent,
            &self.name,
            &self.expected,
            0,
            "temporary-save-before-cleanup-isolation",
        )
    }
}
impl Drop for TempCleanup {
    fn drop(&mut self) {
        if self.armed {
            let _ = cleanup_owned_entry_by_identity(
                self.parent,
                &self.name,
                &self.expected,
                0,
                "temporary-save-before-cleanup-isolation",
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace_registry::WorkspaceId;
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::Arc,
    };

    fn fixture(label: &str) -> (Arc<WorkspaceRegistry>, WorkspaceId, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "mockor-file-commands-{label}-{}-{}",
            std::process::id(),
            rand_suffix()
        ));
        fs::create_dir_all(&root).unwrap();
        let registry = Arc::new(WorkspaceRegistry::new());
        let id = registry.register(&root).unwrap().workspace_id;
        (registry, id, root)
    }

    fn rand_suffix() -> u64 {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(1);
        NEXT.fetch_add(1, Ordering::Relaxed)
    }

    #[test]
    fn file_revision_preserves_u64_values_across_json_roundtrip() {
        let revision = FileRevision {
            device: 9_007_199_254_740_993,
            inode: 18_436_989_904_237_926_844,
            size: 42,
            modified_seconds: 1_700_000_000,
            modified_nanoseconds: 123_456_789,
            content_hash: u64::MAX,
        };

        let payload = serde_json::to_value(&revision).unwrap();

        assert_eq!(payload["device"], "9007199254740993");
        assert_eq!(payload["inode"], "18436989904237926844");
        assert_eq!(payload["contentHash"], "18446744073709551615");
        assert_eq!(
            serde_json::from_value::<FileRevision>(payload).unwrap(),
            revision
        );
    }

    #[test]
    fn descriptor_file_search_supports_and_ranks_fuzzy_queries() {
        let cases = [
            (
                "uc",
                vec![
                    "src/Http/Controllers/UserController.php",
                    "src/ProductController.php",
                ],
            ),
            ("usrctrl", vec!["src/Http/Controllers/UserController.php"]),
            (
                "user controller",
                vec!["src/Http/Controllers/UserController.php"],
            ),
            ("USER", vec!["src/Http/Controllers/UserController.php"]),
            ("*.php", vec![]),
            (
                "controller",
                vec![
                    "src/Http/Controllers/UserController.php",
                    "very/deep/AdminController.php",
                    "src/ProductController.php",
                    "controller/a.php",
                ],
            ),
        ];

        for (index, (query, expected)) in cases.into_iter().enumerate() {
            let (registry, id, root) = fixture(&format!("fuzzy-search-{index}"));
            fs::create_dir_all(root.join("src/Http/Controllers")).unwrap();
            fs::create_dir_all(root.join("very/deep")).unwrap();
            fs::create_dir_all(root.join("controller")).unwrap();
            fs::write(root.join("src/Http/Controllers/UserController.php"), "").unwrap();
            fs::write(root.join("src/ProductController.php"), "").unwrap();
            fs::write(root.join("very/deep/AdminController.php"), "").unwrap();
            fs::write(root.join("controller/a.php"), "").unwrap();
            let repository = WorkspaceFileRepository::new(&registry);

            let paths = repository
                .search_files(&id, Path::new(""), query, 20)
                .unwrap()
                .into_iter()
                .map(|result| result.relative_path)
                .collect::<Vec<_>>();

            assert_eq!(paths, expected, "query={query:?}");
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn descriptor_file_search_keeps_empty_query_and_shallow_ordering() {
        let (registry, id, root) = fixture("fuzzy-search-empty");
        fs::create_dir_all(root.join("deep/path")).unwrap();
        fs::write(root.join("a.php"), "").unwrap();
        fs::write(root.join("deep/path/a.php"), "").unwrap();
        let repository = WorkspaceFileRepository::new(&registry);

        let paths = repository
            .search_files(&id, Path::new(""), "", 20)
            .unwrap()
            .into_iter()
            .map(|result| result.relative_path)
            .collect::<Vec<_>>();

        assert_eq!(paths, vec!["a.php", "deep/path/a.php"]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn descriptor_file_search_scores_matches_beyond_the_initial_scan_window() {
        let (registry, id, root) = fixture("fuzzy-search-full-traversal");
        for index in 0..11 {
            fs::write(root.join(format!("unrelated-{index:02}.txt")), "").unwrap();
        }
        fs::create_dir_all(root.join("deep/path")).unwrap();
        fs::write(root.join("deep/path/needle"), "").unwrap();
        let repository = WorkspaceFileRepository::new(&registry);

        let paths = repository
            .search_files(&id, Path::new(""), "needle", 1)
            .unwrap()
            .into_iter()
            .map(|result| result.relative_path)
            .collect::<Vec<_>>();

        assert_eq!(paths, vec!["deep/path/needle"]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn bounded_descriptor_file_search_matches_exhaustive_ranking() {
        let (registry, id, root) = fixture("fuzzy-search-bounded-ranking");
        let paths = [
            "ControllerGuide.php",
            "ProductController.php",
            "UserController.php",
            "controller/a.php",
            "docs/controller-notes.md",
            "src/AdminController.php",
            "src/Http/Controllers/UserController.php",
            "src/unrelated.txt",
            "very/deep/AdminController.php",
        ];
        for relative in paths {
            let path = root.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "").unwrap();
        }
        let root_file = registry.clone_root(&id).unwrap();
        let display_root = registry.descriptor(&id).unwrap().canonical_root_path;

        let actual = collect_ranked_files(
            &root_file,
            Path::new(""),
            "controller",
            4,
            WORKSPACE_FILE_SEARCH_VISITED_LIMIT,
            &display_root,
        )
        .unwrap();
        let mut expected = paths
            .into_iter()
            .filter_map(|path| Some((PathBuf::from(path), file_score(path, "controller")?)))
            .collect::<Vec<_>>();
        expected.sort_by(|(left_path, left_rank), (right_path, right_rank)| {
            compare_ranked_paths(
                &left_path.to_string_lossy(),
                *left_rank,
                &right_path.to_string_lossy(),
                *right_rank,
            )
        });
        expected.truncate(4);

        assert_eq!(actual, expected);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn ranked_file_search_counts_directories_toward_the_visited_limit() {
        let (registry, id, root) = fixture("fuzzy-search-directory-cap");
        fs::create_dir_all(root.join("a/b/c/d/e")).unwrap();
        fs::write(root.join("a/b/c/d/e/needle.php"), "").unwrap();
        let root_file = registry.clone_root(&id).unwrap();
        let display_root = registry.descriptor(&id).unwrap().canonical_root_path;

        let capped =
            collect_ranked_files(&root_file, Path::new(""), "needle", 10, 3, &display_root)
                .unwrap();
        assert!(capped.is_empty());
        let (_, truncated) = collect_ranked_files_with_truncation(
            &root_file,
            Path::new(""),
            "needle",
            10,
            3,
            &display_root,
            &|| true,
        )
        .unwrap();
        assert!(truncated);

        let uncapped = collect_ranked_files(
            &root_file,
            Path::new(""),
            "needle",
            10,
            WORKSPACE_FILE_SEARCH_VISITED_LIMIT,
            &display_root,
        )
        .unwrap();
        assert_eq!(uncapped.len(), 1);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn descriptor_file_score_preserves_exact_and_prefix_tiers() {
        let cases = [
            (
                "very/deep/UserController.php",
                "UserController.php.bak",
                "UserController.php",
            ),
            (
                "very/deep/ControllerGuide.php",
                "a/AdminController.php",
                "controller",
            ),
        ];

        for (better, worse, query) in cases {
            assert!(
                compare_ranked_paths(
                    better,
                    file_score(better, query).unwrap(),
                    worse,
                    file_score(worse, query).unwrap(),
                )
                .is_lt(),
                "expected {better:?} to outrank {worse:?} for {query:?}"
            );
        }
    }

    fn install_hook(
        event: &'static str,
        callback: impl FnOnce(&str, RawFd, &CStr, &CStr) + 'static,
    ) {
        TEST_HOOK.with(|hook| *hook.borrow_mut() = Some((event, Box::new(callback))));
    }

    fn count_descriptors_for(file: &File) -> usize {
        let expected = fstat(file.as_raw_fd()).unwrap();
        (0..unsafe { libc::getdtablesize() })
            .filter(|fd| {
                let mut current = unsafe { std::mem::zeroed() };
                (unsafe { libc::fstat(*fd, &mut current) == 0 })
                    && same_identity(&expected, &current)
            })
            .count()
    }

    #[test]
    fn directory_entries_closes_stream_when_child_disappears_before_stat() {
        let (_, _, root) = fixture("directory-entries-stat-failure");
        fs::write(root.join("child"), "value").unwrap();
        let directory = File::open(&root).unwrap();
        let descriptors_before = count_descriptors_for(&directory);
        install_hook(
            "directory-entries-before-stat",
            |event, parent, child, _| {
                assert_eq!(event, "directory-entries-before-stat");
                assert_eq!(unsafe { libc::unlinkat(parent, child.as_ptr(), 0) }, 0);
            },
        );

        let error = match directory_entries(&directory) {
            Ok(_) => panic!("directory enumeration unexpectedly succeeded"),
            Err(error) => error,
        };
        assert_eq!(error.kind(), io::ErrorKind::NotFound);
        assert_eq!(count_descriptors_for(&directory), descriptors_before);
    }

    #[test]
    fn recursively_creates_directories() {
        let (registry, id, root) = fixture("mkdirs");
        let repository = WorkspaceFileRepository::new(&registry);
        assert!(matches!(
            repository.create_directory(&id, Path::new("one/two/three")),
            MutationResult::Success
        ));
        assert!(root.join("one/two/three").is_dir());
    }

    #[test]
    fn recursive_create_reports_partial_after_first_mutation() {
        let (registry, id, root) = fixture("mkdir-partial");
        install_hook(
            "create-directory-after-mkdir",
            |event, parent, created, _| {
                assert_eq!(event, "create-directory-after-mkdir");
                assert_eq!(
                    unsafe { libc::unlinkat(parent, created.as_ptr(), libc::AT_REMOVEDIR) },
                    0
                );
            },
        );
        assert!(matches!(
            WorkspaceFileRepository::new(&registry).create_directory(&id, Path::new("one/two")),
            MutationResult::Partial { .. }
        ));
        assert!(!root.join("one").exists());
    }

    #[test]
    fn descriptor_reads_skip_symlinks_and_respect_limits() {
        use std::os::unix::fs::symlink;
        let (registry, id, root) = fixture("scoped-reads");
        fs::create_dir(root.join("src")).unwrap();
        fs::write(root.join("src/one.php"), "needle one").unwrap();
        fs::write(root.join("src/two.php"), "needle two").unwrap();
        let (_outside_registry, _outside_id, outside) = fixture("scoped-reads-outside");
        fs::write(outside.join("secret.php"), "needle secret").unwrap();
        symlink(outside.join("secret.php"), root.join("linked.php")).unwrap();
        symlink(&outside, root.join("linked-dir")).unwrap();
        let repository = WorkspaceFileRepository::new(&registry);

        let listing = repository.read_directory(&id, Path::new("")).unwrap();
        let payload = serde_json::to_string(&listing).unwrap();
        assert!(!payload.contains(&root.to_string_lossy().to_string()));
        assert!(payload.contains("relativePath"));
        assert_eq!(
            listing
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<Vec<_>>(),
            vec!["src"]
        );
        let files = repository
            .search_files(&id, Path::new(""), "php", 1)
            .unwrap();
        assert_eq!(files.len(), 1);
        assert!(!files[0].relative_path.contains("linked"));
    }

    #[test]
    fn descriptor_reads_reject_unknown_and_do_not_cross_workspaces() {
        let (first_registry, first_id, first_root) = fixture("read-first");
        let (_second_registry, second_id, second_root) = fixture("read-second");
        fs::write(first_root.join("first.txt"), "first").unwrap();
        fs::write(second_root.join("second.txt"), "second").unwrap();
        let first = WorkspaceFileRepository::new(&first_registry);
        assert!(first.read_directory(&second_id, Path::new("")).is_err());
        assert!(first
            .search_files(&second_id, Path::new(""), "second", 10)
            .is_err());
        assert_eq!(
            first
                .search_files(&first_id, Path::new(""), "second", 10)
                .unwrap()
                .len(),
            0
        );
    }

    #[test]
    fn nested_gitignore_is_descriptor_read_and_invalid_content_fails_closed() {
        let (registry, id, root) = fixture("nested-ignore");
        fs::create_dir_all(root.join("src/cache")).unwrap();
        fs::write(root.join("src/.gitignore"), "cache/\n*.secret\n").unwrap();
        fs::write(root.join("src/cache/hidden.php"), "needle").unwrap();
        fs::write(root.join("src/hidden.secret"), "needle").unwrap();
        fs::write(root.join("src/visible.php"), "needle").unwrap();
        let repository = WorkspaceFileRepository::new(&registry);
        let results = repository
            .search_files(&id, Path::new("src"), "", 20)
            .unwrap();
        let paths = results
            .iter()
            .map(|result| result.relative_path.as_str())
            .collect::<Vec<_>>();
        assert!(paths.contains(&"visible.php"));
        assert!(!paths
            .iter()
            .any(|path| path.contains("cache") || path.ends_with(".secret")));

        fs::write(root.join("src/.gitignore"), [0xff, 0xfe]).unwrap();
        assert!(repository
            .search_files(&id, Path::new("src"), "", 20)
            .is_err());
    }
}
