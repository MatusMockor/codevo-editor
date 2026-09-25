use serde::Serialize;
use std::collections::VecDeque;

const MAX_LINE_BYTES: usize = 512;
const MAX_DIAGNOSTIC_LINES: usize = 12;
const MAX_SAFE_BYTES: f64 = 9_007_199_254_740_991.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ClonePhase {
    Counting,
    Compressing,
    Receiving,
    Resolving,
    CheckingOut,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloneProgress {
    pub phase: ClonePhase,
    pub percent: u8,
    pub received_bytes: Option<u64>,
    pub bytes_per_second: Option<u64>,
}

#[derive(Default)]
pub(crate) struct CloneOutputReader {
    partial: Vec<u8>,
    discarding: bool,
    diagnostics: VecDeque<String>,
}

impl CloneOutputReader {
    pub(crate) fn push(&mut self, bytes: &[u8]) -> Option<CloneProgress> {
        let mut latest = None;
        for &byte in bytes {
            if byte == b'\r' || byte == b'\n' {
                if let Some(progress) = self.finish_line() {
                    latest = Some(progress);
                }
                continue;
            }
            if self.discarding {
                continue;
            }
            if self.partial.len() >= MAX_LINE_BYTES {
                self.partial.clear();
                self.discarding = true;
                continue;
            }
            self.partial.push(byte);
        }
        latest
    }

    pub(crate) fn finish(&mut self) -> Option<CloneProgress> {
        self.finish_line()
    }

    pub(crate) fn diagnostics(&self) -> impl Iterator<Item = &str> + Clone {
        self.diagnostics.iter().map(String::as_str)
    }

    fn finish_line(&mut self) -> Option<CloneProgress> {
        let discarded = std::mem::replace(&mut self.discarding, false);
        let line = String::from_utf8_lossy(&self.partial).trim().to_owned();
        self.partial.clear();
        if discarded || line.is_empty() {
            return None;
        }
        if let Some(progress) = parse_progress_line(&line) {
            return Some(progress);
        }
        if self.diagnostics.len() == MAX_DIAGNOSTIC_LINES {
            self.diagnostics.pop_front();
        }
        self.diagnostics.push_back(line.to_ascii_lowercase());
        None
    }
}

pub(crate) fn parse_progress_line(line: &str) -> Option<CloneProgress> {
    let body = line.strip_prefix("remote: ").unwrap_or(line);
    let (label, rest) = body.split_once(':')?;
    let phase = match label.trim() {
        "Counting objects" => ClonePhase::Counting,
        "Compressing objects" => ClonePhase::Compressing,
        "Receiving objects" => ClonePhase::Receiving,
        "Resolving deltas" => ClonePhase::Resolving,
        "Updating files" | "Checking out files" => ClonePhase::CheckingOut,
        _ => return None,
    };
    let (percent_text, after_percent) = rest.trim_start().split_once('%')?;
    let percent = percent_text
        .trim()
        .parse::<u8>()
        .ok()
        .filter(|value| *value <= 100)?;
    let (received_bytes, bytes_per_second) = after_percent
        .split_once(", ")
        .map(|(_, transfer)| parse_transfer(transfer))
        .unwrap_or((None, None));
    Some(CloneProgress {
        phase,
        percent,
        received_bytes,
        bytes_per_second,
    })
}

fn parse_transfer(text: &str) -> (Option<u64>, Option<u64>) {
    let mut parts = text.split('|');
    let received = parts.next().and_then(parse_size);
    let rate = parts
        .next()
        .and_then(|value| value.split(',').next())
        .and_then(|value| value.trim().strip_suffix("/s"))
        .and_then(parse_size);
    (received, rate)
}

fn parse_size(text: &str) -> Option<u64> {
    let (number, unit) = text.trim().split_once(' ')?;
    let value = number
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite() && *value >= 0.0)?;
    let scale = match unit.trim() {
        "bytes" => 1.0,
        "KiB" => 1024.0,
        "MiB" => 1_048_576.0,
        "GiB" => 1_073_741_824.0,
        _ => return None,
    };
    let bytes = (value * scale).round();
    if bytes > MAX_SAFE_BYTES {
        return None;
    }
    Some(bytes as u64)
}
