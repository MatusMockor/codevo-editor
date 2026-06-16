use crate::index::{
    SqliteWorkspaceIndex, WorkspaceFileRecord, WorkspaceFileSymbols,
    WorkspaceIndexMaintenanceStore, WorkspaceIndexStore, WorkspaceSymbolKind, WorkspaceSymbolRange,
    WorkspaceSymbolRecord, WorkspaceSymbolStore,
};
use crate::index_scan::{
    InitialMetadataScanStart, InitialMetadataScanStartStatus, LocalWorkspaceMetadataScanner,
    MetadataScanCompletionEvent, MetadataScanError, MetadataScanEventSink, MetadataScanReport,
    WorkspaceMetadataScanner, WorkspaceReindexMode,
};
use crate::php_parser::{PhpSyntaxParser, TreeSitterPhpParser};
use crate::php_symbols::{
    PhpSymbol, PhpSymbolExtractor, PhpSymbolKind, TreeSitterPhpSymbolExtractor,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    error::Error,
    fmt, fs, io,
    path::PathBuf,
    sync::Arc,
    thread,
};

pub trait WorkspaceReindexStarter {
    fn start(
        &self,
        request: WorkspaceReindexRequest,
        event_sink: Arc<dyn MetadataScanEventSink>,
    ) -> Result<InitialMetadataScanStart, WorkspaceReindexStartError>;
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct WorkspaceReindexRequest {
    pub database_path: PathBuf,
    pub language: Option<String>,
    pub mode: WorkspaceReindexMode,
    pub root_path: PathBuf,
}

pub struct LocalWorkspaceReindexStarter;

impl WorkspaceReindexStarter for LocalWorkspaceReindexStarter {
    fn start(
        &self,
        request: WorkspaceReindexRequest,
        event_sink: Arc<dyn MetadataScanEventSink>,
    ) -> Result<InitialMetadataScanStart, WorkspaceReindexStartError> {
        let root_path = request.root_path.clone();
        let database_path = request.database_path.clone();
        let thread_request = request.clone();

        thread::Builder::new()
            .name("workspace-reindex".to_string())
            .spawn(move || run_background_reindex(thread_request, event_sink))
            .map_err(WorkspaceReindexStartError::Spawn)?;

        Ok(InitialMetadataScanStart {
            database_path: database_path.to_string_lossy().to_string(),
            root_path: root_path.to_string_lossy().to_string(),
            status: InitialMetadataScanStartStatus::Started,
        })
    }
}

#[derive(Debug)]
pub enum WorkspaceReindexStartError {
    Spawn(io::Error),
}

impl fmt::Display for WorkspaceReindexStartError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Spawn(error) => write!(formatter, "failed to start workspace reindex: {error}"),
        }
    }
}

impl Error for WorkspaceReindexStartError {}

#[derive(Debug)]
pub enum WorkspaceReindexError {
    Io(io::Error),
    Parser(String),
    Store(rusqlite::Error),
    UnsupportedLanguage(String),
}

impl fmt::Display for WorkspaceReindexError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "workspace reindex IO failed: {error}"),
            Self::Parser(error) => write!(formatter, "workspace reindex parser failed: {error}"),
            Self::Store(error) => write!(formatter, "workspace reindex DB write failed: {error}"),
            Self::UnsupportedLanguage(language) => {
                write!(formatter, "unsupported reindex language: {language}")
            }
        }
    }
}

impl Error for WorkspaceReindexError {}

impl From<io::Error> for WorkspaceReindexError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<rusqlite::Error> for WorkspaceReindexError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Store(error)
    }
}

impl From<MetadataScanError> for WorkspaceReindexError {
    fn from(error: MetadataScanError) -> Self {
        match error {
            MetadataScanError::Io(error) => Self::Io(error),
            MetadataScanError::Store(error) => Self::Store(error),
        }
    }
}

