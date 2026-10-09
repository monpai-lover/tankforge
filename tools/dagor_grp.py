"""Reads a Dagor GRP3 resource pack (a War Thunder CDK user-mod .grp) the way the engine's own
loaders do (GaijinEntertainment/DagorEngine, BSD-3-Clause):

  collision / damage model   prog/engine/gameRes/collisionResourceBuilder.cpp (loadV0)
  skeleton (GeomNodeTree)    prog/engine/math/geomTree.cpp (GeomNodeTree::load, old dump)
  render model (DynModel)    prog/engine/shaders/dynSceneRes.cpp, matVdataLoad.cpp, shaderMesh.cpp
                             (zstd-packed vertex data, meshoptimizer-packed index sequences)
  streams                    prog/engine/ioSys (readString: int length + bytes, dword aligned;
                             beginBlock: int length with the top two bits as compression tag)

    python3 tools/dagor_grp.py pack.grp [collision.json]

Each node: name, material, type (0 mesh, 1 points, 2 box, 3 sphere, 4 capsule, 5 convex), the 4x3
transform (rows: x axis, y axis, z axis, position), the vertices (node-local) and triangles. Dagor
frames are y-up with x forward (vehicles face +x), so the caller maps them to its own axes.
"""
import json
import struct
import sys

TYPES = ["mesh", "points", "box", "sphere", "capsule", "convex"]


class Reader:
    def __init__(self, data, pos=0):
        self.d = data
        self.p = pos

    def i32(self):
        v = struct.unpack_from("<i", self.d, self.p)[0]
        self.p += 4
        return v

    def u32(self):
        v = struct.unpack_from("<I", self.d, self.p)[0]
        self.p += 4
        return v

    def floats(self, n):
        v = struct.unpack_from("<%df" % n, self.d, self.p)
        self.p += 4 * n
        return list(v)

    def string(self):
        n = self.i32()
        s = self.d[self.p:self.p + n].decode("utf-8", "replace")
        self.p += n
        self.p += (-n) % 4  # alignOnDword
        return s


def grp_resources(data):
    """(name, class id, offset, size) of each resource in a GRP3 pack."""
    if data[:4] != b"GRP3":
        raise ValueError("not a GRP3 pack")
    r = Reader(data, 0x14)
    # the header's name table and resource records, as written by the pack builder
    nres = struct.unpack_from("<I", data, 0x14)[0]
    # name offsets are a table of nres ints at 0xa0; names are null-terminated from 0x40
    names = []
    for k in range(nres):
        o = struct.unpack_from("<I", data, 0xa0 + 4 * k)[0]
        e = data.index(b"\0", o)
        names.append(data[o:e].decode())
    out = []
    base = 0xa0 + 4 * nres
    for k in range(nres):
        cls, off, idx = struct.unpack_from("<IIi", data, base + 12 * k)
        out.append({"name": names[idx] if 0 <= idx < nres else "?", "class": cls, "offset": off})
    out.sort(key=lambda x: x["offset"])
    for a, b in zip(out, out[1:] + [None]):
        a["size"] = (b["offset"] if b else len(data)) - a["offset"]
    return out


def read_collision(data, off):
    r = Reader(data, off)
    label = r.u32()
    if label & 0xFFFF0000 != 0xACE50000 or label & 0xFFFF:
        raise ValueError("not a version-0 collision resource: %08x" % label)
    version = r.u32()
    has_mat = version >= 0x20150115
    has_flags = version >= 0x20180510
    sph_len = r.u32() & 0x3FFFFFFF
    sphere = r.floats(4)
    r.p += sph_len - 16
    blk = r.u32()
    if blk >> 30:
        raise ValueError("compressed collision block (zstd/oodle) is not supported")
    flags = r.i32() if has_flags else 0
    n = r.i32()
    nodes = []
    for _ in range(n):
        name = r.string()
        mat = r.string() if has_mat else ""
        tb = r.u32()
        typ = tb & 0xFF
        if flags & 2:
            r.p += 1
        tm = r.floats(12)
        if flags & 4:
            r.p += 48
        bs = r.floats(4)
        r.p += 4  # BSphere3 is c, r, r2
        bbox = r.floats(6)
        planes = []
        if typ == 5:
            k = r.i32()
            planes = [r.floats(4) for _ in range(k)]
        nv = r.i32()
        verts = [r.floats(3) for _ in range(nv)]
        ni = r.i32()
        idx = list(struct.unpack_from("<%di" % ni, data, r.p))
        r.p += 4 * ni
        nodes.append({"name": name, "material": mat, "type": TYPES[typ] if typ < len(TYPES) else typ, "behavior": tb >> 8,
                      "tm": [tm[0:3], tm[3:6], tm[6:9], tm[9:12]], "sphere": bs, "bbox": [bbox[0:3], bbox[3:6]],
                      "verts": verts, "tris": [idx[i:i + 3] for i in range(0, ni - ni % 3, 3)]})
    return {"version": "%08x" % version, "sphere": sphere, "nodes": nodes, "end": r.p}


