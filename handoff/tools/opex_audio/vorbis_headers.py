"""Rebuild FMOD-stripped Vorbis id/setup headers with the system libvorbisenc; match FSB setup CRC32."""
import ctypes as C, zlib, struct
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
    return found
