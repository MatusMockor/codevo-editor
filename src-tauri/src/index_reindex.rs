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
use crate::job_scheduler::WorkspaceIndexLifecycleToken;
use crate::js_ts_symbols::{
    workspace_symbol_record as js_ts_workspace_symbol_record, JsTsSymbolExtractor,
    TextJsTsSymbolExtractor,
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

#[derive(Debug, Clone)]
pub struct WorkspaceReindexRequest {
    pub database_path: PathBuf,
    pub language: Option<String>,
    pub lifecycle_token: Option<WorkspaceIndexLifecycleToken>,
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
    Cancelled,
    Io(io::Error),
    Parser(String),
    Store(rusqlite::Error),
    UnsupportedLanguage(String),
}

impl fmt::Display for WorkspaceReindexError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cancelled => write!(formatter, "workspace reindex cancelled"),
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
            MetadataScanError::Cancelled => Self::Cancelled,
            MetadataScanError::Io(error) => Self::Io(error),
            MetadataScanError::Store(error) => Self::Store(error),
        }
    }
}

pub(crate) fn run_workspace_reindex(
    request: &WorkspaceReindexRequest,
) -> Result<MetadataScanReport, WorkspaceReindexError> {
    let lifecycle_token = request.lifecycle_token.as_ref();
    ensure_reindex_current(lifecycle_token)?;
    let index = SqliteWorkspaceIndex::open(&request.database_path)?;
    let scanner = LocalWorkspaceMetadataScanner::default();
    let collection = scanner.collect_path(&request.root_path, &request.root_path)?;
    ensure_reindex_current(lifecycle_token)?;
    let mut report = collection.report;
    let scanned_records = collection.records;
    let existing_records = index.list_workspace_files()?;

    let removed_files =
        remove_missing_files(&index, lifecycle_token, &existing_records, &scanned_records)?;
    report.removed_files += removed_files;

    match request.mode {
        WorkspaceReindexMode::Hard => {
            guarded_reindex_write(lifecycle_token, || index.clear_workspace_files())?;
            upsert_records(&index, lifecycle_token, &scanned_records)?;
            report.changed_files += scanned_records.len();
            let php_records = records_for_language(&scanned_records, "php");
            let javascript_records = records_for_language(&scanned_records, "javascript");
            let typescript_records = records_for_language(&scanned_records, "typescript");
            parse_records(&index, lifecycle_token, &php_records, "php", &mut report)?;
            parse_records(
                &index,
                lifecycle_token,
                &javascript_records,
                "javascript",
                &mut report,
            )?;
            parse_records(
                &index,
                lifecycle_token,
                &typescript_records,
                "typescript",
                &mut report,
            )?;
        }
        WorkspaceReindexMode::Language => {
            let language = normalized_reindex_language(request.language.as_deref())?;
            upsert_records(&index, lifecycle_token, &scanned_records)?;
            guarded_reindex_write(lifecycle_token, || {
                index.clear_symbols_for_language(&language)
            })?;
            let records = records_for_language(&scanned_records, &language);
            report.changed_files += records.len();
            parse_records(&index, lifecycle_token, &records, &language, &mut report)?;
        }
        WorkspaceReindexMode::Soft => {
            let changed_records = changed_records(&existing_records, &scanned_records);
            let records_to_parse = soft_parse_records(&index, &changed_records, &scanned_records)?;
            upsert_records(&index, lifecycle_token, &scanned_records)?;
            report.changed_files += changed_records.len();
            let php_records = records_for_language(&records_to_parse, "php");
            let javascript_records = records_for_language(&records_to_parse, "javascript");
            let typescript_records = records_for_language(&records_to_parse, "typescript");
            parse_records(&index, lifecycle_token, &php_records, "php", &mut report)?;
            parse_records(
                &index,
                lifecycle_token,
                &javascript_records,
                "javascript",
                &mut report,
            )?;
            parse_records(
                &index,
                lifecycle_token,
                &typescript_records,
                "typescript",
                &mut report,
            )?;
        }
    }

    Ok(report)
}

