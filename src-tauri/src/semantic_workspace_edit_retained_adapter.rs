#![allow(dead_code)] // Private adapter strategy; intentionally not registered as app state/IPC.

use crate::semantic_workspace_edit_atomic_cas::{
    MaterializedSemanticWorkspaceEdit, SemanticDocumentIdentity, SemanticWorkspaceEdit,
    SemanticWorkspaceEditAtomicStore,
};
#[cfg(unix)]
use std::os::unix::{
    ffi::OsStrExt,
    fs::MetadataExt,
    io::{AsRawFd, FromRawFd},
};
use std::{
    collections::BTreeMap,
    ffi::{CString, OsString},
    fs::File,
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// Owner-only commit boundary for one existing Nette semantic-owner file plus the future backend
/// open-buffer authority. File operations and multi-target edits are intentionally unsupported.
/// Implementations must stage the owner disk and open-buffer mutation, then publish both or
/// neither before returning.
///
/// `apply_transactional_descriptor_workspace_edit` is the intended disk implementation. Calling
/// it before or after a separately locked Monaco/open-document mutation does not satisfy this
/// strategy. The caller must acquire locks in the global order
/// `WorkspaceRegistry::operations -> WorkspaceTrustService -> CAS foundation`; this strategy runs
/// inside the CAS lock and therefore must call a prelocked transaction body, never reacquire
/// operations or trust.
pub(crate) trait AtomicSemanticWorkspaceTransaction: Send {
    fn commit_prelocked_snapshot_atomically(
        &mut self,
        workspace: RetainedWorkspaceTransactionCapability<'_>,
        owner: RetainedOwnerTransactionCapability<'_>,
        edit_json: &[u8],
    ) -> Result<(), String>;
}

#[derive(Clone, Copy)]
pub(crate) struct RetainedWorkspaceTransactionCapability<'a> {
    directory: &'a File,
}

#[derive(Clone, Copy)]
pub(crate) struct RetainedOwnerTransactionCapability<'a> {
    file: &'a File,
    relative_path: &'a Path,
}

impl RetainedOwnerTransactionCapability<'_> {
    pub(crate) fn file(&self) -> &File {
        self.file
    }

    pub(crate) fn relative_path(&self) -> &Path {
        self.relative_path
    }
}

impl RetainedWorkspaceTransactionCapability<'_> {
    #[cfg(unix)]
    pub(crate) fn open_existing_regular(&self, relative: &Path) -> Result<File, String> {
        if relative.as_os_str().is_empty() || relative.is_absolute() {
            return Err("Retained transaction path is not relative.".to_string());
        }
        let components = relative.components().collect::<Vec<_>>();
        let mut current = self
            .directory
            .try_clone()
            .map_err(|_| "Retained transaction root is unavailable.".to_string())?;
        for (index, component) in components.iter().enumerate() {
            let Component::Normal(name) = component else {
                return Err("Retained transaction path is unsafe.".to_string());
            };
            let name = CString::new(name.as_bytes())
                .map_err(|_| "Retained transaction path contains NUL.".to_string())?;
            let flags = if index + 1 == components.len() {
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC
            } else {
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC
            };
            let descriptor = unsafe { libc::openat(current.as_raw_fd(), name.as_ptr(), flags) };
            if descriptor < 0 {
                return Err("Retained transaction target is unavailable or unsafe.".to_string());
            }
            current = unsafe { File::from_raw_fd(descriptor) };
        }
        if !current
            .metadata()
            .map_err(|_| "Retained transaction target is unavailable.".to_string())?
            .is_file()
        {
            return Err("Retained transaction target is not a regular file.".to_string());
        }
        Ok(current)
    }
}

pub(crate) struct RetainedOwnerEditPlan {
    owner_file: File,
    owner_relative_path: PathBuf,
    snapshot: Vec<u8>,
}

/// Retains the admitted root object for the full CAS lifetime and provides one canonical URI/path
/// policy to both precondition comparison and the transaction strategy.
pub(crate) struct RetainedWorkspaceSemanticEditStore<Transaction> {
    _retained_root: File,
    root_key: PathBuf,
    transaction: Transaction,
}

