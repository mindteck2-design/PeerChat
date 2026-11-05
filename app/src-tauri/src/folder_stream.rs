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
    files_done: u64,
    stage_ready_emitted: bool,
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
            files_done: 0,
            stage_ready_emitted: false,
        }
    }

    pub fn set_files_done(&mut self, n: u64) {
        self.files_done = n;
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

        if !self.stage_ready_emitted {
            self.stage_ready_emitted = true;
            if let Some(app) = self.app {
                let _ = app.emit(
                    "folder-stage-ready",
                    json!({ "file_id": &self.file_id }),
                );
            }
        }

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
                        "files_done": self.files_done,
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
                    "files_done": self.files_done,
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

#[allow(dead_code)]
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

const RAW_MAGIC: &[u8] = b"PCD1";
const KIND_END: u8 = 0;
const KIND_DIR: u8 = 1;
const KIND_FILE: u8 = 2;
const KIND_LINK: u8 = 3;

fn rel_is_safe(rel: &str) -> bool {
    if rel.is_empty() || rel.len() > 32_000 {
        return false;
    }
    if rel.starts_with('/') || rel.starts_with('\\') {
        return false;
    }
    rel.split(['/', '\\']).all(|p| !p.is_empty() && p != "." && p != ".." && !p.contains(':'))
}

fn write_entry_header(w: &mut impl Write, kind: u8, rel: &str, size: u64) -> io::Result<()> {
    let bytes = rel.as_bytes();
    if bytes.len() > u16::MAX as usize {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "path too long"));
    }
    w.write_all(&[kind])?;
    w.write_all(&(bytes.len() as u16).to_le_bytes())?;
    w.write_all(bytes)?;
    w.write_all(&size.to_le_bytes())?;
    Ok(())
}

/// One walk: path, size, then raw bytes. No tar and no zip.
pub fn stage_folder_raw(
    app: Option<&AppHandle>,
    file_id: &str,
    folder_path: &str,
    staging_dir: &Path,
    content_key: [u8; 32],
    expected_chunks: u32,
    total_files_hint: u64,
    total_bytes_hint: u64,
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

    std::fs::write(staging_dir.join(".live"), b"1").map_err(explain_io)?;
    let mut failed = true;
    let result = (|| {
        let mut writer = StreamingChunkWriter::new(
            file_id.to_string(),
            staging_dir.to_path_buf(),
            content_key,
            expected_chunks,
            app,
            pause_flag,
            cancel_flag.clone(),
        );
        writer.write_all(RAW_MAGIC).map_err(explain_io)?;
        writer
            .write_all(&total_files_hint.to_le_bytes())
            .map_err(explain_io)?;
        writer
            .write_all(&total_bytes_hint.to_le_bytes())
            .map_err(explain_io)?;

        let mut files_done = 0u64;
        let mut bytes_seen = 0u64;
        for entry in walkdir::WalkDir::new(&root_canon)
            .follow_links(false)
            .into_iter()
        {
            if cancel_flag.load(Ordering::SeqCst) {
                return Err("aborted".to_string());
            }
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    eprintln!("Warning: skipping unreadable entry: {e}");
                    continue;
                }
            };
            let path = entry.path();
            if path == root_canon {
                continue;
            }
            let rel = match path.strip_prefix(&root_canon) {
                Ok(p) => p.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };
            let rel = rel.trim_start_matches('/').to_string();
            if !rel_is_safe(&rel) {
                continue;
            }
            let ft = entry.file_type();
            if ft.is_dir() {
                write_entry_header(&mut writer, KIND_DIR, &rel, 0).map_err(explain_io)?;
            } else if ft.is_file() {
                let len = entry.metadata().map(|m| m.len()).unwrap_or(0);
                bytes_seen += len;
                if bytes_seen > crate::util::MAX_FILE_BYTES as u64 {
                    return Err("folder exceeds size cap".into());
                }
                write_entry_header(&mut writer, KIND_FILE, &rel, len).map_err(explain_io)?;
                let mut f = std::fs::File::open(path).map_err(explain_io)?;
                io::copy(&mut f, &mut writer).map_err(explain_io)?;
                files_done += 1;
                writer.set_files_done(files_done);
            } else if ft.is_symlink() {
                if let Ok(target) = std::fs::read_link(path) {
                    let target_str = target.to_string_lossy().replace('\\', "/");
                    let tb = target_str.as_bytes();
                    write_entry_header(&mut writer, KIND_LINK, &rel, tb.len() as u64)
                        .map_err(explain_io)?;
                    writer.write_all(tb).map_err(explain_io)?;
                }
            }
        }
        write_entry_header(&mut writer, KIND_END, "", 0).map_err(explain_io)?;
        let (digest, bytes_written, chunk_count) = writer.finish().map_err(explain_io)?;
        std::fs::write(staging_dir.join(".done"), chunk_count.to_string()).map_err(explain_io)?;
        Ok((digest, bytes_written, chunk_count))
    })();
    if result.is_ok() {
        failed = false;
    }
    if failed {
        let _ = std::fs::write(staging_dir.join(".failed"), b"1");
    }
    result
}

