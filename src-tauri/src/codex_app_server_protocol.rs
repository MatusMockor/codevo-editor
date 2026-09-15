use serde::de::{DeserializeOwned, Error as DeserializeError};
use serde::ser::{Error as SerializeError, SerializeStruct};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

pub const JSON_RPC_VERSION: &str = "2.0";
pub const MAX_PROTOCOL_TAG_BYTES: usize = 64;
pub const MAX_PROTOCOL_METHOD_BYTES: usize = 128;
pub const MAX_PROTOCOL_ID_BYTES: usize = 128;

const TAGGED_OBJECT_ERROR: &str = "app-server tagged objects require a string `type` field";
const ENVELOPE_SHAPE_ERROR: &str =
    "app-server envelopes must be a response, error, notification or server request";
const UNSENDABLE_USER_INPUT_ERROR: &str =
    "unrecognized app-server user input must never be sent to a turn";
const ENVELOPE_VERSION_ERROR: &str =
    "app-server envelopes must not declare a foreign jsonrpc version";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ClientMethod {
    Initialize,
    ThreadStart,
    ThreadResume,
    TurnStart,
    TurnSteer,
    TurnInterrupt,
    ThreadUnsubscribe,
    ThreadBackgroundTerminalsClean,
    ThreadBackgroundTerminalsList,
}