impl<Transaction: AtomicSemanticWorkspaceTransaction>
    RetainedWorkspaceSemanticEditStore<Transaction>
{
    pub(crate) fn new(
        retained_root: File,
        canonical_root_key: impl Into<PathBuf>,
        transaction: Transaction,
    ) -> Result<Self, String> {
        let root_key = normalize_absolute_path(&canonical_root_key.into())?;
        let retained_metadata = retained_root
            .metadata()
            .map_err(|_| "Retained semantic workspace root is unavailable.".to_string())?;
        if !retained_metadata.is_dir() {
            return Err("Retained semantic workspace root is not a directory.".to_string());
        }
        #[cfg(not(unix))]
        {
            let _ = transaction;
            return Err(
                "Retained semantic workspace edit authority is unsupported on this platform."
                    .to_string(),
            );
        }
        #[cfg(unix)]
        {
            let selected = File::open(&root_key)
                .map_err(|_| "Semantic workspace root identity is unavailable.".to_string())?;
            let selected_metadata = selected
                .metadata()
                .map_err(|_| "Semantic workspace root identity is unavailable.".to_string())?;
            if retained_metadata.dev() != selected_metadata.dev()
                || retained_metadata.ino() != selected_metadata.ino()
            {
                return Err("Retained semantic workspace root identity does not match.".to_string());
            }
        }
        Ok(Self {
            _retained_root: retained_root,
            root_key,
            transaction,
        })
    }

    #[cfg(test)]
    pub(crate) fn transaction(&self) -> &Transaction {
        &self.transaction
    }
}

impl<Transaction: AtomicSemanticWorkspaceTransaction> SemanticWorkspaceEditAtomicStore
    for RetainedWorkspaceSemanticEditStore<Transaction>
{
    type CommitPlan = RetainedOwnerEditPlan;

    fn materialize_edit(
        &self,
        root_key: &str,
        edit: &SemanticWorkspaceEdit,
        protected_path_keys: &[&str],
    ) -> Result<MaterializedSemanticWorkspaceEdit<Self::CommitPlan>, String> {
        self.materialize_owner_edit(root_key, edit, protected_path_keys)
    }

    fn commit_atomically(&mut self, plan: Self::CommitPlan) -> Result<(), String> {
        self.transaction.commit_prelocked_snapshot_atomically(
            RetainedWorkspaceTransactionCapability {
                directory: &self._retained_root,
            },
            RetainedOwnerTransactionCapability {
                file: &plan.owner_file,
                relative_path: &plan.owner_relative_path,
            },
            &plan.snapshot,
        )
    }
}

