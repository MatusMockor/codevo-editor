use super::{ExternalSessionAttachment, ExternalSessionImageMime};
use serde::de::{Error as DeError, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use std::fmt;

pub const MAX_EXTERNAL_SESSION_EXCHANGE_ATTACHMENTS: usize = 8;
pub const MAX_EXTERNAL_SESSION_ATTACHMENT_NAME_BYTES: usize = 255;
pub const MAX_SCANNED_ATTACHMENT_PATH_BYTES: usize = 1024;

const MAX_SCANNED_CONTENT_BLOCKS: usize = 64;
const MAX_RETAINED_CONTENT_BLOCKS: usize = 1024;
const MAX_SCANNED_DATA_URL_PREFIX_BYTES: usize = 128;
const MAX_SCANNED_TEXT_LINES: usize = 256;

const ATTACHED_LINE_PREFIXES: [(&str, AttachedLineKind); 2] = [
    ("[Attached file \"", AttachedLineKind::File),
    ("[Attached image \"", AttachedLineKind::Image),
];
const ATTACHED_FILE_STORED_SEPARATOR: &str = "\" is saved at: ";
const ATTACHED_FILE_REFERENCE_SEPARATOR: &str = "\" is at: ";

pub fn claude_exchange_attachments(
    blocks: &[RawClaudeBlock],
    text: &str,
) -> Vec<ExternalSessionAttachment> {
    let images = blocks
        .iter()
        .take(MAX_SCANNED_CONTENT_BLOCKS)
        .filter(|block| block.block_type.as_deref() == Some("image"))
        .filter_map(|block| ExternalSessionImageMime::from_media_type(block.media_type.as_deref()?))
        .map(|mime| ExternalSessionAttachment::Image {
            mime,
            name: None,
            path: None,
        });
    bounded_attachments(images.chain(attached_lines(text).files))
}

pub fn codex_exchange_attachments(
    blocks: &[RawCodexBlock],
    text: &str,
) -> Vec<ExternalSessionAttachment> {
    let AttachedLines { files, image_names } = attached_lines(text);
    let images = blocks
        .iter()
        .take(MAX_SCANNED_CONTENT_BLOCKS)
        .filter_map(|block| codex_image_block(block, &image_names));
    bounded_attachments(images.chain(files))
}

fn bounded_attachments(
    attachments: impl Iterator<Item = ExternalSessionAttachment>,
) -> Vec<ExternalSessionAttachment> {
    attachments
        .take(MAX_EXTERNAL_SESSION_EXCHANGE_ATTACHMENTS)
        .collect()
}

fn codex_image_block(
    block: &RawCodexBlock,
    image_names: &[(String, String)],
) -> Option<ExternalSessionAttachment> {
    match block.block_type.as_deref()? {
        "input_image" => Some(ExternalSessionAttachment::Image {
            mime: block.image_url.mime()?,
            name: None,
            path: None,
        }),
        "local_image" => {
            let path = bounded_attachment_path(block.path.as_deref()?)?;
            let mime = ExternalSessionImageMime::from_path_extension(&path)?;
            let name = image_names
                .iter()
                .find(|(image_path, _)| *image_path == path)
                .map(|(_, name)| name.clone());
            Some(ExternalSessionAttachment::Image {
                mime,
                name,
                path: Some(path),
            })
        }
        _ => None,
    }
}

#[derive(Clone, Copy)]
enum AttachedLineKind {
    File,
    Image,
}

#[derive(Default)]
struct AttachedLines {
    files: Vec<ExternalSessionAttachment>,
    image_names: Vec<(String, String)>,
}

fn attached_lines(text: &str) -> AttachedLines {
    let mut lines = AttachedLines::default();
    for (kind, name, path) in text
        .lines()
        .take(MAX_SCANNED_TEXT_LINES)
        .filter_map(attached_line)
    {
        match kind {
            AttachedLineKind::File => {
                if lines.files.len() < MAX_EXTERNAL_SESSION_EXCHANGE_ATTACHMENTS {
                    lines.files.push(ExternalSessionAttachment::File {
                        name,
                        path: Some(path),
                    });
                }
            }
            AttachedLineKind::Image => {
                if lines.image_names.len() < MAX_EXTERNAL_SESSION_EXCHANGE_ATTACHMENTS {
                    lines.image_names.push((path, name));
                }
            }
        }
    }
    lines
}

fn attached_line(line: &str) -> Option<(AttachedLineKind, String, String)> {
    let trimmed = line.trim();
    let (kind, body) = ATTACHED_LINE_PREFIXES
        .iter()
        .find_map(|(prefix, kind)| trimmed.strip_prefix(prefix).map(|body| (*kind, body)))?;
    let body = body.strip_suffix(']')?;
    let (name, path) = body
        .split_once(ATTACHED_FILE_STORED_SEPARATOR)
        .or_else(|| body.split_once(ATTACHED_FILE_REFERENCE_SEPARATOR))?;
    Some((
        kind,
        bounded_attachment_name(name)?,
        bounded_attachment_path(path)?,
    ))
}

fn bounded_attachment_name(value: &str) -> Option<String> {
    if value.is_empty()
        || value.len() > MAX_EXTERNAL_SESSION_ATTACHMENT_NAME_BYTES
        || value != value.trim()
        || value
            .chars()
            .any(|character| matches!(character, '/' | '\\' | '"') || character.is_control())
    {
        return None;
    }
    Some(value.to_string())
}

fn bounded_attachment_path(value: &str) -> Option<String> {
    if !value.starts_with('/')
        || value.len() > MAX_SCANNED_ATTACHMENT_PATH_BYTES
        || value.chars().any(char::is_control)
    {
        return None;
    }
    Some(value.to_string())
}

macro_rules! ignored_scalar_visits {
    ($value:ty) => {
        fn visit_bool<E: DeError>(self, _: bool) -> Result<Self::Value, E> {
            Ok(<$value>::default())
        }

        fn visit_i64<E: DeError>(self, _: i64) -> Result<Self::Value, E> {
            Ok(<$value>::default())
        }

        fn visit_u64<E: DeError>(self, _: u64) -> Result<Self::Value, E> {
            Ok(<$value>::default())
        }

        fn visit_f64<E: DeError>(self, _: f64) -> Result<Self::Value, E> {
            Ok(<$value>::default())
        }

        fn visit_unit<E: DeError>(self) -> Result<Self::Value, E> {
            Ok(<$value>::default())
        }

        fn visit_none<E: DeError>(self) -> Result<Self::Value, E> {
            Ok(<$value>::default())
        }
    };
}

macro_rules! ignored_non_object_visits {
    ($value:ty, $de:lifetime) => {
        fn visit_str<E: DeError>(self, _: &str) -> Result<Self::Value, E> {
            Ok(<$value>::default())
        }

        fn visit_seq<A: SeqAccess<$de>>(self, sequence: A) -> Result<Self::Value, A::Error> {
            drain_seq(sequence)?;
            Ok(<$value>::default())
        }

        ignored_scalar_visits!($value);
    };
}

fn drain_seq<'de, A: SeqAccess<'de>>(mut sequence: A) -> Result<(), A::Error> {
    while sequence.next_element::<IgnoredAny>()?.is_some() {}
    Ok(())
}

fn drain_map<'de, A: MapAccess<'de>>(mut map: A) -> Result<(), A::Error> {
    while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
    Ok(())
}

#[derive(Default)]
struct LenientString(Option<String>);

impl<'de> Deserialize<'de> for LenientString {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(LenientStringVisitor)
    }
}

