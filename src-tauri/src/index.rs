use crate::job_scheduler::{
    IndexCommitGate, IndexCommitPermission, IndexCommitScope, IndexDbWriteOperation,
    IndexFileMetadata, IndexFileSymbols, IndexSymbolKind, IndexSymbolRange, IndexSymbolRecord,
};
use crate::php_file_outline::{
    build_php_file_outline, PhpFileOutline, PhpFileOutlineNodeKind, PhpFileOutlineSymbolRecord,
};
use crate::php_tree::{build_php_tree, PhpTree, PhpTreeNodeKind, PhpTreeSymbolRecord};
use rusqlite::{params, types::Type, Connection};
use serde::{Deserialize, Serialize};
use std::{
    error::Error,
    fmt, fs,
    path::{Path, PathBuf},
    time::Duration,
};

const CURRENT_SCHEMA_VERSION: i64 = 2;
const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexSummary {
    pub database_path: String,
    pub file_count: i64,
    pub schema_version: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileRecord {
    pub path: String,
    pub relative_path: String,
    pub language: String,
    pub size_bytes: i64,
    pub modified_at_unix: i64,
}

pub trait WorkspaceIndexStore {
    fn remove_file(&self, path: &str) -> rusqlite::Result<()>;
    fn summary(&self) -> rusqlite::Result<WorkspaceIndexSummary>;
    fn upsert_file(&self, record: &WorkspaceFileRecord) -> rusqlite::Result<()>;
}

pub trait WorkspaceIndexMaintenanceStore {
    fn clear_workspace_files(&self) -> rusqlite::Result<usize>;
    fn clear_symbols_for_language(&self, language: &str) -> rusqlite::Result<usize>;
    fn list_workspace_files(&self) -> rusqlite::Result<Vec<WorkspaceFileRecord>>;
}

pub trait WorkspaceSymbolStore {
    fn list_file_symbols(&self, file_path: &str) -> rusqlite::Result<Vec<WorkspaceSymbolRecord>>;
    fn replace_file_symbols(&self, file_symbols: &WorkspaceFileSymbols) -> rusqlite::Result<()>;
}

pub trait WorkspaceIndexWriteStore: WorkspaceIndexStore + WorkspaceSymbolStore {}

impl<T: WorkspaceIndexStore + WorkspaceSymbolStore> WorkspaceIndexWriteStore for T {}

pub trait WorkspaceSymbolSearchStore {
    fn search_project_symbols(
        &self,
        query: &str,
        limit: usize,
    ) -> rusqlite::Result<Vec<ProjectSymbolSearchResult>>;
}

pub trait WorkspacePhpTreeStore {
    fn load_php_tree(&self) -> rusqlite::Result<PhpTree>;
}

pub trait WorkspacePhpFileOutlineStore {
    fn load_php_file_outline(&self, file_path: &str) -> rusqlite::Result<PhpFileOutline>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceFileSymbols {
    pub file_path: String,
    pub relative_path: String,
    pub symbols: Vec<WorkspaceSymbolRecord>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceSymbolRecord {
    pub container_name: Option<String>,
    pub fully_qualified_name: String,
    pub kind: WorkspaceSymbolKind,
    pub name: String,
    pub range: WorkspaceSymbolRange,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceSymbolKind {
    Class,
    Constant,
    Enum,
    Function,
    Interface,
    Method,
    Property,
    Trait,
}

impl WorkspaceSymbolKind {
    fn as_storage_value(self) -> &'static str {
        match self {
            Self::Class => "class",
            Self::Constant => "constant",
            Self::Enum => "enum",
            Self::Function => "function",
            Self::Interface => "interface",
            Self::Method => "method",
            Self::Property => "property",
            Self::Trait => "trait",
        }
    }

    fn from_storage_value(value: &str) -> Option<Self> {
        match value {
            "class" => Some(Self::Class),
            "constant" => Some(Self::Constant),
            "enum" => Some(Self::Enum),
            "function" => Some(Self::Function),
            "interface" => Some(Self::Interface),
            "method" => Some(Self::Method),
            "property" => Some(Self::Property),
            "trait" => Some(Self::Trait),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceSymbolRange {
    pub end_byte: i64,
    pub end_column: i64,
    pub end_line: i64,
    pub start_byte: i64,
    pub start_column: i64,
    pub start_line: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSymbolSearchResult {
    pub column: i64,
    pub container_name: Option<String>,
    pub fully_qualified_name: String,
    pub kind: WorkspaceSymbolKind,
    pub line_number: i64,
    pub name: String,
    pub path: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum IndexCommitOutcome {
    Committed,
    SkippedCancelled,
    SkippedStale,
}

pub fn commit_index_db_write(
    store: &dyn WorkspaceIndexWriteStore,
    gate: &dyn IndexCommitGate,
    scope: &IndexCommitScope,
    operation: &IndexDbWriteOperation,
) -> rusqlite::Result<IndexCommitOutcome> {
    match gate.check(scope) {
        IndexCommitPermission::Cancelled => Ok(IndexCommitOutcome::SkippedCancelled),
        IndexCommitPermission::Stale => Ok(IndexCommitOutcome::SkippedStale),
        IndexCommitPermission::Current => {
            apply_index_db_write(store, operation)?;
            Ok(IndexCommitOutcome::Committed)
        }
    }
}

pub struct SqliteWorkspaceIndex {
    connection: Connection,
    database_path: PathBuf,
}

impl SqliteWorkspaceIndex {
    pub fn open(database_path: &Path) -> rusqlite::Result<Self> {
        if let Some(parent) = database_path.parent() {
            fs::create_dir_all(parent).map_err(to_sqlite_error)?;
        }

        let connection = Connection::open(database_path)?;
        configure_connection(&connection)?;
        apply_migrations(&connection)?;

        Ok(Self {
            connection,
            database_path: database_path.to_path_buf(),
        })
    }

    #[cfg(test)]
    fn connection(&self) -> &Connection {
        &self.connection
    }
}

impl WorkspaceIndexStore for SqliteWorkspaceIndex {
    fn remove_file(&self, path: &str) -> rusqlite::Result<()> {
        self.connection
            .execute("DELETE FROM workspace_files WHERE path = ?1", [path])?;
        Ok(())
    }

    fn summary(&self) -> rusqlite::Result<WorkspaceIndexSummary> {
        let file_count =
            self.connection
                .query_row("SELECT COUNT(*) FROM workspace_files", [], |row| {
                    row.get::<_, i64>(0)
                })?;

        Ok(WorkspaceIndexSummary {
            database_path: self.database_path.to_string_lossy().to_string(),
            file_count,
            schema_version: CURRENT_SCHEMA_VERSION,
        })
    }

    fn upsert_file(&self, record: &WorkspaceFileRecord) -> rusqlite::Result<()> {
        self.connection.execute(
            "
            INSERT INTO workspace_files (
                path,
                relative_path,
                language,
                size_bytes,
                modified_at_unix,
                indexed_at_unix
            )
            VALUES (?1, ?2, ?3, ?4, ?5, strftime('%s', 'now'))
            ON CONFLICT(path) DO UPDATE SET
                relative_path = excluded.relative_path,
                language = excluded.language,
                size_bytes = excluded.size_bytes,
                modified_at_unix = excluded.modified_at_unix,
                indexed_at_unix = excluded.indexed_at_unix
            ",
            params![
                record.path,
                record.relative_path,
                record.language,
                record.size_bytes,
                record.modified_at_unix,
            ],
        )?;
        Ok(())
    }
}

impl WorkspaceSymbolStore for SqliteWorkspaceIndex {
    fn list_file_symbols(&self, file_path: &str) -> rusqlite::Result<Vec<WorkspaceSymbolRecord>> {
        let mut statement = self.connection.prepare(
            "
            SELECT
                kind,
                name,
                fully_qualified_name,
                container_name,
                start_byte,
                end_byte,
                start_line,
                start_column,
                end_line,
                end_column
            FROM workspace_symbols
            WHERE file_path = ?1
            ORDER BY ordinal
            ",
        )?;
        let rows = statement.query_map([file_path], workspace_symbol_record)?;
        let mut symbols = Vec::new();

        for row in rows {
            symbols.push(row?);
        }

        Ok(symbols)
    }

    fn replace_file_symbols(&self, file_symbols: &WorkspaceFileSymbols) -> rusqlite::Result<()> {
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute(
            "DELETE FROM workspace_symbols WHERE file_path = ?1",
            [&file_symbols.file_path],
        )?;

        for (ordinal, symbol) in file_symbols.symbols.iter().enumerate() {
            transaction.execute(
                "
                INSERT INTO workspace_symbols (
                    file_path,
                    file_relative_path,
                    ordinal,
                    kind,
                    name,
                    fully_qualified_name,
                    container_name,
                    start_byte,
                    end_byte,
                    start_line,
                    start_column,
                    end_line,
                    end_column,
                    indexed_at_unix
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, strftime('%s', 'now'))
                ",
                params![
                    file_symbols.file_path,
                    file_symbols.relative_path,
                    ordinal as i64,
                    symbol.kind.as_storage_value(),
                    symbol.name,
                    symbol.fully_qualified_name,
                    symbol.container_name,
                    symbol.range.start_byte,
                    symbol.range.end_byte,
                    symbol.range.start_line,
                    symbol.range.start_column,
                    symbol.range.end_line,
                    symbol.range.end_column,
                ],
            )?;
        }

        transaction.commit()
    }
}

impl WorkspaceSymbolSearchStore for SqliteWorkspaceIndex {
    fn search_project_symbols(
        &self,
        query: &str,
        limit: usize,
    ) -> rusqlite::Result<Vec<ProjectSymbolSearchResult>> {
        let normalized_query = query.trim().to_lowercase();

        if normalized_query.is_empty() {
            return Ok(Vec::new());
        }

        let capped_limit = limit.clamp(1, 200);
        let contains_pattern = format!("%{}%", escape_like_query(&normalized_query));
        let prefix_pattern = format!("{}%", escape_like_query(&normalized_query));
        let mut statement = self.connection.prepare(
            "
            SELECT
                kind,
                name,
                fully_qualified_name,
                container_name,
                file_path,
                file_relative_path,
                start_line,
                start_column,
                ordinal
            FROM workspace_symbols
            WHERE kind IN ('class', 'interface', 'trait', 'enum', 'function', 'method')
                AND (
                    lower(name) LIKE ?1 ESCAPE '\\'
                    OR lower(fully_qualified_name) LIKE ?1 ESCAPE '\\'
                )
            ORDER BY
                CASE
                    WHEN lower(name) = ?2 THEN 0
                    WHEN lower(fully_qualified_name) = ?2 THEN 1
                    WHEN lower(name) LIKE ?3 ESCAPE '\\' THEN 2
                    WHEN lower(fully_qualified_name) LIKE ?3 ESCAPE '\\' THEN 3
                    WHEN lower(name) LIKE ?1 ESCAPE '\\' THEN 4
                    WHEN lower(fully_qualified_name) LIKE ?1 ESCAPE '\\' THEN 5
                END,
                CASE kind
                    WHEN 'class' THEN 0
                    WHEN 'interface' THEN 1
                    WHEN 'trait' THEN 2
                    WHEN 'enum' THEN 3
                    WHEN 'function' THEN 4
                    WHEN 'method' THEN 5
                END,
                length(fully_qualified_name),
                lower(fully_qualified_name),
                file_relative_path,
                start_line,
                ordinal
            LIMIT ?4
            ",
        )?;
        let rows = statement.query_map(
            params![
                contains_pattern,
                normalized_query,
                prefix_pattern,
                capped_limit as i64,
            ],
            project_symbol_search_result,
        )?;
        let mut results = Vec::new();

        for row in rows {
            results.push(row?);
        }

        Ok(results)
    }
}

impl WorkspacePhpFileOutlineStore for SqliteWorkspaceIndex {
    fn load_php_file_outline(&self, file_path: &str) -> rusqlite::Result<PhpFileOutline> {
        let mut statement = self.connection.prepare(
            "
            SELECT
                workspace_symbols.kind,
                workspace_symbols.name,
                workspace_symbols.fully_qualified_name,
                workspace_symbols.container_name,
                workspace_symbols.file_path,
                workspace_files.relative_path,
                workspace_symbols.start_line,
                workspace_symbols.start_column,
                container_symbols.kind
            FROM workspace_symbols
            JOIN workspace_files ON workspace_files.path = workspace_symbols.file_path
            LEFT JOIN workspace_symbols container_symbols
                ON container_symbols.file_path = workspace_symbols.file_path
                AND container_symbols.fully_qualified_name = workspace_symbols.container_name
                AND container_symbols.kind IN ('class', 'interface', 'trait', 'enum')
            WHERE workspace_symbols.file_path = ?
                AND workspace_symbols.kind IN ('class', 'interface', 'trait', 'enum', 'function', 'method', 'property', 'constant')
            ORDER BY workspace_symbols.ordinal
            ",
        )?;
        let rows = statement.query_map([file_path], php_file_outline_symbol_record)?;
        let mut symbols = Vec::new();

        for row in rows {
            symbols.push(row?);
        }

        Ok(build_php_file_outline(&symbols))
    }
}

impl WorkspacePhpTreeStore for SqliteWorkspaceIndex {
    fn load_php_tree(&self) -> rusqlite::Result<PhpTree> {
        let mut statement = self.connection.prepare(
            "
            SELECT
                workspace_symbols.kind,
                workspace_symbols.name,
                workspace_symbols.fully_qualified_name,
                workspace_symbols.container_name,
                workspace_symbols.file_path,
                workspace_files.relative_path,
                workspace_symbols.start_line,
                workspace_symbols.start_column,
                container_symbols.kind
            FROM workspace_symbols
            JOIN workspace_files ON workspace_files.path = workspace_symbols.file_path
            LEFT JOIN workspace_symbols container_symbols
                ON container_symbols.file_path = workspace_symbols.file_path
                AND container_symbols.fully_qualified_name = workspace_symbols.container_name
                AND container_symbols.kind IN ('class', 'interface', 'trait', 'enum')
            WHERE workspace_symbols.kind IN ('class', 'interface', 'trait', 'enum', 'function', 'method', 'property', 'constant')
            ORDER BY lower(workspace_symbols.fully_qualified_name), workspace_symbols.ordinal
            ",
        )?;
        let rows = statement.query_map([], php_tree_symbol_record)?;
        let mut symbols = Vec::new();

        for row in rows {
            symbols.push(row?);
        }

        Ok(build_php_tree(&symbols))
    }
}

impl WorkspaceIndexMaintenanceStore for SqliteWorkspaceIndex {
    fn clear_workspace_files(&self) -> rusqlite::Result<usize> {
        self.connection.execute("DELETE FROM workspace_files", [])
    }

    fn clear_symbols_for_language(&self, language: &str) -> rusqlite::Result<usize> {
        self.connection.execute(
            "
            DELETE FROM workspace_symbols
            WHERE file_path IN (
                SELECT path
                FROM workspace_files
                WHERE language = ?
            )
            ",
            [language],
        )
    }

    fn list_workspace_files(&self) -> rusqlite::Result<Vec<WorkspaceFileRecord>> {
        let mut statement = self.connection.prepare(
            "
            SELECT
                path,
                relative_path,
                language,
                size_bytes,
                modified_at_unix
            FROM workspace_files
            ORDER BY path
            ",
        )?;
        let rows = statement.query_map([], workspace_file_record_from_row)?;
        let mut records = Vec::new();

        for row in rows {
            records.push(row?);
        }

        Ok(records)
    }
}

pub fn workspace_index_path(config_dir: &Path, root_path: &Path) -> PathBuf {
    let normalized = root_path.to_string_lossy().replace('\\', "/");
    let hash = stable_workspace_hash(&normalized);

    config_dir
        .join("workspace-indexes")
        .join(format!("{hash:016x}.sqlite3"))
}

fn configure_connection(connection: &Connection) -> rusqlite::Result<()> {
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    Ok(())
}

fn apply_migrations(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at_unix INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workspace_files (
            path TEXT PRIMARY KEY,
            relative_path TEXT NOT NULL,
            language TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            modified_at_unix INTEGER NOT NULL,
            indexed_at_unix INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_workspace_files_relative_path
            ON workspace_files(relative_path);

        INSERT INTO schema_migrations(version, name, applied_at_unix)
        VALUES (1, 'initial_workspace_files', strftime('%s', 'now'))
        ON CONFLICT(version) DO NOTHING;

        CREATE TABLE IF NOT EXISTS workspace_symbols (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL,
            file_relative_path TEXT NOT NULL,
            ordinal INTEGER NOT NULL,
            kind TEXT NOT NULL,
            name TEXT NOT NULL,
            fully_qualified_name TEXT NOT NULL,
            container_name TEXT,
            start_byte INTEGER NOT NULL CHECK(start_byte >= 0),
            end_byte INTEGER NOT NULL CHECK(end_byte >= start_byte),
            start_line INTEGER NOT NULL CHECK(start_line >= 1),
            start_column INTEGER NOT NULL CHECK(start_column >= 1),
            end_line INTEGER NOT NULL CHECK(end_line >= start_line),
            end_column INTEGER NOT NULL CHECK(end_column >= 1),
            indexed_at_unix INTEGER NOT NULL,
            FOREIGN KEY(file_path) REFERENCES workspace_files(path) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_workspace_symbols_file_path
            ON workspace_symbols(file_path);

        CREATE INDEX IF NOT EXISTS idx_workspace_symbols_fully_qualified_name
            ON workspace_symbols(fully_qualified_name);

        CREATE INDEX IF NOT EXISTS idx_workspace_symbols_kind_name
            ON workspace_symbols(kind, name);

        INSERT INTO schema_migrations(version, name, applied_at_unix)
        VALUES (2, 'workspace_symbols', strftime('%s', 'now'))
        ON CONFLICT(version) DO NOTHING;

        PRAGMA user_version = 2;
        ",
    )?;
    Ok(())
}

fn to_sqlite_error(error: std::io::Error) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(error))
}

fn apply_index_db_write(
    store: &dyn WorkspaceIndexWriteStore,
    operation: &IndexDbWriteOperation,
) -> rusqlite::Result<()> {
    match operation {
        IndexDbWriteOperation::ReplaceFileSymbols { file_symbols } => {
            store.replace_file_symbols(&workspace_file_symbols(file_symbols))
        }
        IndexDbWriteOperation::RemoveFile { path } => store.remove_file(path),
        IndexDbWriteOperation::UpsertFileMetadata { metadata } => {
            store.upsert_file(&workspace_file_record(metadata))
        }
    }
}

fn workspace_file_record(metadata: &IndexFileMetadata) -> WorkspaceFileRecord {
    WorkspaceFileRecord {
        language: metadata.language.clone(),
        modified_at_unix: metadata.modified_at_unix,
        path: metadata.path.clone(),
        relative_path: metadata.relative_path.clone(),
        size_bytes: metadata.size_bytes,
    }
}

fn workspace_file_record_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<WorkspaceFileRecord> {
    Ok(WorkspaceFileRecord {
        path: row.get(0)?,
        relative_path: row.get(1)?,
        language: row.get(2)?,
        size_bytes: row.get(3)?,
        modified_at_unix: row.get(4)?,
    })
}

fn workspace_file_symbols(file_symbols: &IndexFileSymbols) -> WorkspaceFileSymbols {
    WorkspaceFileSymbols {
        file_path: file_symbols.file_path.clone(),
        relative_path: file_symbols.relative_path.clone(),
        symbols: file_symbols
            .symbols
            .iter()
            .map(workspace_symbol_record_from_index)
            .collect(),
    }
}

fn workspace_symbol_record_from_index(symbol: &IndexSymbolRecord) -> WorkspaceSymbolRecord {
    WorkspaceSymbolRecord {
        container_name: symbol.container_name.clone(),
        fully_qualified_name: symbol.fully_qualified_name.clone(),
        kind: workspace_symbol_kind(symbol.kind),
        name: symbol.name.clone(),
        range: workspace_symbol_range(&symbol.range),
    }
}

fn workspace_symbol_kind(kind: IndexSymbolKind) -> WorkspaceSymbolKind {
    match kind {
        IndexSymbolKind::Class => WorkspaceSymbolKind::Class,
        IndexSymbolKind::Constant => WorkspaceSymbolKind::Constant,
        IndexSymbolKind::Enum => WorkspaceSymbolKind::Enum,
        IndexSymbolKind::Function => WorkspaceSymbolKind::Function,
        IndexSymbolKind::Interface => WorkspaceSymbolKind::Interface,
        IndexSymbolKind::Method => WorkspaceSymbolKind::Method,
        IndexSymbolKind::Property => WorkspaceSymbolKind::Property,
        IndexSymbolKind::Trait => WorkspaceSymbolKind::Trait,
    }
}

fn workspace_symbol_range(range: &IndexSymbolRange) -> WorkspaceSymbolRange {
    WorkspaceSymbolRange {
        end_byte: range.end_byte,
        end_column: range.end_column,
        end_line: range.end_line,
        start_byte: range.start_byte,
        start_column: range.start_column,
        start_line: range.start_line,
    }
}

fn stable_workspace_hash(value: &str) -> u64 {
    let mut hash = FNV_OFFSET_BASIS;

    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }

    hash
}

fn workspace_symbol_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkspaceSymbolRecord> {
    let kind_text: String = row.get(0)?;
    let kind = match WorkspaceSymbolKind::from_storage_value(&kind_text) {
        Some(kind) => kind,
        None => {
            return Err(rusqlite::Error::FromSqlConversionFailure(
                0,
                Type::Text,
                Box::new(InvalidWorkspaceSymbolKind(kind_text)),
            ))
        }
    };

    Ok(WorkspaceSymbolRecord {
        container_name: row.get(3)?,
        fully_qualified_name: row.get(2)?,
        kind,
        name: row.get(1)?,
        range: WorkspaceSymbolRange {
            end_byte: row.get(5)?,
            end_column: row.get(9)?,
            end_line: row.get(8)?,
            start_byte: row.get(4)?,
            start_column: row.get(7)?,
            start_line: row.get(6)?,
        },
    })
}

fn project_symbol_search_result(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<ProjectSymbolSearchResult> {
    let kind_text: String = row.get(0)?;
    let kind = match WorkspaceSymbolKind::from_storage_value(&kind_text) {
        Some(kind) => kind,
        None => {
            return Err(rusqlite::Error::FromSqlConversionFailure(
                0,
                Type::Text,
                Box::new(InvalidWorkspaceSymbolKind(kind_text)),
            ))
        }
    };

    Ok(ProjectSymbolSearchResult {
        column: row.get(7)?,
        container_name: row.get(3)?,
        fully_qualified_name: row.get(2)?,
        kind,
        line_number: row.get(6)?,
        name: row.get(1)?,
        path: row.get(4)?,
        relative_path: row.get(5)?,
    })
}

fn php_file_outline_symbol_record(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<PhpFileOutlineSymbolRecord> {
    let kind_text: String = row.get(0)?;
    let kind = required_php_file_outline_node_kind(kind_text, 0)?;
    let container_kind = optional_php_file_outline_node_kind(row.get(8)?, 8)?;

    Ok(PhpFileOutlineSymbolRecord {
        column: row.get(7)?,
        container_kind,
        container_name: row.get(3)?,
        fully_qualified_name: row.get(2)?,
        kind,
        line_number: row.get(6)?,
        name: row.get(1)?,
        path: row.get(4)?,
        relative_path: row.get(5)?,
    })
}

fn required_php_file_outline_node_kind(
    kind_text: String,
    column: usize,
) -> rusqlite::Result<PhpFileOutlineNodeKind> {
    let kind = match WorkspaceSymbolKind::from_storage_value(&kind_text) {
        Some(kind) => kind,
        None => {
            return Err(rusqlite::Error::FromSqlConversionFailure(
                column,
                Type::Text,
                Box::new(InvalidWorkspaceSymbolKind(kind_text)),
            ))
        }
    };

    Ok(php_file_outline_node_kind(kind))
}

fn optional_php_file_outline_node_kind(
    kind_text: Option<String>,
    column: usize,
) -> rusqlite::Result<Option<PhpFileOutlineNodeKind>> {
    let kind_text = match kind_text {
        Some(kind_text) => kind_text,
        None => return Ok(None),
    };

    Ok(Some(required_php_file_outline_node_kind(
        kind_text, column,
    )?))
}

fn php_file_outline_node_kind(kind: WorkspaceSymbolKind) -> PhpFileOutlineNodeKind {
    match kind {
        WorkspaceSymbolKind::Class => PhpFileOutlineNodeKind::Class,
        WorkspaceSymbolKind::Constant => PhpFileOutlineNodeKind::Constant,
        WorkspaceSymbolKind::Enum => PhpFileOutlineNodeKind::Enum,
        WorkspaceSymbolKind::Function => PhpFileOutlineNodeKind::Function,
        WorkspaceSymbolKind::Interface => PhpFileOutlineNodeKind::Interface,
        WorkspaceSymbolKind::Method => PhpFileOutlineNodeKind::Method,
        WorkspaceSymbolKind::Property => PhpFileOutlineNodeKind::Property,
        WorkspaceSymbolKind::Trait => PhpFileOutlineNodeKind::Trait,
    }
}

fn php_tree_symbol_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<PhpTreeSymbolRecord> {
    let kind_text: String = row.get(0)?;
    let kind = required_php_tree_node_kind(kind_text, 0)?;
    let container_kind = optional_php_tree_node_kind(row.get(8)?, 8)?;

    Ok(PhpTreeSymbolRecord {
        column: row.get(7)?,
        container_kind,
        container_name: row.get(3)?,
        fully_qualified_name: row.get(2)?,
        kind,
        line_number: row.get(6)?,
        name: row.get(1)?,
        path: row.get(4)?,
        relative_path: row.get(5)?,
    })
}

fn required_php_tree_node_kind(
    kind_text: String,
    column: usize,
) -> rusqlite::Result<PhpTreeNodeKind> {
    let kind = match WorkspaceSymbolKind::from_storage_value(&kind_text) {
        Some(kind) => kind,
        None => {
            return Err(rusqlite::Error::FromSqlConversionFailure(
                column,
                Type::Text,
                Box::new(InvalidWorkspaceSymbolKind(kind_text)),
            ))
        }
    };

    Ok(php_tree_node_kind(kind))
}

fn optional_php_tree_node_kind(
    kind_text: Option<String>,
    column: usize,
) -> rusqlite::Result<Option<PhpTreeNodeKind>> {
    let kind_text = match kind_text {
        Some(kind_text) => kind_text,
        None => return Ok(None),
    };

    Ok(Some(required_php_tree_node_kind(kind_text, column)?))
}

fn php_tree_node_kind(kind: WorkspaceSymbolKind) -> PhpTreeNodeKind {
    match kind {
        WorkspaceSymbolKind::Class => PhpTreeNodeKind::Class,
        WorkspaceSymbolKind::Constant => PhpTreeNodeKind::Constant,
        WorkspaceSymbolKind::Enum => PhpTreeNodeKind::Enum,
        WorkspaceSymbolKind::Function => PhpTreeNodeKind::Function,
        WorkspaceSymbolKind::Interface => PhpTreeNodeKind::Interface,
        WorkspaceSymbolKind::Method => PhpTreeNodeKind::Method,
        WorkspaceSymbolKind::Property => PhpTreeNodeKind::Property,
        WorkspaceSymbolKind::Trait => PhpTreeNodeKind::Trait,
    }
}

fn escape_like_query(query: &str) -> String {
    let mut escaped = String::new();

    for character in query.chars() {
        if character == '\\' || character == '%' || character == '_' {
            escaped.push('\\');
        }

        escaped.push(character);
    }

    escaped
}

#[derive(Debug)]
struct InvalidWorkspaceSymbolKind(String);

impl fmt::Display for InvalidWorkspaceSymbolKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "invalid workspace symbol kind: {}", self.0)
    }
}

impl Error for InvalidWorkspaceSymbolKind {}

#[cfg(test)]
mod tests {
    use super::{
        commit_index_db_write, workspace_index_path, IndexCommitOutcome, SqliteWorkspaceIndex,
        WorkspaceFileRecord, WorkspaceFileSymbols, WorkspaceIndexMaintenanceStore,
        WorkspaceIndexStore, WorkspacePhpFileOutlineStore, WorkspacePhpTreeStore,
        WorkspaceSymbolKind, WorkspaceSymbolRange, WorkspaceSymbolRecord,
        WorkspaceSymbolSearchStore, WorkspaceSymbolStore,
    };
    use crate::job_scheduler::{
        InMemoryIndexJobScheduler, IndexCommitGate, IndexCommitPermission, IndexCommitScope,
        IndexDbWriteOperation, IndexFileMetadata, IndexFileSymbols, IndexGenerationGuard,
        IndexJobPayload, IndexJobScheduler, IndexSymbolKind, IndexSymbolRange, IndexSymbolRecord,
        ScheduleIndexJobRequest,
    };
    use crate::php_file_outline::PhpFileOutlineNodeKind;
    use crate::php_tree::PhpTreeNodeKind;
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn opens_database_with_migrations_and_pragmas() {
        let database_path = temp_database_path("migrations");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");

        let journal_mode: String = index
            .connection()
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .expect("journal mode");
        let busy_timeout: i64 = index
            .connection()
            .query_row("PRAGMA busy_timeout", [], |row| row.get(0))
            .expect("busy timeout");
        let migration_count: i64 = index
            .connection()
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("migration count");

        assert_eq!(journal_mode.to_lowercase(), "wal");
        assert_eq!(busy_timeout, 5_000);
        assert_eq!(migration_count, 2);
        assert_eq!(index.summary().expect("summary").schema_version, 2);
    }

    #[test]
    fn upserts_and_removes_workspace_files() {
        let database_path = temp_database_path("files");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        let record = WorkspaceFileRecord {
            language: "php".to_string(),
            modified_at_unix: 10,
            path: "/project/src/User.php".to_string(),
            relative_path: "src/User.php".to_string(),
            size_bytes: 128,
        };

        index.upsert_file(&record).expect("upsert file");
        assert_eq!(index.summary().expect("summary").file_count, 1);

        index
            .upsert_file(&WorkspaceFileRecord {
                size_bytes: 256,
                ..record
            })
            .expect("update file");
        assert_eq!(index.summary().expect("summary").file_count, 1);

        index
            .remove_file("/project/src/User.php")
            .expect("remove file");
        assert_eq!(index.summary().expect("summary").file_count, 0);
    }

    #[test]
    fn replaces_file_symbols_transactionally() {
        let database_path = temp_database_path("symbols-replace");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        index
            .upsert_file(&file_record("/project/src/User.php", 128))
            .expect("seed file");

        index
            .replace_file_symbols(&file_symbols(
                "/project/src/User.php",
                vec![
                    symbol("User", "App\\User", WorkspaceSymbolKind::Class, 10),
                    symbol("name", "App\\User::name", WorkspaceSymbolKind::Method, 20),
                ],
            ))
            .expect("replace symbols");
        let initial_symbols = index
            .list_file_symbols("/project/src/User.php")
            .expect("initial symbols");

        assert_eq!(initial_symbols.len(), 2);
        assert_eq!(initial_symbols[0].fully_qualified_name, "App\\User");
        assert_eq!(initial_symbols[1].fully_qualified_name, "App\\User::name");

        index
            .replace_file_symbols(&file_symbols(
                "/project/src/User.php",
                vec![symbol(
                    "UserRepository",
                    "App\\UserRepository",
                    WorkspaceSymbolKind::Interface,
                    30,
                )],
            ))
            .expect("replace symbols again");
        let replaced_symbols = index
            .list_file_symbols("/project/src/User.php")
            .expect("replaced symbols");

        assert_eq!(replaced_symbols.len(), 1);
        assert_eq!(
            replaced_symbols[0].fully_qualified_name,
            "App\\UserRepository"
        );
    }

    #[test]
    fn replacing_symbols_does_not_touch_other_files() {
        let database_path = temp_database_path("symbols-other-file");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        index
            .upsert_file(&file_record("/project/src/User.php", 128))
            .expect("seed user file");
        index
            .upsert_file(&file_record("/project/src/Order.php", 128))
            .expect("seed order file");
        index
            .replace_file_symbols(&file_symbols(
                "/project/src/User.php",
                vec![symbol("User", "App\\User", WorkspaceSymbolKind::Class, 10)],
            ))
            .expect("seed user symbols");
        index
            .replace_file_symbols(&file_symbols(
                "/project/src/Order.php",
                vec![symbol(
                    "Order",
                    "App\\Order",
                    WorkspaceSymbolKind::Class,
                    15,
                )],
            ))
            .expect("seed order symbols");

        index
            .replace_file_symbols(&file_symbols(
                "/project/src/User.php",
                vec![symbol(
                    "user_helper",
                    "App\\user_helper",
                    WorkspaceSymbolKind::Function,
                    25,
                )],
            ))
            .expect("replace user symbols");
        let order_symbols = index
            .list_file_symbols("/project/src/Order.php")
            .expect("order symbols");

        assert_eq!(order_symbols.len(), 1);
        assert_eq!(order_symbols[0].fully_qualified_name, "App\\Order");
    }

    #[test]
    fn removing_file_cascades_symbol_rows() {
        let database_path = temp_database_path("symbols-cascade");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        index
            .upsert_file(&file_record("/project/src/User.php", 128))
            .expect("seed file");
        index
            .replace_file_symbols(&file_symbols(
                "/project/src/User.php",
                vec![symbol("User", "App\\User", WorkspaceSymbolKind::Class, 10)],
            ))
            .expect("seed symbols");

        index
            .remove_file("/project/src/User.php")
            .expect("remove file");

        assert!(index
            .list_file_symbols("/project/src/User.php")
            .expect("symbols")
            .is_empty());
    }

    #[test]
    fn clearing_workspace_files_cascades_symbol_rows() {
        let database_path = temp_database_path("clear-workspace");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        index
            .upsert_file(&file_record("/project/src/User.php", 128))
            .expect("seed file");
        index
            .replace_file_symbols(&file_symbols(
                "/project/src/User.php",
                vec![symbol("User", "App\\User", WorkspaceSymbolKind::Class, 10)],
            ))
            .expect("seed symbols");

        let cleared = index.clear_workspace_files().expect("clear files");
        let symbols = index
            .list_file_symbols("/project/src/User.php")
            .expect("list symbols");

        assert_eq!(cleared, 1);
        assert_eq!(index.summary().expect("summary").file_count, 0);
        assert!(symbols.is_empty());
    }

    #[test]
    fn clearing_symbols_for_language_keeps_other_languages() {
        let database_path = temp_database_path("clear-language-symbols");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        index
            .upsert_file(&file_record("/project/src/User.php", 128))
            .expect("seed php file");
        index
            .upsert_file(&WorkspaceFileRecord {
                language: "typescript".to_string(),
                modified_at_unix: 10,
                path: "/project/src/app.ts".to_string(),
                relative_path: "src/app.ts".to_string(),
                size_bytes: 64,
            })
            .expect("seed ts file");
        index
            .replace_file_symbols(&file_symbols(
                "/project/src/User.php",
                vec![symbol("User", "App\\User", WorkspaceSymbolKind::Class, 10)],
            ))
            .expect("seed php symbols");
        index
            .replace_file_symbols(&file_symbols(
                "/project/src/app.ts",
                vec![symbol("app", "app", WorkspaceSymbolKind::Function, 10)],
            ))
            .expect("seed ts symbols");

        let cleared = index
            .clear_symbols_for_language("php")
            .expect("clear php symbols");
        let php_symbols = index
            .list_file_symbols("/project/src/User.php")
            .expect("list php symbols");
        let ts_symbols = index
            .list_file_symbols("/project/src/app.ts")
            .expect("list ts symbols");

        assert_eq!(cleared, 1);
        assert!(php_symbols.is_empty());
        assert_eq!(ts_symbols.len(), 1);
        assert_eq!(index.summary().expect("summary").file_count, 2);
    }

    #[test]
    fn failed_symbol_replace_rolls_back_existing_symbols() {
        let database_path = temp_database_path("symbols-rollback");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        index
            .upsert_file(&file_record("/project/src/User.php", 128))
            .expect("seed file");
        index
            .replace_file_symbols(&file_symbols(
                "/project/src/User.php",
                vec![symbol("User", "App\\User", WorkspaceSymbolKind::Class, 10)],
            ))
            .expect("seed symbols");

        let result = index.replace_file_symbols(&WorkspaceFileSymbols {
            file_path: "/project/src/User.php".to_string(),
            relative_path: "src/User.php".to_string(),
            symbols: vec![WorkspaceSymbolRecord {
                range: WorkspaceSymbolRange {
                    end_byte: 10,
                    end_column: 1,
                    end_line: 1,
                    start_byte: 20,
                    start_column: 1,
                    start_line: 1,
                },
                ..symbol("Broken", "App\\Broken", WorkspaceSymbolKind::Class, 20)
            }],
        });
        let symbols = index
            .list_file_symbols("/project/src/User.php")
            .expect("symbols after rollback");

        assert!(result.is_err());
        assert_eq!(symbols.len(), 1);
        assert_eq!(symbols[0].fully_qualified_name, "App\\User");
    }

    #[test]
    fn guarded_db_write_commits_current_generation() {
        let database_path = temp_database_path("guard-current");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        let gate = StaticCommitGate(IndexCommitPermission::Current);
        let operation = IndexDbWriteOperation::UpsertFileMetadata {
            metadata: file_metadata("/project/src/User.php", 128),
        };

        let outcome = commit_index_db_write(&index, &gate, &commit_scope(1), &operation)
            .expect("commit write");

        assert_eq!(outcome, IndexCommitOutcome::Committed);
        assert_eq!(index.summary().expect("summary").file_count, 1);
    }

    #[test]
    fn guarded_upsert_does_not_replace_newer_record_when_stale() {
        let database_path = temp_database_path("guard-stale-upsert");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        let current = file_record("/project/src/User.php", 256);
        index.upsert_file(&current).expect("seed current file");
        let gate = StaticCommitGate(IndexCommitPermission::Stale);
        let stale_operation = IndexDbWriteOperation::UpsertFileMetadata {
            metadata: file_metadata("/project/src/User.php", 128),
        };

        let outcome = commit_index_db_write(&index, &gate, &commit_scope(1), &stale_operation)
            .expect("skip stale write");
        let size_bytes: i64 = index
            .connection()
            .query_row(
                "SELECT size_bytes FROM workspace_files WHERE path = ?1",
                ["/project/src/User.php"],
                |row| row.get(0),
            )
            .expect("file size");

        assert_eq!(outcome, IndexCommitOutcome::SkippedStale);
        assert_eq!(size_bytes, 256);
    }

    #[test]
    fn guarded_remove_does_not_delete_when_stale() {
        let database_path = temp_database_path("guard-stale-remove");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        index
            .upsert_file(&file_record("/project/src/User.php", 128))
            .expect("seed file");
        let gate = StaticCommitGate(IndexCommitPermission::Stale);
        let operation = IndexDbWriteOperation::RemoveFile {
            path: "/project/src/User.php".to_string(),
        };

        let outcome = commit_index_db_write(&index, &gate, &commit_scope(1), &operation)
            .expect("skip stale remove");

        assert_eq!(outcome, IndexCommitOutcome::SkippedStale);
        assert_eq!(index.summary().expect("summary").file_count, 1);
    }

    #[test]
    fn guarded_symbol_replace_does_not_replace_when_stale() {
        let database_path = temp_database_path("guard-stale-symbols");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        index
            .upsert_file(&file_record("/project/src/User.php", 128))
            .expect("seed file");
        index
            .replace_file_symbols(&file_symbols(
                "/project/src/User.php",
                vec![symbol("User", "App\\User", WorkspaceSymbolKind::Class, 10)],
            ))
            .expect("seed current symbols");
        let gate = StaticCommitGate(IndexCommitPermission::Stale);
        let operation = IndexDbWriteOperation::ReplaceFileSymbols {
            file_symbols: index_file_symbols(
                "/project/src/User.php",
                vec![index_symbol(
                    "Broken",
                    "App\\Broken",
                    IndexSymbolKind::Class,
                    20,
                )],
            ),
        };

        let outcome = commit_index_db_write(&index, &gate, &commit_scope(1), &operation)
            .expect("skip stale symbols");
        let symbols = index
            .list_file_symbols("/project/src/User.php")
            .expect("symbols");

        assert_eq!(outcome, IndexCommitOutcome::SkippedStale);
        assert_eq!(symbols.len(), 1);
        assert_eq!(symbols[0].fully_qualified_name, "App\\User");
    }

    #[test]
    fn searches_project_symbols_from_sqlite() {
        let database_path = temp_database_path("symbol-search");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        index
            .upsert_file(&file_record("/project/src/User.php", 128))
            .expect("seed user file");
        index
            .replace_file_symbols(&file_symbols(
                "/project/src/User.php",
                vec![
                    symbol("User", "App\\User", WorkspaceSymbolKind::Class, 10),
                    symbol(
                        "UserFactory",
                        "App\\UserFactory",
                        WorkspaceSymbolKind::Class,
                        20,
                    ),
                    symbol(
                        "findUser",
                        "App\\UserRepository::findUser",
                        WorkspaceSymbolKind::Method,
                        30,
                    ),
                    symbol(
                        "user_helper",
                        "App\\user_helper",
                        WorkspaceSymbolKind::Function,
                        40,
                    ),
                    symbol(
                        "USER_TYPE",
                        "App\\User::USER_TYPE",
                        WorkspaceSymbolKind::Constant,
                        50,
                    ),
                ],
            ))
            .expect("seed symbols");

        let results = index
            .search_project_symbols("user", 10)
            .expect("symbol search");
        let names: Vec<String> = results.iter().map(|result| result.name.clone()).collect();

        assert_eq!(
            names,
            vec![
                "User".to_string(),
                "UserFactory".to_string(),
                "user_helper".to_string(),
                "findUser".to_string(),
            ]
        );
        assert_eq!(results[0].kind, WorkspaceSymbolKind::Class);
        assert_eq!(results[0].relative_path, "src/User.php");
        assert_eq!(results[0].line_number, 1);
        assert_eq!(results[0].column, 1);

        let fqn_results = index
            .search_project_symbols("APP\\USERREPOSITORY::FINDUSER", 10)
            .expect("fqn symbol search");

        assert_eq!(fqn_results.len(), 1);
        assert_eq!(fqn_results[0].name, "findUser");
        assert_eq!(fqn_results[0].path, "/project/src/User.php");
    }

    #[test]
    fn project_symbol_search_escapes_like_wildcards() {
        let database_path = temp_database_path("symbol-search-escape");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        index
            .upsert_file(&file_record("/project/src/Wildcard.php", 128))
            .expect("seed file");
        index
            .replace_file_symbols(&file_symbols(
                "/project/src/Wildcard.php",
                vec![
                    symbol(
                        "User_Match",
                        "App\\User_Match",
                        WorkspaceSymbolKind::Class,
                        10,
                    ),
                    symbol(
                        "UserXMatch",
                        "App\\UserXMatch",
                        WorkspaceSymbolKind::Class,
                        20,
                    ),
                ],
            ))
            .expect("seed symbols");

        let results = index
            .search_project_symbols("User_", 10)
            .expect("symbol search");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "User_Match");
    }

    #[test]
    fn project_symbol_search_returns_no_results_for_empty_query() {
        let database_path = temp_database_path("symbol-search-empty");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");

        let results = index
            .search_project_symbols("   ", 10)
            .expect("symbol search");

        assert!(results.is_empty());
    }

    #[test]
    fn loads_php_tree_from_indexed_symbols() {
        let database_path = temp_database_path("php-tree");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        index
            .upsert_file(&file_record("/project/src/User.php", 128))
            .expect("seed file");
        index
            .replace_file_symbols(&file_symbols(
                "/project/src/User.php",
                vec![
                    symbol("User", "App\\Domain\\User", WorkspaceSymbolKind::Class, 10),
                    symbol_in_container(
                        "name",
                        "App\\Domain\\User::name",
                        WorkspaceSymbolKind::Method,
                        "App\\Domain\\User",
                        20,
                    ),
                    symbol(
                        "helper",
                        "App\\Domain\\helper",
                        WorkspaceSymbolKind::Function,
                        30,
                    ),
                ],
            ))
            .expect("seed symbols");

        let tree = index.load_php_tree().expect("php tree");
        let app = &tree.nodes[0];
        let domain = &app.children[0];
        let user = domain
            .children
            .iter()
            .find(|node| node.label == "User")
            .expect("user node");

        assert_eq!(app.kind, PhpTreeNodeKind::Namespace);
        assert_eq!(domain.label, "Domain");
        assert_eq!(user.kind, PhpTreeNodeKind::Class);
        assert_eq!(
            user.fully_qualified_name.as_deref(),
            Some("App\\Domain\\User")
        );
        assert_eq!(user.relative_path.as_deref(), Some("src/User.php"));
        assert_eq!(user.children[0].label, "name");
        assert_eq!(user.children[0].line_number, Some(20));
    }

    #[test]
    fn loads_php_file_outline_for_one_indexed_file() {
        let database_path = temp_database_path("php-file-outline");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        index
            .upsert_file(&file_record("/project/src/User.php", 128))
            .expect("seed user file");
        index
            .upsert_file(&file_record("/project/src/Other.php", 128))
            .expect("seed other file");
        index
            .replace_file_symbols(&file_symbols(
                "/project/src/User.php",
                vec![
                    symbol("User", "App\\Domain\\User", WorkspaceSymbolKind::Class, 10),
                    symbol_in_container(
                        "name",
                        "App\\Domain\\User::name",
                        WorkspaceSymbolKind::Method,
                        "App\\Domain\\User",
                        20,
                    ),
                ],
            ))
            .expect("seed user symbols");
        index
            .replace_file_symbols(&file_symbols(
                "/project/src/Other.php",
                vec![symbol(
                    "Other",
                    "App\\Domain\\Other",
                    WorkspaceSymbolKind::Class,
                    10,
                )],
            ))
            .expect("seed other symbols");

        let outline = index
            .load_php_file_outline("/project/src/User.php")
            .expect("php file outline");

        assert_eq!(outline.nodes.len(), 1);
        assert_eq!(outline.nodes[0].label, "User");
        assert_eq!(outline.nodes[0].kind, PhpFileOutlineNodeKind::Class);
        assert_eq!(
            outline.nodes[0].relative_path.as_deref(),
            Some("src/User.php")
        );
        assert_eq!(outline.nodes[0].children[0].label, "name");
    }

    #[test]
    fn guarded_db_write_skips_cancelled_generation() {
        let database_path = temp_database_path("guard-cancelled");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        let gate = StaticCommitGate(IndexCommitPermission::Cancelled);
        let operation = IndexDbWriteOperation::UpsertFileMetadata {
            metadata: file_metadata("/project/src/User.php", 128),
        };

        let outcome = commit_index_db_write(&index, &gate, &commit_scope(1), &operation)
            .expect("skip cancelled write");

        assert_eq!(outcome, IndexCommitOutcome::SkippedCancelled);
        assert_eq!(index.summary().expect("summary").file_count, 0);
    }

    #[test]
    fn scheduler_generation_gate_skips_stale_sqlite_write() {
        let database_path = temp_database_path("scheduler-gate");
        let index = SqliteWorkspaceIndex::open(&database_path).expect("open index");
        let mut scheduler = InMemoryIndexJobScheduler::default();
        let operation = IndexDbWriteOperation::UpsertFileMetadata {
            metadata: file_metadata("/project/src/User.php", 128),
        };
        let job = scheduler.enqueue(ScheduleIndexJobRequest {
            payload: IndexJobPayload::DbWrite {
                operation: operation.clone(),
            },
            workspace_root: "/project".to_string(),
        });

        scheduler.cancel_workspace("/project");
        let outcome = commit_index_db_write(&index, &scheduler, &job.commit_scope(), &operation)
            .expect("guarded write");

        assert_eq!(outcome, IndexCommitOutcome::SkippedStale);
        assert_eq!(index.summary().expect("summary").file_count, 0);
    }

    #[test]
    fn workspace_index_paths_are_stable_per_root() {
        let config_dir = Path::new("/tmp/editor-config");

        assert_eq!(
            workspace_index_path(config_dir, Path::new("/project")),
            workspace_index_path(config_dir, Path::new("/project")),
        );
        assert_ne!(
            workspace_index_path(config_dir, Path::new("/project-a")),
            workspace_index_path(config_dir, Path::new("/project-b")),
        );
    }

    #[test]
    fn workspace_index_paths_normalize_path_separators() {
        let config_dir = Path::new("/tmp/editor-config");

        assert_eq!(
            workspace_index_path(config_dir, Path::new("C:\\project\\app")),
            workspace_index_path(config_dir, Path::new("C:/project/app")),
        );
    }

    fn temp_database_path(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("editor-index-{label}-{nanos}"));
        fs::create_dir_all(&directory).expect("temp dir");
        directory.join("workspace.sqlite3")
    }

    fn file_record(path: &str, size_bytes: i64) -> WorkspaceFileRecord {
        WorkspaceFileRecord {
            language: "php".to_string(),
            modified_at_unix: 10,
            path: path.to_string(),
            relative_path: path.strip_prefix("/project/").unwrap_or(path).to_string(),
            size_bytes,
        }
    }

    fn file_metadata(path: &str, size_bytes: i64) -> IndexFileMetadata {
        IndexFileMetadata {
            language: "php".to_string(),
            modified_at_unix: 10,
            path: path.to_string(),
            relative_path: path.strip_prefix("/project/").unwrap_or(path).to_string(),
            size_bytes,
        }
    }

    fn file_symbols(path: &str, symbols: Vec<WorkspaceSymbolRecord>) -> WorkspaceFileSymbols {
        WorkspaceFileSymbols {
            file_path: path.to_string(),
            relative_path: path.strip_prefix("/project/").unwrap_or(path).to_string(),
            symbols,
        }
    }

    fn index_file_symbols(path: &str, symbols: Vec<IndexSymbolRecord>) -> IndexFileSymbols {
        IndexFileSymbols {
            file_path: path.to_string(),
            relative_path: path.strip_prefix("/project/").unwrap_or(path).to_string(),
            symbols,
        }
    }

    fn symbol(
        name: &str,
        fully_qualified_name: &str,
        kind: WorkspaceSymbolKind,
        start_byte: i64,
    ) -> WorkspaceSymbolRecord {
        WorkspaceSymbolRecord {
            container_name: None,
            fully_qualified_name: fully_qualified_name.to_string(),
            kind,
            name: name.to_string(),
            range: WorkspaceSymbolRange {
                end_byte: start_byte + 5,
                end_column: 6,
                end_line: 1,
                start_byte,
                start_column: 1,
                start_line: 1,
            },
        }
    }

    fn symbol_in_container(
        name: &str,
        fully_qualified_name: &str,
        kind: WorkspaceSymbolKind,
        container_name: &str,
        line_number: i64,
    ) -> WorkspaceSymbolRecord {
        let mut record = symbol(name, fully_qualified_name, kind, line_number);
        record.container_name = Some(container_name.to_string());
        record.range.start_line = line_number;
        record.range.end_line = line_number;
        record
    }

    fn index_symbol(
        name: &str,
        fully_qualified_name: &str,
        kind: IndexSymbolKind,
        start_byte: i64,
    ) -> IndexSymbolRecord {
        IndexSymbolRecord {
            container_name: None,
            fully_qualified_name: fully_qualified_name.to_string(),
            kind,
            name: name.to_string(),
            range: IndexSymbolRange {
                end_byte: start_byte + 5,
                end_column: 6,
                end_line: 1,
                start_byte,
                start_column: 1,
                start_line: 1,
            },
        }
    }

    fn commit_scope(generation: u64) -> IndexCommitScope {
        IndexCommitScope {
            generation,
            workspace_root: "/project".to_string(),
        }
    }

    struct StaticCommitGate(IndexCommitPermission);

    impl IndexCommitGate for StaticCommitGate {
        fn check(&self, _scope: &IndexCommitScope) -> IndexCommitPermission {
            self.0
        }
    }
}
