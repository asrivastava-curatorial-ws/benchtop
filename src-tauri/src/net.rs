//! Online checks: the only code in Benchtop that talks to the network.
//!
//! The web view never makes requests itself (its content security policy allows
//! no origin at all).  Instead the tools in the "Online checks" category call the
//! five commands below, each of which does one small, explicit thing for the host
//! the user typed: an HTTP request, a TLS handshake, a DNS query, a WHOIS query or
//! a TCP connection attempt.  Everything is parsed and presented in TypeScript.

use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Arc, Mutex, Once};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use hickory_proto::op::{Edns, Message, Query};
use hickory_proto::rr::{Name, Record, RecordType};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::CryptoProvider;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpStream, UdpSocket};
use tokio::time::timeout;

/// Largest response body handed to the web view.
const MAX_BODY: usize = 8 * 1024 * 1024;
/// Largest WHOIS answer.
const MAX_WHOIS: usize = 1024 * 1024;
/// Most ports probed in one request.
const MAX_PORTS: usize = 1024;

/// An error the web view can show as it is: what went wrong, in plain words, and a machine-readable kind.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct NetError {
    pub kind: &'static str,
    pub message: String,
}

fn fail(kind: &'static str, message: impl Into<String>) -> NetError {
    NetError {
        kind,
        message: message.into(),
    }
}

type NetResult<T> = Result<T, NetError>;

fn provider() -> Arc<CryptoProvider> {
    static INSTALL: Once = Once::new();
    INSTALL.call_once(|| {
        // Another component may have installed one first; either way a provider is in place.
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
    CryptoProvider::get_default()
        .cloned()
        .unwrap_or_else(|| Arc::new(rustls::crypto::ring::default_provider()))
}

/// Installs the ring crypto provider for other modules' HTTPS clients (model downloads).
pub(crate) fn ensure_crypto_provider() {
    let _ = provider();
}

fn clamp_timeout(ms: Option<u64>, default_ms: u64) -> Duration {
    Duration::from_millis(ms.unwrap_or(default_ms).clamp(500, 120_000))
}

fn millis(since: Instant) -> f64 {
    (since.elapsed().as_secs_f64() * 1000.0 * 10.0).round() / 10.0
}

/// The text of an error and every error it wraps, without repeats.
pub(crate) fn chain_message(error: &(dyn std::error::Error + 'static)) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut current: Option<&(dyn std::error::Error + 'static)> = Some(error);
    while let Some(err) = current {
        let text = err.to_string();
        if !parts.iter().any(|seen| seen.contains(&text)) {
            parts.push(text);
        }
        current = err.source();
    }
    parts.join(": ")
}

fn classify_io(error: &std::io::Error, target: &str) -> NetError {
    use std::io::ErrorKind;
    match error.kind() {
        ErrorKind::ConnectionRefused => {
            fail("refused", format!("{target} refused the connection."))
        }
        ErrorKind::TimedOut => fail("timeout", format!("{target} did not answer in time.")),
        ErrorKind::ConnectionReset | ErrorKind::ConnectionAborted => {
            fail("connect", format!("{target} closed the connection."))
        }
        _ => fail(
            "connect",
            format!("Could not connect to {target}: {error}."),
        ),
    }
}

/* ------------------------------------------------------------------ HTTP -- */

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    pub url: String,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub max_body: Option<usize>,
    /// Complete the request even when the certificate is not trusted (to inspect broken sites).
    #[serde(default)]
    pub insecure: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub url: String,
    pub status: u16,
    pub reason: String,
    pub version: String,
    pub headers: Vec<(String, String)>,
    /// The body exactly as received (not decompressed), Base64-encoded.
    pub body: String,
    pub body_size: usize,
    pub truncated: bool,
    pub remote_addr: Option<String>,
    /// Time until the response headers arrived.
    pub headers_ms: f64,
    pub elapsed_ms: f64,
    /// The server's leaf certificate (DER, Base64) for HTTPS.
    pub peer_certificate: Option<String>,
}

fn classify_reqwest(error: &reqwest::Error, url: &reqwest::Url) -> NetError {
    let host = url.host_str().unwrap_or("the server").to_string();
    let detail = chain_message(error);
    let lower = detail.to_lowercase();
    if error.is_timeout() {
        return fail(
            "timeout",
            format!("{host} did not answer within the time limit."),
        );
    }
    if lower.contains("dns error")
        || lower.contains("failed to lookup address")
        || lower.contains("name or service not known")
        || lower.contains("no such host")
        || lower.contains("nodename nor servname")
    {
        return fail(
            "dns",
            format!("The name {host} could not be found (DNS lookup failed)."),
        );
    }
    if lower.contains("certificate")
        || lower.contains("tls")
        || lower.contains("handshake")
        || lower.contains("invalidcertificate")
    {
        return fail(
            "tls",
            format!("The secure connection to {host} failed: {detail}"),
        );
    }
    if lower.contains("connection refused") {
        return fail("refused", format!("{host} refused the connection."));
    }
    if lower.contains("proxy") {
        return fail(
            "proxy",
            format!("The proxy server refused or failed the request: {detail}"),
        );
    }
    if error.is_builder() {
        return fail(
            "invalid",
            format!("The request could not be built: {detail}"),
        );
    }
    if error.is_connect() {
        return fail("connect", format!("Could not connect to {host}: {detail}"));
    }
    fail("http", detail)
}

/// One HTTP request, without following redirects (the caller follows them so each hop can be shown).
#[tauri::command]
pub async fn net_http(request: HttpRequest) -> NetResult<HttpResponse> {
    let _ = provider();
    let url = reqwest::Url::parse(request.url.trim())
        .map_err(|error| fail("invalid", format!("That is not a valid URL ({error}).")))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(fail(
            "invalid",
            "Only http:// and https:// addresses can be checked.",
        ));
    }
    let limit = Duration::from_millis(request.timeout_ms.unwrap_or(20_000).clamp(1_000, 120_000));
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(limit)
        .connect_timeout(limit.min(Duration::from_secs(15)))
        .tls_info(true)
        .tls_danger_accept_invalid_certs(request.insecure)
        .user_agent(concat!(
            "Benchtop/",
            env!("CARGO_PKG_VERSION"),
            " (online checks; +https://github.com/asrivastava-curatorial-ws/benchtop)"
        ))
        .build()
        .map_err(|error| fail("invalid", chain_message(&error)))?;
    let method = reqwest::Method::from_bytes(
        request
            .method
            .as_deref()
            .unwrap_or("GET")
            .to_uppercase()
            .as_bytes(),
    )
    .map_err(|_| fail("invalid", "That HTTP method is not valid."))?;
    let mut builder = client.request(method, url.clone());
    for (name, value) in &request.headers {
        builder = builder.header(name.as_str(), value.as_str());
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }
    let started = Instant::now();
    let mut response = builder
        .send()
        .await
        .map_err(|error| classify_reqwest(&error, &url))?;
    let headers_ms = millis(started);
    let status = response.status();
    let version = match response.version() {
        reqwest::Version::HTTP_09 => "HTTP/0.9",
        reqwest::Version::HTTP_10 => "HTTP/1.0",
        reqwest::Version::HTTP_11 => "HTTP/1.1",
        reqwest::Version::HTTP_2 => "HTTP/2",
        reqwest::Version::HTTP_3 => "HTTP/3",
        _ => "HTTP",
    }
    .to_string();
    let headers = response
        .headers()
        .iter()
        .map(|(name, value)| {
            (
                name.to_string(),
                String::from_utf8_lossy(value.as_bytes()).into_owned(),
            )
        })
        .collect();
    let remote_addr = response.remote_addr().map(|addr| addr.to_string());
    let peer_certificate = response
        .extensions()
        .get::<reqwest::tls::TlsInfo>()
        .and_then(|info| info.peer_certificate())
        .map(|der| B64.encode(der));
    let cap = request.max_body.unwrap_or(2 * 1024 * 1024).min(MAX_BODY);
    let mut body: Vec<u8> = Vec::new();
    let mut truncated = false;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| classify_reqwest(&error, &url))?
    {
        if body.len() + chunk.len() > cap {
            body.extend_from_slice(&chunk[..cap - body.len()]);
            truncated = true;
            break;
        }
        body.extend_from_slice(&chunk);
    }
    Ok(HttpResponse {
        url: url.to_string(),
        status: status.as_u16(),
        reason: status.canonical_reason().unwrap_or("").to_string(),
        version,
        headers,
        body_size: body.len(),
        body: B64.encode(&body),
        truncated,
        remote_addr,
        headers_ms,
        elapsed_ms: millis(started),
        peer_certificate,
    })
}