/// Writes a raw folder stream straight to disk as plaintext arrives.
pub struct FolderExtractor {
    dest: PathBuf,
    pending: Vec<u8>,
    header_done: bool,
    files_total: u64,
    bytes_total: u64,
    files_done: u64,
    bytes_done: u64,
    current_kind: u8,
    current_remaining: u64,
    current_file: Option<std::fs::File>,
    ended: bool,
    app: Option<AppHandle>,
    file_id: String,
    last_emit: Instant,
}

impl FolderExtractor {
    pub fn create(dest: PathBuf, app: Option<AppHandle>, file_id: &str) -> Result<Self, String> {
        std::fs::create_dir_all(&dest).map_err(explain_io)?;
        std::fs::write(dest.join(".pcdir-partial"), b"1").map_err(explain_io)?;
        Ok(Self {
            dest,
            pending: Vec::new(),
            header_done: false,
            files_total: 0,
            bytes_total: 0,
            files_done: 0,
            bytes_done: 0,
            current_kind: 0,
            current_remaining: 0,
            current_file: None,
            ended: false,
            app,
            file_id: file_id.to_string(),
            last_emit: Instant::now(),
        })
    }

    pub fn dest(&self) -> &Path {
        &self.dest
    }

    pub fn push(&mut self, data: &[u8]) -> io::Result<()> {
        if self.ended || data.is_empty() {
            return Ok(());
        }
        self.pending.extend_from_slice(data);
        self.drain()?;
        Ok(())
    }

