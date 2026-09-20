use super::*;
use std::fs;
struct TempDir(std::path::PathBuf);
impl TempDir {
    fn path(&self) -> &Path {
        &self.0
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn fixture() -> (TempDir, File) {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let dir = TempDir(std::env::temp_dir().join(format!(
        "codevo-html-preview-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )));
    fs::create_dir(&dir.0).unwrap();
    fs::create_dir(dir.path().join("report")).unwrap();
    fs::write(dir.path().join("report/index.html"), "disk HTML").unwrap();
    let root = File::open(dir.path()).unwrap();
    (dir, root)
}
#[test]
fn captures_dirty_html_and_parent_assets_without_crawling_unrelated_files() {
    let (dir, root) = fixture();
    fs::write(
        dir.path().join("base.css"),
        "body{background:url('icon.png')}",
    )
    .unwrap();
    fs::write(dir.path().join("icon.png"), b"image").unwrap();
    fs::write(dir.path().join("report/sort.js"), "window.sort=1").unwrap();
    fs::write(dir.path().join("secret.js"), "secret").unwrap();
    let (html, assets) = snapshot(
        &root,
        "report/index.html",
        "<link href='../base.css'><script src='sort.js'></script><b>dirty</b>",
    )
    .unwrap();
    assert!(html.contains("href='./base.css'"));
    assert!(html.contains("src='./report/sort.js'"));
    assert!(html.contains("dirty"));
    assert_eq!(assets.len(), 3);
    assert!(!assets.contains_key("secret.js"));
    fs::write(dir.path().join("base.css"), "changed").unwrap();
    assert_eq!(
        &*assets["base.css"].bytes,
        b"body{background:url('icon.png')}"
    );
}
#[test]
fn rejects_symlinks_missing_assets_oversized_assets_and_escape() {
    let (dir, root) = fixture();
    fs::write(dir.path().join("big.js"), vec![b'a'; HTML_LIMIT + 1]).unwrap();
    std::os::unix::fs::symlink("../big.js", dir.path().join("report/link.js")).unwrap();
    for html in [
        "<script src='../big.js'></script>",
        "<script src='link.js'></script>",
        "<link href='missing.css'>",
    ] {
        assert!(snapshot(&root, "report/index.html", html).is_err());
    }
    assert_eq!(reference_path("report/index.html", "../../secret.js"), None);
    assert_eq!(reference_path("report/index.html", "../config.neon"), None);
    assert_eq!(
        reference_path("report/index.html", "https://evil/x.js"),
        None
    );
}
#[test]
fn bounds_reference_count_and_css_cycles() {
    let (dir, root) = fixture();
    fs::write(dir.path().join("report/a.css"), "@import 'a.css';").unwrap();
    assert_eq!(
        snapshot(&root, "report/index.html", "<link href='a.css'>")
            .unwrap()
            .1
            .len(),
        1
    );
    assert!(snapshot(
        &root,
        "report/index.html",
        &"<link href='a.css'>".repeat(129)
    )
    .is_err());
}
#[test]
fn paths_and_requests_are_closed() {
    for value in [
        "../a.js",
        "/a.js",
        "a//b.js",
        "%2e%2e/a.js",
        "a%2fb.js",
        "a%5cb.js",
        ".env",
        "a\0.js",
        "a%252e.js",
    ] {
        assert!(decode_asset_path(value).is_none(), "{value}");
    }
    assert_eq!(
        decode_asset_path("my%20file.css"),
        Some("my file.css".into())
    );
    assert!(serde_json::from_str::<CreateRequest>(
        r#"{"workspaceId":"w","relativePath":"x.html","html":"x","extra":1}"#
    )
    .is_err());
    let request = CreateRequest {
        workspace_id: "w".into(),
        relative_path: "x.html".into(),
        html: "x".into(),
    };
    assert!(validate(&request).is_ok());
}
#[test]
fn replaced_workspace_path_is_rejected_but_never_read() {
    let (dir, root) = fixture();
    let registry = WorkspaceRegistry::default();
    let descriptor = registry.register(dir.path()).unwrap();
    assert!(check_owner(&registry, &descriptor, &root).is_ok());
    let moved = dir.path().with_extension("moved");
    fs::rename(dir.path(), &moved).unwrap();
    fs::create_dir(dir.path()).unwrap();
    assert!(check_owner(&registry, &descriptor, &root).is_err());
    fs::remove_dir_all(moved).unwrap();
}
#[test]
fn unquoted_assets_query_and_svg_fragments_survive_rewrite() {
    let (dir, root) = fixture();
    fs::write(dir.path().join("icon.svg"), "<svg/>").unwrap();
    let (html, assets) =
        snapshot(&root, "report/index.html", "<img src=../icon.svg?v=1#icon>").unwrap();
    assert_eq!(html, "<img src=./icon.svg?v=1#icon>");
    assert_eq!(assets.len(), 1);
    let request = CreateRequest {
        workspace_id: "w".into(),
        relative_path: "x.HTML".into(),
        html: "x".into(),
    };
    assert!(validate(&request).is_ok());
}
#[test]
fn comments_text_and_script_literals_are_not_asset_requests() {
    let (_dir, root) = fixture();
    let html = "<!-- <link href='missing.css'> --><pre>src='missing.js'</pre><script>const example = `src='missing.js'`;</script><textarea><img src='missing.png'></textarea>";
    let (rewritten, assets) = snapshot(&root, "report/index.html", html).unwrap();
    assert_eq!(rewritten, html);
    assert!(assets.is_empty());
}
#[test]
fn data_attributes_quoted_examples_and_css_comments_do_not_request_assets() {
    let (_dir, root) = fixture();
    let html = "<div data-src='missing.png' title=\"src='missing.css'\"></div><style>/* url(missing.png) */ body {color:red;content:\"url(missing.png)\"}</style>";
    let (rewritten, assets) = snapshot(&root, "report/index.html", html).unwrap();
    assert_eq!(rewritten, html);
    assert!(assets.is_empty());
}
#[test]
fn aggregate_bytes_and_nested_stylesheets_have_separate_limits() {
    let (dir, root) = fixture();
    for index in 0..=DEPTH_LIMIT + 1 {
        fs::write(
            dir.path().join(format!("report/{index}.css")),
            format!("@import '{}.css';", index + 1),
        )
        .unwrap();
    }
    assert!(snapshot(&root, "report/index.html", "<link href='0.css'>")
        .err()
        .unwrap()
        .contains("nesting"));
    let mut html = String::new();
    for index in 0..8 {
        fs::write(
            dir.path().join(format!("report/{index}.js")),
            vec![b'x'; HTML_LIMIT],
        )
        .unwrap();
        html.push_str(&format!("<script src='{index}.js'></script>"));
    }
    assert!(snapshot(&root, "report/index.html", &html)
        .err()
        .unwrap()
        .contains("16 MiB"));
}
#[test]
fn hardlinked_assets_and_foreign_registered_roots_fail_closed() {
    let (dir, root) = fixture();
    let (foreign, foreign_root) = fixture();
    fs::write(dir.path().join("report/original.js"), "x").unwrap();
    fs::hard_link(
        dir.path().join("report/original.js"),
        dir.path().join("report/alias.js"),
    )
    .unwrap();
    assert!(snapshot(
        &root,
        "report/index.html",
        "<script src='alias.js'></script>"
    )
    .is_err());
    let registry = WorkspaceRegistry::default();
    let descriptor = registry.register(dir.path()).unwrap();
    let _other = registry.register(foreign.path()).unwrap();
    assert!(check_owner(&registry, &descriptor, &foreign_root).is_err());
}