/* ------------------------------------------------- connections and proxy -- */

/// Reads an HTTP response head (up to the blank line) from a proxy.
async fn read_head(stream: &mut TcpStream) -> std::io::Result<String> {
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        if head.len() > 16 * 1024 || stream.read(&mut byte).await? == 0 {
            break;
        }
        head.push(byte[0]);
    }
    Ok(String::from_utf8_lossy(&head).into_owned())
}

/// Status code of a CONNECT reply such as "HTTP/1.1 200 Connection established".
fn connect_status(head: &str) -> Option<u16> {
    head.lines().next()?.split_whitespace().nth(1)?.parse().ok()
}

async fn connect_direct(
    host: &str,
    port: u16,
    limit: Duration,
) -> NetResult<(TcpStream, SocketAddr)> {
    let target = format!("{host}:{port}");
    let addresses: Vec<SocketAddr> = match host.parse::<IpAddr>() {
        Ok(ip) => vec![SocketAddr::new(ip, port)],
        Err(_) => timeout(limit, tokio::net::lookup_host((host, port)))
            .await
            .map_err(|_| fail("timeout", format!("Looking up {host} took too long.")))?
            .map_err(|_| {
                fail(
                    "dns",
                    format!("The name {host} could not be found (DNS lookup failed)."),
                )
            })?
            .collect(),
    };
    let mut last = fail("dns", format!("The name {host} has no addresses."));
    for address in addresses {
        match timeout(limit, TcpStream::connect(address)).await {
            Ok(Ok(stream)) => return Ok((stream, address)),
            Ok(Err(error)) => last = classify_io(&error, &target),
            Err(_) => last = fail("timeout", format!("{target} did not answer in time.")),
        }
    }
    Err(last)
}

