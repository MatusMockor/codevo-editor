use crate::blocking_command::run_blocking_command;
use crate::lsp::{file_uri, JsonRpcNotification};
use crate::lsp_session::{
    ExactSessionNotificationOutcome, JavaScriptTypeScriptLanguageServerRegistry,
};
use crate::{
    absolute_workspace_candidate, canonicalize_workspace_root, resolve_existing_or_parent_path,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;
use std::sync::{Condvar, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager};

pub const MAX_CHANGE_COUNT: usize = 256;
pub const MAX_CHANGE_TEXT_BYTES: usize = 256 * 1024;
pub const MAX_CHANGE_TEXT_BYTES_PER_BATCH: usize = 512 * 1024;
pub const MAX_FULL_TEXT_UTF16_UNITS: usize = 2 * 1024 * 1024;
pub const MAX_FULL_TEXT_UTF8_BYTES: usize = 6 * 1024 * 1024;
pub const MAX_PATH_BYTES: usize = 4_096;
pub const MAX_TOKEN_BYTES: usize = 4_096;
pub const MAX_SAFE_JAVASCRIPT_INTEGER: u64 = 9_007_199_254_740_991;
pub const MAX_LSP_UINTEGER: u64 = i32::MAX as u64;
pub const MAX_ADMITTED_DOCUMENTS: usize = 4_096;
const LIFECYCLE_TOKEN_RANDOM_BYTES: usize = 16;
const MAX_LIFECYCLE_TOKEN_COLLISION_ATTEMPTS: usize = 8;
const MAX_SESSION_ROOTS: usize = 4_096;
const DOCUMENT_LIFECYCLE_WAIT_TIMEOUT: Duration = Duration::from_secs(5);

pub fn canonical_document_identity(
    root_path: &str,
    path: &str,
) -> Result<(String, String), String> {
    let root = canonicalize_workspace_root(root_path)?;
    let absolute = absolute_workspace_candidate(&root, path);
    let resolved = resolve_existing_or_parent_path(&absolute)?;
    if !resolved.starts_with(&root) {
        return Err("Path is outside the workspace root.".to_string());
    }
    Ok((
        root.to_string_lossy().into_owned(),
        resolved.to_string_lossy().into_owned(),
    ))
}

#[tauri::command]
pub async fn javascript_typescript_document_did_open_bounded(
    request: BoundedDocumentDidOpenRequest,
    app: AppHandle,
) -> Result<DocumentOpenAdmissionReceipt, String> {
    run_blocking_command(move || {
        request.validate()?;
        let (canonical_root_path, canonical_path) =
            canonical_document_identity(&request.root_path, &request.path)?;
        let registry = app.state::<JavaScriptTypeScriptLanguageServerRegistry>();
        let admission = app.state::<DocumentChangeAdmissionRegistry>();
        deliver_validated_document_open(
            &admission,
            &request,
            &canonical_root_path,
            &canonical_path,
            |notification| {
                registry
                    .send_notification_for_session_outcome(
                        &canonical_root_path,
                        request.expected_session_id,
                        notification,
                    )
                    .map(|outcome| outcome == ExactSessionNotificationOutcome::Admitted)
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn javascript_typescript_document_did_change_bounded(
    request: BoundedDocumentDidChangeRequest,
    app: AppHandle,
) -> Result<DocumentChangeAdmissionReceipt, String> {
    run_blocking_command(move || {
        request.validate()?;
        let (canonical_root_path, canonical_path) =
            canonical_document_identity(&request.root_path, request.path())?;
        let registry = app.state::<JavaScriptTypeScriptLanguageServerRegistry>();
        let admission = app.state::<DocumentChangeAdmissionRegistry>();
        deliver_validated_document_change(
            &admission,
            &request,
            &canonical_root_path,
            &canonical_path,
            |notification| {
                registry
                    .send_notification_for_session_outcome(
                        &canonical_root_path,
                        request.expected_session_id,
                        notification,
                    )
                    .map(|outcome| outcome == ExactSessionNotificationOutcome::Admitted)
            },
        )
    })
    .await
}

#[tauri::command]
pub async fn javascript_typescript_document_did_close_bounded(
    request: BoundedDocumentDidCloseRequest,
    app: AppHandle,
) -> Result<DocumentChangeAdmissionReceipt, String> {
    run_blocking_command(move || {
        request.validate()?;
        let (canonical_root_path, canonical_path) =
            canonical_document_identity(&request.root_path, &request.path)?;
        let registry = app.state::<JavaScriptTypeScriptLanguageServerRegistry>();
        let admission = app.state::<DocumentChangeAdmissionRegistry>();
        deliver_validated_document_close(
            &admission,
            &request,
            &canonical_root_path,
            &canonical_path,
            |notification| {
                registry
                    .send_notification_for_session_outcome(
                        &canonical_root_path,
                        request.expected_session_id,
                        notification,
                    )
                    .map(|outcome| outcome == ExactSessionNotificationOutcome::Admitted)
            },
        )
    })
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoundedDocumentDidOpenRequest {
    pub authority: DocumentLifecycleAuthority,
    pub expected_session_id: u64,
    pub language_id: JavaScriptTypeScriptLanguageId,
    pub path: String,
    #[serde(deserialize_with = "deserialize_required_nullable_token")]
    pub predecessor_lifecycle_token: Option<String>,
    pub root_path: String,
    pub text: String,
    pub version: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoundedDocumentDidCloseRequest {
    pub authority: DocumentChangeAuthority,
    pub expected_session_id: u64,
    pub path: String,
    pub root_path: String,
    pub version: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoundedDocumentDidChangeRequest {
    pub authority: DocumentChangeAuthority,
    pub change: DocumentChangeEnvelope,
    pub expected_session_id: u64,
    pub root_path: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentChangeAuthority {
    pub document_incarnation: String,
    pub lifecycle_token: String,
    pub model_incarnation: String,
    pub owner_generation: u64,
    pub owner_incarnation: String,
    pub owner_key: String,
    pub sync_generation: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentLifecycleAuthority {
    pub document_incarnation: String,
    pub model_incarnation: String,
    pub owner_generation: u64,
    pub owner_incarnation: String,
    pub owner_key: String,
    pub sync_generation: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DocumentChangeAdmissionReceipt {
    Admitted,
    Busy,
    NotOpen,
    StaleAuthority,
    StaleSession,
    StaleVersion,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DocumentOpenAdmissionReceipt {
    Admitted {
        #[serde(rename = "lifecycleToken")]
        lifecycle_token: String,
    },
    Busy,
    StaleAuthority,
    StaleSession,
    StaleVersion,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JavaScriptTypeScriptLanguageId {
    JavaScript,
    JavaScriptReact,
    TypeScript,
    TypeScriptReact,
}

#[derive(Debug, PartialEq, Eq)]
pub enum DocumentChangeAdmissionDecision {
    Admit,
    Busy,
    Idempotent,
    NotOpen,
    StaleAuthority,
    StaleSession,
    StaleVersion,
}

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct AdmittedDocumentKey {
    path: String,
    root_path: String,
}

#[derive(Clone, Debug)]
struct AdmittedDocument {
    authority: DocumentLifecycleAuthority,
    fingerprint: [u8; 32],
    lifecycle_token: String,
    session_id: u64,
    state: AdmittedDocumentState,
    version: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AdmittedDocumentState {
    Closed,
    Open,
}

pub struct DocumentChangeAdmissionState {
    closed_order: VecDeque<AdmittedDocumentKey>,
    documents: HashMap<AdmittedDocumentKey, AdmittedDocument>,
    global_epoch: u64,
    globally_quarantined: bool,
    next_reservation_id: u64,
    pending: HashMap<AdmittedDocumentKey, (u64, u64)>,
    pending_lifecycle_tokens: HashMap<String, String>,
    quarantined_roots: HashSet<String>,
    max_documents: usize,
    max_tombstones: usize,
    root_epochs: HashMap<String, u64>,
    sessions: HashMap<String, u64>,
}

pub struct DocumentChangeAdmissionRegistry {
    state: Mutex<DocumentChangeAdmissionState>,
    changed: Condvar,
    token_issuer: Box<dyn LifecycleTokenIssuer>,
}

impl Default for DocumentChangeAdmissionRegistry {
    fn default() -> Self {
        Self {
            state: Mutex::new(DocumentChangeAdmissionState::default()),
            changed: Condvar::new(),
            token_issuer: Box::new(OsLifecycleTokenIssuer),
        }
    }
}

struct DocumentChangeReservation {
    global_epoch: u64,
    key: AdmittedDocumentKey,
    lifecycle_token: Option<String>,
    reservation_id: u64,
    root_epoch: u64,
}

impl Default for DocumentChangeAdmissionState {
    fn default() -> Self {
        Self {
            closed_order: VecDeque::new(),
            documents: HashMap::new(),
            global_epoch: 1,
            globally_quarantined: false,
            next_reservation_id: 1,
            pending: HashMap::new(),
            pending_lifecycle_tokens: HashMap::new(),
            quarantined_roots: HashSet::new(),
            max_documents: MAX_ADMITTED_DOCUMENTS,
            max_tombstones: MAX_ADMITTED_DOCUMENTS,
            root_epochs: HashMap::new(),
            sessions: HashMap::new(),
        }
    }
}

trait LifecycleTokenIssuer: Send + Sync {
    fn issue(&self) -> Result<String, String>;
}

struct OsLifecycleTokenIssuer;

impl LifecycleTokenIssuer for OsLifecycleTokenIssuer {
    fn issue(&self) -> Result<String, String> {
        let mut random = [0_u8; LIFECYCLE_TOKEN_RANDOM_BYTES];
        if unsafe { libc::getentropy(random.as_mut_ptr().cast(), random.len()) } != 0 {
            return Err("Secure document lifecycle token entropy is unavailable.".to_string());
        }
        Ok(encode_lifecycle_token(random))
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum DocumentChangeEnvelope {
    Full {
        path: String,
        text: String,
        version: u64,
    },
    Incremental {
        changes: Vec<RangedDocumentChange>,
        path: String,
        version: u64,
    },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum RangedDocumentChange {
    Incremental {
        range: DocumentRange,
        #[serde(rename = "rangeLength")]
        range_length: u64,
        text: String,
    },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentRange {
    pub end: DocumentPosition,
    pub start: DocumentPosition,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DocumentPosition {
    pub character: u64,
    pub line: u64,
}

impl BoundedDocumentDidChangeRequest {
    pub fn validate(&self) -> Result<(), String> {
        validate_path(&self.root_path, "rootPath")?;
        if !Path::new(&self.root_path).is_absolute() {
            return Err("rootPath must be absolute.".to_string());
        }
        validate_positive_safe_integer(self.expected_session_id, "expectedSessionId")?;
        self.authority.validate()?;
        self.change.validate()
    }

    pub fn path(&self) -> &str {
        self.change.path()
    }

    pub fn validated_notification_for_path(&self, canonical_path: &str) -> JsonRpcNotification {
        self.change.notification(canonical_path)
    }

    pub fn version(&self) -> u64 {
        self.change.version()
    }
}

impl BoundedDocumentDidOpenRequest {
    pub fn validate(&self) -> Result<(), String> {
        validate_common_request(
            &self.authority,
            self.expected_session_id,
            &self.root_path,
            &self.path,
            self.version,
        )?;
        if let Some(token) = &self.predecessor_lifecycle_token {
            validate_token(token, "predecessorLifecycleToken")?;
        }
        validate_full_text(&self.text)
    }

    fn notification(&self, canonical_path: &str) -> JsonRpcNotification {
        JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: "textDocument/didOpen".to_string(),
            params: json!({
                "textDocument": {
                    "uri": file_uri(Path::new(canonical_path)),
                    "languageId": self.language_id.as_str(),
                    "version": self.version,
                    "text": self.text,
                }
            }),
        }
    }

    fn fingerprint(&self) -> [u8; 32] {
        let mut digest = Sha256::new();
        digest.update([self.language_id.fingerprint_tag()]);
        digest.update((self.text.len() as u64).to_be_bytes());
        digest.update(self.text.as_bytes());
        digest.finalize().into()
    }
}

impl BoundedDocumentDidCloseRequest {
    pub fn validate(&self) -> Result<(), String> {
        validate_common_request(
            &self.authority,
            self.expected_session_id,
            &self.root_path,
            &self.path,
            self.version,
        )
    }

    fn notification(&self, canonical_path: &str) -> JsonRpcNotification {
        JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: "textDocument/didClose".to_string(),
            params: json!({
                "textDocument": {
                    "uri": file_uri(Path::new(canonical_path)),
                }
            }),
        }
    }
}

impl JavaScriptTypeScriptLanguageId {
    fn as_str(self) -> &'static str {
        match self {
            Self::JavaScript => "javascript",
            Self::JavaScriptReact => "javascriptreact",
            Self::TypeScript => "typescript",
            Self::TypeScriptReact => "typescriptreact",
        }
    }

    fn fingerprint_tag(self) -> u8 {
        match self {
            Self::JavaScript => 1,
            Self::JavaScriptReact => 2,
            Self::TypeScript => 3,
            Self::TypeScriptReact => 4,
        }
    }
}

impl DocumentChangeAuthority {
    fn validate(&self) -> Result<(), String> {
        self.lifecycle_authority().validate()?;
        validate_token(&self.lifecycle_token, "lifecycleToken")
    }

    fn lifecycle_authority(&self) -> DocumentLifecycleAuthority {
        DocumentLifecycleAuthority {
            document_incarnation: self.document_incarnation.clone(),
            model_incarnation: self.model_incarnation.clone(),
            owner_generation: self.owner_generation,
            owner_incarnation: self.owner_incarnation.clone(),
            owner_key: self.owner_key.clone(),
            sync_generation: self.sync_generation,
        }
    }
}

impl DocumentLifecycleAuthority {
    fn validate(&self) -> Result<(), String> {
        validate_token(&self.document_incarnation, "documentIncarnation")?;
        validate_token(&self.model_incarnation, "modelIncarnation")?;
        validate_positive_safe_integer(self.owner_generation, "ownerGeneration")?;
        validate_token(&self.owner_incarnation, "ownerIncarnation")?;
        validate_token(&self.owner_key, "ownerKey")?;
        validate_positive_safe_integer(self.sync_generation, "syncGeneration")
    }
}

impl DocumentChangeAdmissionState {
    fn classify_open(
        &self,
        request: &BoundedDocumentDidOpenRequest,
        canonical_root_path: &str,
        canonical_path: &str,
        fingerprint: &[u8; 32],
    ) -> Result<DocumentChangeAdmissionDecision, String> {
        let key = admitted_document_key(canonical_root_path, canonical_path);
        if self.globally_quarantined || self.quarantined_roots.contains(canonical_root_path) {
            return Ok(DocumentChangeAdmissionDecision::StaleAuthority);
        }
        if self.pending.contains_key(&key) {
            return Ok(DocumentChangeAdmissionDecision::Busy);
        }
        let Some(previous) = self.documents.get(&key) else {
            if request.predecessor_lifecycle_token.is_some() {
                return Ok(DocumentChangeAdmissionDecision::StaleAuthority);
            }
            return Ok(DocumentChangeAdmissionDecision::Admit);
        };
        if previous.session_id != request.expected_session_id {
            return Ok(DocumentChangeAdmissionDecision::StaleSession);
        }
        match compare_lifecycle_authority(&request.authority, &previous.authority) {
            AuthorityOrder::OlderOrForeign => Ok(DocumentChangeAdmissionDecision::StaleAuthority),
            AuthorityOrder::Exact if previous.state == AdmittedDocumentState::Closed => {
                if request.predecessor_lifecycle_token.as_deref()
                    != Some(previous.lifecycle_token.as_str())
                {
                    return Ok(DocumentChangeAdmissionDecision::StaleAuthority);
                }
                if request.version <= previous.version {
                    return Ok(DocumentChangeAdmissionDecision::StaleVersion);
                }
                Ok(DocumentChangeAdmissionDecision::Admit)
            }
            AuthorityOrder::Exact if request.predecessor_lifecycle_token.is_some() => {
                Ok(DocumentChangeAdmissionDecision::StaleAuthority)
            }
            AuthorityOrder::Exact => {
                if request.version == previous.version {
                    if fingerprint == &previous.fingerprint {
                        Ok(DocumentChangeAdmissionDecision::Idempotent)
                    } else {
                        Ok(DocumentChangeAdmissionDecision::StaleAuthority)
                    }
                } else {
                    Ok(DocumentChangeAdmissionDecision::StaleVersion)
                }
            }
            AuthorityOrder::Newer if previous.state == AdmittedDocumentState::Closed => {
                if request.predecessor_lifecycle_token.as_deref()
                    == Some(previous.lifecycle_token.as_str())
                {
                    Ok(DocumentChangeAdmissionDecision::Admit)
                } else {
                    Ok(DocumentChangeAdmissionDecision::StaleAuthority)
                }
            }
            AuthorityOrder::Newer => Ok(DocumentChangeAdmissionDecision::StaleAuthority),
        }
    }

    fn classify_close(
        &self,
        request: &BoundedDocumentDidCloseRequest,
        canonical_root_path: &str,
        canonical_path: &str,
    ) -> DocumentChangeAdmissionDecision {
        let key = admitted_document_key(canonical_root_path, canonical_path);
        if self.pending.contains_key(&key) {
            return DocumentChangeAdmissionDecision::Busy;
        }
        let Some(previous) = self.documents.get(&key) else {
            return DocumentChangeAdmissionDecision::NotOpen;
        };
        if previous.session_id != request.expected_session_id {
            return DocumentChangeAdmissionDecision::StaleSession;
        }
        if !same_authority(&request.authority, previous) {
            return DocumentChangeAdmissionDecision::StaleAuthority;
        }
        if request.version != previous.version {
            return DocumentChangeAdmissionDecision::StaleVersion;
        }
        match previous.state {
            AdmittedDocumentState::Closed => DocumentChangeAdmissionDecision::Idempotent,
            AdmittedDocumentState::Open => DocumentChangeAdmissionDecision::Admit,
        }
    }

    fn classify_change(
        &self,
        request: &BoundedDocumentDidChangeRequest,
        canonical_root_path: &str,
        canonical_path: &str,
    ) -> Result<DocumentChangeAdmissionDecision, String> {
        let key = admitted_document_key(canonical_root_path, canonical_path);
        if self.pending.contains_key(&key) {
            return Ok(DocumentChangeAdmissionDecision::Busy);
        }
        let Some(previous) = self.documents.get(&key) else {
            return Ok(DocumentChangeAdmissionDecision::NotOpen);
        };
        if previous.session_id != request.expected_session_id {
            return Ok(DocumentChangeAdmissionDecision::StaleSession);
        }
        if !same_authority(&request.authority, previous) {
            return Ok(DocumentChangeAdmissionDecision::StaleAuthority);
        }
        if previous.state != AdmittedDocumentState::Open {
            return Ok(DocumentChangeAdmissionDecision::NotOpen);
        }
        if request.version() <= previous.version {
            return Ok(DocumentChangeAdmissionDecision::StaleVersion);
        }
        Ok(DocumentChangeAdmissionDecision::Admit)
    }

    fn reserve(
        &mut self,
        request: &BoundedDocumentDidChangeRequest,
        canonical_root_path: &str,
        canonical_path: &str,
    ) -> Result<Result<DocumentChangeReservation, DocumentChangeAdmissionReceipt>, String> {
        match self.classify_change(request, canonical_root_path, canonical_path)? {
            DocumentChangeAdmissionDecision::Busy => {
                return Ok(Err(DocumentChangeAdmissionReceipt::Busy));
            }
            DocumentChangeAdmissionDecision::NotOpen => {
                return Ok(Err(DocumentChangeAdmissionReceipt::NotOpen));
            }
            DocumentChangeAdmissionDecision::StaleAuthority => {
                return Ok(Err(DocumentChangeAdmissionReceipt::StaleAuthority));
            }
            DocumentChangeAdmissionDecision::StaleSession => {
                return Ok(Err(DocumentChangeAdmissionReceipt::StaleSession));
            }
            DocumentChangeAdmissionDecision::StaleVersion => {
                return Ok(Err(DocumentChangeAdmissionReceipt::StaleVersion));
            }
            DocumentChangeAdmissionDecision::Admit => {}
            DocumentChangeAdmissionDecision::Idempotent => {
                return Ok(Err(DocumentChangeAdmissionReceipt::Admitted));
            }
        }
        let key = admitted_document_key(canonical_root_path, canonical_path);
        let reservation_id = self.take_reservation_id()?;
        self.pending
            .insert(key.clone(), (reservation_id, request.expected_session_id));
        Ok(Ok(DocumentChangeReservation {
            global_epoch: self.global_epoch,
            root_epoch: self.root_epoch(canonical_root_path),
            key,
            lifecycle_token: None,
            reservation_id,
        }))
    }

    fn reserve_open(
        &mut self,
        key: AdmittedDocumentKey,
        lifecycle_token: String,
    ) -> Result<DocumentChangeReservation, String> {
        let open_count = self
            .documents
            .values()
            .filter(|document| document.state == AdmittedDocumentState::Open)
            .count();
        if !self.documents.contains_key(&key)
            && open_count + self.pending.len() >= self.max_documents
        {
            return Err("Bounded document-change admission capacity exceeded.".to_string());
        }
        if self
            .documents
            .values()
            .any(|document| document.lifecycle_token == lifecycle_token)
            || self.pending_lifecycle_tokens.contains_key(&lifecycle_token)
        {
            return Err("Secure document lifecycle token collision.".to_string());
        }
        let reservation_id = self.take_reservation_id()?;
        let root_epoch = self.root_epoch(&key.root_path);
        self.pending.insert(key.clone(), (reservation_id, 0));
        self.pending_lifecycle_tokens
            .insert(lifecycle_token.clone(), key.root_path.clone());
        Ok(DocumentChangeReservation {
            global_epoch: self.global_epoch,
            key,
            lifecycle_token: Some(lifecycle_token),
            reservation_id,
            root_epoch,
        })
    }

    fn reserve_close(
        &mut self,
        key: AdmittedDocumentKey,
    ) -> Result<DocumentChangeReservation, String> {
        let reservation_id = self.take_reservation_id()?;
        let root_epoch = self.root_epoch(&key.root_path);
        self.pending.insert(key.clone(), (reservation_id, 0));
        Ok(DocumentChangeReservation {
            global_epoch: self.global_epoch,
            key,
            lifecycle_token: None,
            reservation_id,
            root_epoch,
        })
    }

    fn commit_open(
        &mut self,
        reservation: DocumentChangeReservation,
        request: &BoundedDocumentDidOpenRequest,
        fingerprint: [u8; 32],
    ) -> bool {
        if self.pending.get(&reservation.key).map(|pending| pending.0)
            != Some(reservation.reservation_id)
            || !self.reservation_epoch_is_current(&reservation)
        {
            return false;
        }
        let Some(lifecycle_token) = reservation.lifecycle_token else {
            return false;
        };
        self.pending_lifecycle_tokens.remove(&lifecycle_token);
        self.pending.remove(&reservation.key);
        self.closed_order.retain(|key| key != &reservation.key);
        self.documents.insert(
            reservation.key,
            AdmittedDocument {
                authority: request.authority.clone(),
                fingerprint,
                lifecycle_token,
                session_id: request.expected_session_id,
                state: AdmittedDocumentState::Open,
                version: request.version,
            },
        );
        true
    }

    fn commit_close(&mut self, reservation: DocumentChangeReservation) -> bool {
        if self.pending.get(&reservation.key).map(|pending| pending.0)
            != Some(reservation.reservation_id)
            || !self.reservation_epoch_is_current(&reservation)
        {
            return false;
        }
        self.pending.remove(&reservation.key);
        if let Some(document) = self.documents.get_mut(&reservation.key) {
            document.state = AdmittedDocumentState::Closed;
        } else {
            return false;
        }
        self.closed_order.retain(|key| key != &reservation.key);
        let root_path = reservation.key.root_path.clone();
        self.closed_order.push_back(reservation.key);
        if self.closed_order.len() > self.max_tombstones {
            if !self.quarantined_roots.contains(&root_path)
                && self.quarantined_roots.len() >= MAX_SESSION_ROOTS
            {
                self.globally_quarantined = true;
                self.documents.clear();
                self.pending.clear();
                self.pending_lifecycle_tokens.clear();
                self.closed_order.clear();
                self.quarantined_roots.clear();
            } else {
                self.quarantined_roots.insert(root_path.clone());
                self.purge_root_entries(&root_path);
            }
        }
        true
    }

    fn take_reservation_id(&mut self) -> Result<u64, String> {
        let reservation_id = self.next_reservation_id;
        self.next_reservation_id = self
            .next_reservation_id
            .checked_add(1)
            .ok_or_else(|| "Bounded document-change reservation counter overflowed.".to_string())?;
        Ok(reservation_id)
    }

    fn commit(
        &mut self,
        reservation: DocumentChangeReservation,
        request: &BoundedDocumentDidChangeRequest,
    ) -> bool {
        if self.pending.get(&reservation.key).map(|pending| pending.0)
            != Some(reservation.reservation_id)
            || !self.reservation_epoch_is_current(&reservation)
        {
            return false;
        }
        self.pending.remove(&reservation.key);
        let Some(document) = self.documents.get_mut(&reservation.key) else {
            return false;
        };
        if document.state != AdmittedDocumentState::Open
            || document.session_id != request.expected_session_id
            || !same_authority(&request.authority, document)
        {
            return false;
        }
        document.version = request.version();
        true
    }

    fn reservation_epoch_is_current(&self, reservation: &DocumentChangeReservation) -> bool {
        reservation.global_epoch == self.global_epoch
            && reservation.root_epoch == self.root_epoch(&reservation.key.root_path)
    }

    fn root_epoch(&self, canonical_root_path: &str) -> u64 {
        self.root_epochs
            .get(canonical_root_path)
            .copied()
            .unwrap_or(0)
    }

    fn rollback(&mut self, reservation: &DocumentChangeReservation) {
        if self.pending.get(&reservation.key).map(|pending| pending.0)
            == Some(reservation.reservation_id)
        {
            self.pending.remove(&reservation.key);
            if let Some(token) = &reservation.lifecycle_token {
                self.pending_lifecycle_tokens.remove(token);
            }
        }
    }
}

pub fn deliver_validated_document_change(
    registry: &DocumentChangeAdmissionRegistry,
    request: &BoundedDocumentDidChangeRequest,
    canonical_root_path: &str,
    canonical_path: &str,
    send: impl FnOnce(&JsonRpcNotification) -> Result<bool, String>,
) -> Result<DocumentChangeAdmissionReceipt, String> {
    let reservation = {
        let mut state = lock_admission(registry)?;
        match state.reserve(request, canonical_root_path, canonical_path)? {
            Ok(reservation) => reservation,
            Err(receipt) => return Ok(receipt),
        }
    };
    let notification = request.validated_notification_for_path(canonical_path);
    match send(&notification) {
        Ok(true) => {
            let committed = lock_admission(registry)?.commit(reservation, request);
            registry.changed.notify_all();
            Ok(if committed {
                DocumentChangeAdmissionReceipt::Admitted
            } else {
                DocumentChangeAdmissionReceipt::StaleSession
            })
        }
        Ok(false) => {
            lock_admission(registry)?.rollback(&reservation);
            registry.changed.notify_all();
            Ok(DocumentChangeAdmissionReceipt::StaleSession)
        }
        Err(error) => {
            lock_admission(registry)?.rollback(&reservation);
            registry.changed.notify_all();
            Err(error)
        }
    }
}

pub fn deliver_validated_document_open(
    registry: &DocumentChangeAdmissionRegistry,
    request: &BoundedDocumentDidOpenRequest,
    canonical_root_path: &str,
    canonical_path: &str,
    send_open: impl FnOnce(&JsonRpcNotification) -> Result<bool, String>,
) -> Result<DocumentOpenAdmissionReceipt, String> {
    request.validate()?;
    let fingerprint = request.fingerprint();
    let mut reservation = None;
    for _ in 0..MAX_LIFECYCLE_TOKEN_COLLISION_ATTEMPTS {
        // Entropy acquisition stays outside the admission mutex.
        let candidate_token = registry.token_issuer.issue()?;
        let mut state = lock_admission(registry)?;
        match state.classify_open(request, canonical_root_path, canonical_path, &fingerprint)? {
            DocumentChangeAdmissionDecision::Admit => {
                match state.reserve_open(
                    admitted_document_key(canonical_root_path, canonical_path),
                    candidate_token,
                ) {
                    Ok(candidate) => {
                        reservation = Some(candidate);
                        break;
                    }
                    Err(error) if error == "Secure document lifecycle token collision." => continue,
                    Err(error) => return Err(error),
                }
            }
            DocumentChangeAdmissionDecision::Idempotent => {
                let token = state
                    .documents
                    .get(&admitted_document_key(canonical_root_path, canonical_path))
                    .map(|document| document.lifecycle_token.clone())
                    .ok_or_else(|| "Exact open lifecycle token is unavailable.".to_string())?;
                return Ok(DocumentOpenAdmissionReceipt::Admitted {
                    lifecycle_token: token,
                });
            }
            DocumentChangeAdmissionDecision::Busy => return Ok(DocumentOpenAdmissionReceipt::Busy),
            DocumentChangeAdmissionDecision::StaleSession => {
                return Ok(DocumentOpenAdmissionReceipt::StaleSession)
            }
            DocumentChangeAdmissionDecision::StaleVersion => {
                return Ok(DocumentOpenAdmissionReceipt::StaleVersion)
            }
            DocumentChangeAdmissionDecision::StaleAuthority
            | DocumentChangeAdmissionDecision::NotOpen => {
                return Ok(DocumentOpenAdmissionReceipt::StaleAuthority)
            }
        }
    }
    let reservation = reservation.ok_or_else(|| {
        "Secure document lifecycle token collision budget was exhausted.".to_string()
    })?;
    let lifecycle_token = reservation
        .lifecycle_token
        .clone()
        .ok_or_else(|| "Open lifecycle reservation has no token.".to_string())?;
    let notification = request.notification(canonical_path);
    match send_open(&notification) {
        Ok(true) => {
            let committed =
                lock_admission(registry)?.commit_open(reservation, request, fingerprint);
            registry.changed.notify_all();
            if committed {
                Ok(DocumentOpenAdmissionReceipt::Admitted { lifecycle_token })
            } else {
                Ok(DocumentOpenAdmissionReceipt::StaleSession)
            }
        }
        Ok(false) => {
            lock_admission(registry)?.rollback(&reservation);
            registry.changed.notify_all();
            Ok(DocumentOpenAdmissionReceipt::StaleSession)
        }
        Err(error) => {
            lock_admission(registry)?.rollback(&reservation);
            registry.changed.notify_all();
            Err(error)
        }
    }
}

pub fn deliver_validated_document_close(
    registry: &DocumentChangeAdmissionRegistry,
    request: &BoundedDocumentDidCloseRequest,
    canonical_root_path: &str,
    canonical_path: &str,
    send_close: impl FnOnce(&JsonRpcNotification) -> Result<bool, String>,
) -> Result<DocumentChangeAdmissionReceipt, String> {
    request.validate()?;
    let key = admitted_document_key(canonical_root_path, canonical_path);
    let reservation = {
        let state = lock_admission(registry)?;
        let (mut state, wait) = registry
            .changed
            .wait_timeout_while(state, DOCUMENT_LIFECYCLE_WAIT_TIMEOUT, |state| {
                state.pending.contains_key(&key)
            })
            .map_err(|_| "Bounded document-change admission state is unavailable.".to_string())?;
        if wait.timed_out() && state.pending.contains_key(&key) {
            return Err("Timed out waiting for pending document change before close.".to_string());
        }
        match state.classify_close(request, canonical_root_path, canonical_path) {
            DocumentChangeAdmissionDecision::Admit => state.reserve_close(key)?,
            decision => return Ok(receipt_for_non_admission(decision)),
        }
    };
    let notification = request.notification(canonical_path);
    match send_close(&notification) {
        Ok(true) => {
            let committed = lock_admission(registry)?.commit_close(reservation);
            registry.changed.notify_all();
            Ok(if committed {
                DocumentChangeAdmissionReceipt::Admitted
            } else {
                DocumentChangeAdmissionReceipt::StaleSession
            })
        }
        Ok(false) => {
            lock_admission(registry)?.rollback(&reservation);
            registry.changed.notify_all();
            Ok(DocumentChangeAdmissionReceipt::StaleSession)
        }
        Err(error) => {
            lock_admission(registry)?.rollback(&reservation);
            registry.changed.notify_all();
            Err(error)
        }
    }
}

fn receipt_for_non_admission(
    decision: DocumentChangeAdmissionDecision,
) -> DocumentChangeAdmissionReceipt {
    match decision {
        DocumentChangeAdmissionDecision::Busy => DocumentChangeAdmissionReceipt::Busy,
        DocumentChangeAdmissionDecision::Idempotent => DocumentChangeAdmissionReceipt::Admitted,
        DocumentChangeAdmissionDecision::NotOpen => DocumentChangeAdmissionReceipt::NotOpen,
        DocumentChangeAdmissionDecision::StaleAuthority => {
            DocumentChangeAdmissionReceipt::StaleAuthority
        }
        DocumentChangeAdmissionDecision::StaleSession => {
            DocumentChangeAdmissionReceipt::StaleSession
        }
        DocumentChangeAdmissionDecision::StaleVersion => {
            DocumentChangeAdmissionReceipt::StaleVersion
        }
        DocumentChangeAdmissionDecision::Admit => unreachable!("admit is handled by caller"),
    }
}

impl DocumentChangeAdmissionRegistry {
    pub fn begin_exact_session_transition(
        &self,
        canonical_root_path: &str,
        session_id: u64,
    ) -> Result<(), String> {
        validate_path(canonical_root_path, "canonicalRootPath")?;
        validate_positive_safe_integer(session_id, "sessionId")?;
        let mut state = lock_admission(self)?;
        if state.sessions.get(canonical_root_path) == Some(&session_id) {
            return Ok(());
        }
        if !state.sessions.contains_key(canonical_root_path)
            && state.sessions.len() >= MAX_SESSION_ROOTS
        {
            return Err("Bounded document session-root capacity exceeded.".to_string());
        }
        state.advance_root_epoch(canonical_root_path)?;
        state
            .sessions
            .insert(canonical_root_path.to_string(), session_id);
        state.quarantined_roots.remove(canonical_root_path);
        state.purge_root_entries(canonical_root_path);
        self.changed.notify_all();
        Ok(())
    }

    pub fn purge_root(&self, canonical_root_path: &str) -> Result<(), String> {
        let mut state = lock_admission(self)?;
        state.sessions.remove(canonical_root_path);
        state.quarantined_roots.remove(canonical_root_path);
        state.purge_root_entries(canonical_root_path);
        state.root_epochs.remove(canonical_root_path);
        self.changed.notify_all();
        Ok(())
    }

    pub fn purge_all(&self) -> Result<(), String> {
        let mut state = lock_admission(self)?;
        state.global_epoch = state
            .global_epoch
            .checked_add(1)
            .ok_or_else(|| "Document admission global epoch capacity was exhausted.".to_string())?;
        state.documents.clear();
        state.pending.clear();
        state.pending_lifecycle_tokens.clear();
        state.closed_order.clear();
        state.root_epochs.clear();
        state.sessions.clear();
        state.quarantined_roots.clear();
        state.globally_quarantined = false;
        self.changed.notify_all();
        Ok(())
    }
}

impl DocumentChangeAdmissionState {
    fn advance_root_epoch(&mut self, canonical_root_path: &str) -> Result<(), String> {
        if !self.root_epochs.contains_key(canonical_root_path)
            && self.root_epochs.len() >= MAX_SESSION_ROOTS
        {
            return Err("Bounded document session-root capacity exceeded.".to_string());
        }
        let next = self
            .root_epoch(canonical_root_path)
            .checked_add(1)
            .ok_or_else(|| "Document admission root epoch capacity was exhausted.".to_string())?;
        self.root_epochs
            .insert(canonical_root_path.to_string(), next);
        Ok(())
    }

    fn purge_root_entries(&mut self, canonical_root_path: &str) {
        self.documents
            .retain(|key, _| key.root_path != canonical_root_path);
        self.pending
            .retain(|key, _| key.root_path != canonical_root_path);
        self.pending_lifecycle_tokens
            .retain(|_, root_path| root_path != canonical_root_path);
        self.closed_order
            .retain(|key| key.root_path != canonical_root_path);
    }
}

fn lock_admission(
    registry: &DocumentChangeAdmissionRegistry,
) -> Result<std::sync::MutexGuard<'_, DocumentChangeAdmissionState>, String> {
    registry
        .state
        .lock()
        .map_err(|_| "Bounded document-change admission state is unavailable.".to_string())
}

fn admitted_document_key(canonical_root_path: &str, canonical_path: &str) -> AdmittedDocumentKey {
    AdmittedDocumentKey {
        path: canonical_path.to_string(),
        root_path: canonical_root_path.to_string(),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AuthorityOrder {
    Exact,
    Newer,
    OlderOrForeign,
}

fn compare_lifecycle_authority(
    candidate: &DocumentLifecycleAuthority,
    previous: &DocumentLifecycleAuthority,
) -> AuthorityOrder {
    if candidate.owner_key != previous.owner_key {
        return AuthorityOrder::OlderOrForeign;
    }
    let same_owner = candidate.owner_generation == previous.owner_generation
        && candidate.owner_incarnation == previous.owner_incarnation;
    let same_sync = candidate.sync_generation == previous.sync_generation;
    let same_document = candidate.document_incarnation == previous.document_incarnation
        && candidate.model_incarnation == previous.model_incarnation
        && same_owner
        && same_sync;
    if same_document {
        return AuthorityOrder::Exact;
    }

    let owner_advanced_once = previous
        .owner_generation
        .checked_add(1)
        .is_some_and(|next| candidate.owner_generation == next)
        && candidate.owner_incarnation != previous.owner_incarnation;
    let sync_advanced_once = previous
        .sync_generation
        .checked_add(1)
        .is_some_and(|next| candidate.sync_generation == next);
    let valid_same_owner_successor =
        same_owner && sync_advanced_once && !same_document_incarnation(candidate, previous);
    let valid_new_owner_successor = owner_advanced_once
        && (same_sync || sync_advanced_once)
        && !same_document_incarnation(candidate, previous);

    if valid_same_owner_successor || valid_new_owner_successor {
        AuthorityOrder::Newer
    } else {
        AuthorityOrder::OlderOrForeign
    }
}

fn same_document_incarnation(
    candidate: &DocumentLifecycleAuthority,
    previous: &DocumentLifecycleAuthority,
) -> bool {
    candidate.document_incarnation == previous.document_incarnation
        && candidate.model_incarnation == previous.model_incarnation
}

fn encode_lifecycle_token(random: [u8; LIFECYCLE_TOKEN_RANDOM_BYTES]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(LIFECYCLE_TOKEN_RANDOM_BYTES * 2);
    for byte in random {
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    encoded
}

fn same_authority(candidate: &DocumentChangeAuthority, previous: &AdmittedDocument) -> bool {
    candidate.lifecycle_token == previous.lifecycle_token
        && compare_lifecycle_authority(&candidate.lifecycle_authority(), &previous.authority)
            == AuthorityOrder::Exact
}

fn validate_common_request<A: ValidatedDocumentAuthority>(
    authority: &A,
    expected_session_id: u64,
    root_path: &str,
    path: &str,
    version: u64,
) -> Result<(), String> {
    validate_path(root_path, "rootPath")?;
    if !Path::new(root_path).is_absolute() {
        return Err("rootPath must be absolute.".to_string());
    }
    validate_path(path, "path")?;
    if !Path::new(path).is_absolute() {
        return Err("path must be absolute.".to_string());
    }
    validate_positive_safe_integer(expected_session_id, "expectedSessionId")?;
    validate_lsp_uinteger(version, "version", true)?;
    authority.validate_authority()
}

trait ValidatedDocumentAuthority {
    fn validate_authority(&self) -> Result<(), String>;
}

impl ValidatedDocumentAuthority for DocumentLifecycleAuthority {
    fn validate_authority(&self) -> Result<(), String> {
        self.validate()
    }
}

impl ValidatedDocumentAuthority for DocumentChangeAuthority {
    fn validate_authority(&self) -> Result<(), String> {
        self.validate()
    }
}

impl DocumentChangeEnvelope {
    fn validate(&self) -> Result<(), String> {
        validate_path(self.path(), "change.path")?;
        if !Path::new(self.path()).is_absolute() {
            return Err("change.path must be absolute.".to_string());
        }
        validate_lsp_uinteger(self.version(), "change.version", true)?;
        match self {
            Self::Full { text, .. } => validate_full_text(text),
            Self::Incremental { changes, .. } => validate_changes(changes),
        }
    }

    fn path(&self) -> &str {
        match self {
            Self::Full { path, .. } | Self::Incremental { path, .. } => path,
        }
    }

    fn version(&self) -> u64 {
        match self {
            Self::Full { version, .. } | Self::Incremental { version, .. } => *version,
        }
    }

    fn notification(&self, path: &str) -> JsonRpcNotification {
        let content_changes = match self {
            Self::Full { text, .. } => vec![json!({ "text": text })],
            Self::Incremental { changes, .. } => changes
                .iter()
                .map(RangedDocumentChange::notification_value)
                .collect(),
        };
        JsonRpcNotification {
            jsonrpc: "2.0".to_string(),
            method: "textDocument/didChange".to_string(),
            params: json!({
                "textDocument": {
                    "uri": file_uri(Path::new(path)),
                    "version": self.version(),
                },
                "contentChanges": content_changes,
            }),
        }
    }
}

impl RangedDocumentChange {
    fn validate(&self) -> Result<(), String> {
        match self {
            Self::Incremental {
                range,
                range_length,
                text,
            } => {
                range.validate()?;
                validate_lsp_uinteger(*range_length, "rangeLength", false)?;
                if text.len() > MAX_CHANGE_TEXT_BYTES {
                    return Err("Incremental change text exceeds its UTF-8 byte limit.".to_string());
                }
                Ok(())
            }
        }
    }

    fn text_bytes(&self) -> usize {
        match self {
            Self::Incremental { text, .. } => text.len(),
        }
    }

    fn notification_value(&self) -> serde_json::Value {
        match self {
            Self::Incremental {
                range,
                range_length,
                text,
            } => json!({
                "range": range,
                "rangeLength": range_length,
                "text": text,
            }),
        }
    }
}

impl DocumentRange {
    fn validate(&self) -> Result<(), String> {
        self.start.validate("range.start")?;
        self.end.validate("range.end")?;
        if (self.end.line, self.end.character) < (self.start.line, self.start.character) {
            return Err("Incremental change range must not be reversed.".to_string());
        }
        Ok(())
    }
}

impl DocumentPosition {
    fn validate(&self, field: &str) -> Result<(), String> {
        validate_lsp_uinteger(self.line, &format!("{field}.line"), false)?;
        validate_lsp_uinteger(self.character, &format!("{field}.character"), false)
    }
}

fn validate_changes(changes: &[RangedDocumentChange]) -> Result<(), String> {
    if changes.is_empty() || changes.len() > MAX_CHANGE_COUNT {
        return Err(format!(
            "Incremental change count must be between 1 and {MAX_CHANGE_COUNT}."
        ));
    }
    let mut aggregate_bytes = 0usize;
    for change in changes {
        change.validate()?;
        aggregate_bytes = aggregate_bytes
            .checked_add(change.text_bytes())
            .ok_or_else(|| "Incremental change byte count overflowed.".to_string())?;
        if aggregate_bytes > MAX_CHANGE_TEXT_BYTES_PER_BATCH {
            return Err("Incremental changes exceed the aggregate UTF-8 byte limit.".to_string());
        }
    }
    Ok(())
}

fn validate_full_text(text: &str) -> Result<(), String> {
    if text.len() > MAX_FULL_TEXT_UTF8_BYTES {
        return Err("Full document text exceeds its UTF-8 byte limit.".to_string());
    }
    if text
        .encode_utf16()
        .take(MAX_FULL_TEXT_UTF16_UNITS + 1)
        .count()
        > MAX_FULL_TEXT_UTF16_UNITS
    {
        return Err("Full document text exceeds its UTF-16 unit limit.".to_string());
    }
    Ok(())
}

fn validate_path(value: &str, field: &str) -> Result<(), String> {
    if value.is_empty() || value.as_bytes().contains(&0) || value.len() > MAX_PATH_BYTES {
        return Err(format!("{field} is not a valid bounded path."));
    }
    Ok(())
}

fn validate_token(value: &str, field: &str) -> Result<(), String> {
    if value.is_empty() || value.as_bytes().contains(&0) || value.len() > MAX_TOKEN_BYTES {
        return Err(format!("{field} is not a valid bounded authority token."));
    }
    Ok(())
}

fn deserialize_required_nullable_token<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer)
}

fn validate_positive_safe_integer(value: u64, field: &str) -> Result<(), String> {
    if value == 0 || value > MAX_SAFE_JAVASCRIPT_INTEGER {
        return Err(format!(
            "{field} must be a positive JavaScript-safe integer."
        ));
    }
    Ok(())
}

fn validate_lsp_uinteger(value: u64, field: &str, positive: bool) -> Result<(), String> {
    if value > MAX_LSP_UINTEGER || (positive && value == 0) {
        return Err(format!(
            "{field} is outside the supported LSP integer range."
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
