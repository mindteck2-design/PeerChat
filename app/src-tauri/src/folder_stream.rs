use serde::Serialize;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use serde_json::json;
use crate::util::{PLAIN_CHUNK_BYTES, MAX_CHUNK_BYTES, explain_io};
use crate::peer_http;

#[derive(Debug, Serialize, Clone)]
pub struct FolderMeta {
    pub path: String,
    pub name: String,
    pub total_files: u64,
    pub total_bytes: u64,
}

pub fn scan_folder_meta(app: Option<&AppHandle>, path_str: &str) -> Result<FolderMeta, String> {
    let root = Path::new(path_str);
    if !root.exists() {
        return Err("Folder does not exist".into());
    }
    if !root.is_dir() {
        return Err("Path is not a directory".into());
    }
    let name = root
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("folder")
        .to_string();

    let root_path = if cfg!(windows) {
        root.canonicalize().unwrap_or_else(|_| root.to_path_buf())
    } else {
        root.to_path_buf()
    };

    let mut total_files = 0u64;
    let mut total_bytes = 0u64;
    let mut last_emit = Instant::now();

    for entry in walkdir::WalkDir::new(&root_path)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let ft = entry.file_type();
        if ft.is_file() {
            if let Ok(meta) = entry.metadata() {
                total_files += 1;
                total_bytes += meta.len();

                if total_files % 1000 == 0 || last_emit.elapsed() >= std::time::Duration::from_millis(200) {
                    last_emit = Instant::now();
                    if let Some(app) = app {
                        let _ = app.emit(
                            "folder-scan-progress",
                            json!({
                                "path": path_str,
                                "total_files": total_files,
                                "total_bytes": total_bytes,
                            }),
                        );
                    }
                }
            }
        }
    }

    if let Some(app) = app {
        let _ = app.emit(
            "folder-scan-progress",
            json!({
                "path": path_str,
                "total_files": total_files,
                "total_bytes": total_bytes,
            }),
        );
    }

    Ok(FolderMeta {
        path: path_str.to_string(),
        name,
        total_files,
        total_bytes,
    })
}

pub struct StreamingChunkWriter<'a> {
    file_id: String,
    staging_dir: PathBuf,
    content_key: [u8; 32],
    chunk_index: u32,
    expected_chunks: u32,
    buffer: Vec<u8>,
    hasher: Sha256,
    total_plain_bytes: u64,
    app: Option<&'a AppHandle>,
    last_emit: Instant,
    pause_flag: Arc<AtomicBool>,
    cancel_flag: Arc<AtomicBool>,
}

impl<'a> StreamingChunkWriter<'a> {
    pub fn new(
        file_id: String,
        staging_dir: PathBuf,
        content_key: [u8; 32],
        expected_chunks: u32,
        app: Option<&'a AppHandle>,
        pause_flag: Arc<AtomicBool>,
        cancel_flag: Arc<AtomicBool>,
    ) -> Self {
        Self {
            file_id,
            staging_dir,
            content_key,
            chunk_index: 0,
            expected_chunks: expected_chunks.max(1),
            buffer: Vec::with_capacity(PLAIN_CHUNK_BYTES + 64 * 1024),
            hasher: Sha256::new(),
            total_plain_bytes: 0,
            app,
            last_emit: Instant::now(),
            pause_flag,
            cancel_flag,
        }
    }

