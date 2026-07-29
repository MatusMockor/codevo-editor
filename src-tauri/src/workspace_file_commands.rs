#[cfg(test)]
use crate::file_fuzzy_matcher::compare_ranked_paths;
use crate::local_history::LocalHistoryStore;
use crate::workspace_registry::WorkspaceRegistry;
use std::{
    ffi::{CStr, CString},
    fs::File,
    io,
    os::fd::{AsRawFd, FromRawFd, RawFd},
};

mod atomic_create;
mod atomic_save;
mod contracts;
mod descriptor_admission;
mod directory_stream;
mod image_read;
mod mutation_settlement;
mod search_policy;
mod workspace_file_search;
#[cfg(test)]
#[path = "workspace_file_commands/workspace_search_tests.rs"]
mod workspace_search_tests;

pub use contracts::{
    DescriptorFileEntry, DescriptorFileSearchResponse, DescriptorFileSearchResult,
    DescriptorTextSearchResponse, DescriptorTextSearchResult, FileCommandResult, FileRevision,
    MutationResult, ReplaceFileFailure, ReplaceFileResult, WorkspaceEditResult, WorkspaceImageFile,
    WorkspaceImageReadError, WorkspaceReplaceResult, WorkspaceTextFile,
};
use descriptor_admission::*;
use directory_stream::{DirectoryEntry, DirectoryStream, DirectoryStreamEntry};
pub use image_read::read_image_from_root;
use search_policy::{collect_files, entry_rank, file_mask, replace_text, text_matcher};
#[cfg(test)]
use workspace_file_search::{
    collect_ranked_files, collect_ranked_files_with_truncation, file_score,
};
use workspace_file_search::{PreparedDescriptorFileSearch, PreparedDescriptorTextSearch};

#[cfg(target_os = "macos")]
const O_RESOLVE_BENEATH: libc::c_int = 0x0000_1000;
#[cfg(target_os = "macos")]
const RENAME_EXCL: libc::c_uint = 0x0000_0004;
#[cfg(target_os = "macos")]
const RENAME_SWAP: libc::c_uint = 0x0000_0002;
const WORKSPACE_FILE_SEARCH_VISITED_LIMIT: usize = 200_000;
const WORKSPACE_TEXT_SEARCH_FILE_SIZE_LIMIT: u64 = 4 * 1024 * 1024;
const WORKSPACE_TEXT_SEARCH_READ_CHUNK_BYTES: usize = 64 * 1024;
const WORKSPACE_TEXT_SEARCH_PREVIEW_BYTE_LIMIT: usize = 4 * 1024;
const WORKSPACE_TEXT_SEARCH_RESPONSE_BYTE_LIMIT: usize = 2 * 1024 * 1024;
pub const WORKSPACE_IMAGE_FILE_SIZE_LIMIT: usize = 20 * 1024 * 1024;

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

pub trait LocalHistorySnapshotSink {
    fn record_snapshot(
        &self,
        workspace_root: &str,
        relative_path: &str,
        content: &str,
    ) -> Result<(), String>;
}

impl LocalHistorySnapshotSink for LocalHistoryStore {
    fn record_snapshot(
        &self,
        workspace_root: &str,
        relative_path: &str,
        content: &str,
    ) -> Result<(), String> {
        LocalHistoryStore::record_snapshot(self, workspace_root, relative_path, content).map(|_| ())
    }
}

mod repository;

fn is_skippable_text_search_candidate_error(error: &io::Error) -> bool {
    if let Some(code) = error.raw_os_error() {
        return matches!(
            code,
            libc::EACCES
                | libc::EPERM
                | libc::ENOENT
                | libc::ENOTDIR
                | libc::EISDIR
                | libc::ELOOP
                | libc::ESTALE
        );
    }

    matches!(
        error.kind(),
        io::ErrorKind::PermissionDenied
            | io::ErrorKind::NotFound
            | io::ErrorKind::InvalidInput
            | io::ErrorKind::Unsupported
    )
}

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
fn rename_overwrite(
    from_parent: &File,
    from_name: &CStr,
    source: &libc::stat,
    to_parent: &File,
    to_name: &CStr,
    destination: &libc::stat,
) -> Result<(), MutationFailure> {
    let current_destination = stat_at(to_parent.as_raw_fd(), to_name)?;
    if !same_entry_snapshot(destination, &current_destination) {
        return Err(io::Error::new(
            io::ErrorKind::WouldBlock,
            "rename destination changed before commit",
        )
        .into());
    }
    rename_swap_at(
        from_parent.as_raw_fd(),
        from_name,
        to_parent.as_raw_fd(),
        to_name,
    )?;
    run_test_hook(
        "rename-after-swap",
        to_parent.as_raw_fd(),
        to_name,
        from_name,
    );
    let current_source = stat_at(to_parent.as_raw_fd(), to_name);
    let displaced_destination = stat_at(from_parent.as_raw_fd(), from_name);
    let committed_identities_match = current_source
        .as_ref()
        .is_ok_and(|current| same_entry_snapshot(source, current))
        && displaced_destination
            .as_ref()
            .is_ok_and(|current| same_entry_snapshot(destination, current));
    if !committed_identities_match {
        let rollback_safe = current_source
            .as_ref()
            .is_ok_and(|current| same_identity(source, current))
            && displaced_destination
                .as_ref()
                .is_ok_and(|current| same_identity(destination, current));
        if rollback_safe
            && rename_swap_at(
                from_parent.as_raw_fd(),
                from_name,
                to_parent.as_raw_fd(),
                to_name,
            )
            .is_ok()
        {
            sync_dir(from_parent).map_err(|error| {
                MutationFailure::Partial(format!(
                    "rename race was rolled back, but its directory could not be synced: {error}"
                ))
            })?;
            if from_parent.as_raw_fd() != to_parent.as_raw_fd() {
                sync_dir(to_parent).map_err(|error| {
                    MutationFailure::Partial(format!(
                        "rename race was rolled back, but its destination directory could not be synced: {error}"
                    ))
                })?;
            }
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "rename destination changed during commit; operation was rolled back",
            )
            .into());
        }
        return Err(MutationFailure::Partial(
            "rename destination changed during commit and rollback was unsafe; reachable versions were retained".into(),
        ));
    }

    let quarantine = unique_quarantine_name(from_parent.as_raw_fd(), from_name)?;
    rename_at(
        from_parent.as_raw_fd(),
        from_name,
        from_parent.as_raw_fd(),
        &quarantine,
        true,
    )
    .map_err(|error| {
        MutationFailure::Partial(format!(
            "rename committed, but the displaced destination could not be quarantined: {error}"
        ))
    })?;
    let quarantined = stat_at(from_parent.as_raw_fd(), &quarantine).map_err(|error| {
        MutationFailure::Partial(format!(
            "rename committed, but the quarantined destination could not be inspected: {error}"
        ))
    })?;
    let committed_source = stat_at(to_parent.as_raw_fd(), to_name).map_err(|error| {
        MutationFailure::Partial(format!(
            "rename committed, but the destination could not be revalidated: {error}"
        ))
    })?;
    if !same_entry_snapshot(destination, &quarantined)
        || !same_entry_snapshot(source, &committed_source)
    {
        return Err(MutationFailure::Partial(
            "rename committed with unexpected identities; quarantined data was retained".into(),
        ));
    }
    delete_entry(from_parent.as_raw_fd(), &quarantine, &quarantined).map_err(|error| {
        MutationFailure::Partial(match error {
            MutationFailure::Partial(message) => message,
            MutationFailure::Io(error) => format!(
                "rename committed, but removing the quarantined destination failed: {error}"
            ),
        })
    })?;
    sync_after_commit(from_parent, "path was renamed")?;
    if from_parent.as_raw_fd() != to_parent.as_raw_fd() {
        sync_after_commit(to_parent, "path was renamed")?;
    }
    Ok(())
}

