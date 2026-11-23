//! gRPC client: services come from .proto files (compiled in memory with
//! protox) or from the server itself (gRPC server reflection); requests are
//! written as JSON and sent over HTTP/2, with or without TLS.  Unary,
//! server-streaming and client-streaming calls are supported (a JSON array
//! sends several messages).

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use bytes::{Buf, BufMut, Bytes, BytesMut};
use http_body_util::{BodyExt, Full};
use hyper::Request;
use hyper_util::rt::{TokioExecutor, TokioIo};
use prost::Message as _;
use prost_reflect::{
    DescriptorPool, DeserializeOptions, DynamicMessage, MessageDescriptor, SerializeOptions,
};
use protox::file::{ChainFileResolver, File, FileResolver, GoogleFileResolver};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

#[derive(Default)]
pub struct GrpcState {
    pools: Mutex<HashMap<String, DescriptorPool>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProtoFile {
    pub name: String,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MethodInfo {
    pub name: String,
    pub input: String,
    pub output: String,
    pub client_streaming: bool,
    pub server_streaming: bool,
    /// An example request with every field at its default value.
    pub template: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInfo {
    pub name: String,
    pub methods: Vec<MethodInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Described {
    /// Key for later calls.
    pub pool: String,
    pub services: Vec<ServiceInfo>,
}

struct Sources(HashMap<String, String>);

impl FileResolver for Sources {
    fn open_file(&self, name: &str) -> Result<File, protox::Error> {
        match self.0.get(name) {
            Some(text) => File::from_source(name, text),
            None => Err(protox::Error::file_not_found(name)),
        }
    }
}

fn template_for(message: &MessageDescriptor) -> String {
    let empty = DynamicMessage::new(message.clone());
    let options = SerializeOptions::new()
        .skip_default_fields(false)
        .stringify_64_bit_integers(false);
    let mut out = Vec::new();
    let mut serializer = serde_json::Serializer::pretty(&mut out);
    if empty
        .serialize_with_options(&mut serializer, &options)
        .is_err()
    {
        return "{}".into();
    }
    String::from_utf8(out).unwrap_or_else(|_| "{}".into())
}

fn describe(pool: &DescriptorPool) -> Vec<ServiceInfo> {
    let mut services: Vec<ServiceInfo> = pool
        .services()
        .filter(|s| {
            !s.full_name().starts_with("grpc.reflection.")
                && !s.full_name().starts_with("grpc.health.")
        })
        .map(|s| ServiceInfo {
            name: s.full_name().to_string(),
            methods: s
                .methods()
                .map(|m| MethodInfo {
                    name: m.name().to_string(),
                    input: m.input().full_name().to_string(),
                    output: m.output().full_name().to_string(),
                    client_streaming: m.is_client_streaming(),
                    server_streaming: m.is_server_streaming(),
                    template: template_for(&m.input()),
                })
                .collect(),
        })
        .collect();
    services.sort_by(|a, b| a.name.cmp(&b.name));
    services
}

/// Compiles .proto files given as text (imports among them, and Google's well-known types, resolve).
pub fn compile(files: &[ProtoFile]) -> Result<DescriptorPool, String> {
    let sources: HashMap<String, String> = files
        .iter()
        .map(|f| (f.name.replace('\\', "/"), f.text.clone()))
        .collect();
    let mut chain = ChainFileResolver::new();
    chain.add(Sources(sources.clone()));
    chain.add(GoogleFileResolver::new());
    let mut compiler = protox::Compiler::with_file_resolver(chain);
    compiler.include_imports(true);
    let names: Vec<String> = sources.keys().cloned().collect();
    compiler
        .open_files(names)
        .map_err(|e| format!("The .proto files could not be read: {e}"))?;
    Ok(compiler.descriptor_pool())
}

#[tauri::command]
pub fn grpc_compile(
    files: Vec<ProtoFile>,
    state: State<'_, GrpcState>,
) -> Result<Described, String> {
    let pool = compile(&files)?;
    let key = format!(
        "proto:{}",
        blake3::hash(
            files
                .iter()
                .map(|f| format!("{}\n{}", f.name, f.text))
                .collect::<String>()
                .as_bytes()
        )
        .to_hex()
    );
    let services = describe(&pool);
    if services.is_empty() {
        return Err("The .proto files define no services.".into());
    }
    state
        .pools
        .lock()
        .map_err(|e| e.to_string())?
        .insert(key.clone(), pool);
    Ok(Described {
        pool: key,
        services,
    })
}

/* -------------------------------------------------------------- calls -- */

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    /// host:port, or an http:// or https:// address.
    pub address: String,
    #[serde(default)]
    pub tls: bool,
    #[serde(default)]
    pub insecure: bool,
    #[serde(default)]
    pub metadata: Vec<(String, String)>,
    #[serde(default = "default_deadline")]
    pub deadline_ms: u64,
}

fn default_deadline() -> u64 {
    30_000
}

#[derive(Debug, Default)]
struct RawReply {
    status: u16,
    headers: Vec<(String, String)>,
    trailers: Vec<(String, String)>,
    messages: Vec<Bytes>,
}

fn parse_target(t: &Target) -> Result<(String, u16, bool), String> {
    let text = t.address.trim();
    let (tls, rest) = if let Some(r) = text.strip_prefix("https://") {
        (true, r)
    } else if let Some(r) = text.strip_prefix("http://") {
        (false, r)
    } else {
        (t.tls, text)
    };
    let host_port = rest.split('/').next().unwrap_or_default();
    let (host, port) = match host_port.rsplit_once(':') {
        Some((h, p)) if !h.ends_with(']') || h.starts_with('[') => (
            h.trim_matches(['[', ']']).to_string(),
            p.parse::<u16>()
                .map_err(|_| format!("“{p}” is not a port number."))?,
        ),
        _ => (
            host_port.trim_matches(['[', ']']).to_string(),
            if tls { 443 } else { 80 },
        ),
    };
    if host.is_empty() {
        return Err("Enter the server as host:port, such as localhost:50051.".into());
    }
    Ok((host, port, tls))
}

/// One HTTP/2 POST carrying length-prefixed messages; returns the reply's messages and trailers.
async fn call_raw(target: &Target, path: &str, messages: Vec<Vec<u8>>) -> Result<RawReply, String> {
    let (host, port, tls) = parse_target(target)?;
    let deadline = Duration::from_millis(target.deadline_ms.clamp(500, 600_000));
    let work = async {
        let tcp = tokio::net::TcpStream::connect((host.as_str(), port))
            .await
            .map_err(|e| format!("Could not connect to {host}:{port}: {e}"))?;
        let _ = tcp.set_nodelay(true);
        let mut body = BytesMut::new();
        for m in &messages {
            body.put_u8(0);
            body.put_u32(m.len() as u32);
            body.put_slice(m);
        }
        let mut builder = Request::builder()
            .method("POST")
            .uri(format!(
                "{}://{host}:{port}{path}",
                if tls { "https" } else { "http" }
            ))
            .header("content-type", "application/grpc")
            .header("te", "trailers")
            .header("grpc-timeout", format!("{}m", deadline.as_millis()))
            .header(
                "user-agent",
                concat!("benchtop-grpc/", env!("CARGO_PKG_VERSION")),
            );
        for (k, v) in target.metadata.iter().filter(|(k, _)| !k.trim().is_empty()) {
            builder = builder.header(k.trim().to_ascii_lowercase(), v.as_str());
        }
        let request = builder
            .body(Full::new(body.freeze()))
            .map_err(|e| e.to_string())?;
        let response = if tls {
            let config = crate::wsclient::client_tls(&[b"h2"], target.insecure)?;
            let name = rustls::pki_types::ServerName::try_from(host.clone())
                .map_err(|_| format!("“{host}” is not a valid server name."))?;
            let stream = tokio_rustls::TlsConnector::from(config)
                .connect(name, tcp)
                .await
                .map_err(|e| format!("TLS with {host} failed: {e}"))?;
            let (mut sender, conn) =
                hyper::client::conn::http2::handshake(TokioExecutor::new(), TokioIo::new(stream))
                    .await
                    .map_err(|e| format!("HTTP/2 with {host} failed: {e}"))?;
            tokio::spawn(conn);
            sender.send_request(request).await
        } else {
            let (mut sender, conn) =
                hyper::client::conn::http2::handshake(TokioExecutor::new(), TokioIo::new(tcp))
                    .await
                    .map_err(|e| {
                        format!("HTTP/2 with {host} failed (is the server plain-text gRPC?): {e}")
                    })?;
            tokio::spawn(conn);
            sender.send_request(request).await
        }
        .map_err(|e| format!("The call failed: {e}"))?;
        let mut reply = RawReply {
            status: response.status().as_u16(),
            headers: response
                .headers()
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or_default().to_string()))
                .collect(),
            ..RawReply::default()
        };
        let mut body = response.into_body();
        let mut data = BytesMut::new();
        while let Some(frame) = body.frame().await {
            let frame = frame.map_err(|e| format!("The reply was cut off: {e}"))?;
            if let Some(trailers) = frame.trailers_ref() {
                reply.trailers = trailers
                    .iter()
                    .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or_default().to_string()))
                    .collect();
            } else if let Ok(chunk) = frame.into_data() {
                data.extend_from_slice(&chunk);
            }
            if data.len() > 64 * 1024 * 1024 {
                return Err("The reply is larger than 64 MB.".to_string());
            }
        }
        let mut buf = data.freeze();
        while buf.remaining() >= 5 {
            let compressed = buf.get_u8();
            let len = buf.get_u32() as usize;
            if buf.remaining() < len {
                return Err("The reply ended in the middle of a message.".into());
            }
            if compressed != 0 {
                return Err(
                    "The server sent a compressed message; compression is not supported.".into(),
                );
            }
            reply.messages.push(buf.split_to(len));
        }
        Ok::<RawReply, String>(reply)
    };
    tokio::time::timeout(deadline + Duration::from_secs(2), work)
        .await
        .map_err(|_| format!("No reply within {} s.", deadline.as_secs()))?
}

