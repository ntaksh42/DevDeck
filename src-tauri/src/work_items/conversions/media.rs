pub(crate) fn normalize_image_content_type(content_type: &str) -> Option<&'static str> {
    let media_type = content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    match media_type.as_str() {
        "image/png" => Some("image/png"),
        "image/jpeg" | "image/jpg" => Some("image/jpeg"),
        "image/gif" => Some("image/gif"),
        "image/webp" => Some("image/webp"),
        "image/svg+xml" => Some("image/svg+xml"),
        "image/bmp" => Some("image/bmp"),
        _ => None,
    }
}

pub(crate) fn image_content_type_from_url(url: &str) -> Option<&'static str> {
    let mut parts = url.splitn(2, '?');
    let path = parts.next().unwrap_or(url);
    if let Some(extension) = extension_content_type(path) {
        return Some(extension);
    }
    let query = parts.next()?;
    let file_name = query
        .split('&')
        .find_map(|pair| pair.strip_prefix("fileName="))?;
    extension_content_type(file_name)
}

fn extension_content_type(value: &str) -> Option<&'static str> {
    let value = value.to_ascii_lowercase();
    if value.ends_with(".png") {
        Some("image/png")
    } else if value.ends_with(".jpg") || value.ends_with(".jpeg") {
        Some("image/jpeg")
    } else if value.ends_with(".gif") {
        Some("image/gif")
    } else if value.ends_with(".webp") {
        Some("image/webp")
    } else if value.ends_with(".svg") {
        Some("image/svg+xml")
    } else if value.ends_with(".bmp") {
        Some("image/bmp")
    } else {
        None
    }
}
