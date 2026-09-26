use std::collections::HashMap;
use std::fs;
use std::net::{Ipv4Addr, Ipv6Addr};
use std::path::Path;

use crate::schema::Port;

const LISTEN: u8 = 0x0A;
const ESTABLISHED: u8 = 0x01;

#[derive(Debug, PartialEq)]
pub struct TcpEntry {
    pub local: (String, u16),
    pub remote: (String, u16),
    pub state: u8,
    pub inode: u64,
}

fn ip_of(hex: &str) -> Option<String> {
    let word = |h: &str| u32::from_str_radix(h, 16).ok().map(u32::to_le_bytes);
    match hex.len() {
        8 => Some(Ipv4Addr::from(word(hex)?).to_string()),
        32 => {
            let mut bytes = [0u8; 16];
            for (i, chunk) in bytes.chunks_mut(4).enumerate() {
                chunk.copy_from_slice(&word(hex.get(i * 8..i * 8 + 8)?)?);
            }
            Some(Ipv6Addr::from(bytes).to_string())
        }
        _ => None,
    }
}

fn endpoint(field: &str) -> Option<(String, u16)> {
    let (ip, port) = field.split_once(':')?;
    Some((ip_of(ip)?, u16::from_str_radix(port, 16).ok()?))
}

pub fn parse_tcp(text: &str) -> Vec<TcpEntry> {
    text.lines()
        .skip(1)
        .filter_map(|line| {
            let cols: Vec<&str> = line.split_whitespace().collect();
            Some(TcpEntry { local: endpoint(cols.get(1)?)?, remote: endpoint(cols.get(2)?)?, state: u8::from_str_radix(cols.get(3)?, 16).ok()?, inode: cols.get(9)?.parse().ok()? })
        })
        .collect()
}

pub fn socket_inode(link: &str) -> Option<u64> {
    link.strip_prefix("socket:[")?.strip_suffix(']')?.parse().ok()
}

fn socket_owners(proc_root: &Path) -> HashMap<u64, u32> {
    let mut owners = HashMap::new();
    let Ok(pids) = fs::read_dir(proc_root) else { return owners };
    for entry in pids.flatten() {
        let Some(pid) = entry.file_name().to_str().and_then(|n| n.parse::<u32>().ok()) else { continue };
        let Ok(fds) = fs::read_dir(entry.path().join("fd")) else { continue };
        for fd in fds.flatten() {
            if let Some(inode) = fs::read_link(fd.path()).ok().and_then(|l| l.to_str().and_then(socket_inode)) {
                owners.entry(inode).or_insert(pid);
            }
        }
    }
    owners
}

fn tcp_entries(proc_root: &Path) -> Vec<TcpEntry> {
    ["net/tcp", "net/tcp6"].iter().flat_map(|f| parse_tcp(&fs::read_to_string(proc_root.join(f)).unwrap_or_default())).collect()
}

fn comm(proc_root: &Path, pid: u32) -> String {
    fs::read_to_string(proc_root.join(pid.to_string()).join("comm")).map(|c| c.trim().to_string()).unwrap_or_default()
}

pub fn listeners(proc_root: &Path) -> Vec<Port> {
    let entries: Vec<TcpEntry> = tcp_entries(proc_root).into_iter().filter(|e| e.state == LISTEN).collect();
    let owners = socket_owners(proc_root);
    entries
        .into_iter()
        .map(|e| {
            let pid = owners.get(&e.inode).copied();
            Port { port: e.local.1, proto: "tcp".into(), bind: e.local.0, pid, process: pid.map(|p| comm(proc_root, p)).unwrap_or_default() }
        })
        .collect()
}

pub struct Connection {
    pub pid: u32,
    pub local: (String, u16),
    pub remote: (String, u16),
}

