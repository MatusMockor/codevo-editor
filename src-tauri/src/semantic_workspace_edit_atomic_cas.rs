#![allow(dead_code)] // Private backend port; no command/UI exposure until native wiring is audited.

use serde::de::{DeserializeOwned, MapAccess, Visitor};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fmt,
    marker::PhantomData,
    path::{Component, Path, PathBuf},
    sync::{Mutex, MutexGuard},
};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
// Shared with the TypeScript authority. Its existing UTF-16/text, URI, operation and identity
// bounds keep the worst valid JSON payload below this explicit transport ceiling.
const MAX_REQUEST_BYTES: usize = 16 * 1024 * 1024;
const MAX_IDENTITY_LENGTH: usize = 4_096;
const MAX_HASH_LENGTH: usize = 256;
const MAX_DOCUMENTS: usize = 32;
const MAX_EDITS: usize = 512;
const MAX_FILE_OPERATIONS: usize = 64;
const MAX_TEXT_CHARACTERS: usize = 1_000_000;
const MAX_URI_CHARACTERS: usize = 4_096;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct SemanticWorkspaceEditAtomicCasRequest {
    edit: SemanticWorkspaceEdit,
    preconditions: SemanticWorkspaceEditPreconditions,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SemanticWorkspaceEditPreconditions {
    owner: SemanticDocumentIdentity,
    template: OpenDocumentIdentity,
    workspace: WorkspaceIdentity,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct WorkspaceIdentity {
    generation: u64,
    owner_key: String,
    root_key: String,
    session_id: u64,
}

impl WorkspaceIdentity {
    pub(crate) fn new(
        generation: u64,
        owner_key: String,
        root_key: String,
        session_id: u64,
    ) -> Result<Self, String> {
        let identity = Self {
            generation,
            owner_key,
            root_key,
            session_id,
        };
        validate_workspace_identity(&identity)?;
        Ok(identity)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(
    tag = "kind",
    deny_unknown_fields,
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum SemanticDocumentIdentity {
    Open {
        content_hash: String,
        host_epoch: u64,
        lifecycle: u64,
        path_key: String,
        session_id: u64,
        version: u64,
    },
    Closed {
        content_hash: String,
        host_epoch: u64,
        path_key: String,
        revision: u64,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct OpenDocumentIdentity {
    content_hash: String,
    host_epoch: u64,
    kind: OpenDocumentKind,
    lifecycle: u64,
    path_key: String,
    session_id: u64,
    version: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
enum OpenDocumentKind {
    Open,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct SemanticWorkspaceEdit {
    #[serde(deserialize_with = "deserialize_unique_btree_map")]
    changes: BTreeMap<String, Vec<SemanticTextEdit>>,
    #[serde(default, deserialize_with = "deserialize_unique_btree_map")]
    document_versions: BTreeMap<String, Option<u64>>,
    #[serde(default)]
    file_operations: Vec<SemanticFileOperation>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SemanticTextEdit {
    new_text: String,
    range: SemanticRange,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct SemanticRange {
    end: SemanticPosition,
    start: SemanticPosition,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
struct SemanticPosition {
    line: u64,
    character: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    deny_unknown_fields,
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum SemanticFileOperation {
    Create {
        uri: String,
        #[serde(default)]
        options: Option<SemanticFileOperationOptions>,
    },
    Delete {
        uri: String,
        #[serde(default)]
        options: Option<SemanticFileOperationOptions>,
    },
    Rename {
        old_uri: String,
        new_uri: String,
        #[serde(default)]
        options: Option<SemanticFileOperationOptions>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SemanticFileOperationOptions {
    #[serde(default)]
    ignore_if_exists: Option<bool>,
    #[serde(default)]
    ignore_if_not_exists: Option<bool>,
    #[serde(default)]
    overwrite: Option<bool>,
    #[serde(default)]
    recursive: Option<bool>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum SemanticWorkspaceEditAtomicCasDecision {
    Accepted,
    Rejected {
        reason: SemanticWorkspaceEditAtomicCasRejection,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SemanticWorkspaceEditAtomicCasRejection {
    AtomicCasUnavailable,
    OwnerChanged,
    TemplateChanged,
    WorkspaceChanged,
}

/// The store is called while the host authority lock is held. Implementations must make
/// `commit` all-or-nothing; a read-then-write implementation does not satisfy this contract.
pub(crate) trait SemanticWorkspaceEditAtomicStore: Send {
    type CommitPlan: Send;

    /// Must resolve aliases to the same path key and reject malformed, non-file, symlink-escaped,
    /// otherwise out-of-root URIs. The returned plan owns every resolved identity needed by the
    /// commit; implementations must not resolve the request URIs again.
    fn materialize_edit(
        &self,
        root_key: &str,
        edit: &SemanticWorkspaceEdit,
        protected_path_keys: &[&str],
    ) -> Result<MaterializedSemanticWorkspaceEdit<Self::CommitPlan>, String>;

    fn commit_atomically(&mut self, plan: Self::CommitPlan) -> Result<(), String>;
}

impl SemanticWorkspaceEdit {
    pub(crate) fn snapshot_json(&self) -> Result<Vec<u8>, String> {
        serde_json::to_vec(self)
            .map_err(|_| "Semantic workspace edit snapshot is unavailable.".to_string())
    }
}

pub(crate) struct MaterializedSemanticWorkspaceEdit<Plan> {
    change_path_keys: BTreeMap<String, String>,
    plan: Plan,
}

impl<Plan> MaterializedSemanticWorkspaceEdit<Plan> {
    pub(crate) fn new(change_path_keys: BTreeMap<String, String>, plan: Plan) -> Self {
        Self {
            change_path_keys,
            plan,
        }
    }

    #[cfg(test)]
    pub(crate) fn into_plan(self) -> Plan {
        self.plan
    }
}

struct HostState<Store> {
    closed_revision_floors: BTreeMap<String, u64>,
    document_epoch_floors: BTreeMap<String, u64>,
    documents: BTreeMap<String, SemanticDocumentIdentity>,
    store: Store,
    workspace: WorkspaceIdentity,
}

/// Private foundation that serializes authority publication, identity comparison, and the
/// atomic-store call in one critical section. The request is decoded and bounded before the lock
/// is acquired, then moved into the critical section so the compared snapshot is exactly the
/// snapshot passed to the writer.
///
/// This type cannot turn a partially mutating store into an atomic one. It must not be registered
/// as application state or exposed through a command until the concrete retained-workspace path
/// policy and transactional store adapter independently prove confinement and rollback. A backend
/// mutex also cannot freeze a live renderer model: an open-template strategy additionally requires
/// a renderer mutation lease spanning compare and commit. Host epochs must come from one
/// registry-owned issuer whose durable floor is persisted before publication.
pub(crate) struct SemanticWorkspaceEditAtomicCasFoundation<Store> {
    state: Mutex<HostState<Store>>,
}

impl<Store: SemanticWorkspaceEditAtomicStore> SemanticWorkspaceEditAtomicCasFoundation<Store> {
    pub(crate) fn new(
        workspace: WorkspaceIdentity,
        documents: impl IntoIterator<Item = SemanticDocumentIdentity>,
        store: Store,
    ) -> Result<Self, String> {
        validate_workspace_identity(&workspace)?;
        let mut closed_revision_floors = BTreeMap::new();
        let mut document_map = BTreeMap::new();
        let mut document_epoch_floors = BTreeMap::new();
        for document in documents {
            validate_document_identity(&document)
                .map_err(|()| "Invalid semantic document identity.".to_string())?;
            let path_key = document.path_key().to_string();
            if !document_path_belongs_to_workspace(&workspace.root_key, &path_key) {
                return Err("Semantic document identity is outside its workspace.".to_string());
            }
            document_epoch_floors.insert(path_key.clone(), document.host_epoch());
            if let SemanticDocumentIdentity::Closed { revision, .. } = &document {
                closed_revision_floors.insert(path_key.clone(), *revision);
            }
            if document_map.insert(path_key, document).is_some() {
                return Err("Duplicate semantic document identity.".to_string());
            }
        }
        Ok(Self {
            state: Mutex::new(HostState {
                closed_revision_floors,
                document_epoch_floors,
                documents: document_map,
                store,
                workspace,
            }),
        })
    }

    pub(crate) fn compare_and_commit_json(
        &self,
        request_json: &[u8],
    ) -> SemanticWorkspaceEditAtomicCasDecision {
        let request = match decode_request(request_json) {
            Ok(request) => request,
            Err(_) => {
                return rejected(SemanticWorkspaceEditAtomicCasRejection::AtomicCasUnavailable)
            }
        };
        let mut state = match self.state.lock() {
            Ok(state) => state,
            Err(_) => {
                return rejected(SemanticWorkspaceEditAtomicCasRejection::AtomicCasUnavailable)
            }
        };

        compare_and_commit(&mut state, request)
    }

    /// Host lifecycle owners must update authority through this same lock.
    pub(crate) fn publish_workspace_identity(
        &self,
        workspace: WorkspaceIdentity,
    ) -> Result<(), String> {
        validate_workspace_identity(&workspace)?;
        let mut state = self.lock_state()?;
        if state.workspace == workspace {
            return Ok(());
        }
        if state.workspace.owner_key != workspace.owner_key
            || state.workspace.root_key != workspace.root_key
            || workspace.generation <= state.workspace.generation
            || workspace.session_id < state.workspace.session_id
        {
            return Err("Semantic workspace identity is not monotonic.".to_string());
        }
        state.workspace = workspace;
        state.documents.clear();
        Ok(())
    }

    /// Publishes an observer snapshot through the CAS gate. Every changed identity, including an
    /// open/closed kind transition, must carry a strictly newer host epoch. The floor survives
    /// removal and successful commits, preventing tombstone and cross-kind ABA.
    pub(crate) fn publish_document_identity(
        &self,
        document: SemanticDocumentIdentity,
    ) -> Result<(), String> {
        validate_document_identity(&document)
            .map_err(|()| "Invalid semantic document identity.".to_string())?;
        let mut state = self.lock_state()?;
        let path_key = document.path_key().to_string();
        if !document_path_belongs_to_workspace(&state.workspace.root_key, &path_key) {
            return Err("Semantic document identity is outside its workspace.".to_string());
        }
        if state.documents.get(&path_key) == Some(&document) {
            return Ok(());
        }
        let host_epoch = document.host_epoch();
        if state
            .document_epoch_floors
            .get(&path_key)
            .is_some_and(|floor| host_epoch <= *floor)
        {
            return Err("Semantic document host epoch is not monotonic.".to_string());
        }
        if let SemanticDocumentIdentity::Closed { revision, .. } = &document {
            if state
                .closed_revision_floors
                .get(&path_key)
                .is_some_and(|floor| revision <= floor)
            {
                return Err("Closed semantic document revision is not monotonic.".to_string());
            }
            state
                .closed_revision_floors
                .insert(path_key.clone(), *revision);
        }
        state
            .document_epoch_floors
            .insert(path_key.clone(), host_epoch);
        state.documents.insert(path_key, document);
        Ok(())
    }

    pub(crate) fn remove_document_identity(&self, path_key: &str) -> Result<(), String> {
        self.lock_state()?.documents.remove(path_key);
        Ok(())
    }

    /// Open-document and filesystem observers must publish through this gate so they cannot race
    /// the compare-and-commit critical section.
    #[cfg(test)]
    pub(crate) fn mutate_store<Output>(
        &self,
        mutation: impl FnOnce(&mut Store) -> Output,
    ) -> Result<Output, String> {
        Ok(mutation(&mut self.lock_state()?.store))
    }

    fn lock_state(&self) -> Result<MutexGuard<'_, HostState<Store>>, String> {
        self.state
            .lock()
            .map_err(|_| "Semantic workspace edit CAS host is unavailable.".to_string())
    }
}

fn decode_request(request_json: &[u8]) -> Result<SemanticWorkspaceEditAtomicCasRequest, ()> {
    if request_json.is_empty() || request_json.len() > MAX_REQUEST_BYTES {
        return Err(());
    }
    let request = serde_json::from_slice::<SemanticWorkspaceEditAtomicCasRequest>(request_json)
        .map_err(|_| ())?;
    validate_preconditions(&request.preconditions)?;
    validate_edit(&request.edit)?;
    if request.preconditions.template.path_key == request.preconditions.owner.path_key() {
        return Err(());
    }
    Ok(request)
}

fn compare_and_commit<Store: SemanticWorkspaceEditAtomicStore>(
    state: &mut HostState<Store>,
    request: SemanticWorkspaceEditAtomicCasRequest,
) -> SemanticWorkspaceEditAtomicCasDecision {
    if state.workspace != request.preconditions.workspace {
        return rejected(SemanticWorkspaceEditAtomicCasRejection::WorkspaceChanged);
    }

    let template = SemanticDocumentIdentity::from(request.preconditions.template);
    let materialized = match state.store.materialize_edit(
        &state.workspace.root_key,
        &request.edit,
        &[template.path_key()],
    ) {
        Ok(plan) => plan,
        Err(_) => return rejected(SemanticWorkspaceEditAtomicCasRejection::AtomicCasUnavailable),
    };
    if !request.edit.file_operations.is_empty()
        || materialized.change_path_keys.len() != 1
        || materialized
            .change_path_keys
            .values()
            .any(|path_key| path_key != request.preconditions.owner.path_key())
    {
        return rejected(SemanticWorkspaceEditAtomicCasRejection::AtomicCasUnavailable);
    }
    if state.documents.get(template.path_key()) != Some(&template) {
        return rejected(SemanticWorkspaceEditAtomicCasRejection::TemplateChanged);
    }

    let owner = request.preconditions.owner;
    if state.documents.get(owner.path_key()) != Some(&owner) {
        return rejected(SemanticWorkspaceEditAtomicCasRejection::OwnerChanged);
    }
    for (uri, expected_version) in &request.edit.document_versions {
        let Some(expected_version) = expected_version else {
            return rejected(SemanticWorkspaceEditAtomicCasRejection::AtomicCasUnavailable);
        };
        let Some(path_key) = materialized.change_path_keys.get(uri) else {
            return rejected(SemanticWorkspaceEditAtomicCasRejection::AtomicCasUnavailable);
        };
        if path_key != owner.path_key() {
            return rejected(SemanticWorkspaceEditAtomicCasRejection::AtomicCasUnavailable);
        }
        let version_matches = matches!(
            &owner,
            SemanticDocumentIdentity::Open { version, .. } if version == expected_version
        );
        if !version_matches {
            return rejected(SemanticWorkspaceEditAtomicCasRejection::AtomicCasUnavailable);
        }
    }

    match state.store.commit_atomically(materialized.plan) {
        Ok(()) => {
            // Invalidate the compared owner in the same critical section as the commit. The host
            // observer must publish the post-write identity before another edit can be accepted.
            state.documents.remove(owner.path_key());
            SemanticWorkspaceEditAtomicCasDecision::Accepted
        }
        Err(_) => rejected(SemanticWorkspaceEditAtomicCasRejection::AtomicCasUnavailable),
    }
}

fn rejected(
    reason: SemanticWorkspaceEditAtomicCasRejection,
) -> SemanticWorkspaceEditAtomicCasDecision {
    SemanticWorkspaceEditAtomicCasDecision::Rejected { reason }
}

impl SemanticDocumentIdentity {
    fn path_key(&self) -> &str {
        match self {
            Self::Open { path_key, .. } | Self::Closed { path_key, .. } => path_key,
        }
    }

    fn host_epoch(&self) -> u64 {
        match self {
            Self::Open { host_epoch, .. } | Self::Closed { host_epoch, .. } => *host_epoch,
        }
    }
}

impl From<OpenDocumentIdentity> for SemanticDocumentIdentity {
    fn from(value: OpenDocumentIdentity) -> Self {
        Self::Open {
            content_hash: value.content_hash,
            host_epoch: value.host_epoch,
            lifecycle: value.lifecycle,
            path_key: value.path_key,
            session_id: value.session_id,
            version: value.version,
        }
    }
}

fn validate_preconditions(preconditions: &SemanticWorkspaceEditPreconditions) -> Result<(), ()> {
    validate_workspace_identity(&preconditions.workspace).map_err(|_| ())?;
    validate_open_identity(&preconditions.template)?;
    validate_document_identity(&preconditions.owner)
}

fn validate_workspace_identity(identity: &WorkspaceIdentity) -> Result<(), String> {
    if valid_identity(&identity.owner_key)
        && valid_identity(&identity.root_key)
        && safe_integer(identity.generation)
        && safe_integer(identity.session_id)
    {
        Ok(())
    } else {
        Err("Invalid semantic workspace identity.".to_string())
    }
}

fn validate_document_identity(identity: &SemanticDocumentIdentity) -> Result<(), ()> {
    match identity {
        SemanticDocumentIdentity::Open {
            content_hash,
            host_epoch,
            lifecycle,
            path_key,
            session_id,
            version,
        } => {
            if valid_hash(content_hash)
                && valid_identity(path_key)
                && safe_integer(*host_epoch)
                && safe_integer(*lifecycle)
                && safe_integer(*session_id)
                && safe_integer(*version)
            {
                Ok(())
            } else {
                Err(())
            }
        }
        SemanticDocumentIdentity::Closed {
            content_hash,
            host_epoch,
            path_key,
            revision,
        } => {
            if valid_hash(content_hash)
                && valid_identity(path_key)
                && safe_integer(*host_epoch)
                && safe_integer(*revision)
            {
                Ok(())
            } else {
                Err(())
            }
        }
    }
}

fn validate_open_identity(identity: &OpenDocumentIdentity) -> Result<(), ()> {
    validate_document_identity(&SemanticDocumentIdentity::Open {
        content_hash: identity.content_hash.clone(),
        host_epoch: identity.host_epoch,
        lifecycle: identity.lifecycle,
        path_key: identity.path_key.clone(),
        session_id: identity.session_id,
        version: identity.version,
    })
}

fn validate_edit(edit: &SemanticWorkspaceEdit) -> Result<(), ()> {
    if edit.changes.len() > MAX_DOCUMENTS
        || edit.file_operations.len() > MAX_FILE_OPERATIONS
        || (edit.changes.is_empty() && edit.file_operations.is_empty())
        || edit
            .document_versions
            .keys()
            .any(|uri| !edit.changes.contains_key(uri))
    {
        return Err(());
    }

    let mut edit_count = 0usize;
    let mut text_characters = 0usize;
    for (uri, edits) in &edit.changes {
        if !valid_text(uri, MAX_URI_CHARACTERS) || edits.is_empty() {
            return Err(());
        }
        for edit in edits {
            if edit.range.end < edit.range.start {
                return Err(());
            }
            edit_count = edit_count.checked_add(1).ok_or(())?;
            text_characters = text_characters
                .checked_add(edit.new_text.encode_utf16().count())
                .ok_or(())?;
            if edit_count > MAX_EDITS
                || text_characters > MAX_TEXT_CHARACTERS
                || edit.new_text.encode_utf16().count() > MAX_TEXT_CHARACTERS
                || !safe_integer(edit.range.start.line)
                || !safe_integer(edit.range.start.character)
                || !safe_integer(edit.range.end.line)
                || !safe_integer(edit.range.end.character)
            {
                return Err(());
            }
        }
    }
    if edit
        .document_versions
        .values()
        .any(|version| version.is_none_or(|version| !safe_integer(version)))
    {
        return Err(());
    }
    for operation in &edit.file_operations {
        match operation {
            SemanticFileOperation::Create { uri, .. }
            | SemanticFileOperation::Delete { uri, .. } => {
                if !valid_text(uri, MAX_URI_CHARACTERS) {
                    return Err(());
                }
            }
            SemanticFileOperation::Rename {
                old_uri, new_uri, ..
            } => {
                if !valid_text(old_uri, MAX_URI_CHARACTERS)
                    || !valid_text(new_uri, MAX_URI_CHARACTERS)
                {
                    return Err(());
                }
            }
        }
    }
    Ok(())
}

fn valid_identity(value: &str) -> bool {
    valid_text(value, MAX_IDENTITY_LENGTH)
}

fn valid_hash(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_HASH_LENGTH
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b':' | b'_' | b'-'))
}

fn valid_text(value: &str, max_characters: usize) -> bool {
    !value.is_empty()
        && value.encode_utf16().count() <= max_characters
        && !value.chars().any(char::is_control)
}

fn safe_integer(value: u64) -> bool {
    value <= MAX_SAFE_INTEGER
}

fn document_path_belongs_to_workspace(root_key: &str, path_key: &str) -> bool {
    let root = Path::new(root_key);
    let path = Path::new(path_key);

    root.is_absolute()
        && path.is_absolute()
        && path != root
        && normalized_path(root)
        && normalized_path(path)
        && path.starts_with(root)
}

fn normalized_path(path: &Path) -> bool {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        if matches!(component, Component::CurDir | Component::ParentDir) {
            return false;
        }
        normalized.push(component.as_os_str());
    }

    normalized.as_os_str() == path.as_os_str()
}

fn deserialize_unique_btree_map<'de, Deserializer, Key, Value>(
    deserializer: Deserializer,
) -> Result<BTreeMap<Key, Value>, Deserializer::Error>
where
    Deserializer: serde::Deserializer<'de>,
    Key: DeserializeOwned + Ord,
    Value: DeserializeOwned,
{
    struct UniqueMapVisitor<Key, Value>(PhantomData<(Key, Value)>);

    impl<'de, Key, Value> Visitor<'de> for UniqueMapVisitor<Key, Value>
    where
        Key: DeserializeOwned + Ord,
        Value: DeserializeOwned,
    {
        type Value = BTreeMap<Key, Value>;

        fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str("a map with unique keys")
        }

        fn visit_map<Access>(self, mut access: Access) -> Result<Self::Value, Access::Error>
        where
            Access: MapAccess<'de>,
        {
            let mut values = BTreeMap::new();
            while let Some((key, value)) = access.next_entry()? {
                if values.insert(key, value).is_some() {
                    return Err(serde::de::Error::custom("duplicate map key"));
                }
            }
            Ok(values)
        }
    }

    deserializer.deserialize_map(UniqueMapVisitor(PhantomData))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Condvar,
        },
        thread,
        time::Duration,
    };

    #[derive(Default)]
    struct MemoryStore {
        committed: Vec<SemanticWorkspaceEdit>,
        fail_commit: bool,
    }

    impl SemanticWorkspaceEditAtomicStore for MemoryStore {
        type CommitPlan = SemanticWorkspaceEdit;

        fn materialize_edit(
            &self,
            root_key: &str,
            edit: &SemanticWorkspaceEdit,
            protected_path_keys: &[&str],
        ) -> Result<MaterializedSemanticWorkspaceEdit<Self::CommitPlan>, String> {
            let mut change_path_keys = BTreeMap::new();
            for uri in edit.changes.keys() {
                let path_key = canonical_test_path(root_key, uri)?;
                if protected_path_keys.contains(&path_key.as_str()) {
                    return Err("protected target".to_string());
                }
                change_path_keys.insert(uri.clone(), path_key);
            }
            Ok(MaterializedSemanticWorkspaceEdit::new(
                change_path_keys,
                edit.clone(),
            ))
        }

        fn commit_atomically(&mut self, edit: Self::CommitPlan) -> Result<(), String> {
            if self.fail_commit {
                return Err("commit failed".to_string());
            }
            self.committed.push(edit);
            Ok(())
        }
    }

    fn workspace() -> WorkspaceIdentity {
        WorkspaceIdentity {
            generation: 4,
            owner_key: "workspace-owner".to_string(),
            root_key: "/workspace".to_string(),
            session_id: 7,
        }
    }

    fn owner(revision: u64) -> SemanticDocumentIdentity {
        SemanticDocumentIdentity::Closed {
            content_hash: "sha256:owner".to_string(),
            host_epoch: revision,
            path_key: "/workspace/HomePresenter.php".to_string(),
            revision,
        }
    }

    fn template() -> SemanticDocumentIdentity {
        SemanticDocumentIdentity::Open {
            content_hash: "sha256:template".to_string(),
            host_epoch: 3,
            lifecycle: 3,
            path_key: "/workspace/default.latte".to_string(),
            session_id: 9,
            version: 11,
        }
    }

    fn open_owner(
        host_epoch: u64,
        lifecycle: u64,
        session_id: u64,
        version: u64,
    ) -> SemanticDocumentIdentity {
        SemanticDocumentIdentity::Open {
            content_hash: "sha256:owner".to_string(),
            host_epoch,
            lifecycle,
            path_key: "/workspace/HomePresenter.php".to_string(),
            session_id,
            version,
        }
    }

    fn host() -> SemanticWorkspaceEditAtomicCasFoundation<MemoryStore> {
        SemanticWorkspaceEditAtomicCasFoundation::new(
            workspace(),
            [owner(5), template()],
            MemoryStore::default(),
        )
        .expect("host")
    }

    fn request_json() -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "edit": {
                "changes": {
                    "file:///workspace/HomePresenter.php": [{
                        "newText": "protected function createComponentMenu(): MenuControl {}",
                        "range": {
                            "start": { "line": 10, "character": 0 },
                            "end": { "line": 10, "character": 0 }
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
                    "hostEpoch": 5,
                    "pathKey": "/workspace/HomePresenter.php",
                    "revision": 5
                },
                "template": {
                    "kind": "open",
                    "contentHash": "sha256:template",
                    "hostEpoch": 3,
                    "lifecycle": 3,
                    "pathKey": "/workspace/default.latte",
                    "sessionId": 9,
                    "version": 11
                },
                "workspace": {
                    "generation": 4,
                    "ownerKey": "workspace-owner",
                    "rootKey": "/workspace",
                    "sessionId": 7
                }
            }
        }))
        .expect("request")
    }

    #[test]
    fn commits_only_after_all_authorities_match() {
        let host = host();
        assert_eq!(
            host.compare_and_commit_json(&request_json()),
            SemanticWorkspaceEditAtomicCasDecision::Accepted
        );
        let committed = host
            .mutate_store(|store| store.committed.len())
            .expect("store");
        assert_eq!(committed, 1);
    }

    #[test]
    fn successful_commit_invalidates_owner_before_lock_release() {
        let host = host();
        assert_eq!(
            host.compare_and_commit_json(&request_json()),
            SemanticWorkspaceEditAtomicCasDecision::Accepted
        );
        assert_eq!(
            host.compare_and_commit_json(&request_json()),
            rejected(SemanticWorkspaceEditAtomicCasRejection::OwnerChanged)
        );
        assert_eq!(
            host.mutate_store(|store| store.committed.len())
                .expect("store"),
            1
        );
    }

    #[test]
    fn closed_owner_revision_prevents_same_hash_aba() {
        let host = host();
        host.publish_document_identity(SemanticDocumentIdentity::Closed {
            content_hash: "sha256:owner".to_string(),
            host_epoch: 6,
            path_key: owner(6).path_key().to_string(),
            revision: 6,
        })
        .expect("mutation");

        assert_eq!(
            host.compare_and_commit_json(&request_json()),
            rejected(SemanticWorkspaceEditAtomicCasRejection::OwnerChanged)
        );
    }

    #[test]
    fn rejects_each_stale_authority_without_calling_commit() {
        let cases = [
            (
                "workspace",
                SemanticWorkspaceEditAtomicCasRejection::WorkspaceChanged,
            ),
            (
                "template",
                SemanticWorkspaceEditAtomicCasRejection::TemplateChanged,
            ),
            (
                "owner",
                SemanticWorkspaceEditAtomicCasRejection::OwnerChanged,
            ),
        ];
        for (case, expected) in cases {
            let host = host();
            match case {
                "workspace" => host
                    .publish_workspace_identity(WorkspaceIdentity {
                        generation: 5,
                        ..workspace()
                    })
                    .expect("workspace"),
                "template" => host
                    .remove_document_identity(template().path_key())
                    .expect("template"),
                "owner" => host
                    .remove_document_identity(owner(5).path_key())
                    .expect("owner"),
                _ => unreachable!(),
            }
            assert_eq!(
                host.compare_and_commit_json(&request_json()),
                rejected(expected)
            );
            assert_eq!(
                host.mutate_store(|store| store.committed.len())
                    .expect("store"),
                0
            );
        }
    }

    #[test]
    fn strict_decoder_and_bounds_fail_closed() {
        let host = host();
        for request in [
            br#"{"edit":{},"preconditions":{},"extra":true}"#.as_slice(),
            br#"{"edit":{"changes":{},"documentVersions":{},"fileOperations":[]},"preconditions":{"owner":{"kind":"closed","contentHash":"sha256:owner","hostEpoch":5,"pathKey":"/workspace/HomePresenter.php","revision":5},"template":{"kind":"open","contentHash":"sha256:template","hostEpoch":3,"lifecycle":3,"pathKey":"/workspace/default.latte","sessionId":9,"version":11},"workspace":{"generation":4,"ownerKey":"workspace-owner","rootKey":"/workspace","sessionId":7}}}"#.as_slice(),
            br#"{"edit":{"changes":{"file:///workspace/./default.latte":[{"newText":"x","range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}}}]},"preconditions":{"owner":{"kind":"closed","contentHash":"sha256:owner","hostEpoch":5,"pathKey":"/workspace/HomePresenter.php","revision":5},"template":{"kind":"open","contentHash":"sha256:template","hostEpoch":3,"lifecycle":3,"pathKey":"/workspace/default.latte","sessionId":9,"version":11},"workspace":{"generation":4,"ownerKey":"workspace-owner","rootKey":"/workspace","sessionId":7}}}"#.as_slice(),
        ] {
            assert_eq!(
                host.compare_and_commit_json(request),
                rejected(SemanticWorkspaceEditAtomicCasRejection::AtomicCasUnavailable)
            );
        }
        assert_eq!(
            host.mutate_store(|store| store.committed.len())
                .expect("store"),
            0
        );
    }

    #[test]
    fn decoder_rejects_null_versions_and_unicode_control_identity_text() {
        let mut null_version: serde_json::Value =
            serde_json::from_slice(&request_json()).expect("request");
        null_version["edit"]["documentVersions"] =
            serde_json::json!({ "file:///workspace/HomePresenter.php": null });
        assert_eq!(
            host().compare_and_commit_json(&serde_json::to_vec(&null_version).expect("wire")),
            rejected(SemanticWorkspaceEditAtomicCasRejection::AtomicCasUnavailable)
        );

        let mut control_identity: serde_json::Value =
            serde_json::from_slice(&request_json()).expect("request");
        control_identity["preconditions"]["workspace"]["ownerKey"] =
            serde_json::Value::String("workspace\u{0085}owner".to_string());
        assert_eq!(
            host().compare_and_commit_json(
                &serde_json::to_vec(&control_identity).expect("control wire")
            ),
            rejected(SemanticWorkspaceEditAtomicCasRejection::AtomicCasUnavailable)
        );
    }

    #[test]
    fn commit_failure_is_rejected_and_never_reported_as_accepted() {
        let host = host();
        host.mutate_store(|store| store.fail_commit = true)
            .expect("store");
        assert_eq!(
            host.compare_and_commit_json(&request_json()),
            rejected(SemanticWorkspaceEditAtomicCasRejection::AtomicCasUnavailable)
        );
    }

    struct BlockingStore {
        gate: Arc<(Mutex<bool>, Condvar)>,
    }

    impl SemanticWorkspaceEditAtomicStore for BlockingStore {
        type CommitPlan = SemanticWorkspaceEdit;

        fn materialize_edit(
            &self,
            root_key: &str,
            edit: &SemanticWorkspaceEdit,
            protected_path_keys: &[&str],
        ) -> Result<MaterializedSemanticWorkspaceEdit<Self::CommitPlan>, String> {
            let mut change_path_keys = BTreeMap::new();
            for uri in edit.changes.keys() {
                let path_key = canonical_test_path(root_key, uri)?;
                if protected_path_keys.contains(&path_key.as_str()) {
                    return Err("protected target".to_string());
                }
                change_path_keys.insert(uri.clone(), path_key);
            }
            Ok(MaterializedSemanticWorkspaceEdit::new(
                change_path_keys,
                edit.clone(),
            ))
        }

        fn commit_atomically(&mut self, _edit: Self::CommitPlan) -> Result<(), String> {
            let (lock, ready) = &*self.gate;
            let mut released = lock.lock().expect("gate");
            ready.notify_all();
            while !*released {
                released = ready.wait(released).expect("wait");
            }
            Ok(())
        }
    }

    #[test]
    fn identity_publication_cannot_interleave_with_commit() {
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let host = Arc::new(
            SemanticWorkspaceEditAtomicCasFoundation::new(
                workspace(),
                [owner(5), template()],
                BlockingStore {
                    gate: Arc::clone(&gate),
                },
            )
            .expect("host"),
        );
        let commit_host = Arc::clone(&host);
        let commit = thread::spawn(move || commit_host.compare_and_commit_json(&request_json()));

        let (gate_lock, ready) = &*gate;
        let released = gate_lock.lock().expect("gate");
        let mut released = ready
            .wait_timeout_while(released, Duration::from_secs(1), |released| !*released)
            .expect("wait")
            .0;
        let mutation_started = Arc::new(AtomicBool::new(false));
        let mutation_finished = Arc::new(AtomicBool::new(false));
        let mutation_host = Arc::clone(&host);
        let started = Arc::clone(&mutation_started);
        let finished = Arc::clone(&mutation_finished);
        let mutation = thread::spawn(move || {
            started.store(true, Ordering::SeqCst);
            mutation_host
                .remove_document_identity(owner(5).path_key())
                .expect("mutation");
            finished.store(true, Ordering::SeqCst);
        });
        while !mutation_started.load(Ordering::SeqCst) {
            thread::yield_now();
        }
        thread::sleep(Duration::from_millis(20));
        assert!(!mutation_finished.load(Ordering::SeqCst));
        *released = true;
        ready.notify_all();
        drop(released);

        assert_eq!(
            commit.join().expect("commit"),
            SemanticWorkspaceEditAtomicCasDecision::Accepted
        );
        mutation.join().expect("mutation");
        assert!(mutation_finished.load(Ordering::SeqCst));
    }

    #[test]
    fn decoder_rejects_duplicate_struct_fields() {
        let duplicated = String::from_utf8(request_json()).expect("utf8").replacen(
            "\"generation\":4",
            "\"generation\":4,\"generation\":4",
            1,
        );
        assert_eq!(
            host().compare_and_commit_json(duplicated.as_bytes()),
            rejected(SemanticWorkspaceEditAtomicCasRejection::AtomicCasUnavailable)
        );
    }

    #[test]
    fn decoder_rejects_duplicate_change_map_keys_and_oversized_wire_payloads() {
        let duplicated = String::from_utf8(request_json()).expect("utf8").replacen(
            "\"changes\":{\"file:///workspace/HomePresenter.php\":",
            "\"changes\":{\"file:///workspace/HomePresenter.php\":[],\"file:///workspace/HomePresenter.php\":",
            1,
        );
        assert_eq!(
            host().compare_and_commit_json(duplicated.as_bytes()),
            rejected(SemanticWorkspaceEditAtomicCasRejection::AtomicCasUnavailable)
        );
        assert_eq!(
            host().compare_and_commit_json(&vec![b' '; MAX_REQUEST_BYTES + 1]),
            rejected(SemanticWorkspaceEditAtomicCasRejection::AtomicCasUnavailable)
        );
    }

    #[test]
    fn shared_wire_ceiling_accepts_worst_case_escaped_valid_text() {
        let mut request: serde_json::Value =
            serde_json::from_slice(&request_json()).expect("request");
        request["edit"]["changes"]["file:///workspace/HomePresenter.php"][0]["newText"] =
            serde_json::Value::String("\0".repeat(MAX_TEXT_CHARACTERS));
        let wire = serde_json::to_vec(&request).expect("wire");
        assert!(wire.len() > 4_500_000);
        assert!(wire.len() < MAX_REQUEST_BYTES);
        assert_eq!(
            host().compare_and_commit_json(&wire),
            SemanticWorkspaceEditAtomicCasDecision::Accepted
        );
    }

    #[test]
    fn owner_only_scope_rejects_file_operations() {
        let request = String::from_utf8(request_json())
            .expect("utf8")
            .replacen(
                "\"fileOperations\":[]",
                "\"fileOperations\":[{\"kind\":\"create\",\"uri\":\"/workspace/new.php\",\"options\":{\"overwrite\":false}}]",
                1,
            );
        assert_eq!(
            host().compare_and_commit_json(request.as_bytes()),
            rejected(SemanticWorkspaceEditAtomicCasRejection::AtomicCasUnavailable)
        );
    }

    #[test]
    fn empty_document_versions_do_not_authorize_a_foreign_change() {
        let mut request: serde_json::Value =
            serde_json::from_slice(&request_json()).expect("request");
        let changes = request["edit"]["changes"].as_object_mut().expect("changes");
        let edits = changes
            .remove("file:///workspace/HomePresenter.php")
            .expect("owner edits");
        changes.insert("file:///workspace/Other.php".to_string(), edits);
        assert_eq!(
            host().compare_and_commit_json(&serde_json::to_vec(&request).expect("wire")),
            rejected(SemanticWorkspaceEditAtomicCasRejection::AtomicCasUnavailable)
        );
    }

    #[test]
    fn invalid_workspace_identity_is_refused_at_construction() {
        assert!(SemanticWorkspaceEditAtomicCasFoundation::new(
            WorkspaceIdentity {
                generation: MAX_SAFE_INTEGER + 1,
                ..workspace()
            },
            [],
            MemoryStore::default()
        )
        .is_err());
    }

    #[test]
    fn document_admission_rejects_identities_outside_the_workspace() {
        let outside_owner = SemanticDocumentIdentity::Closed {
            content_hash: "sha256:owner".to_string(),
            host_epoch: 5,
            path_key: "/outside/HomePresenter.php".to_string(),
            revision: 5,
        };
        assert!(SemanticWorkspaceEditAtomicCasFoundation::new(
            workspace(),
            [outside_owner, template()],
            MemoryStore::default()
        )
        .is_err());
        assert!(SemanticWorkspaceEditAtomicCasFoundation::new(
            workspace(),
            [
                SemanticDocumentIdentity::Closed {
                    content_hash: "sha256:owner".to_string(),
                    host_epoch: 5,
                    path_key: "/workspace/./HomePresenter.php".to_string(),
                    revision: 5,
                },
                template()
            ],
            MemoryStore::default()
        )
        .is_err());

        let host = host();
        assert!(host
            .publish_document_identity(SemanticDocumentIdentity::Open {
                content_hash: "sha256:template".to_string(),
                host_epoch: 4,
                lifecycle: 4,
                path_key: "/outside/default.latte".to_string(),
                session_id: 9,
                version: 12,
            })
            .is_err());
    }

    #[test]
    fn document_versions_must_belong_to_changed_documents() {
        let request = String::from_utf8(request_json()).expect("utf8").replacen(
            "\"documentVersions\":{}",
            "\"documentVersions\":{\"/workspace/foreign.php\":1}",
            1,
        );
        assert_eq!(
            host().compare_and_commit_json(request.as_bytes()),
            rejected(SemanticWorkspaceEditAtomicCasRejection::AtomicCasUnavailable)
        );
    }

    #[test]
    fn document_versions_outside_the_fully_bound_owner_fail_closed() {
        let current_host = host();
        let other = SemanticDocumentIdentity::Open {
            content_hash: "sha256:other".to_string(),
            host_epoch: 2,
            lifecycle: 2,
            path_key: "/workspace/Other.php".to_string(),
            session_id: 12,
            version: 3,
        };
        current_host
            .publish_document_identity(other)
            .expect("other document");
        let mut request: serde_json::Value =
            serde_json::from_slice(&request_json()).expect("request value");
        let edit = request
            .get_mut("edit")
            .and_then(serde_json::Value::as_object_mut)
            .expect("edit");
        edit.get_mut("changes")
            .and_then(serde_json::Value::as_object_mut)
            .expect("changes")
            .insert(
                "file:///workspace/Other.php".to_string(),
                serde_json::json!([{
                    "newText": " ",
                    "range": {
                        "start": { "line": 0, "character": 0 },
                        "end": { "line": 0, "character": 0 }
                    }
                }]),
            );
        edit.insert(
            "documentVersions".to_string(),
            serde_json::json!({ "file:///workspace/Other.php": 3 }),
        );
        assert_eq!(
            current_host.compare_and_commit_json(&serde_json::to_vec(&request).expect("request")),
            rejected(SemanticWorkspaceEditAtomicCasRejection::AtomicCasUnavailable)
        );
    }

    #[test]
    fn owner_document_version_is_bound_to_full_open_identity() {
        let host = SemanticWorkspaceEditAtomicCasFoundation::new(
            workspace(),
            [open_owner(5, 4, 12, 7), template()],
            MemoryStore::default(),
        )
        .expect("host");
        let mut request: serde_json::Value =
            serde_json::from_slice(&request_json()).expect("request value");
        request["preconditions"]["owner"] = serde_json::json!({
            "kind": "open",
            "contentHash": "sha256:owner",
            "hostEpoch": 5,
            "lifecycle": 4,
            "pathKey": "/workspace/HomePresenter.php",
            "sessionId": 12,
            "version": 7
        });
        request["edit"]["documentVersions"] =
            serde_json::json!({ "file:///workspace/HomePresenter.php": 7 });
        assert_eq!(
            host.compare_and_commit_json(&serde_json::to_vec(&request).expect("request")),
            SemanticWorkspaceEditAtomicCasDecision::Accepted
        );

        let stale_host = SemanticWorkspaceEditAtomicCasFoundation::new(
            workspace(),
            [open_owner(5, 4, 13, 7), template()],
            MemoryStore::default(),
        )
        .expect("stale host");
        assert_eq!(
            stale_host
                .compare_and_commit_json(&serde_json::to_vec(&request).expect("stale request")),
            rejected(SemanticWorkspaceEditAtomicCasRejection::OwnerChanged)
        );
    }

    #[test]
    fn canonical_policy_rejects_outside_change_and_file_operation_targets() {
        for needle in [
            "file:///outside/Foreign.php",
            "/workspace/../outside/Foreign.php",
        ] {
            let outside_change = String::from_utf8(request_json())
                .expect("utf8")
                .replace("file:///workspace/HomePresenter.php", needle);
            assert_eq!(
                host().compare_and_commit_json(outside_change.as_bytes()),
                rejected(SemanticWorkspaceEditAtomicCasRejection::AtomicCasUnavailable)
            );
        }

        let outside_operation = String::from_utf8(request_json()).expect("utf8").replacen(
            "\"fileOperations\":[]",
            "\"fileOperations\":[{\"kind\":\"create\",\"uri\":\"file:///outside/new.php\"}]",
            1,
        );
        assert_eq!(
            host().compare_and_commit_json(outside_operation.as_bytes()),
            rejected(SemanticWorkspaceEditAtomicCasRejection::AtomicCasUnavailable)
        );

        let template_alias_operation = String::from_utf8(request_json())
            .expect("utf8")
            .replacen(
                "\"fileOperations\":[]",
                "\"fileOperations\":[{\"kind\":\"delete\",\"uri\":\"file:///workspace/./default.latte\"}]",
                1,
            );
        assert_eq!(
            host().compare_and_commit_json(template_alias_operation.as_bytes()),
            rejected(SemanticWorkspaceEditAtomicCasRejection::AtomicCasUnavailable)
        );
    }

    #[test]
    fn workspace_identity_publication_cannot_roll_back_or_change_owner() {
        let host = host();
        host.publish_workspace_identity(WorkspaceIdentity {
            generation: 5,
            session_id: 8,
            ..workspace()
        })
        .expect("new identity");
        assert!(host.publish_workspace_identity(workspace()).is_err());
        assert!(host
            .publish_workspace_identity(WorkspaceIdentity {
                generation: 6,
                owner_key: "foreign-owner".to_string(),
                session_id: 9,
                ..workspace()
            })
            .is_err());
    }

    #[test]
    fn workspace_transition_atomically_invalidates_old_documents_and_preserves_floors() {
        let host = host();
        let next_workspace = WorkspaceIdentity {
            generation: 5,
            session_id: 8,
            ..workspace()
        };
        host.publish_workspace_identity(next_workspace.clone())
            .expect("new workspace identity");

        let mut request: serde_json::Value =
            serde_json::from_slice(&request_json()).expect("request");
        request["preconditions"]["workspace"] = serde_json::json!({
            "generation": 5,
            "ownerKey": "workspace-owner",
            "rootKey": "/workspace",
            "sessionId": 8
        });
        assert_eq!(
            host.compare_and_commit_json(&serde_json::to_vec(&request).expect("request wire")),
            rejected(SemanticWorkspaceEditAtomicCasRejection::TemplateChanged)
        );
        assert!(
            host.publish_document_identity(owner(5)).is_err(),
            "workspace transition must retain the old epoch and revision floors"
        );
        assert_eq!(
            host.mutate_store(|store| store.committed.len())
                .expect("store"),
            0
        );
    }

    #[test]
    fn host_mutations_share_the_cas_gate() {
        let host = host();
        host.publish_workspace_identity(workspace())
            .expect("workspace identity");
        assert_eq!(
            host.mutate_store(|store| store.committed.len())
                .expect("store"),
            0
        );
    }

    #[test]
    fn closed_revision_floor_survives_identity_removal() {
        let host = host();
        host.remove_document_identity(owner(5).path_key())
            .expect("remove");
        assert!(host.publish_document_identity(owner(5)).is_err());
        host.publish_document_identity(owner(6))
            .expect("newer revision");
    }

    #[test]
    fn host_epoch_floor_survives_open_closed_transitions_and_commit_tombstones() {
        let foundation = host();
        foundation
            .remove_document_identity(owner(5).path_key())
            .expect("remove");
        assert!(foundation
            .publish_document_identity(open_owner(5, 1, 1, 1))
            .is_err());
        foundation
            .publish_document_identity(open_owner(6, 1, 1, 1))
            .expect("newer open epoch");
        foundation
            .remove_document_identity(owner(5).path_key())
            .expect("remove open");
        assert!(foundation
            .publish_document_identity(SemanticDocumentIdentity::Closed {
                content_hash: "sha256:owner".to_string(),
                host_epoch: 6,
                path_key: owner(5).path_key().to_string(),
                revision: 99,
            })
            .is_err());
        assert!(foundation
            .publish_document_identity(SemanticDocumentIdentity::Closed {
                content_hash: "sha256:owner".to_string(),
                host_epoch: 7,
                path_key: owner(5).path_key().to_string(),
                revision: 4,
            })
            .is_err());

        let committed = host();
        assert_eq!(
            committed.compare_and_commit_json(&request_json()),
            SemanticWorkspaceEditAtomicCasDecision::Accepted
        );
        assert!(committed.publish_document_identity(owner(5)).is_err());
    }

    #[test]
    fn decisions_serialize_to_the_strict_frontend_port_shape() {
        assert_eq!(
            serde_json::to_value(SemanticWorkspaceEditAtomicCasDecision::Accepted)
                .expect("accepted"),
            serde_json::json!({ "kind": "accepted" })
        );
        assert_eq!(
            serde_json::to_value(rejected(
                SemanticWorkspaceEditAtomicCasRejection::OwnerChanged
            ))
            .expect("rejected"),
            serde_json::json!({ "kind": "rejected", "reason": "ownerChanged" })
        );
    }

    fn canonical_test_path(root_key: &str, uri: &str) -> Result<String, String> {
        let raw = uri.strip_prefix("file://").unwrap_or(uri);
        let mut components = Vec::new();
        for component in raw.split('/') {
            match component {
                "" if components.is_empty() => components.push(""),
                "" | "." => {}
                ".." => return Err("parent traversal".to_string()),
                component => components.push(component),
            }
        }
        let canonical = components.join("/");
        if canonical != root_key
            && !canonical
                .strip_prefix(root_key)
                .is_some_and(|suffix| suffix.starts_with('/'))
        {
            return Err("outside workspace".to_string());
        }
        Ok(canonical)
    }
}