pub(crate) fn run_workspace_reindex(
    request: &WorkspaceReindexRequest,
) -> Result<MetadataScanReport, WorkspaceReindexError> {
    let index = SqliteWorkspaceIndex::open(&request.database_path)?;
    let scanner = LocalWorkspaceMetadataScanner::default();
    let collection = scanner.collect_path(&request.root_path, &request.root_path)?;
    let mut report = collection.report;
    let scanned_records = collection.records;
    let existing_records = index.list_workspace_files()?;

    let removed_files = remove_missing_files(&index, &existing_records, &scanned_records)?;
    report.removed_files += removed_files;

    match request.mode {
        WorkspaceReindexMode::Hard => {
            index.clear_workspace_files()?;
            upsert_records(&index, &scanned_records)?;
            report.changed_files += scanned_records.len();
            parse_records(&index, &scanned_records, "php", &mut report)?;
        }
        WorkspaceReindexMode::Language => {
            let language = normalized_reindex_language(request.language.as_deref())?;
            upsert_records(&index, &scanned_records)?;
            index.clear_symbols_for_language(&language)?;
            let records = records_for_language(&scanned_records, &language);
            report.changed_files += records.len();
            parse_records(&index, &records, &language, &mut report)?;
        }
        WorkspaceReindexMode::Soft => {
            let changed_records = changed_records(&existing_records, &scanned_records);
            upsert_records(&index, &scanned_records)?;
            report.changed_files += changed_records.len();
            let php_records = records_for_language(&changed_records, "php");
            parse_records(&index, &php_records, "php", &mut report)?;
        }
    }

    Ok(report)
}

fn run_background_reindex(
    request: WorkspaceReindexRequest,
    event_sink: Arc<dyn MetadataScanEventSink>,
) {
    let event = match run_workspace_reindex(&request) {
        Ok(report) => MetadataScanCompletionEvent::completed(
            &request.root_path,
            &request.database_path,
            report,
        ),
        Err(error) => MetadataScanCompletionEvent::failed_message(
            &request.root_path,
            &request.database_path,
            error.to_string(),
        ),
    };

    event_sink.emit_completion(event);
}

fn normalized_reindex_language(language: Option<&str>) -> Result<String, WorkspaceReindexError> {
    let language = language.unwrap_or("php").trim().to_ascii_lowercase();

    if language == "php" {
        return Ok(language);
    }

    Err(WorkspaceReindexError::UnsupportedLanguage(language))
}

fn remove_missing_files(
    index: &SqliteWorkspaceIndex,
    existing_records: &[WorkspaceFileRecord],
    scanned_records: &[WorkspaceFileRecord],
) -> Result<usize, WorkspaceReindexError> {
    let scanned_paths: BTreeSet<String> = scanned_records
        .iter()
        .map(|record| record.path.clone())
        .collect();
    let mut removed = 0;

    for record in existing_records {
        if scanned_paths.contains(&record.path) {
            continue;
        }

        index.remove_file(&record.path)?;
        removed += 1;
    }

    Ok(removed)
}

fn upsert_records(
    index: &SqliteWorkspaceIndex,
    records: &[WorkspaceFileRecord],
) -> Result<(), WorkspaceReindexError> {
    for record in records {
        index.upsert_file(record)?;
    }

    Ok(())
}

fn changed_records(
    existing_records: &[WorkspaceFileRecord],
    scanned_records: &[WorkspaceFileRecord],
) -> Vec<WorkspaceFileRecord> {
    let existing_by_path: BTreeMap<String, WorkspaceFileRecord> = existing_records
        .iter()
        .map(|record| (record.path.clone(), record.clone()))
        .collect();

    scanned_records
        .iter()
        .filter(|record| match existing_by_path.get(&record.path) {
            Some(existing) => existing != *record,
            None => true,
        })
        .cloned()
        .collect()
}

fn records_for_language(
    records: &[WorkspaceFileRecord],
    language: &str,
) -> Vec<WorkspaceFileRecord> {
    records
        .iter()
        .filter(|record| record.language == language)
        .cloned()
        .collect()
}