impl<Transaction: AtomicSemanticWorkspaceTransaction>
    RetainedWorkspaceSemanticEditStore<Transaction>
{
    fn canonical_existing_path(
        &self,
        root_key: &str,
        uri: &str,
    ) -> Result<(String, PathBuf, File), String> {
        if Path::new(root_key) != self.root_key {
            return Err("Semantic workspace root authority changed.".to_string());
        }
        let decoded = decode_local_file_uri(uri)?;
        let normalized = normalize_absolute_path(&decoded)?;
        if normalized == self.root_key || !normalized.starts_with(&self.root_key) {
            return Err("Semantic workspace edit target is outside the retained root.".to_string());
        }
        let relative = normalized
            .strip_prefix(&self.root_key)
            .map_err(|_| "Semantic workspace edit target escaped its retained root.".to_string())?
            .to_path_buf();
        let owner_file = RetainedWorkspaceTransactionCapability {
            directory: &self._retained_root,
        }
        .open_existing_regular(&relative)?;
        let canonical = self
            .root_key
            .join(&relative)
            .to_str()
            .map(ToString::to_string)
            .ok_or_else(|| "Semantic workspace edit target is not valid Unicode.".to_string())?;
        Ok((canonical, relative, owner_file))
    }

    #[cfg(test)]
    fn canonical_path_key(&self, root_key: &str, uri: &str) -> Result<String, String> {
        self.canonical_existing_path(root_key, uri)
            .map(|(canonical, _, _)| canonical)
    }

    fn materialize_owner_edit(
        &self,
        root_key: &str,
        edit: &SemanticWorkspaceEdit,
        protected_path_keys: &[&str],
    ) -> Result<MaterializedSemanticWorkspaceEdit<RetainedOwnerEditPlan>, String> {
        let mut value: serde_json::Value = serde_json::from_slice(&edit.snapshot_json()?)
            .map_err(|_| "Semantic workspace edit snapshot is unavailable.".to_string())?;
        let operations = value
            .get("fileOperations")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| "Semantic workspace file operations are unavailable.".to_string())?;
        if !operations.is_empty() {
            return Err("Semantic owner edit does not support file operations.".to_string());
        }

        let changes = value
            .get_mut("changes")
            .and_then(serde_json::Value::as_object_mut)
            .ok_or_else(|| "Semantic workspace edit changes are unavailable.".to_string())?;
        if changes.len() != 1 {
            return Err("Semantic owner edit requires exactly one existing target.".to_string());
        }
        let original_changes = std::mem::take(changes);
        let (owner_uri, owner_edits) = original_changes
            .into_iter()
            .next()
            .ok_or_else(|| "Semantic owner edit target is unavailable.".to_string())?;
        let (owner_path_key, owner_relative_path, owner_file) =
            self.canonical_existing_path(root_key, &owner_uri)?;
        if protected_path_keys.contains(&owner_path_key.as_str()) {
            return Err("Semantic workspace edit targeted a protected document.".to_string());
        }
        #[cfg(unix)]
        {
            let owner_metadata = owner_file
                .metadata()
                .map_err(|_| "Semantic owner identity is unavailable.".to_string())?;
            for protected in protected_path_keys {
                let protected_path = normalize_absolute_path(Path::new(protected))?;
                let protected_relative =
                    protected_path.strip_prefix(&self.root_key).map_err(|_| {
                        "Protected semantic identity is outside the retained root.".to_string()
                    })?;
                let protected_file = RetainedWorkspaceTransactionCapability {
                    directory: &self._retained_root,
                }
                .open_existing_regular(protected_relative)?;
                let protected_metadata = protected_file
                    .metadata()
                    .map_err(|_| "Protected semantic identity is unavailable.".to_string())?;
                if owner_metadata.dev() == protected_metadata.dev()
                    && owner_metadata.ino() == protected_metadata.ino()
                {
                    return Err(
                        "Semantic workspace edit targeted a protected document identity."
                            .to_string(),
                    );
                }
            }
        }
        let relative_text = owner_relative_path
            .to_str()
            .ok_or_else(|| "Semantic workspace edit target is not valid Unicode.".to_string())?
            .to_string();
        changes.insert(relative_text.clone(), owner_edits);

        let mut change_path_keys = BTreeMap::new();
        change_path_keys.insert(owner_uri.clone(), owner_path_key);
        if let Some(versions) = value
            .get_mut("documentVersions")
            .and_then(serde_json::Value::as_object_mut)
        {
            let original_versions = std::mem::take(versions);
            for (uri, version) in original_versions {
                if uri != owner_uri {
                    return Err(
                        "Semantic document version is not bound to the owner target.".to_string(),
                    );
                }
                versions.insert(relative_text.clone(), version);
            }
        }
        let snapshot = serde_json::to_vec(&value)
            .map_err(|_| "Semantic workspace edit snapshot is unavailable.".to_string())?;
        Ok(MaterializedSemanticWorkspaceEdit::new(
            change_path_keys,
            RetainedOwnerEditPlan {
                owner_file,
                owner_relative_path,
                snapshot,
            },
        ))
    }
}

/// Opaque restart seed restored from the durable host-epoch floor before a workspace authority is
/// admitted. A fresh zero seed is valid only for a workspace identity with no prior lifetime.
pub(crate) struct PersistedSemanticDocumentHostEpochFloor(u64);

impl PersistedSemanticDocumentHostEpochFloor {
    pub(crate) fn restored(last_issued: u64) -> Result<Self, String> {
        if last_issued >= MAX_SAFE_INTEGER {
            return Err("Semantic document host epoch is exhausted.".to_string());
        }
        Ok(Self(last_issued))
    }
}

/// Single issuer owned by the workspace host registry. The registry must construct exactly one
/// instance per admitted workspace lifetime from its persisted floor and route every
/// open/close/filesystem publication through it.
pub(crate) struct SemanticDocumentHostEpochs {
    next: AtomicU64,
}

impl SemanticDocumentHostEpochs {
    pub(crate) fn resume(floor: PersistedSemanticDocumentHostEpochFloor) -> Self {
        Self {
            next: AtomicU64::new(floor.0 + 1),
        }
    }

    fn issue(&self) -> Result<u64, String> {
        self.next
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |current| {
                (current <= MAX_SAFE_INTEGER).then(|| current + 1)
            })
            .map_err(|_| "Semantic document host epoch is exhausted.".to_string())
    }

    #[cfg(test)]
    fn last_issued(&self) -> u64 {
        self.next.load(Ordering::Acquire).saturating_sub(1)
    }

    pub(crate) fn open_identity(
        &self,
        content_hash: String,
        path_key: String,
        lifecycle: u64,
        session_id: u64,
        version: u64,
    ) -> Result<SemanticDocumentIdentity, String> {
        Ok(SemanticDocumentIdentity::Open {
            content_hash,
            host_epoch: self.issue()?,
            lifecycle,
            path_key,
            session_id,
            version,
        })
    }

    pub(crate) fn closed_identity(
        &self,
        content_hash: String,
        path_key: String,
        revision: u64,
    ) -> Result<SemanticDocumentIdentity, String> {
        Ok(SemanticDocumentIdentity::Closed {
            content_hash,
            host_epoch: self.issue()?,
            path_key,
            revision,
        })
    }
}