impl ClientMethod {
    pub fn wire_method(self) -> &'static str {
        match self {
            Self::Initialize => "initialize",
            Self::ThreadStart => "thread/start",
            Self::ThreadResume => "thread/resume",
            Self::TurnStart => "turn/start",
            Self::TurnSteer => "turn/steer",
            Self::TurnInterrupt => "turn/interrupt",
            Self::ThreadUnsubscribe => "thread/unsubscribe",
            Self::ThreadBackgroundTerminalsClean => "thread/backgroundTerminals/clean",
            Self::ThreadBackgroundTerminalsList => "thread/backgroundTerminals/list",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ClientNotificationMethod {
    Initialized,
}

impl ClientNotificationMethod {
    pub fn wire_method(self) -> &'static str {
        match self {
            Self::Initialized => "initialized",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct JsonRpcRequest {
    pub id: u64,
    pub method: ClientMethod,
    pub params: Value,
}

impl Serialize for JsonRpcRequest {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut envelope = serializer.serialize_struct("JsonRpcRequest", 4)?;
        envelope.serialize_field("jsonrpc", JSON_RPC_VERSION)?;
        envelope.serialize_field("id", &self.id)?;
        envelope.serialize_field("method", self.method.wire_method())?;
        envelope.serialize_field("params", &self.params)?;
        envelope.end()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct JsonRpcClientNotification {
    pub method: ClientNotificationMethod,
    pub params: Value,
}

impl Serialize for JsonRpcClientNotification {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut envelope = serializer.serialize_struct("JsonRpcClientNotification", 3)?;
        envelope.serialize_field("jsonrpc", JSON_RPC_VERSION)?;
        envelope.serialize_field("method", self.method.wire_method())?;
        envelope.serialize_field("params", &self.params)?;
        envelope.end()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RequestId {
    Number(u64),
    String(String),
    Other(String),
}

impl RequestId {
    pub fn correlated(&self) -> Option<u64> {
        match self {
            Self::Number(id) => Some(*id),
            _ => None,
        }
    }

    fn from_value(id: &Value) -> Self {
        match id.as_u64() {
            Some(number) => Self::Number(number),
            None => Self::from_foreign_value(id),
        }
    }

    fn from_foreign_value(id: &Value) -> Self {
        match id.as_str() {
            Some(text) => Self::String(bounded_text(text, MAX_PROTOCOL_ID_BYTES)),
            None => Self::Other(bounded_text(id.to_string().as_str(), MAX_PROTOCOL_ID_BYTES)),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum JsonRpcIncoming {
    Response {
        id: RequestId,
        result: Value,
    },
    Error {
        id: RequestId,
        error: JsonRpcError,
    },
    Notification {
        method: String,
        params: Value,
    },
    ServerRequest {
        id: Value,
        method: String,
        params: Value,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct IncomingEnvelope {
    #[serde(default)]
    jsonrpc: Option<String>,
    #[serde(default, deserialize_with = "present_value")]
    id: Option<Value>,
    #[serde(default)]
    method: Option<String>,
    #[serde(default, deserialize_with = "present_value")]
    params: Option<Value>,
    #[serde(default, deserialize_with = "present_value")]
    result: Option<Value>,
    #[serde(default)]
    error: Option<JsonRpcError>,
    #[serde(default, rename = "emittedAtMs")]
    _emitted_at_ms: Option<serde::de::IgnoredAny>,
    #[serde(default, rename = "trace")]
    _trace: Option<serde::de::IgnoredAny>,
}

fn present_value<'de, D>(deserializer: D) -> Result<Option<Value>, D::Error>
where
    D: Deserializer<'de>,
{
    Value::deserialize(deserializer).map(Some)
}

impl<'de> Deserialize<'de> for JsonRpcIncoming {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let envelope = IncomingEnvelope::deserialize(deserializer)?;
        if matches!(envelope.jsonrpc.as_deref(), Some(version) if version != JSON_RPC_VERSION) {
            return Err(D::Error::custom(ENVELOPE_VERSION_ERROR));
        }
        let params = envelope.params.unwrap_or(Value::Null);
        match (
            envelope.error,
            envelope.result,
            envelope.method,
            envelope.id,
        ) {
            (Some(error), None, None, Some(id)) => Ok(Self::Error {
                id: RequestId::from_value(&id),
                error,
            }),
            (None, Some(result), None, Some(id)) => Ok(Self::Response {
                id: RequestId::from_value(&id),
                result,
            }),
            (None, None, Some(method), Some(id)) => Ok(Self::ServerRequest {
                id,
                method: bounded_method(method),
                params,
            }),
            (None, None, Some(method), None) => Ok(Self::Notification {
                method: bounded_method(method),
                params,
            }),
            _ => Err(D::Error::custom(ENVELOPE_SHAPE_ERROR)),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodexRpcErrorKind {
    ActiveTurnNotSteerable,
    Other,
}

pub fn classify_error(error: &JsonRpcError) -> CodexRpcErrorKind {
    let Some(data) = error.data.as_ref() else {
        return CodexRpcErrorKind::Other;
    };
    let nested = data.get("codexErrorInfo");
    let carries_tag = [Some(data), nested]
        .into_iter()
        .flatten()
        .filter_map(|candidate| candidate.get("activeTurnNotSteerable"))
        .any(|payload| {
            matches!(
                payload.get("turnKind").and_then(Value::as_str),
                Some("review" | "compact")
            )
        });
    match carries_tag {
        true => CodexRpcErrorKind::ActiveTurnNotSteerable,
        false => CodexRpcErrorKind::Other,
    }
}

fn bounded_tag(tag: &str) -> String {
    bounded_text(tag, MAX_PROTOCOL_TAG_BYTES)
}

fn bounded_method(method: String) -> String {
    match method.len() <= MAX_PROTOCOL_METHOD_BYTES {
        true => method,
        false => bounded_text(method.as_str(), MAX_PROTOCOL_METHOD_BYTES),
    }
}

fn bounded_text(text: &str, limit: usize) -> String {
    let mut end = limit.min(text.len());
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_string()
}

fn tagged_object_tag<'de, D>(value: &Value) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    value
        .get("type")
        .and_then(Value::as_str)
        .map(bounded_tag)
        .ok_or_else(|| D::Error::custom(TAGGED_OBJECT_ERROR))
}

fn tagged_payload<'de, D, T>(value: Value) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned,
{
    serde_json::from_value(value).map_err(D::Error::custom)
}

fn string_tag<'de, D, T>(
    deserializer: D,
    known: fn(&str) -> Option<T>,
    unrecognized: fn(String) -> T,
) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
{
    let tag = String::deserialize(deserializer)?;
    match known(tag.as_str()) {
        Some(value) => Ok(value),
        None => Ok(unrecognized(bounded_tag(tag.as_str()))),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ClientInfo {
    pub name: String,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InitializeParams {
    pub client_info: ClientInfo,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<InitializeCapabilities>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InitializeCapabilities {
    pub experimental_api: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SandboxMode {
    ReadOnly,
    WorkspaceWrite,
    DangerFullAccess,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalPolicy {
    Untrusted,
    OnRequest,
    Never,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    deny_unknown_fields,
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SandboxPolicy {
    ReadOnly {
        #[serde(default)]
        network_access: bool,
    },
    WorkspaceWrite {
        #[serde(default)]
        network_access: bool,
        #[serde(default)]
        writable_roots: Vec<String>,
    },
    DangerFullAccess,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ThreadStartParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sandbox: Option<SandboxMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval_policy: Option<ApprovalPolicy>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ThreadResumeParams {
    pub thread_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sandbox: Option<SandboxMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval_policy: Option<ApprovalPolicy>,
    pub exclude_turns: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TurnStartParams {
    pub thread_id: String,
    pub input: Vec<UserInput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval_policy: Option<ApprovalPolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sandbox_policy: Option<SandboxPolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_user_message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_trigger: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TurnSteerParams {
    pub thread_id: String,
    pub expected_turn_id: String,
    pub input: Vec<UserInput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_user_message_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TurnInterruptParams {
    pub thread_id: String,
    pub turn_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ThreadUnsubscribeParams {
    pub thread_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ThreadBackgroundTerminalsCleanParams {
    pub thread_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ThreadBackgroundTerminalsListParams {
    pub thread_id: String,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UserInput {
    Text { text: String },
    LocalImage { path: String },
    Unrecognized { tag: String },
}

impl Serialize for UserInput {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Text { text } => {
                let mut input = serializer.serialize_struct("UserInput", 2)?;
                input.serialize_field("type", "text")?;
                input.serialize_field("text", text)?;
                input.end()
            }
            Self::LocalImage { path } => {
                let mut input = serializer.serialize_struct("UserInput", 2)?;
                input.serialize_field("type", "localImage")?;
                input.serialize_field("path", path)?;
                input.end()
            }
            Self::Unrecognized { .. } => Err(SerializeError::custom(UNSENDABLE_USER_INPUT_ERROR)),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TextUserInputPayload {
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalImageUserInputPayload {
    path: String,
}

impl<'de> Deserialize<'de> for UserInput {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        let tag = tagged_object_tag::<D>(&value)?;
        match tag.as_str() {
            "text" => {
                let payload: TextUserInputPayload = tagged_payload::<D, _>(value)?;
                Ok(Self::Text { text: payload.text })
            }
            "localImage" => {
                let payload: LocalImageUserInputPayload = tagged_payload::<D, _>(value)?;
                Ok(Self::LocalImage { path: payload.path })
            }
            _ => Ok(Self::Unrecognized { tag }),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandExecutionStatus {
    InProgress,
    Completed,
    Failed,
    Declined,
    Unrecognized { tag: String },
}

impl<'de> Deserialize<'de> for CommandExecutionStatus {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        string_tag(
            deserializer,
            |tag| match tag {
                "inProgress" => Some(Self::InProgress),
                "completed" => Some(Self::Completed),
                "failed" => Some(Self::Failed),
                "declined" => Some(Self::Declined),
                _ => None,
            },
            |tag| Self::Unrecognized { tag },
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PatchApplyStatus {
    InProgress,
    Completed,
    Failed,
    Declined,
    Unrecognized { tag: String },
}

impl<'de> Deserialize<'de> for PatchApplyStatus {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        string_tag(
            deserializer,
            |tag| match tag {
                "inProgress" => Some(Self::InProgress),
                "completed" => Some(Self::Completed),
                "failed" => Some(Self::Failed),
                "declined" => Some(Self::Declined),
                _ => None,
            },
            |tag| Self::Unrecognized { tag },
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum McpToolCallStatus {
    InProgress,
    Completed,
    Failed,
    Unrecognized { tag: String },
}

impl<'de> Deserialize<'de> for McpToolCallStatus {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        string_tag(
            deserializer,
            |tag| match tag {
                "inProgress" => Some(Self::InProgress),
                "completed" => Some(Self::Completed),
                "failed" => Some(Self::Failed),
                _ => None,
            },
            |tag| Self::Unrecognized { tag },
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SubAgentActivityKind {
    Started,
    Interacted,
    Interrupted,
    Completed,
    Unrecognized { tag: String },
}

impl<'de> Deserialize<'de> for SubAgentActivityKind {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        string_tag(
            deserializer,
            |tag| match tag {
                "started" => Some(Self::Started),
                "interacted" => Some(Self::Interacted),
                "interrupted" => Some(Self::Interrupted),
                "completed" => Some(Self::Completed),
                _ => None,
            },
            |tag| Self::Unrecognized { tag },
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TurnStatus {
    InProgress,
    Completed,
    Interrupted,
    Failed,
    Unrecognized { tag: String },
}

impl<'de> Deserialize<'de> for TurnStatus {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        string_tag(
            deserializer,
            |tag| match tag {
                "inProgress" => Some(Self::InProgress),
                "completed" => Some(Self::Completed),
                "interrupted" => Some(Self::Interrupted),
                "failed" => Some(Self::Failed),
                _ => None,
            },
            |tag| Self::Unrecognized { tag },
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ThreadStatus {
    NotLoaded,
    Idle,
    SystemError,
    Active { active_flags: Vec<String> },
    Unrecognized { tag: String },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActiveThreadStatusPayload {
    #[serde(default)]
    active_flags: Vec<String>,
}

impl<'de> Deserialize<'de> for ThreadStatus {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        let tag = tagged_object_tag::<D>(&value)?;
        match tag.as_str() {
            "notLoaded" => Ok(Self::NotLoaded),
            "idle" => Ok(Self::Idle),
            "systemError" => Ok(Self::SystemError),
            "active" => {
                let payload: ActiveThreadStatusPayload = tagged_payload::<D, _>(value)?;
                Ok(Self::Active {
                    active_flags: payload.active_flags,
                })
            }
            _ => Ok(Self::Unrecognized { tag }),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PatchChangeKind {
    Add,
    Delete,
    Update,
    Unrecognized { tag: String },
}

impl<'de> Deserialize<'de> for PatchChangeKind {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        let tag = tagged_object_tag::<D>(&value)?;
        match tag.as_str() {
            "add" => Ok(Self::Add),
            "delete" => Ok(Self::Delete),
            "update" => Ok(Self::Update),
            _ => Ok(Self::Unrecognized { tag }),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileUpdateChange {
    pub path: String,
    pub kind: PatchChangeKind,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserMessageItemPayload {
    id: String,
    #[serde(default)]
    client_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContextCompactionItemPayload {
    id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessageItem {
    pub id: String,
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReasoningItem {
    pub id: String,
    #[serde(default)]
    pub content: Vec<String>,
    #[serde(default)]
    pub summary: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecutionItem {
    pub id: String,
    pub status: CommandExecutionStatus,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub duration_ms: Option<i64>,
    #[serde(default)]
    pub aggregated_output: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeItem {
    pub id: String,
    pub status: PatchApplyStatus,
    #[serde(default)]
    pub changes: Vec<FileUpdateChange>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolCallError {
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolCallItem {
    pub id: String,
    pub status: McpToolCallStatus,
    #[serde(default)]
    pub server: Option<String>,
    #[serde(default)]
    pub tool: Option<String>,
    #[serde(default)]
    pub duration_ms: Option<i64>,
    #[serde(default)]
    pub error: Option<McpToolCallError>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchItem {
    pub id: String,
    #[serde(default)]
    pub query: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubAgentActivityItem {
    pub id: String,
    pub kind: SubAgentActivityKind,
    pub agent_thread_id: String,
    #[serde(default)]
    pub agent_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ThreadItem {
    UserMessage {
        id: String,
        client_id: Option<String>,
    },
    AgentMessage(AgentMessageItem),
    Reasoning(ReasoningItem),
    CommandExecution(CommandExecutionItem),
    FileChange(FileChangeItem),
    McpToolCall(McpToolCallItem),
    WebSearch(WebSearchItem),
    SubAgentActivity(SubAgentActivityItem),
    ContextCompaction {
        id: String,
    },
    Ignored {
        tag: String,
    },
    Unrecognized {
        tag: String,
    },
}

const IGNORED_THREAD_ITEM_TAGS: &[&str] = &[
    "collabAgentToolCall",
    "dynamicToolCall",
    "enteredReviewMode",
    "exitedReviewMode",
    "functionCallOutput",
    "hookPrompt",
    "imageGeneration",
    "imageView",
    "plan",
    "sleep",
];

impl<'de> Deserialize<'de> for ThreadItem {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        let tag = tagged_object_tag::<D>(&value)?;
        match tag.as_str() {
            "userMessage" => {
                let payload: UserMessageItemPayload = tagged_payload::<D, _>(value)?;
                Ok(Self::UserMessage {
                    id: payload.id,
                    client_id: payload.client_id,
                })
            }
            "agentMessage" => Ok(Self::AgentMessage(tagged_payload::<D, _>(value)?)),
            "reasoning" => Ok(Self::Reasoning(tagged_payload::<D, _>(value)?)),
            "commandExecution" => Ok(Self::CommandExecution(tagged_payload::<D, _>(value)?)),
            "fileChange" => Ok(Self::FileChange(tagged_payload::<D, _>(value)?)),
            "mcpToolCall" => Ok(Self::McpToolCall(tagged_payload::<D, _>(value)?)),
            "webSearch" => Ok(Self::WebSearch(tagged_payload::<D, _>(value)?)),
            "subAgentActivity" => Ok(Self::SubAgentActivity(tagged_payload::<D, _>(value)?)),
            "contextCompaction" => {
                let payload: ContextCompactionItemPayload = tagged_payload::<D, _>(value)?;
                Ok(Self::ContextCompaction { id: payload.id })
            }
            _ => Ok(classify_unhandled_thread_item(tag)),
        }
    }
}

fn classify_unhandled_thread_item(tag: String) -> ThreadItem {
    match IGNORED_THREAD_ITEM_TAGS
        .binary_search(&tag.as_str())
        .is_ok()
    {
        true => ThreadItem::Ignored { tag },
        false => ThreadItem::Unrecognized { tag },
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsageBreakdown {
    #[serde(default)]
    pub input_tokens: Option<i64>,
    #[serde(default)]
    pub cached_input_tokens: Option<i64>,
    #[serde(default)]
    pub cache_write_input_tokens: Option<i64>,
    #[serde(default)]
    pub output_tokens: Option<i64>,
    #[serde(default)]
    pub reasoning_output_tokens: Option<i64>,
    #[serde(default)]
    pub total_tokens: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadTokenUsage {
    #[serde(default)]
    pub last: Option<TokenUsageBreakdown>,
    #[serde(default)]
    pub total: Option<TokenUsageBreakdown>,
    #[serde(default)]
    pub model_context_window: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnError {
    pub message: String,
    #[serde(default)]
    pub additional_details: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSnapshot {
    pub id: String,
    #[serde(default)]
    pub parent_thread_id: Option<String>,
    #[serde(default)]
    pub status: Option<ThreadStatus>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnSnapshot {
    pub id: String,
    pub status: TurnStatus,
    #[serde(default)]
    pub duration_ms: Option<i64>,
    #[serde(default)]
    pub error: Option<TurnError>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadStartedNotification {
    pub thread: ThreadSnapshot,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnStartedNotification {
    pub thread_id: String,
    pub turn: TurnSnapshot,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnCompletedNotification {
    pub thread_id: String,
    pub turn: TurnSnapshot,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemNotification {
    pub thread_id: String,
    #[serde(default)]
    pub turn_id: Option<String>,
    pub item: ThreadItem,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadTokenUsageUpdatedNotification {
    pub thread_id: String,
    #[serde(default)]
    pub turn_id: Option<String>,
    #[serde(default)]
    pub token_usage: Option<ThreadTokenUsage>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadCompactedNotification {
    pub thread_id: String,
    #[serde(default)]
    pub turn_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorNotification {
    #[serde(default)]
    pub thread_id: Option<String>,
    #[serde(default)]
    pub turn_id: Option<String>,
    pub error: TurnError,
    #[serde(default)]
    pub will_retry: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServerNotification {
    ThreadStarted(ThreadStartedNotification),
    TurnStarted(TurnStartedNotification),
    TurnCompleted(TurnCompletedNotification),
    ItemStarted(ItemNotification),
    ItemCompleted(ItemNotification),
    ThreadTokenUsageUpdated(ThreadTokenUsageUpdatedNotification),
    ThreadCompacted(ThreadCompactedNotification),
    ThreadQueueChanged { thread_id: String },
    Error(ErrorNotification),
    Ignored { method: String },
    Unknown { method: String },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreadQueueChangedPayload {
    thread_id: String,
}

const IGNORED_NOTIFICATION_METHODS: &[&str] = &[
    "account/login/completed",
    "account/rateLimits/updated",
    "account/updated",
    "app/list/updated",
    "autoApprovalReview/strictReviewRequired",
    "codex/event/exec_command_end",
    "codex/event/item_completed",
    "command/exec/outputDelta",
    "configWarning",
    "deprecationNotice",
    "externalAgentConfig/import/completed",
    "externalAgentConfig/import/progress",
    "fs/changed",
    "fuzzyFileSearch/sessionCompleted",
    "fuzzyFileSearch/sessionUpdated",
    "guardianWarning",
    "hook/completed",
    "hook/started",
    "item/agentMessage/delta",
    "item/autoApprovalReview/completed",
    "item/autoApprovalReview/started",
    "item/commandExecution/outputDelta",
    "item/commandExecution/terminalInteraction",
    "item/fileChange/outputDelta",
    "item/fileChange/patchUpdated",
    "item/mcpToolCall/progress",
    "item/plan/delta",
    "item/reasoning/summaryPartAdded",
    "item/reasoning/summaryTextDelta",
    "item/reasoning/textDelta",
    "mcpServer/event/stream/notification",
    "mcpServer/oauthLogin/completed",
    "mcpServer/startupStatus/updated",
    "model/rerouted",
    "model/safetyBuffering/updated",
    "model/verification",
    "modelProvider/authRecoveryCompleted",
    "modelProvider/authRecoveryStarted",
    "process/exited",
    "process/outputDelta",
    "project/changed",
    "remoteControl/status/changed",
    "serverRequest/resolved",
    "skills/changed",
    "thread/archived",
    "thread/closed",
    "thread/deleted",
    "thread/environment/connected",
    "thread/environment/disconnected",
    "thread/goal/cleared",
    "thread/goal/updated",
    "thread/name/updated",
    "thread/project/updated",
    "thread/realtime/closed",
    "thread/realtime/error",
    "thread/realtime/item/completed",
    "thread/realtime/item/started",
    "thread/realtime/item/transcript/delta",
    "thread/realtime/itemAdded",
    "thread/realtime/outputAudio/delta",
    "thread/realtime/sdp",
    "thread/realtime/started",
    "thread/realtime/transcript/delta",
    "thread/realtime/transcript/done",
    "thread/reverted",
    "thread/settings/updated",
    "thread/status/changed",
    "thread/unarchived",
    "turn/diff/updated",
    "turn/moderationMetadata",
    "turn/plan/updated",
    "warning",
    "windows/worldWritableWarning",
    "windowsSandbox/setupCompleted",
];

pub fn classify_notification(method: &str, params: Value) -> ServerNotification {
    let bounded = bounded_method(method.to_string());
    match decode_known_notification(bounded.as_str(), params) {
        Some(notification) => notification,
        None => classify_unhandled_notification(bounded),
    }
}

fn decode_known_notification(method: &str, params: Value) -> Option<ServerNotification> {
    match method {
        "thread/started" => Some(decoded_notification(
            method,
            params,
            ServerNotification::ThreadStarted,
        )),
        "turn/started" => Some(decoded_notification(
            method,
            params,
            ServerNotification::TurnStarted,
        )),
        "turn/completed" => Some(decoded_notification(
            method,
            params,
            ServerNotification::TurnCompleted,
        )),
        "item/started" => Some(decoded_notification(
            method,
            params,
            ServerNotification::ItemStarted,
        )),
        "item/completed" => Some(decoded_notification(
            method,
            params,
            ServerNotification::ItemCompleted,
        )),
        "thread/tokenUsage/updated" => Some(decoded_notification(
            method,
            params,
            ServerNotification::ThreadTokenUsageUpdated,
        )),
        "thread/compacted" => Some(decoded_notification(
            method,
            params,
            ServerNotification::ThreadCompacted,
        )),
        "thread/queue/changed" => Some(decoded_notification(
            method,
            params,
            |payload: ThreadQueueChangedPayload| ServerNotification::ThreadQueueChanged {
                thread_id: payload.thread_id,
            },
        )),
        "error" => Some(decoded_notification(
            method,
            params,
            ServerNotification::Error,
        )),
        _ => None,
    }
}

fn decoded_notification<T>(
    method: &str,
    params: Value,
    build: fn(T) -> ServerNotification,
) -> ServerNotification
where
    T: DeserializeOwned,
{
    match serde_json::from_value::<T>(params) {
        Ok(payload) => build(payload),
        Err(_) => ServerNotification::Unknown {
            method: method.to_string(),
        },
    }
}

pub fn is_ignored_notification(method: &str) -> bool {
    IGNORED_NOTIFICATION_METHODS.binary_search(&method).is_ok()
}

fn classify_unhandled_notification(method: String) -> ServerNotification {
    match is_ignored_notification(&method) {
        true => ServerNotification::Ignored { method },
        false => ServerNotification::Unknown { method },
    }
}

#[cfg(test)]
#[path = "codex_app_server_protocol_tests.rs"]
mod tests;