    pub fn finish(mut self) -> io::Result<PathBuf> {
        self.drain()?;
        if !self.ended {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "truncated folder stream",
            ));
        }
        let _ = std::fs::remove_file(self.dest.join(".pcdir-partial"));
        std::fs::write(self.dest.join(".pcdir-ok"), b"1")?;
        Ok(self.dest)
    }

    fn emit(&mut self) {
        let Some(app) = self.app.as_ref() else {
            return;
        };
        let first_or_last = self.ended || self.files_done <= 1;
        if !first_or_last && self.last_emit.elapsed() < std::time::Duration::from_secs(1) {
            return;
        }
        self.last_emit = Instant::now();
        let _ = app.emit(
            "folder-receive-progress",
            json!({
                "file_id": self.file_id,
                "files_done": self.files_done,
                "files_total": self.files_total,
                "bytes_done": self.bytes_done,
                "bytes_total": self.bytes_total,
            }),
        );
    }

    fn drain(&mut self) -> io::Result<()> {
        loop {
            if self.ended {
                return Ok(());
            }
            if !self.header_done {
                if self.pending.len() < 4 + 8 + 8 {
                    return Ok(());
                }
                if &self.pending[..4] != RAW_MAGIC {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "not a raw folder stream",
                    ));
                }
                self.files_total = u64::from_le_bytes(self.pending[4..12].try_into().unwrap());
                self.bytes_total = u64::from_le_bytes(self.pending[12..20].try_into().unwrap());
                self.pending.drain(..20);
                self.header_done = true;
                self.emit();
                continue;
            }
            if self.current_remaining > 0 {
                let take = std::cmp::min(self.current_remaining as usize, self.pending.len());
                if take == 0 {
                    return Ok(());
                }
                let chunk = self.pending.drain(..take).collect::<Vec<_>>();
                self.current_remaining -= take as u64;
                if self.current_kind == KIND_FILE {
                    if let Some(f) = self.current_file.as_mut() {
                        f.write_all(&chunk)?;
                        self.bytes_done += take as u64;
                    }
                }
                if self.current_remaining == 0 {
                    self.current_file.take();
                    if self.current_kind == KIND_FILE {
                        self.files_done += 1;
                        self.emit();
                    }
                    self.current_kind = 0;
                }
                continue;
            }
            if self.pending.len() < 1 + 2 {
                return Ok(());
            }
            let kind = self.pending[0];
            let path_len = u16::from_le_bytes(self.pending[1..3].try_into().unwrap()) as usize;
            if self.pending.len() < 3 + path_len + 8 {
                return Ok(());
            }
            let rel = std::str::from_utf8(&self.pending[3..3 + path_len])
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "bad path"))?
                .to_string();
            let size = u64::from_le_bytes(
                self.pending[3 + path_len..3 + path_len + 8]
                    .try_into()
                    .unwrap(),
            );
            self.pending.drain(..3 + path_len + 8);
            if kind == KIND_END {
                self.ended = true;
                self.emit();
                return Ok(());
            }
            if !rel_is_safe(&rel) {
                self.current_kind = kind;
                self.current_remaining = size;
                continue;
            }
            let out_path = self.dest.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
            if kind == KIND_DIR {
                std::fs::create_dir_all(&out_path)?;
                continue;
            }
            if kind == KIND_LINK {
                self.current_kind = KIND_LINK;
                self.current_remaining = size;
                continue;
            }
            if kind == KIND_FILE {
                if let Some(parent) = out_path.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                self.current_file = Some(
                    std::fs::OpenOptions::new()
                        .create(true)
                        .write(true)
                        .truncate(true)
                        .open(&out_path)?,
                );
                self.current_kind = KIND_FILE;
                self.current_remaining = size;
                if size == 0 {
                    self.current_file.take();
                    self.files_done += 1;
                    self.emit();
                    self.current_kind = 0;
                }
                continue;
            }
            return Err(io::Error::new(io::ErrorKind::InvalidData, "bad entry"));
        }
    }
}

pub fn prepare_folder_dest(dest_dir: &Path, folder_name: &str) -> Result<PathBuf, String> {
    let safe_name = crate::util::safe_download_name(folder_name);
    let safe_name = if safe_name.is_empty() || safe_name == "." || safe_name == ".." {
        "folder".to_string()
    } else {
        safe_name
    };
    std::fs::create_dir_all(dest_dir).map_err(explain_io)?;
    let mut target = dest_dir.join(&safe_name);
    if target.exists() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        target = dest_dir.join(format!("{safe_name}-{stamp}"));
    }
    Ok(target)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_stream_roundtrip_writes_files() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(RAW_MAGIC);
        bytes.extend_from_slice(&2u64.to_le_bytes());
        bytes.extend_from_slice(&5u64.to_le_bytes());
        write_entry_header(&mut bytes, KIND_DIR, "sub", 0).unwrap();
        write_entry_header(&mut bytes, KIND_FILE, "sub/a.txt", 5).unwrap();
        bytes.extend_from_slice(b"hello");
        write_entry_header(&mut bytes, KIND_FILE, "b.txt", 0).unwrap();
        write_entry_header(&mut bytes, KIND_END, "", 0).unwrap();

        let dest = std::env::temp_dir().join(format!(
            "pcdir-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut ext = FolderExtractor::create(dest.clone(), None, "t").unwrap();
        ext.push(&bytes[..10]).unwrap();
        ext.push(&bytes[10..]).unwrap();
        let out = ext.finish().unwrap();
        assert_eq!(std::fs::read(out.join("sub").join("a.txt")).unwrap(), b"hello");
        assert!(out.join("b.txt").is_file());
        assert!(out.join(".pcdir-ok").is_file());
        let _ = std::fs::remove_dir_all(&dest);
    }
}
