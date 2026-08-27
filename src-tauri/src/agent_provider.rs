#[path = "agent_cli_version.rs"]
pub(crate) mod agent_cli_version;
#[path = "agent_provider_process.rs"]
pub(crate) mod process;
#[path = "agent_provider_runtime.rs"]
pub(crate) mod runtime;

use self::agent_cli_version::parse_agent_cli_version;
use crate::agent_task_spawner::AgentCliInvocation;
use regex::Regex;
use serde::{
    de::{DeserializeSeed, Error as _, MapAccess, SeqAccess, Visitor},
    Serialize,
};
use serde_json::Value;
use std::{cmp::Ordering, fmt, sync::OnceLock};

pub const MAX_AGENT_PROVIDER_OUTPUT_BYTES: usize = 64 * 1024;
pub const MAX_AGENT_PROVIDER_LABEL_BYTES: usize = 256;
pub const MAX_AGENT_PROVIDER_UPDATE_TAIL_BYTES: usize = 32 * 1024;

pub const CLAUDE_NPM_PACKAGE: &str = "@anthropic-ai/claude-code";
pub const CODEX_NPM_PACKAGE: &str = "@openai/codex";
pub const CLAUDE_BREW_CASK: &str = "claude-code";
pub const CODEX_BREW_CASK: &str = "codex";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AgentProviderAuthState {
    SignedIn { label: Option<String> },
    SignedOut,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClaudeAuthStatusCapability {
    Json,
    Text,
    Unavailable,
}

const CLAUDE_AUTH_CAPABILITY_FIXTURES: [(&str, ClaudeAuthStatusCapability); 3] = [
    ("2.1.247", ClaudeAuthStatusCapability::Json),
    ("2.1.83", ClaudeAuthStatusCapability::Text),
    ("0.2.0", ClaudeAuthStatusCapability::Unavailable),
];

pub fn claude_auth_capability(version: &str) -> Option<ClaudeAuthStatusCapability> {
    CLAUDE_AUTH_CAPABILITY_FIXTURES
        .iter()
        .find_map(|(candidate, capability)| (*candidate == version).then_some(*capability))
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AgentProviderInstaller {
    Npm { package_name: String },
    Homebrew { cask: String },
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AgentProviderUpdateAvailability {
    ChecksDisabled,
    Current {
        installed_version: String,
    },
    Available {
        installed_version: String,
        available_version: String,
        installer: AgentProviderInstaller,
    },
    Unavailable {
        reason: AgentProviderUpdateUnavailableReason,
    },
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentProviderUpdateUnavailableReason {
    UnknownInstaller,
    UnsupportedProbe,
    InvalidVersion,
    ProbeFailed,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderHealthProbeResult {
    pub installed_version: Option<String>,
    pub auth: AgentProviderAuthState,
    pub update: AgentProviderUpdateAvailability,
    pub checked_at_epoch_ms: u64,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentProviderUpdateFailureReason {
    AdmissionRefused,
    SpawnFailed,
    TimedOut,
    OutputLimitExceeded,
    Exited,
    Uncertain,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AgentProviderUpdateResult {
    Succeeded {
        previous_version: String,
        installed_version: String,
    },
    Failed {
        reason: AgentProviderUpdateFailureReason,
        output_tail: String,
        output_truncated: bool,
    },
}

pub fn npm_package(provider: AgentCliInvocation) -> &'static str {
    match provider {
        AgentCliInvocation::ClaudeCode => CLAUDE_NPM_PACKAGE,
        AgentCliInvocation::CodexExec => CODEX_NPM_PACKAGE,
    }
}

pub fn brew_cask(provider: AgentCliInvocation) -> &'static str {
    match provider {
        AgentCliInvocation::ClaudeCode => CLAUDE_BREW_CASK,
        AgentCliInvocation::CodexExec => CODEX_BREW_CASK,
    }
}

pub fn parse_auth_state(
    provider: AgentCliInvocation,
    stdout: &[u8],
    stderr: &[u8],
) -> AgentProviderAuthState {
    if stdout.len() > MAX_AGENT_PROVIDER_OUTPUT_BYTES
        || stderr.len() > MAX_AGENT_PROVIDER_OUTPUT_BYTES
    {
        return AgentProviderAuthState::Unknown;
    }
    let Some(stdout) = std::str::from_utf8(stdout).ok() else {
        return AgentProviderAuthState::Unknown;
    };
    let Some(stderr) = std::str::from_utf8(stderr).ok() else {
        return AgentProviderAuthState::Unknown;
    };
    match provider {
        AgentCliInvocation::ClaudeCode => parse_claude_auth(stdout),
        AgentCliInvocation::CodexExec => parse_codex_auth(stdout, stderr),
    }
}

fn parse_claude_auth(output: &str) -> AgentProviderAuthState {
    let Some(value) = bounded_json(output.as_bytes()) else {
        return AgentProviderAuthState::Unknown;
    };
    let Some(object) = value.as_object() else {
        return AgentProviderAuthState::Unknown;
    };
    if object.keys().any(|key| {
        !matches!(
            key.as_str(),
            "loggedIn"
                | "authMethod"
                | "apiProvider"
                | "analyticsDisabled"
                | "email"
                | "orgId"
                | "orgName"
                | "subscriptionType"
        )
    }) {
        return AgentProviderAuthState::Unknown;
    }
    let Some(logged_in) = object.get("loggedIn").and_then(Value::as_bool) else {
        return AgentProviderAuthState::Unknown;
    };
    if object
        .get("analyticsDisabled")
        .is_some_and(|value| !value.is_boolean())
    {
        return AgentProviderAuthState::Unknown;
    }
    if [
        "authMethod",
        "apiProvider",
        "email",
        "orgId",
        "orgName",
        "subscriptionType",
    ]
    .into_iter()
    .any(|key| object.get(key).is_some_and(|value| !value.is_string()))
    {
        return AgentProviderAuthState::Unknown;
    }
    if !logged_in {
        return AgentProviderAuthState::SignedOut;
    }
    let label = ["subscriptionType", "orgName", "email", "authMethod"]
        .into_iter()
        .filter_map(|key| object.get(key).and_then(Value::as_str))
        .find_map(valid_auth_label);
    AgentProviderAuthState::SignedIn { label }
}

pub fn parse_claude_text_auth_state(stdout: &[u8], stderr: &[u8]) -> AgentProviderAuthState {
    if stdout.len() > MAX_AGENT_PROVIDER_OUTPUT_BYTES
        || stderr.len() > MAX_AGENT_PROVIDER_OUTPUT_BYTES
    {
        return AgentProviderAuthState::Unknown;
    }
    let Some(stdout) = std::str::from_utf8(stdout).ok() else {
        return AgentProviderAuthState::Unknown;
    };
    let Some(stderr) = std::str::from_utf8(stderr).ok() else {
        return AgentProviderAuthState::Unknown;
    };
    let combined = [stdout.trim(), stderr.trim()]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if matches!(combined.as_str(), "Not logged in" | "Logged out") {
        return AgentProviderAuthState::SignedOut;
    }
    for prefix in ["Logged in as ", "Subscription: ", "Logged in using "] {
        let Some(label) = combined.lines().find_map(|line| line.strip_prefix(prefix)) else {
            continue;
        };
        let Some(label) = valid_auth_label(label) else {
            return AgentProviderAuthState::Unknown;
        };
        return AgentProviderAuthState::SignedIn { label: Some(label) };
    }
    AgentProviderAuthState::Unknown
}

fn parse_codex_auth(stdout: &str, stderr: &str) -> AgentProviderAuthState {
    let combined = [stdout.trim(), stderr.trim()]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if matches!(combined.as_str(), "Not logged in" | "Logged out") {
        return AgentProviderAuthState::SignedOut;
    }
    let Some(label) = combined.strip_prefix("Logged in using ") else {
        return AgentProviderAuthState::Unknown;
    };
    let Some(label) = valid_auth_label(label) else {
        return AgentProviderAuthState::Unknown;
    };
    AgentProviderAuthState::SignedIn { label: Some(label) }
}

fn valid_auth_label(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > MAX_AGENT_PROVIDER_LABEL_BYTES {
        return None;
    }
    if value.chars().any(char::is_control) {
        return None;
    }
    let lowered = value.to_ascii_lowercase();
    if [
        "token",
        "bearer",
        "sk-",
        "api_key",
        "apikey",
        "ghp_",
        "github_pat_",
        "npm_",
    ]
    .iter()
    .any(|marker| lowered.contains(marker))
    {
        return None;
    }
    Some(value.to_string())
}

pub fn parse_npm_installed_version(output: &[u8], provider: AgentCliInvocation) -> Option<String> {
    let value = bounded_json(output)?;
    let root = value.as_object()?;
    if root.len() != 2
        || root
            .keys()
            .any(|key| !matches!(key.as_str(), "name" | "dependencies"))
    {
        return None;
    }
    let name = root.get("name")?.as_str()?;
    if name.is_empty() || name.len() > MAX_AGENT_PROVIDER_LABEL_BYTES {
        return None;
    }
    let dependencies = root.get("dependencies")?.as_object()?;
    if dependencies
        .keys()
        .any(|name| name != CLAUDE_NPM_PACKAGE && name != CODEX_NPM_PACKAGE)
    {
        return None;
    }
    let package = dependencies.get(npm_package(provider))?.as_object()?;
    if package
        .keys()
        .any(|key| key != "version" && key != "overridden")
    {
        return None;
    }
    if package
        .get("overridden")
        .is_some_and(|value| !value.is_boolean())
    {
        return None;
    }
    parse_agent_cli_version(package.get("version")?.as_str()?)
}

pub fn parse_npm_available_version(output: &[u8]) -> Option<String> {
    let value = bounded_json(output)?;
    parse_agent_cli_version(value.as_str()?)
}

pub fn parse_brew_available_version(
    output: &[u8],
    provider: AgentCliInvocation,
) -> Option<Option<String>> {
    let value = bounded_json(output)?;
    let object = value.as_object()?;
    if object.keys().any(|key| key != "formulae" && key != "casks") {
        return None;
    }
    let formulae = object.get("formulae")?.as_array()?;
    let casks = object.get("casks")?.as_array()?;
    if !formulae.is_empty() {
        return None;
    }
    let expected = brew_cask(provider);
    let mut found = None;
    for item in casks {
        let item = item.as_object()?;
        if item.keys().any(|key| {
            !matches!(
                key.as_str(),
                "name" | "installed_versions" | "current_version" | "pinned" | "pinned_version"
            )
        }) {
            return None;
        }
        let name = item.get("name")?.as_str()?;
        if name != expected {
            return None;
        }
        if found.is_some() {
            return None;
        }
        let current = item.get("current_version").and_then(Value::as_str);
        let installed = item
            .get("installed_versions")
            .and_then(Value::as_array)
            .and_then(|values| values.first())
            .and_then(Value::as_str);
        let candidate = current.or(installed).and_then(parse_agent_cli_version)?;
        found = Some(candidate);
    }
    Some(found)
}

fn bounded_json(output: &[u8]) -> Option<Value> {
    if output.len() > MAX_AGENT_PROVIDER_OUTPUT_BYTES {
        return None;
    }
    let mut deserializer = serde_json::Deserializer::from_slice(output);
    let value = UniqueValueSeed.deserialize(&mut deserializer).ok()?;
    deserializer.end().ok()?;
    (json_depth(&value) <= 16).then_some(value)
}

struct UniqueValueSeed;

impl<'de> DeserializeSeed<'de> for UniqueValueSeed {
    type Value = Value;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_any(UniqueValueVisitor)
    }
}

struct UniqueValueVisitor;

impl<'de> Visitor<'de> for UniqueValueVisitor {
    type Value = Value;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a JSON value with unique object keys")
    }

    fn visit_bool<E>(self, value: bool) -> Result<Self::Value, E> {
        Ok(Value::Bool(value))
    }

    fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E> {
        Ok(Value::Number(value.into()))
    }

    fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E> {
        Ok(Value::Number(value.into()))
    }

    fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        serde_json::Number::from_f64(value)
            .map(Value::Number)
            .ok_or_else(|| E::custom("invalid JSON number"))
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E> {
        Ok(Value::String(value.to_string()))
    }

    fn visit_string<E>(self, value: String) -> Result<Self::Value, E> {
        Ok(Value::String(value))
    }

    fn visit_none<E>(self) -> Result<Self::Value, E> {
        Ok(Value::Null)
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok(Value::Null)
    }

    fn visit_some<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        UniqueValueSeed.deserialize(deserializer)
    }

    fn visit_seq<A>(self, mut values: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut result = Vec::new();
        while let Some(value) = values.next_element_seed(UniqueValueSeed)? {
            result.push(value);
        }
        Ok(Value::Array(result))
    }

    fn visit_map<A>(self, mut values: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut result = serde_json::Map::new();
        while let Some(key) = values.next_key::<String>()? {
            if result.contains_key(&key) {
                return Err(A::Error::custom("duplicate JSON object key"));
            }
            let value = values.next_value_seed(UniqueValueSeed)?;
            result.insert(key, value);
        }
        Ok(Value::Object(result))
    }
}

fn json_depth(value: &Value) -> usize {
    match value {
        Value::Array(values) => 1 + values.iter().map(json_depth).max().unwrap_or_default(),
        Value::Object(values) => 1 + values.values().map(json_depth).max().unwrap_or_default(),
        _ => 1,
    }
}

pub fn compare_versions(left: &str, right: &str) -> Option<Ordering> {
    let left = parse_agent_cli_version(left)?;
    let right = parse_agent_cli_version(right)?;
    let (left_numeric, left_pre) = split_version(&left);
    let (right_numeric, right_pre) = split_version(&right);
    for index in 0..4 {
        let left = left_numeric.get(index).copied().unwrap_or_default();
        let right = right_numeric.get(index).copied().unwrap_or_default();
        match left.cmp(&right) {
            Ordering::Equal => {}
            ordering => return Some(ordering),
        }
    }
    match (left_pre, right_pre) {
        (None, None) => Some(Ordering::Equal),
        (None, Some(_)) => Some(Ordering::Greater),
        (Some(_), None) => Some(Ordering::Less),
        (Some(left), Some(right)) => Some(compare_prerelease(left, right)),
    }
}

fn compare_prerelease(left: &str, right: &str) -> Ordering {
    let mut left = left.split('.');
    let mut right = right.split('.');
    loop {
        match (left.next(), right.next()) {
            (Some(left), Some(right)) => {
                let ordering = compare_prerelease_identifier(left, right);
                if ordering != Ordering::Equal {
                    return ordering;
                }
            }
            (Some(_), None) => return Ordering::Greater,
            (None, Some(_)) => return Ordering::Less,
            (None, None) => return Ordering::Equal,
        }
    }
}

fn compare_prerelease_identifier(left: &str, right: &str) -> Ordering {
    let left_numeric = left.bytes().all(|byte| byte.is_ascii_digit());
    let right_numeric = right.bytes().all(|byte| byte.is_ascii_digit());
    match (left_numeric, right_numeric) {
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        (false, false) => left.cmp(right),
        (true, true) => {
            let left = left.trim_start_matches('0');
            let right = right.trim_start_matches('0');
            left.len().cmp(&right.len()).then_with(|| left.cmp(right))
        }
    }
}

fn split_version(value: &str) -> (Vec<u64>, Option<&str>) {
    let (numeric, prerelease) = value
        .split_once('-')
        .map_or((value, None), |(numeric, prerelease)| {
            (numeric, Some(prerelease))
        });
    (
        numeric
            .split('.')
            .filter_map(|component| component.parse::<u64>().ok())
            .collect(),
        prerelease,
    )
}

pub fn sanitized_tail(stdout: &[u8], stderr: &[u8]) -> String {
    let mut joined =
        Vec::with_capacity(stdout.len().saturating_add(stderr.len()).saturating_add(1));
    joined.extend_from_slice(stdout);
    if !stdout.is_empty() && !stderr.is_empty() {
        joined.push(b'\n');
    }
    joined.extend_from_slice(stderr);
    let sanitized: String = String::from_utf8_lossy(&joined)
        .chars()
        .map(|character| {
            if character.is_control() && !matches!(character, '\n' | '\t') {
                '�'
            } else {
                character
            }
        })
        .collect();
    let redacted = secret_pattern().replace_all(&sanitized, "[redacted]");
    bounded_utf8_tail(redacted.as_bytes(), MAX_AGENT_PROVIDER_UPDATE_TAIL_BYTES)
}

fn secret_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(
            r"(?i)(?:authorization\s*:\s*bearer\s+\S+|bearer\s+[a-z0-9._~+/=-]+|(?:_?auth_?token|token|api[_-]?key|authorization)\s*[:=]\s*\S+|sk-[a-z0-9_-]{4,}|ghp_[a-z0-9]{4,}|github_pat_[a-z0-9_]{4,}|npm_[a-z0-9]{4,}|https?://[^\s/@:]+:[^\s/@]+@)",
        )
        .expect("closed provider secret pattern")
    })
}