fn run_background_reindex(
    request: WorkspaceReindexRequest,
    event_sink: Arc<dyn MetadataScanEventSink>,
) {
    let event = match run_workspace_reindex(&request) {
        Ok(report) => {
            if !lifecycle_token_is_current(request.lifecycle_token.as_ref()) {
                return;
            }

            MetadataScanCompletionEvent::completed(
                &request.root_path,
                &request.database_path,
                report,
            )
        }
        Err(WorkspaceReindexError::Cancelled) => return,
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

    if matches!(language.as_str(), "php" | "javascript" | "typescript") {
        return Ok(language);
    }

    Err(WorkspaceReindexError::UnsupportedLanguage(language))
}

fn ensure_reindex_current(
    lifecycle_token: Option<&WorkspaceIndexLifecycleToken>,
) -> Result<(), WorkspaceReindexError> {
    if lifecycle_token_is_current(lifecycle_token) {
        return Ok(());
    }

    Err(WorkspaceReindexError::Cancelled)
}

fn lifecycle_token_is_current(lifecycle_token: Option<&WorkspaceIndexLifecycleToken>) -> bool {
    match lifecycle_token {
        Some(token) => token.is_current(),
        None => true,
    }
}

fn guarded_reindex_write<T>(
    lifecycle_token: Option<&WorkspaceIndexLifecycleToken>,
    action: impl FnOnce() -> rusqlite::Result<T>,
) -> Result<T, WorkspaceReindexError> {
    match lifecycle_token {
        Some(token) => match token.run_if_current(action) {
            Some(result) => result.map_err(WorkspaceReindexError::Store),
            None => Err(WorkspaceReindexError::Cancelled),
        },
        None => action().map_err(WorkspaceReindexError::Store),
    }
}

fn remove_missing_files(
    index: &SqliteWorkspaceIndex,
    lifecycle_token: Option<&WorkspaceIndexLifecycleToken>,
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

        guarded_reindex_write(lifecycle_token, || index.remove_file(&record.path))?;
        removed += 1;
    }

    Ok(removed)
}

