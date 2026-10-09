//! The WebSocket protocol (RFC 6455) on a plain `TcpStream`: the HTTP upgrade handshake (with its
//! own SHA-1 and base64, so the server needs no outside crates) and reading / writing frames.
//! Text frames carry the JSON messages; pings are answered; fragmented messages are joined.
use std::io::{self, Read, Write};

/// Largest message accepted from a client (the game sends a few hundred bytes at a time).
pub const MAX_MESSAGE: usize = 64 * 1024;

const GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/// SHA-1 of `data` (FIPS 180-1). Used only for the handshake's accept key.
pub fn sha1(data: &[u8]) -> [u8; 20] {
    let mut h: [u32; 5] = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
    let mut msg = data.to_vec();
    let bits = (data.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bits.to_be_bytes());
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 80];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([chunk[i * 4], chunk[i * 4 + 1], chunk[i * 4 + 2], chunk[i * 4 + 3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let [mut a, mut b, mut c, mut d, mut e] = h;
        for (i, wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | (!b & d), 0x5A827999),
                20..=39 => (b ^ c ^ d, 0x6ED9EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1BBCDC),
                _ => (b ^ c ^ d, 0xCA62C1D6),
            };
            let t = a.rotate_left(5).wrapping_add(f).wrapping_add(e).wrapping_add(k).wrapping_add(*wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = t;
        }
        for (x, y) in h.iter_mut().zip([a, b, c, d, e]) {
            *x = x.wrapping_add(y);
        }
    }
    let mut out = [0u8; 20];
    for (i, x) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&x.to_be_bytes());
    }
    out
}

/// Standard base64 with padding.
pub fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

/// The `Sec-WebSocket-Accept` value for a client's `Sec-WebSocket-Key`.
pub fn accept_key(key: &str) -> String {
    base64(&sha1(format!("{}{}", key.trim(), GUID).as_bytes()))
}

/// The handshake reply.
pub fn handshake_response(key: &str) -> String {
    format!("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {}\r\n\r\n", accept_key(key))
}

/// A frame as the server sends it (unmasked).
pub fn encode(opcode: u8, payload: &[u8]) -> Vec<u8> {
    let mut f = Vec::with_capacity(payload.len() + 10);
    f.push(0x80 | (opcode & 0x0f));
    let n = payload.len();
    if n < 126 {
        f.push(n as u8);
    } else if n < 65536 {
        f.push(126);
        f.extend_from_slice(&(n as u16).to_be_bytes());
    } else {
        f.push(127);
        f.extend_from_slice(&(n as u64).to_be_bytes());
    }
    f.extend_from_slice(payload);
    f
}

pub fn text(s: &str) -> Vec<u8> {
    encode(1, s.as_bytes())
}

/// What came in on the socket.
#[derive(Debug, PartialEq)]
pub enum Incoming {
    Text(String),
    Ping(Vec<u8>),
    Close,
    /// Binary frames and pongs: nothing to do.
    Other,
}

/// Reads one frame's header and payload. `masked`: client frames must be masked.
fn read_frame(r: &mut impl Read, masked: bool) -> io::Result<(bool, u8, Vec<u8>)> {
    let mut h = [0u8; 2];
    r.read_exact(&mut h)?;
    let fin = h[0] & 0x80 != 0;
    let opcode = h[0] & 0x0f;
    let has_mask = h[1] & 0x80 != 0;
    if masked && !has_mask {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "client frame not masked"));
    }
    let mut len = (h[1] & 0x7f) as u64;
    if len == 126 {
        let mut b = [0u8; 2];
        r.read_exact(&mut b)?;
        len = u16::from_be_bytes(b) as u64;
    } else if len == 127 {
        let mut b = [0u8; 8];
        r.read_exact(&mut b)?;
        len = u64::from_be_bytes(b);
    }
    if len as usize > MAX_MESSAGE {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "frame too large"));
    }
    let mut mask = [0u8; 4];
    if has_mask {
        r.read_exact(&mut mask)?;
    }
    let mut payload = vec![0u8; len as usize];
    r.read_exact(&mut payload)?;
    if has_mask {
        for (i, b) in payload.iter_mut().enumerate() {
            *b ^= mask[i % 4];
        }
    }
    Ok((fin, opcode, payload))
}

