# Crew figures for the interior view, made from a rigged human model:
#   CesiumMan (c) 2017 Cesium, CC BY 4.0, from KhronosGroup/glTF-Sample-Assets
#   (Models/CesiumMan/glTF-Binary/CesiumMan.glb). The skinned mesh is posed here on the CPU
#   (seated at the controls; the loader standing with a round), the cartoon-sized head is brought
#   to a man's proportions, the textured suit is dropped (it carries the Cesium logo) and each
#   triangle is tagged as uniform / trousers / boots / skin / helmet so the game can colour it.
#   pip install numpy pillow
#   curl -O https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CesiumMan/glTF-Binary/CesiumMan.glb
#   python3 crew-prep.py ../assets/crew_model.json      (add --preview for PNG previews)
import json, base64, math, sys
import numpy as np
from glb import load  # tools/glb.py
from PIL import Image, ImageDraw

j, acc = load('CesiumMan.glb')
sk = j['skins'][0]
ibm = acc(sk['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
pivot = np.array([np.linalg.inv(m)[:3, 3] for m in ibm])
names = [j['nodes'][ji]['name'] for ji in sk['joints']]
idx = {n: i for i, n in enumerate(names)}
# parent of each skin joint (through the node tree)
node_parent = {}
for ni, n in enumerate(j['nodes']):
    for c in n.get('children', []):
        node_parent[c] = ni
parent = []
for ji in sk['joints']:
    p = node_parent.get(ji)
    parent.append(sk['joints'].index(p) if p in sk['joints'] else -1)

prim = j['meshes'][0]['primitives'][0]
P = acc(prim['attributes']['POSITION'])
N = acc(prim['attributes']['NORMAL'])
J = acc(prim['attributes']['JOINTS_0']).astype(int)
W = acc(prim['attributes']['WEIGHTS_0'])
I = acc(prim['indices']).astype(int).reshape(-1, 3)
dom = J[np.arange(len(J)), W.argmax(1)]

def rx(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
def ry(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
def rz(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
D = math.radians

def pose_mats(spec):
    """spec: joint name -> 3x3 (rest-frame rotation/scale about the joint's pivot)."""
    T = [None] * len(names)
    def get(k):
        if T[k] is not None:
            return T[k]
        A = np.eye(4)
        R = spec.get(names[k])
        if R is not None:
            p = pivot[k]
            A[:3, :3] = R
            A[:3, 3] = p - R @ p
        T[k] = (get(parent[k]) @ A) if parent[k] >= 0 else A
        return T[k]
    for k in range(len(names)):
        get(k)
    return np.array(T)

def skin(T):
    Ph = np.c_[P, np.ones(len(P))]
    out = np.zeros_like(P)
    nout = np.zeros_like(N)
    for c in range(4):
        M = T[J[:, c]]
        w = W[:, c][:, None]
        out += w * np.einsum('nij,nj->ni', M, Ph)[:, :3]
        nout += w * np.einsum('nij,nj->ni', M[:, :3, :3], N)
    nout /= np.linalg.norm(nout, axis=1, keepdims=True) + 1e-12
    return out, nout

HEAD = rz(0) * 0.64  # the model's head is cartoon-sized: bring it to a man's proportions

def arms(shoulder_fwd, elbow, spread=55, inward=0):
    # mesh frame: +x forward, +y left, +z up. The rest pose holds the arms out in an A.
    return {
        'Skeleton_arm_joint_L__4_': rz(D(-inward)) @ ry(D(-shoulder_fwd)) @ rx(D(-spread)),
        'Skeleton_arm_joint_R': rz(D(inward)) @ ry(D(-shoulder_fwd)) @ rx(D(spread)),
        'Skeleton_arm_joint_L__3_': ry(D(-elbow)),
        'Skeleton_arm_joint_R__2_': ry(D(-elbow)),
    }

POSES = {
    'seated': {
        **arms(34, 58, 62, 26),
        'Skeleton_neck_joint_2': HEAD,
        'Skeleton_torso_joint_2': ry(D(6)),
        'leg_joint_L_1': ry(D(-88)) @ rx(D(-4)),
        'leg_joint_R_1': ry(D(-88)) @ rx(D(4)),
        'leg_joint_L_2': ry(D(80)),
        'leg_joint_R_2': ry(D(80)),
        'leg_joint_L_3': ry(D(8)),
        'leg_joint_R_3': ry(D(8)),
    },
    'standing': {
        **arms(62, 48, 60, 24),
        'Skeleton_neck_joint_2': HEAD,
        'Skeleton_torso_joint_2': ry(D(-4)),
        'leg_joint_L_1': rx(D(-4)) @ ry(D(-6)),
        'leg_joint_R_1': rx(D(4)) @ ry(D(4)),
        'leg_joint_L_2': ry(D(10)),
        'leg_joint_R_2': ry(D(4)),
    },
}

# parts: 0 uniform, 1 trousers, 2 boots, 3 skin, 4 helmet, 5 belt
part = np.zeros(len(P), dtype=np.uint8)
part[np.isin(dom, [idx[n] for n in ['leg_joint_L_1', 'leg_joint_R_1', 'leg_joint_L_2', 'leg_joint_R_2']])] = 1
part[np.isin(dom, [idx[n] for n in ['leg_joint_L_3', 'leg_joint_R_3', 'leg_joint_L_5', 'leg_joint_R_5']])] = 2
head = dom == idx['Skeleton_neck_joint_2']
part[head] = 3
# padded tank helmet over the top and back of the head, earphones at the sides
hp = pivot[idx['Skeleton_neck_joint_2']]
rel = P - hp
part[head & ((rel[:, 2] > 0.17) | ((rel[:, 0] < -0.02) & (rel[:, 2] > 0.06)) | ((np.abs(rel[:, 1]) > 0.115) & (rel[:, 2] > 0.06)))] = 4
for wrist, elbow in [('Skeleton_arm_joint_L__2_', 'Skeleton_arm_joint_L__3_'), ('Skeleton_arm_joint_R__3_', 'Skeleton_arm_joint_R__2_')]:
    e, w = pivot[idx[elbow]], pivot[idx[wrist]]
    axis = (w - e) / np.linalg.norm(w - e)
    t = (P - e) @ axis / np.linalg.norm(w - e)
    part[(dom == idx[wrist]) & (t > 1.02)] = 3

tri_part = np.array([np.bincount(part[t], minlength=6).argmax() for t in I], dtype=np.uint8)

def to_game(v):
    # game frame: +X right, +Y up, +Z forward
    return np.c_[-v[:, 1], v[:, 2], v[:, 0]]

out = {'parts': None, 'index': None, 'poses': {}}
SCALE = None
for name, spec in POSES.items():
    T = pose_mats(spec)
    pos, nor = skin(T)
    g = to_game(pos)
    gn = to_game(nor)
    if SCALE is None:
        # standing height 1.75 m measured on the rest pose with the smaller head
        rest, _ = skin(pose_mats({'Skeleton_neck_joint_2': HEAD}))
        h = rest[:, 2].max() - rest[:, 2].min()
        SCALE = 1.75 / h
        chest = (pivot[idx['Skeleton_torso_joint_2']] + pivot[idx['torso_joint_3']]) / 2
        CHEST = to_game(chest[None])[0]
        print('rest height', h, 'scale', SCALE)
    g = (g - CHEST) * SCALE
    if name == 'seated':
        g[:, 1] += 0.06  # seat height: feet on the floor the old figures stood on
    # a little more breadth through the chest and shoulders (the model is slight)
    g[:, 0] *= 1.12
    out['poses'][name] = {'pos': g, 'nor': gn}
    print(name, 'bounds', g.min(0).round(2), g.max(0).round(2))

def render(g, n, fname, yaw):
    import math as m
    im = Image.new('RGB', (300, 420), (40, 44, 38))
    d = ImageDraw.Draw(im)
    c, sn = m.cos(yaw), m.sin(yaw)
    # camera on a circle round the man, looking at him; yaw 0 = in front of him
    X = g[:, 0] * c - g[:, 2] * sn
    Z = g[:, 0] * sn + g[:, 2] * c  # towards the camera
    X = -X
    Y = g[:, 1]
    nx = -(n[:, 0] * c - n[:, 2] * sn); nz = n[:, 0] * sn + n[:, 2] * c
    sx = lambda x: 150 + x * 200
    sy = lambda y: 270 - y * 200
    cols = {0: (90, 100, 70), 1: (60, 66, 50), 2: (30, 26, 22), 3: (200, 155, 120), 4: (45, 38, 30), 5: (25, 25, 25)}
    order = np.argsort(Z[I].mean(1))
    L = np.array([0.4, 0.6, 0.7]); L /= np.linalg.norm(L)
    for t in order:
        a, b, cc = I[t]
        nn = np.array([nx[a] + nx[b] + nx[cc], n[a, 1] + n[b, 1] + n[cc, 1], nz[a] + nz[b] + nz[cc]]); nn /= np.linalg.norm(nn) + 1e-9
        if nn[2] < -0.05: continue
        k = 0.45 + 0.55 * max(0, nn @ L)
        col = tuple(int(v * k) for v in cols[int(tri_part[t])])
        d.polygon([(sx(X[a]), sy(Y[a])), (sx(X[b]), sy(Y[b])), (sx(X[cc]), sy(Y[cc]))], fill=col)
    im.save(fname)

PREVIEW = '--preview' in sys.argv
for name, v in out['poses'].items():
    if not PREVIEW: break
    for k, yaw in enumerate([0.0, 1.5708, 0.7]):
        render(v['pos'], v['nor'], f'prev_{name}_{k}.png', yaw)

if len(sys.argv) > 1 and not sys.argv[1].startswith('--'):
    enc = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
    data = {
        'source': 'CesiumMan (c) 2017 Cesium, CC BY 4.0 -- glTF-Sample-Assets; reposed, head rescaled, recoloured',
        'parts': ['uniform', 'trousers', 'boots', 'skin', 'helmet', 'belt'],
        'part': enc(tri_part),
        'index': enc(I.reshape(-1).astype(np.uint16)),
        'poses': {k: {'pos': enc(np.round(v['pos'] * 1000).astype(np.int16)), 'nor': enc(np.round(v['nor'] * 127).astype(np.int8))} for k, v in out['poses'].items()},
        'vertices': int(len(P)),
    }
    json.dump(data, open(sys.argv[1], 'w'))
    print('wrote', sys.argv[1])
