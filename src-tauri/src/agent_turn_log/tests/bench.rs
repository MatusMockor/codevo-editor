use super::*;

const BENCH_ROWS: i64 = 1_000_000;
const BENCH_BATCH: i64 = 256;
const BENCH_PAGES: usize = 1_000;

fn percentile(sorted: &[u128], fraction: f64) -> u128 {
    if sorted.is_empty() {
        return 0;
    }
    let index = ((sorted.len() as f64 - 1.0) * fraction).round() as usize;
    sorted[index.min(sorted.len() - 1)]
}

fn micros(value: u128) -> String {
    format!("{:.3} ms", value as f64 / 1_000.0)
}

fn pseudo_random(state: &mut u64) -> u64 {
    *state ^= *state << 13;
    *state ^= *state >> 7;
    *state ^= *state << 17;
    *state
}

#[test]
#[ignore = "benchmark: run explicitly with --ignored"]
fn agent_turn_log_bench_appends_and_pages_one_million_rows() {
    let temp = TempLogStore::create("bench");
    let store = temp.store();
    let lease = store.open(&open_request(TURN_ID)).expect("lease");
    let mut append_timings = Vec::new();
    let mut next_seq = AGENT_TURN_LOG_SEQ_BASE;
    let started = std::time::Instant::now();
    let last_seq = AGENT_TURN_LOG_SEQ_BASE + BENCH_ROWS;
    while next_seq < last_seq {
        let ops = (next_seq..(next_seq + BENCH_BATCH).min(last_seq))
            .map(|seq| {
                entry(
                    seq,
                    &format!("bench event {seq} with a realistic amount of text"),
                )
            })
            .collect::<Vec<_>>();
        let batch_started = std::time::Instant::now();
        let receipt = store
            .append(&append_request(TURN_ID, lease.writer_epoch, next_seq, ops))
            .expect("bench append");
        append_timings.push(batch_started.elapsed().as_micros());
        assert_eq!(receipt.persisted_through_seq, receipt.next_seq - 1);
        next_seq = receipt.next_seq;
    }
    let append_total = started.elapsed();
    append_timings.sort_unstable();

    let mut page_timings = Vec::new();
    let mut state = 0x2545_f491_4f6c_dd1d_u64;
    for _ in 0..BENCH_PAGES {
        let anchor_seq =
            AGENT_TURN_LOG_SEQ_BASE + (pseudo_random(&mut state) % BENCH_ROWS as u64) as i64;
        let page_started = std::time::Instant::now();
        let page = store
            .read_page(&page_request(
                TURN_ID,
                anchored(AgentTurnLogAnchorAt::Around, anchor_seq),
                200,
                512 * 1024,
            ))
            .expect("bench page");
        page_timings.push(page_started.elapsed().as_micros());
        assert!(!page.entries.is_empty());
    }
    page_timings.sort_unstable();

    let database_bytes = fs::metadata(temp.database())
        .map(|metadata| metadata.len())
        .unwrap_or_default();
    let wal_bytes = {
        let mut wal = temp.database().into_os_string();
        wal.push("-wal");
        fs::metadata(std::path::PathBuf::from(wal))
            .map(|metadata| metadata.len())
            .unwrap_or_default()
    };

    println!("agent_turn_log bench");
    println!("  rows: {BENCH_ROWS} in batches of {BENCH_BATCH}");
    println!("  append total: {:.2} s", append_total.as_secs_f64());
    println!(
        "  append p50/batch: {}",
        micros(percentile(&append_timings, 0.50))
    );
    println!(
        "  append p99/batch: {}",
        micros(percentile(&append_timings, 0.99))
    );
    println!("  page reads: {BENCH_PAGES} random around-anchors of 200 events");
    println!("  page p50: {}", micros(percentile(&page_timings, 0.50)));
    println!("  page p99: {}", micros(percentile(&page_timings, 0.99)));
    println!("  database bytes: {database_bytes}");
    println!("  write ahead log bytes: {wal_bytes}");
    assert_eq!(next_seq, last_seq);
}