/// Reads one whole message (joining continuation frames).
pub fn read_message(r: &mut impl Read, masked: bool) -> io::Result<Incoming> {
    let mut data = Vec::new();
    let mut kind = None;
    loop {
        let (fin, opcode, payload) = read_frame(r, masked)?;
        match opcode {
            0x8 => return Ok(Incoming::Close),
            0x9 => return Ok(Incoming::Ping(payload)),
            0xA => return Ok(Incoming::Other),
            0x0..=0x2 => {
                if opcode != 0 {
                    kind = Some(opcode);
                }
                data.extend_from_slice(&payload);
                if data.len() > MAX_MESSAGE {
                    return Err(io::Error::new(io::ErrorKind::InvalidData, "message too large"));
                }
                if fin {
                    return Ok(match kind {
                        Some(1) => Incoming::Text(String::from_utf8(data).map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "text is not UTF-8"))?),
                        _ => Incoming::Other,
                    });
                }
            }
            _ => return Err(io::Error::new(io::ErrorKind::InvalidData, "unknown opcode")),
        }
    }
}

/// A masked client frame (for tests and tools that talk to the server).
pub fn encode_masked(opcode: u8, payload: &[u8], mask: [u8; 4]) -> Vec<u8> {
    let mut f = encode(opcode, payload);
    let at = f.len() - payload.len();
    f[1] |= 0x80;
    let mut out = f[..at].to_vec();
    out.extend_from_slice(&mask);
    out.extend(payload.iter().enumerate().map(|(i, b)| b ^ mask[i % 4]));
    out
}

pub fn write_all(w: &mut impl Write, frame: &[u8]) -> io::Result<()> {
    w.write_all(frame)?;
    w.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha1_and_base64_match_the_references() {
        let hex = |b: &[u8]| b.iter().map(|x| format!("{x:02x}")).collect::<String>();
        assert_eq!(hex(&sha1(b"abc")), "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(hex(&sha1(b"")), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
        assert_eq!(hex(&sha1(&[b'a'; 1000])), "291e9a6c66994949b57ba5e650361e98fc36b1ba");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64(b"fo"), "Zm8=");
        // RFC 6455 section 1.3
        assert_eq!(accept_key("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    }

    #[test]
    fn frames_round_trip_at_every_length_encoding() {
        for n in [0usize, 5, 125, 126, 300, 65535, 65536] {
            let n = n.min(MAX_MESSAGE);
            let payload: Vec<u8> = (0..n).map(|i| b'a' + (i % 26) as u8).collect();
            let f = encode_masked(1, &payload, [1, 2, 3, 4]);
            let got = read_message(&mut &f[..], true).unwrap();
            assert_eq!(got, Incoming::Text(String::from_utf8(payload).unwrap()));
        }
        // fragmented text, a ping, a close
        let mut a = encode_masked(1, b"hel", [9, 9, 9, 9]);
        a[0] &= 0x7f;
        a.extend(encode_masked(0, b"lo", [7, 7, 7, 7]));
        assert_eq!(read_message(&mut &a[..], true).unwrap(), Incoming::Text("hello".into()));
        assert_eq!(read_message(&mut &encode_masked(9, b"x", [0; 4])[..], true).unwrap(), Incoming::Ping(b"x".to_vec()));
        assert_eq!(read_message(&mut &encode_masked(8, b"", [0; 4])[..], true).unwrap(), Incoming::Close);
        // unmasked client frames and oversized ones are refused
        assert!(read_message(&mut &text("hi")[..], true).is_err());
        let big = encode_masked(1, &vec![b'x'; MAX_MESSAGE + 1], [0; 4]);
        assert!(read_message(&mut &big[..], true).is_err());
    }
}
