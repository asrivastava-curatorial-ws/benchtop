//! WebSocket client for the WebSocket tool: connect (ws:// or wss://, with
//! headers and subprotocols), send text or binary messages, and receive every
//! message, ping and close as events.  The web view cannot open WebSockets to
//! other hosts itself (its content security policy forbids it), so they run here.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use futures_util::{SinkExt, StreamExt};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::Connector;

#[derive(Default)]
pub struct WsState {
    open: Mutex<HashMap<String, mpsc::UnboundedSender<Message>>>,
    streams: Mutex<HashMap<String, tokio::task::AbortHandle>>,
}

/// Accepts any certificate: only for test servers, when the person ticks the box.
#[derive(Debug)]
pub(crate) struct AnyCertificate(pub Arc<rustls::crypto::CryptoProvider>);

impl ServerCertVerifier for AnyCertificate {
    fn verify_server_cert(
        &self,
        _: &CertificateDer<'_>,
        _: &[CertificateDer<'_>],
        _: &ServerName<'_>,
        _: &[u8],
        _: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
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
            &self.0.signature_verification_algorithms,
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
            &self.0.signature_verification_algorithms,
        )
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

/// A TLS client configuration that checks certificates with the system's trust
/// store (or, when `insecure`, accepts any certificate).
pub(crate) fn client_tls(
    alpn: &[&[u8]],
    insecure: bool,
) -> Result<Arc<rustls::ClientConfig>, String> {
    crate::net::ensure_crypto_provider();
    let provider = rustls::crypto::CryptoProvider::get_default()
        .cloned()
        .unwrap_or_else(|| Arc::new(rustls::crypto::ring::default_provider()));
    let builder = rustls::ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?;
    let mut config = if insecure {
        builder
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(AnyCertificate(provider)))
            .with_no_client_auth()
    } else {
        let verifier = rustls_platform_verifier::Verifier::new(provider)
            .map_err(|e| format!("The system's certificate store could not be read: {e}"))?;
        builder
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(verifier))
            .with_no_client_auth()
    };
    config.alpn_protocols = alpn.iter().map(|p| p.to_vec()).collect();
    Ok(Arc::new(config))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connected {
    pub status: u16,
    pub protocol: Option<String>,
    pub headers: Vec<(String, String)>,
}

#[tauri::command]
pub async fn ws_connect(
    app: AppHandle,
    id: String,
    url: String,
    headers: Vec<(String, String)>,
    protocols: Vec<String>,
    insecure: bool,
    state: State<'_, WsState>,
) -> Result<Connected, String> {
    let address = url.trim();
    if !(address.starts_with("ws://") || address.starts_with("wss://")) {
        return Err("WebSocket addresses start with ws:// or wss://.".into());
    }
    let mut request = address
        .into_client_request()
        .map_err(|e| format!("That address cannot be used: {e}"))?;
    for (name, value) in headers.iter().filter(|(n, _)| !n.trim().is_empty()) {
        let header =
            tokio_tungstenite::tungstenite::http::HeaderName::from_bytes(name.trim().as_bytes())
                .map_err(|_| format!("“{name}” is not a valid header name."))?;
        let value = HeaderValue::from_str(value)
            .map_err(|_| format!("The value of {name} is not valid."))?;
        request.headers_mut().insert(header, value);
    }
    if !protocols.is_empty() {
        request.headers_mut().insert(
            "Sec-WebSocket-Protocol",
            HeaderValue::from_str(&protocols.join(", ")).map_err(|e| e.to_string())?,
        );
    }
    let connector = Connector::Rustls(client_tls(&[b"http/1.1"], insecure)?);
    let (stream, response) = tokio::time::timeout(
        std::time::Duration::from_secs(20),
        tokio_tungstenite::connect_async_tls_with_config(request, None, false, Some(connector)),
    )
    .await
    .map_err(|_| "The server did not answer within 20 seconds.".to_string())?
    .map_err(|e| match e {
        tokio_tungstenite::tungstenite::Error::Http(r) => {
            format!("The server refused the WebSocket (HTTP {}).", r.status())
        }
        other => format!("Could not connect: {other}"),
    })?;
    let connected = Connected {
        status: response.status().as_u16(),
        protocol: response
            .headers()
            .get("sec-websocket-protocol")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string),
        headers: response
            .headers()
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or_default().to_string()))
            .collect(),
    };
    let (mut sink, mut source) = stream.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    if let Some(old) = state
        .open
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.clone(), tx)
    {
        let _ = old.send(Message::Close(None));
    }
    let writer_app = app.clone();
    let writer_id = id.clone();
    tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            let closing = matches!(message, Message::Close(_));
            if let Err(e) = sink.send(message).await {
                let _ = writer_app.emit("ws-event", json!({ "id": writer_id, "kind": "error", "data": e.to_string(), "at": now_ms() }));
                break;
            }
            if closing {
                break;
            }
        }
    });
    tokio::spawn(async move {
        while let Some(frame) = source.next().await {
            let event = match frame {
                Ok(Message::Text(text)) => json!({ "kind": "text", "data": text.as_str() }),
                Ok(Message::Binary(bytes)) => {
                    json!({ "kind": "binary", "data": base64::engine::general_purpose::STANDARD.encode(&bytes), "size": bytes.len() })
                }
                Ok(Message::Ping(_)) => json!({ "kind": "ping", "data": "" }),
                Ok(Message::Pong(_)) => json!({ "kind": "pong", "data": "" }),
                Ok(Message::Close(frame)) => {
                    json!({ "kind": "close", "data": frame.map(|f| format!("{} {}", u16::from(f.code), f.reason)).unwrap_or_default() })
                }
                Ok(Message::Frame(_)) => continue,
                Err(e) => json!({ "kind": "error", "data": e.to_string() }),
            };
            let done = matches!(event["kind"].as_str(), Some("close" | "error"));
            let mut event = event;
            event["id"] = json!(id);
            event["at"] = json!(now_ms());
            let _ = app.emit("ws-event", event);
            if done {
                break;
            }
        }
        if let Some(state) = tauri::Manager::try_state::<WsState>(&app) {
            if let Ok(mut open) = state.open.lock() {
                open.remove(&id);
            }
        }
        let _ = app.emit(
            "ws-event",
            json!({ "id": id, "kind": "ended", "data": "", "at": now_ms() }),
        );
    });
    Ok(connected)
}

