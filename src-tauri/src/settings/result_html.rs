use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::LazyLock;

use encoding_rs::{Encoding, UTF_8};
use regex::Regex;
use serde::Serialize;

use crate::error::Result;

const MAX_HTML_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultHtml {
    pub html: String,
    pub warning: Option<String>,
    pub too_large: bool,
}

pub(super) fn read_result_html(path: &Path) -> Result<ResultHtml> {
    let file = File::open(path)?;
    if file.metadata()?.len() > MAX_HTML_BYTES {
        return Ok(too_large());
    }
    // Bound the read as well, in case an agent grows the file after metadata().
    let mut bytes = Vec::new();
    file.take(MAX_HTML_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_HTML_BYTES {
        return Ok(too_large());
    }
    let bom = Encoding::for_bom(&bytes).map(|(encoding, _)| encoding);
    let label = if bom.is_none() {
        meta_charset(&bytes)
    } else {
        None
    };
    let declared = label
        .as_deref()
        .and_then(|label| Encoding::for_label(label.as_bytes()));
    let encoding = bom.or(declared).unwrap_or(UTF_8);
    let (html, _, errors) = encoding.decode(&bytes);
    let warning = if bom.is_none() && declared.is_none() && (label.is_some() || errors) {
        Some("文字コードを判別できませんでした。UTF-8 として表示しています。".to_string())
    } else if errors {
        Some("文字コードに不正なバイト列があり、一部の文字を置換しました。".to_string())
    } else {
        None
    };
    Ok(ResultHtml {
        html: html.into_owned(),
        warning,
        too_large: false,
    })
}

fn too_large() -> ResultHtml {
    ResultHtml {
        html: String::new(),
        warning: None,
        too_large: true,
    }
}

fn meta_charset(bytes: &[u8]) -> Option<String> {
    // Encoding declarations belong near the start; never scan a whole report.
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(8192)]);
    static TAGS: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(
            r#"(?is)<!--.*?-->|<script\b[^>]*>.*?</script\s*>|<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>"#,
        )
        .unwrap()
    });
    static ATTRS: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r#"(?i)([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))"#).unwrap()
    });
    static CHARSET: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r#"(?i)\bcharset\s*=\s*([^\s;"']+)"#).unwrap());
    for tag in TAGS.find_iter(&head) {
        if !tag.as_str().to_ascii_lowercase().starts_with("<meta") {
            continue;
        }
        let mut content = None;
        let mut http_equiv = false;
        for attr in ATTRS.captures_iter(tag.as_str()) {
            let value = attr
                .get(2)
                .or_else(|| attr.get(3))
                .or_else(|| attr.get(4))
                .unwrap()
                .as_str();
            match attr[1].to_ascii_lowercase().as_str() {
                "charset" => return Some(value.to_string()),
                "http-equiv" => http_equiv = value.eq_ignore_ascii_case("content-type"),
                "content" => content = Some(value),
                _ => {}
            }
        }
        if http_equiv {
            if let Some(charset) = content.and_then(|value| CHARSET.captures(value)) {
                return Some(charset[1].to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests;
