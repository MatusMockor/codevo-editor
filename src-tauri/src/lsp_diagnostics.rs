use std::borrow::Cow;
#[cfg(test)]
use std::cell::Cell;
use std::collections::BTreeSet;
use std::io::{self, Write};

use serde::de::{DeserializeSeed, SeqAccess, Visitor};
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use serde_json::{Map, Value};

/// Maximum diagnostics retained from one server publication.
pub const MAX_RETAINED_DIAGNOSTICS: usize = 2_000;
/// Exact maximum serialized UTF-8 bytes of the retained diagnostics array.
pub const MAX_RETAINED_DIAGNOSTIC_UTF8_BYTES: usize = 2 * 1024 * 1024;

/// Per-diagnostic UTF-8 limits mirrored by the TypeScript gateway decoder.
pub const MAX_DIAGNOSTIC_MESSAGE_UTF8_BYTES: usize = 8 * 1024;
pub const MAX_DIAGNOSTIC_SHORT_FIELD_UTF8_BYTES: usize = 512;
pub const MAX_DIAGNOSTIC_URI_HREF_UTF8_BYTES: usize = 16 * 1024;
pub const MAX_DIAGNOSTIC_RELATED_INFORMATION: usize = 16;
pub const MAX_DIAGNOSTIC_DATA_DEPTH: usize = 16;
pub const MAX_DIAGNOSTIC_DATA_SERIALIZED_UTF8_BYTES: usize = 16 * 1024;
pub const MAX_DIAGNOSTIC_DATA_NODES: usize = 1_024;
pub const MAX_DIAGNOSTIC_DATA_CONTAINER_ITEMS: usize = 256;
pub const MAX_DIAGNOSTIC_TAGS: usize = 2;
pub const MAX_DIAGNOSTIC_POSITION: u64 = 2_147_483_647;
pub const MAX_JAVASCRIPT_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
pub const DIAGNOSTIC_TAG_VALUES: [u64; 2] = [1, 2];
pub const MAX_DIAGNOSTIC_AUTHORITY_DATA_NODES: usize = 32_768;
pub const MAX_DIAGNOSTIC_AUTHORITY_FILESYSTEM_PROBES: usize = 256;
pub const MAX_DIAGNOSTIC_AUTHORITY_PATH_CACHE_ENTRIES: usize = 2_048;
pub const MAX_DIAGNOSTIC_AUTHORITY_PATH_CACHE_UTF8_BYTES: usize = 1024 * 1024;

const MAX_DATA_STRING_UTF8_BYTES: usize = 16 * 1024;

