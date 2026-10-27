#!/usr/bin/env python3
"""The pilot figure for every aircraft (user request: the USSR pilot model, used directly) -> data.line
key "pilotModel".

    python3 -I convert.py MIG29_REMAKE_GLB DATA_LINE [--preview OUT.png]

The source is the user's MiG-29 remake (its PILOT_* nodes: the "USSR Pilot Late (War Thunder)" model
by KojfDiscord, CC BY 4.0, fitted seated in a jet's seat by the user: turned to +Y up / +Z to the
nose in metres, scaled, reclined). The figure is taken as it sits, moved so that its eye point (behind
the visor's middle) is the origin; the game puts that point at each type's cockpit eye.

Geometry: positions in 0.1 mm int16 (the game's frame: X mirrored, the glTF file being right-handed,
the winding turned with it), normals int8, texture coordinates uint16 into one 1024 x 1024 JPEG atlas
of the suit's, the helmet's and the mask's colour maps (the normal and gloss maps are left out); the
visor is a dark glass part without a texture. One zlib blob (base64), offsets per part. data.line is
written through a checked temporary file (exactly one JSON).
"""
import base64, io, json, math, os, site, struct, sys, zlib

sys.path.append(site.getusersitepackages())
from PIL import Image  # noqa: E402

ATLAS = 1024
# the atlas: each textured part's colour map scaled into its own cell (x, y, w, h in pixels)
CELLS = {'PILOT_Suit': (0, 0, 1024, 640), 'PILOT_Helmet': (0, 640, 512, 384), 'PILOT_Mask': (512, 640, 512, 384)}


