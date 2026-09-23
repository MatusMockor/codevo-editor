//! Immutable Git trees retained by private refs; the user's index and HEAD are untouched.
use super::{git_authority::Context, git_process, snapshot, storage, types::*};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::File,
    path::Path,
    process::Command,
    time::Instant,
};

pub(super) struct TreeEntry {
    pub(super) mode: String,
    pub(super) object: String,
    pub(super) size: usize,
}
fn command(context: &Context) -> Result<Command, String> {
    context.command()
}
pub(super) fn output(context: &Context, args: &[&str]) -> Result<Vec<u8>, String> {
    let mut cmd = context.command()?;
    cmd.args(args);
    let result = git_process::run(cmd, false)?;
    context.verify()?;
    Ok(result)
}
fn object_id(value: &str) -> bool {
    matches!(value.len(), 40 | 64) && value.bytes().all(|b| b.is_ascii_hexdigit())
}
fn oid(bytes: &[u8]) -> Result<String, String> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| "Invalid checkpoint object.")?
        .trim();
    if !object_id(text) {
        return Err("Invalid checkpoint object.".into());
    }
    Ok(text.into())
}
fn namespace(identity: &RootIdentity) -> String {
    format!(
        "refs/codevo/checkpoints/{}/",
        snapshot::digest(
            format!("{}:{}:{}", identity.path, identity.device, identity.inode).as_bytes()
        )
    )
}
pub(super) fn verify(identity: &RootIdentity, checkpoint: &Checkpoint) -> Result<(), String> {
    verify_checkpoint(&Context::new(identity)?, checkpoint)
}
pub(super) fn verify_checkpoint(identity: &Context, checkpoint: &Checkpoint) -> Result<(), String> {
    if identity.git_identity() != checkpoint.git || identity.common_identity() != checkpoint.common
    {
        return Err("The workspace Git repository has changed.".into());
    }
    let prefix = namespace(identity);
    let tail = checkpoint
        .reference
        .strip_prefix(&prefix)
        .ok_or("Checkpoint belongs to another workspace.")?;
    let (turn, phase) = tail
        .split_once('/')
        .ok_or("Invalid checkpoint reference.")?;
    if turn.len() != 64
        || !turn.bytes().all(|b| b.is_ascii_hexdigit())
        || !matches!(phase, "before" | "after")
        || !object_id(&checkpoint.tree)
    {
        return Err("Invalid checkpoint reference.".into());
    }
    if oid(&output(
        identity,
        &["rev-parse", "--verify", &checkpoint.reference],
    )?)? != checkpoint.tree
        || output(identity, &["cat-file", "-t", &checkpoint.tree])? != b"tree\n"
    {
        return Err("The recorded Git checkpoint is unavailable.".into());
    }
    Ok(())
}
pub(super) fn delete(identity: &RootIdentity, checkpoint: &Checkpoint) -> Result<(), String> {
    let context = Context::new(identity)?;
    let identity = &context;
    let refs = output(
        identity,
        &["for-each-ref", "--format=%(refname)", &checkpoint.reference],
    )?;
    if refs.is_empty() {
        return Ok(());
    }
    verify_checkpoint(identity, checkpoint)?;
    output(
        identity,
        &[
            "update-ref",
            "--no-deref",
            "-d",
            &checkpoint.reference,
            &checkpoint.tree,
        ],
    )?;
    Ok(())
}
pub(super) fn tree(
    identity: &Context,
    checkpoint: &Checkpoint,
) -> Result<BTreeMap<String, TreeEntry>, String> {
    let bytes = output(identity, &["ls-tree", "-r", "-l", "-z", &checkpoint.tree])?;
    let mut result = BTreeMap::new();
    for record in bytes
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
    {
        let text = std::str::from_utf8(record).map_err(|_| "Unsupported checkpoint path.")?;
        let (header, path) = text.split_once('\t').ok_or("Invalid checkpoint tree.")?;
        let fields: Vec<_> = header.split_whitespace().collect();
        if fields.len() != 4
            || fields[1] != "blob"
            || !matches!(fields[0], "100644" | "100755" | "120000")
            || !object_id(fields[2])
            || !snapshot::valid_relative(path)
            || result.len() >= 10_000
        {
            return Err("Unsupported checkpoint tree entry.".into());
        }
        let size = fields[3]
            .parse::<usize>()
            .map_err(|_| "Invalid checkpoint blob size.")?;
        if size > MAX_HASH_FILE_BYTES as usize {
            return Err("Checkpoint file exceeds its size limit.".into());
        }
        if result
            .insert(
                path.into(),
                TreeEntry {
                    mode: fields[0].into(),
                    object: fields[2].into(),
                    size,
                },
            )
            .is_some()
        {
            return Err("Duplicate checkpoint path.".into());
        }
    }
    Ok(result)
}
pub(super) fn capture(
    base: &Path,
    root: &File,
    identity: &RootIdentity,
    turn_id: &str,
    phase: CapturePhase,
    baseline: Option<&Checkpoint>,
) -> Result<Checkpoint, String> {
    let context = Context::new(identity)?;
    let identity = &context;
    let started = Instant::now();
    let mut paths: BTreeSet<_> = git_process::inventory(Path::new(&identity.path))?
        .into_iter()
        .collect();
    context.verify_binding()?;
    if let Some(baseline) = baseline {
        verify_checkpoint(identity, baseline)?;
        paths.extend(tree(identity, baseline)?.into_keys());
    }
    if paths.len() > 10_000 {
        return Err("The repository exceeds the checkpoint file limit.".into());
    }
    let temp = storage::TemporaryDirectory::new(base)?;
    let index = temp.0.join("index");
    let mut entries = Vec::new();
    let mut read_bytes = 0;
    for path in paths {
        if started.elapsed() > snapshot::TIME_LIMIT {
            return Err("Recording Git checkpoint exceeded the time limit.".into());
        }
        if !snapshot::valid_relative(&path) {
            return Err("Unsupported checkpoint file path.".into());
        }
        if let Some((bytes, mode)) = snapshot::read_raw_entry(root, &path, &mut read_bytes)? {
            let name = format!("blob-{}", entries.len());
            temp.write_relative(Path::new(&name), &bytes)?;
            entries.push((path, mode, name));
        }
    }
    let mut index_info = Vec::new();
    for batch in entries.chunks(128) {
        if started.elapsed() > snapshot::TIME_LIMIT {
            return Err("Recording Git checkpoint exceeded the time limit.".into());
        }
        temp.verify_identity()?;
        let mut cmd = command(identity)?;
        cmd.args(["hash-object", "--no-filters", "-w", "--"]);
        for (_, _, name) in batch {
            cmd.arg(temp.0.join(name));
        }
        let hashes = git_process::run(cmd, false)?;
        let hashes = std::str::from_utf8(&hashes)
            .map_err(|_| "Invalid Git blob identifiers.")?
            .lines()
            .collect::<Vec<_>>();
        if hashes.len() != batch.len() {
            return Err("Incomplete checkpoint blob capture.".into());
        }
        for ((path, mode, _), hash) in batch.iter().zip(hashes) {
            if !object_id(hash) {
                return Err("Invalid Git blob identifier.".into());
            }
            index_info.extend_from_slice(format!("{mode:o} {hash}\t{path}\0").as_bytes());
        }
    }
    temp.write_relative(Path::new("entries"), &index_info)?;
    temp.verify_identity()?;
    let mut init = command(identity)?;
    init.env("GIT_INDEX_FILE", &index)
        .args(["read-tree", "--empty"]);
    git_process::run(init, false)?;
    let mut update = command(identity)?;
    update
        .env("GIT_INDEX_FILE", &index)
        .args(["update-index", "-z", "--index-info"]);
    git_process::run_input(update, temp.open_read("entries")?)?;
    temp.verify_identity()?;
    let mut write = command(identity)?;
    write.env("GIT_INDEX_FILE", &index).arg("write-tree");
    let tree = oid(&git_process::run(write, false)?)?;
    let phase = match phase {
        CapturePhase::Before => "before",
        CapturePhase::After => "after",
    };
    let checkpoint = Checkpoint {
        reference: format!(
            "{}{}/{phase}",
            namespace(identity),
            snapshot::digest(turn_id.as_bytes())
        ),
        tree,
        git: identity.git_identity(),
        common: identity.common_identity(),
        bytes: read_bytes as u64,
    };
    context.verify_binding()?;
    output(
        identity,
        &[
            "update-ref",
            "--no-deref",
            &checkpoint.reference,
            &checkpoint.tree,
            &"0".repeat(checkpoint.tree.len()),
        ],
    )?;
    Ok(checkpoint)
}

pub(super) use super::checkpoint_diff::{file_diff, summary};
