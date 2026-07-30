use super::LanguageServerRange;
use serde::Serialize;
use serde_json::Value;

pub(super) const MAX_HOVER_CONTENT_ITEMS: usize = 32;
pub(super) const MAX_HOVER_CONTENT_ITEM_BYTES: usize = 16 * 1024;
const MAX_HOVER_CONTENT_TOTAL_BYTES: usize = 64 * 1024;
const MAX_HOVER_LANGUAGE_BYTES: usize = 64;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerHover {
    pub contents: Vec<LanguageServerHoverContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<LanguageServerRange>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum LanguageServerHoverContent {
    Code { language: String, value: String },
    Markdown { value: String },
    Plaintext { value: String },
}

impl LanguageServerHoverContent {
    fn value(&self) -> &str {
        match self {
            Self::Code { value, .. } | Self::Markdown { value } | Self::Plaintext { value } => {
                value
            }
        }
    }
}

pub fn parse_hover_result(value: &Value) -> Result<Option<LanguageServerHover>, String> {
    if value.is_null() {
        return Ok(None);
    }

    let contents_value = value
        .get("contents")
        .ok_or_else(|| "Language server returned a malformed hover response.".to_string())?;
    let contents = parse_hover_contents(contents_value)?;

    if contents
        .iter()
        .all(|content| content.value().trim().is_empty())
    {
        return Ok(None);
    }

    let range = value
        .get("range")
        .filter(|range| !range.is_null())
        .map(|range| {
            serde_json::from_value::<LanguageServerRange>(range.clone())
                .map_err(|_| "Language server returned a malformed hover range.".to_string())
                .and_then(validate_hover_range)
        })
        .transpose()?;

    Ok(Some(LanguageServerHover { contents, range }))
}

fn parse_hover_contents(value: &Value) -> Result<Vec<LanguageServerHoverContent>, String> {
    let values = value
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_else(|| std::slice::from_ref(value));
    if values.len() > MAX_HOVER_CONTENT_ITEMS {
        return Err("Language server hover contains too many content items.".to_string());
    }

    let mut total_bytes = 0usize;
    values
        .iter()
        .map(|item| {
            let content = parse_hover_content(item)?;
            let item_bytes = content.value().len()
                + match &content {
                    LanguageServerHoverContent::Code { language, .. } => language.len(),
                    LanguageServerHoverContent::Markdown { .. }
                    | LanguageServerHoverContent::Plaintext { .. } => 0,
                };
            if item_bytes > MAX_HOVER_CONTENT_ITEM_BYTES {
                return Err("Language server hover content item is too large.".to_string());
            }
            total_bytes = total_bytes.saturating_add(item_bytes);
            if total_bytes > MAX_HOVER_CONTENT_TOTAL_BYTES {
                return Err("Language server hover content is too large.".to_string());
            }
            Ok(content)
        })
        .collect()
}

fn parse_hover_content(value: &Value) -> Result<LanguageServerHoverContent, String> {
    if let Some(value) = value.as_str() {
        return Ok(LanguageServerHoverContent::Markdown {
            value: value.to_string(),
        });
    }

    let object = value
        .as_object()
        .ok_or_else(|| "Language server returned malformed hover content.".to_string())?;
    let content_value = object
        .get("value")
        .and_then(Value::as_str)
        .ok_or_else(|| "Language server returned malformed hover content.".to_string())?;

    if let Some(kind) = object.get("kind").and_then(Value::as_str) {
        if kind != "markdown" && kind != "plaintext" {
            return Err("Language server returned an unsupported hover content kind.".to_string());
        }
        return Ok(if kind == "markdown" {
            LanguageServerHoverContent::Markdown {
                value: content_value.to_string(),
            }
        } else {
            LanguageServerHoverContent::Plaintext {
                value: content_value.to_string(),
            }
        });
    }

    let language = object
        .get("language")
        .and_then(Value::as_str)
        .ok_or_else(|| "Language server returned malformed hover content.".to_string())?;
    if language.is_empty() || language.len() > MAX_HOVER_LANGUAGE_BYTES {
        return Err("Language server returned an invalid hover code language.".to_string());
    }
    Ok(LanguageServerHoverContent::Code {
        language: language.to_string(),
        value: content_value.to_string(),
    })
}

fn validate_hover_range(range: LanguageServerRange) -> Result<LanguageServerRange, String> {
    let starts_before_end = range.start.line < range.end.line
        || (range.start.line == range.end.line && range.start.character <= range.end.character);
    if !starts_before_end {
        return Err("Language server returned a reversed hover range.".to_string());
    }
    Ok(range)
}
