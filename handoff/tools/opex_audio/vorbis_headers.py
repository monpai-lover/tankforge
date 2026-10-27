"""Rebuild FMOD-stripped Vorbis id/setup headers with the system libvorbisenc; match FSB setup CRC32."""
import ctypes as C, zlib, struct, json, os, base64
venc = C.CDLL('libvorbisenc.so.2'); vb = C.CDLL('libvorbis.so.0')
class OggPacket(C.Structure):
    _fields_ = [('packet', C.POINTER(C.c_ubyte)), ('bytes', C.c_long), ('b_o_s', C.c_long), ('e_o_s', C.c_long), ('granulepos', C.c_int64), ('packetno', C.c_int64)]
def headers(channels, rate, quality):
    vi = C.create_string_buffer(4096); vc = C.create_string_buffer(4096); vd = C.create_string_buffer(65536)
    vb.vorbis_info_init(vi)
    if venc.vorbis_encode_init_vbr(vi, C.c_long(channels), C.c_long(rate), C.c_float(quality)) != 0:
        vb.vorbis_info_clear(vi); return None
    vb.vorbis_comment_init(vc); vb.vorbis_analysis_init(vd, vi)
    h = [OggPacket() for _ in range(3)]
    vb.vorbis_analysis_headerout(vd, vc, C.byref(h[0]), C.byref(h[1]), C.byref(h[2]))
    pk = [C.string_at(p.packet, p.bytes) for p in h]
    vb.vorbis_dsp_clear(vd); vb.vorbis_comment_clear(vc); vb.vorbis_info_clear(vi)
    return pk
def find(wanted):
    """wanted: {(channels, rate, crc)} -> {key: (id, comment, setup, quality)}"""
    found = {}
    for ch, rate, crc in wanted:
        for qi in range(-10, 101):
            q = qi / 100
            pk = headers(ch, rate, q)
            if pk and zlib.crc32(pk[2]) & 0xffffffff == crc:
                found[(ch, rate, crc)] = (pk[0], pk[1], pk[2], q); break
        else:
            setup = TABLE.get(crc)
            if setup: found[(ch, rate, crc)] = (ident(ch, rate), comment(), setup, None)
    return found
# Setups libvorbisenc does not rebuild (FMOD's own encoder settings), taken from vgmstream's table:
# fsb_vorbis_setups.json. Their identification header is FMOD's: blocksizes 256 / 2048, bitrates unset.
def _table():
    try: d = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fsb_vorbis_setups.json')))
    except OSError: return {}
    return {int(k): base64.b64decode(v) for k, v in d['setups'].items()}
TABLE = _table()
def ident(channels, rate):
    return b'\x01vorbis' + struct.pack('<IBIiii', 0, channels, rate, 0, 0, 0) + bytes([8 | 11 << 4, 1])
def comment():
    v = b'tankforge opex_audio'
    return b'\x03vorbis' + struct.pack('<I', len(v)) + v + struct.pack('<I', 0) + b'\x01'