fn bounded_utf8_tail(value: &[u8], limit: usize) -> String {
    let mut start = value.len().saturating_sub(limit);
    while start < value.len() && std::str::from_utf8(&value[start..]).is_err() {
        start += 1;
    }
    String::from_utf8_lossy(&value[start..]).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_parsers_fail_closed() {
        assert_eq!(
            claude_auth_capability("2.1.247"),
            Some(ClaudeAuthStatusCapability::Json)
        );
        assert_eq!(
            claude_auth_capability("2.1.83"),
            Some(ClaudeAuthStatusCapability::Text)
        );
        assert_eq!(
            claude_auth_capability("0.2.0"),
            Some(ClaudeAuthStatusCapability::Unavailable)
        );
        assert_eq!(claude_auth_capability("9.9.9"), None);
        assert_eq!(
            parse_auth_state(
                AgentCliInvocation::ClaudeCode,
                br#"{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","analyticsDisabled":false,"email":"person@example.com","orgId":"org-1","orgName":"Example","subscriptionType":"Pro"}"#,
                b""
            ),
            AgentProviderAuthState::SignedIn {
                label: Some("Pro".to_string())
            }
        );
        assert_eq!(
            parse_auth_state(
                AgentCliInvocation::CodexExec,
                b"Logged in using ChatGPT",
                b""
            ),
            AgentProviderAuthState::SignedIn {
                label: Some("ChatGPT".to_string())
            }
        );
        assert_eq!(
            parse_auth_state(AgentCliInvocation::CodexExec, b"token sk-secret", b""),
            AgentProviderAuthState::Unknown
        );
        assert_eq!(
            parse_auth_state(
                AgentCliInvocation::ClaudeCode,
                br#"{"loggedIn":true,"future":1}"#,
                b""
            ),
            AgentProviderAuthState::Unknown
        );
    }

    #[test]
    fn package_manager_json_is_exact_and_bounded() {
        assert_eq!(
            parse_npm_installed_version(
                br#"{"name":"lib","dependencies":{"@openai/codex":{"version":"0.150.1"}}}"#,
                AgentCliInvocation::CodexExec
            ),
            Some("0.150.1".to_string())
        );
        assert_eq!(
            parse_npm_installed_version(
                br#"{"name":"lib","dependencies":{"@openai/codex":{"version":"0.150.1","extra":1}}}"#,
                AgentCliInvocation::CodexExec
            ),
            None
        );
        assert_eq!(
            parse_npm_installed_version(
                br#"{"name":"lib","dependencies":{"@openai/codex":{"version":"0.150.1","version":"9.9.9"}}}"#,
                AgentCliInvocation::CodexExec
            ),
            None
        );
        assert_eq!(
            parse_npm_installed_version(
                br#"{"dependencies":{"@openai/codex":{"version":"0.150.1"}}}"#,
                AgentCliInvocation::CodexExec
            ),
            None
        );
        assert_eq!(
            parse_npm_installed_version(
                br#"{"name":"lib","dependencies":{"@openai/codex":{"version":"0.150.1"}},"future":true}"#,
                AgentCliInvocation::CodexExec
            ),
            None
        );
        assert_eq!(
            parse_npm_available_version(br#""0.151.0""#),
            Some("0.151.0".to_string())
        );
        assert_eq!(
            parse_brew_available_version(
                br#"{"formulae":[],"casks":[{"name":"codex","installed_versions":["0.150.1"],"current_version":"0.151.0","pinned":false,"pinned_version":null}]}"#,
                AgentCliInvocation::CodexExec,
            ),
            Some(Some("0.151.0".to_string()))
        );
        assert_eq!(
            parse_brew_available_version(
                br#"{"formulae":[],"casks":[{"name":"other","installed_versions":["1.0.0"],"current_version":"1.1.0"}]}"#,
                AgentCliInvocation::CodexExec,
            ),
            None
        );
        assert_eq!(
            parse_brew_available_version(
                br#"{"formulae":[],"casks":[],"casks":[]}"#,
                AgentCliInvocation::CodexExec,
            ),
            None
        );
        assert_eq!(
            serde_json::to_value(AgentProviderInstaller::Homebrew {
                cask: "codex".to_string(),
            })
            .expect("homebrew installer"),
            serde_json::json!({"kind":"homebrew","cask":"codex"})
        );
    }

    #[test]
    fn version_comparison_handles_numeric_and_prerelease_versions() {
        assert_eq!(compare_versions("0.9.9", "0.10.0"), Some(Ordering::Less));
        assert_eq!(
            compare_versions("1.0.0-beta.1", "1.0.0"),
            Some(Ordering::Less)
        );
        assert_eq!(
            compare_versions("1.0.0-beta.10", "1.0.0-beta.2"),
            Some(Ordering::Greater)
        );
        assert_eq!(
            compare_versions("1.0.0-beta.2", "1.0.0-beta.alpha"),
            Some(Ordering::Less)
        );
        assert_eq!(compare_versions("1.0", "1.0.0"), Some(Ordering::Equal));
    }

    #[test]
    fn output_tail_is_utf8_safe_and_bounded() {
        let output = "\0".repeat(MAX_AGENT_PROVIDER_UPDATE_TAIL_BYTES);
        let tail = sanitized_tail(
            output.as_bytes(),
            b"Authorization: Bearer secret-value\nsk-live-secret\n_authToken=npm-secret\nghp_abcdef123456\ngithub_pat_abcdef_123456\nnpm_abcdef123456\nhttps://user:password@example.com",
        );
        assert!(tail.len() <= MAX_AGENT_PROVIDER_UPDATE_TAIL_BYTES);
        assert!(!tail.contains('\0'));
        assert!(!tail.contains("secret"), "{tail}");
        assert!(!tail.contains("password"), "{tail}");
        assert!(tail.contains("[redacted]"));
        for secret in ["ghp_", "github_pat_", "npm_"] {
            assert!(!tail.contains(secret), "{tail}");
        }
        for label in [
            "ghp_abcdef123456",
            "github_pat_abcdef_123456",
            "npm_abcdef123456",
        ] {
            assert_eq!(valid_auth_label(label), None);
        }
    }
}
