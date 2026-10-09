"""Derive physical folding armor directly from the authored upper-board faces."""
import copy
import math


def _sub(a, b):
    return [x-y for x, y in zip(a, b)]


def _dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def _unit(a):
    length = math.sqrt(_dot(a, a))
    return [x/length for x in a]


def _cross(a, b):
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]


def _vec(a):
    return dict(zip('xyz', [round(x, 7) for x in a]))


def _triangle_plate(board, index, triangle, corners):
    # Triangles preserve the exact outline even when a corner-cut board is not
    # quite planar. No enclosing rectangle can protect the adjacent empty gap.
    u = _unit(_sub(corners[1], corners[0]))
    normal = _unit(_cross(u, _sub(corners[2], corners[0])))
    center = [sum(p[k] for p in corners)/3 for k in range(3)]
    outward = [center[0], 0, center[2]+1.4]
    if _dot(normal, outward) < 0:
        normal = [-x for x in normal]
    v = _cross(normal, u)
    polygon = [[_dot(_sub(p, center), u), _dot(_sub(p, center), v)] for p in corners]
    zone = 'hull_side' if abs(normal[0]) > .5 else 'hull_rear' if normal[2] < 0 else 'hull_upper_front'
    return {'id': f'flap_board_{index}_tri_{triangle}', 'zone': zone,
            'material': 'rha', 'thickness_mm': 10,
            'center': _vec(center), 'normal': _vec(normal), 'axis_u': _vec(u),
            'half_u': round(max(abs(p[0]) for p in polygon)+.000001, 7),
            'half_v': round(max(abs(p[1]) for p in polygon)+.000001, 7),
            'polygon': [[round(x, 7) for x in p] for p in polygon],
            'hinge': copy.deepcopy(board['hinge'])}


def apply_flak38t_folding_armor(spec):
    if spec['id'] != 'de_flakpz38t' or spec.get('model'):
        return spec
    boards = [p for p in spec['parts'] if p.get('name', '').startswith('flak38t_upper_board_')]
    if len(boards) != 8:
        raise ValueError('derive folding armor after the eight board clearance stops')
    plates = [p for p in spec['plates'] if not p['id'].startswith('flap_')]
    for i, board in enumerate(boards):
        face = board['faces'][0]
        if len(face) != 4:
            raise ValueError('original folding boards require quadrilateral faces')
        # Match geo.js's convex ear clipping (first ear at vertex zero).
        for k, triangle in enumerate(((face[3], face[0], face[1]), (face[1], face[2], face[3]))):
            corners = [board['vertices'][j] for j in triangle]
            plates.append(_triangle_plate(board, i, k, corners))
    spec['plates'] = plates
    return spec
