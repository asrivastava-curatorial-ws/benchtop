//! Where downloaded runtimes and models live, and how they get there: a
//! streamed download checked against the catalogue's size and SHA-256, unpacked
//! when it is an archive, and written under temporary names until complete.

use std::collections::HashSet;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::catalog::{self, Archive, Item};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub id: String,
    pub stage: &'static str,
    pub received: u64,
    pub total: u64,
    pub message: Option<String>,
}

pub struct Store {
    pub root: PathBuf,
    cancelled: Mutex<HashSet<String>>,
}

impl Store {
    pub fn new(root: PathBuf) -> Self {
        Store {
            root,
            cancelled: Mutex::new(HashSet::new()),
        }
    }

    pub fn folder(&self, item: &Item) -> PathBuf {
        self.root.join(item.id)
    }

    fn marker(&self, item: &Item) -> PathBuf {
        self.folder(item).join(".sha256")
    }

    pub fn is_installed(&self, item: &Item) -> bool {
        let folder = self.folder(item);
        fs::read_to_string(self.marker(item))
            .map(|text| text.trim() == item.download.sha256)
            .unwrap_or(false)
            && catalog::stored_files(item)
                .iter()
                .all(|file| folder.join(file).is_file())
    }

    /// Path of a stored file of an installed item.
    pub fn file(&self, id: &str, name: &str) -> Option<PathBuf> {
        let item = catalog::find(id)?;
        self.is_installed(&item)
            .then(|| self.folder(&item).join(name))
    }

    pub fn remove(&self, item: &Item) -> io::Result<()> {
        let folder = self.folder(item);
        if folder.exists() {
            fs::remove_dir_all(folder)?;
        }
        Ok(())
    }

    pub fn cancel(&self, id: &str) {
        self.cancelled
            .lock()
            .expect("cancel list")
            .insert(id.to_string());
    }

    fn take_cancel(&self, id: &str) -> bool {
        self.cancelled.lock().expect("cancel list").remove(id)
    }

    /// Downloads, verifies and unpacks `item`, trying each URL in turn.
    pub async fn install(
        &self,
        item: &Item,
        client: &reqwest::Client,
        report: &(dyn Fn(Progress) + Sync),
    ) -> Result<(), String> {
        self.take_cancel(item.id);
        let partial_dir = self.root.join(".partial");
        fs::create_dir_all(&partial_dir)
            .map_err(|error| format!("Cannot create {}: {error}", partial_dir.display()))?;
        let partial = partial_dir.join(item.download.file);
        let mut last_error = String::from("no download address");
        for url in item.download.urls {
            match self.fetch(item, url, &partial, client, report).await {
                Ok(()) => {
                    let result = self.unpack(item, &partial, report);
                    let _ = fs::remove_file(&partial);
                    return result;
                }
                Err(error) if error == "cancelled" => {
                    let _ = fs::remove_file(&partial);
                    return Err("Download cancelled.".into());
                }
                Err(error) => last_error = error,
            }
        }
        let _ = fs::remove_file(&partial);
        Err(last_error)
    }

