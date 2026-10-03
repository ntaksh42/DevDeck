use super::*;
use crate::db::AppDatabase;
use crate::settings::{
    GetReviewResultPreviewInput, GetWorkItemResultPreviewInput, SettingsService,
};
use encoding_rs::SHIFT_JIS;

fn read_bytes(bytes: &[u8]) -> ResultHtml {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("result.html");
    std::fs::write(&path, bytes).unwrap();
    read_result_html(&path).unwrap()
}

#[test]
fn decodes_utf8_and_shift_jis_meta_variants() {
    let html = "<p>日本語の調査結果</p>";
    let result = read_bytes(html.as_bytes());
    assert_eq!(result.html, html);
    assert!(result.warning.is_none());
    for meta in [
        "<meta charset=\"shift_jis\">",
        "<META CHARSET = 'Shift_JIS'>",
        "<meta charset=shift_jis>",
        "<meta content='text/html; charset=shift_jis' http-equiv='Content-Type'>",
    ] {
        let html = format!("{meta}{html}");
        let (bytes, _, errors) = SHIFT_JIS.encode(&html);
        assert!(!errors);
        let result = read_bytes(&bytes);
        assert_eq!(result.html, html);
        assert!(result.warning.is_none());
        assert!(!result.too_large);
    }
}

#[test]
fn bom_takes_precedence_and_is_removed() {
    let html = "<meta charset=shift_jis><p>日本語</p>";
    let result = read_bytes(&[b"\xef\xbb\xbf".as_slice(), html.as_bytes()].concat());
    assert_eq!(result.html, html);
    for little_endian in [true, false] {
        let mut bytes = if little_endian {
            vec![0xff, 0xfe]
        } else {
            vec![0xfe, 0xff]
        };
        for unit in html.encode_utf16() {
            bytes.extend(if little_endian {
                unit.to_le_bytes()
            } else {
                unit.to_be_bytes()
            });
        }
        let result = read_bytes(&bytes);
        assert_eq!(result.html, html);
        assert!(result.warning.is_none());
    }
}

#[test]
fn unknown_or_missing_encoding_falls_back_with_warning() {
    for bytes in [
        b"<p>\xff</p>".as_slice(),
        b"<meta charset=unknown><p>\xff</p>".as_slice(),
    ] {
        let result = read_bytes(bytes);
        assert!(result.html.contains('\u{fffd}'));
        assert!(result
            .warning
            .unwrap()
            .contains("文字コードを判別できませんでした"));
    }
    let result = read_bytes(b"<meta charset=utf-8><p>\xff</p>");
    assert!(result.warning.unwrap().contains("不正なバイト列"));
}

#[test]
fn ignores_charset_text_outside_meta_declarations() {
    let html = "<!-- <meta charset=shift_jis> --><script>const x = '<meta charset=shift_jis>';</script><p>日本語</p>";
    assert_eq!(read_bytes(html.as_bytes()).html, html);
}

#[test]
fn enforces_size_boundary_without_returning_large_html() {
    let bytes = vec![b'a'; MAX_HTML_BYTES as usize];
    let result = read_bytes(&bytes);
    assert_eq!(result.html.len(), MAX_HTML_BYTES as usize);
    assert!(!result.too_large);
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("large.html");
    File::create(&path)
        .unwrap()
        .set_len(MAX_HTML_BYTES + 1)
        .unwrap();
    let result = read_result_html(&path).unwrap();
    assert!(result.too_large);
    assert!(result.html.is_empty());
    assert!(result.warning.is_none());
}

#[test]
fn both_services_decode_shift_jis_and_return_large_file_path() {
    let temp = tempfile::tempdir().unwrap();
    let db = AppDatabase::new(temp.path().join("test.sqlite3"));
    db.initialize().unwrap();
    let mut settings = db.get_app_settings().unwrap();
    let folder = temp.path().display().to_string();
    settings.review_result_folder_path = Some(folder.clone());
    settings.work_item_result_folder_path = Some(folder);
    db.update_app_settings(settings).unwrap();
    let service = SettingsService::new(db);
    let path = temp.path().join("PR42-result.html");
    let html = "<meta charset=shift_jis><p>日本語</p>";
    let (bytes, _, _) = SHIFT_JIS.encode(html);
    std::fs::write(&path, bytes).unwrap();
    let review = service
        .review_result_preview(GetReviewResultPreviewInput {
            pull_request_id: 42,
        })
        .unwrap()
        .unwrap();
    let work_item = service
        .work_item_result_preview(GetWorkItemResultPreviewInput { work_item_id: 42 })
        .unwrap()
        .unwrap();
    assert_eq!(review.content.html, html);
    assert_eq!(work_item.content.html, html);
    let json = serde_json::to_value(review).unwrap();
    assert_eq!(json["html"], html);
    assert_eq!(json["tooLarge"], false);
    assert!(json["warning"].is_null());

    File::create(&path)
        .unwrap()
        .set_len(MAX_HTML_BYTES + 1)
        .unwrap();
    let review = service
        .review_result_preview(GetReviewResultPreviewInput {
            pull_request_id: 42,
        })
        .unwrap()
        .unwrap();
    let work_item = service
        .work_item_result_preview(GetWorkItemResultPreviewInput { work_item_id: 42 })
        .unwrap()
        .unwrap();
    for (file_path, content) in [
        (review.file_path, review.content),
        (work_item.file_path, work_item.content),
    ] {
        assert_eq!(file_path, path.display().to_string());
        assert!(content.too_large);
        assert!(content.html.is_empty());
    }
}
