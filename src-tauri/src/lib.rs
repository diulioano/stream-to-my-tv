use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, RunEvent, WindowEvent};

pub const DEFAULT_SIDECAR_PORT: u16 = 4321;
pub const DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(3);
pub const WINDOW_CLOSE_BEHAVIOR: &str = "minimize-to-tray";
const SHUTDOWN_POLL_INTERVAL: Duration = Duration::from_millis(15);
const TRAY_ID: &str = "main-tray";
const TRAY_MENU_SHOW_ID: &str = "show";
const TRAY_MENU_QUIT_ID: &str = "quit";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SidecarConfig {
    pub program: PathBuf,
    pub script_path: Option<PathBuf>,
    pub port: u16,
    pub ffmpeg_path: Option<PathBuf>,
    pub ffprobe_path: Option<PathBuf>,
    pub frontend_dist_dir: Option<PathBuf>,
    pub working_dir: Option<PathBuf>,
    pub extra_args: Vec<String>,
    pub graceful_shutdown_timeout: Duration,
}

impl SidecarConfig {
    pub fn new(program: impl Into<PathBuf>, port: u16) -> Self {
        Self {
            program: program.into(),
            script_path: None,
            port,
            ffmpeg_path: None,
            ffprobe_path: None,
            frontend_dist_dir: None,
            working_dir: None,
            extra_args: Vec::new(),
            graceful_shutdown_timeout: DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SidecarLaunchSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub working_dir: Option<PathBuf>,
}

pub fn build_sidecar_args_and_env(config: &SidecarConfig) -> SidecarLaunchSpec {
    let mut args = Vec::new();
    let mut env = BTreeMap::new();

    if let Some(script_path) = &config.script_path {
        args.push(path_to_string(script_path));
    }

    let port_str = config.port.to_string();
    args.push("--port".to_string());
    args.push(port_str.clone());
    args.push("--watch-stdin".to_string());

    env.insert("TAURI_SIDECAR".to_string(), "1".to_string());
    env.insert("PORT".to_string(), port_str);

    if let Some(ffmpeg_path) = &config.ffmpeg_path {
        let value = path_to_string(ffmpeg_path);
        args.push("--ffmpeg-path".to_string());
        args.push(value.clone());
        env.insert("FFMPEG_PATH".to_string(), value);
    }

    if let Some(ffprobe_path) = &config.ffprobe_path {
        let value = path_to_string(ffprobe_path);
        args.push("--ffprobe-path".to_string());
        args.push(value.clone());
        env.insert("FFPROBE_PATH".to_string(), value);
    }

    if let Some(frontend_dist_dir) = &config.frontend_dist_dir {
        let value = path_to_string(frontend_dist_dir);
        args.push("--frontend-dist".to_string());
        args.push(value.clone());
        env.insert("FRONTEND_DIST_DIR".to_string(), value);
    }

    args.extend(config.extra_args.iter().cloned());

    SidecarLaunchSpec {
        program: config.program.clone(),
        args,
        env,
        working_dir: config.working_dir.clone(),
    }
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

pub struct SidecarProcess {
    child: Child,
    stdin: Option<ChildStdin>,
    pid: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShutdownOutcome {
    AlreadyStopped,
    GracefulExit(ExitStatus),
    ForceKilled(ExitStatus),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowCloseDecision {
    HideToTray,
    AllowCloseAndShutdown,
}

pub fn decide_window_close(explicit_quit_requested: bool) -> WindowCloseDecision {
    if explicit_quit_requested {
        WindowCloseDecision::AllowCloseAndShutdown
    } else {
        WindowCloseDecision::HideToTray
    }
}

pub struct SidecarSupervisor {
    state: Mutex<Option<SidecarProcess>>,
    graceful_timeout: Duration,
    port: AtomicU16,
    explicit_quit: AtomicBool,
}

impl Default for SidecarSupervisor {
    fn default() -> Self {
        Self::new(DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT)
    }
}

impl SidecarSupervisor {
    pub fn new(graceful_timeout: Duration) -> Self {
        Self {
            state: Mutex::new(None),
            graceful_timeout,
            port: AtomicU16::new(DEFAULT_SIDECAR_PORT),
            explicit_quit: AtomicBool::new(false),
        }
    }

    pub fn request_explicit_quit(&self) {
        self.explicit_quit.store(true, Ordering::SeqCst);
    }

    pub fn is_explicit_quit_requested(&self) -> bool {
        self.explicit_quit.load(Ordering::SeqCst)
    }

    pub fn on_main_window_close_requested(&self) -> WindowCloseDecision {
        decide_window_close(self.is_explicit_quit_requested())
    }

    pub fn spawn(&self, config: &SidecarConfig) -> io::Result<u32> {
        self.shutdown_sidecar()?;

        let spec = build_sidecar_args_and_env(config);
        let mut command = Command::new(&spec.program);
        command
            .args(&spec.args)
            .envs(&spec.env)
            .stdin(Stdio::piped())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());

        if let Some(working_dir) = &spec.working_dir {
            command.current_dir(working_dir);
        }

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command.spawn()?;
        let pid = child.id();
        let stdin = child.stdin.take();

        let mut guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some(SidecarProcess { child, stdin, pid });
        self.port.store(config.port, Ordering::Relaxed);

        Ok(pid)
    }

    pub fn pid(&self) -> Option<u32> {
        let guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        guard.as_ref().map(|process| process.pid)
    }

    pub fn port(&self) -> u16 {
        self.port.load(Ordering::Relaxed)
    }

    pub fn is_running(&self) -> bool {
        let mut guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_mut() {
            Some(process) => matches!(process.child.try_wait(), Ok(None)),
            None => false,
        }
    }

    pub fn shutdown_sidecar(&self) -> io::Result<ShutdownOutcome> {
        let process = {
            let mut guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
            guard.take()
        };

        let Some(mut process) = process else {
            return Ok(ShutdownOutcome::AlreadyStopped);
        };

        drop(process.stdin.take());

        let deadline = Instant::now() + self.graceful_timeout;
        loop {
            if let Some(status) = process.child.try_wait()? {
                return Ok(ShutdownOutcome::GracefulExit(status));
            }
            if Instant::now() >= deadline {
                break;
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            thread::sleep(SHUTDOWN_POLL_INTERVAL.min(remaining));
        }

        if let Err(err) = process.child.kill() {
            if err.kind() != io::ErrorKind::InvalidInput {
                return Err(err);
            }
        }
        let status = process.child.wait()?;
        Ok(ShutdownOutcome::ForceKilled(status))
    }
}

impl Drop for SidecarSupervisor {
    fn drop(&mut self) {
        let _ = self.shutdown_sidecar();
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub port: u16,
    pub close_behavior: &'static str,
    pub explicit_quit_requested: bool,
}

impl SidecarSupervisor {
    pub fn status(&self) -> SidecarStatus {
        SidecarStatus {
            running: self.is_running(),
            pid: self.pid(),
            port: self.port(),
            close_behavior: WINDOW_CLOSE_BEHAVIOR,
            explicit_quit_requested: self.is_explicit_quit_requested(),
        }
    }
}

#[tauri::command]
fn sidecar_status(supervisor: tauri::State<'_, SidecarSupervisor>) -> SidecarStatus {
    supervisor.status()
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn quit_application(app: &tauri::AppHandle, supervisor: &SidecarSupervisor) {
    supervisor.request_explicit_quit();
    let _ = supervisor.shutdown_sidecar();
    app.exit(0);
}

#[tauri::command]
fn quit_app(app_handle: tauri::AppHandle, supervisor: tauri::State<'_, SidecarSupervisor>) {
    quit_application(&app_handle, &supervisor);
}

fn platform_binary_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

fn find_first_existing(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|path| path.is_file()).cloned()
}

fn find_first_existing_dir(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates
        .iter()
        .find(|path| path.join("index.html").is_file())
        .cloned()
}

fn resolve_runtime_sidecar_config(app: &tauri::App) -> Option<SidecarConfig> {
    let port = std::env::var("PORT")
        .ok()
        .and_then(|raw| raw.parse::<u16>().ok())
        .unwrap_or(DEFAULT_SIDECAR_PORT);

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));
    let resource_dir = app.path().resource_dir().ok();
    let cwd = std::env::current_dir().ok();

    let sea_exe_name = platform_binary_name("stream-to-my-tv-sea");
    let ffmpeg_name = platform_binary_name("ffmpeg");
    let ffprobe_name = platform_binary_name("ffprobe");

    let mut sidecar_bin_candidates = Vec::new();
    let mut bundle_candidates = Vec::new();
    let mut ffmpeg_candidates = Vec::new();
    let mut ffprobe_candidates = Vec::new();
    let mut frontend_dist_candidates = Vec::new();

    if let Some(dir) = &exe_dir {
        sidecar_bin_candidates.push(dir.join(&sea_exe_name));
        ffmpeg_candidates.push(dir.join(&ffmpeg_name));
        ffprobe_candidates.push(dir.join(&ffprobe_name));
        frontend_dist_candidates.push(dir.join("resources").join("frontend-dist"));
        frontend_dist_candidates.push(dir.join("frontend-dist"));
    }

    if let Some(dir) = &resource_dir {
        bundle_candidates.push(dir.join("resources").join("server-bundle.cjs"));
        bundle_candidates.push(dir.join("server-bundle.cjs"));
        ffmpeg_candidates.push(dir.join("resources").join(&ffmpeg_name));
        ffprobe_candidates.push(dir.join("resources").join(&ffprobe_name));
        frontend_dist_candidates.push(dir.join("resources").join("frontend-dist"));
        frontend_dist_candidates.push(dir.join("frontend-dist"));
    }

    if let Some(dir) = &cwd {
        let mut dev_roots = vec![dir.clone()];
        if let Some(parent) = dir.parent() {
            dev_roots.push(parent.to_path_buf());
        }
        for root in dev_roots {
            let sidecar_dist = root.join("scratch").join("sidecar-dist");
            sidecar_bin_candidates.push(sidecar_dist.join(&sea_exe_name));
            bundle_candidates.push(sidecar_dist.join("server-bundle.cjs"));
            ffmpeg_candidates.push(sidecar_dist.join("bin").join(&ffmpeg_name));
            ffprobe_candidates.push(sidecar_dist.join("bin").join(&ffprobe_name));
            frontend_dist_candidates.push(root.join("frontend").join("dist"));
        }
    }

    let prefer_sea = std::env::var("STTV_PREFER_SEA")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    let mut config = if prefer_sea {
        if let Some(sidecar_bin) = find_first_existing(&sidecar_bin_candidates) {
            SidecarConfig::new(sidecar_bin, port)
        } else if let Some(bundle_path) = find_first_existing(&bundle_candidates) {
            let mut cfg = SidecarConfig::new("node", port);
            cfg.script_path = Some(bundle_path);
            cfg
        } else {
            return None;
        }
    } else if let Some(bundle_path) = find_first_existing(&bundle_candidates) {
        let mut cfg = SidecarConfig::new("node", port);
        cfg.script_path = Some(bundle_path);
        cfg
    } else if let Some(sidecar_bin) = find_first_existing(&sidecar_bin_candidates) {
        SidecarConfig::new(sidecar_bin, port)
    } else {
        return None;
    };

    config.ffmpeg_path = std::env::var_os("FFMPEG_PATH")
        .map(PathBuf::from)
        .or_else(|| find_first_existing(&ffmpeg_candidates));
    config.ffprobe_path = std::env::var_os("FFPROBE_PATH")
        .map(PathBuf::from)
        .or_else(|| find_first_existing(&ffprobe_candidates));
    config.frontend_dist_dir = std::env::var_os("FRONTEND_DIST_DIR")
        .map(PathBuf::from)
        .or_else(|| find_first_existing_dir(&frontend_dist_candidates));

    Some(config)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(SidecarSupervisor::default())
        .invoke_handler(tauri::generate_handler![sidecar_status, quit_app])
        .setup(|app| {
            if let Some(config) = resolve_runtime_sidecar_config(app) {
                let port = config.port;
                let supervisor = app.state::<SidecarSupervisor>();
                if let Err(err) = supervisor.spawn(&config) {
                    eprintln!("Failed to spawn streaming sidecar: {err}");
                }
                if let Some(window) = app.get_webview_window("main") {
                    let init_js =
                        format!("window.__STTV_BACKEND_URL__ = 'http://127.0.0.1:{port}';");
                    let _ = window.eval(&init_js);
                }
            }

            let show_item = MenuItem::with_id(
                app,
                TRAY_MENU_SHOW_ID,
                "Abrir Stream to My TV",
                true,
                None::<&str>,
            )?;
            let quit_item = MenuItem::with_id(
                app,
                TRAY_MENU_QUIT_ID,
                "Encerrar transmissão e sair",
                true,
                None::<&str>,
            )?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::with_id(TRAY_ID)
                .menu(&tray_menu)
                .tooltip("Stream to My TV")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    TRAY_MENU_SHOW_ID => show_main_window(app),
                    TRAY_MENU_QUIT_ID => {
                        let supervisor = app.state::<SidecarSupervisor>();
                        quit_application(app, &supervisor);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }

            tray_builder.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            let supervisor = window.app_handle().state::<SidecarSupervisor>();
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    match supervisor.on_main_window_close_requested() {
                        WindowCloseDecision::HideToTray => {
                            api.prevent_close();
                            let _ = window.hide();
                        }
                        WindowCloseDecision::AllowCloseAndShutdown => {
                            let _ = supervisor.shutdown_sidecar();
                        }
                    }
                }
                WindowEvent::Destroyed if supervisor.is_explicit_quit_requested() => {
                    let _ = supervisor.shutdown_sidecar();
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Stream to My TV Tauri application");

    app.run(|app_handle, event| match event {
        RunEvent::ExitRequested { api, .. } => {
            let supervisor = app_handle.state::<SidecarSupervisor>();
            if supervisor.is_explicit_quit_requested() {
                let _ = supervisor.shutdown_sidecar();
            } else {
                api.prevent_exit();
            }
        }
        RunEvent::Exit => {
            let supervisor = app_handle.state::<SidecarSupervisor>();
            let _ = supervisor.shutdown_sidecar();
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};

    static TEST_SCRIPT_COUNTER: AtomicUsize = AtomicUsize::new(0);

    struct TempScript {
        path: PathBuf,
    }

    impl TempScript {
        fn new(source: &str) -> Self {
            let id = TEST_SCRIPT_COUNTER.fetch_add(1, AtomicOrdering::Relaxed);
            let file_name = format!(
                "stream_to_my_tv_sidecar_test_{}_{}.cjs",
                std::process::id(),
                id
            );
            let path = std::env::temp_dir().join(file_name);
            fs::write(&path, source).expect("write temporary node test script");
            Self { path }
        }
    }

    impl Drop for TempScript {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.path);
        }
    }

    fn is_process_alive(pid: u32) -> bool {
        #[cfg(windows)]
        {
            let output = Command::new("tasklist")
                .args(["/FI", &format!("PID eq {pid}"), "/NH", "/FO", "CSV"])
                .output()
                .expect("run tasklist");
            let stdout = String::from_utf8_lossy(&output.stdout);
            stdout.contains(&format!("\"{pid}\""))
        }
        #[cfg(not(windows))]
        {
            Command::new("kill")
                .args(["-0", &pid.to_string()])
                .status()
                .map(|status| status.success())
                .unwrap_or(false)
        }
    }

    #[test]
    fn build_sidecar_args_and_env_matches_backend_contract() {
        let mut config = SidecarConfig::new("node", 4567);
        config.script_path = Some(PathBuf::from("resources/server-bundle.cjs"));
        config.ffmpeg_path = Some(PathBuf::from("binaries/ffmpeg.exe"));
        config.ffprobe_path = Some(PathBuf::from("binaries/ffprobe.exe"));
        config.frontend_dist_dir = Some(PathBuf::from("frontend/dist"));
        config.extra_args = vec!["--strict".to_string()];

        let spec = build_sidecar_args_and_env(&config);

        assert_eq!(spec.program, PathBuf::from("node"));
        assert_eq!(
            spec.args,
            vec![
                "resources/server-bundle.cjs",
                "--port",
                "4567",
                "--watch-stdin",
                "--ffmpeg-path",
                "binaries/ffmpeg.exe",
                "--ffprobe-path",
                "binaries/ffprobe.exe",
                "--frontend-dist",
                "frontend/dist",
                "--strict",
            ]
        );
        assert_eq!(spec.env.get("TAURI_SIDECAR").map(String::as_str), Some("1"));
        assert_eq!(spec.env.get("PORT").map(String::as_str), Some("4567"));
        assert_eq!(
            spec.env.get("FFMPEG_PATH").map(String::as_str),
            Some("binaries/ffmpeg.exe")
        );
        assert_eq!(
            spec.env.get("FFPROBE_PATH").map(String::as_str),
            Some("binaries/ffprobe.exe")
        );
        assert_eq!(
            spec.env.get("FRONTEND_DIST_DIR").map(String::as_str),
            Some("frontend/dist")
        );
    }

    #[test]
    fn build_sidecar_args_and_env_omits_optional_fields_for_sea_binary() {
        let config = SidecarConfig::new("binaries/stream-sidecar.exe", DEFAULT_SIDECAR_PORT);
        let spec = build_sidecar_args_and_env(&config);

        assert_eq!(spec.program, PathBuf::from("binaries/stream-sidecar.exe"));
        assert_eq!(spec.args, vec!["--port", "4321", "--watch-stdin"]);
        assert_eq!(spec.env.get("TAURI_SIDECAR").map(String::as_str), Some("1"));
        assert_eq!(spec.env.get("PORT").map(String::as_str), Some("4321"));
        assert!(!spec.env.contains_key("FFMPEG_PATH"));
        assert!(!spec.env.contains_key("FFPROBE_PATH"));
        assert!(!spec.env.contains_key("FRONTEND_DIST_DIR"));
    }

    #[test]
    fn supervisor_shuts_down_piped_stdin_child_gracefully_and_idempotently() {
        let script = TempScript::new(
            r#"
const args = process.argv.slice(2);
if (!args.includes("--watch-stdin") || process.env.TAURI_SIDECAR !== "1") {
  process.exit(42);
}
const timer = setInterval(() => {}, 10000);
const shutdown = () => {
  clearInterval(timer);
  process.exit(0);
};
process.stdin.resume();
process.stdin.once("end", shutdown);
process.stdin.once("close", shutdown);
"#,
        );

        let supervisor = SidecarSupervisor::new(Duration::from_secs(2));
        let mut config = SidecarConfig::new("node", 4321);
        config.script_path = Some(script.path.clone());

        let pid = supervisor.spawn(&config).expect("spawn sidecar child");
        thread::sleep(Duration::from_millis(120));

        assert_eq!(supervisor.pid(), Some(pid));
        assert!(supervisor.is_running(), "child must remain alive while stdin stays open");

        let outcome = supervisor
            .shutdown_sidecar()
            .expect("graceful sidecar shutdown");
        match outcome {
            ShutdownOutcome::GracefulExit(status) => {
                assert!(status.success(), "expected exit code 0, got {status:?}");
            }
            other => panic!("expected GracefulExit, got {other:?}"),
        }

        assert!(!supervisor.is_running());
        assert_eq!(supervisor.pid(), None);
        assert!(!is_process_alive(pid), "sidecar pid {pid} must not remain alive");

        let second_outcome = supervisor
            .shutdown_sidecar()
            .expect("idempotent second shutdown");
        assert_eq!(second_outcome, ShutdownOutcome::AlreadyStopped);
    }

    #[test]
    fn supervisor_force_kills_unresponsive_child_after_timeout() {
        let script = TempScript::new("setInterval(() => {}, 10000);");

        let supervisor = SidecarSupervisor::new(Duration::from_millis(150));
        let mut config = SidecarConfig::new("node", 4321);
        config.script_path = Some(script.path.clone());

        let pid = supervisor.spawn(&config).expect("spawn unresponsive child");
        thread::sleep(Duration::from_millis(100));
        assert!(supervisor.is_running());

        let outcome = supervisor.shutdown_sidecar().expect("force kill shutdown");
        assert!(
            matches!(outcome, ShutdownOutcome::ForceKilled(_)),
            "expected ForceKilled, got {outcome:?}"
        );
        assert!(!supervisor.is_running());
        assert!(!is_process_alive(pid), "force-killed pid {pid} must not remain alive");
    }

    #[test]
    fn supervisor_terminates_child_on_drop_without_orphans() {
        let script = TempScript::new(
            r#"
const timer = setInterval(() => {}, 10000);
process.stdin.resume();
process.stdin.once("end", () => { clearInterval(timer); process.exit(0); });
process.stdin.once("close", () => { clearInterval(timer); process.exit(0); });
"#,
        );

        let pid = {
            let supervisor = SidecarSupervisor::new(Duration::from_secs(2));
            let mut config = SidecarConfig::new("node", 4321);
            config.script_path = Some(script.path.clone());

            let pid = supervisor.spawn(&config).expect("spawn child for drop test");
            thread::sleep(Duration::from_millis(120));
            assert!(supervisor.is_running());
            pid
        };

        assert!(!is_process_alive(pid), "dropped supervisor must not leave orphan pid {pid}");
    }

    #[test]
    fn window_close_without_explicit_quit_hides_to_tray_and_keeps_sidecar_alive() {
        assert_eq!(decide_window_close(false), WindowCloseDecision::HideToTray);

        let script = TempScript::new(
            r#"
const timer = setInterval(() => {}, 10000);
process.stdin.resume();
process.stdin.once("end", () => { clearInterval(timer); process.exit(0); });
process.stdin.once("close", () => { clearInterval(timer); process.exit(0); });
"#,
        );

        let supervisor = SidecarSupervisor::new(Duration::from_secs(2));
        let mut config = SidecarConfig::new("node", 4321);
        config.script_path = Some(script.path.clone());

        let pid = supervisor.spawn(&config).expect("spawn sidecar child");
        thread::sleep(Duration::from_millis(120));

        assert!(!supervisor.is_explicit_quit_requested());
        assert_eq!(
            supervisor.on_main_window_close_requested(),
            WindowCloseDecision::HideToTray
        );

        thread::sleep(Duration::from_millis(120));
        assert!(
            supervisor.is_running(),
            "sidecar must keep running after close request hides to tray"
        );
        assert!(
            is_process_alive(pid),
            "sidecar pid {pid} must stay alive while minimized to tray"
        );

        let status = supervisor.status();
        assert!(status.running);
        assert_eq!(status.pid, Some(pid));
        assert_eq!(status.port, 4321);
        assert_eq!(status.close_behavior, "minimize-to-tray");
        assert!(!status.explicit_quit_requested);

        let serialized = serde_json::to_value(&status).expect("serialize SidecarStatus");
        assert_eq!(serialized["closeBehavior"], "minimize-to-tray");
        assert_eq!(serialized["explicitQuitRequested"], false);
    }

    #[test]
    fn explicit_quit_allows_window_close_and_shuts_down_sidecar_cleanly() {
        assert_eq!(
            decide_window_close(true),
            WindowCloseDecision::AllowCloseAndShutdown
        );

        let script = TempScript::new(
            r#"
const timer = setInterval(() => {}, 10000);
process.stdin.resume();
process.stdin.once("end", () => { clearInterval(timer); process.exit(0); });
process.stdin.once("close", () => { clearInterval(timer); process.exit(0); });
"#,
        );

        let supervisor = SidecarSupervisor::new(Duration::from_secs(2));
        let mut config = SidecarConfig::new("node", 4321);
        config.script_path = Some(script.path.clone());

        let pid = supervisor.spawn(&config).expect("spawn sidecar child");
        thread::sleep(Duration::from_millis(120));
        assert!(supervisor.is_running());

        supervisor.request_explicit_quit();
        assert!(supervisor.is_explicit_quit_requested());
        assert_eq!(
            supervisor.on_main_window_close_requested(),
            WindowCloseDecision::AllowCloseAndShutdown
        );
        assert!(supervisor.status().explicit_quit_requested);

        let outcome = supervisor
            .shutdown_sidecar()
            .expect("shutdown sidecar after explicit quit");
        match outcome {
            ShutdownOutcome::GracefulExit(status) => {
                assert!(status.success(), "expected exit code 0, got {status:?}");
            }
            other => panic!("expected GracefulExit, got {other:?}"),
        }

        assert!(!supervisor.is_running());
        assert_eq!(supervisor.pid(), None);
        assert!(
            !is_process_alive(pid),
            "sidecar pid {pid} must be terminated after explicit quit"
        );
    }
}