/// The system or environment proxy for a TLS connection to `host:port`, if any.
fn system_proxy(host: &str, port: u16) -> Option<hyper_util::client::proxy::matcher::Intercept> {
    let uri: http::Uri = format!("https://{host}:{port}/").parse().ok()?;
    hyper_util::client::proxy::matcher::Matcher::from_system().intercept(&uri)
}

async fn connect_via_proxy(
    host: &str,
    port: u16,
    limit: Duration,
    proxy: &hyper_util::client::proxy::matcher::Intercept,
) -> NetResult<(TcpStream, SocketAddr)> {
    let proxy_uri = proxy.uri();
    let proxy_host = proxy_uri
        .host()
        .ok_or_else(|| fail("proxy", "The proxy address has no host."))?
        .trim_matches(['[', ']'])
        .to_string();
    let proxy_port = proxy_uri
        .port_u16()
        .unwrap_or(if proxy_uri.scheme_str() == Some("https") {
            443
        } else {
            80
        });
    let (mut stream, address) = connect_direct(&proxy_host, proxy_port, limit)
        .await
        .map_err(|error| {
            fail(
                "proxy",
                format!("The proxy server is not reachable: {}", error.message),
            )
        })?;
    let authority = if host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    };
    let mut request = format!("CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n");
    if let Some(auth) = proxy.basic_auth().and_then(|value| value.to_str().ok()) {
        request.push_str(&format!("Proxy-Authorization: {auth}\r\n"));
    }
    request.push_str("\r\n");
    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|error| classify_io(&error, "The proxy"))?;
    let head = timeout(limit, read_head(&mut stream))
        .await
        .map_err(|_| fail("proxy", "The proxy did not answer in time."))?
        .map_err(|error| classify_io(&error, "The proxy"))?;
    match connect_status(&head) {
        Some(200..=299) => Ok((stream, address)),
        Some(code) => Err(fail(
            "proxy",
            format!("The proxy refused to connect to {authority} (HTTP {code})."),
        )),
        None => Err(fail("proxy", "The proxy sent an answer that is not HTTP.")),
    }
}

/// A TCP connection to `host:port`: direct, or through the system proxy when one is set and direct fails.
async fn open(
    host: &str,
    port: u16,
    limit: Duration,
) -> NetResult<(TcpStream, String, Option<String>)> {
    let proxy = system_proxy(host, port);
    match connect_direct(host, port, limit).await {
        Ok((stream, address)) => Ok((stream, address.to_string(), None)),
        Err(direct) => match proxy {
            Some(intercept) => {
                let (stream, _) = connect_via_proxy(host, port, limit, &intercept)
                    .await
                    .map_err(|error| {
                        fail(
                            error.kind,
                            format!("{} (Direct connection: {})", error.message, direct.message),
                        )
                    })?;
                Ok((
                    stream,
                    format!("{host}:{port}"),
                    Some(intercept.uri().to_string()),
                ))
            }
            None => Err(direct),
        },
    }
}

