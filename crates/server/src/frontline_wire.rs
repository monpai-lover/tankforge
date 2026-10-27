//! Opt-in, lossless frontline-frame transport. The simulation and its 20Hz inputs
//! remain unchanged. A socket owns its encoder; only already-authorized views
//! enter it, so a later visibility policy must filter before encoding.
//!
//! This module is intentionally independent of socket/domain mutation. Until a
//! client negotiates wire2, the existing JSON protocol remains the transport.
//!
//! Header (41 bytes): `TFD2`, kind:u8 (0 full,1 delta), stream:u64LE,
//! reset_epoch:u32LE, battle:u64LE, tick:u64LE, base_tick:u64LE (full uses0).
//! Full body is exactly Update::Frame, without the ServerMsg wrapper.
//! Values:0null,1false,2true,3negative zigzag-varuint,4unsigned-varuint,
//! 5f64LE,6new UTF8 string(byte-count,varuint then bytes),7stringref-varuint,
//! 8array(count,values),9object(count,string-key/value pairs),10exact-f32LE,
//! 11packed exact-f32-float array(count,raw4*count),12packed f64-float array.
//! Patches:0keep,1replace(value),2object(count,key/patch pairs;4 deletes key),
//! 3same-length array(count,index/patch pairs),5f64-bits-XOR(varuint).
//! Varuint is canonical unsigned LEB128, maximum10 bytes. Strings are interned
//! in encounter order, including keys. Full resets clear this dictionary.
//! f32 encodings are used only when their promoted f64 bits equal the original
//! value, including signedzero; there is no state quantization.
use serde_json::{Map, Number, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

pub const VERSION: u32 = 2;
pub const MAGIC: &[u8; 4] = b"TFD2";
pub const HEADER_BYTES: usize = 41;
pub const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;
const MAX_DEPTH: usize = 64;
const MAX_NODES: usize = 2_000_000;
const MAX_SYMBOLS: usize = 65_536;
const MAX_JS_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WireError {
    Invalid(&'static str),
    Limit(&'static str),
    /// No partial dictionary or frame changes are committed on this error.
    /// The bridge should request a full reset, without changing a player's role.
    ResyncRequired(&'static str),
}
impl std::fmt::Display for WireError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for WireError {}
type Result<T> = std::result::Result<T, WireError>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FrameHeader {
    pub full: bool,
    pub stream: u64,
    pub epoch: u32,
    pub battle: u64,
    pub tick: u64,
    pub base_tick: u64,
}
impl FrameHeader {
    pub fn read(bytes: &[u8]) -> Result<Self> {
        if bytes.len() < HEADER_BYTES || bytes.get(..4) != Some(MAGIC.as_slice()) {
            return Err(WireError::Invalid("wire2 header"));
        }
        if bytes.len() > MAX_FRAME_BYTES {
            return Err(WireError::Limit("frame bytes"));
        }
        if bytes[4] > 1 {
            return Err(WireError::Invalid("wire2 kind"));
        }
        let u64_at = |n| u64::from_le_bytes(bytes[n..n + 8].try_into().unwrap());
        let header = Self {
            full: bytes[4] == 0,
            stream: u64_at(5),
            epoch: u32::from_le_bytes(bytes[13..17].try_into().unwrap()),
            battle: u64_at(17),
            tick: u64_at(25),
            base_tick: u64_at(33),
        };
        if header.stream == 0 || header.epoch == 0 || header.battle == 0 {
            return Err(WireError::Invalid("zero stream/epoch/battle"));
        }
        if header.full && header.base_tick != 0 || !header.full && header.tick <= header.base_tick {
            return Err(WireError::Invalid("frame tick header"));
        }
        Ok(header)
    }
    fn write(self, out: &mut Vec<u8>) {
        out.extend(MAGIC);
        out.push(u8::from(!self.full));
        out.extend(self.stream.to_le_bytes());
        out.extend(self.epoch.to_le_bytes());
        out.extend(self.battle.to_le_bytes());
        out.extend(self.tick.to_le_bytes());
        out.extend(self.base_tick.to_le_bytes());
    }
}

/// A dictionary is scoped to one accepted reset epoch. Its numeric IDs depend
/// only on packet order; replacement/failed packets must not alter it.
#[derive(Clone, Default)]
struct Symbols {
    ids: BTreeMap<String, u32>,
    values: Vec<String>,
}
impl Symbols {
    fn intern(&mut self, text: &str) -> Result<u32> {
        if self.values.len() >= MAX_SYMBOLS {
            return Err(WireError::Limit("string dictionary"));
        }
        if self.ids.contains_key(text) {
            return Err(WireError::Invalid("duplicate string definition"));
        }
        let id = self.values.len() as u32;
        self.values.push(text.to_owned());
        self.ids.insert(text.to_owned(), id);
        Ok(id)
    }
}

#[derive(Default)]
struct Budget {
    nodes: usize,
}
impl Budget {
    fn visit(&mut self, depth: usize) -> Result<()> {
        self.nodes += 1;
        if depth > MAX_DEPTH || self.nodes > MAX_NODES {
            Err(WireError::Limit("tree depth/nodes"))
        } else {
            Ok(())
        }
    }
}

/// Exact JSON/native values, including float bits and signed zero. In
/// particular Value::PartialEq alone would collapse -0.0 into +0.0.
pub fn identical(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => match (a.is_f64(), b.is_f64()) {
            (true, true) => a.as_f64().unwrap().to_bits() == b.as_f64().unwrap().to_bits(),
            (false, false) => a == b,
            _ => false,
        },
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| identical(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(k, a)| b.get(k).is_some_and(|b| identical(a, b)))
        }
        _ => a == b,
    }
}

fn varint(mut value: u64, out: &mut Vec<u8>) {
    while value >= 128 {
        out.push((value as u8) | 128);
        value >>= 7;
    }
    out.push(value as u8);
}
fn exact_f32(f: f64) -> bool {
    f.is_finite() && ((f as f32) as f64).to_bits() == f.to_bits()
}
fn varint_bytes(value: u64) -> usize {
    ((64 - value.leading_zeros() as usize).max(1) + 6) / 7
}
fn string(text: &str, symbols: &mut Symbols, out: &mut Vec<u8>) -> Result<()> {
    if let Some(id) = symbols.ids.get(text) {
        out.push(7);
        varint(*id as u64, out);
    } else {
        symbols.intern(text)?;
        out.push(6);
        varint(text.len() as u64, out);
        out.extend(text.as_bytes());
    }
    Ok(())
}
fn value(
    v: &Value,
    symbols: &mut Symbols,
    out: &mut Vec<u8>,
    budget: &mut Budget,
    depth: usize,
) -> Result<()> {
    budget.visit(depth)?;
    match v {
        Value::Null => out.push(0),
        Value::Bool(false) => out.push(1),
        Value::Bool(true) => out.push(2),
        Value::Number(n) => {
            if n.is_f64() {
                let f = n.as_f64().ok_or(WireError::Invalid("float"))?;
                if !f.is_finite() {
                    return Err(WireError::Invalid("nonfinite number"));
                }
                if exact_f32(f) {
                    out.push(10);
                    out.extend((f as f32).to_le_bytes());
                } else {
                    out.push(5);
                    out.extend(f.to_le_bytes());
                }
            } else if n.as_i64().is_some_and(|i| i < 0) {
                let i = n.as_i64().unwrap();
                if i < -(MAX_JS_INTEGER as i64) {
                    return Err(WireError::Limit("unsafe JavaScript integer"));
                }
                out.push(3);
                varint(((i as u64) << 1) ^ ((i >> 63) as u64), out);
            } else {
                let u = n.as_u64().ok_or(WireError::Invalid("integer"))?;
                if u > MAX_JS_INTEGER {
                    return Err(WireError::Limit("unsafe JavaScript integer"));
                }
                out.push(4);
                varint(u, out);
            }
        }
        Value::String(s) => string(s, symbols, out)?,
        Value::Array(a) => {
            let floats =
                !a.is_empty() && a.iter().all(|v| v.as_number().is_some_and(Number::is_f64));
            let floats32 = floats && a.iter().all(|v| exact_f32(v.as_f64().unwrap()));
            out.push(if floats32 {
                11
            } else if floats {
                12
            } else {
                8
            });
            varint(a.len() as u64, out);
            for v in a {
                if floats {
                    budget.visit(depth + 1)?;
                    let f = v.as_f64().unwrap();
                    if floats32 {
                        out.extend((f as f32).to_le_bytes());
                    } else {
                        out.extend(f.to_le_bytes());
                    }
                } else {
                    value(v, symbols, out, budget, depth + 1)?;
                }
            }
        }
        Value::Object(o) => {
            out.push(9);
            varint(o.len() as u64, out);
            for (k, v) in o {
                string(k, symbols, out)?;
                value(v, symbols, out, budget, depth + 1)?;
            }
        }
    }
    if out.len() > MAX_FRAME_BYTES {
        return Err(WireError::Limit("frame bytes"));
    }
    Ok(())
}

fn entity(v: &Value) -> Option<&Value> {
    v.as_object()?.get("unit").filter(|v| v.is_object())
}
fn patch(
    a: &Value,
    b: &Value,
    symbols: &mut Symbols,
    out: &mut Vec<u8>,
    budget: &mut Budget,
    depth: usize,
) -> Result<()> {
    budget.visit(depth)?;
    if identical(a, b) {
        out.push(0);
        return Ok(());
    }
    if let (Some(a), Some(b)) = (
        a.as_number().filter(|n| n.is_f64()),
        b.as_number().filter(|n| n.is_f64()),
    ) {
        let a = a.as_f64().unwrap();
        let b = b.as_f64().unwrap();
        let xor = a.to_bits() ^ b.to_bits();
        let replacement = if exact_f32(b) { 6 } else { 10 };
        if 1 + varint_bytes(xor) < replacement {
            out.push(5);
            varint(xor, out);
            return Ok(());
        }
    }
    // A new life never inherits any omitted inventory/damage from the old one.
    let replace_entity = match (entity(a), entity(b)) {
        (Some(a), Some(b)) => !identical(a, b),
        (None, None) => false,
        _ => true,
    };
    match (a, b) {
        (Value::Object(a), Value::Object(b)) if !replace_entity => {
            out.push(2);
            let changed = b
                .iter()
                .filter(|(k, v)| a.get(*k).is_none_or(|old| !identical(old, v)))
                .count();
            let removed = a.keys().filter(|k| !b.contains_key(*k)).count();
            varint((changed + removed) as u64, out);
            for k in a.keys().filter(|k| !b.contains_key(*k)) {
                string(k, symbols, out)?;
                out.push(4);
            }
            for (k, v) in b {
                match a.get(k) {
                    Some(old) if identical(old, v) => {}
                    Some(old) => {
                        string(k, symbols, out)?;
                        patch(old, v, symbols, out, budget, depth + 1)?;
                    }
                    None => {
                        string(k, symbols, out)?;
                        out.push(1);
                        value(v, symbols, out, budget, depth + 1)?;
                    }
                }
            }
        }
        (Value::Array(a), Value::Array(b))
            if a.len() == b.len()
                && !(b.iter().all(|v| v.is_number())
                    && a.iter().zip(b).filter(|(a, b)| !identical(a, b)).count() * 4
                        > b.len() * 3) =>
        {
            out.push(3);
            varint(
                a.iter().zip(b).filter(|(a, b)| !identical(a, b)).count() as u64,
                out,
            );
            for (i, (a, b)) in a.iter().zip(b).enumerate() {
                if !identical(a, b) {
                    varint(i as u64, out);
                    patch(a, b, symbols, out, budget, depth + 1)?;
                }
            }
        }
        _ => {
            out.push(1);
            value(b, symbols, out, budget, depth + 1)?;
        }
    }
    if out.len() > MAX_FRAME_BYTES {
        return Err(WireError::Limit("frame bytes"));
    }
    Ok(())
}

fn frame_scope(frame: &Value) -> Result<(u64, u64)> {
    if frame["op"] != "frame" {
        return Err(WireError::Invalid("not a frontline frame"));
    }
    let battle = frame["battle"]
        .as_u64()
        .filter(|b| *b > 0 && *b <= MAX_JS_INTEGER)
        .ok_or(WireError::Invalid("battle"))?;
    let tick = frame["tick"]
        .as_u64()
        .filter(|t| *t <= MAX_JS_INTEGER)
        .ok_or(WireError::Invalid("tick"))?;
    let mut units = BTreeSet::new();
    for field in ["units", "aircrafts"] {
        let a = frame[field]
            .as_array()
            .ok_or(WireError::Invalid("missing frame entities"))?;
        for unit in a {
            let u = entity(unit).ok_or(WireError::Invalid("entity identity"))?;
            let unit = u["unit"]
                .as_u64()
                .filter(|u| *u > 0 && *u <= MAX_JS_INTEGER)
                .ok_or(WireError::Invalid("unit ID"))?;
            let life = u["life"]
                .as_u64()
                .filter(|l| *l > 0 && *l <= MAX_JS_INTEGER)
                .ok_or(WireError::Invalid("unit life"))?;
            if u["battle"].as_u64() != Some(battle) || !units.insert(unit) {
                return Err(WireError::Invalid("cross-battle/duplicate unit identity"));
            }
            let _ = life;
        }
    }
    Ok((battle, tick))
}

/// One connection, after explicit wire2 negotiation. Sharing this state among
/// sockets/audiences would allow unrelated baseline or visibility histories.
pub struct FrameEncoder {
    stream: u64,
    epoch: u32,
    baseline: Option<Arc<Value>>,
    symbols: Symbols,
    force: bool,
}
impl FrameEncoder {
    pub fn new(stream: u64) -> Self {
        Self {
            stream,
            epoch: 0,
            baseline: None,
            symbols: Symbols::default(),
            force: true,
        }
    }
    /// Called on snapshot/resume/resync or any authorized-audience change.
    /// The next frame carries a fresh full dictionary/baseline. It does not
    /// change the world or advance its tick, and can resend the current tick.
    pub fn force_reset(&mut self) {
        self.force = true;
    }
    pub fn encode(&mut self, frame: &crate::frontline::Update) -> Result<Vec<u8>> {
        let value =
            serde_json::to_value(frame).map_err(|_| WireError::Invalid("serialize frame"))?;
        self.encode_shared(&Arc::new(value))
    }
    /// Serialize the authorized broadcast once, then independently encode for
    /// each recipient. This avoids repeating native-view serialization.
    pub fn encode_value(&mut self, frame: &Value) -> Result<Vec<u8>> {
        self.encode_shared(&Arc::new(frame.clone()))
    }
    /// Prefer this API in the bridge: one authorized immutable frame can back
    /// all recipients with that visibility. Only dictionaries remain per socket.
    pub fn encode_shared(&mut self, frame: &Arc<Value>) -> Result<Vec<u8>> {
        let (battle, tick) = frame_scope(frame)?;
        if self.stream == 0 {
            return Err(WireError::Invalid("zero stream"));
        }
        let full = self.force || self.baseline.as_ref().is_none_or(|b| b["battle"] != battle);
        if self.baseline.as_ref().is_some_and(|b| {
            b["battle"] == battle
                && (b["tick"].as_u64().unwrap() > tick
                    || !full && b["tick"].as_u64().unwrap() == tick)
        }) {
            return Err(WireError::Invalid("non-increasing encoded tick"));
        }
        match self.build(frame, battle, tick, full) {
            Err(WireError::Limit("string dictionary")) if !full => {
                self.build(frame, battle, tick, true)
            }
            result => result,
        }
    }
    fn build(&mut self, frame: &Arc<Value>, battle: u64, tick: u64, full: bool) -> Result<Vec<u8>> {
        let epoch = if full {
            self.epoch
                .checked_add(1)
                .ok_or(WireError::Limit("reset epochs"))?
        } else {
            self.epoch
        };
        let header = FrameHeader {
            full,
            stream: self.stream,
            epoch,
            battle,
            tick,
            base_tick: if full {
                0
            } else {
                self.baseline.as_ref().unwrap()["tick"].as_u64().unwrap()
            },
        };
        let mut symbols = if full {
            Symbols::default()
        } else {
            self.symbols.clone()
        };
        let mut out = Vec::new();
        header.write(&mut out);
        let mut budget = Budget::default();
        if full {
            value(frame, &mut symbols, &mut out, &mut budget, 0)?;
        } else {
            patch(
                self.baseline.as_ref().unwrap(),
                frame,
                &mut symbols,
                &mut out,
                &mut budget,
                0,
            )?;
        }
        self.symbols = symbols;
        self.baseline = Some(frame.clone());
        self.epoch = epoch;
        self.force = false;
        Ok(out)
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
    budget: Budget,
}
impl<'a> Reader<'a> {
    fn take(&mut self, count: usize) -> Result<&'a [u8]> {
        let end = self
            .offset
            .checked_add(count)
            .ok_or(WireError::Limit("offset"))?;
        let bytes = self
            .bytes
            .get(self.offset..end)
            .ok_or(WireError::Invalid("truncated frame"))?;
        self.offset = end;
        Ok(bytes)
    }
    fn byte(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }
    fn varint(&mut self) -> Result<u64> {
        let mut result = 0;
        for i in 0..10 {
            let byte = self.byte()?;
            if i == 9 && byte > 1 || i > 0 && byte == 0 {
                return Err(WireError::Invalid("noncanonical/overflow varint"));
            }
            result |= ((byte & 127) as u64) << (7 * i);
            if byte < 128 {
                return Ok(result);
            }
        }
        Err(WireError::Invalid("overflow varint"))
    }
    fn count(&mut self) -> Result<usize> {
        let n = self.varint()?;
        if n > MAX_NODES as u64 {
            Err(WireError::Limit("container length"))
        } else {
            Ok(n as usize)
        }
    }
    fn string(&mut self, symbols: &mut Symbols) -> Result<String> {
        match self.byte()? {
            6 => {
                let count = self.count()?;
                let text = std::str::from_utf8(self.take(count)?)
                    .map_err(|_| WireError::Invalid("UTF8"))?
                    .to_owned();
                symbols.intern(&text)?;
                Ok(text)
            }
            7 => {
                let id = self.count()?;
                symbols
                    .values
                    .get(id)
                    .cloned()
                    .ok_or(WireError::Invalid("unknown string reference"))
            }
            _ => Err(WireError::Invalid("expected string")),
        }
    }
    fn value(&mut self, symbols: &mut Symbols, depth: usize) -> Result<Value> {
        self.budget.visit(depth)?;
        let tag = self.byte()?;
        Ok(match tag {
            0 => Value::Null,
            1 => Value::Bool(false),
            2 => Value::Bool(true),
            3 => {
                let raw = self.varint()?;
                let i = ((raw >> 1) as i64) ^ -((raw & 1) as i64);
                if i >= 0 || i < -(MAX_JS_INTEGER as i64) {
                    return Err(WireError::Invalid("negative integer"));
                }
                Value::Number(Number::from(i))
            }
            4 => {
                let u = self.varint()?;
                if u > MAX_JS_INTEGER {
                    return Err(WireError::Limit("unsafe JavaScript integer"));
                }
                Value::Number(Number::from(u))
            }
            5 => {
                let f = f64::from_le_bytes(self.take(8)?.try_into().unwrap());
                Value::Number(Number::from_f64(f).ok_or(WireError::Invalid("nonfinite number"))?)
            }
            10 => {
                let f = f32::from_le_bytes(self.take(4)?.try_into().unwrap()) as f64;
                Value::Number(Number::from_f64(f).ok_or(WireError::Invalid("nonfinite number"))?)
            }
            6 | 7 => {
                self.offset -= 1;
                Value::String(self.string(symbols)?)
            }
            8 => {
                let count = self.count()?;
                let mut a = Vec::new();
                for _ in 0..count {
                    a.push(self.value(symbols, depth + 1)?);
                }
                Value::Array(a)
            }
            11 | 12 => {
                let count = self.count()?;
                let mut a = Vec::new();
                for _ in 0..count {
                    self.budget.visit(depth + 1)?;
                    let f = if tag == 11 {
                        f32::from_le_bytes(self.take(4)?.try_into().unwrap()) as f64
                    } else {
                        f64::from_le_bytes(self.take(8)?.try_into().unwrap())
                    };
                    a.push(Value::Number(
                        Number::from_f64(f).ok_or(WireError::Invalid("nonfinite number"))?,
                    ));
                }
                Value::Array(a)
            }
            9 => {
                let count = self.count()?;
                let mut o = Map::new();
                for _ in 0..count {
                    let key = self.string(symbols)?;
                    let value = self.value(symbols, depth + 1)?;
                    if o.insert(key, value).is_some() {
                        return Err(WireError::Invalid("duplicate object key"));
                    }
                }
                Value::Object(o)
            }
            _ => return Err(WireError::Invalid("value tag")),
        })
    }
    fn patch(&mut self, base: &mut Value, symbols: &mut Symbols, depth: usize) -> Result<()> {
        self.budget.visit(depth)?;
        match self.byte()? {
            0 => {}
            1 => *base = self.value(symbols, depth + 1)?,
            2 => {
                let is_entity = entity(base).is_some();
                let o = base
                    .as_object_mut()
                    .ok_or(WireError::Invalid("object patch type"))?;
                let count = self.count()?;
                let mut keys = BTreeSet::new();
                for _ in 0..count {
                    let key = self.string(symbols)?;
                    if !keys.insert(key.clone()) {
                        return Err(WireError::Invalid("duplicate patch key"));
                    }
                    if is_entity && key == "unit" {
                        return Err(WireError::Invalid("identity requires entity replacement"));
                    }
                    if self.bytes.get(self.offset) == Some(&4) {
                        self.offset += 1;
                        if o.remove(&key).is_none() {
                            return Err(WireError::Invalid("remove missing key"));
                        }
                    } else if let Some(old) = o.get_mut(&key) {
                        self.patch(old, symbols, depth + 1)?;
                    } else {
                        if self.byte()? != 1 {
                            return Err(WireError::Invalid("new key requires replacement"));
                        }
                        o.insert(key, self.value(symbols, depth + 1)?);
                    }
                }
            }
            3 => {
                let a = base
                    .as_array_mut()
                    .ok_or(WireError::Invalid("array patch type"))?;
                let count = self.count()?;
                let mut indices = BTreeSet::new();
                for _ in 0..count {
                    let index = self.count()?;
                    if !indices.insert(index) {
                        return Err(WireError::Invalid("duplicate array index"));
                    }
                    self.patch(
                        a.get_mut(index)
                            .ok_or(WireError::Invalid("array patch index"))?,
                        symbols,
                        depth + 1,
                    )?;
                }
            }
            5 => {
                let old = base
                    .as_number()
                    .filter(|n| n.is_f64())
                    .and_then(Number::as_f64)
                    .ok_or(WireError::Invalid("float XOR base"))?;
                let f = f64::from_bits(old.to_bits() ^ self.varint()?);
                *base = Value::Number(
                    Number::from_f64(f).ok_or(WireError::Invalid("nonfinite XOR number"))?,
                );
            }
            _ => return Err(WireError::Invalid("patch tag")),
        }
        Ok(())
    }
}

/// Reference decoder and contract oracle. Browser helper must apply the same
/// validation and commit semantics; no socket/world owns this decoder's state.
#[derive(Default)]
pub struct FrameDecoder {
    header: Option<FrameHeader>,
    baseline: Option<Value>,
    symbols: Symbols,
}
impl FrameDecoder {
    /// A replacement WebSocket gets a new decoder, never a previous socket's
    /// cache. Explicit clear is provided for the browser adapter's close hook.
    pub fn clear(&mut self) {
        *self = Self::default();
    }
    pub fn decode(&mut self, bytes: &[u8]) -> Result<Value> {
        let header = FrameHeader::read(bytes)?;
        if let Some(old) = self.header {
            if header.stream != old.stream {
                return Err(WireError::ResyncRequired("socket stream changed"));
            }
            if header.full {
                if header.epoch <= old.epoch {
                    return Err(WireError::ResyncRequired("stale reset epoch"));
                }
                if header.battle == old.battle && header.tick < old.tick {
                    return Err(WireError::ResyncRequired("stale reset tick"));
                }
            } else if header.epoch != old.epoch
                || header.battle != old.battle
                || header.base_tick != old.tick
            {
                return Err(WireError::ResyncRequired("missing or different baseline"));
            }
        } else if !header.full {
            return Err(WireError::ResyncRequired("full baseline required"));
        }
        let mut reader = Reader {
            bytes,
            offset: HEADER_BYTES,
            budget: Budget::default(),
        };
        let mut symbols = if header.full {
            Symbols::default()
        } else {
            self.symbols.clone()
        };
        let frame = if header.full {
            reader.value(&mut symbols, 0)?
        } else {
            let mut frame = self
                .baseline
                .as_ref()
                .ok_or(WireError::ResyncRequired("full baseline required"))?
                .clone();
            reader.patch(&mut frame, &mut symbols, 0)?;
            frame
        };
        if reader.offset != bytes.len() {
            return Err(WireError::Invalid("trailing bytes"));
        }
        if frame_scope(&frame)? != (header.battle, header.tick) {
            return Err(WireError::Invalid("header/frame identity mismatch"));
        }
        self.symbols = symbols;
        self.baseline = Some(frame.clone());
        self.header = Some(header);
        Ok(frame)
    }
}

#[cfg(test)]
#[path = "frontline_wire_tests.rs"]
mod tests;
