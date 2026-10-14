use super::*;

const FIRST: &str = "7389088c-29b8-4cec-9a15-e825e1fb2f66";
const SECOND: &str = "00000000-0000-4000-8000-000000000002";
const THIRD: &str = "00000000-0000-4000-8000-000000000003";

#[test]
fn a_server_admits_two_uploads_and_never_the_same_attachment_twice() {
    let transfers = AttachmentTransferState::default();
    let first = transfers.admit_upload("alpha", FIRST).unwrap();
    assert_eq!(
        transfers.admit_upload("alpha", FIRST).err(),
        Some(OPERATIONS_BUSY.to_string())
    );
    let second = transfers.admit_upload("alpha", SECOND).unwrap();
    assert_eq!(
        transfers.admit_upload("alpha", THIRD).err(),
        Some(OPERATIONS_BUSY.to_string())
    );
    let other = transfers.admit_upload("beta", FIRST).unwrap();
    assert_eq!(transfers.in_flight(), (3, 0));
    drop(first);
    let third = transfers.admit_upload("alpha", THIRD).unwrap();
    drop((second, third, other));
    assert_eq!(transfers.in_flight(), (0, 0));
}

#[test]
fn the_upload_lane_is_bounded_across_servers() {
    let transfers = AttachmentTransferState::default();
    let held: Vec<_> = (0..UPLOADS)
        .map(|index| {
            transfers
                .admit_upload(&format!("server-{index}"), FIRST)
                .expect("the lane admits eight uploads")
        })
        .collect();
    assert_eq!(UPLOADS, 8);
    assert_eq!(UPLOADS_PER_SERVER, 2);
    assert_eq!(
        transfers.admit_upload("another", FIRST).err(),
        Some(OPERATIONS_BUSY.to_string())
    );
    drop(held);
    assert!(transfers.admit_upload("another", FIRST).is_ok());
    assert_eq!(transfers.in_flight(), (0, 0));
}

#[test]
fn cancel_reaches_only_the_exact_upload_and_is_idempotent() {
    let transfers = AttachmentTransferState::default();
    let target = transfers.admit_upload("alpha", FIRST).unwrap();
    let sibling = transfers.admit_upload("alpha", SECOND).unwrap();
    let foreign = transfers.admit_upload("beta", FIRST).unwrap();
    let watched = target.cancelled();
    transfers.cancel_upload("alpha", THIRD);
    transfers.cancel_upload("gamma", FIRST);
    assert!(!target.is_cancelled() && !sibling.is_cancelled() && !foreign.is_cancelled());
    transfers.cancel_upload("alpha", FIRST);
    transfers.cancel_upload("alpha", FIRST);
    assert!(target.is_cancelled() && *watched.borrow());
    assert!(!sibling.is_cancelled() && !foreign.is_cancelled());
    assert_eq!(transfers.remembered(), 2);
    drop(target);
    let replacement = transfers.admit_upload("alpha", FIRST).unwrap();
    assert!(!replacement.is_cancelled());
}

#[test]
fn a_cancel_that_arrives_before_its_upload_refuses_that_upload_exactly_once() {
    let transfers = AttachmentTransferState::default();
    let now = Instant::now();
    transfers.cancel_upload_at("alpha", FIRST, now);
    transfers.cancel_upload_at("alpha", FIRST, now);
    assert_eq!(transfers.remembered(), 1);
    assert!(transfers.admit_upload_at("alpha", SECOND, now).is_ok());
    assert!(transfers.admit_upload_at("beta", FIRST, now).is_ok());
    assert_eq!(
        transfers.admit_upload_at("alpha", FIRST, now).err(),
        Some(UPLOAD_CANCELLED.to_string())
    );
    assert_eq!(transfers.remembered(), 0);
    assert_eq!(transfers.in_flight(), (0, 0));
    assert!(transfers.admit_upload_at("alpha", FIRST, now).is_ok());
}

#[test]
fn a_cancel_that_arrives_after_registration_reaches_the_upload_and_leaves_no_trace() {
    let transfers = AttachmentTransferState::default();
    let now = Instant::now();
    let upload = transfers.admit_upload_at("alpha", FIRST, now).unwrap();
    transfers.cancel_upload_at("alpha", FIRST, now);
    assert!(upload.is_cancelled());
    assert_eq!(transfers.remembered(), 0);
    drop(upload);
    assert!(transfers.admit_upload_at("alpha", FIRST, now).is_ok());
}

#[test]
fn remembered_cancels_expire_by_age_and_the_oldest_is_evicted_first() {
    let transfers = AttachmentTransferState::default();
    let now = Instant::now();
    assert_eq!(CANCELLED_FOR, Duration::from_secs(5));
    assert_eq!(CANCELLED_RETAINED, 32);
    transfers.cancel_upload_at("alpha", FIRST, now);
    let fresh = now + CANCELLED_FOR - Duration::from_millis(1);
    transfers.cancel_upload_at("alpha", SECOND, fresh);
    assert_eq!(transfers.remembered(), 2);
    assert!(transfers
        .admit_upload_at("alpha", FIRST, now + CANCELLED_FOR)
        .is_ok());
    assert_eq!(transfers.remembered(), 1);
    transfers.cancel_upload_at("alpha", THIRD, fresh + CANCELLED_FOR);
    assert_eq!(transfers.remembered(), 1);
    let transfers = AttachmentTransferState::default();
    let ids: Vec<String> = (0..CANCELLED_RETAINED + 2)
        .map(|index| format!("00000000-0000-4000-8000-{index:012}"))
        .collect();
    for id in &ids {
        transfers.cancel_upload_at("alpha", id, now);
    }
    assert_eq!(transfers.remembered(), CANCELLED_RETAINED);
    for evicted in &ids[..2] {
        let admitted = transfers.admit_upload_at("alpha", evicted, now);
        assert!(admitted.is_ok(), "{evicted}");
    }
    for remembered in &ids[2..4] {
        assert_eq!(
            transfers.admit_upload_at("alpha", remembered, now).err(),
            Some(UPLOAD_CANCELLED.to_string())
        );
    }
}