/* ------------------------------------------------------------------- TLS -- */

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TlsRequest {
    pub host: String,
    #[serde(default)]
    pub port: Option<u16>,
    /// Name sent in SNI and checked against the certificate (defaults to `host`).
    #[serde(default)]
    pub server_name: Option<String>,
    /// "1.2" or "1.3" to allow only that version; anything else allows both.
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TlsResponse {
    pub address: String,
    pub proxy: Option<String>,
    pub protocol: String,
    pub cipher: String,
    pub alpn: Option<String>,
    /// The certificates the server sent, leaf first (DER, Base64).
    pub chain: Vec<String>,
    /// Whether this computer trusts the chain for this name.
    pub trusted: bool,
    pub trust_error: Option<String>,
    pub ocsp_stapled: bool,
    pub elapsed_ms: f64,
}

/// Records what the server presents and what the platform verifier thinks of it,
/// then lets the handshake finish so that untrusted certificates can be inspected.
#[derive(Debug)]
struct Inspector {
    platform: Option<Arc<dyn ServerCertVerifier>>,
    provider: Arc<CryptoProvider>,
    chain: Mutex<Vec<Vec<u8>>>,
    verdict: Mutex<Option<Result<(), String>>>,
    stapled: AtomicBool,
}

impl ServerCertVerifier for Inspector {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let mut chain = vec![end_entity.as_ref().to_vec()];
        chain.extend(intermediates.iter().map(|cert| cert.as_ref().to_vec()));
        *self
            .chain
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = chain;
        self.stapled
            .store(!ocsp_response.is_empty(), Ordering::Relaxed);
        let verdict = match &self.platform {
            Some(platform) => platform
                .verify_server_cert(end_entity, intermediates, server_name, ocsp_response, now)
                .map(|_| ())
                .map_err(|error| error.to_string()),
            None => Err("this computer's certificate store could not be read".to_string()),
        };
        *self
            .verdict
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = Some(verdict);
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

/// Makes a TLS handshake and reports the protocol, cipher, certificate chain and whether it is trusted.
#[tauri::command]
pub async fn net_tls(request: TlsRequest) -> NetResult<TlsResponse> {
    let provider = provider();
    let host = request.host.trim().trim_matches(['[', ']']).to_string();
    if host.is_empty() {
        return Err(fail("invalid", "Enter a host name."));
    }
    let port = request.port.unwrap_or(443);
    let name_text = request
        .server_name
        .clone()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| host.clone());
    let server_name = ServerName::try_from(name_text.clone()).map_err(|_| {
        fail(
            "invalid",
            format!("{name_text} is not a valid server name."),
        )
    })?;
    let limit = clamp_timeout(request.timeout_ms, 15_000);

    let platform: Option<Arc<dyn ServerCertVerifier>> =
        rustls_platform_verifier::Verifier::new(provider.clone())
            .ok()
            .map(|verifier| Arc::new(verifier) as Arc<dyn ServerCertVerifier>);
    let inspector = Arc::new(Inspector {
        platform,
        provider: provider.clone(),
        chain: Mutex::new(Vec::new()),
        verdict: Mutex::new(None),
        stapled: AtomicBool::new(false),
    });
    let versions: &[&'static rustls::SupportedProtocolVersion] = match request.version.as_deref() {
        Some("1.2") => &[&rustls::version::TLS12],
        Some("1.3") => &[&rustls::version::TLS13],
        _ => rustls::DEFAULT_VERSIONS,
    };
    let mut config = rustls::ClientConfig::builder_with_provider(provider)
        .with_protocol_versions(versions)
        .map_err(|error| fail("invalid", error.to_string()))?
        .dangerous()
        .with_custom_certificate_verifier(inspector.clone())
        .with_no_client_auth();
    config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];

    let started = Instant::now();
    let (stream, address, proxy) = open(&host, port, limit).await?;
    let connector = tokio_rustls::TlsConnector::from(Arc::new(config));
    let tls = timeout(limit, connector.connect(server_name, stream))
        .await
        .map_err(|_| fail("timeout", format!("The TLS handshake with {host} took too long.")))?
        .map_err(|error| {
            let text = error.to_string();
            let lower = text.to_lowercase();
            if lower.contains("protocolversion") || lower.contains("protocol version") {
                fail("tls", format!("{host} does not offer TLS {} (the server ended the handshake).", request.version.clone().unwrap_or_else(|| "1.2 or 1.3".into())))
            } else if lower.contains("eof") || lower.contains("reset") {
                fail("tls", format!("{host}:{port} closed the connection during the TLS handshake. It may not speak TLS on this port."))
            } else {
                fail("tls", format!("The TLS handshake with {host} failed: {text}"))
            }
        })?;
    let (_, session) = tls.get_ref();
    let protocol = match session.protocol_version() {
        Some(rustls::ProtocolVersion::TLSv1_3) => "TLS 1.3".to_string(),
        Some(rustls::ProtocolVersion::TLSv1_2) => "TLS 1.2".to_string(),
        Some(other) => format!("{other:?}"),
        None => "unknown".to_string(),
    };
    let cipher = session
        .negotiated_cipher_suite()
        .map(|suite| format!("{:?}", suite.suite()))
        .unwrap_or_default();
    let alpn = session
        .alpn_protocol()
        .map(|proto| String::from_utf8_lossy(proto).into_owned());
    let chain: Vec<String> = inspector
        .chain
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .iter()
        .map(|der| B64.encode(der))
        .collect();
    let verdict = inspector
        .verdict
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .clone();
    let (trusted, trust_error) = match verdict {
        Some(Ok(())) => (true, None),
        Some(Err(reason)) => (false, Some(reason)),
        None => (false, Some("the server sent no certificate".to_string())),
    };
    Ok(TlsResponse {
        address,
        proxy,
        protocol,
        cipher,
        alpn,
        chain,
        trusted,
        trust_error,
        ocsp_stapled: inspector.stapled.load(Ordering::Relaxed),
        elapsed_ms: millis(started),
    })
}

/* ------------------------------------------------------------------- DNS -- */

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsRequest {
    pub name: String,
    pub record_type: String,
    /// "system", an IP address (optionally with :port) or an https:// DNS-over-HTTPS URL.
    pub server: String,
    /// "udp" (falls back to TCP when the answer is truncated) or "tcp".
    #[serde(default)]
    pub transport: Option<String>,
    /// Ask for DNSSEC records and validation status (the DO bit).
    #[serde(default)]
    pub dnssec: bool,
    /// Set the "recursion desired" flag (default true).
    #[serde(default)]
    pub recursion: Option<bool>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize, Default)]
