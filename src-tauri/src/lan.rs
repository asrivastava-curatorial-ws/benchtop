//! Local network tools: find the devices on the network (TCP probes, the
//! system's ARP table and reverse DNS; no administrator rights needed), check
//! a device's open ports, wake computers with Wake-on-LAN, and measure the
//! speed to another computer running Benchtop's speed test.

use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, State};

/// Connections tried at once: macOS gives apps only 256 open files by default.
fn parallel() -> usize {
    if cfg!(target_os = "macos") {
        160
    } else {
        384
    }
}

#[derive(Default)]
pub struct LanState {
    cancelled: Mutex<HashSet<String>>,
}

/// Ports tried when looking for devices: a "connection refused" answer also proves the device is there.
pub const PROBE_PORTS: &[u16] = &[
    80, 443, 22, 445, 139, 3389, 8080, 554, 9100, 62078, 5000, 7000, 8008, 8009, 1883, 23, 21, 53,
    5353, 631,
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanInfo {
    pub address: Option<String>,
    /// A guess at this network's range: the address's /24.
    pub cidr: Option<String>,
}

#[tauri::command]
pub fn lan_info() -> LanInfo {
    match crate::serve::lan_address() {
        Some(IpAddr::V4(ip)) => {
            let o = ip.octets();
            LanInfo {
                address: Some(ip.to_string()),
                cidr: Some(format!("{}.{}.{}.0/24", o[0], o[1], o[2])),
            }
        }
        Some(ip) => LanInfo {
            address: Some(ip.to_string()),
            cidr: None,
        },
        None => LanInfo {
            address: None,
            cidr: None,
        },
    }
}

/// Addresses in an IPv4 range ("192.168.1.0/24", or "192.168.1.10-60"), at most 1024.
pub fn hosts_in(range: &str) -> Result<Vec<Ipv4Addr>, String> {
    let text = range.trim();
    if let Some((base, prefix)) = text.split_once('/') {
        let ip: Ipv4Addr = base
            .trim()
            .parse()
            .map_err(|_| format!("“{base}” is not an IPv4 address."))?;
        let prefix: u32 = prefix
            .trim()
            .parse()
            .map_err(|_| "The prefix after / must be a number.".to_string())?;
        if !(22..=32).contains(&prefix) {
            return Err("Scan at most 1024 addresses: use a prefix from /22 to /32.".into());
        }
        let mask = if prefix == 0 {
            0
        } else {
            u32::MAX << (32 - prefix)
        };
        let network = u32::from(ip) & mask;
        let count = 1u32 << (32 - prefix);
        if count <= 2 {
            return Ok((0..count).map(|i| Ipv4Addr::from(network + i)).collect());
        }
        return Ok((1..count - 1)
            .map(|i| Ipv4Addr::from(network + i))
            .collect());
    }
    if let Some((start, end)) = text.split_once('-') {
        let a: Ipv4Addr = start
            .trim()
            .parse()
            .map_err(|_| format!("“{start}” is not an IPv4 address."))?;
        let end = end.trim();
        let b: Ipv4Addr = if end.contains('.') {
            end.parse()
                .map_err(|_| format!("“{end}” is not an IPv4 address."))?
        } else {
            let o = a.octets();
            Ipv4Addr::new(
                o[0],
                o[1],
                o[2],
                end.parse()
                    .map_err(|_| format!("“{end}” is not a number."))?,
            )
        };
        let (x, y) = (u32::from(a), u32::from(b));
        if y < x || y - x >= 1024 {
            return Err("The range must go upwards and hold at most 1024 addresses.".into());
        }
        return Ok((x..=y).map(Ipv4Addr::from).collect());
    }
    let ip: Ipv4Addr = text
        .parse()
        .map_err(|_| "Enter a range such as 192.168.1.0/24 or 192.168.1.10-60.".to_string())?;
    Ok(vec![ip])
}

/// IP → MAC pairs from the system's ARP (neighbour) table.
pub fn parse_arp(text: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for line in text.lines() {
        let ip = line
            .split(|c: char| !(c.is_ascii_digit() || c == '.'))
            .find(|w| w.parse::<Ipv4Addr>().is_ok());
        let mac = line
            .split(|c: char| c.is_whitespace() || c == '(' || c == ')')
            .find(|w| {
                let parts: Vec<&str> = w.split([':', '-']).collect();
                parts.len() == 6
                    && parts.iter().all(|p| {
                        (1..=2).contains(&p.len()) && p.chars().all(|c| c.is_ascii_hexdigit())
                    })
            });
        if let (Some(ip), Some(mac)) = (ip, mac) {
            let mac = mac
                .split([':', '-'])
                .map(|p| format!("{:0>2}", p.to_ascii_lowercase()))
                .collect::<Vec<_>>()
                .join(":");
            if mac != "00:00:00:00:00:00" && mac != "ff:ff:ff:ff:ff:ff" {
                out.insert(ip.to_string(), mac);
            }
        }
    }
    out
}

fn arp_table() -> HashMap<String, String> {
    if cfg!(target_os = "linux") {
        if let Ok(text) = std::fs::read_to_string("/proc/net/arp") {
            return parse_arp(&text);
        }
    }
    let mut command = Command::new("arp");
    command.arg(if cfg!(target_os = "windows") {
        "-a"
    } else {
        "-an"
    });
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
        .output()
        .map(|o| parse_arp(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_default()
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Host {
    pub ip: String,
    pub mac: Option<String>,
    pub name: Option<String>,
    pub open: Vec<u16>,
    /// Time to the first answer, in milliseconds.
    pub rtt: Option<u64>,
    pub this_computer: bool,
}

#[derive(Debug, PartialEq, Eq)]
enum Probe {
    Open,
    Refused,
    Silent,
}

async fn probe(ip: IpAddr, port: u16, limit: Duration) -> (Probe, Duration) {
    let started = Instant::now();
    let result = match tokio::time::timeout(
        limit,
        tokio::net::TcpStream::connect(SocketAddr::new(ip, port)),
    )
    .await
    {
        Ok(Ok(_)) => Probe::Open,
        Ok(Err(e)) if e.kind() == std::io::ErrorKind::ConnectionRefused => Probe::Refused,
        _ => Probe::Silent,
    };
    (result, started.elapsed())
}

async fn reverse_name(resolver: &hickory_resolver::TokioResolver, ip: IpAddr) -> Option<String> {
    let lookup = tokio::time::timeout(Duration::from_millis(1500), resolver.reverse_lookup(ip))
        .await
        .ok()?
        .ok()?;
    lookup
        .answers()
        .iter()
        .find_map(|record| match &record.data {
            hickory_proto::rr::RData::PTR(name) => {
                Some(name.to_string().trim_end_matches('.').to_string())
            }
            _ => None,
        })
}

/// Probes every address; reports each device that answers as soon as it does.
pub async fn probe_hosts(
    hosts: &[Ipv4Addr],
    ports: &[u16],
    limit: Duration,
    found: impl Fn(&Host),
    progress: impl Fn(usize),
    cancelled: impl Fn() -> bool,
) -> Vec<Host> {
    let own = crate::serve::lan_address().map(|ip| ip.to_string());
    let semaphore = Arc::new(tokio::sync::Semaphore::new(parallel()));
    let mut tasks = tokio::task::JoinSet::new();
    for ip in hosts.iter().copied() {
        let ports = ports.to_vec();
        let semaphore = semaphore.clone();
        tasks.spawn(async move {
            let mut probes = tokio::task::JoinSet::new();
            for port in ports {
                let semaphore = semaphore.clone();
                probes.spawn(async move {
                    let _permit = semaphore.acquire_owned().await;
                    (port, probe(IpAddr::V4(ip), port, limit).await)
                });
            }
            let mut open = Vec::new();
            let mut alive = false;
            let mut rtt: Option<Duration> = None;
            while let Some(Ok((port, (result, took)))) = probes.join_next().await {
                if result != Probe::Silent {
                    alive = true;
                    rtt = Some(rtt.map_or(took, |r| r.min(took)));
                }
                if result == Probe::Open {
                    open.push(port);
                }
            }
            open.sort_unstable();
            (ip, alive, open, rtt)
        });
    }
    let mut out: Vec<Host> = Vec::new();
    let mut done = 0usize;
    while let Some(joined) = tasks.join_next().await {
        if cancelled() {
            tasks.abort_all();
            break;
        }
        done += 1;
        if let Ok((ip, true, open, rtt)) = joined {
            let host = Host {
                ip: ip.to_string(),
                mac: None,
                name: None,
                open,
                rtt: rtt.map(|d| d.as_millis() as u64),
                this_computer: own.as_deref() == Some(&ip.to_string()),
            };
            found(&host);
            out.push(host);
        }
        progress(done);
    }
    out
}

#[tauri::command]
pub async fn lan_scan(
    app: AppHandle,
    id: String,
    range: String,
    ports: Vec<u16>,
    state: State<'_, LanState>,
) -> Result<Vec<Host>, String> {
    let hosts = hosts_in(&range)?;
    state
        .cancelled
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id);
    let ports: Vec<u16> = if ports.is_empty() {
        PROBE_PORTS.to_vec()
    } else {
        ports
    };
    let total = hosts.len();
    let mut found = probe_hosts(
        &hosts,
        &ports,
        Duration::from_millis(700),
        |host| {
            let _ = app.emit("lan-host", json!({ "id": id, "host": host }));
        },
        |done| {
            let _ = app.emit(
                "lan-progress",
                json!({ "id": id, "done": done, "total": total }),
            );
        },
        || {
            state
                .cancelled
                .lock()
                .map(|c| c.contains(&id))
                .unwrap_or(false)
        },
    )
    .await;
    // The probes made the system resolve every address on the local link, so the
    // ARP table now also lists devices that answered nothing on these ports.
    let arp = arp_table();
    let wanted: HashSet<String> = hosts.iter().map(Ipv4Addr::to_string).collect();
    for (ip, mac) in &arp {
        if !wanted.contains(ip) {
            continue;
        }
        match found.iter_mut().find(|h| &h.ip == ip) {
            Some(h) => h.mac = Some(mac.clone()),
            None => found.push(Host {
                ip: ip.clone(),
                mac: Some(mac.clone()),
                name: None,
                open: Vec::new(),
                rtt: None,
                this_computer: false,
            }),
        }
    }
    if let Ok(resolver) = hickory_resolver::TokioResolver::builder_tokio().and_then(|b| b.build()) {
        let mut names = tokio::task::JoinSet::new();
        for h in &found {
            let resolver = resolver.clone();
            let Ok(ip) = h.ip.parse::<IpAddr>() else {
                continue;
            };
            names.spawn(async move { (ip.to_string(), reverse_name(&resolver, ip).await) });
        }
        while let Some(Ok((ip, name))) = names.join_next().await {
            if let Some(h) = found.iter_mut().find(|h| h.ip == ip) {
                h.name = name;
            }
        }
    }
    found.sort_by_key(|h| h.ip.parse::<Ipv4Addr>().map(u32::from).unwrap_or(u32::MAX));
    state
        .cancelled
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id);
    Ok(found)
}

#[tauri::command]
pub fn lan_cancel(id: String, state: State<'_, LanState>) {
    if let Ok(mut c) = state.cancelled.lock() {
        c.insert(id);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortResult {
    pub port: u16,
    /// "open", "closed" (refused) or "filtered" (no answer).
    pub state: &'static str,
}

/// Checks a list of ports on one device.
#[tauri::command]
pub async fn lan_ports(
    host: String,
    ports: Vec<u16>,
    timeout_ms: u64,
) -> Result<Vec<PortResult>, String> {
    if ports.len() > 2000 {
        return Err("Check at most 2000 ports at a time.".into());
    }
    let address: IpAddr = match host.trim().parse() {
        Ok(ip) => ip,
        Err(_) => tokio::net::lookup_host((host.trim(), 0))
            .await
            .map_err(|e| format!("{host} was not found: {e}"))?
            .next()
            .map(|a| a.ip())
            .ok_or("Not found")?,
    };
    let limit = Duration::from_millis(timeout_ms.clamp(100, 10_000));
    let semaphore = Arc::new(tokio::sync::Semaphore::new(parallel().min(256)));
    let mut tasks = tokio::task::JoinSet::new();
    for port in ports {
        let semaphore = semaphore.clone();
        tasks.spawn(async move {
            let _permit = semaphore.acquire_owned().await;
            let (result, _) = probe(address, port, limit).await;
            PortResult {
                port,
                state: match result {
                    Probe::Open => "open",
                    Probe::Refused => "closed",
                    Probe::Silent => "filtered",
                },
            }
        });
    }
    let mut out = Vec::new();
    while let Some(Ok(r)) = tasks.join_next().await {
        out.push(r);
    }
    out.sort_by_key(|r| r.port);
    Ok(out)
}

/// The Wake-on-LAN "magic packet": six 0xFF bytes, then the MAC address sixteen times.
pub fn magic_packet(mac: &str) -> Result<Vec<u8>, String> {
    let hex: String = mac.chars().filter(char::is_ascii_hexdigit).collect();
    if hex.len() != 12 {
        return Err(format!(
            "“{mac}” is not a MAC address (12 hex digits, such as 3C:52:82:1A:2B:3C)."
        ));
    }
    let bytes: Vec<u8> = (0..6)
        .map(|i| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap_or(0))
        .collect();
    let mut packet = vec![0xFF; 6];
    for _ in 0..16 {
        packet.extend_from_slice(&bytes);
    }
    Ok(packet)
}

#[tauri::command]
pub fn lan_wake(mac: String, broadcast: Option<String>, port: Option<u16>) -> Result<(), String> {
    let packet = magic_packet(&mac)?;
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    socket.set_broadcast(true).map_err(|e| e.to_string())?;
    let mut targets = vec!["255.255.255.255".to_string()];
    if let Some(b) = broadcast.filter(|b| !b.trim().is_empty()) {
        targets.insert(0, b.trim().to_string());
    } else if let Some(IpAddr::V4(ip)) = crate::serve::lan_address() {
        let o = ip.octets();
        targets.insert(0, format!("{}.{}.{}.255", o[0], o[1], o[2]));
    }
    let mut sent = false;
    for target in &targets {
        for p in [port.unwrap_or(9), 7] {
            if socket.send_to(&packet, (target.as_str(), p)).is_ok() {
                sent = true;
            }
        }
    }
    if sent {
        Ok(())
    } else {
        Err("The packet could not be sent on this network.".into())
    }
}

/* ----------------------------------------------------------- speed test -- */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedResult {
    pub latency_ms: f64,
    pub download_mbps: f64,
    pub upload_mbps: f64,
    pub megabytes: f64,
}

/// Measures latency, download and upload speed to a computer running Benchtop's speed test server.
#[tauri::command]
pub async fn lan_speed(address: String, seconds: u64) -> Result<SpeedResult, String> {
    let base = address.trim().trim_end_matches('/').to_string();
    let base = if base.starts_with("http") {
        base
    } else {
        format!("http://{base}")
    };
    crate::net::ensure_crypto_provider();
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(seconds.clamp(2, 60) + 30))
        .build()
        .map_err(|e| e.to_string())?;
    // Latency: a few tiny requests.
    let mut best = f64::MAX;
    for _ in 0..5 {
        let t = Instant::now();
        client
            .get(format!("{base}/speed/ping"))
            .send()
            .await
            .map_err(|e| {
                format!(
                    "The speed test server did not answer: {}",
                    crate::net::chain_message(&e)
                )
            })?;
        best = best.min(t.elapsed().as_secs_f64() * 1000.0);
    }
    let window = Duration::from_secs(seconds.clamp(2, 60));
    // Download: ask for ever larger blocks until the time is used.
    let mut bytes = 0u64;
    let mut size = 1u64 << 20;
    let started = Instant::now();
    while started.elapsed() < window {
        let mut response = client
            .get(format!("{base}/speed/down?bytes={size}"))
            .send()
            .await
            .map_err(|e| crate::net::chain_message(&e))?;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| crate::net::chain_message(&e))?
        {
            bytes += chunk.len() as u64;
        }
        size = (size * 2).min(256 << 20);
    }
    let download = bytes as f64 * 8.0 / started.elapsed().as_secs_f64() / 1e6;
    let block = vec![0x5Au8; 4 << 20];
    let mut sent = 0u64;
    let started = Instant::now();
    while started.elapsed() < window {
        client
            .put(format!("{base}/speed/up"))
            .body(block.clone())
            .send()
            .await
            .map_err(|e| crate::net::chain_message(&e))?;
        sent += block.len() as u64;
    }
    let upload = sent as f64 * 8.0 / started.elapsed().as_secs_f64() / 1e6;
    Ok(SpeedResult {
        latency_ms: (best * 10.0).round() / 10.0,
        download_mbps: (download * 10.0).round() / 10.0,
        upload_mbps: (upload * 10.0).round() / 10.0,
        megabytes: ((bytes + sent) as f64 / 1e6).round(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_addresses_in_ranges() {
        let net = hosts_in("192.168.1.77/24").unwrap();
        assert_eq!(net.len(), 254);
        assert_eq!(net[0].to_string(), "192.168.1.1");
        assert_eq!(net[253].to_string(), "192.168.1.254");
        assert_eq!(hosts_in("10.0.0.5-8").unwrap().len(), 4);
        assert_eq!(hosts_in("10.0.0.5").unwrap().len(), 1);
        assert!(hosts_in("10.0.0.0/16").is_err());
        assert!(hosts_in("10.0.0.9-3").is_err());
    }

    #[test]
    fn reads_arp_tables_from_each_system() {
        let linux = "IP address       HW type     Flags       HW address            Mask     Device\n192.168.1.1      0x1         0x2         a4:2b:b0:12:34:56     *        wlan0\n192.168.1.9      0x1         0x0         00:00:00:00:00:00     *        wlan0\n";
        let mac = "? (192.168.1.20) at 3c:52:82:1a:2b:3c on en0 ifscope [ethernet]\n? (192.168.1.21) at (incomplete) on en0 ifscope [ethernet]\n";
        let windows = "Interface: 192.168.1.50 --- 0x5\n  Internet Address      Physical Address      Type\n  192.168.1.1           a4-2b-b0-12-34-56     dynamic\n  192.168.1.255         ff-ff-ff-ff-ff-ff     static\n";
        assert_eq!(
            parse_arp(linux).get("192.168.1.1").map(String::as_str),
            Some("a4:2b:b0:12:34:56")
        );
        assert!(!parse_arp(linux).contains_key("192.168.1.9"));
        assert_eq!(
            parse_arp(mac).get("192.168.1.20").map(String::as_str),
            Some("3c:52:82:1a:2b:3c")
        );
        assert_eq!(parse_arp(mac).len(), 1);
        let w = parse_arp(windows);
        assert_eq!(
            w.get("192.168.1.1").map(String::as_str),
            Some("a4:2b:b0:12:34:56")
        );
        assert!(!w.contains_key("192.168.1.255"));
    }

    #[test]
    fn makes_magic_packets() {
        let p = magic_packet("3C-52-82-1A-2B-3C").unwrap();
        assert_eq!(p.len(), 102);
        assert_eq!(&p[..6], &[0xFF; 6]);
        assert_eq!(&p[6..12], &[0x3C, 0x52, 0x82, 0x1A, 0x2B, 0x3C]);
        assert!(magic_packet("3C:52:82").is_err());
    }

    #[test]
    fn measures_speed_against_the_speed_test_server() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let log = Arc::new(Mutex::new(Vec::new()));
            let sink = log.clone();
            let config: crate::serve::ServeConfig =
                serde_json::from_value(json!({ "kind": "speed" })).unwrap();
            let (started, stop) = crate::serve::start(
                config,
                None,
                Box::new(move |v| sink.lock().unwrap().push(v)),
            )
            .await
            .unwrap();
            let base = format!("127.0.0.1:{}", started.port);
            crate::net::ensure_crypto_provider();
            let client = reqwest::Client::builder().no_proxy().build().unwrap();
            let page = client
                .get(format!("http://{base}/"))
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap();
            assert!(page.contains("Network speed test"));
            let down = client
                .get(format!("http://{base}/speed/down?bytes=300000"))
                .send()
                .await
                .unwrap()
                .bytes()
                .await
                .unwrap();
            assert_eq!(down.len(), 300_000);
            let result = lan_speed(base, 2).await.unwrap();
            assert!(
                result.download_mbps > 1.0 && result.upload_mbps > 1.0,
                "{} / {}",
                result.download_mbps,
                result.upload_mbps
            );
            assert!(result.latency_ms < 1000.0);
            let entries = log.lock().unwrap();
            assert!(entries
                .iter()
                .any(|e| e["path"] == "/speed/up" && e["size"] == json!(4u64 << 20)));
            assert!(!entries.iter().any(|e| e["path"] == "/speed/ping"));
            let _ = stop.send(true);
        });
    }

    #[test]
    fn finds_an_open_port_on_this_computer() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let (open, _) = probe(
                IpAddr::V4(Ipv4Addr::LOCALHOST),
                port,
                Duration::from_millis(500),
            )
            .await;
            assert_eq!(open, Probe::Open);
            drop(listener);
            let (closed, _) = probe(
                IpAddr::V4(Ipv4Addr::LOCALHOST),
                port,
                Duration::from_millis(500),
            )
            .await;
            assert_eq!(closed, Probe::Refused);

            // A scan of this computer finds it from the refused probes alone, and lists the listening port.
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let seen = Mutex::new(Vec::new());
            let hosts = probe_hosts(
                &[Ipv4Addr::LOCALHOST],
                &[port, 1],
                Duration::from_millis(500),
                |h| seen.lock().unwrap().push(h.ip.clone()),
                |_| {},
                || false,
            )
            .await;
            assert_eq!(hosts.len(), 1);
            assert_eq!(hosts[0].open, vec![port]);
            assert_eq!(seen.lock().unwrap().as_slice(), ["127.0.0.1"]);
            drop(listener);
        });
    }
}