fn delete_entry(parent: RawFd, name: &CStr, expected: &libc::stat) -> Result<(), MutationFailure> {
    let current = stat_at(parent, name)?;
    if !same_identity(expected, &current) {
        return Err(io::Error::new(
            io::ErrorKind::WouldBlock,
            "delete target changed before commit",
        )
        .into());
    }
    match current.st_mode & libc::S_IFMT {
        libc::S_IFREG => {
            ensure_regular_single_link(&current)?;
            cleanup_owned_entry(parent, name, expected, 0, "delete-before-cleanup-isolation")
                .map_err(MutationFailure::Partial)
        }
        libc::S_IFDIR => delete_directory_tree(parent, name, &current),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "symlinks and special files are not supported",
        )
        .into()),
    }
}

fn delete_directory_tree(
    parent: RawFd,
    name: &CStr,
    expected: &libc::stat,
) -> Result<(), MutationFailure> {
    let directory = open_directory_at(parent, name)?;
    let mut committed = false;
    let duplicate = unsafe { libc::fcntl(directory.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 0) };
    if duplicate < 0 {
        return Err(io::Error::last_os_error().into());
    }
    let stream = unsafe { libc::fdopendir(duplicate) };
    if stream.is_null() {
        unsafe {
            libc::close(duplicate);
        }
        return Err(io::Error::last_os_error().into());
    }
    let stream = DirectoryStream::from_raw(stream);
    loop {
        clear_errno();
        let entry = unsafe { libc::readdir(stream.as_ptr()) };
        if entry.is_null() {
            let error = io::Error::last_os_error();
            if error.raw_os_error().unwrap_or(0) != 0 {
                return Err(if committed {
                    MutationFailure::Partial(format!(
                        "directory was partially deleted before enumeration failed: {error}"
                    ))
                } else {
                    error.into()
                });
            }
            break;
        }
        let child_name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) };
        if child_name.to_bytes() == b"." || child_name.to_bytes() == b".." {
            continue;
        }
        let child = stat_at(directory.as_raw_fd(), child_name).map_err(|error| {
            if committed {
                MutationFailure::Partial(format!(
                    "directory was partially deleted before a child could be inspected: {error}"
                ))
            } else {
                error.into()
            }
        })?;
        if let Err(error) = delete_entry(directory.as_raw_fd(), child_name, &child) {
            return Err(if committed {
                MutationFailure::Partial("directory was only partially deleted".into())
            } else {
                error
            });
        }
        committed = true;
        run_test_hook(
            "delete-directory-after-child",
            directory.as_raw_fd(),
            child_name,
            child_name,
        );
    }
    let current = stat_at(parent, name)?;
    if !same_identity(expected, &current) {
        return Err(if committed {
            MutationFailure::Partial(
                "directory contents were deleted, but the directory identity changed".into(),
            )
        } else {
            io::Error::new(
                io::ErrorKind::WouldBlock,
                "directory changed before removal",
            )
            .into()
        });
    }
    cleanup_owned_entry(
        parent,
        name,
        expected,
        libc::AT_REMOVEDIR,
        "delete-directory-before-cleanup-isolation",
    )
    .map_err(|message| {
        if committed {
            MutationFailure::Partial(format!(
                "directory contents were deleted, but removing the directory failed: {message}"
            ))
        } else {
            MutationFailure::Partial(message)
        }
    })
}

fn cleanup_owned_entry(
    parent: RawFd,
    name: &CStr,
    expected: &libc::stat,
    unlink_flags: libc::c_int,
    hook_event: &str,
) -> Result<(), String> {
    cleanup_owned_entry_with_validation(parent, name, expected, unlink_flags, hook_event, true)
}

fn cleanup_owned_entry_by_identity(
    parent: RawFd,
    name: &CStr,
    expected: &libc::stat,
    unlink_flags: libc::c_int,
    hook_event: &str,
) -> Result<(), String> {
    cleanup_owned_entry_with_validation(parent, name, expected, unlink_flags, hook_event, false)
}