def read_skeleton(data, off):
    """GeomNodeTree (old dump layout): [{name, parent, tm, wtm}] with 4x4 row-major matrices
    (rows: x axis, y axis, z axis, position)."""
    size, count = struct.unpack_from("<II", data, off)
    if count & 0x80000000:
        raise ValueError("compressed skeleton is not supported")
    blob = data[off + 8:off + 8 + (size & 0xFFFFF)]
    nodes = []
    for i in range(count):
        q = 160 * i
        tm = struct.unpack_from("<16f", blob, q)
        wtm = struct.unpack_from("<16f", blob, q + 64)
        parent = struct.unpack_from("<I", blob, q + 144)[0]  # offset of the parent record, 0xFFFFFFFF for none
        name_ofs = struct.unpack_from("<I", blob, q + 152)[0]
        name = blob[name_ofs:blob.index(b"\0", name_ofs)].decode()
        nodes.append({"name": name, "parent": -1 if parent == 0xFFFFFFFF else parent // 160,
                      "tm": [list(tm[0:3]), list(tm[4:7]), list(tm[8:11]), list(tm[12:15])],
                      "wtm": [list(wtm[0:3]), list(wtm[4:7]), list(wtm[8:11]), list(wtm[12:15])]})
    return nodes


def decode_index_sequence(src, count):
    """meshoptimizer's index sequence codec (meshopt_decodeIndexSequence): a 0xD0|version header, then one
    LEB128 value per index -- bit 0 picks one of two baselines, the rest is a zigzag delta."""
    if src[0] not in (0xD0, 0xD1):  # versions 0 and 1 share the sequence format
        raise ValueError("not a meshopt index sequence")
    out = [0] * count
    last = [0, 0]
    p = 1
    for i in range(count):
        v = 0
        sh = 0
        while True:
            b = src[p]
            p += 1
            v |= (b & 0x7F) << sh
            sh += 7
            if b < 0x80:
                break
        k = v & 1
        v >>= 1
        d = (v >> 1) ^ -(v & 1)
        last[k] = (last[k] + d) & 0xFFFFFFFF
        out[i] = last[k]
    return out


VSDT = {0x00000: ("f", 1), 0x10000: ("f", 2), 0x20000: ("f", 3), 0x30000: ("f", 4), 0x40000: ("B", 4), 0x50000: ("B", 4),
        0x60000: ("h", 2), 0x70000: ("h", 4), 0xA0000: ("h", 4), 0x90000: ("h", 2), 0xB0000: ("H", 2), 0xC0000: ("H", 4),
        0xF0000: ("e", 2), 0x100000: ("e", 4)}


