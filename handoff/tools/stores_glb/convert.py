#!/usr/bin/env python3
"""Air_Stores_v1 GLB -> the game's store models in data.line (key "storeModels").

    python3 -I convert.py PACKAGE_DIR DATA_LINE

PACKAGE_DIR is the unpacked Air_Stores_v1 folder (data/catalog.json, data/mount_manifest.json,
models/LOD0, models/LOD1). Each asset keeps both LODs separately (never drawn together), its game
sockets (socket_mount, seeker_origin, fx_exhaust, release_axis, socket_aircraft, socket_store_N) and,
for an assembly, each Store_XX_Root as its own group (one removable weapon). The wing / fin nodes stay
their own parts (their names kept: a control surface's hinge is not calibrated, nothing animates
them). Geometry: positions in 0.1 mm int16 (the package is metres, +Y up, +Z to the nose; the origin
is the length centre, not a centre of gravity), normals int8, indices uint16; the textured paint
material becomes its texture's mean colour (the display markings are not drawn). Everything a lod
holds is one zlib blob (base64), offsets per part. data.line is written through a checked temporary
file (exactly one JSON).
"""
import base64, io, json, os, struct, sys, zlib


def glb(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'glTF', path
    n = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + n])
    o = 20 + n
    bn = struct.unpack('<I', b[o:o + 4])[0]
    return j, b[o + 8:o + 8 + bn]


