use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use chrono::{Local, TimeZone};
use sysinfo::{Components, CpuRefreshKind, DiskRefreshKind, Disks, MemoryRefreshKind, Networks, ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System, UpdateKind, Users};

use crate::processes::{self, RawProcess, by_cpu, round1};
use crate::schema::{Battery, Cpu, Disk, Info, Io, Mem, Metrics, Port, Service, Temp, TopProc};
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
        }
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
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