def glb(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'glTF', path
    off, js, binc = 12, None, None
    while off < len(b):
        cl, ct = struct.unpack('<II', b[off:off + 8])
        c = b[off + 8:off + 8 + cl]
        if ct == 0x4E4F534A:
            js = json.loads(c)
        elif ct == 0x004E4942:
            binc = c
        off += 8 + cl
    return js, binc


def accessor(j, binc, k):
    a = j['accessors'][k]
    v = j['bufferViews'][a['bufferView']]
    fmt, size = {5126: ('f', 4), 5123: ('H', 2), 5125: ('I', 4), 5121: ('B', 1)}[a['componentType']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = v.get('byteStride') or size * n
    return [struct.unpack_from('<' + fmt * n, binc, off + i * stride) for i in range(a['count'])]


def mat4(n):
    if 'matrix' in n:
        m = n['matrix']
        return [[m[c * 4 + r] for c in range(4)] for r in range(4)]
    x, y, z, w = n.get('rotation', [0, 0, 0, 1])
    sx, sy, sz = n.get('scale', [1, 1, 1])
    tx, ty, tz = n.get('translation', [0, 0, 0])
    R = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    return [[R[0][0] * sx, R[0][1] * sy, R[0][2] * sz, tx], [R[1][0] * sx, R[1][1] * sy, R[1][2] * sz, ty],
            [R[2][0] * sx, R[2][1] * sy, R[2][2] * sz, tz], [0, 0, 0, 1]]


def mmul(A, B):
    return [[sum(A[r][k] * B[k][c] for k in range(4)) for c in range(4)] for r in range(4)]


def nodes_world(j):
    out = {}

    def walk(i, M):
        n = j['nodes'][i]
        W = mmul(M, mat4(n))
        out[i] = W
        for c in n.get('children', []):
            walk(c, W)
    I = [[1 if r == c else 0 for c in range(4)] for r in range(4)]
    for r in j['scenes'][j.get('scene', 0)]['nodes']:
        walk(r, I)
    return out


def image_of(j, binc, tex):
    img = j['images'][j['textures'][tex]['source']]
    v = j['bufferViews'][img['bufferView']]
    raw = binc[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
    return Image.open(io.BytesIO(raw)).convert('RGB')


def main(src, data_line, preview=None):
    j, binc = glb(src)
    W = nodes_world(j)
    parts, atlas = [], Image.new('RGB', (ATLAS, ATLAS), (60, 60, 56))
    raw = {}
    for ni, n in enumerate(j['nodes']):
        name = n.get('name', '')
        if not name.startswith('PILOT_') or 'mesh' not in n:
            continue
        M = W[ni]
        for pr in j['meshes'][n['mesh']]['primitives']:
            P = accessor(j, binc, pr['attributes']['POSITION'])
            N = accessor(j, binc, pr['attributes']['NORMAL'])
            UV = accessor(j, binc, pr['attributes']['TEXCOORD_0']) if 'TEXCOORD_0' in pr['attributes'] else None
            I = [t[0] for t in accessor(j, binc, pr['indices'])]
            mat = j['materials'][pr['material']]
            sg = mat.get('extensions', {}).get('KHR_materials_pbrSpecularGlossiness', {})
            tex = sg.get('diffuseTexture', {}).get('index', mat.get('pbrMetallicRoughness', {}).get('baseColorTexture', {}).get('index'))
            cell = CELLS.get(name) if tex is not None and UV else None
            if cell:
                im = image_of(j, binc, tex).resize((cell[2], cell[3]), Image.LANCZOS)
                atlas.paste(im, (cell[0], cell[1]))
            # world positions (metres), mirrored X; normals by the rotation part
            pos = [[M[r][0] * p[0] + M[r][1] * p[1] + M[r][2] * p[2] + M[r][3] for r in range(3)] for p in P]
            nor = []
            for q in N:
                v = [M[r][0] * q[0] + M[r][1] * q[1] + M[r][2] * q[2] for r in range(3)]
                l = math.sqrt(sum(c * c for c in v)) or 1
                nor.append([v[0] / l, v[1] / l, v[2] / l])
            uv = None
            if cell:
                uv = [((cell[0] + (u - math.floor(u)) * cell[2]) / ATLAS, (cell[1] + (vv - math.floor(vv)) * cell[3]) / ATLAS) for u, vv in UV]
            colour = sg.get('diffuseFactor', [0.05, 0.05, 0.06, 1])[:3]
            raw.setdefault(name, []).append({'pos': pos, 'nor': nor, 'uv': uv, 'idx': I, 'colour': colour, 'textured': bool(cell)})
    # the eye point: behind the visor's middle (its back face less 3 cm)
    vis = [p for prim in raw['PILOT_Visor'] for p in prim['pos']]
    eye = [0.0, (min(p[1] for p in vis) + max(p[1] for p in vis)) / 2, min(p[2] for p in vis) - 0.03]
    blob, out_parts = bytearray(), []
    for name in ('PILOT_Suit', 'PILOT_Helmet', 'PILOT_Mask', 'PILOT_Visor'):
        for prim in raw.get(name, []):
            nv = len(prim['pos'])
            assert nv < 65536
            rec = {'name': name, 'vertices': nv, 'triangles': len(prim['idx']) // 3, 'textured': prim['textured'],
                   'colour': [round(c, 4) for c in prim['colour']], 'glass': name == 'PILOT_Visor'}
            rec['pos'] = len(blob)
            blob += struct.pack('<%dh' % (nv * 3), *[max(-32767, min(32767, round(((-p[0] - eye[0]) if k == 0 else (p[k] - eye[k])) * 1e4))) for p in prim['pos'] for k in range(3)])
            while len(blob) % 4:
                blob.append(0)
            rec['nor'] = len(blob)
            blob += struct.pack('<%db' % (nv * 3), *[max(-127, min(127, round((-q[0] if k == 0 else q[k]) * 127))) for q in prim['nor'] for k in range(3)])
            while len(blob) % 4:
                blob.append(0)
            if prim['uv']:
                rec['uv'] = len(blob)
                blob += struct.pack('<%dH' % (nv * 2), *[max(0, min(65535, round(c * 65535))) for t in prim['uv'] for c in t])
            rec['idx'] = len(blob)
            # the winding turned with the mirror
            I = prim['idx']
            blob += struct.pack('<%dH' % len(I), *[I[t + c] for t in range(0, len(I), 3) for c in (0, 2, 1)])
            while len(blob) % 4:
                blob.append(0)
            out_parts.append(rec)
    jpg = io.BytesIO()
    atlas.save(jpg, 'JPEG', quality=86, optimize=True)
    if preview:
        atlas.save(preview)
    model = {'version': 1, 'source': {
        'title': 'USSR Pilot Late (War Thunder)', 'author': 'KojfDiscord', 'url': 'https://sketchfab.com/3d-models/ussr-pilot-late-war-thunder-9acefd3e5f854e69a0ed6fb7bbfce9dc',
        'license': 'CC BY 4.0', 'fitted': "the user's MiG-29 remake (seated in the jet's seat)"},
        'eyeInSource': [round(c, 4) for c in eye], 'texture': 'data:image/jpeg;base64,' + base64.b64encode(jpg.getvalue()).decode(),
        'parts': out_parts, 'blob': base64.b64encode(zlib.compress(bytes(blob), 9)).decode()}
    s = open(data_line, encoding='utf-8').read()
    i, k = s.index('>') + 1, s.rindex('</script>')
    d = json.loads(s[i:k])
    d['pilotModel'] = model
    out = s[:i] + json.dumps(d, ensure_ascii=False, separators=(',', ':')) + s[k:]
    tmp = data_line + '.tmp'
    open(tmp, 'w', encoding='utf-8').write(out)
    json.loads(open(tmp, encoding='utf-8').read()[i:-(len(s) - k)])
    os.replace(tmp, data_line)
    print('pilotModel:', len(out_parts), 'parts', sum(p['triangles'] for p in out_parts), 'triangles, eye', model['eyeInSource'],
          'texture', len(jpg.getvalue()) // 1024, 'KB, blob', len(model['blob']) // 1024, 'KB')


if __name__ == '__main__':
    a = [x for x in sys.argv[1:] if not x.startswith('--')]
    pv = next((sys.argv[i + 1] for i, x in enumerate(sys.argv) if x == '--preview'), None)
    main(a[0], a[1], pv)
