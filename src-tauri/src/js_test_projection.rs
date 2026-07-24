use crate::php_test_run::PhpTestSuite;

pub(crate) const MAX_PROJECTED_PATH_BYTES: usize = 16 * 1024;
pub(crate) const MAX_PROJECTED_NAME_BYTES: usize = 16 * 1024;
pub(crate) const MAX_PROJECTED_MESSAGE_BYTES: usize = 64 * 1024;
pub(crate) const MAX_PROJECTED_TEXT_BYTES: usize = 16 * 1024 * 1024;

pub(crate) fn validate_projected_test_text(suites: &[PhpTestSuite]) -> Result<(), String> {
    let mut total_bytes = 0usize;
    for suite in suites {
        add_projected_text(
            suite.name.as_deref(),
            MAX_PROJECTED_NAME_BYTES,
            "suite name",
            &mut total_bytes,
        )?;
        for case in &suite.cases {
            add_projected_text(
                case.name.as_deref(),
                MAX_PROJECTED_NAME_BYTES,
                "case name",
                &mut total_bytes,
            )?;
            add_projected_text(
                case.classname.as_deref(),
                MAX_PROJECTED_NAME_BYTES,
                "case classname",
                &mut total_bytes,
            )?;
            add_projected_text(
                case.file.as_deref(),
                MAX_PROJECTED_PATH_BYTES,
                "case file path",
                &mut total_bytes,
            )?;
            add_projected_text(
                case.message.as_deref(),
                MAX_PROJECTED_MESSAGE_BYTES,
                "case message",
                &mut total_bytes,
            )?;
        }
    }
    Ok(())
}

fn add_projected_text(
    value: Option<&str>,
    field_limit: usize,
    label: &str,
    total_bytes: &mut usize,
) -> Result<(), String> {
    let Some(value) = value else {
        return Ok(());
    };
    let bytes = value.len();
    if bytes > field_limit {
        return Err(format!(
            "JavaScript test {label} contains {bytes} UTF-8 bytes; the projection safety limit is {field_limit}."
        ));
    }
    *total_bytes = total_bytes
        .checked_add(bytes)
        .ok_or_else(|| "JavaScript test projection text size overflowed.".to_string())?;
    if *total_bytes > MAX_PROJECTED_TEXT_BYTES {
        return Err(format!(
            "JavaScript test projection text contains {total_bytes} UTF-8 bytes; the safety limit is {MAX_PROJECTED_TEXT_BYTES}."
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::parse_jest_json;
    use super::{
        validate_projected_test_text, MAX_PROJECTED_MESSAGE_BYTES, MAX_PROJECTED_NAME_BYTES,
        MAX_PROJECTED_PATH_BYTES, MAX_PROJECTED_TEXT_BYTES,
    };
    use crate::php_test_run::{PhpTestCase, PhpTestStatus, PhpTestSuite};
    use std::path::Path;

    #[test]
    fn projection_limits_match_the_frontend_ipc_contract() {
        assert_eq!(MAX_PROJECTED_PATH_BYTES, 16 * 1024);
        assert_eq!(MAX_PROJECTED_NAME_BYTES, 16 * 1024);
        assert_eq!(MAX_PROJECTED_MESSAGE_BYTES, 64 * 1024);
        assert_eq!(MAX_PROJECTED_TEXT_BYTES, 16 * 1024 * 1024);
    }

    #[test]
    fn accepts_exact_field_boundaries_and_rejects_one_byte_more() {
        let root = Path::new("/root");
        let name = "n".repeat(MAX_PROJECTED_NAME_BYTES);
        let message = "m".repeat(MAX_PROJECTED_MESSAGE_BYTES);
        let report = serde_json::json!({
            "testResults": [{
                "name": "/root/example.test.ts",
                "status": "failed",
                "assertionResults": [{
                    "fullName": name,
                    "status": "failed",
                    "failureMessages": [message]
                }]
            }]
        })
        .to_string();
        parse_jest_json(report.as_bytes(), root).expect("exact projection field boundaries");

        let path_prefix = "/root/";
        let exact_path = format!(
            "{path_prefix}{}",
            "p".repeat(MAX_PROJECTED_PATH_BYTES - path_prefix.len())
        );
        let report = report_with_path(exact_path, "path boundary");
        parse_jest_json(report.as_bytes(), root).expect("exact projected path boundary");

        let oversized_path = format!(
            "{path_prefix}{}",
            "p".repeat(MAX_PROJECTED_PATH_BYTES - path_prefix.len() + 1)
        );
        let report = report_with_path(oversized_path, "path overflow");
        assert!(parse_jest_json(report.as_bytes(), root)
            .expect_err("oversized projected path")
            .contains("case file path"));

        let oversized_name = "n".repeat(MAX_PROJECTED_NAME_BYTES + 1);
        let report = serde_json::json!({
            "testResults": [{
                "name": "/root/example.test.ts",
                "status": "failed",
                "assertionResults": [{
                    "fullName": oversized_name,
                    "status": "failed",
                    "failureMessages": []
                }]
            }]
        })
        .to_string();
        assert!(parse_jest_json(report.as_bytes(), root)
            .expect_err("oversized projected name")
            .contains("case name"));

        let oversized_message = "m".repeat(MAX_PROJECTED_MESSAGE_BYTES + 1);
        let report = serde_json::json!({
            "testResults": [{
                "name": "/root/example.test.ts",
                "status": "failed",
                "assertionResults": [{
                    "fullName": "fails",
                    "status": "failed",
                    "failureMessages": [oversized_message]
                }]
            }]
        })
        .to_string();
        assert!(parse_jest_json(report.as_bytes(), root)
            .expect_err("oversized projected message")
            .contains("case message"));
    }

    #[test]
    fn accepts_exact_aggregate_boundary_and_rejects_one_byte_more() {
        let projected_case = || PhpTestCase {
            name: Some("n".repeat(MAX_PROJECTED_NAME_BYTES)),
            classname: None,
            file: None,
            line: None,
            time: None,
            status: PhpTestStatus::Passed,
            message: None,
        };
        let mut cases = (0..MAX_PROJECTED_TEXT_BYTES / MAX_PROJECTED_NAME_BYTES)
            .map(|_| projected_case())
            .collect::<Vec<_>>();
        validate_projected_test_text(&[suite(cases.clone())])
            .expect("exact aggregate projection boundary");

        cases.push(PhpTestCase {
            name: Some("x".to_string()),
            ..projected_case()
        });
        assert!(validate_projected_test_text(&[suite(cases)])
            .expect_err("oversized aggregate projection")
            .contains("projection text"));
    }

    fn suite(cases: Vec<PhpTestCase>) -> PhpTestSuite {
        PhpTestSuite {
            name: None,
            tests: Some(cases.len() as u64),
            failures: Some(0),
            errors: Some(0),
            skipped: Some(0),
            time: None,
            cases,
        }
    }

    fn report_with_path(path: String, full_name: &str) -> String {
        serde_json::json!({
            "testResults": [{
                "name": path,
                "status": "passed",
                "assertionResults": [{
                    "fullName": full_name,
                    "status": "passed",
                    "failureMessages": []
                }]
            }]
        })
        .to_string()
    }
}
