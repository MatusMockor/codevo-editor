use std::{
    io,
    os::fd::{AsRawFd, BorrowedFd, RawFd},
    process::Command,
};

pub(crate) const MAX_INHERITED_CHILD_DESCRIPTORS: usize = 8;
const FIRST_NON_STANDARD_DESCRIPTOR: RawFd = 3;
#[cfg(target_os = "linux")]
const LINUX_DIRECTORY_ENTRY_NAME_OFFSET: usize = 19;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ChildDescriptorInheritance {
    descriptors: [RawFd; MAX_INHERITED_CHILD_DESCRIPTORS],
    count: usize,
}

impl ChildDescriptorInheritance {
    pub(crate) fn exactly(descriptors: &[BorrowedFd<'_>]) -> Result<Self, String> {
        if descriptors.len() > MAX_INHERITED_CHILD_DESCRIPTORS {
            return Err(
                "Child process descriptor inheritance exceeds its safety limit.".to_string(),
            );
        }
        let mut retained = [-1; MAX_INHERITED_CHILD_DESCRIPTORS];
        for (slot, descriptor) in descriptors.iter().enumerate() {
            let raw = descriptor.as_raw_fd();
            if raw < FIRST_NON_STANDARD_DESCRIPTOR {
                return Err("Child process cannot inherit a standard stream by number.".to_string());
            }
            if retained[..slot].contains(&raw) {
                return Err(
                    "Child process descriptor inheritance contains a duplicate.".to_string()
                );
            }
            retained[slot] = raw;
        }
        retained[..descriptors.len()].sort_unstable();
        Ok(Self {
            descriptors: retained,
            count: descriptors.len(),
        })
    }

    fn inherited(&self) -> &[RawFd] {
        &self.descriptors[..self.count]
    }

    fn inherits(&self, descriptor: RawFd) -> bool {
        self.inherited().contains(&descriptor)
    }

    pub(crate) fn apply_in_child(&self) -> io::Result<()> {
        mark_unmapped_close_on_exec(self)?;
        self.inherited()
            .iter()
            .try_for_each(|descriptor| clear_close_on_exec(*descriptor))
    }
}

pub(crate) fn restrict_child_descriptors(
    command: &mut Command,
    inheritance: ChildDescriptorInheritance,
) {
    use std::os::unix::process::CommandExt;

    unsafe {
        command.pre_exec(move || inheritance.apply_in_child());
    }
}

#[cfg(target_os = "macos")]
fn mark_unmapped_close_on_exec(inheritance: &ChildDescriptorInheritance) -> io::Result<()> {
    mark_range_close_on_exec(
        inheritance,
        FIRST_NON_STANDARD_DESCRIPTOR,
        descriptor_table_bound()?,
    )
}

#[cfg(target_os = "macos")]
fn descriptor_table_bound() -> io::Result<RawFd> {
    let bytes = unsafe {
        libc::proc_pidinfo(
            libc::getpid(),
            libc::PROC_PIDLISTFDS,
            0,
            std::ptr::null_mut(),
            0,
        )
    };
    if bytes > 0 {
        return Ok(bytes / std::mem::size_of::<libc::proc_fdinfo>() as libc::c_int);
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error().is_some_and(|code| code != 0) {
        return Err(error);
    }
    Err(io::Error::from_raw_os_error(libc::EINVAL))
}

#[cfg(target_os = "linux")]
fn mark_unmapped_close_on_exec(inheritance: &ChildDescriptorInheritance) -> io::Result<()> {
    match mark_unmapped_with_close_range(inheritance) {
        Err(error) if matches!(error.raw_os_error(), Some(libc::ENOSYS | libc::EINVAL)) => {
            mark_listed_descriptors_close_on_exec(inheritance)
        }
        result => result,
    }
}

#[cfg(target_os = "linux")]
fn mark_unmapped_with_close_range(inheritance: &ChildDescriptorInheritance) -> io::Result<()> {
    let mut start = FIRST_NON_STANDARD_DESCRIPTOR as libc::c_uint;
    for descriptor in inheritance.inherited() {
        let descriptor = *descriptor as libc::c_uint;
        if descriptor > start {
            close_range_close_on_exec(start, descriptor - 1)?;
        }
        start = descriptor + 1;
    }
    close_range_close_on_exec(start, libc::c_uint::MAX)
}

#[cfg(target_os = "linux")]
fn close_range_close_on_exec(first: libc::c_uint, last: libc::c_uint) -> io::Result<()> {
    let result = unsafe {
        libc::syscall(
            libc::SYS_close_range,
            first,
            last,
            libc::CLOSE_RANGE_CLOEXEC,
        )
    };
    if result != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn mark_listed_descriptors_close_on_exec(
    inheritance: &ChildDescriptorInheritance,
) -> io::Result<()> {
    let directory = unsafe {
        libc::open(
            c"/proc/self/fd".as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
        )
    };
    if directory < 0 {
        return Err(io::Error::last_os_error());
    }
    let result = mark_directory_listed_descriptors(inheritance, directory);
    unsafe {
        libc::close(directory);
    }
    result
}

#[cfg(target_os = "linux")]
fn mark_directory_listed_descriptors(
    inheritance: &ChildDescriptorInheritance,
    directory: RawFd,
) -> io::Result<()> {
    let mut buffer = [0_u64; 512];
    loop {
        let read = unsafe {
            libc::syscall(
                libc::SYS_getdents64,
                directory,
                buffer.as_mut_ptr(),
                std::mem::size_of_val(&buffer),
            )
        };
        if read < 0 {
            return Err(io::Error::last_os_error());
        }
        if read == 0 {
            return Ok(());
        }
        let entries =
            unsafe { std::slice::from_raw_parts(buffer.as_ptr().cast::<u8>(), read as usize) };
        mark_directory_entries(inheritance, directory, entries)?;
    }
}

#[cfg(target_os = "linux")]
fn mark_directory_entries(
    inheritance: &ChildDescriptorInheritance,
    directory: RawFd,
    entries: &[u8],
) -> io::Result<()> {
    let mut offset = 0;
    while offset < entries.len() {
        let Some(length_bytes) = entries.get(offset + 16..offset + 18) else {
            return Err(io::Error::from_raw_os_error(libc::EINVAL));
        };
        let record_length = u16::from_ne_bytes([length_bytes[0], length_bytes[1]]) as usize;
        let Some(name) =
            entries.get(offset + LINUX_DIRECTORY_ENTRY_NAME_OFFSET..offset + record_length)
        else {
            return Err(io::Error::from_raw_os_error(libc::EINVAL));
        };
        offset += record_length;
        let Some(descriptor) = parse_descriptor_name(name) else {
            continue;
        };
        if descriptor < FIRST_NON_STANDARD_DESCRIPTOR
            || descriptor == directory
            || inheritance.inherits(descriptor)
        {
            continue;
        }
        set_close_on_exec_if_open(descriptor)?;
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn parse_descriptor_name(name: &[u8]) -> Option<RawFd> {
    let digits = name.split(|byte| *byte == 0).next()?;
    if digits.is_empty() {
        return None;
    }
    digits.iter().try_fold(0 as RawFd, |value, byte| {
        if !byte.is_ascii_digit() {
            return None;
        }
        value.checked_mul(10)?.checked_add(RawFd::from(byte - b'0'))
    })
}

#[cfg(target_os = "macos")]
fn mark_range_close_on_exec(
    inheritance: &ChildDescriptorInheritance,
    first: RawFd,
    end: RawFd,
) -> io::Result<()> {
    (first..end)
        .filter(|descriptor| !inheritance.inherits(*descriptor))
        .try_for_each(set_close_on_exec_if_open)
}

fn set_close_on_exec_if_open(descriptor: RawFd) -> io::Result<()> {
    let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFD) };
    if flags < 0 {
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::EBADF) {
            return Ok(());
        }
        return Err(error);
    }
    if flags & libc::FD_CLOEXEC != 0 {
        return Ok(());
    }
    if unsafe { libc::fcntl(descriptor, libc::F_SETFD, flags | libc::FD_CLOEXEC) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn clear_close_on_exec(descriptor: RawFd) -> io::Result<()> {
    let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFD) };
    if flags < 0 {
        return Err(io::Error::last_os_error());
    }
    if flags & libc::FD_CLOEXEC == 0 {
        return Ok(());
    }
    if unsafe { libc::fcntl(descriptor, libc::F_SETFD, flags & !libc::FD_CLOEXEC) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::{
        os::fd::{FromRawFd, OwnedFd, RawFd},
        process::Command,
    };

    pub(crate) fn inheritable_pipe() -> (OwnedFd, OwnedFd) {
        let mut descriptors = [-1; 2];
        assert_eq!(unsafe { libc::pipe(descriptors.as_mut_ptr()) }, 0);
        for descriptor in descriptors {
            let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFD) };
            assert!(flags >= 0);
            assert_eq!(
                unsafe { libc::fcntl(descriptor, libc::F_SETFD, flags & !libc::FD_CLOEXEC) },
                0
            );
        }
        unsafe {
            (
                OwnedFd::from_raw_fd(descriptors[0]),
                OwnedFd::from_raw_fd(descriptors[1]),
            )
        }
    }

    pub(crate) fn close_on_exec(descriptor: RawFd) -> bool {
        let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFD) };
        assert!(flags >= 0, "descriptor {descriptor} must be open");
        flags & libc::FD_CLOEXEC != 0
    }

    pub(crate) fn probe_open_descriptors_command(descriptors: &[RawFd]) -> Command {
        let mut command = Command::new("/bin/sh");
        command
            .arg("-c")
            .arg(PROBE_SCRIPT)
            .arg("descriptor-probe")
            .args(descriptors.iter().map(RawFd::to_string));
        command
    }

    pub(crate) const PROBE_SCRIPT: &str =
        "for fd in \"$@\"; do if [ -e \"/dev/fd/$fd\" ]; then echo \"$fd\"; fi; done";

    pub(crate) fn reported_descriptors(stdout: &[u8]) -> Vec<RawFd> {
        String::from_utf8_lossy(stdout)
            .lines()
            .filter_map(|line| line.trim().parse().ok())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        restrict_child_descriptors, test_support, ChildDescriptorInheritance,
        MAX_INHERITED_CHILD_DESCRIPTORS,
    };
    use std::{
        fs,
        os::fd::{AsFd, AsRawFd, BorrowedFd, FromRawFd, OwnedFd},
        process::Stdio,
    };

    #[test]
    fn rejects_standard_streams_duplicates_and_over_limit_inheritance() {
        let file = fs::File::open("/dev/null").expect("open descriptor");
        let standard_input = unsafe { BorrowedFd::borrow_raw(0) };
        assert!(ChildDescriptorInheritance::exactly(&[standard_input]).is_err());
        assert!(ChildDescriptorInheritance::exactly(&[file.as_fd(), file.as_fd()]).is_err());
        let files = (0..=MAX_INHERITED_CHILD_DESCRIPTORS)
            .map(|_| fs::File::open("/dev/null").expect("open descriptor"))
            .collect::<Vec<_>>();
        let borrowed = files.iter().map(AsFd::as_fd).collect::<Vec<_>>();
        assert!(ChildDescriptorInheritance::exactly(&borrowed).is_err());
        assert!(
            ChildDescriptorInheritance::exactly(&borrowed[..MAX_INHERITED_CHILD_DESCRIPTORS])
                .is_ok()
        );
    }

    #[test]
    fn child_inherits_only_explicitly_mapped_descriptors() {
        let mapped = fs::File::open("/dev/null").expect("open mapped descriptor");
        let (stray_read, stray_write) = test_support::inheritable_pipe();
        let probed = [
            mapped.as_raw_fd(),
            stray_read.as_raw_fd(),
            stray_write.as_raw_fd(),
        ];

        let unrestricted = test_support::probe_open_descriptors_command(&probed)
            .stdin(Stdio::null())
            .output()
            .expect("unrestricted probe");
        assert!(unrestricted.status.success());
        let unrestricted = test_support::reported_descriptors(&unrestricted.stdout);
        assert!(unrestricted.contains(&stray_read.as_raw_fd()));
        assert!(unrestricted.contains(&stray_write.as_raw_fd()));
        assert!(!unrestricted.contains(&mapped.as_raw_fd()));

        let mut restricted = test_support::probe_open_descriptors_command(&probed);
        restricted.stdin(Stdio::null());
        restrict_child_descriptors(
            &mut restricted,
            ChildDescriptorInheritance::exactly(&[mapped.as_fd()]).expect("inheritance"),
        );
        let restricted = restricted.output().expect("restricted probe");
        assert!(restricted.status.success(), "{:?}", restricted.stderr);
        assert_eq!(
            test_support::reported_descriptors(&restricted.stdout),
            vec![mapped.as_raw_fd()]
        );
        assert!(test_support::close_on_exec(mapped.as_raw_fd()));
        assert!(!test_support::close_on_exec(stray_read.as_raw_fd()));
    }

    fn sparse_high_descriptor() -> OwnedFd {
        let mut limit = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        assert_eq!(
            unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) },
            0
        );
        let target = (limit.rlim_cur / 2).min(4_096) as libc::c_int;
        assert!(
            target >= 64,
            "descriptor limit {} is too small",
            limit.rlim_cur
        );
        let source = fs::File::open("/dev/null").expect("open descriptor");
        let high = unsafe { libc::fcntl(source.as_raw_fd(), libc::F_DUPFD, target) };
        assert!(high >= target, "{}", std::io::Error::last_os_error());
        unsafe { OwnedFd::from_raw_fd(high) }
    }

    #[test]
    fn restriction_covers_sparse_descriptors_above_the_initial_table() {
        let high = sparse_high_descriptor();
        let unrestricted = test_support::probe_open_descriptors_command(&[high.as_raw_fd()])
            .stdin(Stdio::null())
            .output()
            .expect("unrestricted probe");
        assert_eq!(
            test_support::reported_descriptors(&unrestricted.stdout),
            vec![high.as_raw_fd()]
        );
        let mut restricted = test_support::probe_open_descriptors_command(&[high.as_raw_fd()]);
        restricted.stdin(Stdio::null());
        restrict_child_descriptors(
            &mut restricted,
            ChildDescriptorInheritance::exactly(&[]).expect("inheritance"),
        );
        let output = restricted.output().expect("restricted probe");
        assert!(output.status.success());
        assert!(test_support::reported_descriptors(&output.stdout).is_empty());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn proc_listing_fallback_marks_every_unmapped_descriptor() {
        use std::os::unix::process::CommandExt;

        let mapped = fs::File::open("/dev/null").expect("open mapped descriptor");
        let high = sparse_high_descriptor();
        let (stray_read, stray_write) = test_support::inheritable_pipe();
        let probed = [
            mapped.as_raw_fd(),
            high.as_raw_fd(),
            stray_read.as_raw_fd(),
            stray_write.as_raw_fd(),
        ];
        let inheritance =
            ChildDescriptorInheritance::exactly(&[mapped.as_fd()]).expect("inheritance");
        let mut restricted = test_support::probe_open_descriptors_command(&probed);
        restricted.stdin(Stdio::null());
        unsafe {
            restricted.pre_exec(move || {
                super::mark_listed_descriptors_close_on_exec(&inheritance)?;
                super::clear_close_on_exec(mapped.as_raw_fd())
            });
        }
        let output = restricted.output().expect("restricted probe");
        assert!(output.status.success(), "{:?}", output.stderr);
        assert_eq!(
            test_support::reported_descriptors(&output.stdout),
            vec![probed[0]]
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn descriptor_names_parse_only_decimal_numbers() {
        assert_eq!(super::parse_descriptor_name(b"42\0\0"), Some(42));
        assert_eq!(super::parse_descriptor_name(b".\0"), None);
        assert_eq!(super::parse_descriptor_name(b"..\0"), None);
        assert_eq!(super::parse_descriptor_name(b"\0"), None);
        assert_eq!(super::parse_descriptor_name(b"99999999999\0"), None);
    }
}
