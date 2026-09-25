use super::failure::{classify_failure, CloneFailure};
use super::progress::{parse_progress_line, CloneOutputReader, ClonePhase, CloneProgress};

fn progress(phase: ClonePhase, percent: u8) -> CloneProgress {
    CloneProgress {
        phase,
        percent,
        received_bytes: None,
        bytes_per_second: None,
    }
}

#[test]
fn parses_every_git_progress_phase() {
    assert_eq!(
        parse_progress_line("remote: Counting objects:  12% (12/100)"),
        Some(progress(ClonePhase::Counting, 12))
    );
    assert_eq!(
        parse_progress_line("remote: Enumerating objects: 2742, done."),
        None
    );
    assert_eq!(
        parse_progress_line("remote: Compressing objects:  45% (54/120)"),
        Some(progress(ClonePhase::Compressing, 45))
    );
    assert_eq!(
        parse_progress_line("Resolving deltas: 100% (300/300), done."),
        Some(progress(ClonePhase::Resolving, 100))
    );
    assert_eq!(
        parse_progress_line("Updating files:  50% (10/20)"),
        Some(progress(ClonePhase::CheckingOut, 50))
    );
    assert_eq!(parse_progress_line("Cloning into '.'..."), None);
    assert_eq!(parse_progress_line("Receiving objects: 101% (1/1)"), None);
}

#[test]
fn parses_received_bytes_and_rate() {
    assert_eq!(
        parse_progress_line("Receiving objects:  45% (1234/2742), 12.50 MiB | 5.00 MiB/s"),
        Some(CloneProgress {
            phase: ClonePhase::Receiving,
            percent: 45,
            received_bytes: Some(13_107_200),
            bytes_per_second: Some(5_242_880),
        })
    );
    assert_eq!(
        parse_progress_line("Receiving objects: 100% (2742/2742), 27.40 MiB | 5.00 MiB/s, done.")
            .and_then(|value| value.bytes_per_second),
        Some(5_242_880)
    );
    assert_eq!(
        parse_progress_line("Receiving objects:  10% (1/10), 512 bytes | 1.00 KiB/s")
            .and_then(|value| value.received_bytes),
        Some(512)
    );
    assert_eq!(
        parse_progress_line("Receiving objects:  10% (1/10), 1e300 GiB | NaN MiB/s")
            .and_then(|value| value.received_bytes),
        None
    );
}

#[test]
fn reader_splits_carriage_returns_across_chunks() {
    let mut reader = CloneOutputReader::default();
    assert_eq!(reader.push(b"Receiving objects:  1"), None);
    assert_eq!(
        reader.push(b"0% (1/10)\rReceiving objects:  20% (2/10)\r"),
        Some(progress(ClonePhase::Receiving, 20))
    );
    assert_eq!(reader.push(b"Resolving deltas:  30% (3/10)"), None);
    assert_eq!(reader.finish(), Some(progress(ClonePhase::Resolving, 30)));
}

#[test]
fn drops_overlong_lines_without_growing() {
    let mut reader = CloneOutputReader::default();
    let long = vec![b'x'; 10_000];
    assert_eq!(reader.push(&long), None);
    assert_eq!(reader.push(b"\n"), None);
    assert_eq!(reader.diagnostics().count(), 0);
    assert_eq!(
        reader.push(b"Receiving objects:  5% (1/20)\r"),
        Some(progress(ClonePhase::Receiving, 5))
    );
}

#[test]
fn line_bound_is_exactly_512_bytes() {
    let mut reader = CloneOutputReader::default();
    let mut fits = vec![b'a'; 512];
    fits.push(b'\n');
    reader.push(&fits);
    let mut overlong = vec![b'b'; 513];
    overlong.push(b'\n');
    reader.push(&overlong);
    let lines: Vec<&str> = reader.diagnostics().collect();
    assert_eq!(lines, ["a".repeat(512)]);
    let mut overlong_progress = b"Receiving objects:  9% (1/9), ".to_vec();
    overlong_progress.extend(vec![b'9'; 600]);
    overlong_progress.push(b'\r');
    assert_eq!(reader.push(&overlong_progress), None);
    assert_eq!(reader.diagnostics().count(), 1);
}