fn status_of(reply: &RawReply) -> (i64, String) {
    let find = |name: &str| {
        reply
            .trailers
            .iter()
            .chain(reply.headers.iter())
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.clone())
    };
    let code = find("grpc-status")
        .and_then(|s| s.parse().ok())
        .unwrap_or(if reply.status == 200 { 0 } else { 2 });
    let message = find("grpc-message")
        .map(|m| {
            percent_encoding::percent_decode_str(&m)
                .decode_utf8_lossy()
                .into_owned()
        })
        .unwrap_or_default();
    (code, message)
}

pub const STATUS_NAMES: [&str; 17] = [
    "OK",
    "CANCELLED",
    "UNKNOWN",
    "INVALID_ARGUMENT",
    "DEADLINE_EXCEEDED",
    "NOT_FOUND",
    "ALREADY_EXISTS",
    "PERMISSION_DENIED",
    "RESOURCE_EXHAUSTED",
    "FAILED_PRECONDITION",
    "ABORTED",
    "OUT_OF_RANGE",
    "UNIMPLEMENTED",
    "INTERNAL",
    "UNAVAILABLE",
    "DATA_LOSS",
    "UNAUTHENTICATED",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CallResult {
    pub code: i64,
    pub status: String,
    pub message: String,
    pub responses: Vec<Value>,
    pub headers: Vec<(String, String)>,
    pub trailers: Vec<(String, String)>,
    pub ms: u64,
}

#[tauri::command]
pub async fn grpc_call(
    pool: String,
    service: String,
    method: String,
    request: String,
    target: Target,
    state: State<'_, GrpcState>,
) -> Result<CallResult, String> {
    let pool = state
        .pools
        .lock()
        .map_err(|e| e.to_string())?
        .get(&pool)
        .cloned()
        .ok_or("Load the .proto files or ask the server again.")?;
    let svc = pool
        .get_service_by_name(&service)
        .ok_or_else(|| format!("{service} is not in the loaded definitions."))?;
    let m = svc
        .methods()
        .find(|x| x.name() == method)
        .ok_or_else(|| format!("{service} has no method {method}."))?;
    let parsed: Value = serde_json::from_str(if request.trim().is_empty() {
        "{}"
    } else {
        &request
    })
    .map_err(|e| format!("The request is not valid JSON: {e}"))?;
    let items = match (&parsed, m.is_client_streaming()) {
        (Value::Array(list), true) => list.clone(),
        _ => vec![parsed],
    };
    let mut messages = Vec::new();
    for item in items {
        let message = DynamicMessage::deserialize_with_options(
            m.input(),
            item,
            &DeserializeOptions::new().deny_unknown_fields(true),
        )
        .map_err(|e| format!("The request does not fit {}: {e}", m.input().full_name()))?;
        messages.push(message.encode_to_vec());
    }
    let started = Instant::now();
    let reply = call_raw(&target, &format!("/{service}/{method}"), messages).await?;
    let (code, message) = status_of(&reply);
    let options = SerializeOptions::new().skip_default_fields(false);
    let mut responses = Vec::new();
    for bytes in &reply.messages {
        let decoded = DynamicMessage::decode(m.output(), bytes.clone()).map_err(|e| {
            format!(
                "The reply could not be read as {}: {e}",
                m.output().full_name()
            )
        })?;
        responses.push(
            decoded
                .serialize_with_options(serde_json::value::Serializer, &options)
                .map_err(|e| e.to_string())?,
        );
    }
    Ok(CallResult {
        code,
        status: STATUS_NAMES
            .get(code as usize)
            .copied()
            .unwrap_or("UNKNOWN")
            .to_string(),
        message,
        responses,
        headers: reply.headers,
        trailers: reply.trailers,
        ms: started.elapsed().as_millis() as u64,
    })
}

/* --------------------------------------------------------- reflection -- */

const REFLECTION_PROTO: &str = r#"syntax = "proto3";
package grpc.reflection.v1alpha;
service ServerReflection { rpc ServerReflectionInfo(stream ServerReflectionRequest) returns (stream ServerReflectionResponse); }
message ServerReflectionRequest {
  string host = 1;
  oneof message_request { string file_by_filename = 3; string file_containing_symbol = 4; ExtensionRequest file_containing_extension = 5; string all_extension_numbers_of_type = 6; string list_services = 7; }
}
message ExtensionRequest { string containing_type = 1; int32 extension_number = 2; }
message ServerReflectionResponse {
  string valid_host = 1;
  ServerReflectionRequest original_request = 2;
  oneof message_response { FileDescriptorResponse file_descriptor_response = 4; ExtensionNumberResponse all_extension_numbers_response = 5; ListServiceResponse list_services_response = 6; ErrorResponse error_response = 7; }
}
message FileDescriptorResponse { repeated bytes file_descriptor_proto = 1; }
message ExtensionNumberResponse { string base_type_name = 1; repeated int32 extension_number = 2; }
message ListServiceResponse { repeated ServiceResponse service = 1; }
message ServiceResponse { string name = 1; }
message ErrorResponse { int32 error_code = 1; string error_message = 2; }
"#;

fn reflection_pool(version: &str) -> Result<DescriptorPool, String> {
    let text = REFLECTION_PROTO.replace(
        "grpc.reflection.v1alpha",
        &format!("grpc.reflection.{version}"),
    );
    compile(&[ProtoFile {
        name: "reflection.proto".into(),
        text,
    }])
}

async fn reflect_round(
    target: &Target,
    version: &str,
    requests: Vec<(&str, String)>,
) -> Result<Vec<DynamicMessage>, String> {
    let pool = reflection_pool(version)?;
    let req_desc = pool
        .get_message_by_name(&format!(
            "grpc.reflection.{version}.ServerReflectionRequest"
        ))
        .ok_or("reflection")?;
    let res_desc = pool
        .get_message_by_name(&format!(
            "grpc.reflection.{version}.ServerReflectionResponse"
        ))
        .ok_or("reflection")?;
    let mut messages = Vec::new();
    for (field, value) in requests {
        let mut m = DynamicMessage::new(req_desc.clone());
        m.set_field_by_name(field, prost_reflect::Value::String(value));
        messages.push(m.encode_to_vec());
    }
    let reply = call_raw(
        target,
        &format!("/grpc.reflection.{version}.ServerReflection/ServerReflectionInfo"),
        messages,
    )
    .await?;
    let (code, message) = status_of(&reply);
    if code != 0 {
        return Err(format!(
            "{} {}",
            STATUS_NAMES
                .get(code as usize)
                .copied()
                .unwrap_or("UNKNOWN"),
            message
        ));
    }
    reply
        .messages
        .into_iter()
        .map(|b| DynamicMessage::decode(res_desc.clone(), b).map_err(|e| e.to_string()))
        .collect()
}

fn files_in(response: &DynamicMessage) -> Vec<Vec<u8>> {
    let Some(fdr) = response.get_field_by_name("file_descriptor_response") else {
        return Vec::new();
    };
    let Some(fdr) = fdr.as_message() else {
        return Vec::new();
    };
    let Some(list) = fdr.get_field_by_name("file_descriptor_proto") else {
        return Vec::new();
    };
    list.as_list()
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_bytes().map(|b| b.to_vec()))
                .collect()
        })
        .unwrap_or_default()
}

