use super::*;

fn feed_all(detector: &mut ResultLineDetector, chunks: &[&[u8]]) -> usize {
    chunks.iter().filter(|chunk| detector.feed(chunk)).count()
}

#[test]
fn a_result_line_at_the_start_of_the_stream_matches() {
    let mut detector = ResultLineDetector::new();

    assert!(detector.feed(br#"{"type":"result","subtype":"success"}"#));
}

#[test]
fn a_result_line_after_a_newline_matches() {
    let mut detector = ResultLineDetector::new();

    assert!(!detector.feed(b"{\"type\":\"assistant\",\"message\":{}}\n"));
    assert!(detector.feed(b"{\"type\":\"result\",\"is_error\":false}\n"));
}

#[test]
fn the_prefix_matches_across_every_chunk_boundary() {
    let line = b"{\"type\":\"assistant\"}\n{\"type\":\"result\",\"is_error\":false}\n";
    for split in 0..line.len() {
        let mut detector = ResultLineDetector::new();
        let matches = feed_all(&mut detector, &[&line[..split], &line[split..]]);
        assert_eq!(matches, 1, "split at {split} still sees one result line");
    }
}

#[test]
fn the_prefix_matches_when_fed_one_byte_at_a_time() {
    let line = b"{\"type\":\"user\"}\n{\"type\":\"result\"}\n";
    let mut detector = ResultLineDetector::new();
    let mut matches = 0;
    for byte in line {
        if detector.feed(&[*byte]) {
            matches += 1;
        }
    }

    assert_eq!(matches, 1);
}

#[test]
fn a_prefix_in_the_middle_of_a_line_is_ignored() {
    let mut detector = ResultLineDetector::new();

    assert!(!detector.feed(b"{\"text\":\"{\\\"type\\\":\\\"result\\\",\"}\n"));
    assert!(!detector.feed(b" {\"type\":\"result\"}\n"));
    assert!(!detector.feed(b"x{\"type\":\"result\"}\n"));
}

#[test]
fn a_longer_type_name_is_not_a_result_line() {
    let mut detector = ResultLineDetector::new();

    assert!(!detector.feed(b"{\"type\":\"resultx\",\"is_error\":false}\n"));
    assert!(!detector.feed(b"{\"type\":\"result_summary\"}\n"));
}

#[test]
fn a_truncated_prefix_before_a_newline_is_not_a_match() {
    let mut detector = ResultLineDetector::new();

    assert!(!detector.feed(b"{\"type\":\"result\"\n"));
    assert!(!detector.feed(b"{\"type\":\"resul"));
    assert!(!detector.feed(b"t\"\n"));
}

#[test]
fn the_detector_fires_only_once_per_stream() {
    let mut detector = ResultLineDetector::new();

    assert!(detector.feed(b"{\"type\":\"result\"}\n"));
    assert!(!detector.feed(b"{\"type\":\"result\"}\n"));
    assert!(!detector.feed(b"{\"type\":\"result\",\"is_error\":true}\n"));
}

#[test]
fn an_empty_chunk_keeps_the_pending_prefix() {
    let mut detector = ResultLineDetector::new();

    assert!(!detector.feed(b"{\"type\":\"res"));
    assert!(!detector.feed(b""));
    assert!(detector.feed(b"ult\",\"is_error\":false}\n"));
}