fn cleanup_owned_entry_with_validation(
    parent: RawFd,
    name: &CStr,
    expected: &libc::stat,
    unlink_flags: libc::c_int,
    hook_event: &str,
    validate_snapshot: bool,
) -> Result<(), String> {
    let quarantine = unique_quarantine_name(parent, name).map_err(|error| error.to_string())?;
    run_test_hook(hook_event, parent, name, &quarantine);
    rename_at(parent, name, parent, &quarantine, true).map_err(|error| {
        format!("cleanup target could not be atomically isolated; it was retained: {error}")
    })?;
    let isolated = stat_at(parent, &quarantine).map_err(|error| {
        format!("isolated cleanup target could not be validated and was retained: {error}")
    })?;
    let owns_isolated = if validate_snapshot {
        same_entry_snapshot(expected, &isolated)
    } else {
        same_identity(expected, &isolated)
    };
    if !owns_isolated {
        return Err(
            "cleanup target changed before atomic isolation; the foreign entry was retained".into(),
        );
    }
    if unsafe { libc::unlinkat(parent, quarantine.as_ptr(), unlink_flags) } != 0 {
        return Err(format!(
            "isolated cleanup target could not be removed and was retained: {}",
            io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn copy_metadata(source: RawFd, destination: RawFd) -> io::Result<()> {
    let state = unsafe { libc::copyfile_state_alloc() };
    if state.is_null() {
        return Err(io::Error::last_os_error());
    }
    let result = unsafe { libc::fcopyfile(source, destination, state, libc::COPYFILE_METADATA) };
    let error = if result == 0 {
        None
    } else {
        Some(io::Error::last_os_error())
    };
    unsafe {
        libc::copyfile_state_free(state);
    }
    error.map_or(Ok(()), Err)
}

#[cfg(target_os = "linux")]
fn copy_metadata(source: RawFd, destination: RawFd) -> io::Result<()> {
    let stat = fstat(source)?;
    if unsafe { libc::fchmod(destination, stat.st_mode & 0o7777) } != 0 {
        return Err(io::Error::last_os_error());
    }

    let names_length = unsafe { libc::flistxattr(source, std::ptr::null_mut(), 0) };
    if names_length < 0 {
        return Err(io::Error::last_os_error());
    }
    let mut names = vec![0_u8; names_length as usize];
    if names_length > 0
        && unsafe { libc::flistxattr(source, names.as_mut_ptr().cast(), names.len()) } < 0
    {
        return Err(io::Error::last_os_error());
    }
    for name in names
        .split(|byte| *byte == 0)
        .filter(|name| !name.is_empty())
    {
        let name = CString::new(name).map_err(io::Error::other)?;
        let value_length =
            unsafe { libc::fgetxattr(source, name.as_ptr(), std::ptr::null_mut(), 0) };
        if value_length < 0 {
            return Err(io::Error::last_os_error());
        }
        let mut value = vec![0_u8; value_length as usize];
        if unsafe {
            libc::fgetxattr(
                source,
                name.as_ptr(),
                value.as_mut_ptr().cast(),
                value.len(),
            )
        } < 0
        {
            return Err(io::Error::last_os_error());
        }
        if unsafe {
            libc::fsetxattr(
                destination,
                name.as_ptr(),
                value.as_ptr().cast(),
                value.len(),
                0,
            )
        } != 0
        {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(())
}

fn rename_swap(parent: RawFd, from: &CStr, to: &CStr) -> io::Result<()> {
    let result = rename_with_flags(parent, from, parent, to, rename_exchange_flag());
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

fn rename_swap_at(from_parent: RawFd, from: &CStr, to_parent: RawFd, to: &CStr) -> io::Result<()> {
    let result = rename_with_flags(from_parent, from, to_parent, to, rename_exchange_flag());
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
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
fn rename_exchange_flag() -> libc::c_uint {
    RENAME_SWAP
}

#[cfg(target_os = "linux")]
fn rename_exchange_flag() -> libc::c_uint {
    libc::RENAME_EXCHANGE
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
    use crate::local_history::LocalHistoryStore;
    use crate::{search::TextSearchOptions, workspace_registry::WorkspaceId};
    use std::{
        fs,
        io::Write,
        os::unix::fs::symlink,
        path::{Path, PathBuf},
        sync::{Arc, Barrier},
        thread,
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

    fn history_store(label: &str) -> LocalHistoryStore {
        let base = std::env::temp_dir().join(format!(
            "mockor-replace-history-{label}-{}-{}",
            std::process::id(),
            rand_suffix()
        ));
        fs::create_dir_all(&base).unwrap();
        LocalHistoryStore::new(base)
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

    struct FailingSnapshotSink;

    impl LocalHistorySnapshotSink for FailingSnapshotSink {
        fn record_snapshot(
            &self,
            _workspace_root: &str,
            _relative_path: &str,
            _content: &str,
        ) -> Result<(), String> {
            Err("snapshot store unavailable".into())
        }
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
    fn retained_root_and_intermediate_symlink_cannot_escape() {
        let (registry, id, root) = fixture("containment");
        let outside = root.with_extension("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(root.join("value"), "retained").unwrap();
        fs::write(outside.join("value"), "outside").unwrap();
        symlink(&outside, root.join("link")).unwrap();
        let displaced = root.with_extension("displaced");
        fs::rename(&root, &displaced).unwrap();
        fs::create_dir(&root).unwrap();
        let repository = WorkspaceFileRepository::new(&registry);
        assert_eq!(
            repository
                .read_text(&id, Path::new("value"))
                .unwrap()
                .content,
            "retained"
        );
        assert!(repository.read_text(&id, Path::new("link/value")).is_err());
    }

    #[test]
    fn image_read_round_trips_bytes_and_isolates_workspace_identity() {
        let (registry_a, id_a, root_a) = fixture("image-read-a");
        let (registry_b, id_b, root_b) = fixture("image-read-b");
        fs::write(root_a.join("image.png"), [0, 1, 2, 0xff]).unwrap();
        fs::write(root_b.join("image.png"), [9, 8, 7]).unwrap();

        let image_a = WorkspaceFileRepository::new(&registry_a)
            .read_image(&id_a, Path::new("image.png"))
            .unwrap();
        let image_b = WorkspaceFileRepository::new(&registry_b)
            .read_image(&id_b, Path::new("image.png"))
            .unwrap();

        assert_eq!(image_a.base64, "AAEC/w==");
        assert_eq!(image_a.byte_length, 4);
        assert_eq!(image_b.base64, "CQgH");
        assert_eq!(image_b.byte_length, 3);
    }

    #[test]
    fn image_read_rejects_symlink_escape_and_reports_size_limit() {
        let (registry, id, root) = fixture("image-read-guards");
        let outside = root.with_extension("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("image.png"), [1, 2, 3]).unwrap();
        symlink(outside.join("image.png"), root.join("linked.png")).unwrap();
        fs::write(
            root.join("large.png"),
            vec![0; WORKSPACE_IMAGE_FILE_SIZE_LIMIT + 1],
        )
        .unwrap();
        let repository = WorkspaceFileRepository::new(&registry);

        assert!(matches!(
            repository.read_image(&id, Path::new("linked.png")),
            Err(WorkspaceImageReadError::Io { .. })
        ));
        assert!(matches!(
            repository.read_image(&id, Path::new("large.png")),
            Err(WorkspaceImageReadError::TooLarge {
                max_bytes: WORKSPACE_IMAGE_FILE_SIZE_LIMIT,
                ..
            })
        ));
    }

    #[test]
    fn image_read_rejects_unknown_workspace() {
        let (registry, id, root) = fixture("image-read-unknown");
        fs::write(root.join("image.png"), [1, 2, 3]).unwrap();
        registry.unregister(&id).unwrap();

        assert!(matches!(
            WorkspaceFileRepository::new(&registry).read_image(&id, Path::new("image.png")),
            Err(WorkspaceImageReadError::Io { .. })
        ));
    }

    #[test]
    fn stale_save_preserves_existing_data() {
        let (registry, id, root) = fixture("preserve");
        fs::write(root.join("value"), "first").unwrap();
        let repository = WorkspaceFileRepository::new(&registry);
        let read = repository.read_text(&id, Path::new("value")).unwrap();
        fs::write(root.join("value"), "newer and different").unwrap();
        assert!(matches!(
            repository.save_text(&id, Path::new("value"), "stale", &read.revision),
            FileCommandResult::Conflict { .. }
        ));
        assert_eq!(
            fs::read_to_string(root.join("value")).unwrap(),
            "newer and different"
        );
    }

    #[test]
    fn pre_swap_failure_never_cleans_up_a_foreign_temp_replacement() {
        let (registry, id, root) = fixture("temp-cleanup-capability");
        fs::write(root.join("value"), "original").unwrap();
        let repository = WorkspaceFileRepository::new(&registry);
        let expected = repository
            .read_text(&id, Path::new("value"))
            .unwrap()
            .revision;
        install_hook("save-after-temp-create", |event, parent, _, temp| {
            assert_eq!(event, "save-after-temp-create");
            let rescued = CString::new("rescued-owned-temp").unwrap();
            assert_eq!(
                unsafe { libc::renameat(parent, temp.as_ptr(), parent, rescued.as_ptr()) },
                0
            );
            let fd = unsafe {
                libc::openat(
                    parent,
                    temp.as_ptr(),
                    libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC,
                    0o600,
                )
            };
            assert!(fd >= 0);
            let mut foreign = unsafe { File::from_raw_fd(fd) };
            foreign.write_all(b"foreign-temp").unwrap();
        });
        assert!(matches!(
            repository.save_text(&id, Path::new("value"), "replacement", &expected),
            FileCommandResult::Partial { .. }
        ));
        assert_eq!(fs::read_to_string(root.join("value")).unwrap(), "original");
        assert!(fs::read_dir(&root).unwrap().any(|entry| {
            let path = entry.unwrap().path();
            path.is_file() && fs::read_to_string(path).is_ok_and(|value| value == "foreign-temp")
        }));
    }

    #[test]
    fn concurrent_saves_from_one_revision_allow_only_one_winner() {
        let (registry, id, root) = fixture("concurrent");
        fs::write(root.join("value"), "initial").unwrap();
        let revision = WorkspaceFileRepository::new(&registry)
            .read_text(&id, Path::new("value"))
            .unwrap()
            .revision;
        let barrier = Arc::new(Barrier::new(3));
        let mut joins = Vec::new();
        for content in ["one", "two"] {
            let registry = Arc::clone(&registry);
            let id = id.clone();
            let revision = revision.clone();
            let barrier = Arc::clone(&barrier);
            joins.push(thread::spawn(move || {
                barrier.wait();
                WorkspaceFileRepository::new(&registry).save_text(
                    &id,
                    Path::new("value"),
                    content,
                    &revision,
                )
            }));
        }
        barrier.wait();
        let results: Vec<_> = joins.into_iter().map(|join| join.join().unwrap()).collect();
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, FileCommandResult::Success { .. }))
                .count(),
            1
        );
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, FileCommandResult::Conflict { .. }))
                .count(),
            1
        );
    }

    #[test]
    fn save_race_retains_foreign_replacement_without_unsafe_rollback() {
        let (registry, id, root) = fixture("save-rollback-race");
        fs::write(root.join("value"), "original").unwrap();
        let repository = WorkspaceFileRepository::new(&registry);
        let expected = repository
            .read_text(&id, Path::new("value"))
            .unwrap()
            .revision;
        install_hook("save-after-swap", |event, parent, _target, displaced| {
            assert_eq!(event, "save-after-swap");
            assert_eq!(unsafe { libc::unlinkat(parent, displaced.as_ptr(), 0) }, 0);
            let fd = unsafe {
                libc::openat(
                    parent,
                    displaced.as_ptr(),
                    libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC,
                    0o600,
                )
            };
            assert!(fd >= 0);
            let mut file = unsafe { File::from_raw_fd(fd) };
            file.write_all(b"foreign").unwrap();
        });
        assert!(matches!(
            repository.save_text(&id, Path::new("value"), "replacement", &expected),
            FileCommandResult::Partial { .. }
        ));
        assert_eq!(
            fs::read_to_string(root.join("value")).unwrap(),
            "replacement"
        );
        let retained = fs::read_dir(&root)
            .unwrap()
            .find(|entry| {
                entry
                    .as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".value.save-")
            })
            .unwrap()
            .unwrap();
        assert_eq!(fs::read_to_string(retained.path()).unwrap(), "foreign");
    }

    #[test]
    fn save_revalidates_live_target_before_reporting_success() {
        let (registry, id, root) = fixture("save-live-target-race");
        fs::write(root.join("value"), "original").unwrap();
        let repository = WorkspaceFileRepository::new(&registry);
        let expected = repository
            .read_text(&id, Path::new("value"))
            .unwrap()
            .revision;
        install_hook(
            "save-before-target-revalidation",
            |event, parent, target, _| {
                assert_eq!(event, "save-before-target-revalidation");
                let rescued = CString::new("rescued-replacement").unwrap();
                assert_eq!(
                    unsafe { libc::renameat(parent, target.as_ptr(), parent, rescued.as_ptr()) },
                    0
                );
                let fd = unsafe {
                    libc::openat(
                        parent,
                        target.as_ptr(),
                        libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC,
                        0o600,
                    )
                };
                assert!(fd >= 0);
                let mut file = unsafe { File::from_raw_fd(fd) };
                file.write_all(b"foreign-target").unwrap();
            },
        );
        assert!(matches!(
            repository.save_text(&id, Path::new("value"), "replacement", &expected),
            FileCommandResult::Partial { .. }
        ));
        assert_eq!(
            fs::read_to_string(root.join("value")).unwrap(),
            "foreign-target"
        );
        assert_eq!(
            fs::read_to_string(root.join("rescued-replacement")).unwrap(),
            "replacement"
        );
        assert!(fs::read_dir(&root).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".value.save-")));
    }

    #[test]
    fn cleanup_isolation_never_unlinks_a_foreign_replacement() {
        let (registry, id, root) = fixture("save-cleanup-race");
        fs::write(root.join("value"), "original").unwrap();
        let repository = WorkspaceFileRepository::new(&registry);
        let expected = repository
            .read_text(&id, Path::new("value"))
            .unwrap()
            .revision;
        install_hook(
            "save-before-cleanup-isolation",
            |event, parent, displaced, _quarantine| {
                assert_eq!(event, "save-before-cleanup-isolation");
                let rescued = CString::new("rescued-original").unwrap();
                assert_eq!(
                    unsafe { libc::renameat(parent, displaced.as_ptr(), parent, rescued.as_ptr()) },
                    0
                );
                let fd = unsafe {
                    libc::openat(
                        parent,
                        displaced.as_ptr(),
                        libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC,
                        0o600,
                    )
                };
                assert!(fd >= 0);
                let mut file = unsafe { File::from_raw_fd(fd) };
                file.write_all(b"foreign-cleanup").unwrap();
            },
        );
        assert!(matches!(
            repository.save_text(&id, Path::new("value"), "replacement", &expected),
            FileCommandResult::Partial { .. }
        ));
        assert_eq!(
            fs::read_to_string(root.join("value")).unwrap(),
            "replacement"
        );
        assert_eq!(
            fs::read_to_string(root.join("rescued-original")).unwrap(),
            "original"
        );
        assert!(fs::read_dir(&root).unwrap().any(|entry| {
            let path = entry.unwrap().path();
            path.is_file()
                && fs::read_to_string(path).is_ok_and(|content| content == "foreign-cleanup")
        }));
    }

    #[test]
    fn overwrite_rename_race_never_deletes_concurrent_destination() {
        let (registry, id, root) = fixture("rename-overwrite-race");
        fs::write(root.join("source"), "source").unwrap();
        fs::write(root.join("destination"), "destination").unwrap();
        install_hook(
            "rename-after-swap",
            |event, parent, destination, _displaced| {
                assert_eq!(event, "rename-after-swap");
                let rescued = CString::new("rescued-source").unwrap();
                assert_eq!(
                    unsafe {
                        libc::renameat(parent, destination.as_ptr(), parent, rescued.as_ptr())
                    },
                    0
                );
                let fd = unsafe {
                    libc::openat(
                        parent,
                        destination.as_ptr(),
                        libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC,
                        0o600,
                    )
                };
                assert!(fd >= 0);
                let mut file = unsafe { File::from_raw_fd(fd) };
                file.write_all(b"concurrent").unwrap();
            },
        );
        let repository = WorkspaceFileRepository::new(&registry);
        assert!(matches!(
            repository.rename(&id, Path::new("source"), Path::new("destination"), true),
            MutationResult::Partial { .. }
        ));
        assert_eq!(
            fs::read_to_string(root.join("destination")).unwrap(),
            "concurrent"
        );
        assert_eq!(
            fs::read_to_string(root.join("rescued-source")).unwrap(),
            "source"
        );
        assert_eq!(
            fs::read_to_string(root.join("source")).unwrap(),
            "destination"
        );
    }

    #[test]
    fn create_collision_rename_failure_and_delete_are_nondestructive() {
        let (registry, id, root) = fixture("mutations");
        fs::write(root.join("source"), "source").unwrap();
        fs::write(root.join("destination"), "destination").unwrap();
        let repository = WorkspaceFileRepository::new(&registry);
        assert!(matches!(
            repository.create_file(&id, Path::new("source")),
            MutationResult::Error { .. }
        ));
        assert!(matches!(
            repository.rename(&id, Path::new("source"), Path::new("destination"), false),
            MutationResult::Error { .. }
        ));
        assert_eq!(fs::read_to_string(root.join("source")).unwrap(), "source");
        assert_eq!(
            fs::read_to_string(root.join("destination")).unwrap(),
            "destination"
        );
        assert!(matches!(
            repository.delete(&id, Path::new("source")),
            MutationResult::Success
        ));
        assert!(!root.join("source").exists());
        assert_eq!(
            fs::read_to_string(root.join("destination")).unwrap(),
            "destination"
        );
    }

    #[test]
    fn recursive_directories_delete_without_following_hardlinks() {
        let (registry, id, root) = fixture("delete-guards");
        fs::create_dir_all(root.join("directory/nested")).unwrap();
        fs::write(root.join("directory/nested/value"), "value").unwrap();
        fs::write(root.join("linked"), "content").unwrap();
        fs::hard_link(root.join("linked"), root.join("alias")).unwrap();
        let repository = WorkspaceFileRepository::new(&registry);
        assert!(matches!(
            repository.delete(&id, Path::new("directory")),
            MutationResult::Success
        ));
        assert!(matches!(
            repository.delete(&id, Path::new("linked")),
            MutationResult::Error { .. }
        ));
        assert!(!root.join("directory").exists());
        assert_eq!(fs::read_to_string(root.join("alias")).unwrap(), "content");
    }

    #[test]
    fn recursive_delete_reports_partial_after_first_mutation() {
        let (registry, id, root) = fixture("delete-partial");
        fs::create_dir(root.join("directory")).unwrap();
        fs::write(root.join("directory/first"), "first").unwrap();
        install_hook("delete-directory-after-child", |event, parent, _, _| {
            assert_eq!(event, "delete-directory-after-child");
            let value = CString::new("z-value").unwrap();
            let alias = CString::new("z-alias").unwrap();
            let fd = unsafe {
                libc::openat(
                    parent,
                    value.as_ptr(),
                    libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC,
                    0o600,
                )
            };
            assert!(fd >= 0);
            drop(unsafe { File::from_raw_fd(fd) });
            assert_eq!(
                unsafe { libc::linkat(parent, value.as_ptr(), parent, alias.as_ptr(), 0) },
                0
            );
        });
        assert!(matches!(
            WorkspaceFileRepository::new(&registry).delete(&id, Path::new("directory")),
            MutationResult::Partial { .. }
        ));
        let retained_directory = fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .find(|entry| entry.path().is_dir())
            .unwrap();
        assert!(
            fs::read_dir(retained_directory.path())
                .unwrap()
                .filter_map(Result::ok)
                .count()
                >= 2
        );
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
    fn reads_are_self_consistent_during_in_place_writes() {
        let (registry, id, root) = fixture("read-race");
        let a = "a".repeat(256 * 1024);
        let b = "b".repeat(256 * 1024);
        fs::write(root.join("value"), &a).unwrap();
        let path = root.join("value");
        let writer = thread::spawn({
            let a = a.clone();
            let b = b.clone();
            move || {
                for index in 0..100 {
                    fs::write(&path, if index % 2 == 0 { &b } else { &a }).unwrap();
                }
            }
        });
        let repository = WorkspaceFileRepository::new(&registry);
        for _ in 0..20 {
            if let Ok(read) = repository.read_text(&id, Path::new("value")) {
                assert_eq!(
                    read.revision.content_hash,
                    content_hash(read.content.as_bytes())
                );
                assert_eq!(read.revision.size, read.content.len() as i64);
            }
        }
        writer.join().unwrap();
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
        let text = repository
            .search_text(
                &id,
                Path::new(""),
                "needle",
                1,
                &TextSearchOptions::default(),
            )
            .unwrap();
        assert_eq!(text.len(), 1);
        assert!(!text[0].line_text.contains("secret"));
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
        assert!(first
            .search_text(
                &second_id,
                Path::new(""),
                "second",
                10,
                &TextSearchOptions::default()
            )
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
    fn scoped_search_honors_gitignore_globs_and_emits_each_submatch() {
        let (registry, id, root) = fixture("scoped-search-options");
        fs::create_dir_all(root.join("src/nested")).unwrap();
        fs::create_dir(root.join("ignored")).unwrap();
        fs::write(root.join(".gitignore"), "ignored/\n").unwrap();
        fs::write(root.join("ignored/secret.php"), "needle").unwrap();
        fs::write(root.join("outside.php"), "needle").unwrap();
        fs::write(root.join("src/nested/match-a.php"), "needle needle needle").unwrap();
        fs::write(root.join("src/nested/match-b.ts"), "needle").unwrap();
        let repository = WorkspaceFileRepository::new(&registry);
        let files = repository
            .search_files(&id, Path::new("src"), "match", 20)
            .unwrap();
        assert_eq!(files.len(), 2);
        assert!(files
            .iter()
            .all(|result| !result.relative_path.starts_with("src/")));
        assert!(repository
            .search_files(&id, Path::new("../outside"), "", 20)
            .is_err());

        let options = TextSearchOptions {
            file_mask: Some("**/match-{a,b}.php".into()),
            ..Default::default()
        };
        let results = repository
            .search_text(&id, Path::new("src"), "needle", 5_000, &options)
            .unwrap();
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].relative_path, "nested/match-a.php");
        assert_eq!(results[0].line_text, "needle needle needle");
        assert_eq!(
            results
                .iter()
                .map(|result| (result.match_start, result.match_end))
                .collect::<Vec<_>>(),
            vec![(0, 6), (7, 13), (14, 20)]
        );
        assert!(repository
            .search_text(
                &id,
                Path::new(""),
                "secret",
                500,
                &TextSearchOptions::default()
            )
            .unwrap()
            .is_empty());
    }

    #[test]
    fn text_search_skips_non_text_candidates_and_keeps_readable_results() {
        let (registry, id, root) = fixture("search-skips-non-text");
        fs::create_dir_all(root.join("app/modules/adyenModule/Component/Grid")).unwrap();
        fs::write(root.join("binary.cache"), b"needle\0binary").unwrap();
        fs::write(root.join("invalid.cache"), [0xff, 0xfe, b'n', b'e']).unwrap();
        fs::write(
            root.join("oversized.cache"),
            vec![b'n'; 4 * 1024 * 1024 + 1],
        )
        .unwrap();
        fs::write(
            root.join("app/modules/adyenModule/Component/Grid/datagrid.latte"),
            "{block pagination}\n    needle\n{/block}\n",
        )
        .unwrap();
        let repository = WorkspaceFileRepository::new(&registry);

        let results = repository
            .search_text(
                &id,
                Path::new(""),
                "needle",
                20,
                &TextSearchOptions::default(),
            )
            .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(
            results[0].relative_path,
            "app/modules/adyenModule/Component/Grid/datagrid.latte"
        );
        assert_eq!(results[0].line_number, 2);
    }

    #[test]
    fn text_search_candidate_error_classifier_skips_only_local_kinds() {
        for kind in [
            io::ErrorKind::PermissionDenied,
            io::ErrorKind::NotFound,
            io::ErrorKind::InvalidInput,
            io::ErrorKind::Unsupported,
        ] {
            assert!(is_skippable_text_search_candidate_error(&io::Error::new(
                kind,
                "candidate-local",
            )));
        }

        for kind in [
            io::ErrorKind::OutOfMemory,
            io::ErrorKind::Other,
            io::ErrorKind::UnexpectedEof,
        ] {
            assert!(!is_skippable_text_search_candidate_error(&io::Error::new(
                kind, "systemic",
            )));
        }
    }

    #[test]
    fn text_search_candidate_error_classifier_preserves_systemic_os_errors() {
        for code in [
            libc::EACCES,
            libc::EPERM,
            libc::ENOENT,
            libc::ENOTDIR,
            libc::EISDIR,
            libc::ELOOP,
            libc::ESTALE,
        ] {
            assert!(is_skippable_text_search_candidate_error(
                &io::Error::from_raw_os_error(code),
            ));
        }

        for code in [libc::EMFILE, libc::ENFILE, libc::ENOMEM, libc::EIO] {
            assert!(!is_skippable_text_search_candidate_error(
                &io::Error::from_raw_os_error(code),
            ));
        }
    }

    #[test]
    fn text_search_candidate_error_classifier_preserves_enosys() {
        let error = io::Error::from_raw_os_error(libc::ENOSYS);

        assert_eq!(error.raw_os_error(), Some(libc::ENOSYS));
        assert!(!is_skippable_text_search_candidate_error(&error));
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
        assert!(repository
            .search_text(
                &id,
                Path::new("src"),
                "needle",
                20,
                &TextSearchOptions::default()
            )
            .is_err());
    }

    #[test]
    fn save_preserves_mode_and_extended_attributes() {
        use std::os::unix::fs::PermissionsExt;
        let (registry, id, root) = fixture("metadata");
        let path = root.join("value");
        fs::write(&path, "old").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
        let file = File::options().read(true).write(true).open(&path).unwrap();
        let key = CString::new("user.mockor-test").unwrap();
        let value = b"preserved";
        #[cfg(target_os = "macos")]
        let set_xattr = unsafe {
            libc::fsetxattr(
                file.as_raw_fd(),
                key.as_ptr(),
                value.as_ptr().cast(),
                value.len(),
                0,
                0,
            )
        };
        #[cfg(target_os = "linux")]
        let set_xattr = unsafe {
            libc::fsetxattr(
                file.as_raw_fd(),
                key.as_ptr(),
                value.as_ptr().cast(),
                value.len(),
                0,
            )
        };
        assert_eq!(set_xattr, 0);
        let repository = WorkspaceFileRepository::new(&registry);
        let read = repository.read_text(&id, Path::new("value")).unwrap();
        assert!(matches!(
            repository.save_text(&id, Path::new("value"), "new", &read.revision),
            FileCommandResult::Success { .. }
        ));
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o640
        );
        let saved = File::open(path).unwrap();
        let mut buffer = [0_u8; 32];
        #[cfg(target_os = "macos")]
        let length = unsafe {
            libc::fgetxattr(
                saved.as_raw_fd(),
                key.as_ptr(),
                buffer.as_mut_ptr().cast(),
                buffer.len(),
                0,
                0,
            )
        };
        #[cfg(target_os = "linux")]
        let length = unsafe {
            libc::fgetxattr(
                saved.as_raw_fd(),
                key.as_ptr(),
                buffer.as_mut_ptr().cast(),
                buffer.len(),
            )
        };
        assert_eq!(&buffer[..length as usize], value);
    }

    #[test]
    fn replace_is_scoped_and_isolated_by_workspace_identity() {
        let (registry_a, id_a, root_a) = fixture("replace-a");
        let (registry_b, id_b, root_b) = fixture("replace-b");
        for root in [&root_a, &root_b] {
            fs::create_dir_all(root.join("src/nested")).unwrap();
            fs::write(root.join("src/a.txt"), "Needle needle\n").unwrap();
            fs::write(root.join("src/nested/b.txt"), "needle\n").unwrap();
            fs::write(root.join("outside.txt"), "needle\n").unwrap();
        }
        let options = TextSearchOptions {
            case_sensitive: false,
            ..Default::default()
        };
        let result = WorkspaceFileRepository::new(&registry_a).replace_in_path(
            &id_a,
            Path::new("src"),
            "needle",
            "thread",
            &options,
        );
        assert!(matches!(
            result,
            WorkspaceReplaceResult::Success {
                total_replacements: 3,
                ..
            }
        ));
        assert_eq!(
            fs::read(root_a.join("src/a.txt")).unwrap(),
            b"thread thread\n"
        );
        assert_eq!(fs::read(root_a.join("outside.txt")).unwrap(), b"needle\n");
        assert_eq!(
            fs::read(root_b.join("src/a.txt")).unwrap(),
            b"Needle needle\n"
        );
        assert_eq!(
            fs::read(root_b.join("src/nested/b.txt")).unwrap(),
            b"needle\n"
        );
        assert_eq!(
            WorkspaceFileRepository::new(&registry_b)
                .read_text(&id_b, Path::new("src/a.txt"))
                .unwrap()
                .content,
            "Needle needle\n"
        );
    }

    #[test]
    fn replace_records_pre_replace_history_for_changed_files_only() {
        let (registry_a, id_a, root_a) = fixture("replace-history-a");
        let (_registry_b, _id_b, root_b) = fixture("replace-history-b");
        fs::create_dir(root_a.join("src")).unwrap();
        fs::write(root_a.join("a.txt"), "needle one\n").unwrap();
        fs::write(root_a.join("src/b.txt"), "needle two\n").unwrap();
        fs::write(root_a.join("unchanged.txt"), "no match\n").unwrap();
        let store = history_store("changed-only");
        let canonical_root_a = root_a.canonicalize().unwrap();
        #[cfg(target_os = "macos")]
        assert_ne!(root_a, canonical_root_a);
        #[cfg(target_os = "linux")]
        assert_eq!(root_a, canonical_root_a);
        let workspace_a = root_a.to_string_lossy();
        let canonical_workspace_a = canonical_root_a.to_string_lossy();
        let workspace_b = root_b.to_string_lossy();

        let result = WorkspaceFileRepository::new(&registry_a).replace_in_path_with_snapshot_sink(
            &id_a,
            Path::new(""),
            "needle",
            "thread",
            &TextSearchOptions::default(),
            &store,
        );

        assert!(matches!(
            result,
            WorkspaceReplaceResult::Success {
                total_replacements: 2,
                ..
            }
        ));
        for (path, expected) in [("a.txt", "needle one\n"), ("src/b.txt", "needle two\n")] {
            let versions = store.list_versions(&canonical_workspace_a, path).unwrap();
            assert_eq!(versions.len(), 1);
            assert_eq!(
                store
                    .read_version(&canonical_workspace_a, path, &versions[0].id)
                    .unwrap(),
                expected
            );
            assert!(store.list_versions(&workspace_b, path).unwrap().is_empty());
            if workspace_a != canonical_workspace_a {
                assert!(store.list_versions(&workspace_a, path).unwrap().is_empty());
            }
        }
        assert!(store
            .list_versions(&canonical_workspace_a, "unchanged.txt")
            .unwrap()
            .is_empty());

        let no_op = WorkspaceFileRepository::new(&registry_a).replace_in_path_with_snapshot_sink(
            &id_a,
            Path::new(""),
            "thread",
            "thread",
            &TextSearchOptions::default(),
            &store,
        );
        assert!(matches!(
            no_op,
            WorkspaceReplaceResult::Success {
                total_replacements: 0,
                ..
            }
        ));
        assert_eq!(
            store
                .list_versions(&canonical_workspace_a, "a.txt")
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            store
                .list_versions(&canonical_workspace_a, "src/b.txt")
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn alias_opened_replace_records_history_under_the_canonical_workspace() {
        let root = std::env::temp_dir().join(format!(
            "mockor-file-commands-replace-alias-root-{}-{}",
            std::process::id(),
            rand_suffix()
        ));
        let alias_parent = std::env::temp_dir().join(format!(
            "mockor-file-commands-replace-alias-parent-{}-{}",
            std::process::id(),
            rand_suffix()
        ));
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&alias_parent).unwrap();
        let alias = alias_parent.join("workspace-alias");
        symlink(&root, &alias).unwrap();
        fs::write(root.join("invoice.txt"), "needle\n").unwrap();
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(&alias).unwrap();
        let store = history_store("alias-canonical");

        let result = WorkspaceFileRepository::new(&registry).replace_in_path_with_snapshot_sink(
            &descriptor.workspace_id,
            Path::new("invoice.txt"),
            "needle",
            "thread",
            &TextSearchOptions::default(),
            &store,
        );

        assert!(matches!(
            result,
            WorkspaceReplaceResult::Success {
                total_replacements: 1,
                ..
            }
        ));
        let canonical_root = descriptor.canonical_root_path.to_string_lossy();
        let selected_alias = descriptor.selected_root_path.to_string_lossy();
        let versions = store.list_versions(&canonical_root, "invoice.txt").unwrap();
        assert_eq!(versions.len(), 1);
        assert_eq!(
            store
                .read_version(&canonical_root, "invoice.txt", &versions[0].id)
                .unwrap(),
            "needle\n"
        );
        assert!(store
            .list_versions(&selected_alias, "invoice.txt")
            .unwrap()
            .is_empty());
    }

    #[test]
    fn snapshot_failure_does_not_fail_replace() {
        let (registry, id, root) = fixture("replace-history-failure");
        fs::write(root.join("a.txt"), "needle\n").unwrap();

        let result = WorkspaceFileRepository::new(&registry).replace_in_path_with_snapshot_sink(
            &id,
            Path::new("a.txt"),
            "needle",
            "thread",
            &TextSearchOptions::default(),
            &FailingSnapshotSink,
        );

        assert!(matches!(
            result,
            WorkspaceReplaceResult::Success {
                total_replacements: 1,
                ..
            }
        ));
        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "thread\n");
    }

    #[test]
    fn replace_exact_file_supports_regex_captures_and_ignores_wider_mask() {
        use std::os::unix::fs::PermissionsExt;
        let (registry, id, root) = fixture("replace-regex");
        fs::write(root.join("a.txt"), "user-42 user42\n").unwrap();
        fs::set_permissions(root.join("a.txt"), fs::Permissions::from_mode(0o640)).unwrap();
        fs::write(root.join("b.txt"), "user-42\n").unwrap();
        let options = TextSearchOptions {
            case_sensitive: true,
            whole_word: true,
            is_regex: true,
            preserve_case: false,
            file_mask: Some("*.php".into()),
        };
        let result = WorkspaceFileRepository::new(&registry).replace_in_path(
            &id,
            Path::new("a.txt"),
            r"user-(\d+)",
            "member-$1",
            &options,
        );
        assert!(matches!(
            result,
            WorkspaceReplaceResult::Success {
                total_replacements: 1,
                ..
            }
        ));
        assert_eq!(
            fs::read_to_string(root.join("a.txt")).unwrap(),
            "member-42 user42\n"
        );
        assert_eq!(
            fs::metadata(root.join("a.txt"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o640
        );
        assert_eq!(fs::read_to_string(root.join("b.txt")).unwrap(), "user-42\n");
    }

    #[test]
    fn replace_literal_preserves_named_dollar_replacement_verbatim() {
        let (registry, id, root) = fixture("replace-literal-named-dollar");
        fs::write(root.join("a.php"), "x\n").unwrap();

        let result = WorkspaceFileRepository::new(&registry).replace_in_path(
            &id,
            Path::new("a.php"),
            "x",
            "$user = 5",
            &TextSearchOptions::default(),
        );

        assert!(matches!(
            result,
            WorkspaceReplaceResult::Success {
                total_replacements: 1,
                ..
            }
        ));
        assert_eq!(
            fs::read_to_string(root.join("a.php")).unwrap(),
            "$user = 5\n"
        );
    }

    #[test]
    fn replace_literal_preserves_numeric_dollar_replacement_verbatim() {
        let (registry, id, root) = fixture("replace-literal-numeric-dollar");
        fs::write(root.join("a.txt"), "x\n").unwrap();

        let result = WorkspaceFileRepository::new(&registry).replace_in_path(
            &id,
            Path::new("a.txt"),
            "x",
            "$100",
            &TextSearchOptions::default(),
        );

        assert!(matches!(
            result,
            WorkspaceReplaceResult::Success {
                total_replacements: 1,
                ..
            }
        ));
        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "$100\n");
    }

    #[test]
    fn replace_literal_preserves_whole_word_and_case_options() {
        let (registry, id, root) = fixture("replace-literal-options");
        fs::write(root.join("a.txt"), "User username user\n").unwrap();
        let options = TextSearchOptions {
            case_sensitive: false,
            whole_word: true,
            ..Default::default()
        };

        let result = WorkspaceFileRepository::new(&registry).replace_in_path(
            &id,
            Path::new("a.txt"),
            "user",
            "$user = 5",
            &options,
        );

        assert!(matches!(
            result,
            WorkspaceReplaceResult::Success {
                total_replacements: 2,
                ..
            }
        ));
        assert_eq!(
            fs::read_to_string(root.join("a.txt")).unwrap(),
            "$user = 5 username $user = 5\n"
        );
    }

    #[test]
    fn replace_preserve_case_uses_whole_match_rules_in_literal_and_regex_modes() {
        let cases = [
            ("upper", "FOO", "foo", "next", false, "NEXT"),
            ("title", "Foo", "foo", "next value", false, "Next value"),
            ("lower", "foo", "foo", "NextValue", false, "NextValue"),
            ("mixed", "fOO", "foo", "NextValue", false, "NextValue"),
            (
                "mixed-separated-whole-match",
                "FOO-bar",
                "foo-bar",
                "next-value",
                false,
                "next-value",
            ),
            (
                "regex-expanded-first",
                "FOO-FOO",
                "(foo)-(foo)",
                "${1}bar",
                true,
                "FOOBAR",
            ),
            ("literal-dollar", "FOO", "foo", "$text", false, "$TEXT"),
        ];

        for (name, content, query, replacement, is_regex, expected) in cases {
            let (registry, id, root) = fixture(name);
            fs::write(root.join("a.txt"), content).unwrap();
            let options: TextSearchOptions = serde_json::from_value(serde_json::json!({
                "caseSensitive": false,
                "isRegex": is_regex,
                "preserveCase": true
            }))
            .unwrap();

            WorkspaceFileRepository::new(&registry).replace_in_path(
                &id,
                Path::new("a.txt"),
                query,
                replacement,
                &options,
            );

            assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), expected);
        }
    }

    #[test]
    fn replace_preserve_case_is_a_no_op_for_an_exact_case_sensitive_match() {
        let (registry, id, root) = fixture("preserve-case-sensitive");
        fs::write(root.join("a.txt"), "foo").unwrap();
        let options: TextSearchOptions = serde_json::from_value(serde_json::json!({
            "caseSensitive": true,
            "preserveCase": true
        }))
        .unwrap();

        WorkspaceFileRepository::new(&registry).replace_in_path(
            &id,
            Path::new("a.txt"),
            "foo",
            "NextValue",
            &options,
        );

        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "NextValue");
    }

    #[test]
    fn replace_preserve_case_applies_unconditionally_to_an_upper_case_sensitive_match() {
        let (registry, id, root) = fixture("preserve-upper-case-sensitive");
        fs::write(root.join("a.txt"), "FOO").unwrap();
        let options: TextSearchOptions = serde_json::from_value(serde_json::json!({
            "caseSensitive": true,
            "preserveCase": true
        }))
        .unwrap();

        WorkspaceFileRepository::new(&registry).replace_in_path(
            &id,
            Path::new("a.txt"),
            "FOO",
            "NextValue",
            &options,
        );

        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "NEXTVALUE");
    }

    #[test]
    fn replace_honors_nested_gitignore_and_file_masks() {
        let (registry, id, root) = fixture("replace-ignore");
        fs::create_dir_all(root.join("src/generated")).unwrap();
        fs::write(root.join("src/.gitignore"), "generated/\n").unwrap();
        fs::write(root.join("src/a.php"), "needle").unwrap();
        fs::write(root.join("src/a.txt"), "needle").unwrap();
        fs::write(root.join("src/generated/a.php"), "needle").unwrap();
        let options = TextSearchOptions {
            file_mask: Some("*.php".into()),
            ..Default::default()
        };
        let result = WorkspaceFileRepository::new(&registry).replace_in_path(
            &id,
            Path::new("src"),
            "needle",
            "thread",
            &options,
        );
        assert!(matches!(
            result,
            WorkspaceReplaceResult::Success {
                total_replacements: 1,
                ..
            }
        ));
        assert_eq!(
            fs::read_to_string(root.join("src/a.php")).unwrap(),
            "thread"
        );
        assert_eq!(
            fs::read_to_string(root.join("src/a.txt")).unwrap(),
            "needle"
        );
        assert_eq!(
            fs::read_to_string(root.join("src/generated/a.php")).unwrap(),
            "needle"
        );
    }

    #[test]
    fn replace_rejects_escape_and_symlink_scope() {
        let (registry, id, root) = fixture("replace-reject");
        let outside = root.with_extension("replace-outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("a.txt"), "needle").unwrap();
        symlink(&outside, root.join("link")).unwrap();
        let repository = WorkspaceFileRepository::new(&registry);
        assert!(matches!(
            repository.replace_in_path(
                &id,
                Path::new("../a.txt"),
                "needle",
                "x",
                &Default::default()
            ),
            WorkspaceReplaceResult::Error { .. }
        ));
        assert!(matches!(
            repository.replace_in_path(&id, Path::new("link"), "needle", "x", &Default::default()),
            WorkspaceReplaceResult::Error { .. }
        ));
        assert_eq!(fs::read_to_string(outside.join("a.txt")).unwrap(), "needle");
    }

    #[test]
    fn replace_reports_concurrent_target_swap_as_conflict_without_overwrite() {
        let (registry, id, root) = fixture("replace-conflict");
        fs::write(root.join("a.txt"), "needle").unwrap();
        install_hook("save-after-temp-create", move |_, parent, target, _| {
            assert_eq!(unsafe { libc::unlinkat(parent, target.as_ptr(), 0) }, 0);
            let fd = unsafe {
                libc::openat(
                    parent,
                    target.as_ptr(),
                    libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL,
                    0o600,
                )
            };
            assert!(fd >= 0);
            let mut replacement = unsafe { File::from_raw_fd(fd) };
            replacement.write_all(b"concurrent").unwrap();
        });
        let result = WorkspaceFileRepository::new(&registry).replace_in_path(
            &id,
            Path::new("a.txt"),
            "needle",
            "thread",
            &Default::default(),
        );
        assert!(matches!(
            result,
            WorkspaceReplaceResult::Conflict {
                total_replacements: 0,
                ..
            }
        ));
        assert_eq!(
            fs::read_to_string(root.join("a.txt")).unwrap(),
            "concurrent"
        );
    }
}
