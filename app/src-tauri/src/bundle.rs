use serde::Deserialize;
use serde_json::{json, Value};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

#[derive(Deserialize)]
pub struct BundleEntry {
    pub abs_path: String,
    pub rel_path: String,
}

pub fn safe_rel(rel: &str) -> Result<String, String> {
    if rel.is_empty() || rel.starts_with('/') || rel.starts_with('\\') || rel.contains(':') {
        return Err("invalid relative path".into());
    }
    let norm = rel.replace('\\', "/");
    if norm.split('/').any(|part| part.is_empty() || part == "." || part == "..") {
        return Err("path traversal rejected".into());
    }
    Ok(norm)
}

pub fn list_tree(root: &Path) -> Result<Vec<Value>, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    if !root.is_dir() {
        return Err("not a directory".into());
    }
    let mut out = Vec::new();
    walk(&root, &root, &mut out, 0)?;
    Ok(out)
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<Value>, depth: usize) -> Result<(), String> {
    if depth > 32 {
        return Err("directory tree too deep".into());
    }
    if out.len() > 5000 {
        return Err("too many files in selection".into());
    }
    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    for ent in entries {
        let ent = ent.map_err(|e| e.to_string())?;
        let path = ent.path();
        let meta = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            walk(root, &path, out, depth + 1)?;
        } else if meta.is_file() {
            let canon = path.canonicalize().map_err(|e| e.to_string())?;
            if !canon.starts_with(root) {
                continue;
            }
            let rel = canon.strip_prefix(root).map_err(|e| e.to_string())?;
            let rel_s = safe_rel(&rel.to_string_lossy().replace('\\', "/"))?;
            out.push(json!({
                "abs_path": canon.display().to_string(),
                "rel_path": rel_s,
                "size": meta.len(),
            }));
        }
    }
    Ok(())
}

pub fn pack(dest: &Path, entries: &[BundleEntry]) -> Result<(u64, u32), String> {
    if entries.is_empty() {
        return Err("nothing to bundle".into());
    }
    if entries.len() > 5000 {
        return Err("too many files".into());
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let file = File::create(dest).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(file);
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut count = 0u32;
    let mut total = 0u64;
    for ent in entries {
        let rel = safe_rel(&ent.rel_path)?;
        let path = PathBuf::from(&ent.abs_path);
        let meta = std::fs::symlink_metadata(&path).map_err(|e| format!("{rel}: {e}"))?;
        if meta.file_type().is_symlink() {
            return Err(format!("refusing symbolic link: {rel}"));
        }
        if !meta.is_file() {
            return Err(format!("not a file: {rel}"));
        }
        let canon = path.canonicalize().map_err(|e| e.to_string())?;
        let mut src = File::open(&canon).map_err(|e| e.to_string())?;
        total = total.saturating_add(meta.len());
        if total > 5 * 1024 * 1024 * 1024 {
            return Err("bundle exceeds 5 GiB".into());
        }
        zip.start_file(rel, opts).map_err(|e| e.to_string())?;
        std::io::copy(&mut src, &mut zip).map_err(|e| e.to_string())?;
        count += 1;
    }
    zip.finish().map_err(|e| e.to_string())?;
    let size = std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
    Ok((size, count))
}

pub fn read_under(base: &Path, path: &Path, offset: u64, len: usize) -> Result<Vec<u8>, String> {
    let base = base.canonicalize().map_err(|e| e.to_string())?;
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    if !path.starts_with(&base) {
        return Err("path is outside the bundle directory".into());
    }
    if len == 0 || len > 4 * 1024 * 1024 {
        return Err("invalid read length".into());
    }
    let mut file = File::open(&path).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; len];
    let n = file.read(&mut buf).map_err(|e| e.to_string())?;
    buf.truncate(n);
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::safe_rel;

    #[test]
    fn rejects_traversal() {
        assert!(safe_rel("../x").is_err());
        assert!(safe_rel("a/../../b").is_err());
        assert!(safe_rel("/etc/passwd").is_err());
        assert_eq!(safe_rel("src/main.rs").unwrap(), "src/main.rs");
    }
}