pub struct DnsFlags {
    pub aa: bool,
    pub tc: bool,
    pub rd: bool,
    pub ra: bool,
    pub ad: bool,
    pub cd: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsRecord {
    pub name: String,
    pub record_type: String,
    pub class: String,
    pub ttl: u32,
    pub data: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsResponse {
    pub server: String,
    pub transport: String,
    /// The response code as a number (0 NOERROR, 2 SERVFAIL, 3 NXDOMAIN, 5 REFUSED …).
    pub rcode: u16,
    pub rcode_text: String,
    pub flags: DnsFlags,
    pub answers: Vec<DnsRecord>,
    pub authority: Vec<DnsRecord>,
    pub additional: Vec<DnsRecord>,
    pub size: usize,
    pub elapsed_ms: f64,
}

static QUERY_ID: AtomicU16 = AtomicU16::new(0);

fn next_id() -> u16 {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    (nanos as u16) ^ QUERY_ID.fetch_add(0x9e37, Ordering::Relaxed)
}

fn build_query(
    name: &str,
    record_type: RecordType,
    dnssec: bool,
    recursion: bool,
) -> NetResult<(u16, Vec<u8>)> {
    let fqdn = Name::from_utf8(name.trim()).map_err(|error| {
        fail(
            "invalid",
            format!("{name} is not a valid domain name ({error})."),
        )
    })?;
    let id = next_id();
    let mut message = Message::query();
    message.metadata.id = id;
    message.metadata.recursion_desired = recursion;
    message.add_query(Query::query(fqdn, record_type));
    let mut edns = Edns::new();
    edns.set_max_payload(1232);
    edns.set_dnssec_ok(dnssec);
    message.set_edns(edns);
    let bytes = message
        .to_vec()
        .map_err(|error| fail("invalid", error.to_string()))?;
    Ok((id, bytes))
}

/// TXT data as quoted character strings (`"v=spf1 …" "…"`), as dig prints it, so that
/// where a long record was split stays visible.  Everything else uses the presentation format.
fn record_data(data: &hickory_proto::rr::RData) -> String {
    match data {
        hickory_proto::rr::RData::TXT(txt) => txt
            .txt_data
            .iter()
            .map(|part| {
                let text = String::from_utf8_lossy(part);
                format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\""))
            })
            .collect::<Vec<_>>()
            .join(" "),
        other => other.to_string(),
    }
}

fn record(record: &Record) -> DnsRecord {
    DnsRecord {
        name: record.name.to_string(),
        record_type: record.record_type().to_string(),
        class: record.dns_class.to_string(),
        ttl: record.ttl,
        data: record_data(&record.data),
    }
}

fn to_response(
    message: Message,
    server: String,
    transport: &str,
    size: usize,
    started: Instant,
) -> DnsResponse {
    let meta = &message.metadata;
    let flags = DnsFlags {
        aa: meta.authoritative,
        tc: meta.truncation,
        rd: meta.recursion_desired,
        ra: meta.recursion_available,
        ad: meta.authentic_data,
        cd: meta.checking_disabled,
    };
    let section = |records: &[Record]| {
        records
            .iter()
            .filter(|r| r.record_type() != RecordType::OPT)
            .map(record)
            .collect::<Vec<_>>()
    };
    DnsResponse {
        server,
        transport: transport.to_string(),
        rcode: u16::from(message.metadata.response_code),
        rcode_text: message.metadata.response_code.to_str().to_string(),
        flags,
        answers: section(&message.answers),
        authority: section(&message.authorities),
        additional: section(&message.additionals),
        size,
        elapsed_ms: millis(started),
    }
}

fn parse_answer(bytes: &[u8], id: u16) -> NetResult<Message> {
    let message = Message::from_vec(bytes).map_err(|error| {
        fail(
            "dns",
            format!("The DNS answer could not be read ({error})."),
        )
    })?;
    if message.metadata.id != id {
        return Err(fail("dns", "The DNS answer did not match the question."));
    }
    Ok(message)
}

async fn query_udp(
    server: SocketAddr,
    query: &[u8],
    id: u16,
    limit: Duration,
) -> NetResult<(Message, usize)> {
    let bind: SocketAddr = if server.is_ipv4() {
        "0.0.0.0:0".parse().unwrap_or_else(|_| unreachable!())
    } else {
        "[::]:0".parse().unwrap_or_else(|_| unreachable!())
    };
    let socket = UdpSocket::bind(bind)
        .await
        .map_err(|error| classify_io(&error, "The local network"))?;
    socket
        .connect(server)
        .await
        .map_err(|error| classify_io(&error, &server.to_string()))?;
    let deadline = Instant::now() + limit;
    let mut buffer = vec![0u8; 65_535];
    // Resend once halfway through, as resolvers do, in case the first packet was lost.
    for attempt in 0..2 {
        socket
            .send(query)
            .await
            .map_err(|error| classify_io(&error, &server.to_string()))?;
        let wait = if attempt == 0 {
            limit / 2
        } else {
            deadline.saturating_duration_since(Instant::now())
        };
        loop {
            match timeout(wait, socket.recv(&mut buffer)).await {
                Ok(Ok(length)) => match parse_answer(&buffer[..length], id) {
                    Ok(message) => return Ok((message, length)),
                    Err(_) => continue,
                },
                Ok(Err(error)) => return Err(classify_io(&error, &server.to_string())),
                Err(_) => break,
            }
        }
    }
    Err(fail("timeout", format!("The DNS server {server} did not answer. It may be unreachable from this network (UDP port 53 blocked).")))
}

