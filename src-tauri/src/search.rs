use serde::Serialize;
use serde_json::Value;
use std::{
    io,
    path::{Path, PathBuf},
    process::Command,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextSearchResult {
    pub path: String,
    pub relative_path: String,
    pub line_number: u64,
    pub column: u64,
    pub line_text: String,
}

pub trait TextSearcher {
    fn search(&self, root: &Path, query: &str, limit: usize) -> io::Result<Vec<TextSearchResult>>;
}

pub struct RipgrepTextSearcher;

impl TextSearcher for RipgrepTextSearcher {
    fn search(&self, root: &Path, query: &str, limit: usize) -> io::Result<Vec<TextSearchResult>> {
        if !root.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Search root is not a directory",
            ));
        }

        let query = query.trim();

        if query.is_empty() {
            return Ok(Vec::new());
        }

        let output = Command::new("rg")
            .arg("--json")
            .arg("--line-number")
            .arg("--column")
            .arg("--color")
            .arg("never")
            .arg("--glob")
            .arg("!.git")
            .arg("--glob")
            .arg("!node_modules")
            .arg("--glob")
            .arg("!vendor")
            .arg("--glob")
            .arg("!target")
            .arg("--glob")
            .arg("!dist")
            .arg("--glob")
            .arg("!build")
            .arg(query)
            .arg(root)
            .output()
            .map_err(|error| {
                if error.kind() == io::ErrorKind::NotFound {
                    return io::Error::new(
                        io::ErrorKind::NotFound,
                        "ripgrep (rg) is not installed or not in PATH. Install ripgrep to use text search.",
                    );
                }

                error
            })?;

        if !output.status.success() && output.status.code() != Some(1) {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                String::from_utf8_lossy(&output.stderr).to_string(),
            ));
        }

        parse_ripgrep_json_lines(root, &String::from_utf8_lossy(&output.stdout), limit)
    }
}

fn parse_ripgrep_json_lines(
    root: &Path,
    output: &str,
    limit: usize,
) -> io::Result<Vec<TextSearchResult>> {
    let mut results = Vec::new();
    let capped_limit = limit.clamp(1, 500);

    for line in output.lines() {
        if results.len() >= capped_limit {
            return Ok(results);
        }

        let value: Value = serde_json::from_str(line).map_err(|error| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("Invalid ripgrep JSON: {error}"),
            )
        })?;

        if value.get("type").and_then(Value::as_str) != Some("match") {
            continue;
        }

        let Some(data) = value.get("data") else {
            continue;
        };

        let Some(path) = data
            .get("path")
            .and_then(|path| path.get("text"))
            .and_then(Value::as_str)
        else {
            continue;
        };

        let line_number = data.get("line_number").and_then(Value::as_u64).unwrap_or(1);
        let line_text = data
            .get("lines")
            .and_then(|lines| lines.get("text"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim_end_matches(['\r', '\n'])
            .to_string();
        let column = data
            .get("submatches")
            .and_then(Value::as_array)
            .and_then(|submatches| submatches.first())
            .and_then(|submatch| submatch.get("start"))
            .and_then(Value::as_u64)
            .map(|start| start + 1)
            .unwrap_or(1);

        let path = PathBuf::from(path);
        let relative_path = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");

        results.push(TextSearchResult {
            column,
            line_number,
            line_text,
            path: path.to_string_lossy().to_string(),
            relative_path,
        });
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::parse_ripgrep_json_lines;
    use std::path::Path;

    #[test]
    fn parses_match_events_from_ripgrep_json() {
        let output = r#"{"type":"begin","data":{"path":{"text":"/tmp/project/src/User.php"}}}
{"type":"match","data":{"path":{"text":"/tmp/project/src/User.php"},"lines":{"text":"final class User\n"},"line_number":4,"absolute_offset":36,"submatches":[{"match":{"text":"User"},"start":12,"end":16}]}}
{"type":"end","data":{"path":{"text":"/tmp/project/src/User.php"},"binary_offset":null,"stats":{"elapsed":{"secs":0,"nanos":1,"human":"0.000000001s"},"searches":1,"searches_with_match":1,"bytes_searched":52,"bytes_printed":100,"matched_lines":1,"matches":1}}}"#;

        let results =
            parse_ripgrep_json_lines(Path::new("/tmp/project"), output, 20).expect("parse output");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].relative_path, "src/User.php");
        assert_eq!(results[0].line_number, 4);
        assert_eq!(results[0].column, 13);
        assert_eq!(results[0].line_text, "final class User");
    }
}