#[tauri::command]
pub fn ws_send(
    id: String,
    text: Option<String>,
    binary: Option<String>,
    state: State<'_, WsState>,
) -> Result<(), String> {
    let open = state.open.lock().map_err(|e| e.to_string())?;
    let tx = open.get(&id).ok_or("The connection is closed.")?;
    let message = match (text, binary) {
        (_, Some(b64)) => Message::Binary(
            base64::engine::general_purpose::STANDARD
                .decode(b64.trim())
                .map_err(|_| "The binary message is not valid Base64.")?
                .into(),
        ),
        (Some(text), None) => Message::Text(text.into()),
        (None, None) => Message::Ping(Vec::new().into()),
    };
    tx.send(message)
        .map_err(|_| "The connection is closed.".to_string())
}

#[tauri::command]
pub fn ws_close(
    id: String,
    code: Option<u16>,
    reason: Option<String>,
    state: State<'_, WsState>,
) -> Result<(), String> {
    if let Some(tx) = state.open.lock().map_err(|e| e.to_string())?.remove(&id) {
        let frame = CloseFrame {
            code: CloseCode::from(code.unwrap_or(1000)),
            reason: reason.unwrap_or_default().into(),
        };
        let _ = tx.send(Message::Close(Some(frame)));
    }
    Ok(())
}

/* ---------------------------------------------------- server-sent events -- */

/// One event from a text/event-stream, as the EventSource specification reads it.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct SseEvent {
    pub event: String,
    pub data: String,
    pub id: String,
}