def accessor(j, binc, k):
    a = j['accessors'][k]; v = j['bufferViews'][a['bufferView']]
    comp = {5126: ('f', 4), 5123: ('H', 2), 5125: ('I', 4), 5121: ('B', 1)}[a['componentType']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    off = v.get('byteOffset', 0) + a.get('byteOffset', 0); stride = v.get('byteStride') or comp[1] * n
    out = []
    for i in range(a['count']):
        out.append(struct.unpack_from('<' + comp[0] * n, binc, off + i * stride))
    return out


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def texture_mean(j, binc, tex_index):
    try:
        from PIL import Image
    except ImportError:
        return [0.8, 0.8, 0.8]
    img = j['images'][j['textures'][tex_index]['source']]
    v = j['bufferViews'][img['bufferView']]
    data = binc[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
    im = Image.open(io.BytesIO(data)).convert('RGB').resize((32, 32))
    px = list(im.getdata())
    return [srgb_to_linear(sum(p[k] for p in px) / len(px) / 255) for k in range(3)]


def material(j, binc, k):
    m = j['materials'][k]; pbr = m.get('pbrMetallicRoughness', {})
    col = list(pbr.get('baseColorFactor', [1, 1, 1, 1]))[:3]
    if 'baseColorTexture' in pbr:
        t = texture_mean(j, binc, pbr['baseColorTexture']['index'])
        col = [col[i] * t[i] for i in range(3)]
    return {'name': m.get('name', ''), 'color': [round(c, 4) for c in col], 'rough': round(pbr.get('roughnessFactor', 0.6), 3), 'metal': round(pbr.get('metallicFactor', 0.1), 3)}


def convert_lod(path):
    j, binc = glb(path)
    nodes = j['nodes']
    parent = {}
    for i, nd in enumerate(nodes):
        for c in nd.get('children', []): parent[c] = i
    def world(i):
        t = [0.0, 0.0, 0.0]
        while i is not None:
            nd = nodes[i]
            assert not nd.get('rotation') and not nd.get('scale') and not nd.get('matrix'), f'{path}: node {nd.get("name")} has more than a translation'
            tr = nd.get('translation', [0, 0, 0]); t = [t[k] + tr[k] for k in range(3)]
            i = parent.get(i)
        return t
    def group(i):
        # the Store_XX_Root this node belongs to ('' for the carrier / a single missile)
        while i is not None:
            if nodes[i].get('name', '').endswith('_Root') and nodes[i].get('name', '').startswith('Store_'): return nodes[i]['name']
            i = parent.get(i)
        return ''
    sockets, roots, parts, blob = {}, {}, [], bytearray()
    for i, nd in enumerate(nodes):
        name = nd.get('name', '')
        if 'mesh' not in nd:
            if i not in parent: continue
            if name.startswith('Store_') and name.endswith('_Root'): roots[name] = [round(v, 5) for v in world(i)]
            else: sockets[name] = [round(v, 5) for v in world(i)]
            continue
        t = world(i)
        for pr in j['meshes'][nd['mesh']]['primitives']:
            assert pr.get('mode', 4) == 4
            pos = accessor(j, binc, pr['attributes']['POSITION'])
            nor = accessor(j, binc, pr['attributes']['NORMAL'])
            idx = [v[0] for v in accessor(j, binc, pr['indices'])]
            assert len(pos) < 65536
            mat = material(j, binc, pr['material']) if 'material' in pr else {'name': '', 'color': [0.8, 0.8, 0.8], 'rough': 0.6, 'metal': 0.1}
            o = len(blob)
            q = [int(round((p[k] + t[k]) * 1e4)) for p in pos for k in range(3)]
            assert all(-32768 <= v <= 32767 for v in q), f'{path}: beyond the int16 range'
            blob += struct.pack(f'<{len(q)}h', *q)
            blob += struct.pack(f'<{len(nor) * 3}b', *[max(-127, min(127, int(round(c * 127)))) for n in nor for c in n])
            if len(blob) % 2: blob += b'\0'
            io_ = len(blob)
            blob += struct.pack(f'<{len(idx)}H', *idx)
            if len(blob) % 4: blob += b'\0' * (4 - len(blob) % 4)
            parts.append({'name': name, 'group': group(i), **mat, 'vertices': len(pos), 'triangles': len(idx) // 3, 'pos': o, 'nor': o + len(q) * 2, 'idx': io_})
    return {'parts': parts, 'sockets': sockets, 'roots': roots, 'blob': base64.b64encode(zlib.compress(bytes(blob), 9)).decode()}


def main(pkg, data_line):
    cat = json.load(open(os.path.join(pkg, 'data', 'catalog.json'), encoding='utf-8'))
    man = {a['id']: a for a in json.load(open(os.path.join(pkg, 'data', 'mount_manifest.json'), encoding='utf-8'))['assets']}
    models = {}
    for a in cat['assets']:
        lods = {k: convert_lod(os.path.join(pkg, v['path'])) for k, v in a['lods'].items()}
        # the two LODs carry the same sockets (checked): a mount moves nowhere between them
        s0, s1 = lods['0']['sockets'], lods['1']['sockets']
        assert s0.keys() == s1.keys() and all(max(abs(s0[k][i] - s1[k][i]) for i in range(3)) < 1e-4 for k in s0), a['id']
        models[a['id']] = {'label': a['label'], 'category': a['category'], 'family': a.get('family'), 'guidance_class': a.get('guidance_class'), 'length_m': a.get('length_m'), 'diameter_m': a.get('body_diameter_m'), 'span_m': a.get('span_m'),
                           'dimension_status': a.get('dimension_status'), 'source_ids': a.get('source_ids', []), 'notes': a.get('notes', ''), 'integration': a.get('integration', {}),
                           'compatibility': man.get(a['id'], {}).get('compatibility', 'unverified_disabled'), 'lods': lods}
        print(a['id'], {k: sum(p['triangles'] for p in v['parts']) for k, v in lods.items()}, len(lods['0']['blob']) + len(lods['1']['blob']), 'b64 bytes')
    s = open(data_line, encoding='utf-8').read()
    i, j = s.index('>') + 1, s.rindex('</script>')
    d = json.loads(s[i:j])
    d['storeModels'] = models
    d['storeSources'] = json.load(open(os.path.join(pkg, 'data', 'sources.json'), encoding='utf-8'))
    body = json.dumps(d, ensure_ascii=False, separators=(',', ':'))
    tmp = data_line + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f: f.write(s[:i] + body + s[j:])
    t = open(tmp, encoding='utf-8').read()
    json.loads(t[t.index('>') + 1:t.rindex('</script>')])
    os.replace(tmp, data_line)
    print('storeModels', len(models), 'data.line', os.path.getsize(data_line))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