async fn query_tcp(
    server: SocketAddr,
    query: &[u8],
    id: u16,
    limit: Duration,
) -> NetResult<(Message, usize)> {
    let target = server.to_string();
    let mut stream = timeout(limit, TcpStream::connect(server))
        .await
        .map_err(|_| {
            fail(
                "timeout",
                format!("The DNS server {target} did not answer over TCP."),
            )
        })?
        .map_err(|error| classify_io(&error, &target))?;
    let mut framed = (query.len() as u16).to_be_bytes().to_vec();
    framed.extend_from_slice(query);
    let exchange = async {
        stream.write_all(&framed).await?;
        let mut length = [0u8; 2];
        stream.read_exact(&mut length).await?;
        let mut body = vec![0u8; u16::from_be_bytes(length) as usize];
        stream.read_exact(&mut body).await?;
        Ok::<Vec<u8>, std::io::Error>(body)
    };
    let body = timeout(limit, exchange)
        .await
        .map_err(|_| {
            fail(
                "timeout",
                format!("The DNS server {target} did not answer over TCP."),
            )
        })?
        .map_err(|error| classify_io(&error, &target))?;
    let message = parse_answer(&body, id)?;
    Ok((message, body.len()))
}

async fn query_doh(
    url: &str,
    query: &[u8],
    id: u16,
    limit: Duration,
) -> NetResult<(Message, usize)> {
    let _ = provider();
    let parsed = reqwest::Url::parse(url).map_err(|_| {
        fail(
            "invalid",
            format!("{url} is not a valid DNS-over-HTTPS address."),
        )
    })?;
    let client = reqwest::Client::builder()
        .timeout(limit)
        .build()
        .map_err(|error| fail("invalid", chain_message(&error)))?;
    let response = client
        .post(parsed.clone())
        .header("content-type", "application/dns-message")
        .header("accept", "application/dns-message")
        .body(query.to_vec())
        .send()
        .await
        .map_err(|error| classify_reqwest(&error, &parsed))?;
    if !response.status().is_success() {
        return Err(fail(
            "dns",
            format!(
                "The DNS-over-HTTPS server answered HTTP {}.",
                response.status().as_u16()
            ),
        ));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| classify_reqwest(&error, &parsed))?;
    let message = parse_answer(&bytes, id)?;
    Ok((message, bytes.len()))
}

/// The first name server this computer is configured to use.
fn system_server() -> NetResult<SocketAddr> {
    let (config, _) = hickory_resolver::system_conf::read_system_conf().map_err(|error| {
        fail(
            "dns",
            format!("This computer's DNS settings could not be read ({error})."),
        )
    })?;
    config
        .name_servers
        .first()
        .map(|server| SocketAddr::new(server.ip, 53))
        .ok_or_else(|| fail("dns", "This computer has no DNS server configured."))
}

fn server_address(text: &str) -> NetResult<SocketAddr> {
    let trimmed = text.trim();
    if let Ok(address) = trimmed.parse::<SocketAddr>() {
        return Ok(address);
    }
    trimmed
        .trim_matches(['[', ']'])
        .parse::<IpAddr>()
        .map(|ip| SocketAddr::new(ip, 53))
        .map_err(|_| {
            fail(
                "invalid",
                format!(
                    "{trimmed} is not a DNS server address. Use an IP address such as 1.1.1.1."
                ),
            )
        })
}

/// One DNS question to one server, returning every section of the answer.
#[tauri::command]
pub async fn net_dns(request: DnsRequest) -> NetResult<DnsResponse> {
    let record_type: RecordType =
        request
            .record_type
            .trim()
            .to_uppercase()
            .parse()
            .map_err(|_| {
                fail(
                    "invalid",
                    format!("{} is not a DNS record type.", request.record_type),
                )
            })?;
    let (id, query) = build_query(
        &request.name,
        record_type,
        request.dnssec,
        request.recursion.unwrap_or(true),
    )?;
    let limit = clamp_timeout(request.timeout_ms, 5_000);
    let started = Instant::now();
    let server_text = request.server.trim();
    if server_text.starts_with("https://") {
        let (message, size) = query_doh(server_text, &query, id, limit).await?;
        return Ok(to_response(
            message,
            server_text.to_string(),
            "https",
            size,
            started,
        ));
    }
    let address = if server_text.is_empty() || server_text.eq_ignore_ascii_case("system") {
        system_server()?
    } else {
        server_address(server_text)?
    };
    if request.transport.as_deref() == Some("tcp") {
        let (message, size) = query_tcp(address, &query, id, limit).await?;
        return Ok(to_response(
            message,
            address.to_string(),
            "tcp",
            size,
            started,
        ));
    }
    let (message, size) = query_udp(address, &query, id, limit).await?;
    if message.metadata.truncation {
        // The full answer did not fit in a UDP packet: ask again over TCP.
        if let Ok((full, full_size)) = query_tcp(address, &query, id, limit).await {
            return Ok(to_response(
                full,
                address.to_string(),
                "tcp",
                full_size,
                started,
            ));
        }
    }
    Ok(to_response(
        message,
        address.to_string(),
        "udp",
        size,
        started,
    ))
}

/* ----------------------------------------------------------------- WHOIS -- */

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhoisRequest {
    pub server: String,
    pub query: String,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhoisResponse {
    pub server: String,
    pub text: String,
    pub truncated: bool,
    pub elapsed_ms: f64,
}

/// WHOIS text is usually UTF-8; older servers send Latin-1, which maps byte for byte.
fn decode_text(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => bytes.iter().map(|&b| b as char).collect(),
    }
}