    fn flush_chunk(&mut self, is_final: bool) -> io::Result<()> {
        if self.buffer.is_empty() {
            return Ok(());
        }
        let take_len = if is_final {
            self.buffer.len()
        } else {
            PLAIN_CHUNK_BYTES
        };

        let chunk_slice = &self.buffer[..take_len];
        self.hasher.update(chunk_slice);
        self.total_plain_bytes += take_len as u64;

        let (nonce_b64, ciphertext) = peer_http::encrypt_file_chunk(
            &self.content_key,
            chunk_slice,
            Some(self.chunk_index),
        ).map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;

        if ciphertext.len() > MAX_CHUNK_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                format!(
                    "encrypted chunk exceeds {}",
                    crate::util::format_bytes(MAX_CHUNK_BYTES as u64)
                ),
            ));
        }

        std::fs::write(
            self.staging_dir.join(format!("{}.chunk", self.chunk_index)),
            &ciphertext,
        )?;
        std::fs::write(
            self.staging_dir.join(format!("{}.nonce", self.chunk_index)),
            nonce_b64.as_bytes(),
        )?;

        self.chunk_index += 1;
        self.buffer.drain(..take_len);

        if let Some(app) = self.app {
            if is_final
                || self.chunk_index == 1
                || self.last_emit.elapsed() >= std::time::Duration::from_millis(250)
            {
                self.last_emit = Instant::now();
                let total = if is_final {
                    self.chunk_index
                } else {
                    std::cmp::max(self.expected_chunks, self.chunk_index)
                };
                let _ = app.emit(
                    "file-stage-progress",
                    json!({
                        "file_id": &self.file_id,
                        "done": self.chunk_index,
                        "total": total,
                        "bytes_done": self.total_plain_bytes,
                    }),
                );
            }
        }
        Ok(())
    }

    pub fn finish(mut self) -> io::Result<(String, u64, u32)> {
        while !self.buffer.is_empty() {
            self.flush_chunk(true)?;
        }
        let digest = hex::encode(self.hasher.finalize());
        if let Some(app) = self.app {
            let _ = app.emit(
                "file-stage-progress",
                json!({
                    "file_id": &self.file_id,
                    "done": self.chunk_index,
                    "total": self.chunk_index,
                    "bytes_done": self.total_plain_bytes,
                }),
            );
        }
        Ok((digest, self.total_plain_bytes, self.chunk_index))
    }
}

