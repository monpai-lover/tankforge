"""Reading binary glTF (.glb) files: accessors, images, and the meshes placed by the node tree."""
import io
import json
import struct

import numpy as np
from PIL import Image


def load(path):
    """(gltf json, accessor(i) -> numpy array, image(i) -> PIL image)."""
    b = open(path, 'rb').read()
    off = 12
    chunks = []
    while off < len(b):
        cl, ct = struct.unpack('<II', b[off:off + 8])
        chunks.append(b[off + 8:off + 8 + cl])
        off += 8 + cl
    j = json.loads(chunks[0])
    B = chunks[1]

    def acc(i):
        a = j['accessors'][i]
        bv = j['bufferViews'][a['bufferView']]
        ct = {5126: np.float32, 5123: np.uint16, 5121: np.uint8, 5125: np.uint32}[a['componentType']]
        n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = bv.get('byteStride')
        isz = np.dtype(ct).itemsize
        if stride and stride != isz * n:
            raw = np.frombuffer(B, dtype=np.uint8, count=stride * a['count'], offset=o).reshape(a['count'], stride)
            arr = raw[:, :isz * n].copy().view(ct).reshape(a['count'], n)
        else:
            arr = np.frombuffer(B, dtype=ct, count=a['count'] * n, offset=o).reshape(a['count'], n)
        return arr.astype(np.float64) if n > 1 else arr.reshape(-1).astype(np.int64)

    def image(i):
        bv = j['bufferViews'][j['images'][i]['bufferView']]
        o = bv.get('byteOffset', 0)
        return Image.open(io.BytesIO(B[o:o + bv['byteLength']]))

    return j, acc, image


def node_matrix(n):
    if 'matrix' in n:
        return np.array(n['matrix'], float).reshape(4, 4).T
    x, y, z, w = n.get('rotation', [0, 0, 0, 1])
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    M = np.eye(4)
    M[:3, :3] = R * np.array(n.get('scale', [1, 1, 1]), float)[None, :]
    M[:3, 3] = n.get('translation', [0, 0, 0])
    return M


def scene_meshes(j, acc, with_nodes=False, level_nodes=()):
    """[(mesh index, primitive, world positions, world normals, uv or None, triangles)]; with
    with_nodes, each also carries the names of its node and the node's ancestors. Nodes named in
    level_nodes lose their own rotation (a gun modelled elevated is set level)."""
    out = []

    def walk(i, M, names=()):
        n = j['nodes'][i]
        L = node_matrix(n)
        if n.get('name', '') in level_nodes:
            L[:3, :3] = np.eye(3)
        W = M @ L
        names = names + (n.get('name', ''),)
        if 'mesh' in n:
            for p in j['meshes'][n['mesh']]['primitives']:
                P = acc(p['attributes']['POSITION']) @ W[:3, :3].T + W[:3, 3]
                N = acc(p['attributes']['NORMAL']) @ np.linalg.inv(W[:3, :3]) if 'NORMAL' in p['attributes'] else np.zeros_like(P)
                N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
                uv = acc(p['attributes']['TEXCOORD_0']) if 'TEXCOORD_0' in p['attributes'] else None
                I = acc(p['indices']).reshape(-1, 3) if 'indices' in p else np.arange(len(P)).reshape(-1, 3)
                out.append((n['mesh'], p, P, N, uv, I, names) if with_nodes else (n['mesh'], p, P, N, uv, I))
        for c in n.get('children', []):
            walk(c, W, names)

    for r in j['scenes'][j.get('scene', 0)]['nodes']:
        walk(r, np.eye(4))
    return out


def diffuse_texture(j, material):
    """Image index of a material's colour map (metal-rough or spec-gloss), or None."""
    m = j['materials'][material]
    e = m.get('extensions', {}).get('KHR_materials_pbrSpecularGlossiness')
    t = (e or {}).get('diffuseTexture') or m.get('pbrMetallicRoughness', {}).get('baseColorTexture')
    return j['textures'][t['index']]['source'] if t else None


def normal_texture(j, material):
    t = j['materials'][material].get('normalTexture')
    return j['textures'][t['index']]['source'] if t else None
