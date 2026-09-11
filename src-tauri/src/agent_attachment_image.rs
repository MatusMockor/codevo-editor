use super::agent_thread_store::{
    AgentImageMime, AGENT_ATTACHMENT_DIMENSION_ERROR, MAX_AGENT_IMAGE_DIMENSION,
    MIN_AGENT_IMAGE_DIMENSION,
};

pub const AGENT_ATTACHMENT_MAGIC_ERROR: &str =
    "The attachment bytes do not match its declared image type.";
pub const AGENT_ATTACHMENT_UNDECODABLE_ERROR: &str =
    "The attachment image could not be decoded as a supported image.";

const MAX_JPEG_SEGMENTS: usize = 256;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AgentImageDimensions {
    pub width: u32,
    pub height: u32,
}

pub fn agent_image_extension(mime: AgentImageMime) -> &'static str {
    match mime {
        AgentImageMime::Png => "png",
        AgentImageMime::Jpeg => "jpg",
        AgentImageMime::Gif => "gif",
        AgentImageMime::Webp => "webp",
    }
}

pub fn agent_image_media_type(mime: AgentImageMime) -> &'static str {
    match mime {
        AgentImageMime::Png => "image/png",
        AgentImageMime::Jpeg => "image/jpeg",
        AgentImageMime::Gif => "image/gif",
        AgentImageMime::Webp => "image/webp",
    }
}

pub fn agent_image_mime_for_extension(extension: &str) -> Option<AgentImageMime> {
    match extension {
        "png" => Some(AgentImageMime::Png),
        "jpg" | "jpeg" => Some(AgentImageMime::Jpeg),
        "gif" => Some(AgentImageMime::Gif),
        "webp" => Some(AgentImageMime::Webp),
        _ => None,
    }
}

pub fn verify_agent_image_bytes(
    mime: AgentImageMime,
    bytes: &[u8],
) -> Result<AgentImageDimensions, String> {
    if !matches_agent_image_signature(mime, bytes) {
        return Err(AGENT_ATTACHMENT_MAGIC_ERROR.to_string());
    }
    let dimensions = match mime {
        AgentImageMime::Png => png_dimensions(bytes),
        AgentImageMime::Jpeg => jpeg_dimensions(bytes),
        AgentImageMime::Gif => gif_dimensions(bytes),
        AgentImageMime::Webp => webp_dimensions(bytes),
    }
    .ok_or_else(|| AGENT_ATTACHMENT_UNDECODABLE_ERROR.to_string())?;
    ensure_agent_image_dimensions(dimensions)?;
    Ok(dimensions)
}

pub fn ensure_agent_image_dimensions(dimensions: AgentImageDimensions) -> Result<(), String> {
    let within =
        |value: u32| (MIN_AGENT_IMAGE_DIMENSION..=MAX_AGENT_IMAGE_DIMENSION).contains(&value);
    if !within(dimensions.width) || !within(dimensions.height) {
        return Err(AGENT_ATTACHMENT_DIMENSION_ERROR.to_string());
    }
    Ok(())
}

pub fn matches_agent_image_signature(mime: AgentImageMime, bytes: &[u8]) -> bool {
    match mime {
        AgentImageMime::Png => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        AgentImageMime::Jpeg => bytes.starts_with(b"\xff\xd8\xff"),
        AgentImageMime::Gif => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        AgentImageMime::Webp => {
            bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP"
        }
    }
}

fn big_endian_u16(bytes: &[u8], offset: usize) -> Option<u32> {
    let slice = bytes.get(offset..offset + 2)?;
    Some(u32::from(u16::from_be_bytes([slice[0], slice[1]])))
}

fn little_endian_u16(bytes: &[u8], offset: usize) -> Option<u32> {
    let slice = bytes.get(offset..offset + 2)?;
    Some(u32::from(u16::from_le_bytes([slice[0], slice[1]])))
}

fn big_endian_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    let slice = bytes.get(offset..offset + 4)?;
    Some(u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn little_endian_u24(bytes: &[u8], offset: usize) -> Option<u32> {
    let slice = bytes.get(offset..offset + 3)?;
    Some(u32::from(slice[0]) | (u32::from(slice[1]) << 8) | (u32::from(slice[2]) << 16))
}

fn png_dimensions(bytes: &[u8]) -> Option<AgentImageDimensions> {
    if bytes.get(12..16)? != b"IHDR" {
        return None;
    }
    Some(AgentImageDimensions {
        width: big_endian_u32(bytes, 16)?,
        height: big_endian_u32(bytes, 20)?,
    })
}

fn gif_dimensions(bytes: &[u8]) -> Option<AgentImageDimensions> {
    Some(AgentImageDimensions {
        width: little_endian_u16(bytes, 6)?,
        height: little_endian_u16(bytes, 8)?,
    })
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<AgentImageDimensions> {
    let mut offset = 2;
    for _ in 0..MAX_JPEG_SEGMENTS {
        while bytes.get(offset) == Some(&0xff) && bytes.get(offset + 1) == Some(&0xff) {
            offset += 1;
        }
        if bytes.get(offset)? != &0xff {
            return None;
        }
        let marker = *bytes.get(offset + 1)?;
        if is_jpeg_start_of_frame(marker) {
            return Some(AgentImageDimensions {
                height: big_endian_u16(bytes, offset + 5)?,
                width: big_endian_u16(bytes, offset + 7)?,
            });
        }
        if marker == 0xd8 || (0xd0..=0xd9).contains(&marker) {
            offset += 2;
            continue;
        }
        let length = big_endian_u16(bytes, offset + 2)? as usize;
        if length < 2 {
            return None;
        }
        offset = offset.checked_add(2)?.checked_add(length)?;
    }
    None
}

fn is_jpeg_start_of_frame(marker: u8) -> bool {
    matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf)
}

fn webp_dimensions(bytes: &[u8]) -> Option<AgentImageDimensions> {
    match bytes.get(12..16)? {
        b"VP8X" => Some(AgentImageDimensions {
            width: little_endian_u24(bytes, 24)?.checked_add(1)?,
            height: little_endian_u24(bytes, 27)?.checked_add(1)?,
        }),
        b"VP8L" => webp_lossless_dimensions(bytes),
        b"VP8 " => webp_lossy_dimensions(bytes),
        _ => None,
    }
}

fn webp_lossless_dimensions(bytes: &[u8]) -> Option<AgentImageDimensions> {
    if bytes.get(20)? != &0x2f {
        return None;
    }
    let slice = bytes.get(21..25)?;
    let packed = u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]);
    Some(AgentImageDimensions {
        width: (packed & 0x3fff) + 1,
        height: ((packed >> 14) & 0x3fff) + 1,
    })
}

fn webp_lossy_dimensions(bytes: &[u8]) -> Option<AgentImageDimensions> {
    if bytes.get(23..26)? != [0x9d, 0x01, 0x2a] {
        return None;
    }
    Some(AgentImageDimensions {
        width: little_endian_u16(bytes, 26)? & 0x3fff,
        height: little_endian_u16(bytes, 28)? & 0x3fff,
    })
}