    async fn fetch(
        &self,
        item: &Item,
        url: &str,
        partial: &Path,
        client: &reqwest::Client,
        report: &(dyn Fn(Progress) + Sync),
    ) -> Result<(), String> {
        use tokio::io::AsyncWriteExt;
        let total = item.download.size;
        let mut response = client
            .get(url)
            .send()
            .await
            .map_err(|error| format!("Could not reach {url}: {error}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "{url} answered HTTP {}",
                response.status().as_u16()
            ));
        }
        let mut file = tokio::fs::File::create(partial)
            .await
            .map_err(|error| format!("Cannot write {}: {error}", partial.display()))?;
        let mut hasher = Sha256::new();
        let mut received = 0u64;
        let mut last_report = 0u64;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| format!("The download stopped: {error}"))?
        {
            if self.take_cancel(item.id) {
                return Err("cancelled".into());
            }
            received += chunk.len() as u64;
            if received > total {
                return Err(format!(
                    "{url} sent more data than expected; the file may have changed."
                ));
            }
            hasher.update(&chunk);
            file.write_all(&chunk)
                .await
                .map_err(|error| format!("Cannot write the download: {error}"))?;
            if received - last_report > 512 * 1024 || received == total {
                last_report = received;
                report(Progress {
                    id: item.id.into(),
                    stage: "downloading",
                    received,
                    total,
                    message: None,
                });
            }
        }
        file.flush()
            .await
            .map_err(|error| format!("Cannot write the download: {error}"))?;
        drop(file);
        let digest = hex(&hasher.finalize());
        if received != total || digest != item.download.sha256 {
            return Err(format!(
                "The file from {url} does not match the expected checksum, so it was discarded."
            ));
        }
        Ok(())
    }

    /// Unpacks a verified download (an archive, or a single file) into the item's folder.
    pub fn unpack(
        &self,
        item: &Item,
        source: &Path,
        report: &(dyn Fn(Progress) + Sync),
    ) -> Result<(), String> {
        report(Progress {
            id: item.id.into(),
            stage: "unpacking",
            received: item.download.size,
            total: item.download.size,
            message: None,
        });
        let folder = self.folder(item);
        let staging = self
            .root
            .join(".partial")
            .join(format!("{}.unpack", item.id));
        let _ = fs::remove_dir_all(&staging);
        fs::create_dir_all(&staging)
            .map_err(|error| format!("Cannot create {}: {error}", staging.display()))?;
        let result = (|| -> Result<(), String> {
            match item.download.archive {
                Archive::None => {
                    fs::copy(source, staging.join(item.download.file))
                        .map_err(|error| format!("Cannot copy the model: {error}"))?;
                }
                Archive::TarGz => {
                    extract_tar(flate2::read::GzDecoder::new(open(source)?), item, &staging)?
                }
                Archive::TarBz2 => {
                    extract_tar(bzip2::read::BzDecoder::new(open(source)?), item, &staging)?
                }
                Archive::Zip => extract_zip(source, item, &staging)?,
            }
            for file in catalog::stored_files(item) {
                if !staging.join(file).is_file() {
                    return Err(format!("{} is missing from the download.", file));
                }
            }
            fs::write(staging.join(".sha256"), item.download.sha256)
                .map_err(|error| error.to_string())?;
            let _ = fs::remove_dir_all(&folder);
            fs::rename(&staging, &folder)
                .map_err(|error| format!("Cannot install into {}: {error}", folder.display()))?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&staging);
        }
        report(Progress {
            id: item.id.into(),
            stage: if result.is_ok() { "done" } else { "error" },
            received: item.download.size,
            total: item.download.size,
            message: result.as_ref().err().cloned(),
        });
        result
    }

    /// Installs every catalogue item whose download file is in `folder` and matches its checksum.
    pub fn import_folder(
        &self,
        folder: &Path,
        report: &(dyn Fn(Progress) + Sync),
    ) -> (Vec<String>, Vec<String>) {
        let mut imported = Vec::new();
        let mut rejected = Vec::new();
        for item in catalog::items() {
            let candidate = folder.join(item.download.file);
            if !candidate.is_file() {
                continue;
            }
            match sha256_file(&candidate) {
                Ok((digest, size))
                    if digest == item.download.sha256 && size == item.download.size =>
                {
                    match self.unpack(&item, &candidate, report) {
                        Ok(()) => imported.push(item.id.to_string()),
                        Err(error) => rejected.push(format!("{}: {error}", item.download.file)),
                    }
                }
                Ok(_) => rejected.push(format!(
                    "{}: different from the expected file",
                    item.download.file
                )),
                Err(error) => rejected.push(format!("{}: {error}", item.download.file)),
            }
        }
        (imported, rejected)
    }
}

fn open(path: &Path) -> Result<fs::File, String> {
    fs::File::open(path).map_err(|error| format!("Cannot open {}: {error}", path.display()))
}

fn keep_name(item: &Item, member: &str) -> Option<&'static str> {
    let member = member.replace('\\', "/");
    item.download
        .keep
        .iter()
        .find(|(suffix, _)| member.ends_with(&format!("/{suffix}")) || member == *suffix)
        .map(|(_, stored)| *stored)
}

