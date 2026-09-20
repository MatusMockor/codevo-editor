//! Locate HTML attribute and style regions without interpreting text or script literals.
use std::ops::Range;
const TAG_LIMIT: usize = 8192;
pub(super) fn scopes(html: &str) -> Result<Vec<Range<usize>>, String> {
    let bytes = html.as_bytes();
    let mut position = 0;
    let mut result = Vec::new();
    while position < bytes.len() {
        let Some(offset) = html[position..].find('<') else {
            break;
        };
        position += offset;
        if html[position..].starts_with("<!--") {
            position = html[position + 4..]
                .find("-->")
                .map_or(bytes.len(), |end| position + 4 + end + 3);
            continue;
        }
        let start = position;
        position += 1;
        let mut quote = None;
        while position < bytes.len() {
            let byte = bytes[position];
            position += 1;
            match (quote, byte) {
                (Some(q), b) if q == b => quote = None,
                (None, b'\'' | b'"') => quote = Some(byte),
                (None, b'>') => break,
                _ => {}
            }
        }
        if position == bytes.len() && bytes.last() != Some(&b'>') {
            break;
        }
        if result.len() >= TAG_LIMIT {
            return Err("HTML preview exceeds 8192 markup regions.".into());
        }
        result.push(start..position);
        let name_end = bytes[start + 1..position]
            .iter()
            .position(|b| !b.is_ascii_alphanumeric())
            .map_or(position, |i| start + 1 + i);
        let name = &html[start + 1..name_end];
        if ["script", "style", "textarea", "title"]
            .iter()
            .any(|raw| name.eq_ignore_ascii_case(raw))
        {
            let body = position;
            let mut closing = None;
            while let Some(offset) = html[position..].find("</") {
                position += offset;
                let end = position + 2 + name.len();
                if end < bytes.len()
                    && bytes[position + 2..end].eq_ignore_ascii_case(name.as_bytes())
                    && (bytes[end].is_ascii_whitespace() || bytes[end] == b'>')
                {
                    closing = Some(position);
                    break;
                }
                position += 2;
            }
            let end = closing.unwrap_or(bytes.len());
            if name.eq_ignore_ascii_case("style") {
                if result.len() >= TAG_LIMIT {
                    return Err("HTML preview exceeds 8192 markup regions.".into());
                }
                result.push(body..end);
            }
            position = end;
            if closing.is_some() {
                position += 2;
            }
        }
    }
    Ok(result)
}
