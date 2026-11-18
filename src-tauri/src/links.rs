//! The project's releases on GitHub: which one is newest (for `benchtop version
//! --check`) and opening the releases page in the system's web browser.  Only
//! that fixed address, and one release's page under it, can be opened, so the
//! app cannot be used to launch arbitrary links.

use std::process::Command;

use serde_json::Value;

pub(crate) const RELEASES: &str = "https://github.com/asrivastava-curatorial-ws/benchtop/releases";
pub(crate) const RELEASES_API: &str =
    "https://api.github.com/repos/asrivastava-curatorial-ws/benchtop/releases?per_page=30";

/// The releases page, or one release's page when `tag` is a release tag.
pub(crate) fn release_url(tag: Option<&str>) -> Result<String, String> {
    match tag {
        None => Ok(RELEASES.to_string()),
        Some(tag)
            if !tag.is_empty()
                && tag.len() <= 64
                && tag
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)) =>
        {
            Ok(format!("{RELEASES}/tag/{tag}"))
        }
        Some(_) => Err("That is not a release tag.".to_string()),
    }
}

/// "3.1.0" or "v3.1.0" as numbers; pre-releases and anything else give None.
pub(crate) fn parse_version(text: &str) -> Option<(u64, u64, u64)> {
    let mut parts = text.trim().trim_start_matches('v').split('.');
    let mut next = || parts.next()?.parse::<u64>().ok();
    let version = (next()?, next()?, next()?);
    parts.next().is_none().then_some(version)
}

/// The newest app release in GitHub's list of releases: its version and page.
/// Drafts, pre-releases and tags that are not versions (the model mirror) are skipped.
pub(crate) fn newest_release(list: &Value) -> Option<(String, String)> {
    list.as_array()?
        .iter()
        .filter(|item| {
            !item["draft"].as_bool().unwrap_or(false)
                && !item["prerelease"].as_bool().unwrap_or(false)
        })
        .filter_map(|item| {
            let tag = item["tag_name"].as_str()?;
            let version = parse_version(tag)?;
            let page = item["html_url"]
                .as_str()
                .filter(|url| url.starts_with(&format!("{RELEASES}/")))
                .map(str::to_string)
                .or_else(|| release_url(Some(tag)).ok())?;
            Some((version, page))
        })
        .max_by_key(|(version, _)| *version)
        .map(|((major, minor, patch), page)| (format!("{major}.{minor}.{patch}"), page))
}

#[tauri::command]
pub fn open_release_page(tag: Option<String>) -> Result<(), String> {
    let url = release_url(tag.as_deref())?;
    let program = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "explorer"
    } else {
        "xdg-open"
    };
    let mut child = Command::new(program)
        .arg(&url)
        .spawn()
        .map_err(|error| format!("Could not open the web browser: {error}"))?;
    // Collect the launcher's exit status so it does not linger as a zombie process.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_release_pages_can_be_opened() {
        assert_eq!(release_url(None).unwrap(), RELEASES);
        assert_eq!(
            release_url(Some("v3.1.0")).unwrap(),
            format!("{RELEASES}/tag/v3.1.0")
        );
        for bad in ["", "v1/../../evil", "v1 2", "https://evil.example", "a?b=c"] {
            assert!(release_url(Some(bad)).is_err(), "{bad}");
        }
    }

    #[test]
    fn versions_parse_strictly() {
        assert_eq!(parse_version("v3.10.2"), Some((3, 10, 2)));
        assert_eq!(parse_version("3.1.0"), Some((3, 1, 0)));
        assert_eq!(parse_version("3.1"), None);
        assert_eq!(parse_version("3.1.0-beta.1"), None);
        assert_eq!(parse_version("models-v1"), None);
    }

    #[test]
    fn the_newest_published_release_wins() {
        let list = json!([
            {"tag_name": "models-v1", "html_url": format!("{RELEASES}/tag/models-v1")},
            {"tag_name": "v3.10.0", "draft": true},
            {"tag_name": "v3.9.0", "prerelease": true},
            {"tag_name": "v3.2.0", "html_url": "https://evil.example/v3.2.0"},
            {"tag_name": "v3.1.0", "html_url": format!("{RELEASES}/tag/v3.1.0")},
            {"tag_name": "v2.0.0"},
        ]);
        assert_eq!(
            newest_release(&list),
            Some(("3.2.0".to_string(), format!("{RELEASES}/tag/v3.2.0")))
        );
        assert_eq!(newest_release(&json!([])), None);
        assert_eq!(newest_release(&json!({"message": "rate limited"})), None);
    }
}