#[test]
fn registrations_are_released_when_the_transfer_panics() {
    let transfers = AttachmentTransferState::default();
    let upload = transfers.admit_upload("alpha", FIRST).unwrap();
    let download = transfers.admit_download().unwrap();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
        let _upload = upload;
        let _choosing = download.choosing().unwrap();
        panic!("transfer failed");
    }));
    assert!(result.is_err());
    assert_eq!(transfers.in_flight(), (0, 0));
    let download = transfers.admit_download().unwrap();
    assert!(download.choosing().is_ok());
    assert!(transfers.admit_upload("alpha", FIRST).is_ok());
}

#[test]
fn the_download_lane_admits_two_transfers_and_one_dialog() {
    let transfers = AttachmentTransferState::default();
    let first = transfers.admit_download().unwrap();
    let second = transfers.admit_download().unwrap();
    assert_eq!(DOWNLOADS, 2);
    assert_eq!(
        transfers.admit_download().err(),
        Some(OPERATIONS_BUSY.to_string())
    );
    let choosing = first.choosing().unwrap();
    assert_eq!(second.choosing().err(), Some(OPERATIONS_BUSY.to_string()));
    drop(choosing);
    assert!(second.choosing().is_ok());
    drop(first);
    assert!(transfers.admit_download().is_ok());
    assert!(transfers.admit_upload("alpha", FIRST).is_ok());
}

#[test]
fn every_admission_reserves_its_worker_until_that_worker_exits() {
    let transfers = AttachmentTransferState::default();
    let upload = transfers.admit_upload("alpha", FIRST).unwrap();
    assert_eq!(transfers.workers(), (1, 0));
    let (seat, worker) = upload.worker().expect("the reservation is claimed once");
    assert_eq!(upload.worker().err(), Some(OPERATIONS_BUSY.to_string()));
    assert_eq!(transfers.workers(), (1, 0));
    drop(seat);
    assert_eq!(transfers.workers(), (1, 1));
    drop(upload);
    assert_eq!(transfers.workers(), (1, 1));
    drop(worker);
    assert_eq!(transfers.workers(), (0, 0));
    let unused = transfers.admit_download().unwrap();
    assert_eq!(transfers.workers(), (1, 0));
    drop(unused);
    assert_eq!(transfers.workers(), (0, 0));
}

fn stuck(transfers: &AttachmentTransferState, count: usize) -> Vec<WorkerPermit> {
    (0..count)
        .map(|_| {
            let upload = transfers.admit_upload("alpha", FIRST).unwrap();
            let (_seat, worker) = upload.worker().unwrap();
            worker
        })
        .collect()
}

#[test]
fn live_workers_never_exceed_the_hard_maximum_however_admissions_interleave() {
    assert_eq!(WORKER_THREADS, 26);
    assert_eq!(WORKER_THREADS, UPLOADS + DOWNLOADS + ABANDONED_WORKERS);
    let transfers = AttachmentTransferState::default();
    let mut workers = stuck(&transfers, WORKER_THREADS - 1);
    assert_eq!(transfers.workers(), (25, 25));
    let last = transfers.admit_upload("alpha", FIRST).unwrap();
    assert_eq!(transfers.workers().0, WORKER_THREADS);
    for server in ["alpha", "beta", "gamma"] {
        assert_eq!(
            transfers.admit_upload(server, SECOND).err(),
            Some(OPERATIONS_BUSY.to_string())
        );
        assert_eq!(
            transfers.admit_download().err(),
            Some(OPERATIONS_BUSY.to_string())
        );
    }
    assert_eq!(transfers.workers().0, WORKER_THREADS);
    assert_eq!(transfers.in_flight(), (1, 0));
    let (seat, worker) = last.worker().unwrap();
    drop((seat, last));
    workers.push(worker);
    assert_eq!(transfers.workers(), (26, 26));
    assert_eq!(
        transfers.admit_download().err(),
        Some(OPERATIONS_BUSY.to_string())
    );
    let unwound = std::panic::catch_unwind(std::panic::AssertUnwindSafe({
        let worker = workers.pop().unwrap();
        move || {
            let _worker = worker;
            panic!("reader failed");
        }
    }));
    assert!(unwound.is_err());
    assert_eq!(transfers.workers(), (25, 25));
    let download = transfers.admit_download().unwrap();
    assert_eq!(
        transfers.admit_upload("alpha", FIRST).err(),
        Some(OPERATIONS_BUSY.to_string())
    );
    drop(download);
    drop(workers);
    assert_eq!(transfers.workers(), (0, 0));
    let admitted: Vec<_> = (0..UPLOADS)
        .map(|index| transfers.admit_upload(&format!("server-{index}"), FIRST))
        .collect();
    assert!(admitted.iter().all(Result::is_ok));
}
