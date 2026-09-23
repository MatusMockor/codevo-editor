//! Retain unique reachable Git objects, rather than charging unchanged files per turn.
use super::{
    checkpoint, git_authority::Context, git_process, snapshot, storage,
    storage_catalog::RootRecords, types::*,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
    time::{Duration, Instant},
};

const RETENTION_TIMEOUT: Duration = Duration::from_secs(30);

pub(super) fn enforce(
    base: &Path,
    identity: &RootIdentity,
    current_turn: &str,
) -> Result<(), String> {
    enforce_limit(base, identity, current_turn, MAX_STORAGE_BYTES)
}

fn enforce_limit(
    base: &Path,
    identity: &RootIdentity,
    current_turn: &str,
    limit: u64,
) -> Result<(), String> {
    let started = Instant::now();
    let catalog = RootRecords::open(base, identity)?;
    let records = catalog.records()?;
    if !records.iter().any(|record| {
        record
            .checkpoints
            .as_ref()
            .is_some_and(|saved| saved.before.is_some() || saved.after.is_some())
    }) {
        return Ok(());
    }
    let context = Context::new(identity)?;
    let prefix = format!(
        "refs/codevo/checkpoints/{}/",
        snapshot::digest(
            format!("{}:{}:{}", identity.path, identity.device, identity.inode).as_bytes()
        )
    );
    let bytes = checkpoint::output(
        &context,
        &[
            "for-each-ref",
            "--format=%(refname) %(objectname) %(objecttype)",
            &prefix,
        ],
    )?;
    let text =
        std::str::from_utf8(&bytes).map_err(|_| "Invalid checkpoint retention references.")?;
    let mut refs = BTreeMap::new();
    for line in text.lines() {
        let fields: Vec<_> = line.split(' ').collect();
        if fields.len() != 3 || refs.len() >= 2048 {
            return Err("Checkpoint retention references exceed their bounds.".into());
        }
        refs.insert(fields[0], (fields[1], fields[2]));
    }
    let mentioned: BTreeSet<_> = records
        .iter()
        .filter_map(|record| record.checkpoints.as_ref())
        .flat_map(|saved| saved.before.iter().chain(saved.after.iter()))
        .map(|saved| saved.reference.as_str())
        .collect();
    let orphans: Vec<_> = refs
        .iter()
        .filter_map(|(reference, (tree, kind))| {
            let tail = reference.strip_prefix(&prefix)?;
            let (turn, phase) = tail.split_once('/')?;
            (!mentioned.contains(reference)
                && *kind == "tree"
                && turn.len() == 64
                && turn.bytes().all(|byte| byte.is_ascii_hexdigit())
                && matches!(phase, "before" | "after")
                && matches!(tree.len(), 40 | 64)
                && tree.bytes().all(|byte| byte.is_ascii_hexdigit()))
            .then_some((*reference, *tree))
        })
        .collect();
    delete_refs(base, &context, &orphans)?;
    let mut candidates = Vec::new();
    let mut protected = BTreeSet::new();
    for record in &records {
        let Some(saved) = &record.checkpoints else {
            continue;
        };
        let checkpoints: Vec<_> = saved
            .before
            .iter()
            .chain(saved.after.iter())
            .filter(|saved| {
                saved.git == context.git_identity()
                    && saved.common == context.common_identity()
                    && refs.get(saved.reference.as_str()) == Some(&(saved.tree.as_str(), "tree"))
            })
            .collect();
        if checkpoints.is_empty() {
            continue;
        }
        if record.turn_id == current_turn {
            protected.extend(checkpoints.iter().map(|saved| saved.tree.as_str()));
        } else {
            candidates.push((record, checkpoints));
        }
    }
    let usage = |skip: usize| -> Result<u64, String> {
        if started.elapsed() > RETENTION_TIMEOUT {
            return Err("Checkpoint retention exceeded its time limit.".into());
        }
        let trees = protected
            .iter()
            .copied()
            .chain(
                candidates[skip..]
                    .iter()
                    .flat_map(|(_, saved)| saved.iter().map(|saved| saved.tree.as_str())),
            )
            .collect();
        disk_usage(&context, trees)
    };
    if usage(0)? <= limit {
        return Ok(());
    }
    if usage(candidates.len())? > limit {
        return Err("The current turn exceeds the checkpoint storage limit.".into());
    }
    // Reachability is monotonic as old turns are removed. Find the smallest
    // expired prefix in logarithmic Git traversals, even for long histories.
    let mut low = 1;
    let mut high = candidates.len();
    while low < high {
        let middle = low + (high - low) / 2;
        if usage(middle)? <= limit {
            high = middle;
        } else {
            low = middle + 1;
        }
    }
    let expired = &candidates[..low];
    let deletions: Vec<_> = expired
        .iter()
        .flat_map(|(_, saved)| saved.iter())
        .map(|saved| (saved.reference.as_str(), saved.tree.as_str()))
        .collect();
    delete_refs(base, &context, &deletions)?;
    for (record, _) in expired {
        catalog.remove(record)?;
    }
    Ok(())
}

