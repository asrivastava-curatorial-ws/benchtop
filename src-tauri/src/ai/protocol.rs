//! Framing between the app and its AI worker process.
//!
//! A frame is a little-endian u32 length and a JSON header, then a u32 count of
//! binary attachments, each a u64 length and its bytes.  Images and audio travel
//! as attachments so nothing is Base64-encoded.

use std::io::{self, Read, Write};

use serde_json::Value;

/// Largest header or attachment accepted (2 GiB), so a corrupt length cannot exhaust memory.
const MAX_PART: u64 = 2 << 30;

#[derive(Debug, Clone, Default)]
pub struct Frame {
    pub header: Value,
    pub attachments: Vec<Vec<u8>>,
}

impl Frame {
    pub fn new(header: Value) -> Self {
        Frame {
            header,
            attachments: Vec::new(),
        }
    }

    pub fn with(mut self, bytes: Vec<u8>) -> Self {
        self.attachments.push(bytes);
        self
    }
}

pub fn write_frame<W: Write + ?Sized>(out: &mut W, frame: &Frame) -> io::Result<()> {
    let header = serde_json::to_vec(&frame.header)?;
    out.write_all(&(header.len() as u32).to_le_bytes())?;
    out.write_all(&header)?;
    out.write_all(&(frame.attachments.len() as u32).to_le_bytes())?;
    for part in &frame.attachments {
        out.write_all(&(part.len() as u64).to_le_bytes())?;
        out.write_all(part)?;
    }
    out.flush()
}

fn read_exact_vec<R: Read + ?Sized>(input: &mut R, len: u64) -> io::Result<Vec<u8>> {
    if len > MAX_PART {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "frame part too large",
        ));
    }
    let mut buffer = vec![0u8; len as usize];
    input.read_exact(&mut buffer)?;
    Ok(buffer)
}

/// Reads one frame; `Ok(None)` at a clean end of stream.
pub fn read_frame<R: Read + ?Sized>(input: &mut R) -> io::Result<Option<Frame>> {
    let mut len = [0u8; 4];
    match input.read_exact(&mut len) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error),
    }
    let header = read_exact_vec(input, u32::from_le_bytes(len) as u64)?;
    let header: Value = serde_json::from_slice(&header)?;
    let mut count = [0u8; 4];
    input.read_exact(&mut count)?;
    let count = u32::from_le_bytes(count);
    if count > 16 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "too many attachments",
        ));
    }
    let mut attachments = Vec::with_capacity(count as usize);
    for _ in 0..count {
        let mut part = [0u8; 8];
        input.read_exact(&mut part)?;
        attachments.push(read_exact_vec(input, u64::from_le_bytes(part))?);
    }
    Ok(Some(Frame {
        header,
        attachments,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn frames_round_trip() {
        let frame = Frame::new(json!({"op": "background", "n": 2}))
            .with(vec![1, 2, 3])
            .with(Vec::new());
        let mut buffer = Vec::new();
        write_frame(&mut buffer, &frame).unwrap();
        write_frame(&mut buffer, &Frame::new(json!({"op": "next"}))).unwrap();
        let mut reader = buffer.as_slice();
        let first = read_frame(&mut reader).unwrap().unwrap();
        assert_eq!(first.header["op"], "background");
        assert_eq!(first.attachments, vec![vec![1, 2, 3], vec![]]);
        assert_eq!(
            read_frame(&mut reader).unwrap().unwrap().header["op"],
            "next"
        );
        assert!(read_frame(&mut reader).unwrap().is_none());
    }

    #[test]
    fn rejects_huge_parts() {
        let mut bytes = (u32::MAX).to_le_bytes().to_vec();
        bytes.extend_from_slice(&[0; 8]);
        assert!(read_frame(&mut bytes.as_slice()).is_err());
    }
}