/// Lists services with gRPC server reflection and fetches their definitions.
pub async fn reflect(target: &Target) -> Result<DescriptorPool, String> {
    let mut last_error = String::new();
    for version in ["v1", "v1alpha"] {
        let listed =
            match reflect_round(target, version, vec![("list_services", String::new())]).await {
                Ok(r) => r,
                Err(e) => {
                    last_error = e;
                    continue;
                }
            };
        let mut names = Vec::new();
        for r in &listed {
            if let Some(list) = r
                .get_field_by_name("list_services_response")
                .and_then(|v| v.as_message().cloned())
            {
                if let Some(services) = list
                    .get_field_by_name("service")
                    .and_then(|v| v.as_list().map(<[prost_reflect::Value]>::to_vec))
                {
                    for s in services {
                        if let Some(name) = s
                            .as_message()
                            .and_then(|m| m.get_field_by_name("name"))
                            .and_then(|n| n.as_str().map(str::to_string))
                        {
                            names.push(name);
                        }
                    }
                }
            }
        }
        let names: Vec<String> = names
            .into_iter()
            .filter(|n| !n.starts_with("grpc.reflection."))
            .collect();
        if names.is_empty() {
            return Err("The server lists no services.".into());
        }
        let mut protos: HashMap<String, prost_types::FileDescriptorProto> = HashMap::new();
        let mut wanted: Vec<(&str, String)> = names
            .iter()
            .map(|n| ("file_containing_symbol", n.clone()))
            .collect();
        let mut asked: HashSet<String> = HashSet::new();
        for _ in 0..8 {
            if wanted.is_empty() {
                break;
            }
            for (_, v) in &wanted {
                asked.insert(v.clone());
            }
            for response in reflect_round(target, version, wanted).await? {
                for bytes in files_in(&response) {
                    let fd = prost_types::FileDescriptorProto::decode(bytes.as_slice())
                        .map_err(|e| e.to_string())?;
                    protos.insert(fd.name().to_string(), fd);
                }
            }
            // Ask for imports the server has not sent yet.
            wanted = protos
                .values()
                .flat_map(|f| f.dependency.clone())
                .filter(|d| !protos.contains_key(d) && !asked.contains(d))
                .collect::<HashSet<_>>()
                .into_iter()
                .map(|d| ("file_by_filename", d))
                .collect();
        }
        let set = prost_types::FileDescriptorSet {
            file: protos.into_values().collect(),
        };
        let mut pool = DescriptorPool::new();
        pool.add_file_descriptor_set(set)
            .map_err(|e| format!("The server's definitions are incomplete: {e}"))?;
        return Ok(pool);
    }
    Err(format!(
        "The server does not offer reflection ({last_error}). Load its .proto files instead."
    ))
}

