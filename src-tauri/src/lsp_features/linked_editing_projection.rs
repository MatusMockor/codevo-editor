use super::{LanguageServerLinkedEditingRanges, LanguageServerPosition, LanguageServerRange};
use serde::Serialize;
use serde_json::Value;
use std::io::{self, Write};

pub(super) const MAX_LINKED_EDITING_RANGES: usize = 256;
pub(super) const MAX_LINKED_EDITING_WORD_PATTERN_UTF8_BYTES: usize = 4_096;
const MAX_LINKED_EDITING_RESPONSE_UTF8_BYTES: usize = 64 * 1024;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct LinkedEditingProjectionWork {
    pub(super) input_ranges: usize,
    pub(super) visited_ranges: usize,
    pub(super) projected_ranges: usize,
    pub(super) word_pattern_utf8_bytes: usize,
    pub(super) word_pattern_characters: usize,
    pub(super) projected_utf8_bytes: usize,
}

pub(super) fn project_linked_editing_ranges_result(
    value: &Value,
) -> Result<Option<LanguageServerLinkedEditingRanges>, String> {
    project_linked_editing_ranges_result_with_work(value).0
}

pub(super) fn project_linked_editing_ranges_result_with_work(
    value: &Value,
) -> (
    Result<Option<LanguageServerLinkedEditingRanges>, String>,
    LinkedEditingProjectionWork,
) {
    if value.is_null() {
        return (Ok(None), LinkedEditingProjectionWork::default());
    }
    let Some(object) = value.as_object() else {
        return (
            Err("Language server returned malformed linked editing ranges.".to_string()),
            LinkedEditingProjectionWork::default(),
        );
    };
    let Some(ranges) = object.get("ranges").and_then(Value::as_array) else {
        return (
            Err("Language server returned malformed linked editing ranges.".to_string()),
            LinkedEditingProjectionWork::default(),
        );
    };
    let mut work = LinkedEditingProjectionWork {
        input_ranges: ranges.len(),
        ..LinkedEditingProjectionWork::default()
    };
    if ranges.len() > MAX_LINKED_EDITING_RANGES {
        return (
            Err(format!(
                "Language server returned too many linked editing ranges (maximum {MAX_LINKED_EDITING_RANGES})."
            )),
            work,
        );
    }

    let word_pattern = match object.get("wordPattern") {
        None | Some(Value::Null) => None,
        Some(Value::String(pattern)) => {
            work.word_pattern_utf8_bytes = pattern.len();
            if pattern.len() > MAX_LINKED_EDITING_WORD_PATTERN_UTF8_BYTES {
                return (
                    Err(format!(
                        "Language server returned an oversized linked editing word pattern (maximum {MAX_LINKED_EDITING_WORD_PATTERN_UTF8_BYTES} UTF-8 bytes)."
                    )),
                    work,
                );
            }
            let (safe, characters) = safe_word_pattern(pattern);
            work.word_pattern_characters = characters;
            safe.then(|| pattern.clone())
        }
        Some(_) => {
            return (
                Err("Language server returned malformed linked editing ranges.".to_string()),
                work,
            );
        }
    };

    let mut projected_ranges = Vec::with_capacity(ranges.len());
    for (index, range) in ranges.iter().enumerate() {
        work.visited_ranges += 1;
        let range = match parse_range(range) {
            Ok(range) => range,
            Err(reason) => {
                return (
                    Err(format!(
                        "Language server returned malformed linked editing range {index}: {reason}."
                    )),
                    work,
                );
            }
        };
        projected_ranges.push(range);
        work.projected_ranges += 1;
    }

    let projected = LanguageServerLinkedEditingRanges {
        ranges: projected_ranges,
        word_pattern,
    };
    let (projected_bytes, oversized) =
        serialized_len_capped(&projected, MAX_LINKED_EDITING_RESPONSE_UTF8_BYTES);
    work.projected_utf8_bytes = projected_bytes;
    if oversized {
        return (
            Err("Language server returned oversized linked editing ranges.".to_string()),
            work,
        );
    }
    (Ok(Some(projected)), work)
}

fn parse_range(value: &Value) -> Result<LanguageServerRange, &'static str> {
    let object = value.as_object().ok_or("range must be an object")?;
    let start = parse_position(object.get("start").ok_or("range is missing start")?)?;
    let end = parse_position(object.get("end").ok_or("range is missing end")?)?;
    if (end.line, end.character) < (start.line, start.character) {
        return Err("range end must not precede range start");
    }
    Ok(LanguageServerRange { start, end })
}