pub fn established(proc_root: &Path) -> Vec<Connection> {
    let entries: Vec<TcpEntry> = tcp_entries(proc_root).into_iter().filter(|e| e.state == ESTABLISHED).collect();
    let owners = socket_owners(proc_root);
    entries.into_iter().filter_map(|e| Some(Connection { pid: *owners.get(&e.inode)?, local: e.local, remote: e.remote })).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    const TCP: &str = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n\
   0: 0100007F:20D0 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 111 1 0000000000000000 100 0 0 10 0\n\
   1: 0100007F:D6E2 0100007F:20D0 01 00000000:00000000 00:00000000 00000000  1000        0 222 1 0000000000000000 20 4 30 10 -1\n\
   2: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 333 1 0000000000000000 100 0 0 10 0\n";
    const TCP6: &str = "  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n\
   0: 00000000000000000000000000000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 444 1 0000000000000000 100 0 0 10 0\n\
   1: 0000000000000000FFFF00000100007F:C350 0000000000000000FFFF00000100007F:20D0 01 00000000:00000000 00:00000000 00000000  1000        0 555 1 0000000000000000 20 4 30 10 -1\n";

    #[test]
    fn proc_net_tcp_rows_decode_to_addresses_ports_states_and_inodes() {
        assert_eq!(
            parse_tcp(TCP),
            vec![
                TcpEntry { local: ("127.0.0.1".into(), 8400), remote: ("0.0.0.0".into(), 0), state: LISTEN, inode: 111 },
                TcpEntry { local: ("127.0.0.1".into(), 55010), remote: ("127.0.0.1".into(), 8400), state: ESTABLISHED, inode: 222 },
                TcpEntry { local: ("0.0.0.0".into(), 22), remote: ("0.0.0.0".into(), 0), state: LISTEN, inode: 333 },
            ]
        );
        let v6 = parse_tcp(TCP6);
        assert_eq!(v6[0].local, ("::".into(), 8080));
        assert_eq!(v6[1].local, ("::ffff:127.0.0.1".into(), 50000));
    }

    #[test]
    fn socket_links_name_their_inode() {
        assert_eq!(socket_inode("socket:[12345]"), Some(12345));
        assert_eq!(socket_inode("/dev/null"), None);
        assert_eq!(socket_inode("pipe:[9]"), None);
    }

    fn fake_proc() -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        let p = root.path();
        fs::create_dir_all(p.join("net")).unwrap();
        fs::write(p.join("net/tcp"), TCP).unwrap();
        fs::write(p.join("net/tcp6"), TCP6).unwrap();
        for (pid, name, inodes) in [(4242u32, "bun", vec![111u64, 444]), (5151, "node", vec![222, 555])] {
            let dir = p.join(pid.to_string());
            fs::create_dir_all(dir.join("fd")).unwrap();
            fs::write(dir.join("comm"), format!("{name}\n")).unwrap();
            for (fd, inode) in inodes.iter().enumerate() {
                symlink(format!("socket:[{inode}]"), dir.join("fd").join(fd.to_string())).unwrap();
            }
            symlink("/dev/null", dir.join("fd").join("9")).unwrap();
        }
        root
    }

    #[test]
    fn listeners_carry_their_owner_when_the_socket_is_ours_and_none_otherwise() {
        let root = fake_proc();
        let got = listeners(root.path());
        assert_eq!(
            got,
            vec![
                Port { port: 8400, proto: "tcp".into(), bind: "127.0.0.1".into(), pid: Some(4242), process: "bun".into() },
                Port { port: 22, proto: "tcp".into(), bind: "0.0.0.0".into(), pid: None, process: String::new() },
                Port { port: 8080, proto: "tcp".into(), bind: "::".into(), pid: Some(4242), process: "bun".into() },
            ]
        );
    }

    #[test]
    fn established_connections_are_tied_to_the_process_that_holds_them() {
        let root = fake_proc();
        let got: Vec<(u32, u16, u16)> = established(root.path()).into_iter().map(|c| (c.pid, c.local.1, c.remote.1)).collect();
        assert_eq!(got, vec![(5151, 55010, 8400), (5151, 50000, 8400)]);
    }
}
