use super::{
    open_regular, regular_unlinked_stat, same_snapshot, WorkspaceImageFile,
    WorkspaceImageReadError, WORKSPACE_IMAGE_FILE_SIZE_LIMIT,
};
use std::{
    fs::File,
    io::{self, Read, Seek, SeekFrom},
    os::fd::AsRawFd,
    path::Path,
};

pub fn read_image_from_root(
    root: &File,
    path: &Path,
) -> Result<WorkspaceImageFile, WorkspaceImageReadError> {
    for _ in 0..3 {
        let mut file = open_regular(root.as_raw_fd(), path, libc::O_RDONLY)?;
        let before = regular_unlinked_stat(file.as_raw_fd())?;
        ensure_image_size(&before)?;
        let first = read_image_bytes(&mut file)?;
        let middle = regular_unlinked_stat(file.as_raw_fd())?;
        ensure_image_size(&middle)?;
        file.seek(SeekFrom::Start(0))?;
        let second = read_image_bytes(&mut file)?;
        let after = regular_unlinked_stat(file.as_raw_fd())?;
        ensure_image_size(&after)?;
        if same_snapshot(&before, &middle) && same_snapshot(&middle, &after) && first == second {
            return Ok(WorkspaceImageFile {
                byte_length: first.len(),
                base64: encode_base64(&first),
            });
        }
    }
    Err(io::Error::new(
        io::ErrorKind::WouldBlock,
        "file changed repeatedly while it was being read",
    )
    .into())
}

fn ensure_image_size(stat: &libc::stat) -> Result<(), WorkspaceImageReadError> {
    let size = u64::try_from(stat.st_size).unwrap_or(u64::MAX);
    if size <= WORKSPACE_IMAGE_FILE_SIZE_LIMIT as u64 {
        return Ok(());
    }
    Err(WorkspaceImageReadError::TooLarge {
        size,
        max_bytes: WORKSPACE_IMAGE_FILE_SIZE_LIMIT,
    })
}

fn read_image_bytes(file: &mut impl Read) -> Result<Vec<u8>, WorkspaceImageReadError> {
    let mut bytes = Vec::new();
    file.take((WORKSPACE_IMAGE_FILE_SIZE_LIMIT + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() <= WORKSPACE_IMAGE_FILE_SIZE_LIMIT {
        return Ok(bytes);
    }
    Err(WorkspaceImageReadError::TooLarge {
        size: bytes.len() as u64,
        max_bytes: WORKSPACE_IMAGE_FILE_SIZE_LIMIT,
    })
}

fn encode_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = chunk.get(1).copied().unwrap_or(0);
        let third = chunk.get(2).copied().unwrap_or(0);
        encoded.push(TABLE[(first >> 2) as usize] as char);
        encoded.push(TABLE[(((first & 0x03) << 4) | (second >> 4)) as usize] as char);
        encoded.push(if chunk.len() > 1 {
            TABLE[(((second & 0x0f) << 2) | (third >> 6)) as usize] as char
        } else {
            '='
        });
        encoded.push(if chunk.len() > 2 {
            TABLE[(third & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    encoded
}