fn parse_position(value: &Value) -> Result<LanguageServerPosition, &'static str> {
    let object = value.as_object().ok_or("position must be an object")?;
    Ok(LanguageServerPosition {
        line: required_u32(object.get("line")).ok_or("line must be an unsigned 32-bit integer")?,
        character: required_u32(object.get("character"))
            .ok_or("character must be an unsigned 32-bit integer")?,
    })
}

fn required_u32(value: Option<&Value>) -> Option<u32> {
    value
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
}

fn safe_word_pattern(pattern: &str) -> (bool, usize) {
    let mut escaped = false;
    let mut in_character_class = false;
    let mut quantifier_count = 0usize;
    let mut characters = 0usize;

    for character in pattern.chars() {
        characters += 1;
        if escaped {
            if !in_character_class && (('1'..='9').contains(&character) || character == 'k') {
                return (false, characters);
            }
            escaped = false;
            continue;
        }
        if character == '\\' {
            escaped = true;
            continue;
        }
        if character == '[' {
            in_character_class = true;
            continue;
        }
        if character == ']' {
            in_character_class = false;
            continue;
        }
        if !in_character_class && matches!(character, '(' | ')' | '|') {
            return (false, characters);
        }
        if !in_character_class && matches!(character, '*' | '+' | '?' | '{') {
            quantifier_count += 1;
            if quantifier_count > 1 {
                return (false, characters);
            }
        }
    }

    (!escaped && !in_character_class, characters)
}

fn serialized_len_capped(value: &impl Serialize, maximum_bytes: usize) -> (usize, bool) {
    let mut counter = ByteCounter {
        bytes: 0,
        maximum_bytes,
    };
    let oversized = serde_json::to_writer(&mut counter, value).is_err();
    (counter.bytes, oversized)
}

struct ByteCounter {
    bytes: usize,
    maximum_bytes: usize,
}