def read_dynmodel(data, off, size):
    """DynModel (DynamicRenderableSceneLodsResource) with its ShaderMatVdata, LOD 0 only.
    Returns {textures, materials: [[texture index...]], nodes: [names], rigids: [{node, name,
    elems: [{mat, positions, normals, uv, tris}]}], bbox}; positions are node-local, already
    unpacked from the SHORT4N bound pack."""
    import zstandard
    p = off
    res_sz, = struct.unpack_from("<i", data, p)
    p += 4
    ntex, nmat, nvd, hdr_sz = struct.unpack_from("<4I", data, p)
    p += 16
    tsz, = struct.unpack_from("<i", data, p)
    p += 4
    th = data[p:p + tsz]
    p += tsz
    no, nc = struct.unpack_from("<II", th, 0)
    textures = [th[o:th.index(b"\0", o)].decode() for o in struct.unpack_from("<%di" % nc, th, no)]
    blk, = struct.unpack_from("<I", data, p)
    p += 4
    bsize, tag = blk & 0x3FFFFFFF, blk >> 30
    if (hdr_sz & 0xE0000000) != 0xC0000000 or tag != 1:
        raise ValueError("only zstd-packed vertex data is supported")
    hdr_sz &= 0x3FFFFFFF
    vdata = zstandard.ZstdDecompressor().decompressobj().decompress(data[p:p + bsize])
    p += bsize
    mo, mc = struct.unpack_from("<II", vdata, 0)
    vo, vc = struct.unpack_from("<II", vdata, 16)
    # each material's textures: the run of indices after its shader-class field (-1 = none)
    q = vdata
    vds = []
    cur = hdr_sz
    for i in range(vc):
        o = vo + 32 * i
        vn, a, b, fl = struct.unpack_from("<4I", q, o)
        do, dc = struct.unpack_from("<II", q, o + 16)
        decl = [struct.unpack_from("<iihH", q, do + 12 * k) for k in range(dc)]
        stride = a & 0xFF
        idx_bytes = b & 0xFFFFFFF
        packed = (a >> 8) | ((b >> 28) << 24) if fl & 0x200 else idx_bytes
        vb = q[cur:cur + vn * stride]
        cur += vn * stride
        ib = q[cur:cur + packed]
        cur += packed
        elem = 4 if fl & 0x40 else 2
        if fl & 0x200:
            idx = decode_index_sequence(ib, idx_bytes // elem)
        else:
            idx = list(struct.unpack("<%d%s" % (idx_bytes // elem, "I" if elem == 4 else "H"), ib))
        chans = []
        ofs = 0
        for t, usage, ui, _sid in decl:
            fmt, n = VSDT[t]
            chans.append((usage, ui, ofs, fmt, n, t))
            ofs += struct.calcsize("<%d%s" % (n, fmt))
        vds.append({"count": vn, "stride": stride, "vb": vb, "idx": idx, "chans": chans})
    # the LOD table and the dump that follows the vertex data
    a = data[p:off + size]
    lods_ofs, lods_cnt = struct.unpack_from("<II", a, 0)
    bbox = struct.unpack_from("<6f", a, 16)
    bp254 = struct.unpack_from("<4f", a, 40)
    bp255 = struct.unpack_from("<4f", a, 56)
    lod_scene_sz, = struct.unpack_from("<i", a, lods_ofs)
    r = res_sz
    nsz, = struct.unpack_from("<i", a, r)
    nm = a[r + 4:r + 4 + nsz]
    r += 4 + nsz
    t1o, t1c = struct.unpack_from("<II", nm, 0)
    t2o, t2c = struct.unpack_from("<II", nm, 16)
    sorted_names = [nm[o:nm.index(b"\0", o)].decode() for o in (struct.unpack_from("<Q", nm, t1o + 8 * k)[0] for k in range(t1c))]
    ids = struct.unpack_from("<%dH" % t2c, nm, t2o)
    name_of = {ids[k]: sorted_names[k] for k in range(t1c)}
    sc = a[r:r + lod_scene_sz]
    r += lod_scene_sz
    ro_ofs, ro_cnt = struct.unpack_from("<II", sc, 0)
    rigids = []
    for i in range(ro_cnt):
        o = ro_ofs + 32 * i
        msz, = struct.unpack_from("<i", sc, o)
        node, = struct.unpack_from("<i", sc, o + 24)
        rigids.append({"size": msz, "node": node, "name": name_of.get(node, str(node))})
    for rg in rigids:
        m = a[r:r + rg["size"]]
        r += rg["size"]
        eo, ec = struct.unpack_from("<II", m, 0)
        elems = []
        for k in range(ec):
            e = eo + 48 * k
            mat = struct.unpack_from("<q", m, e + 8)[0]
            vdi = struct.unpack_from("<q", m, e + 16)[0]
            _vdo, sv, numv, si, numf, bv = struct.unpack_from("<6i", m, e + 24)
            vd = vds[vdi]
            pos, nor, uv = [], [], []
            for vi in range(bv + sv, bv + sv + numv):
                base = vi * vd["stride"]
                P = N = T = None
                for usage, ui, ofs, fmt, n, t in vd["chans"]:
                    vals = struct.unpack_from("<%d%s" % (n, fmt), vd["vb"], base + ofs)
                    if usage == 0:
                        if t == 0xA0000:  # SHORT4N in the model's bound pack
                            P = [vals[j] / 32767.0 * bp255[j] + bp254[j] for j in range(3)]
                        else:
                            P = list(vals[:3])
                    elif usage == 1:
                        N = [(vals[2] / 255.0) * 2 - 1, (vals[1] / 255.0) * 2 - 1, (vals[0] / 255.0) * 2 - 1]  # E3DCOLOR is B,G,R,A
                    elif usage == 3 and ui == 0:
                        T = [vals[0] / 4096.0, vals[1] / 4096.0] if fmt == "h" else list(vals[:2])
                pos.append(P)
                nor.append(N or [0, 1, 0])
                uv.append(T or [0, 0])
            tris = []
            for f in range(numf):
                i0, i1, i2 = vd["idx"][si + 3 * f:si + 3 * f + 3]
                tris.append([i0 - sv, i1 - sv, i2 - sv])
            elems.append({"mat": mat, "positions": pos, "normals": nor, "uv": uv, "tris": tris})
        rg["elems"] = elems
    # materials: the texture indices each one uses (scan of the property record for its ids)
    mats = []
    for i in range(mc):
        rec = vdata[mo + 172 * i: mo + 172 * (i + 1)]
        mats.append(rec)
    return {"textures": textures, "rigids": rigids, "bbox": bbox, "materials": nmat}


def main():
    data = open(sys.argv[1], "rb").read()
    res = grp_resources(data)
    coll = next(x for x in res if x["name"].endswith("_collision"))
    out = read_collision(data, coll["offset"])
    out["resources"] = res
    if len(sys.argv) > 2:
        json.dump(out, open(sys.argv[2], "w"))
    print("%d nodes, parsed %d of %d bytes" % (len(out["nodes"]), out["end"] - coll["offset"], coll["size"]))
    for nd in out["nodes"]:
        lo, hi = nd["bbox"]
        print("%-32s %-8s %-10s v=%4d t=%4d pos=(%.2f %.2f %.2f) size=(%.2f %.2f %.2f)" % (
            nd["name"], nd["type"], nd["material"][:10], len(nd["verts"]), len(nd["tris"]), *nd["tm"][3], hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]))


if __name__ == "__main__":
    main()
