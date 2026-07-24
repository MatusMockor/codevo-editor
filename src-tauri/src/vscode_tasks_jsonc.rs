use serde_json::Value;

pub(super) fn parse_strict_jsonc(bytes: &[u8]) -> Result<Value, String> {
    let source =
        std::str::from_utf8(bytes).map_err(|_| "configuration is not UTF-8".to_string())?;
    let mut stripped = source.as_bytes().to_vec();
    let mut index = 0;
    let mut in_string = false;
    let mut escaped = false;

    while index < stripped.len() {
        let byte = stripped[index];
        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
            index += 1;
            continue;
        }
        if byte == b'"' {
            in_string = true;
            index += 1;
            continue;
        }
        if byte == b'/' && stripped.get(index + 1) == Some(&b'/') {
            stripped[index] = b' ';
            stripped[index + 1] = b' ';
            index += 2;
            while index < stripped.len() && !matches!(stripped[index], b'\n' | b'\r') {
                stripped[index] = b' ';
                index += 1;
            }
            continue;
        }
        if byte == b'/' && stripped.get(index + 1) == Some(&b'*') {
            stripped[index] = b' ';
            stripped[index + 1] = b' ';
            index += 2;
            let mut closed = false;
            while index < stripped.len() {
                if stripped[index] == b'*' && stripped.get(index + 1) == Some(&b'/') {
                    stripped[index] = b' ';
                    stripped[index + 1] = b' ';
                    index += 2;
                    closed = true;
                    break;
                }
                if !matches!(stripped[index], b'\n' | b'\r') {
                    stripped[index] = b' ';
                }
                index += 1;
            }
            if !closed {
                return Err("unterminated block comment".to_string());
            }
            continue;
        }
        index += 1;
    }

    if in_string {
        return Err("unterminated JSON string".to_string());
    }

    index = 0;
    in_string = false;
    escaped = false;
    while index < stripped.len() {
        let byte = stripped[index];
        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
            index += 1;
            continue;
        }
        if byte == b'"' {
            in_string = true;
        } else if byte == b',' {
            let mut next = index + 1;
            while next < stripped.len() && stripped[next].is_ascii_whitespace() {
                next += 1;
            }
            if matches!(stripped.get(next), Some(b'}' | b']')) {
                stripped[index] = b' ';
            }
        }
        index += 1;
    }

    serde_json::from_slice(&stripped).map_err(|error| format!("invalid JSONC: {error}"))
}