impl<'a> Write for StreamingChunkWriter<'a> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let mut offset = 0;
        while offset < buf.len() {
            while self.pause_flag.load(Ordering::SeqCst) {
                if self.cancel_flag.load(Ordering::SeqCst) {
                    return Err(io::Error::new(io::ErrorKind::Interrupted, "aborted"));
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            if self.cancel_flag.load(Ordering::SeqCst) {
                return Err(io::Error::new(io::ErrorKind::Interrupted, "aborted"));
            }

            let needed = PLAIN_CHUNK_BYTES.saturating_sub(self.buffer.len());
            let take = std::cmp::min(needed, buf.len() - offset);
            self.buffer.extend_from_slice(&buf[offset..offset + take]);
            offset += take;

            if self.buffer.len() >= PLAIN_CHUNK_BYTES {
                self.flush_chunk(false)?;
            }
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

pub fn stage_folder_stream(
    app: Option<&AppHandle>,
    file_id: &str,
    folder_path: &str,
    staging_dir: &Path,
    content_key: [u8; 32],
    expected_chunks: u32,
    cancel_flag: Arc<AtomicBool>,
    pause_flag: Arc<AtomicBool>,
) -> Result<(String, u64, u32), String> {
    let root = Path::new(folder_path);
    if !root.is_dir() {
        return Err("Source folder missing or not a directory".into());
    }

    let root_canon = if cfg!(windows) {
        root.canonicalize().unwrap_or_else(|_| root.to_path_buf())
    } else {
        root.to_path_buf()
    };

    let writer = StreamingChunkWriter::new(
        file_id.to_string(),
        staging_dir.to_path_buf(),
        content_key,
        expected_chunks,
        app,
        pause_flag,
        cancel_flag,
    );

    let mut builder = tar::Builder::new(writer);

    for entry in walkdir::WalkDir::new(&root_canon)
        .follow_links(false)
        .into_iter()
    {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                eprintln!("Warning: skipping unreadable entry in walkdir: {}", e);
                continue;
            }
        };

        let path = entry.path();
        if path == root_canon {
            continue;
        }

        let rel_path = match path.strip_prefix(&root_canon) {
            Ok(p) => p,
            Err(_) => continue,
        };

        let rel_str = rel_path.to_string_lossy().replace('\\', "/");
        let clean_rel = rel_str.trim_start_matches('/');
        if clean_rel.is_empty() {
            continue;
        }

        let ft = entry.file_type();
        if ft.is_dir() {
            let _ = builder.append_dir(clean_rel, path);
        } else if ft.is_file() {
            if let Ok(mut f) = std::fs::File::open(path) {
                builder.append_file(clean_rel, &mut f).map_err(explain_io)?;
            }
        } else if ft.is_symlink() {
            if let Ok(target) = std::fs::read_link(path) {
                let mut header = tar::Header::new_gnu();
                header.set_entry_type(tar::EntryType::Symlink);
                header.set_size(0);
                let target_str = target.to_string_lossy().replace('\\', "/");
                if header.set_link_name(&target_str).is_ok() {
                    let _ = builder.append_data(&mut header, clean_rel, std::io::empty());
                }
            }
        }
    }

    builder.finish().map_err(explain_io)?;
    let writer = builder.into_inner().map_err(explain_io)?;
    let (digest, bytes_written, chunk_count) = writer.finish().map_err(explain_io)?;
    Ok((digest, bytes_written, chunk_count))
}

pub fn finalize_folder_receive_inner(
    app: Option<&AppHandle>,
    temp_path: &Path,
    dest_dir: &Path,
    folder_name: &str,
    file_id: &str,
) -> Result<PathBuf, String> {
    if !temp_path.is_file() {
        return Err("temp file missing".into());
    }
    let safe_name = crate::util::safe_download_name(folder_name);
    let safe_name = if safe_name.is_empty() || safe_name == "." || safe_name == ".." {
        "folder"
    } else {
        &safe_name
    };

    std::fs::create_dir_all(dest_dir).map_err(explain_io)?;
    let mut target = dest_dir.join(safe_name);
    if target.exists() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        target = dest_dir.join(format!("{}-{}", safe_name, stamp));
    }
    std::fs::create_dir_all(&target).map_err(explain_io)?;

    let f = std::fs::File::open(temp_path).map_err(explain_io)?;
    let mut archive = tar::Archive::new(f);
    let mut count = 0u64;
    let mut last_emit = Instant::now();

    for entry in archive.entries().map_err(explain_io)? {
        let mut entry = match entry {
            Ok(e) => e,
            Err(e) => {
                eprintln!("Warning: skipping corrupted tar entry: {}", e);
                continue;
            }
        };

        let path = entry.path().map_err(explain_io)?.into_owned();
        if path.is_absolute()
            || path
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir | std::path::Component::Prefix(_)))
        {
            continue;
        }

        let out_path = target.join(&path);

        #[cfg(windows)]
        let out_path = {
            let p_str = out_path.to_string_lossy();
            if p_str.len() >= 240 && !p_str.starts_with(r"\\?\") {
                if let Ok(canon_parent) = out_path.parent().unwrap_or(&target).canonicalize() {
                    let file_name = out_path.file_name().unwrap_or_default();
                    canon_parent.join(file_name)
                } else {
                    out_path
                }
            } else {
                out_path
            }
        };

        if let Some(parent) = out_path.parent() {
            if !parent.exists() {
                let _ = std::fs::create_dir_all(parent);
            }
        }

        if let Err(e) = entry.unpack(&out_path) {
            eprintln!("Notice: could not unpack {}: {}", out_path.display(), e);
        }

        count += 1;
        if count % 200 == 0 || last_emit.elapsed() >= std::time::Duration::from_millis(250) {
            last_emit = Instant::now();
            if let Some(app) = app {
                let _ = app.emit(
                    "folder-unpack-progress",
                    json!({
                        "file_id": file_id,
                        "unpacked_files": count,
                    }),
                );
            }
        }
    }

    let _ = std::fs::remove_file(temp_path);
    Ok(target)
}