fn parse_records(
    index: &SqliteWorkspaceIndex,
    records: &[WorkspaceFileRecord],
    language: &str,
    report: &mut MetadataScanReport,
) -> Result<(), WorkspaceReindexError> {
    if language != "php" {
        return Err(WorkspaceReindexError::UnsupportedLanguage(
            language.to_string(),
        ));
    }

    let mut parser = TreeSitterPhpParser::new()
        .map_err(|error| WorkspaceReindexError::Parser(error.to_string()))?;
    let extractor = TreeSitterPhpSymbolExtractor;

    for record in records {
        parse_record(index, record, &mut parser, &extractor, report);
    }

    Ok(())
}

fn parse_record(
    index: &SqliteWorkspaceIndex,
    record: &WorkspaceFileRecord,
    parser: &mut dyn PhpSyntaxParser,
    extractor: &dyn PhpSymbolExtractor,
    report: &mut MetadataScanReport,
) {
    let source = match fs::read_to_string(&record.path) {
        Ok(source) => source,
        Err(_) => {
            report.errored_entries += 1;
            return;
        }
    };
    let tree = match parser.parse(&source) {
        Ok(tree) => tree,
        Err(_) => {
            report.errored_entries += 1;
            return;
        }
    };
    let symbols = extractor.extract(&tree, &source);
    let symbols_indexed = symbols.len();
    let file_symbols = WorkspaceFileSymbols {
        file_path: record.path.clone(),
        relative_path: record.relative_path.clone(),
        symbols: symbols.into_iter().map(workspace_symbol_record).collect(),
    };

    if index.replace_file_symbols(&file_symbols).is_err() {
        report.errored_entries += 1;
        return;
    }

    report.parsed_files += 1;
    report.symbols_indexed += symbols_indexed;
}

fn workspace_symbol_record(symbol: PhpSymbol) -> WorkspaceSymbolRecord {
    WorkspaceSymbolRecord {
        container_name: symbol.container_name,
        fully_qualified_name: symbol.fully_qualified_name,
        kind: workspace_symbol_kind(symbol.kind),
        name: symbol.name,
        range: WorkspaceSymbolRange {
            end_byte: symbol.range.end_byte as i64,
            end_column: symbol.range.end_column as i64,
            end_line: symbol.range.end_line as i64,
            start_byte: symbol.range.start_byte as i64,
            start_column: symbol.range.start_column as i64,
            start_line: symbol.range.start_line as i64,
        },
    }
}

fn workspace_symbol_kind(kind: PhpSymbolKind) -> WorkspaceSymbolKind {
    match kind {
        PhpSymbolKind::Class => WorkspaceSymbolKind::Class,
        PhpSymbolKind::Constant => WorkspaceSymbolKind::Constant,
        PhpSymbolKind::Enum => WorkspaceSymbolKind::Enum,
        PhpSymbolKind::Function => WorkspaceSymbolKind::Function,
        PhpSymbolKind::Interface => WorkspaceSymbolKind::Interface,
        PhpSymbolKind::Method => WorkspaceSymbolKind::Method,
        PhpSymbolKind::Trait => WorkspaceSymbolKind::Trait,
    }
}

#[cfg(test)]
mod tests {
    use super::{run_workspace_reindex, WorkspaceReindexRequest};
    use crate::index::{SqliteWorkspaceIndex, WorkspaceIndexStore, WorkspaceSymbolStore};
    use crate::index_scan::WorkspaceReindexMode;
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn soft_reindex_indexes_symbols_for_new_php_files() {
        let root = temp_workspace("soft");
        let database_path = temp_database_path("soft");
        fs::create_dir_all(root.join("src")).expect("src dir");
        fs::write(root.join("src/User.php"), php_fixture("User")).expect("php file");

        let report = run_workspace_reindex(&WorkspaceReindexRequest {
            database_path: database_path.clone(),
            language: None,
            mode: WorkspaceReindexMode::Soft,
            root_path: root.clone(),
        })
        .expect("soft reindex");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        let symbols = index
            .list_file_symbols(&path_string(root.join("src/User.php")))
            .expect("symbols");

        assert_eq!(report.indexed_files, 1);
        assert_eq!(report.changed_files, 1);
        assert_eq!(report.parsed_files, 1);
        assert_eq!(symbols[0].fully_qualified_name, "App\\User");
    }