impl Write for ByteCounter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let next_bytes = self.bytes.saturating_add(bytes.len());
        if next_bytes > self.maximum_bytes {
            self.bytes = self.maximum_bytes.saturating_add(1);
            return Err(io::Error::new(
                io::ErrorKind::FileTooLarge,
                "serialized value exceeds projection limit",
            ));
        }
        self.bytes = next_bytes;
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn adversarial_hundred_thousand_ranges_fail_before_range_work() {
        let response = json!({
            "ranges": vec![range(0); 100_000],
            "wordPattern": null
        });

        let (result, work) = project_linked_editing_ranges_result_with_work(&response);

        assert!(result.is_err());
        assert_eq!(work.input_ranges, 100_000);
        assert_eq!(work.visited_ranges, 0);
        assert_eq!(work.projected_ranges, 0);
    }

    #[test]
    fn exact_range_count_boundary_is_accepted_and_overflow_fails_closed() {
        let exact = json!({
            "ranges": (0..MAX_LINKED_EDITING_RANGES)
                .map(|index| range(index as u32))
                .collect::<Vec<_>>(),
            "wordPattern": null
        });
        let overflow = json!({
            "ranges": vec![range(0); MAX_LINKED_EDITING_RANGES + 1],
            "wordPattern": null
        });

        let (exact_result, exact_work) = project_linked_editing_ranges_result_with_work(&exact);
        let (overflow_result, overflow_work) =
            project_linked_editing_ranges_result_with_work(&overflow);

        assert_eq!(
            exact_result
                .expect("exact maximum")
                .expect("linked editing result")
                .ranges
                .len(),
            MAX_LINKED_EDITING_RANGES
        );
        assert_eq!(exact_work.visited_ranges, MAX_LINKED_EDITING_RANGES);
        assert!(overflow_result.is_err());
        assert_eq!(overflow_work.visited_ranges, 0);
    }

    #[test]
    fn word_pattern_uses_exact_utf8_n_and_n_plus_one_boundaries() {
        let exact_pattern = format!(
            "{}a",
            "€".repeat((MAX_LINKED_EDITING_WORD_PATTERN_UTF8_BYTES - 1) / 3)
        );
        let overflow_pattern = format!("{exact_pattern}€");
        assert_eq!(
            exact_pattern.len(),
            MAX_LINKED_EDITING_WORD_PATTERN_UTF8_BYTES
        );
        assert!(overflow_pattern.len() > MAX_LINKED_EDITING_WORD_PATTERN_UTF8_BYTES);

        let exact = json!({ "ranges": [range(0)], "wordPattern": exact_pattern });
        let overflow = json!({ "ranges": [range(0)], "wordPattern": overflow_pattern });

        let (exact_result, exact_work) = project_linked_editing_ranges_result_with_work(&exact);
        let (overflow_result, overflow_work) =
            project_linked_editing_ranges_result_with_work(&overflow);

        assert_eq!(
            exact_result
                .expect("exact UTF-8 limit")
                .expect("linked editing result")
                .word_pattern
                .as_deref(),
            Some(exact_pattern.as_str())
        );
        assert_eq!(
            exact_work.word_pattern_utf8_bytes,
            MAX_LINKED_EDITING_WORD_PATTERN_UTF8_BYTES
        );
        assert!(overflow_result.is_err());
        assert!(overflow_work.word_pattern_utf8_bytes > MAX_LINKED_EDITING_WORD_PATTERN_UTF8_BYTES);
        assert_eq!(overflow_work.visited_ranges, 0);
    }

    #[test]
    fn unsafe_word_patterns_are_omitted_without_losing_ranges() {
        for pattern in [
            "(a+)+$",
            "a|b",
            "[a-z]*[a-z]*",
            "(a)\\1",
            "(?<name>a)\\k<name>",
            "[unterminated",
            "trailing\\",
        ] {
            let response = json!({ "ranges": [range(0)], "wordPattern": pattern });
            let projected = project_linked_editing_ranges_result(&response)
                .expect("safe projection")
                .expect("linked editing result");
            assert_eq!(projected.ranges.len(), 1);
            assert_eq!(projected.word_pattern, None);
        }

        let safe = json!({
            "ranges": [range(0)],
            "wordPattern": "[A-Za-z][A-Za-z0-9]*"
        });
        assert_eq!(
            project_linked_editing_ranges_result(&safe)
                .expect("safe projection")
                .expect("linked editing result")
                .word_pattern
                .as_deref(),
            Some("[A-Za-z][A-Za-z0-9]*")
        );
    }

    #[test]
    fn malformed_ranges_fail_the_whole_response() {
        for malformed in [
            json!("bad"),
            json!({
                "start": { "line": -1, "character": 0 },
                "end": { "line": 0, "character": 1 }
            }),
            json!({
                "start": { "line": 2, "character": 0 },
                "end": { "line": 1, "character": 9 }
            }),
            json!({ "start": { "line": 0, "character": 0 } }),
        ] {
            let response = json!({ "ranges": [range(0), malformed, range(2)] });
            let (result, work) = project_linked_editing_ranges_result_with_work(&response);
            assert!(result.is_err());
            assert_eq!(work.visited_ranges, 2);
            assert_eq!(work.projected_ranges, 1);
        }
    }

    #[test]
    fn small_large_and_unknown_nested_work_remains_bounded() {
        let small = json!({ "ranges": (0..8).map(range).collect::<Vec<_>>() });
        let large = json!({
            "ranges": (0..MAX_LINKED_EDITING_RANGES)
                .map(|index| range(index as u32))
                .collect::<Vec<_>>()
        });
        let unknown_nested = json!({
            "ranges": [{
                "start": {
                    "line": 0,
                    "character": 0,
                    "unknown": vec![Value::Null; 100_000]
                },
                "end": { "line": 0, "character": 1 }
            }]
        });

        let (small_result, small_work) = project_linked_editing_ranges_result_with_work(&small);
        let (large_result, large_work) = project_linked_editing_ranges_result_with_work(&large);
        let (unknown_result, unknown_work) =
            project_linked_editing_ranges_result_with_work(&unknown_nested);

        assert_eq!(
            small_result
                .expect("small")
                .expect("linked editing result")
                .ranges
                .len(),
            8
        );
        assert_eq!(small_work.visited_ranges, 8);
        assert_eq!(
            large_result
                .expect("large")
                .expect("linked editing result")
                .ranges
                .len(),
            MAX_LINKED_EDITING_RANGES
        );
        assert_eq!(large_work.visited_ranges, MAX_LINKED_EDITING_RANGES);
        assert!(large_work.projected_utf8_bytes <= MAX_LINKED_EDITING_RESPONSE_UTF8_BYTES);
        assert_eq!(
            unknown_result
                .expect("unknown nested fields")
                .expect("linked editing result")
                .ranges
                .len(),
            1
        );
        assert_eq!(unknown_work.visited_ranges, 1);
    }

    fn range(line: u32) -> Value {
        json!({
            "start": { "line": line, "character": 0 },
            "end": { "line": line, "character": 1 }
        })
    }
}
