use std::collections::HashSet;
use std::path::Path;

use crate::procnet;
use crate::schema::Port;
use crate::services::run;

fn split_host_port(addr: &str, sep: char) -> Option<(String, u16)> {
    let (host, port) = addr.rsplit_once(sep)?;
    let host = host.trim_start_matches('[').trim_end_matches(']');
    Some((host.to_string(), port.parse().ok()?))
}

pub fn parse_netstat(text: &str) -> Vec<Port> {
    text.lines()
        .filter_map(|line| {
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.len() < 19 || cols.get(5) != Some(&"LISTEN") {
                return None;
            }
            let proto = cols[0].trim_end_matches(['4', '6']).to_string();
            let (bind, port) = split_host_port(cols[3], '.')?;
            let (name, pid) = cols[10..cols.len() - 8].join(" ").rsplit_once(':').map(|(n, p)| (n.to_string(), p.parse().ok()))?;
            Some(Port { port, proto, bind, pid, process: name })
        })
        .collect()
}

pub fn collect(name_of: impl Fn(u32) -> Option<String>) -> Vec<Port> {
    let raw = if cfg!(target_os = "macos") { parse_netstat(&run("netstat", &["-anvp", "tcp"])) } else { procnet::listeners(Path::new("/proc")) };
    let mut seen = HashSet::new();
    let mut out: Vec<Port> = raw
        .into_iter()
        .filter(|p| seen.insert((p.port, p.proto.clone(), p.pid)))
        .map(|p| Port { process: p.pid.and_then(&name_of).unwrap_or(p.process), ..p })
        .collect();
    out.sort_by_key(|p| p.port);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn netstat_listeners_read_process_names_that_contain_spaces() {
        let text = "Proto Recv-Q Send-Q  Local Address  Foreign Address  (state)  rxbytes txbytes rhiwat shiwat process:pid state options gencnt flags flags1 usecnt rtncnt fltrs\n\
tcp4       0      0  100.64.0.10.7070     *.*                    LISTEN                 0            0  131072  131072      mirai-agent:27954  00100 00000006 000000000498367e 00000001 00000800      1      0 000000\n\
tcp46      0      0  *.50038                *.*                    LISTEN                 0            0  131072  131072 Google Chrome He:97997  00100 00000006 0000000004973e41 00000000 00080800      1      0 000000\n\
tcp4       0      0  127.0.0.1.8384         127.0.0.1.55292        ESTABLISHED        25552          878  395648  146988        syncthing:9107   00102 0000000c 00000000049fa29d 00000080 01002800      2      0 000000\n";
        assert_eq!(
            parse_netstat(text),
            vec![
                Port { port: 7070, proto: "tcp".into(), bind: "100.64.0.10".into(), pid: Some(27954), process: "mirai-agent".into() },
                Port { port: 50038, proto: "tcp".into(), bind: "*".into(), pid: Some(97997), process: "Google Chrome He".into() },
            ]
        );
    }
}