#[tauri::command]
pub async fn grpc_reflect(
    target: Target,
    state: State<'_, GrpcState>,
) -> Result<Described, String> {
    let pool = reflect(&target).await?;
    let key = format!("reflect:{}", target.address.trim());
    let services = describe(&pool);
    state
        .pools
        .lock()
        .map_err(|e| e.to_string())?
        .insert(key.clone(), pool);
    Ok(Described {
        pool: key,
        services,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROTO: &str = r#"syntax = "proto3";
package museum.v1;
import "google/protobuf/timestamp.proto";
service Tickets {
  rpc Book (BookRequest) returns (Booking);
  rpc Watch (BookRequest) returns (stream Booking);
}
message BookRequest { string show = 1; int32 seats = 2; repeated string names = 3; }
message Booking { string id = 1; google.protobuf.Timestamp at = 2; }
"#;

    #[test]
    fn compiles_protos_and_makes_request_templates() {
        let pool = compile(&[ProtoFile {
            name: "tickets.proto".into(),
            text: PROTO.into(),
        }])
        .unwrap();
        let services = describe(&pool);
        assert_eq!(services.len(), 1);
        assert_eq!(services[0].name, "museum.v1.Tickets");
        let book = &services[0].methods[0];
        assert_eq!(book.input, "museum.v1.BookRequest");
        assert!(services[0].methods[1].server_streaming);
        let template: Value = serde_json::from_str(&book.template).unwrap();
        assert_eq!(
            template,
            serde_json::json!({ "show": "", "seats": 0, "names": [] })
        );
        assert!(compile(&[ProtoFile {
            name: "bad.proto".into(),
            text: "syntax = \"proto3\"; message {".into()
        }])
        .is_err());
    }

    /// A one-method gRPC server (HTTP/2, plain text) that answers every call with one Booking.
    async fn fake_server() -> u16 {
        use http_body_util::StreamBody;
        use hyper::body::Frame;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    break;
                };
                tokio::spawn(async move {
                    let service = hyper::service::service_fn(
                        |req: Request<hyper::body::Incoming>| async move {
                            let path = req.uri().path().to_string();
                            let body = req.into_body().collect().await.unwrap().to_bytes();
                            let pool = compile(&[ProtoFile {
                                name: "tickets.proto".into(),
                                text: PROTO.into(),
                            }])
                            .unwrap();
                            let input = DynamicMessage::decode(
                                pool.get_message_by_name("museum.v1.BookRequest").unwrap(),
                                &body[5..],
                            )
                            .unwrap();
                            let show = input
                                .get_field_by_name("show")
                                .unwrap()
                                .as_str()
                                .unwrap()
                                .to_string();
                            let mut out = DynamicMessage::new(
                                pool.get_message_by_name("museum.v1.Booking").unwrap(),
                            );
                            out.set_field_by_name(
                                "id",
                                prost_reflect::Value::String(format!("{path}|{show}")),
                            );
                            let bytes = out.encode_to_vec();
                            let mut framed = BytesMut::new();
                            framed.put_u8(0);
                            framed.put_u32(bytes.len() as u32);
                            framed.put_slice(&bytes);
                            let mut trailers = hyper::HeaderMap::new();
                            trailers.insert("grpc-status", "0".parse().unwrap());
                            let frames = vec![
                                Ok::<_, std::convert::Infallible>(Frame::data(framed.freeze())),
                                Ok(Frame::trailers(trailers)),
                            ];
                            let response = hyper::Response::builder()
                                .header("content-type", "application/grpc")
                                .body(StreamBody::new(futures_util::stream::iter(frames)))
                                .unwrap();
                            Ok::<_, std::convert::Infallible>(response)
                        },
                    );
                    let _ = hyper::server::conn::http2::Builder::new(TokioExecutor::new())
                        .serve_connection(TokioIo::new(stream), service)
                        .await;
                });
            }
        });
        port
    }

    #[test]
    fn makes_a_unary_call() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let port = fake_server().await;
            let pool = compile(&[ProtoFile {
                name: "tickets.proto".into(),
                text: PROTO.into(),
            }])
            .unwrap();
            let method = pool
                .get_service_by_name("museum.v1.Tickets")
                .unwrap()
                .methods()
                .next()
                .unwrap();
            let request = DynamicMessage::deserialize(
                method.input(),
                serde_json::json!({ "show": "planetarium", "seats": 2 }),
            )
            .unwrap();
            let target = Target {
                address: format!("127.0.0.1:{port}"),
                tls: false,
                insecure: false,
                metadata: vec![("x-museum".into(), "vitm".into())],
                deadline_ms: 5000,
            };
            let reply = call_raw(
                &target,
                "/museum.v1.Tickets/Book",
                vec![request.encode_to_vec()],
            )
            .await
            .unwrap();
            assert_eq!(status_of(&reply), (0, String::new()));
            let booking =
                DynamicMessage::decode(method.output(), reply.messages[0].clone()).unwrap();
            assert_eq!(
                booking.get_field_by_name("id").unwrap().as_str(),
                Some("/museum.v1.Tickets/Book|planetarium")
            );
        });
    }

    #[test]
    fn reads_targets() {
        let t = |address: &str, tls: bool| Target {
            address: address.into(),
            tls,
            insecure: false,
            metadata: vec![],
            deadline_ms: 1000,
        };
        assert_eq!(
            parse_target(&t("localhost:50051", false)).unwrap(),
            ("localhost".into(), 50051, false)
        );
        assert_eq!(
            parse_target(&t("https://api.example.org", false)).unwrap(),
            ("api.example.org".into(), 443, true)
        );
        assert_eq!(
            parse_target(&t("[::1]:9000", false)).unwrap(),
            ("::1".into(), 9000, false)
        );
        assert!(parse_target(&t(":80", false)).is_err());
    }
}