/// Feeds text into an event-stream reader; returns the events completed so far.
pub fn sse_feed(buffer: &mut String, text: &str) -> Vec<SseEvent> {
    buffer.push_str(&text.replace("\r\n", "\n").replace('\r', "\n"));
    let mut events = Vec::new();
    while let Some(end) = buffer.find("\n\n") {
        let block: String = buffer.drain(..end + 2).collect();
        let mut event = SseEvent::default();
        let mut data: Vec<&str> = Vec::new();
        for line in block.lines() {
            if line.starts_with(':') || line.is_empty() {
                continue;
            }
            let (field, value) = line
                .split_once(':')
                .map(|(f, v)| (f, v.strip_prefix(' ').unwrap_or(v)))
                .unwrap_or((line, ""));
            match field {
                "event" => event.event = value.to_string(),
                "data" => data.push(value),
                "id" => event.id = value.to_string(),
                _ => {}
            }
        }
        if !data.is_empty() {
            event.data = data.join("\n");
            if event.event.is_empty() {
                event.event = "message".into();
            }
            events.push(event);
        }
    }
    events
}

#[tauri::command]
pub async fn sse_connect(
    app: AppHandle,
    id: String,
    url: String,
    headers: Vec<(String, String)>,
    state: State<'_, WsState>,
) -> Result<u16, String> {
    let address = crate::webpdf::check_url(&url)?;
    crate::net::ensure_crypto_provider();
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client
        .get(address)
        .header("accept", "text/event-stream")
        .header("cache-control", "no-cache");
    for (name, value) in headers.iter().filter(|(n, _)| !n.trim().is_empty()) {
        request = request.header(name.trim(), value.as_str());
    }
    let mut response = request
        .send()
        .await
        .map_err(|e| format!("Could not connect: {}", crate::net::chain_message(&e)))?;
    let status = response.status().as_u16();
    if !response.status().is_success() {
        return Err(format!("The server answered HTTP {status}."));
    }
    let task_id = id.clone();
    let task = tokio::spawn(async move {
        let mut buffer = String::new();
        let mut pending = Vec::new();
        loop {
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    pending.extend_from_slice(&chunk);
                    // Keep incomplete UTF-8 sequences for the next chunk.
                    let valid = match std::str::from_utf8(&pending) {
                        Ok(_) => pending.len(),
                        Err(e) => e.valid_up_to(),
                    };
                    let text = String::from_utf8_lossy(&pending[..valid]).into_owned();
                    pending.drain(..valid);
                    for e in sse_feed(&mut buffer, &text) {
                        let _ = app.emit("ws-event", json!({ "id": task_id, "kind": "sse", "event": e.event, "data": e.data, "eventId": e.id, "at": now_ms() }));
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    let _ = app.emit("ws-event", json!({ "id": task_id, "kind": "error", "data": crate::net::chain_message(&e), "at": now_ms() }));
                    break;
                }
            }
        }
        let _ = app.emit(
            "ws-event",
            json!({ "id": task_id, "kind": "ended", "data": "", "at": now_ms() }),
        );
    });
    if let Some(old) = state
        .streams
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, task.abort_handle())
    {
        old.abort();
    }
    Ok(status)
}

#[tauri::command]
pub fn sse_close(id: String, state: State<'_, WsState>) -> Result<(), String> {
    if let Some(task) = state.streams.lock().map_err(|e| e.to_string())?.remove(&id) {
        task.abort();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_event_streams_across_chunks() {
        let mut buffer = String::new();
        assert!(sse_feed(&mut buffer, ": comment\ndata: hel").is_empty());
        let events = sse_feed(
            &mut buffer,
            "lo\ndata: world\n\nevent: tick\nid: 7\ndata: 1\r\n\r\n",
        );
        assert_eq!(
            events,
            vec![
                SseEvent {
                    event: "message".into(),
                    data: "hello\nworld".into(),
                    id: String::new()
                },
                SseEvent {
                    event: "tick".into(),
                    data: "1".into(),
                    id: "7".into()
                }
            ]
        );
        assert!(buffer.is_empty());
    }
}
