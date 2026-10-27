#!/usr/bin/env python3
"""Independent source-GLB/native-v2 indexed-triangle and pose audit, CPU only.

This verifies the codec/rig mathematically. The separate real Aircraft-class
probe is required before calling the production renderer integration verified.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import sys
import zipfile
import zlib

import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools' / 'aircraft_glb'))
from gltf import Gltf, quat_matrix, slerp
from import_me262_game_v2 import repair_nose_doors, ZIP_SHA, VARIANTS


def sha(b): return hashlib.sha256(b).hexdigest()


def sample(poses, v):
    k = max(0, min(len(poses)-2, int(np.searchsorted([p[0] for p in poses], v, side='left')-1)))
    a, b = poses[k:k+2]; t = np.clip((v-a[0])/(b[0]-a[0]), 0, 1)
    R = ((1-t)*np.array(a[3])+t*np.array(b[3])).reshape(3,3) if len(a)>3 and len(b)>3 else quat_matrix(slerp(a[1],b[1],t))
    return R, (1-t)*np.array(a[2])+t*np.array(b[2])


def matrices(record, values):
    world = {}; movers=record['movers']
    def at(k):
        if k in world:return world[k]
        m=movers[k];R,p=sample(m['poses'],values.get(m['param'],1 if m['param'].startswith('gear_') else 0))
        M=np.eye(4);M[:3,:3]=R
        par=m.get('parent');M[:3,3]=p-(np.array(movers[par]['p']) if par is not None else 0)
        world[k]=at(par)@M if par is not None else M
        return world[k]
    for k in range(len(movers)):at(k)
    return world


def run(record_path, source_path, actual_dir=None):
    r=json.loads(record_path.read_text());g=Gltf(source_path);W0=g.world();cg=np.array(r['cg_in_model']);S=np.diag([-1,1,1])
    blob=zlib.decompress(base64.b64decode(r['blob'])); repaired,door=repair_nose_doors(g)
    parts=[];base_max=0;covered={};errors=[]
    for p in r['parts']:
        i,j=p['source_node'],p['source_primitive'];pr=g.primitives(i,W0[i])[j]
        ids=np.concatenate([np.arange(a,a+n) for a,n in p['source_faces']])
        covered.setdefault((i,j),[]).extend(ids.tolist())
        I=np.frombuffer(blob,'<u2',p['triangles']*3,p['idx']).reshape(-1,3)
        P=np.frombuffer(blob,'<i2',p['vertices']*3,p['pos']).reshape(-1,3)*r['posScale']
        actual=P[I]; reference=(repaired[i][0] if i in repaired else pr['P']).copy()
        calibration=r['spec'].get('opticsCalibration')
        if calibration and g.nodes[i].get('name','').startswith('REVI_'):
            if g.nodes[i]['name']=='REVI_InstrumentMount' and calibration.get('sourceMountAdaptation'):
                adaptation=calibration['sourceMountAdaptation']
                reference=np.asarray(adaptation['adapted_before_assembly_positions'])
            reference+=np.asarray(calibration['assemblyOffset'])@S
        source=reference[pr['I'][ids][:,[0,2,1]]]
        expected=(source-cg)@S
        err=float(np.linalg.norm(actual-expected,axis=2).max());base_max=max(base_max,err)
        parts.append((p,actual,source))
    for i in g.mesh_nodes():
        for j,pr in enumerate(g.primitives(i,W0[i])):
            assert sorted(covered[(i,j)])==list(range(len(pr['I']))),(i,j,'missing/duplicate source face')
    clips={a['name']:g.channels(a['name']) for a in g.j['animations']}
    source_param={c:('flap' if c=='flaps' else 'slat' if c=='slats' else c) for c in clips}
    frames=[]
    # Independent-axis source clips exercise every original mover (including
    # affine actuator scale and nested fork/wheel transforms). Combined clips
    # are verified below by source-node phase inversion.
    canonical=['gear_main','gear_nose','gear_main_doors','gear_nose_door','roll','pitch','yaw','flaps','slats','canopy','wheel_spin']
    phase_names={'gear_main':'CTRL_Gear_Main_L','gear_nose':'CTRL_Gear_Nose',
                 'gear_main_doors':'CTRL_GearBellyDoor_L','gear_nose_door':'CTRL_NoseLongDoor'}
    names={n.get('name'):i for i,n in enumerate(g.nodes)}
    def angle(q):return float(2*np.arctan2(np.linalg.norm(q[:3]),abs(q[3])))
    def combined_values(ch,t):
        out={}
        for param,node in phase_names.items():
            i=names[node];axis_ch=clips[param][i]['rotation'];ts,qs,_=axis_ch
            # Recover the source normalized mechanism phase, never infer from
            # flight-gear scalar. Fixed rest parent means local rotations suffice.
            M=g.local_at(i,ch,t);R=M[:3,:3]
            a=np.arccos(np.clip((np.trace(R)-1)/2,-1,1))
            aa=np.array([angle(q) for q in qs]);order=np.argsort(aa)
            out[param]=float(np.interp(a,aa[order],ts[order]/g.duration(param)))
        return out
    for clip in canonical+['gear_extend','gear_retract','gear_cycle']:
        ch=clips[clip];times=np.linspace(0,g.duration(clip),49);maximum=0;worst=None
        for t in times:
            if clip.startswith('gear_') and clip not in canonical:
                values=combined_values(ch,float(t))
            else:
                value=float(t/g.duration(clip));param=source_param[clip]
                values={param:value*2-1 if param in ('roll','pitch','yaw') else value}
            worlds=matrices(r,values);W=g.world(ch,float(t));frame_max=0
            for p,actual,source in parts:
                if p.get('mover') is None:
                    continue
                k=p['mover'];M=worlds[k];actual=(actual-np.array(r['movers'][k]['p']))@M[:3,:3].T+M[:3,3]
                i=p['source_node'];D=W[i]@np.linalg.inv(W0[i]);expected=((source@D[:3,:3].T+D[:3,3])-cg)@S
                error=float(np.linalg.norm(actual-expected,axis=2).max());frame_max=max(frame_max,error)
                if error>maximum:maximum=error;worst=dict(part=p['name'],time=float(t))
            frames.append(dict(clip=clip,time=float(t),values=values,maximum_triangle_vertex_error_m=frame_max))
        errors.append(dict(clip=clip,samples=49,maximum_triangle_vertex_error_m=maximum,worst=worst))
    # Quaternion+affine interpolation is exact at the source keys; between keys
    # the affine matrices interpolate linearly, with a measured bounded error.
    assert base_max<.00029,base_max
    assert max(e['maximum_triangle_vertex_error_m'] for e in errors)<.004,errors
    actual_evidence=None
    if actual_dir:
        info=json.loads((actual_dir/r['type']/'actual-aircraft-cpu.json').read_text())
        assert info['recordSha256']==sha(record_path.read_bytes())
        raw=np.fromfile(actual_dir/r['type']/'actual-builder-uploads.f32','<f4')
        by_name={p['name']:(p,native,source) for p,native,source in parts}
        geometry={};actual_bind_max=0
        for item in info['table']:
            a=raw[item['offset']//4:(item['offset']//4)+item['floats']].reshape(-1,13)[:,:3].reshape(-1,3,3).astype(float)
            expected=np.concatenate([(source-cg)@S for p,_,source in [by_name[n] for n in item['parts']]])
            if item['mover'] is not None:expected-=np.asarray(r['movers'][item['mover']]['p'])
            elif item.get('origin') is not None:expected-=np.asarray(item['origin'])
            assert a.shape==expected.shape,(item['name'],a.shape,expected.shape)
            actual_bind_max=max(actual_bind_max,float(np.linalg.norm(a-expected,axis=2).max()))
            geometry[item['name']]=(item,a)
        def control_world(frame):
            out={};cc=frame['controls']
            def at(k):
                if k not in out:
                    M=np.asarray(cc[k]['local']).reshape(4,4).T
                    out[k]=at(cc[k]['parent'])@M if cc[k]['parent'] is not None else M
                return out[k]
            for k in range(len(cc)):at(k)
            return out
        actual_clips={}
        for frame in info['frames']:
            W=g.world(clips[frame['clip']],frame['time']);matrices_actual=control_world(frame);maximum=0
            for name,(item,a) in geometry.items():
                if item['mover'] is None:continue
                k=int(name.split(':')[1]);M=matrices_actual[k]
                actual=a@M[:3,:3].T+M[:3,3]
                expected=[]
                for pname in item['parts']:
                    p,_,source=by_name[pname];i=p['source_node']
                    sample_W=W
                    if frame['clip']=='wheel_spin' and p.get('mover') is not None and str(p['mover']) in frame.get('wheelPhaseByMover',{}):
                        sample_W=g.world(clips['wheel_spin'],frame['wheelPhaseByMover'][str(p['mover'])]*g.duration('wheel_spin'))
                    D=sample_W[i]@np.linalg.inv(W0[i])
                    expected.append((source@D[:3,:3].T+D[:3,3]-cg)@S)
                expected=np.concatenate(expected)
                maximum=max(maximum,float(np.linalg.norm(actual-expected,axis=2).max()))
            actual_clips[frame['clip']]=max(actual_clips.get(frame['clip'],0),maximum)
        assert actual_bind_max<.00029
        assert max(actual_clips.values())<.004,actual_clips
        grounded=info['grounded'];world=control_world(grounded);body=np.asarray(grounded['root']).reshape(4,4).T;contacts=[]
        for name,(item,a) in geometry.items():
            if not any(p.startswith('EXT_Wheel_') for p in item['parts']):continue
            k=int(name.split(':')[1]);M=body@world[k];P=a.reshape(-1,3)@M[:3,:3].T+M[:3,3]
            contacts.append(dict(name=name,minimum_world_y=float(P[:,1].min())))
        assert len(contacts)==3
        assert max(abs(c['minimum_world_y']) for c in contacts)<.002,contacts
        actual_evidence=dict(app_sha256=info['appSha256'],actual_decoder=True,actual_constructor=True,actual_pose=True,
            accepted_state_geometry_fixture=True,frames=len(info['frames']),constructor_triangles=info['constructorTriangles'],
            full_constructor_triangles=info.get('fullConstructorTriangles'),stores_mounts_excluded=info['storeMountIntegrationExcluded'],source_module_nodes=len(info['internal']),
            actual_gun_factory=info.get('gunFactory'),actual_stores=info.get('stores'),wing_loss=info.get('wingLoss'),
            actual_native_control_signs=info.get('kernelSigns'),
            bind_upload_error_m=actual_bind_max,clip_maximum_errors_m=actual_clips,wheel_contacts=contacts,passed=True)
    return dict(type=r['type'],record_sha256=sha(record_path.read_bytes()),source_sha256=sha(source_path.read_bytes()),
                source_face_coverage_exact=True,source_faces=sum(p['triangles'] for p in r['parts']),
                base_quantization_error_m=base_max,clips=errors,frames=frames,
                closed_door_surface_error_m=door['max_closed_surface_error_m'],
                actual_aircraft=actual_evidence,
                kind='independent native-matrix audit; not a substitute for actual Aircraft-class probe',passed=True)


def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('archive',type=Path);ap.add_argument('records',type=Path);ap.add_argument('--out',type=Path,required=True);ap.add_argument('--actual',type=Path)
    a=ap.parse_args();assert sha(a.archive.read_bytes())==ZIP_SHA
    results=[]
    import tempfile
    with tempfile.TemporaryDirectory(prefix='tf-me262-audit-') as td:
        with zipfile.ZipFile(a.archive) as z:
            for typ,(file,_,_) in VARIANTS.items():
                member=next(n for n in z.namelist() if n.endswith('/models/'+file));p=Path(td)/file;p.write_bytes(z.read(member))
                result=run(a.records/(typ+'.json'),p,a.actual);results.append(result)
                print(typ,'max',max(c['maximum_triangle_vertex_error_m'] for c in result['clips']))
    a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(dict(archive_sha256=ZIP_SHA,variants=results),indent=2)+'\n')


if __name__=='__main__':main()
