use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};
use std::hash::{Hash, Hasher};

use chrono::{Local, TimeZone};
use sysinfo::{Components, CpuRefreshKind, DiskRefreshKind, Disks, MemoryRefreshKind, Networks, ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System, UpdateKind, Users};
use walkdir::WalkDir;

use crate::processes::{self, RawProcess, by_cpu, round1};
use crate::schema::{Battery, Cpu, Disk, Info, Io, Mem, Metrics, Port, Service, SystemTheme, SystemThemeMode, Temp, TopProc};
use crate::{VERSION, ports, services, tailscale};

const MIN_REFRESH: Duration = Duration::from_millis(1000);

const SKIP_FS_TYPES: [&str; 7] = ["tmpfs", "devtmpfs", "overlay", "squashfs", "efivarfs", "ramfs", "autofs"];

const SKIP_IFACE_PREFIXES: [&str; 11] = ["lo", "utun", "tailscale", "docker", "veth", "br-", "bridge", "awdl", "llw", "anpi", "ap"];

pub struct DiskRow {
    pub device: String,
    pub fs_type: String,
    pub mount: String,
    pub size: u64,
    pub used: u64,
}

pub fn pick_disks(rows: &[DiskRow], macos: bool) -> Vec<Disk> {
    let mut by_device: Vec<(&str, Disk)> = vec![];
    for r in rows {
        if SKIP_FS_TYPES.contains(&r.fs_type.as_str()) || r.size < 1_000_000_000 {
            continue;
        }
        let mut mount = r.mount.clone();
        if macos {
            if mount == "/System/Volumes/Data" {
                mount = "/".into();
            } else if mount == "/" || mount.starts_with("/System/Volumes/") || mount.contains("CoreSimulator") {
                continue;
            }
        }
        let disk = Disk { mount, used: r.used, size: r.size };
        match by_device.iter_mut().find(|(d, _)| *d == r.device) {
            Some((_, prev)) if disk.mount.len() < prev.mount.len() => *prev = disk,
            Some(_) => {}
            None => by_device.push((&r.device, disk)),
        }
    }
    let mut out: Vec<Disk> = by_device.into_iter().map(|(_, d)| d).collect();
    out.sort_by(|a, b| a.mount.cmp(&b.mount));
    out
}

fn skip_iface(name: &str) -> bool {
    SKIP_IFACE_PREFIXES.iter().any(|p| match *p {
        "ap" => name.strip_prefix("ap").and_then(|r| r.chars().next()).is_some_and(|c| c.is_ascii_digit()),
        _ => name.starts_with(p),
    })
}