fn extract_tar(reader: impl Read, item: &Item, staging: &Path) -> Result<(), String> {
    let mut archive = tar::Archive::new(reader);
    for entry in archive
        .entries()
        .map_err(|error| format!("Cannot read the archive: {error}"))?
    {
        let mut entry = entry.map_err(|error| format!("Cannot read the archive: {error}"))?;
        let member = entry
            .path()
            .map_err(|error| error.to_string())?
            .to_string_lossy()
            .into_owned();
        if let Some(stored) = keep_name(item, &member) {
            let target = staging.join(stored);
            let mut out = fs::File::create(&target)
                .map_err(|error| format!("Cannot write {}: {error}", target.display()))?;
            io::copy(&mut entry, &mut out)
                .map_err(|error| format!("Cannot unpack {member}: {error}"))?;
        }
    }
    Ok(())
}

fn extract_zip(source: &Path, item: &Item, staging: &Path) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(open(source)?)
        .map_err(|error| format!("Cannot read the archive: {error}"))?;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Cannot read the archive: {error}"))?;
        let member = entry.name().to_string();
        if let Some(stored) = keep_name(item, &member) {
            let target = staging.join(stored);
            let mut out = fs::File::create(&target)
                .map_err(|error| format!("Cannot write {}: {error}", target.display()))?;
            io::copy(&mut entry, &mut out)
                .map_err(|error| format!("Cannot unpack {member}: {error}"))?;
        }
    }
    Ok(())
}

pub fn sha256_file(path: &Path) -> io::Result<(String, u64)> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    let mut size = 0u64;
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        size += read as u64;
        hasher.update(&buffer[..read]);
    }
    Ok((hex(&hasher.finalize()), size))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::catalog::{Download, Kind};

    fn test_item(
        archive: Archive,
        keep: &'static [(&'static str, &'static str)],
        sha256: &'static str,
        size: u64,
    ) -> Item {
        Item {
            id: "test",
            kind: Kind::Background,
            name: "Test",
            description: "",
            licence: "MIT",
            homepage: "",
            default: false,
            multilingual: false,
            download: Download {
                file: "test.bin",
                urls: &[],
                sha256,
                size,
                archive,
                keep,
            },
        }
    }

    #[test]
    fn unpacks_tar_gz_members_and_marks_the_install() {
        let dir = std::env::temp_dir().join(format!("benchtop-store-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        // Build a .tar.gz holding pkg/lib/libx.so and an unrelated file.
        let archive_path = dir.join("pkg.tgz");
        {
            let file = fs::File::create(&archive_path).unwrap();
            let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::fast());
            let mut builder = tar::Builder::new(encoder);
            for (name, body) in [
                ("pkg/lib/libx.so", b"library".as_slice()),
                ("pkg/README", b"ignore me".as_slice()),
            ] {
                let mut header = tar::Header::new_gnu();
                header.set_size(body.len() as u64);
                header.set_mode(0o644);
                header.set_cksum();
                builder.append_data(&mut header, name, body).unwrap();
            }
            builder.into_inner().unwrap().finish().unwrap();
        }
        let (digest, size) = sha256_file(&archive_path).unwrap();
        let digest: &'static str = Box::leak(digest.into_boxed_str());
        let item = test_item(Archive::TarGz, &[("lib/libx.so", "lib.so")], digest, size);
        let store = Store::new(dir.join("store"));
        store.unpack(&item, &archive_path, &|_| {}).unwrap();
        assert!(store.is_installed(&item));
        assert_eq!(
            fs::read(store.folder(&item).join("lib.so")).unwrap(),
            b"library"
        );
        assert!(!store.folder(&item).join("README").exists());
        store.remove(&item).unwrap();
        assert!(!store.is_installed(&item));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn import_skips_files_that_do_not_match() {
        let dir = std::env::temp_dir().join(format!("benchtop-import-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("u2netp.onnx"), b"not the model").unwrap();
        let store = Store::new(dir.join("store"));
        let (imported, rejected) = store.import_folder(&dir, &|_| {});
        assert!(imported.is_empty());
        assert_eq!(rejected.len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }
}