/// Sends one query to a WHOIS server (RFC 3912) and returns its answer as text.
#[tauri::command]
pub async fn net_whois(request: WhoisRequest) -> NetResult<WhoisResponse> {
    let server = request.server.trim().to_lowercase();
    let query = request.query.trim();
    if server.is_empty()
        || server.contains(['/', ' '])
        || query.is_empty()
        || query.contains(['\r', '\n'])
    {
        return Err(fail(
            "invalid",
            "Enter a WHOIS server and a single-line query.",
        ));
    }
    let limit = clamp_timeout(request.timeout_ms, 15_000);
    let started = Instant::now();
    let (mut stream, _, _) = open(&server, request.port.unwrap_or(43), limit).await?;
    let exchange = async {
        stream.write_all(format!("{query}\r\n").as_bytes()).await?;
        let mut answer = Vec::new();
        let mut chunk = [0u8; 8192];
        loop {
            let read = stream.read(&mut chunk).await?;
            if read == 0 || answer.len() >= MAX_WHOIS {
                break;
            }
            answer.extend_from_slice(&chunk[..read]);
        }
        Ok::<Vec<u8>, std::io::Error>(answer)
    };
    let answer = timeout(limit, exchange)
        .await
        .map_err(|_| {
            fail(
                "timeout",
                format!("The WHOIS server {server} did not finish answering in time."),
            )
        })?
        .map_err(|error| classify_io(&error, &server))?;
    let truncated = answer.len() >= MAX_WHOIS;
    Ok(WhoisResponse {
        server,
        text: decode_text(&answer[..answer.len().min(MAX_WHOIS)]),
        truncated,
        elapsed_ms: millis(started),
    })
}

