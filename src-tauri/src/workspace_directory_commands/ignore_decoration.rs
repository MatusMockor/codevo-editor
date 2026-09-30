use ignore::{
    gitignore::{Gitignore, GitignoreBuilder},
    Match,
};
use std::{
    ffi::OsStr,
    fs::File,
    io::{self, Read},
    path::{Component, Path, PathBuf},
};

pub const GITIGNORE_BYTE_LIMIT: u64 = 256 * 1024;
pub const GITIGNORE_LINE_LIMIT: usize = 4_096;
pub const GITIGNORE_ANCESTOR_LIMIT: usize = 64;

const VIRTUAL_WORKSPACE_ROOT: &str = "/workspace";
const GIT_INFO_EXCLUDE: &str = ".git/info/exclude";
const GITIGNORE: &str = ".gitignore";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PatternCase {
    Sensitive,
    Insensitive,
}

pub trait IgnoreRuleFiles {
    fn open(&self, relative_path: &Path) -> io::Result<File>;
    fn pattern_case(&self) -> PatternCase;
}

pub enum DirectoryIgnoreRules {
    Unavailable,
    DirectoryIgnored,
    Scoped {
        directory: PathBuf,
        scopes: Vec<Gitignore>,
    },
}

impl DirectoryIgnoreRules {
    pub fn load(files: &dyn IgnoreRuleFiles, relative_directory: &Path) -> Self {
        load_rules(files, relative_directory).unwrap_or(Self::Unavailable)
    }

    pub fn is_ignored(&self, name: &str, is_directory: bool) -> bool {
        match self {
            Self::Unavailable => false,
            Self::DirectoryIgnored => true,
            Self::Scoped { directory, scopes } => {
                is_matched(scopes, &directory.join(name), is_directory)
            }
        }
    }
}

fn load_rules(
    files: &dyn IgnoreRuleFiles,
    relative_directory: &Path,
) -> io::Result<DirectoryIgnoreRules> {
    let components = normal_components(relative_directory)?;
    if components.len() > GITIGNORE_ANCESTOR_LIMIT {
        return Ok(DirectoryIgnoreRules::Unavailable);
    }
    let root = PathBuf::from(VIRTUAL_WORKSPACE_ROOT);
    let mut collector = RuleCollector {
        files,
        case: files.pattern_case(),
        remaining_lines: GITIGNORE_LINE_LIMIT,
        scopes: Vec::with_capacity(components.len() + 2),
    };
    collector.push(&root, Path::new(GIT_INFO_EXCLUDE))?;
    collector.push(&root, Path::new(GITIGNORE))?;
    let mut relative = PathBuf::new();
    for component in components {
        relative.push(component);
        let directory = root.join(&relative);
        if is_matched(&collector.scopes, &directory, true) {
            return Ok(DirectoryIgnoreRules::DirectoryIgnored);
        }
        collector.push(&directory, &relative.join(GITIGNORE))?;
    }
    Ok(DirectoryIgnoreRules::Scoped {
        directory: root.join(relative),
        scopes: collector.scopes,
    })
}

fn normal_components(path: &Path) -> io::Result<Vec<&OsStr>> {
    path.components()
        .map(|component| match component {
            Component::Normal(name) => Ok(name),
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "ignore rules require a normalized workspace-relative directory",
            )),
        })
        .collect()
}

struct RuleCollector<'a> {
    files: &'a dyn IgnoreRuleFiles,
    case: PatternCase,
    remaining_lines: usize,
    scopes: Vec<Gitignore>,
}

impl RuleCollector<'_> {
    fn push(&mut self, scope_root: &Path, relative_file: &Path) -> io::Result<()> {
        let Some(content) = read_rule_file(self.files, relative_file)? else {
            return Ok(());
        };
        let mut builder = GitignoreBuilder::new(scope_root);
        builder
            .case_insensitive(self.case == PatternCase::Insensitive)
            .map_err(invalid_rules)?;
        for line in content.lines() {
            if self.remaining_lines == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "ignore rules exceed the line limit",
                ));
            }
            self.remaining_lines -= 1;
            let _ = builder.add_line(None, line);
        }
        self.scopes.push(builder.build().map_err(invalid_rules)?);
        Ok(())
    }
}

fn invalid_rules(error: ignore::Error) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, error.to_string())
}

fn read_rule_file(files: &dyn IgnoreRuleFiles, relative_file: &Path) -> io::Result<Option<String>> {
    let file = match files.open(relative_file) {
        Ok(file) => file,
        Err(error) if is_absent(&error) => return Ok(None),
        Err(error) => return Err(error),
    };
    let mut bytes = Vec::new();
    file.take(GITIGNORE_BYTE_LIMIT + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > GITIGNORE_BYTE_LIMIT {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "ignore rule file exceeds byte limit",
        ));
    }
    Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
}

fn is_absent(error: &io::Error) -> bool {
    if matches!(
        error.kind(),
        io::ErrorKind::NotFound | io::ErrorKind::InvalidInput
    ) {
        return true;
    }
    matches!(
        error.raw_os_error(),
        Some(libc::ENOTDIR) | Some(libc::ELOOP) | Some(libc::EISDIR)
    )
}

fn is_matched(scopes: &[Gitignore], path: &Path, is_directory: bool) -> bool {
    for scope in scopes.iter().rev() {
        match scope.matched(path, is_directory) {
            Match::Ignore(_) => return true,
            Match::Whitelist(_) => return false,
            Match::None => {}
        }
    }
    false
}
