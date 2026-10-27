"""Reading a binary glTF (GLB) for the aircraft tools: the node tree with its rest and animated poses,
the primitives in world space, materials and their images. Pure data reading: nothing in a package is
executed (the packages' own build scripts are untrusted data, AGENTS.md).

Frames: glTF is right-handed, +Y up; every package here has +Z at the nose, so +X is the aircraft's port
side unless the package says otherwise. The game's frame is left-handed with +X starboard: to_game()
mirrors X (and turns the triangles' winding with it).
"""
import io, json, math, struct

import numpy as np

COMPONENT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def quat_matrix(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def trs(t=(0, 0, 0), r=(0, 0, 0, 1), s=(1, 1, 1)):
    m = np.eye(4)
    m[:3, :3] = quat_matrix(r) * np.array(s)[None, :]
    m[:3, 3] = t
    return m


def slerp(a, b, u):
    a, b = np.asarray(a, float), np.asarray(b, float)
    d = float(np.dot(a, b))
    if d < 0:
        b, d = -b, -d
    if d > 0.9995:
        q = a + (b - a) * u
        return q / np.linalg.norm(q)
    th = math.acos(min(1.0, d))
    return (math.sin((1 - u) * th) * a + math.sin(u * th) * b) / math.sin(th)


class Gltf:
    def __init__(self, path):
        b = open(path, 'rb').read()
        assert b[:4] == b'glTF', path
        off, self.j, self.bin = 12, None, b''
        while off < len(b):
            cl, ct = struct.unpack('<II', b[off:off + 8])
            c = b[off + 8:off + 8 + cl]
            if ct == 0x4E4F534A:
                self.j = json.loads(c)
            elif ct == 0x004E4942:
                self.bin = c
            off += 8 + cl
        self.path = path
        j = self.j
        self.nodes = j['nodes']
        self.parent = {}
        for i, n in enumerate(self.nodes):
            for c in n.get('children', []):
                self.parent[c] = i
        sc = j['scenes'][j.get('scene', 0)]
        self.roots = sc['nodes']
        self.scene_extras = sc.get('extras') or {}
        self._acc = {}

    # ---- buffers
    def accessor(self, k):
        if k in self._acc:
            return self._acc[k]
        a = self.j['accessors'][k]
        dt, n = COMPONENT[a['componentType']], WIDTH[a['type']]
        if 'bufferView' not in a:
            out = np.zeros((a['count'], n), dt)
        else:
            v = self.j['bufferViews'][a['bufferView']]
            off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
            size = np.dtype(dt).itemsize
            stride = v.get('byteStride') or size * n
            raw = np.frombuffer(self.bin, np.uint8, count=stride * (a['count'] - 1) + size * n, offset=off)
            if stride == size * n:
                out = raw.view(dt).reshape(a['count'], n)
            else:
                out = np.lib.stride_tricks.as_strided(raw, (a['count'], size * n), (stride, 1)).copy().view(dt).reshape(a['count'], n)
            out = out.astype(np.float64) if dt == np.float32 else out
            if a.get('normalized'):
                out = out.astype(np.float64) / float(np.iinfo(dt).max)
        if 'sparse' in a:
            raise NotImplementedError('sparse accessor')
        self._acc[k] = out
        return out

    def image_bytes(self, image_index):
        im = self.j['images'][image_index]
        v = self.j['bufferViews'][im['bufferView']]
        return self.bin[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]

    def texture_image(self, tex_index):
        t = self.j['textures'][tex_index]
        src = t.get('source')
        if src is None:
            for ext in (t.get('extensions') or {}).values():
                src = ext.get('source', src)
        return src

    # ---- poses
    def rest_local(self, i):
        n = self.nodes[i]
        if 'matrix' in n:
            return np.array(n['matrix'], float).reshape(4, 4).T
        return trs(n.get('translation', (0, 0, 0)), n.get('rotation', (0, 0, 0, 1)), n.get('scale', (1, 1, 1)))

    def channels(self, anim_name):
        """{node: {'translation'|'rotation'|'scale': (times, values, interpolation)}} of one animation."""
        a = next((a for a in self.j.get('animations', []) if a.get('name') == anim_name), None)
        if a is None:
            raise KeyError(anim_name)
        out = {}
        for ch in a['channels']:
            s = a['samplers'][ch['sampler']]
            t = self.accessor(s['input'])[:, 0]
            v = self.accessor(s['output'])
            interp = s.get('interpolation', 'LINEAR')
            if interp == 'CUBICSPLINE':
                v = v.reshape(len(t), 3, -1)[:, 1, :]  # the values between the tangents
            out.setdefault(ch['target']['node'], {})[ch['target']['path']] = (t, v, interp)
        return out

    def duration(self, anim_name):
        return max(float(t[-1]) for ch in self.channels(anim_name).values() for t, _, _ in ch.values())

    def local_at(self, i, chans, time):
        n = self.nodes[i]
        c = chans.get(i) if chans else None
        if not c or 'matrix' in n:
            return self.rest_local(i)
        parts = {'translation': n.get('translation', (0, 0, 0)), 'rotation': n.get('rotation', (0, 0, 0, 1)), 'scale': n.get('scale', (1, 1, 1))}
        for path, (t, v, interp) in c.items():
            if time <= t[0]:
                val = v[0]
            elif time >= t[-1]:
                val = v[-1]
            else:
                k = int(np.searchsorted(t, time) - 1)
                u = (time - t[k]) / max(1e-9, t[k + 1] - t[k])
                if interp == 'STEP':
                    val = v[k]
                elif path == 'rotation':
                    val = slerp(v[k], v[k + 1], u)
                else:
                    val = v[k] + (v[k + 1] - v[k]) * u
            parts[path] = val
        return trs(parts['translation'], parts['rotation'], parts['scale'])

    def world(self, chans=None, time=0.0):
        """Every node's world matrix (4x4) at `time` of the animation channels `chans` (None: rest)."""
        W = {}

        def walk(i, M):
            W[i] = M @ self.local_at(i, chans, time)
            for c in self.nodes[i].get('children', []):
                walk(c, W[i])
        for r in self.roots:
            walk(r, np.eye(4))
        return W

    def path(self, i):
        names = []
        while i is not None:
            names.append(self.nodes[i].get('name', str(i)))
            i = self.parent.get(i)
        return '/'.join(reversed(names))

    def ancestors(self, i):
        out = []
        while i in self.parent:
            i = self.parent[i]
            out.append(i)
        return out

    # ---- geometry
    def mesh_nodes(self):
        seen = []

        def walk(i):
            if 'mesh' in self.nodes[i]:
                seen.append(i)
            for c in self.nodes[i].get('children', []):
                walk(c)
        for r in self.roots:
            walk(r)
        return seen

    def primitives(self, i, M):
        """The node's triangle primitives in world space under M: dicts P (n,3), N (n,3), UV (n,2)|None,
        I (m,3) int, material index (or None)."""
        out = []
        if abs(np.linalg.det(M[:3, :3])) < 1e-12:
            return out  # scaled to nothing (a hidden alternative)
        nm = np.linalg.inv(M[:3, :3]).T
        for pr in self.j['meshes'][self.nodes[i]['mesh']]['primitives']:
            if pr.get('mode', 4) != 4:
                continue
            at = pr['attributes']
            P = self.accessor(at['POSITION']).astype(np.float64)
            P = P @ M[:3, :3].T + M[:3, 3]
            if 'NORMAL' in at:
                N = self.accessor(at['NORMAL']).astype(np.float64) @ nm.T
            else:
                N = None
            UV = self.accessor(at['TEXCOORD_0']).astype(np.float64) if 'TEXCOORD_0' in at else None
            I = (self.accessor(pr['indices'])[:, 0].astype(np.int64) if 'indices' in pr else np.arange(len(P))).reshape(-1, 3)
            if np.linalg.det(M[:3, :3]) < 0:
                I = I[:, [0, 2, 1]]
            if N is None:
                N = vertex_normals(P, I)
            l = np.linalg.norm(N, axis=1, keepdims=True)
            N = N / np.where(l > 0, l, 1)
            out.append({'P': P, 'N': N, 'UV': UV, 'I': I, 'material': pr.get('material')})
        return out


def vertex_normals(P, I):
    N = np.zeros_like(P)
    f = np.cross(P[I[:, 1]] - P[I[:, 0]], P[I[:, 2]] - P[I[:, 0]])
    for k in range(3):
        np.add.at(N, I[:, k], f)
    return N


def to_game(P, N, I, origin, port_plus_x=True):
    """Model positions / normals / triangles to the game's frame (+X starboard), metres from `origin`
    (the type's centre of gravity, model frame)."""
    s = -1.0 if port_plus_x else 1.0
    P = (P - np.asarray(origin)) * np.array([s, 1, 1])
    N = N * np.array([s, 1, 1])
    if s < 0:
        I = I[:, [0, 2, 1]]
    return P, N, I
