use std::path::Path;

pub(super) const FALLBACK: &str = "application/octet-stream";

pub(super) const TABLE: &[(&str, &str)] = &[
    ("7z", "application/x-7z-compressed"),
    ("avif", "image/avif"),
    ("bmp", "image/bmp"),
    ("css", "text/css"),
    ("csv", "text/csv"),
    ("doc", "application/msword"),
    (
        "docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    ("gif", "image/gif"),
    ("gz", "application/gzip"),
    ("htm", "text/html"),
    ("html", "text/html"),
    ("jpeg", "image/jpeg"),
    ("jpg", "image/jpeg"),
    ("js", "text/javascript"),
    ("json", "application/json"),
    ("log", "text/plain"),
    ("md", "text/markdown"),
    ("mov", "video/quicktime"),
    ("mp3", "audio/mpeg"),
    ("mp4", "video/mp4"),
    ("pdf", "application/pdf"),
    ("png", "image/png"),
    ("ppt", "application/vnd.ms-powerpoint"),
    (
        "pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ),
    ("rtf", "application/rtf"),
    ("sql", "application/sql"),
    ("svg", "image/svg+xml"),
    ("tar", "application/x-tar"),
    ("tsv", "text/tab-separated-values"),
    ("txt", "text/plain"),
    ("wav", "audio/wav"),
    ("webm", "video/webm"),
    ("webp", "image/webp"),
    ("xls", "application/vnd.ms-excel"),
    (
        "xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
    ("xml", "application/xml"),
    ("yaml", "application/yaml"),
    ("yml", "application/yaml"),
    ("zip", "application/zip"),
];

pub(super) fn for_path(path: &Path) -> &'static str {
    let Some(extension) = path.extension().and_then(|extension| extension.to_str()) else {
        return FALLBACK;
    };
    let extension = extension.to_ascii_lowercase();
    TABLE
        .iter()
        .find(|(known, _)| *known == extension)
        .map_or(FALLBACK, |(_, media_type)| media_type)
}