fn decode_local_file_uri(uri: &str) -> Result<PathBuf, String> {
    let encoded = uri
        .strip_prefix("file://")
        .ok_or_else(|| "Semantic workspace edit target is not a local file URI.".to_string())?;
    if encoded.is_empty() || encoded.starts_with("//") {
        return Err(
            "Semantic workspace edit target has an unsupported file authority.".to_string(),
        );
    }
    let bytes = encoded.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0usize;
    while index < bytes.len() {
        match bytes[index] {
            b'%' => {
                if index + 2 >= bytes.len() {
                    return Err(
                        "Semantic workspace edit target has malformed escaping.".to_string()
                    );
                }
                let high = hex(bytes[index + 1])?;
                let low = hex(bytes[index + 2])?;
                let byte = (high << 4) | low;
                if byte == 0 {
                    return Err("Semantic workspace edit target contains NUL.".to_string());
                }
                decoded.push(byte);
                index += 3;
            }
            byte => {
                if byte == 0 {
                    return Err("Semantic workspace edit target contains NUL.".to_string());
                }
                decoded.push(byte);
                index += 1;
            }
        }
    }
    let decoded = String::from_utf8(decoded)
        .map_err(|_| "Semantic workspace edit target is not valid UTF-8.".to_string())?;
    Ok(PathBuf::from(OsString::from(decoded)))
}

fn hex(byte: u8) -> Result<u8, String> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        b'a'..=b'f' => Ok(byte - b'a' + 10),
        b'A'..=b'F' => Ok(byte - b'A' + 10),
        _ => Err("Semantic workspace edit target has malformed escaping.".to_string()),
    }
}