fn delete_refs(base: &Path, context: &Context, references: &[(&str, &str)]) -> Result<(), String> {
    if references.is_empty() {
        return Ok(());
    }
    let mut input = String::from("start\n");
    for (reference, tree) in references {
        input.push_str(&format!("delete {reference} {tree}\n"));
    }
    input.push_str("prepare\ncommit\n");
    let temporary = storage::TemporaryDirectory::new(base)?;
    temporary.write_relative(Path::new("retention"), input.as_bytes())?;
    let mut command = context.command()?;
    command.args(["update-ref", "--no-deref", "--stdin"]);
    git_process::run_input(command, temporary.open_read("retention")?)?;
    context.verify()
}

fn disk_usage(context: &Context, trees: BTreeSet<&str>) -> Result<u64, String> {
    if trees.is_empty() {
        return Ok(0);
    }
    let mut arguments = vec!["rev-list", "--objects", "--disk-usage"];
    arguments.extend(trees);
    arguments.push("--");
    let bytes = checkpoint::output(context, &arguments)?;
    let text = std::str::from_utf8(&bytes).map_err(|_| "Invalid checkpoint storage usage.")?;
    let number = text
        .strip_suffix('\n')
        .ok_or("Invalid checkpoint storage usage.")?;
    if number.is_empty() || number.len() > 20 || !number.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("Invalid checkpoint storage usage.".into());
    }
    number
        .parse()
        .map_err(|_| "Invalid checkpoint storage usage.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn counts_shared_objects_once_and_prunes_only_expired_refs() {
        let parent = std::env::temp_dir().canonicalize().unwrap();
        let temp = storage::TemporaryDirectory::new(&parent).unwrap();
        let root = temp.0.join("workspace");
        let base = temp.0.join("history");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&base).unwrap();
        let mut command = git_process::git_command();
        command.current_dir(&root).args(["init", "--quiet"]);
        git_process::run(command, false).unwrap();
        fs::write(
            root.join("shared"),
            "unchanged repository contents\n".repeat(1000),
        )
        .unwrap();
        fs::write(root.join("changed"), "before\n").unwrap();
        let (handle, identity) = snapshot::root_identity(&root).unwrap();
        let mut saved = Vec::new();
        for index in 0..8 {
            let turn = format!("turn-{index}");
            let captured =
                checkpoint::capture(&base, &handle, &identity, &turn, CapturePhase::Before, None)
                    .unwrap();
            let record = Record {
                version: 2,
                root: identity.clone(),
                turn_id: turn.clone(),
                before: Snapshot::new(),
                after: None,
                summary: TurnChangesSummary::unavailable(&turn, "Not completed."),
                finished: false,
                checkpoints: Some(Checkpoints {
                    before: Some(captured.clone()),
                    after: None,
                }),
            };
            storage::write(&storage::record_path(&base, &identity, &turn), &record).unwrap();
            saved.push(captured);
        }
        let orphan = checkpoint::capture(
            &base,
            &handle,
            &identity,
            "orphan",
            CapturePhase::Before,
            None,
        )
        .unwrap();
        let context = Context::new(&identity).unwrap();
        let one = disk_usage(&context, BTreeSet::from([saved[0].tree.as_str()])).unwrap();
        enforce_limit(&base, &identity, "turn-7", one).unwrap();
        assert!(checkpoint::verify_checkpoint(&context, &orphan).is_err());
        assert_eq!(
            RootRecords::open(&base, &identity)
                .unwrap()
                .records()
                .unwrap()
                .len(),
            8
        );

        fs::write(root.join("changed"), "after\n").unwrap();
        let latest = checkpoint::capture(
            &base,
            &handle,
            &identity,
            "latest",
            CapturePhase::Before,
            None,
        )
        .unwrap();
        let record = Record {
            version: 2,
            root: identity.clone(),
            turn_id: "latest".into(),
            before: Snapshot::new(),
            after: None,
            summary: TurnChangesSummary::unavailable("latest", "Not completed."),
            finished: false,
            checkpoints: Some(Checkpoints {
                before: Some(latest.clone()),
                after: None,
            }),
        };
        storage::write(&storage::record_path(&base, &identity, "latest"), &record).unwrap();
        let latest_bytes = disk_usage(&context, BTreeSet::from([latest.tree.as_str()])).unwrap();
        let union = disk_usage(
            &context,
            BTreeSet::from([saved[0].tree.as_str(), latest.tree.as_str()]),
        )
        .unwrap();
        assert!(union > latest_bytes);
        assert!(union < one + latest_bytes);
        enforce_limit(&base, &identity, "latest", latest_bytes).unwrap();
        let records = RootRecords::open(&base, &identity)
            .unwrap()
            .records()
            .unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].turn_id, "latest");
        checkpoint::verify_checkpoint(&context, &latest).unwrap();
        for old in &saved {
            assert!(checkpoint::verify_checkpoint(&context, old).is_err());
        }
        assert!(!root.join(".git/index").exists());
        assert!(enforce_limit(&base, &identity, "latest", 0).is_err());
        checkpoint::verify_checkpoint(&context, &latest).unwrap();
    }
}