struct LenientStringVisitor;

impl<'de> Visitor<'de> for LenientStringVisitor {
    type Value = LenientString;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a string or any ignored value")
    }

    fn visit_str<E: DeError>(self, value: &str) -> Result<Self::Value, E> {
        Ok(LenientString(Some(value.to_string())))
    }

    fn visit_string<E: DeError>(self, value: String) -> Result<Self::Value, E> {
        Ok(LenientString(Some(value)))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, sequence: A) -> Result<Self::Value, A::Error> {
        drain_seq(sequence)?;
        Ok(LenientString::default())
    }

    fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<Self::Value, A::Error> {
        drain_map(map)?;
        Ok(LenientString::default())
    }

    ignored_scalar_visits!(LenientString);
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct DataUrlMime(Option<ExternalSessionImageMime>);

impl DataUrlMime {
    fn mime(self) -> Option<ExternalSessionImageMime> {
        self.0
    }

    fn parse(value: &str) -> Self {
        Self(data_url_media_type(value).and_then(ExternalSessionImageMime::from_media_type))
    }
}

fn data_url_media_type(value: &str) -> Option<&str> {
    let rest = value.strip_prefix("data:")?;
    let end = rest
        .as_bytes()
        .iter()
        .take(MAX_SCANNED_DATA_URL_PREFIX_BYTES)
        .position(|byte| *byte == b';' || *byte == b',')?;
    rest.get(..end)
}

impl<'de> Deserialize<'de> for DataUrlMime {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(DataUrlMimeVisitor)
    }
}

struct DataUrlMimeVisitor;

