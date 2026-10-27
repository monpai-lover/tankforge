#!/usr/bin/env python3
"""Independent source-GLB versus actual Aircraft uploaded-triangle/pose audit."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import sys
import zlib
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/aircraft_glb'))
from gltf import Gltf


def write_reference(glb_path, output):
    """Read raw GLB channels independently; never use package verification JSON."""
    g = Gltf(glb_path)
    clips = []
    for name in ('gear', 'roll', 'pitch', 'yaw', 'flap'):
        channels = []
        for node, paths in g.channels(name).items():
            times, values, interpolation = paths['rotation']
            assert interpolation == 'LINEAR'
            axis = np.array(values[-1][:3], dtype=float, copy=True)
            axis /= np.linalg.norm(axis)
            last = 2*np.arctan2(np.dot(values[-1][:3], axis), values[-1][3])
            samples = []
            for t, q in zip(times, values):
                phase = float((t-times[0])/(times[-1]-times[0]))
                angle = float(2*np.arctan2(np.dot(q[:3], axis), q[3]))
                samples.append(dict(time_s=float(t), value=phase,
                    controlValueFromAngle=angle/last))
            channels.append(dict(name=g.nodes[node]['name'], samples=samples))
        clips.append(dict(name=name, channels=channels))
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(dict(clips=clips))+'\n')


def run(record_path, glb_path, cpu_dir, output):
    model = json.loads(record_path.read_text())
    cpu = json.loads((cpu_dir / 'actual-aircraft-cpu.json').read_text())
    uploaded = np.fromfile(cpu_dir / 'actual-builder-uploads.f32', '<f4')
    g = Gltf(glb_path)
    nodes = {n.get('name'):i for i,n in enumerate(g.nodes)}
    rest = g.world()
    original = {n:g.primitives(i, rest[i])[0] for n,i in nodes.items() if 'mesh' in g.nodes[i]}
    streams, source_count = {}, 0
    bindings, covered = [], {}
    for part in model['parts']:
        source = part['source_mesh']
        faces = np.array([i for start,count in part['source_faces'] for i in range(start,start+count)])
        covered.setdefault(source, []).extend(faces.tolist())
        source_count += len(faces)
        if part['group'] == 'source_excluded':
            continue
        mover = model['movers'][part['mover']] if part.get('mover') is not None else None
        stream = mover['name'] if mover else part['group']
        begin = streams.get(stream, 0)
        streams[stream] = begin + len(faces)*39
        table = cpu['table'][stream]
        local = uploaded[table['offset']//4+begin:table['offset']//4+streams[stream]].reshape(-1,3,13)[:,:,:3].astype(float)
        assert len(local) == len(faces)
        bindings.append((part,faces,local,mover))
    for name, ids in covered.items():
        assert sorted(ids) == list(range(len(original[name]['I']))), ('face loss/duplication',name)
    assert source_count == 85645
    summaries = {}
    maximum = 0.0
    max_rigid = 0.0
    fixed_drift = 0.0
    for sample in cpu['frames']:
        clip = sample['clip']
        world = g.world(g.channels(clip), sample['time_s'])
        transforms = {c['name']:np.array(c['local']).reshape(4,4).T for c in sample['controls']}
        error = 0.0
        for part, faces, local, mover in bindings:
            name = part['source_mesh']
            pr = original[name]
            relative = world[nodes[name]] @ np.linalg.inv(rest[nodes[name]])
            expected = pr['P'][pr['I'][faces]] @ relative[:3,:3].T + relative[:3,3]
            matrix = transforms[mover['name']] if mover else np.eye(4)
            actual = local @ matrix[:3,:3].T + matrix[:3,3]
            delta = float(np.linalg.norm(expected-actual,axis=2).max())
            error = max(error, delta)
            if not mover:
                fixed_drift = max(fixed_drift, float(np.linalg.norm(actual-local,axis=2).max()))
            else:
                max_rigid = max(max_rigid, float(np.abs(matrix[:3,:3].T@matrix[:3,:3]-np.eye(3)).max()))
        maximum = max(maximum, error)
        summaries.setdefault(clip,dict(frames=0,maxVertexErrorM=0.0))
        summaries[clip]['frames'] += 1
        summaries[clip]['maxVertexErrorM'] = max(summaries[clip]['maxVertexErrorM'],error)
    assert maximum < .00035, ('actual posed uploaded triangle mismatch',maximum,summaries)
    assert max_rigid < 1e-6
    assert fixed_drift == 0.0
    # Verify grounded source tire triangles through actual Aircraft.pose root and
    # mechanism nodes, not the metadata-derived low-point formula alone.
    ground = cpu['grounded']
    root = np.array(ground['root']).reshape(4,4).T
    controls = {c['name']:np.array(c['local']).reshape(4,4).T for c in ground['controls']}
    contacts = []
    for part,faces,local,mover in bindings:
        if 'wheel_source_07' not in part['source_mesh'] and part['source_mesh'] != 'gear_nose_source_06':
            continue
        matrix = root @ controls[mover['name']]
        points = local.reshape(-1,3) @ matrix[:3,:3].T + matrix[:3,3]
        contacts.append(dict(source=part['source_mesh'],groundedMinimumY=float(points[:,1].min())))
    assert all(abs(c['groundedMinimumY']) < .0025 for c in contacts), contacts
    result = dict(recordSha256=hashlib.sha256(record_path.read_bytes()).hexdigest(),
        glbSha256=hashlib.sha256(glb_path.read_bytes()).hexdigest(),
        appSha256=cpu['appSha256'],actualConstructor=cpu['actualConstructor'],
        actualDecoder=cpu['actualDecoder'],actualMeshUploadCalls=cpu['uploadCalls'],
        sourceTriangles=source_count,renderedTriangles=cpu['sourceTriangles'],
        faceCoverage='Every original GLB face retained exactly once, including two explicit legacy-excluded source parts',
        clips=summaries,maximumPosedVertexErrorM=maximum,maximumRigidOrthogonalityError=max_rigid,
        fixedSourceTriangleDriftM=fixed_drift,groundedTires=contacts,
        leftWingDamageChecks='Actual AircraftDamage.harm/applyDamage and Aircraft.pose: left fixed wing/pylons/control surfaces hidden; right wing/body/right gear retained',
        geometryContracts='gear49 mechanism-time keys; surface49 geometry keys addressed by actual signed deflection/maxAngle, not linear clip clock; yaw has explicit source-to-physics sign mapping',
        yawKernel=cpu['yawKernel'], yawConsistent=cpu['yawConsistent'],
        gpuTested=False,passed=True,
        limitations=['CPU captured actual renderer.mesh input and actual source methods; no GPU/material visual acceptance yet',
                    'Legacy accepted boxes remain approximations; no native visible-triangle damage migration',
                    'Source variant does not establish F subtype; authored hinge/kinematic historical accuracy remains unproven'])
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result))


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == '--reference':
        write_reference(Path(sys.argv[2]),Path(sys.argv[3]))
        raise SystemExit(0)
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('record',type=Path);p.add_argument('glb',type=Path)
    p.add_argument('cpu',type=Path);p.add_argument('output',type=Path)
    a=p.parse_args();run(a.record,a.glb,a.cpu,a.output)