#[test]
fn overlong_line_split_across_chunks_is_dropped_whole() {
    let mut reader = CloneOutputReader::default();
    for _ in 0..100 {
        assert_eq!(reader.push(&[b'z'; 100]), None);
    }
    assert_eq!(reader.push(b"tail\nfatal: repository not found\n"), None);
    let lines: Vec<&str> = reader.diagnostics().collect();
    assert_eq!(lines, ["fatal: repository not found"]);
}

#[test]
fn keeps_only_the_latest_diagnostic_lines_lowercased() {
    let mut reader = CloneOutputReader::default();
    for index in 0..40 {
        reader.push(format!("warning: line {index}\n").as_bytes());
    }
    reader.push(b"FATAL: Authentication failed for 'https://example.com/a/b.git/'\n");
    let lines: Vec<&str> = reader.diagnostics().collect();
    assert_eq!(lines.len(), 12);
    assert_eq!(lines.first().copied(), Some("warning: line 29"));
    assert_eq!(
        lines.last().copied(),
        Some("fatal: authentication failed for 'https://example.com/a/b.git/'")
    );
}

#[test]
fn classifies_an_error_printed_after_the_retention_limit() {
    let mut reader = CloneOutputReader::default();
    let mut streamed = 0usize;
    let mut latest = None;
    for percent in 0..=100 {
        for _ in 0..20 {
            let line = format!("Receiving objects: {percent:3}% (1/1), 1.00 MiB | 1.00 MiB/s\r");
            streamed += line.len();
            if let Some(value) = reader.push(line.as_bytes()) {
                latest = Some(value);
            }
        }
    }
    assert!(streamed > 64 * 1024);
    assert_eq!(latest.map(|value| value.percent), Some(100));
    reader.push(
        b"\nfatal: unable to access 'https://example.com/a.git/': Could not resolve host: example.com\n",
    );
    assert_eq!(
        classify_failure(reader.diagnostics()),
        CloneFailure::Network
    );
}

#[test]
fn classification_order_prefers_specific_causes() {
    let cases: [(&[&str], CloneFailure); 10] = [
        (
            &[
                "host key verification failed.",
                "fatal: could not read from remote repository.",
            ],
            CloneFailure::HostKey,
        ),
        (
            &["fatal: could not read username for 'https://github.com': terminal prompts disabled"],
            CloneFailure::Authentication,
        ),
        (
            &[
                "git@github.com: permission denied (publickey).",
                "fatal: the remote end hung up unexpectedly",
            ],
            CloneFailure::Authentication,
        ),
        (
            &[
                "warning: could not find remote branch nope to clone.",
                "fatal: remote branch nope not found in upstream origin",
            ],
            CloneFailure::BranchNotFound,
        ),
        (
            &[
                "remote: repository not found.",
                "fatal: repository 'https://example.com/a/b.git/' not found",
            ],
            CloneFailure::NotFound,
        ),
        (
            &[
                "error: repository not found.",
                "fatal: could not read from remote repository.",
            ],
            CloneFailure::NotFound,
        ),
        (
            &["fatal: unable to access 'https://example.com/': failed to connect to example.com port 443"],
            CloneFailure::Network,
        ),
        (
            &["ssh: could not resolve hostname example.com: nodename nor servname provided"],
            CloneFailure::Network,
        ),
        (&["error: something unexpected"], CloneFailure::Other),
        (&[], CloneFailure::Other),
    ];
    for (lines, expected) in cases {
        assert_eq!(
            classify_failure(lines.iter().copied()),
            expected,
            "{lines:?}"
        );
    }
}

#[test]
fn wire_values_are_camel_case() {
    assert_eq!(
        serde_json::to_value(CloneProgress {
            phase: ClonePhase::CheckingOut,
            percent: 7,
            received_bytes: Some(1),
            bytes_per_second: None,
        })
        .unwrap(),
        serde_json::json!({"phase":"checkingOut","percent":7,"receivedBytes":1,"bytesPerSecond":null})
    );
    assert_eq!(
        serde_json::to_value(CloneFailure::BranchNotFound).unwrap(),
        serde_json::json!("branchNotFound")
    );
}
