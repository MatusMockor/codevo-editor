pub(crate) const MAX_DESCRIPTION_CHARS: usize = 200;

pub(crate) fn bounded_description(raw: &str) -> Option<String> {
    let sanitized = raw
        .chars()
        .filter(|character| !is_control_character(*character))
        .take(MAX_DESCRIPTION_CHARS)
        .collect::<String>();
    let trimmed = sanitized.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

pub(crate) fn bounded_branch(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if !is_bounded_branch(trimmed) {
        return None;
    }
    Some(trimmed.to_string())
}

pub(crate) fn is_bounded_description(value: &str) -> bool {
    if value.chars().count() > MAX_DESCRIPTION_CHARS {
        return false;
    }
    !value.chars().any(is_control_character)
}

pub(crate) fn is_bounded_branch(value: &str) -> bool {
    crate::remote_runner::branch_name(value)
}

pub(crate) fn bounded_lossy_text(bytes: &[u8], max_bytes: usize) -> String {
    let mut end = bytes.len().min(max_bytes);
    while end > 0 && !is_utf8_boundary(bytes, end) {
        end -= 1;
    }
    String::from_utf8_lossy(&bytes[..end]).into_owned()
}

fn is_utf8_boundary(bytes: &[u8], index: usize) -> bool {
    if index == bytes.len() {
        return true;
    }
    bytes.get(index).is_some_and(|byte| (*byte as i8) >= -0x40)
}

fn is_control_character(character: char) -> bool {
    matches!(character, '\u{0}'..='\u{1f}' | '\u{7f}'..='\u{9f}')
}