fn clean_cpu_model(brand: &str) -> String {
    let brand = brand.split(" CPU @").next().unwrap_or(brand).replace("(R)", "").replace("(TM)", "");
    brand.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_cpu_sensor(label: &str) -> bool {
    let l = label.to_lowercase();
    ["package id", "tctl", "tdie", "cpu", "core "].iter().any(|k| l.contains(k))
}

fn battery_reading() -> Option<Battery> {
    use starship_battery::units::ratio::percent;
    use starship_battery::{Manager, State};
    let b = Manager::new().ok()?.batteries().ok()?.flatten().next()?;
    let state = b.state();
    let design = b.energy_full_design().value;
    Some(Battery {
        percent: b.state_of_charge().get::<percent>().round(),
        charging: state == State::Charging,
        on_ac: ac_online().unwrap_or(matches!(state, State::Charging | State::Full)),
        cycles: b.cycle_count().filter(|c| *c > 0),
        health_pct: (design > 0.0).then(|| b.state_of_health().get::<percent>().round() as u32),
    })
}

fn ac_online() -> Option<bool> {
    let supplies = std::fs::read_dir("/sys/class/power_supply").ok()?;
    let mains: Vec<PathBuf> = supplies.filter_map(Result::ok).map(|e| e.path()).filter(|p| std::fs::read_to_string(p.join("type")).is_ok_and(|t| t.trim() == "Mains")).collect();
    if mains.is_empty() {
        return None;
    }
    Some(mains.iter().any(|p| std::fs::read_to_string(p.join("online")).is_ok_and(|v| v.trim() == "1")))
}

struct Timed<T> {
    at: Option<Instant>,
    value: T,
}

impl<T> Timed<T> {
    fn get(&mut self, ttl: Duration, load: impl FnOnce() -> T) -> &T {
        if self.at.is_none_or(|at| at.elapsed() >= ttl) {
            self.value = load();
            self.at = Some(Instant::now());
        }
        &self.value
    }
}

fn timed<T>(value: T) -> Timed<T> {
    Timed { at: None, value }
}
const SYSTEM_THEME_PATH: &str = ".local/state/omarchy/current/theme/colors.toml";

#[derive(Clone, Debug, PartialEq, Eq)]
struct FontCache {
    stamp: u64,
    family: String,
}

fn hash_metadata(path: &Path, hasher: &mut std::collections::hash_map::DefaultHasher) {
    path.hash(hasher);
    match fs::metadata(path) {
        Ok(metadata) => {
            true.hash(hasher);
            metadata.len().hash(hasher);
            metadata.is_dir().hash(hasher);
            metadata.modified().ok().hash(hasher);
        }
        Err(_) => false.hash(hasher),
    }
}

fn fontconfig_stamp(home: &Path) -> u64 {
    let roots = [
        home.join(".config/fontconfig"),
        home.join(".fonts.conf"),
        home.join(".fonts"),
        home.join(".local/share/fonts"),
        PathBuf::from("/etc/fonts"),
    ];
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    for root in roots {
        if root.is_dir() {
            for entry in WalkDir::new(&root).follow_links(false).sort_by_file_name().into_iter().filter_map(Result::ok) {
                hash_metadata(entry.path(), &mut hasher);
            }
        } else {
            hash_metadata(&root, &mut hasher);
        }
    }
    hasher.finish()
}

fn monospace_family() -> String {
    let output = Command::new("fc-match").args(["monospace", "-f", "%{family}\\n"]).output();
    let stdout = output.ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default();
    stdout.lines().next().and_then(|line| line.split(',').next()).and_then(|family| family.split(':').next()).map(str::trim).filter(|family| !family.is_empty()).unwrap_or_default().to_string()
}

fn toml_string(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let quote = raw.chars().next()?;
    if quote == '"' || quote == '\'' {
        let value = &raw[quote.len_utf8()..];
        let end = value.find(quote)?;
        return Some(value[..end].to_string());
    }
    Some(raw.split('#').next()?.split_whitespace().next()?.to_string())
}

fn theme_mode(value: Option<&str>) -> Option<SystemThemeMode> {
    match value {
        Some("dark") => Some(SystemThemeMode::Dark),
        Some("light") => Some(SystemThemeMode::Light),
        _ => None,
    }
}

fn background_luminance(value: Option<&str>) -> Option<u16> {
    let value = value?;
    if value.len() != 7 || !value.starts_with('#') {
        return None;
    }
    Some(
        u16::from_str_radix(&value[1..3], 16).ok()?
            + u16::from_str_radix(&value[3..5], 16).ok()?
            + u16::from_str_radix(&value[5..7], 16).ok()?,
    )
}

fn system_theme(path: &Path, mono_font: String) -> Option<SystemTheme> {
    let body = fs::read_to_string(path).ok()?;
    let mut mode = None;
    let mut theme_type = None;
    let mut colors = BTreeMap::new();
    for line in body.lines().map(str::trim).filter(|line| !line.is_empty() && !line.starts_with('#')) {
        let Some((key, raw)) = line.split_once('=') else { continue };
        let Some(value) = toml_string(raw) else { continue };
        let key = key.trim();
        if key == "mode" {
            mode = Some(value);
        } else {
            if key == "theme_type" {
                theme_type = Some(value.clone());
            }
            colors.insert(key.to_string(), value);
        }
    }
    let mode = theme_mode(mode.as_deref())
        .or_else(|| theme_mode(theme_type.as_deref()))
        .or_else(|| {
            let light_marker = path.parent().is_some_and(|parent| parent.join("light.mode").is_file());
            if light_marker {
                Some(SystemThemeMode::Light)
            } else {
                background_luminance(colors.get("background").map(String::as_str).filter(|value| value.starts_with('#')))
                    .map(|luminance| if luminance > 382 { SystemThemeMode::Light } else { SystemThemeMode::Dark })
            }
        })
        .unwrap_or(SystemThemeMode::Dark);
    Some(SystemTheme { mode, colors, mono_font })
}

pub struct Settings {
    pub tailscale_bin: String,
    pub info_cache: Duration,
    pub sample_cache: Duration,
    pub detail_cache: Duration,
    pub services_cache: Duration,
    pub home: PathBuf,
    pub docker_socket: PathBuf,
}

pub struct Sampler {
    settings: Settings,
    sys: System,
    networks: Networks,
    disks: Disks,
    components: Components,
    users: Users,
    refreshed: Instant,
    io: Io,
    info: Info,
    tailscale_version: Timed<String>,
    disk_space: Timed<Vec<Disk>>,
    temp: Timed<Option<Temp>>,
    battery: Timed<Option<Battery>>,
    services: Timed<Vec<Service>>,
    ps_table: Timed<Vec<RawProcess>>,
    ports: Timed<Vec<Port>>,
    font: Option<FontCache>,
}

fn process_kind() -> ProcessRefreshKind {
    ProcessRefreshKind::nothing().without_tasks().with_cpu().with_memory().with_user(UpdateKind::OnlyIfNotSet).with_cmd(UpdateKind::OnlyIfNotSet)
}

impl Sampler {
    pub fn new(settings: Settings) -> Self {
        let sys = System::new_with_specifics(RefreshKind::nothing().with_cpu(CpuRefreshKind::everything()).with_memory(MemoryRefreshKind::everything()));
        let cpus = sys.cpus();
        let info = Info {
            os: [if cfg!(target_os = "macos") { Some("macOS".to_string()) } else { System::name() }, System::os_version()].into_iter().flatten().collect::<Vec<_>>().join(" "),
            kernel: System::kernel_version().unwrap_or_default(),
            cpu_model: cpus.first().map(|c| clean_cpu_model(c.brand())).unwrap_or_default(),
            threads: cpus.len(),
            mem_total: sys.total_memory(),
            agent_version: VERSION.to_string(),
            tailscale_version: String::new(),
        };
        Sampler {
            settings,
            info,
            tailscale_version: timed(String::new()),
            sys,
            networks: Networks::new_with_refreshed_list(),
            disks: Disks::new_with_refreshed_list_specifics(DiskRefreshKind::everything()),
            components: Components::new_with_refreshed_list(),
            users: Users::new_with_refreshed_list(),
            refreshed: Instant::now(),
            io: Io::default(),
            disk_space: timed(vec![]),
            temp: timed(None),
            battery: timed(None),
            services: timed(vec![]),
            ps_table: timed(vec![]),
            ports: timed(vec![]),
            font: None,
        }
    }
    fn system_theme(&mut self) -> Option<SystemTheme> {
        let path = self.settings.home.join(SYSTEM_THEME_PATH);
        if !path.is_file() {
            return None;
        }
        let stamp = fontconfig_stamp(&self.settings.home);
        let reload = self.font.as_ref().is_none_or(|cache| cache.stamp != stamp);
        if reload {
            self.font = Some(FontCache { stamp, family: monospace_family() });
        }
        let mono_font = self.font.as_ref().map(|cache| cache.family.clone()).unwrap_or_default();
        system_theme(&path, mono_font)
    }

    pub fn refresh(&mut self) {
        let elapsed = self.refreshed.elapsed();
        if elapsed < MIN_REFRESH {
            return;
        }
        self.refreshed = Instant::now();
        self.sys.refresh_cpu_usage();
        self.sys.refresh_memory();
        if !cfg!(target_os = "macos") {
            self.sys.refresh_processes_specifics(ProcessesToUpdate::All, true, process_kind());
        }
        self.networks.refresh(true);
        self.disks.refresh_specifics(true, DiskRefreshKind::nothing().with_io_usage());
        let secs = elapsed.as_secs_f64();
        let (net_in, net_out) = self.networks.iter().filter(|(name, _)| !skip_iface(name)).fold((0, 0), |(i, o), (_, n)| (i + n.received(), o + n.transmitted()));
        let mut devices = HashSet::new();
        let (read, write) = self.disks.list().iter().filter(|d| devices.insert(d.name().to_os_string())).fold((0, 0), |(r, w), d| {
            let u = d.usage();
            (r + u.read_bytes, w + u.written_bytes)
        });
        self.io = Io { net_in: net_in as f64 / secs, net_out: net_out as f64 / secs, disk_read: read as f64 / secs, disk_write: write as f64 / secs };
    }

    pub fn current_name(&mut self, pid: u32) -> Option<String> {
        let pid = sysinfo::Pid::from_u32(pid);
        self.sys.refresh_processes_specifics(ProcessesToUpdate::Some(&[pid]), true, ProcessRefreshKind::nothing());
        self.sys.process(pid).map(|p| p.name().to_string_lossy().into_owned())
    }

    pub fn processes(&mut self) -> Vec<RawProcess> {
        if cfg!(target_os = "macos") {
            return self
                .ps_table
                .get(MIN_REFRESH, || {
                    let table = services::run_c("ps", &["-axww", "-o", "pid=,pcpu=,rss=,user=,lstart=,comm="]);
                    let args = services::run_c("ps", &["-axww", "-o", "pid=,args="]);
                    processes::parse_ps(&table, &args)
                })
                .clone();
        }
        if self.sys.processes().values().any(|p| p.user_id().is_some_and(|u| self.users.get_user_by_id(u).is_none())) {
            self.users.refresh();
        }
        self.sys
            .processes()
            .values()
            .filter(|p| p.thread_kind().is_none())
            .map(|p| {
                let name = p.name().to_string_lossy().into_owned();
                let cmd: Vec<String> = p.cmd().iter().map(|a| a.to_string_lossy().into_owned()).collect();
                let command = match cmd.split_first() {
                    Some((first, rest)) => std::iter::once(first.rsplit('/').next().unwrap_or(first).to_string()).chain(rest.iter().cloned()).collect::<Vec<_>>().join(" "),
                    None => name.clone(),
                };
                RawProcess {
                    pid: p.pid().as_u32(),
                    user: p.user_id().and_then(|u| self.users.get_user_by_id(u)).map(|u| u.name().to_string()).unwrap_or_default(),
                    cpu: f64::from(p.cpu_usage()),
                    mem_bytes: p.memory(),
                    started: i64::try_from(p.start_time()).ok().and_then(|t| Local.timestamp_opt(t, 0).single()).map(|t| t.format("%Y-%m-%d %H:%M:%S").to_string()).unwrap_or_default(),
                    name,
                    command,
                }
            })
            .collect()
    }

    fn info(&mut self) -> Info {
        let bin = &self.settings.tailscale_bin;
        let tailscale_version = self.tailscale_version.get(self.settings.info_cache, || tailscale::read_status(bin).map(|s| s.version.split('-').next().unwrap_or_default().to_string()).unwrap_or_default()).clone();
        Info { tailscale_version, ..self.info.clone() }
    }

    pub fn services(&mut self) -> Vec<Service> {
        let (home, socket) = (&self.settings.home, &self.settings.docker_socket);
        self.services.get(self.settings.services_cache, || services::collect(home, socket, crate::now_ms())).clone()
    }

    pub fn ports(&mut self, list: &[RawProcess]) -> Vec<Port> {
        let names: HashMap<u32, &str> = list.iter().map(|p| (p.pid, p.name.as_str())).collect();
        self.ports.get(self.settings.detail_cache, || ports::collect(|pid| names.get(&pid).map(|n| n.to_string()))).clone()
    }

    pub fn metrics(&mut self) -> Metrics {
        self.refresh();
        let info = self.info();
        let ttl = self.settings.sample_cache;
        let disks = &mut self.disks;
        let disk_space = self
            .disk_space
            .get(ttl, || {
                disks.refresh_specifics(true, DiskRefreshKind::nothing().with_storage());
                let rows: Vec<DiskRow> = disks
                    .list()
                    .iter()
                    .map(|d| DiskRow {
                        device: d.name().to_string_lossy().into_owned(),
                        fs_type: d.file_system().to_string_lossy().into_owned(),
                        mount: d.mount_point().to_string_lossy().into_owned(),
                        size: d.total_space(),
                        used: d.total_space().saturating_sub(d.available_space()),
                    })
                    .collect();
                pick_disks(&rows, cfg!(target_os = "macos"))
            })
            .clone();
        let components = &mut self.components;
        let temp = *self.temp.get(ttl, || {
            components.refresh(true);
            let cpu: Vec<f32> = components.list().iter().filter(|c| is_cpu_sensor(c.label())).filter_map(|c| c.temperature()).filter(|t| *t > 0.0).collect();
            let main = *cpu.first()?;
            Some(Temp { cpu: main.round(), max: cpu.iter().copied().fold(main, f32::max).round() })
        });
        let battery = *self.battery.get(ttl, battery_reading);
        let mut procs = self.processes();
        procs.sort_by(by_cpu);
        let top_procs = procs.iter().take(3).map(|p| TopProc { name: p.name.clone(), cpu: round1(p.cpu) }).collect();
        let failed_services = self.services().into_iter().filter(|s| s.state == crate::schema::ServiceState::Failed).map(|s| s.name).collect();
        let load = System::load_average();
        let total = self.sys.total_memory();
        let available = self.sys.available_memory().min(total);
        let free = self.sys.free_memory().min(available);
        Metrics {
            at: crate::now_ms(),
            info,
            uptime_sec: System::uptime(),
            cpu: Cpu { load: self.sys.global_cpu_usage(), cores: self.sys.cpus().iter().map(sysinfo::Cpu::cpu_usage).collect(), load_avg: [load.one, load.five, load.fifteen] },
            mem: Mem { total, used: total - available, cache: available - free, free, swap_used: self.sys.used_swap() },
            disks: disk_space,
            io: self.io,
            temp,
            battery,
            top_procs,
            failed_services,
            system: self.system_theme(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn row(device: &str, fs_type: &str, mount: &str, size: u64, used: u64) -> DiskRow {
        DiskRow { device: device.into(), fs_type: fs_type.into(), mount: mount.into(), size, used }
    }

    #[test]
    fn pick_disks_dedupes_btrfs_subvolumes_and_maps_the_macos_data_volume_to_root() {
        let linux = [
            row("/dev/mapper/root", "btrfs", "/home", 500_000_000_000, 100_000_000_000),
            row("/dev/mapper/root", "btrfs", "/", 500_000_000_000, 100_000_000_000),
            row("efivarfs", "efivarfs", "/sys/firmware/efi/efivars", 200_000, 100_000),
        ];
        assert_eq!(pick_disks(&linux, false).iter().map(|d| d.mount.as_str()).collect::<Vec<_>>(), ["/"]);
        let mac = [
            row("/dev/disk3s1s1", "apfs", "/", 990_000_000_000, 12_000_000_000),
            row("/dev/disk3s5", "apfs", "/System/Volumes/Data", 990_000_000_000, 400_000_000_000),
            row("/dev/disk3s6", "apfs", "/System/Volumes/VM", 990_000_000_000, 20_000_000_000),
        ];
        assert_eq!(pick_disks(&mac, true), vec![Disk { mount: "/".into(), size: 990_000_000_000, used: 400_000_000_000 }]);
    }

    #[test]
    fn interfaces_that_are_loopback_tunnels_or_bridges_do_not_count_as_traffic() {
        assert!(skip_iface("lo"));
        assert!(skip_iface("tailscale0"));
        assert!(skip_iface("ap1"));
        assert!(!skip_iface("wlan0"));
        assert!(!skip_iface("en0"));
    }

    #[test]
    fn cpu_models_lose_trademark_noise_and_the_clock_suffix() {
        assert_eq!(clean_cpu_model("Intel(R) Core(TM) i7-10750H CPU @ 2.60GHz"), "Intel Core i7-10750H");
        assert_eq!(clean_cpu_model("Apple M5"), "Apple M5");
    }

    #[test]
    fn system_theme_resolves_omarchy_mode_fallbacks_without_dropping_colors() {
        let cases = [
            ("mode = \"light\"\ntheme_type = \"dark\"\nbackground = \"#000000\"\n", false, SystemThemeMode::Light),
            ("theme_type = \"light\"\nbackground = \"#000000\"\n", false, SystemThemeMode::Light),
            ("mode = \"unknown\"\ntheme_type = \"light\"\nbackground = \"#000000\"\n", false, SystemThemeMode::Light),
            ("background = \"#000000\"\n", true, SystemThemeMode::Light),
            ("background = \"#ffffff\"\n", false, SystemThemeMode::Light),
            ("background = \"#7f7f7f\"\n", false, SystemThemeMode::Dark),
            ("accent = \"#123456\"\n", false, SystemThemeMode::Dark),
        ];

        for (body, light_marker, expected) in cases {
            let dir = tempdir().expect("theme directory");
            let path = dir.path().join("colors.toml");
            fs::write(&path, body).expect("colors.toml");
            if light_marker {
                fs::write(dir.path().join("light.mode"), "").expect("light.mode");
            }

            let theme = system_theme(&path, "Mono".into()).expect("colors.toml always reports system");
            assert_eq!(theme.mode, expected, "mode for {body:?}");
            assert_eq!(theme.colors.get("accent").map(String::as_str), body.contains("accent =").then_some("#123456"), "colors remain present");
        }
    }

    #[test]
    fn system_theme_does_not_strip_a_utf8_bom_before_the_mode_key() {
        let dir = tempdir().expect("theme directory");
        let path = dir.path().join("colors.toml");
        fs::write(&path, "\u{feff}mode = \"light\"\nbackground = \"#000000\"\n").expect("colors.toml");

        let theme = system_theme(&path, "Mono".into()).expect("colors.toml always reports system");
        assert_eq!(theme.mode, SystemThemeMode::Dark);
        assert_eq!(theme.colors.get("background").map(String::as_str), Some("#000000"));
    }
}