    #[test]
    fn language_reindex_reparses_unchanged_php_files() {
        let root = temp_workspace("language");
        let database_path = temp_database_path("language");
        fs::write(root.join("User.php"), php_fixture("User")).expect("php file");

        run_workspace_reindex(&WorkspaceReindexRequest {
            database_path: database_path.clone(),
            language: None,
            mode: WorkspaceReindexMode::Soft,
            root_path: root.clone(),
        })
        .expect("seed reindex");
        let report = run_workspace_reindex(&WorkspaceReindexRequest {
            database_path: database_path.clone(),
            language: Some("php".to_string()),
            mode: WorkspaceReindexMode::Language,
            root_path: root.clone(),
        })
        .expect("language reindex");

        assert_eq!(report.changed_files, 1);
        assert_eq!(report.parsed_files, 1);
    }

    #[test]
    fn hard_reindex_removes_deleted_files_and_rebuilds_symbols() {
        let root = temp_workspace("hard");
        let database_path = temp_database_path("hard");
        fs::write(root.join("User.php"), php_fixture("User")).expect("php file");
        run_workspace_reindex(&WorkspaceReindexRequest {
            database_path: database_path.clone(),
            language: None,
            mode: WorkspaceReindexMode::Soft,
            root_path: root.clone(),
        })
        .expect("seed reindex");
        fs::remove_file(root.join("User.php")).expect("remove php file");

        let report = run_workspace_reindex(&WorkspaceReindexRequest {
            database_path: database_path.clone(),
            language: None,
            mode: WorkspaceReindexMode::Hard,
            root_path: root.clone(),
        })
        .expect("hard reindex");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");

        assert_eq!(report.removed_files, 1);
        assert_eq!(index.summary().expect("summary").file_count, 0);
    }

    #[test]
    fn hard_reindex_does_not_count_rebuilt_files_as_removed() {
        let root = temp_workspace("hard-rebuild-count");
        let database_path = temp_database_path("hard-rebuild-count");
        fs::write(root.join("User.php"), php_fixture("User")).expect("php file");
        run_workspace_reindex(&WorkspaceReindexRequest {
            database_path: database_path.clone(),
            language: None,
            mode: WorkspaceReindexMode::Soft,
            root_path: root.clone(),
        })
        .expect("seed reindex");

        let report = run_workspace_reindex(&WorkspaceReindexRequest {
            database_path,
            language: None,
            mode: WorkspaceReindexMode::Hard,
            root_path: root,
        })
        .expect("hard reindex");

        assert_eq!(report.removed_files, 0);
        assert_eq!(report.changed_files, 1);
        assert_eq!(report.parsed_files, 1);
    }

    #[test]
    fn language_reindex_rejects_unsupported_languages() {
        let root = temp_workspace("unsupported-language");
        let database_path = temp_database_path("unsupported-language");

        let error = run_workspace_reindex(&WorkspaceReindexRequest {
            database_path,
            language: Some("typescript".to_string()),
            mode: WorkspaceReindexMode::Language,
            root_path: root,
        })
        .expect_err("unsupported language");

        assert!(error.to_string().contains("unsupported reindex language"));
    }

    fn temp_workspace(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("editor-reindex-{label}-{}", unique_suffix()));
        fs::create_dir_all(&root).expect("temp workspace");
        root.canonicalize().expect("canonical root")
    }

    fn temp_database_path(label: &str) -> PathBuf {
        let directory =
            std::env::temp_dir().join(format!("editor-reindex-db-{label}-{}", unique_suffix()));
        fs::create_dir_all(&directory).expect("temp db dir");
        directory.join("workspace.sqlite3")
    }

    fn unique_suffix() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos()
    }

    fn php_fixture(class_name: &str) -> String {
        format!(
            "<?php\nnamespace App;\nfinal class {class_name} {{\n    public function name(): string {{ return 'name'; }}\n}}\n"
        )
    }

    fn path_string(path: PathBuf) -> String {
        path.to_string_lossy().to_string()
    }
}