impl<'de> Visitor<'de> for DataUrlMimeVisitor {
    type Value = DataUrlMime;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a data URL")
    }

    fn visit_str<E: DeError>(self, value: &str) -> Result<Self::Value, E> {
        Ok(DataUrlMime::parse(value))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, sequence: A) -> Result<Self::Value, A::Error> {
        drain_seq(sequence)?;
        Ok(DataUrlMime::default())
    }

    fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<Self::Value, A::Error> {
        drain_map(map)?;
        Ok(DataUrlMime::default())
    }

    ignored_scalar_visits!(DataUrlMime);
}

#[derive(Default)]
pub struct RawCodexBlock {
    pub block_type: Option<String>,
    pub text: Option<String>,
    pub path: Option<String>,
    pub image_url: DataUrlMime,
}

impl<'de> Deserialize<'de> for RawCodexBlock {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(RawCodexBlockVisitor)
    }
}

struct RawCodexBlockVisitor;

impl<'de> Visitor<'de> for RawCodexBlockVisitor {
    type Value = RawCodexBlock;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a Codex content block")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        let mut block = RawCodexBlock::default();
        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "type" => block.block_type = map.next_value::<LenientString>()?.0,
                "text" => block.text = map.next_value::<LenientString>()?.0,
                "path" => block.path = map.next_value::<LenientString>()?.0,
                "image_url" => block.image_url = map.next_value()?,
                _ => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        Ok(block)
    }

    ignored_non_object_visits!(RawCodexBlock, 'de);
}

#[derive(Default)]
pub enum RawClaudeContent {
    Text(String),
    Blocks(Vec<RawClaudeBlock>),
    #[default]
    Unsupported,
}

impl RawClaudeContent {
    pub fn blocks(&self) -> Option<&[RawClaudeBlock]> {
        match self {
            Self::Blocks(blocks) => Some(blocks),
            _ => None,
        }
    }
}

impl<'de> Deserialize<'de> for RawClaudeContent {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(RawClaudeContentVisitor)
    }
}

struct RawClaudeContentVisitor;

impl<'de> Visitor<'de> for RawClaudeContentVisitor {
    type Value = RawClaudeContent;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("Claude message content")
    }

    fn visit_str<E: DeError>(self, value: &str) -> Result<Self::Value, E> {
        Ok(RawClaudeContent::Text(value.to_string()))
    }

    fn visit_string<E: DeError>(self, value: String) -> Result<Self::Value, E> {
        Ok(RawClaudeContent::Text(value))
    }

    fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<Self::Value, A::Error> {
        drain_map(map)?;
        Ok(RawClaudeContent::Unsupported)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<Self::Value, A::Error> {
        let mut blocks: Vec<RawClaudeBlock> = Vec::new();
        while let Some(block) = sequence.next_element::<RawClaudeBlock>()? {
            if blocks.len() >= MAX_RETAINED_CONTENT_BLOCKS {
                drain_seq(sequence)?;
                break;
            }
            blocks.push(block);
        }
        Ok(RawClaudeContent::Blocks(blocks))
    }

    ignored_scalar_visits!(RawClaudeContent);
}

#[derive(Default)]
pub struct RawClaudeBlock {
    pub block_type: Option<String>,
    pub text: Option<String>,
    pub media_type: Option<String>,
}

impl<'de> Deserialize<'de> for RawClaudeBlock {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(RawClaudeBlockVisitor)
    }
}

struct RawClaudeBlockVisitor;

impl<'de> Visitor<'de> for RawClaudeBlockVisitor {
    type Value = RawClaudeBlock;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a Claude content block")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        let mut block = RawClaudeBlock::default();
        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "type" => block.block_type = map.next_value::<LenientString>()?.0,
                "text" => block.text = map.next_value::<LenientString>()?.0,
                "source" => block.media_type = map.next_value::<RawClaudeSource>()?.media_type,
                _ => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        Ok(block)
    }

    ignored_non_object_visits!(RawClaudeBlock, 'de);
}

#[derive(Default)]
struct RawClaudeSource {
    media_type: Option<String>,
}

impl<'de> Deserialize<'de> for RawClaudeSource {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(RawClaudeSourceVisitor)
    }
}

struct RawClaudeSourceVisitor;

impl<'de> Visitor<'de> for RawClaudeSourceVisitor {
    type Value = RawClaudeSource;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a Claude image source")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        let mut source = RawClaudeSource::default();
        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "media_type" => source.media_type = map.next_value::<LenientString>()?.0,
                _ => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        Ok(source)
    }

    ignored_non_object_visits!(RawClaudeSource, 'de);
}

#[cfg(test)]
#[path = "agent_session_attachments_tests.rs"]
mod tests;