fn normalize_absolute_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("Semantic workspace edit target is not absolute.".to_string());
    }
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::RootDir | Component::Prefix(_) | Component::Normal(_) => {
                normalized.push(component.as_os_str());
            }
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err("Semantic workspace edit target escaped its root.".to_string());
                }
            }
        }
    }
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::semantic_workspace_edit_atomic_cas::{
        SemanticDocumentIdentity, SemanticWorkspaceEditAtomicCasDecision,
        SemanticWorkspaceEditAtomicCasFoundation, WorkspaceIdentity,
    };
    use std::{collections::BTreeMap, fs, io::Read, sync::Mutex};

    #[derive(Clone, Debug, Default, Eq, PartialEq)]
    struct TransactionState {
        disk: BTreeMap<String, String>,
        last_edit_paths: Vec<String>,
        open_buffers: BTreeMap<String, String>,
    }

    struct MemoryAtomicTransaction {
        fail_before_publish: bool,
        state: Mutex<TransactionState>,
    }

    #[derive(Default)]
    struct DescriptorReadingTransaction {
        observed: Option<String>,
    }

    impl AtomicSemanticWorkspaceTransaction for DescriptorReadingTransaction {
        fn commit_prelocked_snapshot_atomically(
            &mut self,
            _workspace: RetainedWorkspaceTransactionCapability<'_>,
            owner: RetainedOwnerTransactionCapability<'_>,
            _edit_json: &[u8],
        ) -> Result<(), String> {
            let mut owner = owner
                .file()
                .try_clone()
                .map_err(|error| error.to_string())?;
            let mut content = String::new();
            owner
                .read_to_string(&mut content)
                .map_err(|error| error.to_string())?;
            self.observed = Some(content);
            Ok(())
        }
    }

    impl AtomicSemanticWorkspaceTransaction for MemoryAtomicTransaction {
        fn commit_prelocked_snapshot_atomically(
            &mut self,
            workspace: RetainedWorkspaceTransactionCapability<'_>,
            owner: RetainedOwnerTransactionCapability<'_>,
            edit_json: &[u8],
        ) -> Result<(), String> {
            let value: serde_json::Value =
                serde_json::from_slice(edit_json).map_err(|error| error.to_string())?;
            let marker = value["changes"]
                .as_object()
                .and_then(|changes| changes.values().next())
                .and_then(serde_json::Value::as_array)
                .and_then(|edits| edits.first())
                .and_then(|edit| edit["newText"].as_str())
                .ok_or_else(|| "missing edit marker".to_string())?
                .to_string();
            let owner_path = owner
                .relative_path()
                .to_str()
                .ok_or_else(|| "owner path is not Unicode".to_string())?;
            let snapshot_owner = value["changes"]
                .as_object()
                .and_then(|changes| changes.keys().next())
                .ok_or_else(|| "missing owner path".to_string())?;
            if snapshot_owner != owner_path {
                return Err("owner capability does not match snapshot".to_string());
            }
            let retained_metadata = workspace
                .open_existing_regular(owner.relative_path())?
                .metadata()
                .map_err(|error| error.to_string())?;
            let owner_metadata = owner.file().metadata().map_err(|error| error.to_string())?;
            #[cfg(unix)]
            if retained_metadata.dev() != owner_metadata.dev()
                || retained_metadata.ino() != owner_metadata.ino()
            {
                return Err("owner identity changed before publication".to_string());
            }
            let mut state = self.state.lock().map_err(|error| error.to_string())?;
            let mut staged = state.clone();
            staged.last_edit_paths = value["changes"]
                .as_object()
                .map(|changes| changes.keys().cloned().collect())
                .unwrap_or_default();
            staged.disk.insert("owner".to_string(), marker.clone());
            staged.open_buffers.insert("owner".to_string(), marker);
            if self.fail_before_publish {
                return Err("injected transaction failure".to_string());
            }
            *state = staged;
            Ok(())
        }
    }

    fn temp_root() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "codevo-semantic-retained-adapter-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("root");
        root
    }

    fn store(
        root: &Path,
        fail_before_publish: bool,
    ) -> RetainedWorkspaceSemanticEditStore<MemoryAtomicTransaction> {
        if !root.join("Owner.php").exists() {
            fs::write(root.join("Owner.php"), "<?php").expect("owner");
        }
        RetainedWorkspaceSemanticEditStore::new(
            File::open(root).expect("retained root"),
            root,
            MemoryAtomicTransaction {
                fail_before_publish,
                state: Mutex::new(TransactionState::default()),
            },
        )
        .expect("store")
    }

    fn edit_for_owner(root: &Path) -> SemanticWorkspaceEdit {
        serde_json::from_value(serde_json::json!({
            "changes": {
                format!("file://{}/Owner.php", root.to_string_lossy()): [{
                    "newText": "changed",
                    "range": {
                        "start": { "line": 0, "character": 0 },
                        "end": { "line": 0, "character": 0 }
                    }
                }]
            },
            "documentVersions": {},
            "fileOperations": []
        }))
        .expect("edit")
    }

    fn materialize_and_commit<Transaction: AtomicSemanticWorkspaceTransaction>(
        store: &mut RetainedWorkspaceSemanticEditStore<Transaction>,
        edit: &SemanticWorkspaceEdit,
        protected: &[&str],
    ) -> Result<(), String> {
        let root_key = store.root_key.to_string_lossy().into_owned();
        let plan = store
            .materialize_owner_edit(&root_key, edit, protected)?
            .into_plan();
        store.commit_atomically(plan)
    }

    #[test]
    fn canonical_aliases_collapse_and_outside_or_remote_targets_fail_closed() {
        let root = temp_root();
        fs::write(root.join("Owner.php"), "<?php").expect("owner");
        let store = store(&root, false);
        let root_key = root.to_string_lossy();
        let direct = format!("file://{root_key}/Owner.php");
        let alias = format!("file://{root_key}/nested/../Owner.php");
        assert_eq!(
            store.canonical_path_key(&root_key, &direct),
            store.canonical_path_key(&root_key, &alias)
        );
        assert!(store
            .canonical_path_key(&root_key, "file:///outside/Owner.php")
            .is_err());
        assert!(store
            .canonical_path_key(&root_key, "file://remote/share/Owner.php")
            .is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn all_symlink_targets_fail_closed() {
        use std::os::unix::fs::symlink;

        let root = temp_root();
        let outside = root.with_extension("outside");
        fs::create_dir_all(&outside).expect("outside");
        fs::write(root.join("Owner.php"), "<?php").expect("owner");
        fs::write(outside.join("Foreign.php"), "<?php").expect("foreign");
        symlink(root.join("Owner.php"), root.join("Alias.php")).expect("inside alias");
        symlink(outside.join("Foreign.php"), root.join("Escape.php")).expect("outside alias");
        let store = store(&root, false);
        let root_key = root.to_string_lossy();
        assert!(store
            .canonical_path_key(&root_key, &format!("file://{root_key}/Alias.php"))
            .is_err());
        assert!(store
            .canonical_path_key(&root_key, &format!("file://{root_key}/Escape.php"))
            .is_err());
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn constructor_rejects_a_root_key_foreign_to_the_retained_descriptor() {
        let root = temp_root();
        let foreign = root.with_extension("foreign");
        fs::create_dir_all(&foreign).expect("foreign");
        let result = RetainedWorkspaceSemanticEditStore::new(
            File::open(&root).expect("retained"),
            &foreign,
            MemoryAtomicTransaction {
                fail_before_publish: false,
                state: Mutex::new(TransactionState::default()),
            },
        );
        assert!(result.is_err());
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(foreign);
    }

    #[test]
    fn retained_descriptor_survives_root_path_replacement() {
        let root = temp_root();
        fs::write(root.join("Owner.php"), "<?php").expect("owner");
        let store = store(&root, false);
        let moved = root.with_extension("moved");
        fs::rename(&root, &moved).expect("move retained root");
        fs::create_dir_all(&root).expect("replacement root");
        let root_key = root.to_string_lossy();
        assert_eq!(
            store
                .canonical_path_key(&root_key, &format!("file://{root_key}/Owner.php"))
                .expect("retained owner"),
            root.join("Owner.php").to_string_lossy()
        );
        let _ = fs::remove_dir_all(&root);
        let _ = fs::rename(&moved, &root);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn transaction_capability_reads_original_file_after_root_replacement() {
        let root = temp_root();
        fs::write(root.join("Owner.php"), "retained").expect("owner");
        let mut store = RetainedWorkspaceSemanticEditStore::new(
            File::open(&root).expect("retained root"),
            &root,
            DescriptorReadingTransaction::default(),
        )
        .expect("store");
        let moved = root.with_extension("moved-capability");
        fs::rename(&root, &moved).expect("move");
        fs::create_dir_all(&root).expect("replacement");
        fs::write(root.join("Owner.php"), "foreign").expect("foreign owner");
        let edit: SemanticWorkspaceEdit = serde_json::from_value(serde_json::json!({
            "changes": {
                format!("file://{}/Owner.php", root.to_string_lossy()): [{
                    "newText": "changed",
                    "range": {
                        "start": { "line": 0, "character": 0 },
                        "end": { "line": 0, "character": 0 }
                    }
                }]
            },
            "documentVersions": {},
            "fileOperations": []
        }))
        .expect("edit");
        materialize_and_commit(&mut store, &edit, &[]).expect("commit");
        assert_eq!(store.transaction().observed.as_deref(), Some("retained"));
        let _ = fs::remove_dir_all(&root);
        let _ = fs::rename(&moved, &root);
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn materialized_owner_descriptor_survives_leaf_symlink_replacement() {
        use std::os::unix::fs::symlink;

        let root = temp_root();
        let outside = root.with_extension("outside-capability");
        fs::create_dir_all(&outside).expect("outside");
        fs::write(root.join("Owner.php"), "retained").expect("owner");
        fs::write(outside.join("Foreign.php"), "foreign").expect("foreign");
        let mut store = RetainedWorkspaceSemanticEditStore::new(
            File::open(&root).expect("retained root"),
            &root,
            DescriptorReadingTransaction::default(),
        )
        .expect("store");
        let plan = store
            .materialize_owner_edit(root.to_string_lossy().as_ref(), &edit_for_owner(&root), &[])
            .expect("materialized")
            .into_plan();
        fs::remove_file(root.join("Owner.php")).expect("remove owner");
        symlink(outside.join("Foreign.php"), root.join("Owner.php")).expect("replace owner");
        store.commit_atomically(plan).expect("retained commit");
        assert_eq!(store.transaction().observed.as_deref(), Some("retained"));
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[cfg(unix)]
    #[test]
    fn memory_transaction_consumes_capability_and_rejects_changed_owner_identity() {
        let root = temp_root();
        fs::write(root.join("Owner.php"), "retained").expect("owner");
        let mut store = store(&root, false);
        let plan = store
            .materialize_owner_edit(root.to_string_lossy().as_ref(), &edit_for_owner(&root), &[])
            .expect("materialized")
            .into_plan();
        fs::remove_file(root.join("Owner.php")).expect("remove owner");
        fs::write(root.join("Owner.php"), "replacement").expect("replacement owner");
        assert!(store.commit_atomically(plan).is_err());
        assert_eq!(
            *store.transaction().state.lock().expect("state"),
            TransactionState::default()
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn transaction_failure_rolls_back_disk_and_open_buffer_stage() {
        let root = temp_root();
        let mut store = store(&root, true);
        let edit: SemanticWorkspaceEdit = serde_json::from_value(serde_json::json!({
            "changes": {
                format!("file://{}/Owner.php", root.to_string_lossy()): [{
                    "newText": "changed",
                    "range": {
                        "start": { "line": 0, "character": 0 },
                        "end": { "line": 0, "character": 0 }
                    }
                }]
            },
            "documentVersions": {},
            "fileOperations": []
        }))
        .expect("edit");
        assert!(materialize_and_commit(&mut store, &edit, &[]).is_err());
        assert_eq!(
            *store.transaction().state.lock().expect("state"),
            TransactionState::default()
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn aliased_duplicate_edit_targets_fail_before_transaction_publication() {
        let root = temp_root();
        fs::write(root.join("Owner.php"), "<?php").expect("owner");
        let mut store = store(&root, false);
        let root_key = root.to_string_lossy();
        let text_edit = serde_json::json!([{
            "newText": "changed",
            "range": {
                "start": { "line": 0, "character": 0 },
                "end": { "line": 0, "character": 0 }
            }
        }]);
        let edit: SemanticWorkspaceEdit = serde_json::from_value(serde_json::json!({
            "changes": {
                format!("file://{root_key}/Owner.php"): text_edit.clone(),
                format!("file://{root_key}/nested/../Owner.php"): text_edit
            },
            "documentVersions": {},
            "fileOperations": []
        }))
        .expect("edit");
        assert!(materialize_and_commit(&mut store, &edit, &[]).is_err());
        assert_eq!(
            *store.transaction().state.lock().expect("state"),
            TransactionState::default()
        );
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn transaction_rechecks_protected_template_after_alias_resolution() {
        use std::os::unix::fs::symlink;

        let root = temp_root();
        let template = root.join("template.latte");
        fs::write(&template, "{control menu}").expect("template");
        symlink(&template, root.join("Alias.latte")).expect("alias");
        let mut store = store(&root, false);
        let edit: SemanticWorkspaceEdit = serde_json::from_value(serde_json::json!({
            "changes": {
                format!("file://{}/Alias.latte", root.to_string_lossy()): [{
                    "newText": "changed",
                    "range": {
                        "start": { "line": 0, "character": 0 },
                        "end": { "line": 0, "character": 0 }
                    }
                }]
            },
            "documentVersions": {},
            "fileOperations": []
        }))
        .expect("edit");
        assert!(
            materialize_and_commit(&mut store, &edit, &[template.to_string_lossy().as_ref()])
                .is_err()
        );
        assert_eq!(
            *store.transaction().state.lock().expect("state"),
            TransactionState::default()
        );
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn protected_template_hardlink_alias_fails_before_publication() {
        let root = temp_root();
        let template = root.join("template.latte");
        fs::write(&template, "{control menu}").expect("template");
        fs::hard_link(&template, root.join("Owner.php")).expect("hardlink alias");
        let mut store = store(&root, false);
        let edit = edit_for_owner(&root);
        assert!(
            materialize_and_commit(&mut store, &edit, &[template.to_string_lossy().as_ref()])
                .is_err()
        );
        assert_eq!(
            *store.transaction().state.lock().expect("state"),
            TransactionState::default()
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn protected_template_outside_the_retained_root_fails_before_publication() {
        let root = temp_root();
        let outside = root.with_extension("outside-protected");
        fs::create_dir_all(&outside).expect("outside");
        fs::write(outside.join("template.latte"), "{control menu}").expect("template");
        let mut store = store(&root, false);
        let edit = edit_for_owner(&root);

        assert!(materialize_and_commit(
            &mut store,
            &edit,
            &[outside.join("template.latte").to_string_lossy().as_ref()]
        )
        .is_err());
        assert_eq!(
            *store.transaction().state.lock().expect("state"),
            TransactionState::default()
        );
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn one_transaction_publishes_disk_and_open_buffer_together() {
        let root = temp_root();
        let mut store = store(&root, false);
        let edit: SemanticWorkspaceEdit = serde_json::from_value(serde_json::json!({
            "changes": {
                format!("file://{}/Owner.php", root.to_string_lossy()): [{
                    "newText": "changed",
                    "range": {
                        "start": { "line": 0, "character": 0 },
                        "end": { "line": 0, "character": 0 }
                    }
                }]
            },
            "documentVersions": {},
            "fileOperations": []
        }))
        .expect("edit");
        materialize_and_commit(&mut store, &edit, &[]).expect("atomic commit");
        let state = store.transaction().state.lock().expect("state").clone();
        assert_eq!(state.disk["owner"], "changed");
        assert_eq!(state.open_buffers["owner"], "changed");
        assert_eq!(state.last_edit_paths, ["Owner.php"]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn foundation_compare_and_commit_uses_one_retained_transaction() {
        let root = temp_root();
        let owner_path = root.join("Owner.php");
        let template_path = root.join("template.latte");
        fs::write(&owner_path, "<?php").expect("owner");
        fs::write(&template_path, "{control menu}").expect("template");
        let epochs = SemanticDocumentHostEpochs::resume(
            PersistedSemanticDocumentHostEpochFloor::restored(40).expect("floor"),
        );
        let owner = epochs
            .closed_identity(
                "sha256:owner".to_string(),
                owner_path.to_string_lossy().into_owned(),
                1,
            )
            .expect("owner identity");
        let template = epochs
            .open_identity(
                "sha256:template".to_string(),
                template_path.to_string_lossy().into_owned(),
                1,
                1,
                1,
            )
            .expect("template identity");
        let root_key = root.to_string_lossy().into_owned();
        let foundation = SemanticWorkspaceEditAtomicCasFoundation::new(
            WorkspaceIdentity::new(1, "workspace-owner".to_string(), root_key.clone(), 1)
                .expect("workspace"),
            [owner, template],
            store(&root, false),
        )
        .expect("foundation");
        let request = serde_json::to_vec(&serde_json::json!({
            "edit": {
                "changes": {
                    format!("file://{}", owner_path.to_string_lossy()): [{
                        "newText": "changed",
                        "range": {
                            "start": { "line": 0, "character": 0 },
                            "end": { "line": 0, "character": 0 }
                        }
                    }]
                },
                "documentVersions": {},
                "fileOperations": []
            },
            "preconditions": {
                "owner": {
                    "kind": "closed",
                    "contentHash": "sha256:owner",
                    "hostEpoch": 41,
                    "pathKey": owner_path,
                    "revision": 1
                },
                "template": {
                    "kind": "open",
                    "contentHash": "sha256:template",
                    "hostEpoch": 42,
                    "lifecycle": 1,
                    "pathKey": template_path,
                    "sessionId": 1,
                    "version": 1
                },
                "workspace": {
                    "generation": 1,
                    "ownerKey": "workspace-owner",
                    "rootKey": root_key,
                    "sessionId": 1
                }
            }
        }))
        .expect("request");
        assert_eq!(
            foundation.compare_and_commit_json(&request),
            SemanticWorkspaceEditAtomicCasDecision::Accepted
        );
        let state = foundation
            .mutate_store(|store| store.transaction().state.lock().expect("state").clone())
            .expect("store");
        assert_eq!(state.disk["owner"], "changed");
        assert_eq!(state.open_buffers["owner"], "changed");
        assert_eq!(state.last_edit_paths, ["Owner.php"]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn host_epoch_issuer_never_reuses_open_close_epochs() {
        let persisted_floor = {
            let epochs = SemanticDocumentHostEpochs::resume(
                PersistedSemanticDocumentHostEpochFloor::restored(40).expect("floor"),
            );
            let open = epochs
                .open_identity(
                    "sha256:open".to_string(),
                    "/workspace/Owner.php".to_string(),
                    1,
                    1,
                    1,
                )
                .expect("open");
            let closed = epochs
                .closed_identity(
                    "sha256:closed".to_string(),
                    "/workspace/Owner.php".to_string(),
                    2,
                )
                .expect("closed");
            assert!(matches!(
                open,
                SemanticDocumentIdentity::Open { host_epoch: 41, .. }
            ));
            assert!(matches!(
                closed,
                SemanticDocumentIdentity::Closed { host_epoch: 42, .. }
            ));
            epochs.last_issued()
        };
        let resumed = SemanticDocumentHostEpochs::resume(
            PersistedSemanticDocumentHostEpochFloor::restored(persisted_floor)
                .expect("restart floor"),
        );
        let after_restart = resumed
            .closed_identity(
                "sha256:restart".to_string(),
                "/workspace/Owner.php".to_string(),
                3,
            )
            .expect("identity after restart");
        assert!(matches!(
            after_restart,
            SemanticDocumentIdentity::Closed { host_epoch: 43, .. }
        ));
        assert!(
            PersistedSemanticDocumentHostEpochFloor::restored(MAX_SAFE_INTEGER).is_err(),
            "an exhausted or unseeded wraparound must fail closed"
        );
    }
}
