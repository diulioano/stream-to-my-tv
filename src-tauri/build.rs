use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn stage_file_if_available(source: &Path, destination: &Path) {
    println!("cargo:rerun-if-changed={}", source.display());
    if !source.is_file() {
        return;
    }

    if let Some(parent) = destination.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let needs_refresh = match (fs::metadata(source), fs::metadata(destination)) {
        (Ok(src_meta), Ok(dst_meta)) => {
            src_meta.len() != dst_meta.len()
                || src_meta.modified().ok() > dst_meta.modified().ok()
        }
        (Ok(_), Err(_)) => true,
        _ => false,
    };

    if !needs_refresh {
        return;
    }

    if destination.exists() {
        let _ = fs::remove_file(destination);
    }

    if fs::hard_link(source, destination).is_err() {
        let _ = fs::copy(source, destination);
    }
}

fn stage_sidecar_artifacts() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_default());
    let Some(repo_root) = manifest_dir.parent() else {
        return;
    };
    let sidecar_dist = repo_root.join("scratch").join("sidecar-dist");
    let target = env::var("TARGET").unwrap_or_else(|_| "x86_64-pc-windows-msvc".to_string());
    let exe_ext = if target.contains("windows") {
        ".exe"
    } else {
        ""
    };

    let binaries_dir = manifest_dir.join("binaries");
    let resources_dir = manifest_dir.join("resources");

    stage_file_if_available(
        &sidecar_dist.join(format!("stream-to-my-tv-sea{exe_ext}")),
        &binaries_dir.join(format!("stream-to-my-tv-sea-{target}{exe_ext}")),
    );
    stage_file_if_available(
        &sidecar_dist.join("bin").join(format!("ffmpeg{exe_ext}")),
        &binaries_dir.join(format!("ffmpeg-{target}{exe_ext}")),
    );
    stage_file_if_available(
        &sidecar_dist.join("bin").join(format!("ffprobe{exe_ext}")),
        &binaries_dir.join(format!("ffprobe-{target}{exe_ext}")),
    );
    stage_file_if_available(
        &sidecar_dist.join("server-bundle.cjs"),
        &resources_dir.join("server-bundle.cjs"),
    );
}

fn main() {
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    stage_sidecar_artifacts();
    tauri_build::build()
}