#[cfg(test)]
thread_local! {
    static FULL_DIAGNOSTIC_VALUE_DECODES: Cell<usize> = const { Cell::new(0) };
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerDiagnosticEvent {
    pub session_id: u64,
    pub uri: String,
    pub version: Option<i64>,
    pub diagnostics: Vec<LanguageServerDiagnostic>,
    pub projection: LanguageServerDiagnosticProjection,
}

impl LanguageServerDiagnosticEvent {
    pub(crate) fn record_post_filter_sanitization(
        &mut self,
        sanitized_field_count: usize,
        reasons: BTreeSet<LanguageServerDiagnosticProjectionReason>,
    ) {
        if sanitized_field_count == 0 {
            return;
        }

        let retained_utf8_bytes =
            serialized_utf8_len(&self.diagnostics).unwrap_or(MAX_RETAINED_DIAGNOSTIC_UTF8_BYTES);
        self.projection
            .record_sanitization(reasons, sanitized_field_count, retained_utf8_bytes);
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum LanguageServerDiagnosticProjection {
    Complete {
        published_count: usize,
        retained_count: usize,
        severity_counts: LanguageServerDiagnosticSeverityCounts,
        retained_utf8_bytes: usize,
    },
    Truncated {
        published_count: usize,
        retained_count: usize,
        omitted_count: usize,
        severity_counts: LanguageServerDiagnosticSeverityCounts,
        retained_utf8_bytes: usize,
        reasons: Vec<LanguageServerDiagnosticProjectionReason>,
        sanitized_field_count: usize,
    },
}

impl LanguageServerDiagnosticProjection {
    fn record_sanitization(
        &mut self,
        additional_reasons: BTreeSet<LanguageServerDiagnosticProjectionReason>,
        additional_sanitized_fields: usize,
        retained_utf8_bytes: usize,
    ) {
        match self {
            Self::Complete {
                published_count,
                retained_count,
                severity_counts,
                ..
            } => {
                *self = Self::Truncated {
                    published_count: *published_count,
                    retained_count: *retained_count,
                    omitted_count: published_count.saturating_sub(*retained_count),
                    severity_counts: *severity_counts,
                    retained_utf8_bytes,
                    reasons: additional_reasons.into_iter().collect(),
                    sanitized_field_count: additional_sanitized_fields,
                };
            }
            Self::Truncated {
                reasons,
                sanitized_field_count,
                retained_utf8_bytes: retained_bytes,
                ..
            } => {
                reasons.extend(additional_reasons);
                reasons.sort_unstable();
                reasons.dedup();
                *sanitized_field_count =
                    sanitized_field_count.saturating_add(additional_sanitized_fields);
                *retained_bytes = retained_utf8_bytes;
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerDiagnosticSeverityCounts {
    pub error: usize,
    pub warning: usize,
    pub information: usize,
    pub hint: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LanguageServerDiagnosticProjectionReason {
    #[serde(rename = "itemLimit")]
    Item,
    #[serde(rename = "byteLimit")]
    Byte,
    #[serde(rename = "fieldLimit")]
    Field,
    #[serde(rename = "dataDepthLimit")]
    DataDepth,
    #[serde(rename = "relatedInformationLimit")]
    RelatedInformation,
    #[serde(rename = "authorityNodeLimit")]
    AuthorityNode,
    #[serde(rename = "pathProbeLimit")]
    PathProbe,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerDiagnostic {
    pub code: Option<LanguageServerDiagnosticCode>,
    pub code_description_href: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    pub message: String,
    pub severity: LanguageServerDiagnosticSeverity,
    pub source: Option<String>,
    pub tags: Vec<u64>,
    pub related_information: Vec<LanguageServerDiagnosticRelatedInformation>,
    pub line: u64,
    pub character: u64,
    pub end_line: u64,
    pub end_character: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerDiagnosticRelatedInformation {
    pub uri: String,
    pub message: String,
    pub line: u64,
    pub character: u64,
    pub end_line: u64,
    pub end_character: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum LanguageServerDiagnosticCode {
    Number(i64),
    String(String),
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LanguageServerDiagnosticSeverity {
    Error,
    Warning,
    Information,
    Hint,
}

#[cfg(test)]
pub fn parse_publish_diagnostics(
    value: &Value,
    session_id: u64,
) -> Option<LanguageServerDiagnosticEvent> {
    let bytes = serde_json::to_vec(value).ok()?;
    parse_publish_diagnostics_bytes(&bytes, session_id)
}

#[cfg(test)]
pub fn parse_publish_diagnostics_bytes(
    bytes: &[u8],
    session_id: u64,
) -> Option<LanguageServerDiagnosticEvent> {
    match classify_publish_diagnostics_bytes(bytes, session_id) {
        PublishDiagnosticsBytes::Event(event) => Some(event),
        PublishDiagnosticsBytes::NotNotification | PublishDiagnosticsBytes::Malformed => None,
    }
}

pub enum PublishDiagnosticsBytes {
    NotNotification,
    Malformed,
    Event(LanguageServerDiagnosticEvent),
}

pub fn classify_publish_diagnostics_bytes(
    bytes: &[u8],
    session_id: u64,
) -> PublishDiagnosticsBytes {
    let Ok(envelope) = serde_json::from_slice::<RawLspEnvelope<'_>>(bytes) else {
        return PublishDiagnosticsBytes::NotNotification;
    };
    if envelope.method.as_deref() != Some("textDocument/publishDiagnostics") {
        return PublishDiagnosticsBytes::NotNotification;
    }

    let parsed = (|| {
        if session_id > MAX_JAVASCRIPT_SAFE_INTEGER as u64 {
            return None;
        }
        let params =
            serde_json::from_str::<RawPublishDiagnosticsParams<'_>>(envelope.params?.get()).ok()?;
        let uri = params.uri?;
        if uri.len() > MAX_DIAGNOSTIC_URI_HREF_UTF8_BYTES || !is_absolute_uri(&uri) {
            return None;
        }
        if params.version.is_some_and(|version| {
            !(-MAX_JAVASCRIPT_SAFE_INTEGER..=MAX_JAVASCRIPT_SAFE_INTEGER).contains(&version)
        }) {
            return None;
        }
        let projected = DiagnosticsProjectionSeed
            .deserialize(&mut serde_json::Deserializer::from_str(
                params.diagnostics?.get(),
            ))
            .ok()?;

        let retained_count = projected.diagnostics.len();
        let omitted_count = projected.published_count.saturating_sub(retained_count);
        let projection = if omitted_count == 0 && projected.sanitized_field_count == 0 {
            LanguageServerDiagnosticProjection::Complete {
                published_count: projected.published_count,
                retained_count,
                severity_counts: projected.severity_counts,
                retained_utf8_bytes: projected.retained_utf8_bytes,
            }
        } else {
            LanguageServerDiagnosticProjection::Truncated {
                published_count: projected.published_count,
                retained_count,
                omitted_count,
                severity_counts: projected.severity_counts,
                retained_utf8_bytes: projected.retained_utf8_bytes,
                reasons: projected.reasons.into_iter().collect(),
                sanitized_field_count: projected.sanitized_field_count,
            }
        };

        Some(LanguageServerDiagnosticEvent {
            session_id,
            uri: uri.into_owned(),
            version: params.version,
            diagnostics: projected.diagnostics,
            projection,
        })
    })();

    parsed
        .map(PublishDiagnosticsBytes::Event)
        .unwrap_or(PublishDiagnosticsBytes::Malformed)
}

#[derive(Deserialize)]
struct RawLspEnvelope<'a> {
    #[serde(borrow)]
    method: Option<Cow<'a, str>>,
    #[serde(borrow)]
    params: Option<&'a RawValue>,
}

#[derive(Deserialize)]
struct RawPublishDiagnosticsParams<'a> {
    #[serde(borrow)]
    uri: Option<Cow<'a, str>>,
    version: Option<i64>,
    #[serde(borrow)]
    diagnostics: Option<&'a RawValue>,
}

struct DiagnosticsProjection {
    diagnostics: Vec<LanguageServerDiagnostic>,
    published_count: usize,
    severity_counts: LanguageServerDiagnosticSeverityCounts,
    retained_utf8_bytes: usize,
    reasons: BTreeSet<LanguageServerDiagnosticProjectionReason>,
    sanitized_field_count: usize,
}

struct DiagnosticsProjectionSeed;

impl<'de> serde::de::DeserializeSeed<'de> for DiagnosticsProjectionSeed {
    type Value = DiagnosticsProjection;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_seq(DiagnosticsProjectionVisitor)
    }
}

struct DiagnosticsProjectionVisitor;

impl<'de> Visitor<'de> for DiagnosticsProjectionVisitor {
    type Value = DiagnosticsProjection;

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("an array of valid language server diagnostics")
    }

    fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut projection = DiagnosticsProjection {
            diagnostics: Vec::with_capacity(
                sequence
                    .size_hint()
                    .unwrap_or_default()
                    .min(MAX_RETAINED_DIAGNOSTICS),
            ),
            published_count: 0,
            severity_counts: LanguageServerDiagnosticSeverityCounts::default(),
            retained_utf8_bytes: 2,
            reasons: BTreeSet::new(),
            sanitized_field_count: 0,
        };
        let mut accepting = true;

        while let Some(raw) = sequence.next_element::<&'de RawValue>()? {
            let severity_probe = serde_json::from_str::<DiagnosticSeverityProbe>(raw.get())
                .map_err(serde::de::Error::custom)?;
            projection
                .severity_counts
                .increment(parse_severity(severity_probe.severity));
            let index = projection.published_count;
            projection.published_count = projection.published_count.saturating_add(1);

            if !accepting {
                continue;
            }
            if index >= MAX_RETAINED_DIAGNOSTICS {
                projection
                    .reasons
                    .insert(LanguageServerDiagnosticProjectionReason::Item);
                accepting = false;
                continue;
            }
            if raw.get().len() > MAX_RETAINED_DIAGNOSTIC_UTF8_BYTES {
                projection
                    .reasons
                    .insert(LanguageServerDiagnosticProjectionReason::Byte);
                accepting = false;
                continue;
            }

            let probe = serde_json::from_str::<DiagnosticProbe>(raw.get())
                .map_err(serde::de::Error::custom)?;
            probe.observe_required_shape();
            let value =
                serde_json::from_str::<Value>(raw.get()).map_err(serde::de::Error::custom)?;
            #[cfg(test)]
            FULL_DIAGNOSTIC_VALUE_DECODES.with(|count| count.set(count.get() + 1));
            let parsed = parse_diagnostic(&value);
            let candidate_bytes = serialized_utf8_len(&parsed.diagnostic).ok_or_else(|| {
                serde::de::Error::custom("diagnostic projection could not be serialized")
            })?;
            let separator_bytes = usize::from(!projection.diagnostics.is_empty());
            if projection
                .retained_utf8_bytes
                .saturating_add(separator_bytes)
                .saturating_add(candidate_bytes)
                > MAX_RETAINED_DIAGNOSTIC_UTF8_BYTES
            {
                projection
                    .reasons
                    .insert(LanguageServerDiagnosticProjectionReason::Byte);
                accepting = false;
                continue;
            }

            projection.retained_utf8_bytes += separator_bytes + candidate_bytes;
            projection.sanitized_field_count = projection
                .sanitized_field_count
                .saturating_add(parsed.sanitized_field_count);
            projection.reasons.extend(parsed.reasons);
            projection.diagnostics.push(parsed.diagnostic);
        }

        Ok(projection)
    }
}

#[derive(Deserialize)]
struct DiagnosticSeverityProbe {
    severity: Option<u64>,
}

#[derive(Deserialize)]
struct DiagnosticProbe {
    range: DiagnosticRangeProbe,
    message: RequiredString,
}

impl DiagnosticProbe {
    fn observe_required_shape(&self) {
        let _ = (
            self.range.start.line,
            self.range.start.character,
            self.range.end.is_some(),
            &self.message,
        );
    }
}

#[derive(Deserialize)]
struct DiagnosticRangeProbe {
    start: DiagnosticPositionProbe,
    end: Option<serde::de::IgnoredAny>,
}

#[derive(Deserialize)]
struct DiagnosticPositionProbe {
    line: u64,
    character: u64,
}

struct RequiredString;

impl<'de> Deserialize<'de> for RequiredString {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_str(RequiredStringVisitor)
    }
}

struct RequiredStringVisitor;

impl<'de> Visitor<'de> for RequiredStringVisitor {
    type Value = RequiredString;

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("a diagnostic message string")
    }

    fn visit_borrowed_str<E>(self, _value: &'de str) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        Ok(RequiredString)
    }

    fn visit_str<E>(self, _value: &str) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        Ok(RequiredString)
    }

    fn visit_string<E>(self, _value: String) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        Ok(RequiredString)
    }
}

struct ParsedDiagnostic {
    diagnostic: LanguageServerDiagnostic,
    reasons: BTreeSet<LanguageServerDiagnosticProjectionReason>,
    sanitized_field_count: usize,
}

fn parse_diagnostic(value: &Value) -> ParsedDiagnostic {
    let mut reasons = BTreeSet::new();
    let mut sanitized_field_count = 0usize;
    let range = value.get("range").unwrap_or(&Value::Null);
    let (line, character) = parse_position(range.get("start")).unwrap_or_else(|| {
        record_sanitized(
            &mut reasons,
            &mut sanitized_field_count,
            LanguageServerDiagnosticProjectionReason::Field,
            1,
        );
        (0, 0)
    });
    let (end_line, end_character) = parse_end_position(
        range.get("end"),
        line,
        character,
        &mut reasons,
        &mut sanitized_field_count,
    );

    let code = parse_code(value.get("code"), &mut reasons, &mut sanitized_field_count);
    let code_description_href = parse_code_description_href(
        value.get("codeDescription"),
        &mut reasons,
        &mut sanitized_field_count,
    );
    let data = value.get("data").and_then(|data| {
        let mut budget = DataProjectionBudget::default();
        let mut projected = project_data(data, 0, &mut budget);
        if projected.as_ref().is_some_and(|projected| {
            serialized_utf8_len(projected)
                .map(|bytes| bytes > MAX_DIAGNOSTIC_DATA_SERIALIZED_UTF8_BYTES)
                .unwrap_or(true)
        }) {
            record_sanitized(
                &mut budget.reasons,
                &mut budget.sanitized_field_count,
                LanguageServerDiagnosticProjectionReason::Field,
                1,
            );
            projected = None;
        }
        reasons.extend(budget.reasons);
        sanitized_field_count = sanitized_field_count.saturating_add(budget.sanitized_field_count);
        projected
    });
    let message = bounded_required_string(
        value.get("message"),
        "Language server diagnostic.",
        MAX_DIAGNOSTIC_MESSAGE_UTF8_BYTES,
        &mut reasons,
        &mut sanitized_field_count,
    );
    let source = bounded_optional_string(
        value.get("source"),
        MAX_DIAGNOSTIC_SHORT_FIELD_UTF8_BYTES,
        &mut reasons,
        &mut sanitized_field_count,
    );
    let tags = parse_tags(value.get("tags"), &mut reasons, &mut sanitized_field_count);
    let related_information = parse_related_information(
        value.get("relatedInformation"),
        &mut reasons,
        &mut sanitized_field_count,
    );
    let severity_value = value.get("severity");
    let severity_number = severity_value.and_then(Value::as_u64);
    if severity_value.is_some() && !matches!(severity_number, Some(1..=4)) {
        record_sanitized(
            &mut reasons,
            &mut sanitized_field_count,
            LanguageServerDiagnosticProjectionReason::Field,
            1,
        );
    }

    ParsedDiagnostic {
        diagnostic: LanguageServerDiagnostic {
            code,
            code_description_href,
            data,
            message,
            severity: parse_severity(severity_number),
            source,
            tags,
            related_information,
            line,
            character,
            end_line,
            end_character,
        },
        reasons,
        sanitized_field_count,
    }
}

fn parse_related_information(
    value: Option<&Value>,
    reasons: &mut BTreeSet<LanguageServerDiagnosticProjectionReason>,
    sanitized_field_count: &mut usize,
) -> Vec<LanguageServerDiagnosticRelatedInformation> {
    let Some(value) = value else {
        return Vec::new();
    };
    let Some(items) = value.as_array() else {
        record_sanitized(
            reasons,
            sanitized_field_count,
            LanguageServerDiagnosticProjectionReason::Field,
            1,
        );
        return Vec::new();
    };

    if items.len() > MAX_DIAGNOSTIC_RELATED_INFORMATION {
        record_sanitized(
            reasons,
            sanitized_field_count,
            LanguageServerDiagnosticProjectionReason::RelatedInformation,
            items.len() - MAX_DIAGNOSTIC_RELATED_INFORMATION,
        );
    }

    items
        .iter()
        .take(MAX_DIAGNOSTIC_RELATED_INFORMATION)
        .filter_map(|item| parse_related_information_item(item, reasons, sanitized_field_count))
        .collect()
}

fn parse_related_information_item(
    value: &Value,
    reasons: &mut BTreeSet<LanguageServerDiagnosticProjectionReason>,
    sanitized_field_count: &mut usize,
) -> Option<LanguageServerDiagnosticRelatedInformation> {
    let Some(location) = value.get("location") else {
        record_sanitized(
            reasons,
            sanitized_field_count,
            LanguageServerDiagnosticProjectionReason::Field,
            1,
        );
        return None;
    };
    let Some(uri) = location.get("uri").and_then(Value::as_str) else {
        record_sanitized(
            reasons,
            sanitized_field_count,
            LanguageServerDiagnosticProjectionReason::Field,
            1,
        );
        return None;
    };
    if uri.len() > MAX_DIAGNOSTIC_URI_HREF_UTF8_BYTES || !is_absolute_uri(uri) {
        record_sanitized(
            reasons,
            sanitized_field_count,
            LanguageServerDiagnosticProjectionReason::Field,
            1,
        );
        return None;
    }
    let Some(range) = location.get("range") else {
        record_sanitized(
            reasons,
            sanitized_field_count,
            LanguageServerDiagnosticProjectionReason::Field,
            1,
        );
        return None;
    };
    let Some((line, character)) = parse_position(range.get("start")) else {
        record_sanitized(
            reasons,
            sanitized_field_count,
            LanguageServerDiagnosticProjectionReason::Field,
            1,
        );
        return None;
    };
    let (end_line, end_character) = parse_end_position(
        range.get("end"),
        line,
        character,
        reasons,
        sanitized_field_count,
    );
    let message = bounded_required_string(
        value.get("message"),
        "Related diagnostic information.",
        MAX_DIAGNOSTIC_MESSAGE_UTF8_BYTES,
        reasons,
        sanitized_field_count,
    );

    Some(LanguageServerDiagnosticRelatedInformation {
        uri: uri.to_string(),
        message,
        line,
        character,
        end_line,
        end_character,
    })
}

fn parse_position(value: Option<&Value>) -> Option<(u64, u64)> {
    let value = value?;
    let line = value.get("line").and_then(Value::as_u64)?;
    let character = value.get("character").and_then(Value::as_u64)?;
    if line > MAX_DIAGNOSTIC_POSITION || character > MAX_DIAGNOSTIC_POSITION {
        return None;
    }

    Some((line, character))
}

fn parse_end_position(
    value: Option<&Value>,
    start_line: u64,
    start_character: u64,
    reasons: &mut BTreeSet<LanguageServerDiagnosticProjectionReason>,
    sanitized_field_count: &mut usize,
) -> (u64, u64) {
    let Some((end_line, end_character)) = parse_position(value) else {
        record_sanitized(
            reasons,
            sanitized_field_count,
            LanguageServerDiagnosticProjectionReason::Field,
            1,
        );
        return (
            start_line,
            start_character
                .saturating_add(1)
                .min(MAX_DIAGNOSTIC_POSITION),
        );
    };
    if end_line < start_line || (end_line == start_line && end_character < start_character) {
        record_sanitized(
            reasons,
            sanitized_field_count,
            LanguageServerDiagnosticProjectionReason::Field,
            1,
        );
        return (start_line, start_character);
    }
    (end_line, end_character)
}

fn parse_tags(
    value: Option<&Value>,
    reasons: &mut BTreeSet<LanguageServerDiagnosticProjectionReason>,
    sanitized_field_count: &mut usize,
) -> Vec<u64> {
    let Some(value) = value else {
        return Vec::new();
    };
    let Some(tags) = value.as_array() else {
        record_sanitized(
            reasons,
            sanitized_field_count,
            LanguageServerDiagnosticProjectionReason::Field,
            1,
        );
        return Vec::new();
    };

    let mut retained = Vec::with_capacity(MAX_DIAGNOSTIC_TAGS);
    for tag in tags {
        let Some(tag) = tag
            .as_u64()
            .filter(|tag| DIAGNOSTIC_TAG_VALUES.contains(tag))
        else {
            record_sanitized(
                reasons,
                sanitized_field_count,
                LanguageServerDiagnosticProjectionReason::Field,
                1,
            );
            continue;
        };
        if retained.contains(&tag) {
            record_sanitized(
                reasons,
                sanitized_field_count,
                LanguageServerDiagnosticProjectionReason::Field,
                1,
            );
            continue;
        }
        retained.push(tag);
    }
    retained
}

fn parse_code(
    value: Option<&Value>,
    reasons: &mut BTreeSet<LanguageServerDiagnosticProjectionReason>,
    sanitized_field_count: &mut usize,
) -> Option<LanguageServerDiagnosticCode> {
    let value = value?;

    if let Some(code) = value.as_i64() {
        if !(-MAX_JAVASCRIPT_SAFE_INTEGER..=MAX_JAVASCRIPT_SAFE_INTEGER).contains(&code) {
            record_sanitized(
                reasons,
                sanitized_field_count,
                LanguageServerDiagnosticProjectionReason::Field,
                1,
            );
            return None;
        }
        return Some(LanguageServerDiagnosticCode::Number(code));
    }

    if let Some(code) = value.as_str() {
        let bounded = truncate_utf8(code, MAX_DIAGNOSTIC_SHORT_FIELD_UTF8_BYTES);
        if bounded.len() != code.len() {
            record_sanitized(
                reasons,
                sanitized_field_count,
                LanguageServerDiagnosticProjectionReason::Field,
                1,
            );
        }
        return Some(LanguageServerDiagnosticCode::String(bounded.to_string()));
    }

    record_sanitized(
        reasons,
        sanitized_field_count,
        LanguageServerDiagnosticProjectionReason::Field,
        1,
    );
    None
}

fn parse_severity(value: Option<u64>) -> LanguageServerDiagnosticSeverity {
    if value == Some(1) {
        return LanguageServerDiagnosticSeverity::Error;
    }

    if value == Some(2) {
        return LanguageServerDiagnosticSeverity::Warning;
    }

    if value == Some(4) {
        return LanguageServerDiagnosticSeverity::Hint;
    }

    LanguageServerDiagnosticSeverity::Information
}

impl LanguageServerDiagnosticSeverityCounts {
    fn increment(&mut self, severity: LanguageServerDiagnosticSeverity) {
        match severity {
            LanguageServerDiagnosticSeverity::Error => self.error += 1,
            LanguageServerDiagnosticSeverity::Warning => self.warning += 1,
            LanguageServerDiagnosticSeverity::Information => self.information += 1,
            LanguageServerDiagnosticSeverity::Hint => self.hint += 1,
        }
    }
}

fn bounded_required_string(
    value: Option<&Value>,
    fallback: &str,
    max_bytes: usize,
    reasons: &mut BTreeSet<LanguageServerDiagnosticProjectionReason>,
    sanitized_field_count: &mut usize,
) -> String {
    let Some(source) = value.and_then(Value::as_str) else {
        record_sanitized(
            reasons,
            sanitized_field_count,
            LanguageServerDiagnosticProjectionReason::Field,
            1,
        );
        return fallback.to_string();
    };
    let bounded = truncate_utf8(source, max_bytes);
    if bounded.len() != source.len() {
        record_sanitized(
            reasons,
            sanitized_field_count,
            LanguageServerDiagnosticProjectionReason::Field,
            1,
        );
    }
    bounded.to_string()
}

fn bounded_optional_string(
    value: Option<&Value>,
    max_bytes: usize,
    reasons: &mut BTreeSet<LanguageServerDiagnosticProjectionReason>,
    sanitized_field_count: &mut usize,
) -> Option<String> {
    let value = value?;
    let Some(source) = value.as_str() else {
        record_sanitized(
            reasons,
            sanitized_field_count,
            LanguageServerDiagnosticProjectionReason::Field,
            1,
        );
        return None;
    };
    if source.len() <= max_bytes {
        return Some(source.to_string());
    }
    record_sanitized(
        reasons,
        sanitized_field_count,
        LanguageServerDiagnosticProjectionReason::Field,
        1,
    );
    Some(truncate_utf8(source, max_bytes).to_string())
}

fn parse_code_description_href(
    value: Option<&Value>,
    reasons: &mut BTreeSet<LanguageServerDiagnosticProjectionReason>,
    sanitized_field_count: &mut usize,
) -> Option<String> {
    let value = value?;
    let Some(href) = value
        .as_object()
        .and_then(|description| description.get("href"))
        .and_then(Value::as_str)
    else {
        record_sanitized(
            reasons,
            sanitized_field_count,
            LanguageServerDiagnosticProjectionReason::Field,
            1,
        );
        return None;
    };
    if href.len() > MAX_DIAGNOSTIC_URI_HREF_UTF8_BYTES || !is_absolute_uri(href) {
        record_sanitized(
            reasons,
            sanitized_field_count,
            LanguageServerDiagnosticProjectionReason::Field,
            1,
        );
        return None;
    }
    Some(href.to_string())
}

fn is_absolute_uri(value: &str) -> bool {
    url::Url::parse(value).is_ok()
}

fn truncate_utf8(value: &str, max_bytes: usize) -> &str {
    if value.len() <= max_bytes {
        return value;
    }
    let mut boundary = max_bytes;
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    &value[..boundary]
}

fn serialized_utf8_len(value: &impl Serialize) -> Option<usize> {
    let mut counter = Utf8ByteCounter::default();
    serde_json::to_writer(&mut counter, value).ok()?;
    Some(counter.bytes)
}

#[derive(Default)]
struct Utf8ByteCounter {
    bytes: usize,
}

impl Write for Utf8ByteCounter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        self.bytes = self.bytes.saturating_add(buffer.len());
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn record_sanitized(
    reasons: &mut BTreeSet<LanguageServerDiagnosticProjectionReason>,
    sanitized_field_count: &mut usize,
    reason: LanguageServerDiagnosticProjectionReason,
    count: usize,
) {
    reasons.insert(reason);
    *sanitized_field_count = sanitized_field_count.saturating_add(count);
}

struct DataProjectionBudget {
    remaining_nodes: usize,
    remaining_string_bytes: usize,
    reasons: BTreeSet<LanguageServerDiagnosticProjectionReason>,
    sanitized_field_count: usize,
}

impl Default for DataProjectionBudget {
    fn default() -> Self {
        Self {
            remaining_nodes: MAX_DIAGNOSTIC_DATA_NODES,
            remaining_string_bytes: MAX_DATA_STRING_UTF8_BYTES,
            reasons: BTreeSet::new(),
            sanitized_field_count: 0,
        }
    }
}

fn project_data(value: &Value, depth: usize, budget: &mut DataProjectionBudget) -> Option<Value> {
    if depth > MAX_DIAGNOSTIC_DATA_DEPTH {
        record_sanitized(
            &mut budget.reasons,
            &mut budget.sanitized_field_count,
            LanguageServerDiagnosticProjectionReason::DataDepth,
            1,
        );
        return None;
    }
    if budget.remaining_nodes == 0 {
        record_sanitized(
            &mut budget.reasons,
            &mut budget.sanitized_field_count,
            LanguageServerDiagnosticProjectionReason::Field,
            1,
        );
        return None;
    }
    budget.remaining_nodes -= 1;

    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) => Some(value.clone()),
        Value::String(value) => {
            let permitted = value
                .len()
                .min(MAX_DIAGNOSTIC_SHORT_FIELD_UTF8_BYTES)
                .min(budget.remaining_string_bytes);
            if permitted == 0 && !value.is_empty() {
                record_sanitized(
                    &mut budget.reasons,
                    &mut budget.sanitized_field_count,
                    LanguageServerDiagnosticProjectionReason::Field,
                    1,
                );
                return None;
            }
            let bounded = truncate_utf8(value, permitted);
            budget.remaining_string_bytes -= bounded.len();
            if bounded.len() != value.len() {
                record_sanitized(
                    &mut budget.reasons,
                    &mut budget.sanitized_field_count,
                    LanguageServerDiagnosticProjectionReason::Field,
                    1,
                );
            }
            Some(Value::String(bounded.to_string()))
        }
        Value::Array(items) => {
            if items.len() > MAX_DIAGNOSTIC_DATA_CONTAINER_ITEMS {
                record_sanitized(
                    &mut budget.reasons,
                    &mut budget.sanitized_field_count,
                    LanguageServerDiagnosticProjectionReason::Field,
                    items.len() - MAX_DIAGNOSTIC_DATA_CONTAINER_ITEMS,
                );
            }
            let projected = items
                .iter()
                .take(MAX_DIAGNOSTIC_DATA_CONTAINER_ITEMS)
                .filter_map(|item| project_data(item, depth + 1, budget))
                .collect();
            Some(Value::Array(projected))
        }
        Value::Object(object) => {
            if object.len() > MAX_DIAGNOSTIC_DATA_CONTAINER_ITEMS {
                record_sanitized(
                    &mut budget.reasons,
                    &mut budget.sanitized_field_count,
                    LanguageServerDiagnosticProjectionReason::Field,
                    object.len() - MAX_DIAGNOSTIC_DATA_CONTAINER_ITEMS,
                );
            }
            let mut projected = Map::new();
            for (key, item) in object.iter().take(MAX_DIAGNOSTIC_DATA_CONTAINER_ITEMS) {
                if key.len() > MAX_DIAGNOSTIC_SHORT_FIELD_UTF8_BYTES
                    || key.len() > budget.remaining_string_bytes
                {
                    record_sanitized(
                        &mut budget.reasons,
                        &mut budget.sanitized_field_count,
                        LanguageServerDiagnosticProjectionReason::Field,
                        1,
                    );
                    continue;
                }
                budget.remaining_string_bytes -= key.len();
                if let Some(item) = project_data(item, depth + 1, budget) {
                    projected.insert(key.clone(), item);
                }
            }
            Some(Value::Object(projected))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        classify_publish_diagnostics_bytes, parse_publish_diagnostics,
        parse_publish_diagnostics_bytes, LanguageServerDiagnosticCode,
        LanguageServerDiagnosticProjection, LanguageServerDiagnosticProjectionReason,
        LanguageServerDiagnosticSeverity, PublishDiagnosticsBytes, MAX_RETAINED_DIAGNOSTICS,
        MAX_RETAINED_DIAGNOSTIC_UTF8_BYTES,
    };
    use serde_json::json;

    #[test]
    fn parses_publish_diagnostics_notification() {
        let event = parse_publish_diagnostics(
            &json!({
                "jsonrpc": "2.0",
                "method": "textDocument/publishDiagnostics",
                "params": {
                    "uri": "file:///tmp/User.php",
                    "version": 7,
                    "diagnostics": [
                        {
                            "range": {
                                "start": { "line": 2, "character": 4 },
                                "end": { "line": 2, "character": 8 }
                            },
                            "severity": 1,
                            "code": "worse.docblock_missing_param",
                            "codeDescription": {
                                "href": "https://phpactor.example/docs/worse.docblock_missing_param"
                            },
                            "data": {
                                "fixId": "addMissingImport"
                            },
                            "source": "phpactor",
                            "tags": [1, 2, 99, "bad"],
                            "relatedInformation": [
                                {
                                    "location": {
                                        "uri": "file:///tmp/Types.ts",
                                        "range": {
                                            "start": { "line": 9, "character": 2 },
                                            "end": { "line": 9, "character": 13 }
                                        }
                                    },
                                    "message": "The expected type comes from here."
                                },
                                {
                                    "location": {
                                        "uri": "file:///tmp/Broken.ts",
                                        "range": {
                                            "start": { "line": 1, "character": 0 }
                                        }
                                    },
                                    "message": "Missing end range is tolerated."
                                },
                                {
                                    "message": "Missing location is ignored."
                                }
                            ],
                            "message": "Unexpected token",
                        }
                    ]
                }
            }),
            42,
        )
        .expect("diagnostics event");

        assert_eq!(event.session_id, 42);
        assert_eq!(event.uri, "file:///tmp/User.php");
        assert_eq!(event.version, Some(7));
        assert_eq!(
            event.diagnostics[0].severity,
            LanguageServerDiagnosticSeverity::Error
        );
        assert_eq!(
            event.diagnostics[0].code,
            Some(LanguageServerDiagnosticCode::String(
                "worse.docblock_missing_param".to_string()
            ))
        );
        assert_eq!(
            event.diagnostics[0].code_description_href,
            Some("https://phpactor.example/docs/worse.docblock_missing_param".to_string())
        );
        assert_eq!(
            event.diagnostics[0].data,
            Some(json!({ "fixId": "addMissingImport" }))
        );
        assert_eq!(event.diagnostics[0].line, 2);
        assert_eq!(event.diagnostics[0].character, 4);
        assert_eq!(event.diagnostics[0].end_line, 2);
        assert_eq!(event.diagnostics[0].end_character, 8);
        assert_eq!(event.diagnostics[0].tags, vec![1, 2]);
        assert_eq!(event.diagnostics[0].related_information.len(), 2);
        assert_eq!(
            event.diagnostics[0].related_information[0].uri,
            "file:///tmp/Types.ts"
        );
        assert_eq!(
            event.diagnostics[0].related_information[0].message,
            "The expected type comes from here."
        );
        assert_eq!(event.diagnostics[0].related_information[0].line, 9);
        assert_eq!(event.diagnostics[0].related_information[0].character, 2);
        assert_eq!(event.diagnostics[0].related_information[0].end_line, 9);
        assert_eq!(
            event.diagnostics[0].related_information[0].end_character,
            13
        );
        assert_eq!(event.diagnostics[0].related_information[1].end_character, 1);
        assert_eq!(event.diagnostics[0].message, "Unexpected token");
    }

    #[test]
    fn falls_back_to_one_character_range_when_end_position_is_malformed() {
        let event = parse_publish_diagnostics(
            &json!({
                "jsonrpc": "2.0",
                "method": "textDocument/publishDiagnostics",
                "params": {
                    "uri": "file:///tmp/User.ts",
                    "diagnostics": [
                        {
                            "range": {
                                "start": { "line": 3, "character": 12 },
                                "end": { "line": 3 }
                            },
                            "message": "Unexpected token",
                        }
                    ]
                }
            }),
            42,
        )
        .expect("diagnostics event");

        assert_eq!(event.diagnostics[0].line, 3);
        assert_eq!(event.diagnostics[0].character, 12);
        assert_eq!(event.diagnostics[0].end_line, 3);
        assert_eq!(event.diagnostics[0].end_character, 13);
    }

    #[test]
    fn projects_ranges_to_monaco_safe_non_reversed_coordinates() {
        let event = parse_publish_diagnostics(
            &json!({
                "jsonrpc": "2.0",
                "method": "textDocument/publishDiagnostics",
                "params": {
                    "uri": "file:///tmp/User.ts",
                    "diagnostics": [
                        {
                            "range": {
                                "start": { "line": 4, "character": 8 },
                                "end": { "line": 3, "character": 9 }
                            },
                            "message": "reversed"
                        },
                        {
                            "range": {
                                "start": {
                                    "line": 2_147_483_648_u64,
                                    "character": 2_147_483_648_u64
                                },
                                "end": {
                                    "line": 2_147_483_648_u64,
                                    "character": 2_147_483_648_u64
                                }
                            },
                            "message": "oversized"
                        }
                    ]
                }
            }),
            42,
        )
        .expect("diagnostics event");

        assert_eq!(
            (
                event.diagnostics[0].line,
                event.diagnostics[0].character,
                event.diagnostics[0].end_line,
                event.diagnostics[0].end_character,
            ),
            (4, 8, 4, 8)
        );
        assert_eq!(
            (
                event.diagnostics[1].line,
                event.diagnostics[1].character,
                event.diagnostics[1].end_line,
                event.diagnostics[1].end_character,
            ),
            (0, 0, 0, 1)
        );
        assert!(matches!(
            event.projection,
            LanguageServerDiagnosticProjection::Truncated {
                omitted_count: 0,
                ref reasons,
                sanitized_field_count: 3,
                ..
            } if reasons == &[LanguageServerDiagnosticProjectionReason::Field]
        ));
    }

    #[test]
    fn ignores_other_messages() {
        assert!(parse_publish_diagnostics(
            &json!({
                "jsonrpc": "2.0",
                "method": "window/logMessage"
            }),
            1
        )
        .is_none());
    }

    #[test]
    fn distinguishes_malformed_notifications_from_authoritative_empty_clear() {
        for malformed in [
            json!({
                "method": "textDocument/publishDiagnostics",
                "params": { "uri": "file:///tmp/User.ts" }
            }),
            json!({
                "method": "textDocument/publishDiagnostics",
                "params": { "uri": "file:///tmp/User.ts", "diagnostics": null }
            }),
            json!({
                "method": "textDocument/publishDiagnostics",
                "params": { "uri": "file:///tmp/User.ts", "diagnostics": [false] }
            }),
            json!({
                "method": "textDocument/publishDiagnostics",
                "params": { "uri": "file:///tmp/User.ts", "diagnostics": [{}] }
            }),
            json!({
                "method": "textDocument/publishDiagnostics",
                "params": { "uri": 7, "diagnostics": [] }
            }),
        ] {
            assert!(parse_publish_diagnostics(&malformed, 9).is_none());
        }

        let clear = parse_publish_diagnostics(
            &json!({
                "method": "textDocument/publishDiagnostics",
                "params": {
                    "uri": "file:///tmp/User.ts",
                    "version": 41,
                    "diagnostics": []
                }
            }),
            9,
        )
        .expect("authoritative clear");

        assert!(clear.diagnostics.is_empty());
        assert_eq!(clear.session_id, 9);
        assert_eq!(clear.version, Some(41));
        assert_eq!(
            clear.projection,
            LanguageServerDiagnosticProjection::Complete {
                published_count: 0,
                retained_count: 0,
                severity_counts: Default::default(),
                retained_utf8_bytes: 2,
            }
        );

        let malformed_bytes = serde_json::to_vec(&json!({
            "method": "textDocument/publishDiagnostics",
            "params": { "uri": "file:///tmp/User.ts", "diagnostics": [{}] }
        }))
        .expect("serialize malformed notification");
        assert!(matches!(
            classify_publish_diagnostics_bytes(&malformed_bytes, 9),
            PublishDiagnosticsBytes::Malformed
        ));
    }

    #[test]
    fn complete_projection_and_diagnostic_use_the_golden_camel_case_wire_shape() {
        let event = parse_publish_diagnostics(
            &json!({
                "method": "textDocument/publishDiagnostics",
                "params": {
                    "uri": "file:///tmp/golden.ts",
                    "version": 7,
                    "diagnostics": [{
                        "range": {
                            "start": { "line": 2, "character": 3 },
                            "end": { "line": 2, "character": 4 }
                        },
                        "severity": 1,
                        "message": "x"
                    }]
                }
            }),
            42,
        )
        .expect("golden event");
        let retained_utf8_bytes = serde_json::to_vec(&event.diagnostics)
            .expect("serialize retained diagnostics")
            .len();

        assert_eq!(
            serde_json::to_value(event).expect("serialize event"),
            json!({
                "sessionId": 42,
                "uri": "file:///tmp/golden.ts",
                "version": 7,
                "diagnostics": [{
                    "code": null,
                    "codeDescriptionHref": null,
                    "message": "x",
                    "severity": "error",
                    "source": null,
                    "tags": [],
                    "relatedInformation": [],
                    "line": 2,
                    "character": 3,
                    "endLine": 2,
                    "endCharacter": 4
                }],
                "projection": {
                    "kind": "complete",
                    "publishedCount": 1,
                    "retainedCount": 1,
                    "severityCounts": {
                        "error": 1,
                        "warning": 0,
                        "information": 0,
                        "hint": 0
                    },
                    "retainedUtf8Bytes": retained_utf8_bytes
                }
            })
        );
    }

    #[test]
    fn projection_reason_wire_names_remain_stable() {
        for (reason, wire) in [
            (LanguageServerDiagnosticProjectionReason::Item, "itemLimit"),
            (LanguageServerDiagnosticProjectionReason::Byte, "byteLimit"),
            (
                LanguageServerDiagnosticProjectionReason::Field,
                "fieldLimit",
            ),
            (
                LanguageServerDiagnosticProjectionReason::DataDepth,
                "dataDepthLimit",
            ),
            (
                LanguageServerDiagnosticProjectionReason::RelatedInformation,
                "relatedInformationLimit",
            ),
            (
                LanguageServerDiagnosticProjectionReason::AuthorityNode,
                "authorityNodeLimit",
            ),
            (
                LanguageServerDiagnosticProjectionReason::PathProbe,
                "pathProbeLimit",
            ),
        ] {
            assert_eq!(
                serde_json::to_value(reason).expect("serialize projection reason"),
                json!(wire)
            );
        }
    }

    #[test]
    fn rust_contract_matches_the_cross_language_manifest() {
        let manifest: serde_json::Value = serde_json::from_str(include_str!(
            "../../contracts/lsp-diagnostics-projection.json"
        ))
        .expect("parse canonical diagnostics contract");

        assert_eq!(
            manifest,
            json!({
                "schemaVersion": 1,
                "javascriptSafeInteger": super::MAX_JAVASCRIPT_SAFE_INTEGER,
                "maxDiagnostics": MAX_RETAINED_DIAGNOSTICS,
                "maxDiagnosticsUtf8Bytes": MAX_RETAINED_DIAGNOSTIC_UTF8_BYTES,
                "authority": {
                    "dataNodes": super::MAX_DIAGNOSTIC_AUTHORITY_DATA_NODES,
                    "filesystemProbes": super::MAX_DIAGNOSTIC_AUTHORITY_FILESYSTEM_PROBES,
                    "pathCacheEntries": super::MAX_DIAGNOSTIC_AUTHORITY_PATH_CACHE_ENTRIES,
                    "pathCacheUtf8Bytes":
                        super::MAX_DIAGNOSTIC_AUTHORITY_PATH_CACHE_UTF8_BYTES,
                },
                "diagnostic": {
                    "messageUtf8Bytes": super::MAX_DIAGNOSTIC_MESSAGE_UTF8_BYTES,
                    "shortFieldUtf8Bytes": super::MAX_DIAGNOSTIC_SHORT_FIELD_UTF8_BYTES,
                    "uriHrefUtf8Bytes": super::MAX_DIAGNOSTIC_URI_HREF_UTF8_BYTES,
                    "dataUtf8Bytes": super::MAX_DIAGNOSTIC_DATA_SERIALIZED_UTF8_BYTES,
                    "dataDepth": super::MAX_DIAGNOSTIC_DATA_DEPTH,
                    "dataNodes": super::MAX_DIAGNOSTIC_DATA_NODES,
                    "dataContainerItems": super::MAX_DIAGNOSTIC_DATA_CONTAINER_ITEMS,
                    "relatedInformation": super::MAX_DIAGNOSTIC_RELATED_INFORMATION,
                    "tags": super::MAX_DIAGNOSTIC_TAGS,
                    "tagValues": super::DIAGNOSTIC_TAG_VALUES,
                    "position": super::MAX_DIAGNOSTIC_POSITION,
                },
                "reasons": [
                    "itemLimit",
                    "byteLimit",
                    "fieldLimit",
                    "dataDepthLimit",
                    "relatedInformationLimit",
                    "authorityNodeLimit",
                    "pathProbeLimit",
                ],
                "wire": {
                    "eventKeys": [
                        "rootPath",
                        "sessionId",
                        "uri",
                        "version",
                        "diagnostics",
                        "projection",
                    ],
                    "diagnosticRequiredKeys": [
                        "code",
                        "codeDescriptionHref",
                        "message",
                        "severity",
                        "source",
                        "tags",
                        "relatedInformation",
                        "line",
                        "character",
                        "endLine",
                        "endCharacter",
                    ],
                    "diagnosticOptionalKeys": ["data"],
                    "relatedInformationRequiredKeys": [
                        "uri",
                        "message",
                        "line",
                        "character",
                        "endLine",
                        "endCharacter",
                    ],
                    "relatedInformationOptionalKeys": [],
                    "completeProjectionKeys": [
                        "kind",
                        "publishedCount",
                        "retainedCount",
                        "severityCounts",
                        "retainedUtf8Bytes",
                    ],
                    "truncatedProjectionKeys": [
                        "kind",
                        "publishedCount",
                        "retainedCount",
                        "severityCounts",
                        "retainedUtf8Bytes",
                        "omittedCount",
                        "reasons",
                        "sanitizedFieldCount",
                    ],
                    "severityKeys": ["error", "warning", "information", "hint"],
                    "projectionKinds": ["complete", "truncated"],
                    "severityCountsAuthority": "published",
                    "retainedUtf8BytesAuthority": "nativeSerde",
                    "decodedUtf8BytesAuthority": "typescriptDecoder",
                    "publishedEqualsRetainedPlusOmitted": true,
                    "rangesAreNonNegative": true,
                    "rangeEndNotBeforeStart": true,
                    "javascriptSafeIntegerFields": [
                        "sessionId",
                        "version",
                        "diagnostic.code",
                    ],
                    "sessionIdPositive": true,
                },
            })
        );
    }

    #[test]
    fn caps_one_hundred_thousand_diagnostics_without_mapping_the_omitted_tail() {
        let diagnostics = (0..100_000)
            .map(|index| {
                json!({
                    "range": {
                        "start": { "line": index, "character": 0 },
                        "end": { "line": index, "character": 1 }
                    },
                    "severity": (index % 4) + 1,
                    "message": "bounded"
                })
            })
            .collect::<Vec<_>>();
        let notification = json!({
            "method": "textDocument/publishDiagnostics",
            "params": {
                "uri": "file:///tmp/huge.ts",
                "diagnostics": diagnostics
            }
        });
        let bytes = serde_json::to_vec(&notification).expect("serialize notification");
        super::FULL_DIAGNOSTIC_VALUE_DECODES.with(|count| count.set(0));
        let event = parse_publish_diagnostics_bytes(&bytes, 77).expect("bounded streaming event");
        let full_value_decodes = super::FULL_DIAGNOSTIC_VALUE_DECODES.with(std::cell::Cell::get);

        assert_eq!(event.diagnostics.len(), MAX_RETAINED_DIAGNOSTICS);
        assert_eq!(full_value_decodes, MAX_RETAINED_DIAGNOSTICS);
        let serialized_bytes = serde_json::to_vec(&event.diagnostics)
            .expect("serialize retained diagnostics")
            .len();
        assert!(serialized_bytes <= MAX_RETAINED_DIAGNOSTIC_UTF8_BYTES);
        assert_eq!(
            event.projection,
            LanguageServerDiagnosticProjection::Truncated {
                published_count: 100_000,
                retained_count: MAX_RETAINED_DIAGNOSTICS,
                omitted_count: 100_000 - MAX_RETAINED_DIAGNOSTICS,
                severity_counts: super::LanguageServerDiagnosticSeverityCounts {
                    error: 25_000,
                    warning: 25_000,
                    information: 25_000,
                    hint: 25_000,
                },
                retained_utf8_bytes: serialized_bytes,
                reasons: vec![LanguageServerDiagnosticProjectionReason::Item],
                sanitized_field_count: 0,
            }
        );
    }

    #[test]
    fn item_limit_boundary_is_complete_then_truthfully_truncated() {
        let diagnostic = json!({
            "range": {
                "start": { "line": 0, "character": 0 },
                "end": { "line": 0, "character": 1 }
            },
            "severity": 1,
            "message": "x"
        });
        let parse_count = |count| {
            parse_publish_diagnostics(
                &json!({
                    "method": "textDocument/publishDiagnostics",
                    "params": {
                        "uri": "file:///tmp/boundary.ts",
                        "diagnostics": vec![diagnostic.clone(); count]
                    }
                }),
                1,
            )
            .expect("event")
        };

        assert!(matches!(
            parse_count(MAX_RETAINED_DIAGNOSTICS).projection,
            LanguageServerDiagnosticProjection::Complete { .. }
        ));
        assert!(matches!(
            parse_count(MAX_RETAINED_DIAGNOSTICS + 1).projection,
            LanguageServerDiagnosticProjection::Truncated {
                omitted_count: 1,
                ref reasons,
                ..
            } if reasons == &[LanguageServerDiagnosticProjectionReason::Item]
        ));
    }

    #[test]
    fn byte_budget_is_exact_and_uses_a_prefix_projection() {
        let diagnostics = vec![
            json!({
                "range": {
                    "start": { "line": 0, "character": 0 },
                    "end": { "line": 0, "character": 1 }
                },
                "severity": 2,
                "message": "é".repeat(super::MAX_DIAGNOSTIC_MESSAGE_UTF8_BYTES / 2)
            });
            MAX_RETAINED_DIAGNOSTICS
        ];
        let event = parse_publish_diagnostics(
            &json!({
                "method": "textDocument/publishDiagnostics",
                "params": {
                    "uri": "file:///tmp/bytes.ts",
                    "diagnostics": diagnostics
                }
            }),
            1,
        )
        .expect("event");
        let serialized_bytes = serde_json::to_vec(&event.diagnostics)
            .expect("serialize retained diagnostics")
            .len();

        assert!(serialized_bytes <= MAX_RETAINED_DIAGNOSTIC_UTF8_BYTES);
        assert!(event.diagnostics.len() < MAX_RETAINED_DIAGNOSTICS);
        assert!(matches!(
            event.projection,
            LanguageServerDiagnosticProjection::Truncated {
                retained_utf8_bytes,
                ref reasons,
                ..
            } if retained_utf8_bytes == serialized_bytes
                && reasons == &[LanguageServerDiagnosticProjectionReason::Byte]
        ));
    }

    #[test]
    fn sanitizes_fields_related_information_and_deep_data_with_exact_receipt() {
        let mut deep = json!("leaf");
        for _ in 0..=super::MAX_DIAGNOSTIC_DATA_DEPTH {
            deep = json!({ "next": deep });
        }
        let related = (0..(super::MAX_DIAGNOSTIC_RELATED_INFORMATION + 3))
            .map(|index| {
                json!({
                    "location": {
                        "uri": format!("file:///tmp/{index}.ts"),
                        "range": {
                            "start": { "line": index, "character": 0 },
                            "end": { "line": index, "character": 1 }
                        }
                    },
                    "message": "related"
                })
            })
            .collect::<Vec<_>>();
        let event = parse_publish_diagnostics(
            &json!({
                "method": "textDocument/publishDiagnostics",
                "params": {
                    "uri": "file:///tmp/sanitized.ts",
                    "diagnostics": [{
                        "range": {
                            "start": { "line": 0, "character": 0 },
                            "end": { "line": 0, "character": 1 }
                        },
                        "severity": 4,
                        "message": "m".repeat(super::MAX_DIAGNOSTIC_MESSAGE_UTF8_BYTES + 1),
                        "source": "s".repeat(super::MAX_DIAGNOSTIC_SHORT_FIELD_UTF8_BYTES + 1),
                        "data": deep,
                        "relatedInformation": related
                    }]
                }
            }),
            4,
        )
        .expect("event");

        assert_eq!(
            event.diagnostics[0].message.len(),
            super::MAX_DIAGNOSTIC_MESSAGE_UTF8_BYTES
        );
        assert_eq!(
            event.diagnostics[0].source.as_deref().map(str::len),
            Some(super::MAX_DIAGNOSTIC_SHORT_FIELD_UTF8_BYTES)
        );
        assert_eq!(
            event.diagnostics[0].related_information.len(),
            super::MAX_DIAGNOSTIC_RELATED_INFORMATION
        );
        assert!(matches!(
            event.projection,
            LanguageServerDiagnosticProjection::Truncated {
                published_count: 1,
                retained_count: 1,
                omitted_count: 0,
                ref reasons,
                sanitized_field_count,
                ..
            } if sanitized_field_count >= 6
                && reasons == &[
                    LanguageServerDiagnosticProjectionReason::Field,
                    LanguageServerDiagnosticProjectionReason::DataDepth,
                    LanguageServerDiagnosticProjectionReason::RelatedInformation,
                ]
        ));
    }

    #[test]
    fn removes_invalid_absolute_uris_with_a_field_sanitization_receipt() {
        let event = parse_publish_diagnostics(
            &json!({
                "method": "textDocument/publishDiagnostics",
                "params": {
                    "uri": "file:///tmp/uri.ts",
                    "diagnostics": [
                        {
                            "range": {
                                "start": { "line": 0, "character": 0 },
                                "end": { "line": 0, "character": 1 }
                            },
                            "message": "bad URI metadata",
                            "codeDescription": { "href": "http://[bad]" },
                            "relatedInformation": [{
                                "location": {
                                    "uri": "http://[bad]",
                                    "range": {
                                        "start": { "line": 0, "character": 0 },
                                        "end": { "line": 0, "character": 1 }
                                    }
                                },
                                "message": "invalid"
                            }]
                        },
                        {
                            "range": {
                                "start": { "line": 1, "character": 0 },
                                "end": { "line": 1, "character": 1 }
                            },
                            "message": "missing href",
                            "codeDescription": {}
                        }
                    ]
                }
            }),
            5,
        )
        .expect("sanitized event");

        assert_eq!(event.diagnostics[0].code_description_href, None);
        assert!(event.diagnostics[0].related_information.is_empty());
        assert_eq!(event.diagnostics[1].code_description_href, None);
        assert!(matches!(
            event.projection,
            LanguageServerDiagnosticProjection::Truncated {
                omitted_count: 0,
                ref reasons,
                sanitized_field_count: 3,
                ..
            } if reasons == &[LanguageServerDiagnosticProjectionReason::Field]
        ));
    }

    #[test]
    fn session_and_version_authority_survives_a_b_a_generation_sequence() {
        let notification = |version| {
            json!({
                "method": "textDocument/publishDiagnostics",
                "params": {
                    "uri": "file:///tmp/authority.ts",
                    "version": version,
                    "diagnostics": []
                }
            })
        };
        let first_a = parse_publish_diagnostics(&notification(1), 10).expect("first A");
        let b = parse_publish_diagnostics(&notification(2), 20).expect("B");
        let replacement_a = parse_publish_diagnostics(&notification(3), 11).expect("replacement A");

        assert_eq!((first_a.session_id, first_a.version), (10, Some(1)));
        assert_eq!((b.session_id, b.version), (20, Some(2)));
        assert_eq!(
            (replacement_a.session_id, replacement_a.version),
            (11, Some(3))
        );
    }
}