fn upsert_records(
    index: &SqliteWorkspaceIndex,
    lifecycle_token: Option<&WorkspaceIndexLifecycleToken>,
    records: &[WorkspaceFileRecord],
) -> Result<(), WorkspaceReindexError> {
    for record in records {
        guarded_reindex_write(lifecycle_token, || index.upsert_file(record))?;
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

fn soft_parse_records(
    index: &SqliteWorkspaceIndex,
    changed_records: &[WorkspaceFileRecord],
    scanned_records: &[WorkspaceFileRecord],
) -> Result<Vec<WorkspaceFileRecord>, WorkspaceReindexError> {
    let mut parse_records = changed_records.to_vec();
    let mut parse_paths: BTreeSet<String> = changed_records
        .iter()
        .map(|record| record.path.clone())
        .collect();

    for record in scanned_records {
        if parse_paths.contains(&record.path) || !is_symbol_indexed_language(&record.language) {
            continue;
        }

        if index.list_file_symbols(&record.path)?.is_empty() {
            parse_paths.insert(record.path.clone());
            parse_records.push(record.clone());
        }
    }

    Ok(parse_records)
}

fn is_symbol_indexed_language(language: &str) -> bool {
    matches!(language, "php" | "javascript" | "typescript")
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
    lifecycle_token: Option<&WorkspaceIndexLifecycleToken>,
    records: &[WorkspaceFileRecord],
    language: &str,
    report: &mut MetadataScanReport,
) -> Result<(), WorkspaceReindexError> {
    if language == "javascript" || language == "typescript" {
        let extractor = TextJsTsSymbolExtractor;

        for record in records {
            parse_js_ts_record(index, lifecycle_token, record, &extractor, report)?;
        }

        return Ok(());
    }

    if language != "php" {
        return Err(WorkspaceReindexError::UnsupportedLanguage(
            language.to_string(),
        ));
    }

    let mut parser = TreeSitterPhpParser::new()
        .map_err(|error| WorkspaceReindexError::Parser(error.to_string()))?;
    let extractor = TreeSitterPhpSymbolExtractor;

    for record in records {
        parse_record(
            index,
            lifecycle_token,
            record,
            &mut parser,
            &extractor,
            report,
        )?;
    }

    Ok(())
}

fn parse_js_ts_record(
    index: &SqliteWorkspaceIndex,
    lifecycle_token: Option<&WorkspaceIndexLifecycleToken>,
    record: &WorkspaceFileRecord,
    extractor: &dyn JsTsSymbolExtractor,
    report: &mut MetadataScanReport,
) -> Result<(), WorkspaceReindexError> {
    let source = match fs::read_to_string(&record.path) {
        Ok(source) => source,
        Err(_) => {
            report.record_error(
                record.relative_path.clone(),
                "JavaScript/TypeScript source could not be read.",
            );
            return Ok(());
        }
    };
    let symbols = extractor.extract(&source);
    let symbols_indexed = symbols.len();
    let file_symbols = WorkspaceFileSymbols {
        file_path: record.path.clone(),
        relative_path: record.relative_path.clone(),
        symbols: symbols
            .into_iter()
            .map(js_ts_workspace_symbol_record)
            .collect(),
    };

    match guarded_reindex_write(lifecycle_token, || {
        index.replace_file_symbols(&file_symbols)
    }) {
        Ok(()) => {}
        Err(WorkspaceReindexError::Store(_)) => {
            report.record_error(
                record.relative_path.clone(),
                "JavaScript/TypeScript symbols could not be written.",
            );
            return Ok(());
        }
        Err(error) => return Err(error),
    }

    report.parsed_files += 1;
    report.symbols_indexed += symbols_indexed;

    Ok(())
}

fn parse_record(
    index: &SqliteWorkspaceIndex,
    lifecycle_token: Option<&WorkspaceIndexLifecycleToken>,
    record: &WorkspaceFileRecord,
    parser: &mut dyn PhpSyntaxParser,
    extractor: &dyn PhpSymbolExtractor,
    report: &mut MetadataScanReport,
) -> Result<(), WorkspaceReindexError> {
    let source = match fs::read_to_string(&record.path) {
        Ok(source) => source,
        Err(_) => {
            report.record_error(
                record.relative_path.clone(),
                "PHP source could not be read.",
            );
            return Ok(());
        }
    };
    let tree = match parser.parse(&source) {
        Ok(tree) => tree,
        Err(_) => {
            report.record_error(
                record.relative_path.clone(),
                "PHP source could not be parsed.",
            );
            return Ok(());
        }
    };
    let symbols = extractor.extract(&tree, &source);
    let symbols_indexed = symbols.len();
    let file_symbols = WorkspaceFileSymbols {
        file_path: record.path.clone(),
        relative_path: record.relative_path.clone(),
        symbols: symbols.into_iter().map(workspace_symbol_record).collect(),
    };

    match guarded_reindex_write(lifecycle_token, || {
        index.replace_file_symbols(&file_symbols)
    }) {
        Ok(()) => {}
        Err(WorkspaceReindexError::Store(_)) => {
            report.record_error(
                record.relative_path.clone(),
                "PHP symbols could not be written.",
            );
            return Ok(());
        }
        Err(error) => return Err(error),
    }

    report.parsed_files += 1;
    report.symbols_indexed += symbols_indexed;

    Ok(())
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
        PhpSymbolKind::Property => WorkspaceSymbolKind::Property,
        PhpSymbolKind::Trait => WorkspaceSymbolKind::Trait,
    }
}

#[cfg(test)]
mod tests {
    use super::{run_workspace_reindex, WorkspaceReindexError, WorkspaceReindexRequest};
    use crate::index::{
        SqliteWorkspaceIndex, WorkspaceIndexMaintenanceStore, WorkspaceIndexStore,
        WorkspaceSymbolSearchStore, WorkspaceSymbolStore,
    };
    use crate::index_scan::WorkspaceReindexMode;
    use crate::job_scheduler::WorkspaceIndexLifecycle;
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
            lifecycle_token: None,
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
    fn soft_reindex_repairs_unchanged_php_files_missing_symbols() {
        let root = temp_workspace("soft-missing-symbols");
        let database_path = temp_database_path("soft-missing-symbols");
        let user_path = root.join("src/User.php");
        fs::create_dir_all(root.join("src")).expect("src dir");
        fs::write(&user_path, php_fixture("User")).expect("php file");

        run_workspace_reindex(&WorkspaceReindexRequest {
            database_path: database_path.clone(),
            language: None,
            lifecycle_token: None,
            mode: WorkspaceReindexMode::Soft,
            root_path: root.clone(),
        })
        .expect("seed reindex");

        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        index
            .clear_symbols_for_language("php")
            .expect("clear php symbols");
        assert!(index
            .list_file_symbols(&path_string(user_path.clone()))
            .expect("empty symbols")
            .is_empty());

        let report = run_workspace_reindex(&WorkspaceReindexRequest {
            database_path: database_path.clone(),
            language: None,
            lifecycle_token: None,
            mode: WorkspaceReindexMode::Soft,
            root_path: root.clone(),
        })
        .expect("repair reindex");
        let repaired_index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        let symbols = repaired_index
            .list_file_symbols(&path_string(user_path))
            .expect("symbols");
        let results = repaired_index
            .search_project_symbols("User", 10)
            .expect("symbol search");

        assert_eq!(report.changed_files, 0);
        assert_eq!(report.parsed_files, 1);
        assert!(report.symbols_indexed > 0);
        assert!(symbols
            .iter()
            .any(|symbol| symbol.fully_qualified_name == "App\\User"));
        assert!(results
            .iter()
            .any(|symbol| symbol.fully_qualified_name == "App\\User"));
    }

    #[test]
    fn language_reindex_reparses_unchanged_php_files() {
        let root = temp_workspace("language");
        let database_path = temp_database_path("language");
        fs::write(root.join("User.php"), php_fixture("User")).expect("php file");

        run_workspace_reindex(&WorkspaceReindexRequest {
            database_path: database_path.clone(),
            language: None,
            lifecycle_token: None,
            mode: WorkspaceReindexMode::Soft,
            root_path: root.clone(),
        })
        .expect("seed reindex");
        let report = run_workspace_reindex(&WorkspaceReindexRequest {
            database_path: database_path.clone(),
            language: Some("php".to_string()),
            lifecycle_token: None,
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
            lifecycle_token: None,
            mode: WorkspaceReindexMode::Soft,
            root_path: root.clone(),
        })
        .expect("seed reindex");
        fs::remove_file(root.join("User.php")).expect("remove php file");

        let report = run_workspace_reindex(&WorkspaceReindexRequest {
            database_path: database_path.clone(),
            language: None,
            lifecycle_token: None,
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
            lifecycle_token: None,
            mode: WorkspaceReindexMode::Soft,
            root_path: root.clone(),
        })
        .expect("seed reindex");

        let report = run_workspace_reindex(&WorkspaceReindexRequest {
            database_path,
            language: None,
            lifecycle_token: None,
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
            language: Some("ruby".to_string()),
            lifecycle_token: None,
            mode: WorkspaceReindexMode::Language,
            root_path: root,
        })
        .expect_err("unsupported language");

        assert!(error.to_string().contains("unsupported reindex language"));
    }

    #[test]
    fn cancelled_reindex_does_not_repopulate_cleared_index() {
        let root = temp_workspace("cancelled-reindex");
        let database_path = temp_database_path("cancelled-reindex");
        fs::write(root.join("User.php"), php_fixture("User")).expect("php file");
        let lifecycle = WorkspaceIndexLifecycle::new();
        let token = lifecycle.begin_workspace_run(&path_string(root.clone()));

        lifecycle.cancel_workspace_and_block_writes(token.workspace_root(), || {
            let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
            index.clear_workspace_files().expect("clear index");
        });

        let error = run_workspace_reindex(&WorkspaceReindexRequest {
            database_path: database_path.clone(),
            language: None,
            lifecycle_token: Some(token),
            mode: WorkspaceReindexMode::Soft,
            root_path: root,
        })
        .expect_err("cancelled reindex");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");

        assert!(matches!(error, WorkspaceReindexError::Cancelled));
        assert_eq!(index.summary().expect("summary").file_count, 0);
    }

    #[test]
    fn soft_reindex_indexes_typescript_symbols() {
        let root = temp_workspace("typescript");
        let database_path = temp_database_path("typescript");
        fs::create_dir_all(root.join("src")).expect("src dir");
        fs::write(
            root.join("src/userService.ts"),
            "export class UserService {\n  findUser() {}\n}\nexport const createUser = () => null;\n",
        )
        .expect("typescript file");

        let report = run_workspace_reindex(&WorkspaceReindexRequest {
            database_path: database_path.clone(),
            language: None,
            lifecycle_token: None,
            mode: WorkspaceReindexMode::Soft,
            root_path: root.clone(),
        })
        .expect("soft reindex");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        let symbols = index
            .list_file_symbols(&path_string(root.join("src/userService.ts")))
            .expect("symbols");
        let names: Vec<String> = symbols
            .into_iter()
            .map(|symbol| symbol.fully_qualified_name)
            .collect();

        assert_eq!(report.parsed_files, 1);
        assert!(names.contains(&"UserService".to_string()));
        assert!(names.contains(&"UserService.findUser".to_string()));
        assert!(names.contains(&"createUser".to_string()));
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
