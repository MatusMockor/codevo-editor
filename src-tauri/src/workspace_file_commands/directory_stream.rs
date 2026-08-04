use super::{clear_errno, run_test_hook, stat_at, unsafe_dup};
use std::{
    ffi::CStr,
    fs::File,
    io,
    os::fd::{AsRawFd, FromRawFd, IntoRawFd},
};

pub(super) struct DirectoryEntry {
    pub(super) name: String,
    pub(super) is_directory: bool,
}

pub(super) enum DirectoryStreamEntry {
    Entry(DirectoryEntry),
    Skipped,
    End,
}

pub(super) struct DirectoryStream(*mut libc::DIR);

impl Drop for DirectoryStream {
    fn drop(&mut self) {
        unsafe {
            libc::closedir(self.0);
        }
    }
}

impl DirectoryStream {
    pub(super) fn from_raw(stream: *mut libc::DIR) -> Self {
        Self(stream)
    }

    pub(super) fn as_ptr(&self) -> *mut libc::DIR {
        self.0
    }

    pub(super) fn open(directory: &File) -> io::Result<Self> {
        let cloned = unsafe_dup(directory.as_raw_fd())?;
        let raw_fd = cloned.into_raw_fd();
        let stream = unsafe { libc::fdopendir(raw_fd) };
        if stream.is_null() {
            let error = io::Error::last_os_error();
            drop(unsafe { File::from_raw_fd(raw_fd) });
            return Err(error);
        }
        Ok(Self(stream))
    }

    pub(super) fn next_entry(&mut self, directory: &File) -> io::Result<DirectoryStreamEntry> {
        let Some(raw) = self.next_named_dirent()? else {
            return Ok(DirectoryStreamEntry::End);
        };
        let name = unsafe { CStr::from_ptr((*raw).d_name.as_ptr()) };
        classify_by_stat(directory, name)
    }

    pub(super) fn next_search_entry(
        &mut self,
        directory: &File,
    ) -> io::Result<DirectoryStreamEntry> {
        let Some(raw) = self.next_named_dirent()? else {
            return Ok(DirectoryStreamEntry::End);
        };
        let name = unsafe { CStr::from_ptr((*raw).d_name.as_ptr()) };
        match unsafe { (*raw).d_type } {
            libc::DT_REG => Ok(entry(name, false)),
            libc::DT_DIR => Ok(entry(name, true)),
            libc::DT_UNKNOWN => classify_by_stat(directory, name),
            _ => Ok(DirectoryStreamEntry::Skipped),
        }
    }

    pub(super) fn has_unexamined_entry(&mut self) -> io::Result<bool> {
        Ok(self.next_named_dirent()?.is_some())
    }

    fn next_named_dirent(&mut self) -> io::Result<Option<*const libc::dirent>> {
        loop {
            clear_errno();
            let raw = unsafe { libc::readdir(self.0) };
            if raw.is_null() {
                let error = io::Error::last_os_error();
                return if error.raw_os_error() == Some(0) {
                    Ok(None)
                } else {
                    Err(error)
                };
            }
            let name = unsafe { CStr::from_ptr((*raw).d_name.as_ptr()) };
            if name.to_bytes() != b"." && name.to_bytes() != b".." {
                return Ok(Some(raw));
            }
        }
    }
}

fn classify_by_stat(directory: &File, name: &CStr) -> io::Result<DirectoryStreamEntry> {
    run_test_hook(
        "directory-entries-before-stat",
        directory.as_raw_fd(),
        name,
        name,
    );
    let stat = stat_at(directory.as_raw_fd(), name)?;
    let kind = stat.st_mode & libc::S_IFMT;
    if kind != libc::S_IFDIR && kind != libc::S_IFREG {
        return Ok(DirectoryStreamEntry::Skipped);
    }
    Ok(entry(name, kind == libc::S_IFDIR))
}

fn entry(name: &CStr, is_directory: bool) -> DirectoryStreamEntry {
    DirectoryStreamEntry::Entry(DirectoryEntry {
        name: String::from_utf8_lossy(name.to_bytes()).into_owned(),
        is_directory,
    })
}