/* ------------------------------------------------------------- TCP ports -- */

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeRequest {
    pub host: String,
    pub ports: Vec<u16>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub port: u16,
    /// "open", "closed" (refused), "filtered" (no answer) or "error".
    pub state: &'static str,
    pub elapsed_ms: f64,
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResponse {
    pub address: String,
    pub results: Vec<ProbeResult>,
}

/// Tries to open a TCP connection to each port (and closes it at once).
#[tauri::command]
pub async fn net_tcp_probe(request: ProbeRequest) -> NetResult<ProbeResponse> {
    let host = request.host.trim().trim_matches(['[', ']']).to_string();
    if host.is_empty() {
        return Err(fail("invalid", "Enter a host name or IP address."));
    }
    if request.ports.is_empty() || request.ports.len() > MAX_PORTS {
        return Err(fail(
            "invalid",
            format!("Choose between 1 and {MAX_PORTS} ports."),
        ));
    }
    let limit = clamp_timeout(request.timeout_ms, 3_000);
    let ip = match host.parse::<IpAddr>() {
        Ok(ip) => ip,
        Err(_) => {
            let mut addresses = timeout(limit, tokio::net::lookup_host((host.as_str(), 0)))
                .await
                .map_err(|_| fail("timeout", format!("Looking up {host} took too long.")))?
                .map_err(|_| {
                    fail(
                        "dns",
                        format!("The name {host} could not be found (DNS lookup failed)."),
                    )
                })?;
            addresses
                .next()
                .map(|address| address.ip())
                .ok_or_else(|| fail("dns", format!("The name {host} has no addresses.")))?
        }
    };
    let gate = Arc::new(tokio::sync::Semaphore::new(64));
    let mut tasks = tokio::task::JoinSet::new();
    for port in request.ports {
        let gate = gate.clone();
        tasks.spawn(async move {
            let _permit = gate.acquire_owned().await;
            let started = Instant::now();
            let (state, message) =
                match timeout(limit, TcpStream::connect(SocketAddr::new(ip, port))).await {
                    Ok(Ok(_)) => ("open", None),
                    Ok(Err(error)) if error.kind() == std::io::ErrorKind::ConnectionRefused => {
                        ("closed", None)
                    }
                    Ok(Err(error)) => ("error", Some(error.to_string())),
                    Err(_) => ("filtered", None),
                };
            ProbeResult {
                port,
                state,
                elapsed_ms: millis(started),
                message,
            }
        });
    }
    let mut results = Vec::new();
    while let Some(done) = tasks.join_next().await {
        if let Ok(result) = done {
            results.push(result);
        }
    }
    results.sort_by_key(|result| result.port);
    Ok(ProbeResponse {
        address: ip.to_string(),
        results,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    #[test]
    fn reads_connect_status_lines() {
        assert_eq!(
            connect_status("HTTP/1.1 200 Connection established\r\n\r\n"),
            Some(200)
        );
        assert_eq!(
            connect_status("HTTP/1.0 407 Proxy Authentication Required\r\n"),
            Some(407)
        );
        assert_eq!(connect_status("garbage"), None);
    }

    #[test]
    fn decodes_latin1_whois_text() {
        assert_eq!(decode_text("Zürich".as_bytes()), "Zürich");
        assert_eq!(decode_text(&[0x5a, 0xfc, 0x72]), "Zür");
    }

    #[test]
    fn parses_server_addresses() {
        assert_eq!(
            server_address("1.1.1.1").map(|a| a.to_string()),
            Ok("1.1.1.1:53".to_string())
        );
        assert_eq!(
            server_address("[2606:4700:4700::1111]").map(|a| a.to_string()),
            Ok("[2606:4700:4700::1111]:53".to_string())
        );
        assert_eq!(
            server_address("127.0.0.1:5353").map(|a| a.to_string()),
            Ok("127.0.0.1:5353".to_string())
        );
        assert!(server_address("not a server").is_err());
    }

    #[tokio::test]
    async fn whois_reads_the_whole_answer() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.expect("accept");
            let mut line = [0u8; 64];
            let read = socket.read(&mut line).await.expect("read");
            assert_eq!(&line[..read], b"example.org\r\n");
            socket
                .write_all(
                    b"Domain Name: EXAMPLE.ORG\r\nRegistry Expiry Date: 2030-01-01T00:00:00Z\r\n",
                )
                .await
                .expect("write");
        });
        let answer = net_whois(WhoisRequest {
            server: "127.0.0.1".into(),
            query: "example.org".into(),
            port: Some(port),
            timeout_ms: Some(3_000),
        })
        .await
        .expect("whois");
        assert!(answer.text.contains("Registry Expiry Date: 2030-01-01"));
    }

    #[tokio::test]
    async fn dns_queries_a_server_over_udp() {
        let server = UdpSocket::bind("127.0.0.1:0").await.expect("bind");
        let address = server.local_addr().expect("addr");
        tokio::spawn(async move {
            let mut buffer = [0u8; 512];
            let (length, peer) = server.recv_from(&mut buffer).await.expect("recv");
            let question = Message::from_vec(&buffer[..length]).expect("query");
            let mut answer = Message::response(question.metadata.id, question.metadata.op_code);
            answer.metadata.recursion_available = true;
            answer.queries = question.queries.clone();
            let name = question.queries[0].name().clone();
            answer.answers.push(Record::from_rdata(
                name,
                300,
                hickory_proto::rr::RData::A(hickory_proto::rr::rdata::A::new(93, 184, 215, 14)),
            ));
            server
                .send_to(&answer.to_vec().expect("encode"), peer)
                .await
                .expect("send");
        });
        let response = net_dns(DnsRequest {
            name: "example.org".into(),
            record_type: "A".into(),
            server: address.to_string(),
            transport: None,
            dnssec: false,
            recursion: None,
            timeout_ms: Some(3_000),
        })
        .await
        .expect("dns");
        assert_eq!(response.rcode, 0);
        assert_eq!(response.answers.len(), 1);
        assert_eq!(response.answers[0].data, "93.184.215.14");
        assert_eq!(response.answers[0].ttl, 300);
        assert!(response.flags.ra);
    }

    #[tokio::test]
    async fn probes_open_and_closed_ports() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let open_port = listener.local_addr().expect("addr").port();
        let closed = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let closed_port = closed.local_addr().expect("addr").port();
        drop(closed);
        let response = net_tcp_probe(ProbeRequest {
            host: "127.0.0.1".into(),
            ports: vec![open_port, closed_port],
            timeout_ms: Some(2_000),
        })
        .await
        .expect("probe");
        let state = |port: u16| {
            response
                .results
                .iter()
                .find(|r| r.port == port)
                .map(|r| r.state)
        };
        assert_eq!(state(open_port), Some("open"));
        assert_eq!(state(closed_port), Some("closed"));
    }

    #[tokio::test]
    async fn http_reports_status_headers_and_raw_body() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.expect("accept");
            let mut request = [0u8; 2048];
            let _ = socket.read(&mut request).await;
            socket.write_all(b"HTTP/1.1 301 Moved Permanently\r\nLocation: https://example.org/\r\nContent-Length: 5\r\nX-Test: yes\r\n\r\nmoved").await.expect("write");
        });
        let response = net_http(HttpRequest {
            url: format!("http://127.0.0.1:{port}/old"),
            method: None,
            headers: vec![],
            body: None,
            timeout_ms: Some(5_000),
            max_body: None,
            insecure: false,
        })
        .await
        .expect("http");
        assert_eq!(response.status, 301);
        assert!(response
            .headers
            .iter()
            .any(|(name, value)| name == "location" && value == "https://example.org/"));
        assert_eq!(B64.decode(response.body).expect("base64"), b"moved");
        assert_eq!(response.version, "HTTP/1.1");
    }

    #[tokio::test]
    async fn tls_reports_an_untrusted_self_signed_chain() {
        let _ = provider();
        let cert = rcgen::generate_simple_self_signed(vec!["localhost".to_string()]).expect("cert");
        let cert_der = CertificateDer::from(cert.cert.der().to_vec());
        let key = rustls::pki_types::PrivateKeyDer::try_from(cert.signing_key.serialize_der())
            .expect("key");
        let server_config = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(vec![cert_der.clone()], key)
            .expect("server config");
        let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(server_config));
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        tokio::spawn(async move {
            let (socket, _) = listener.accept().await.expect("accept");
            let _ = acceptor.accept(socket).await;
        });
        let response = net_tls(TlsRequest {
            host: "127.0.0.1".into(),
            port: Some(port),
            server_name: Some("localhost".into()),
            version: None,
            timeout_ms: Some(5_000),
        })
        .await
        .expect("tls");
        assert_eq!(response.chain.len(), 1);
        assert_eq!(
            B64.decode(&response.chain[0]).expect("base64"),
            cert_der.as_ref()
        );
        assert!(!response.trusted);
        assert!(response.protocol.starts_with("TLS 1."));
    }
}
