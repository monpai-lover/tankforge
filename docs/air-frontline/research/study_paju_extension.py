#!/usr/bin/env python3
"""Reproduce the selected authored expansion alternative from the cached native DSM.

The selected candidate came from a local screening search; retaining the snapshot
and explicit parameters lets later terrain/road/aircraft checks reject it.
"""
import json
import math
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from survey_airfields import profile, TO_METRIC, TO_GEO

HERE=Path(__file__).resolve().parent


def main():
    base=json.loads((HERE/'korea-airfield-native-study.json').read_text())
    field=next(f for f in base['fields'] if f['id']=='B-W')
    terrain=np.load(HERE/'airfield-B-W-native-dem.npz')['elevation']
    meta=json.loads((HERE/'airfield-B-W-native-dem.json').read_text())
    original=np.array(TO_METRIC.transform(*field['runwayCentreLonLat']))
    centre=original+[-150,750];alternative=profile(terrain,meta,centre,165,2600)
    report={'purpose':'Authored Paju/B-W expansion candidate for the fictional game map; terrain screening only',
        'originalSite':'RKRP','originalStudy':{'centreLonLat':field['runwayCentreLonLat'],'profile':field['profiles'][2]},
        'alternative':{'centreLonLat':list(TO_GEO.transform(*centre)),
            'offsetEastNorthMeters':[-150,750],'gridBearingDegrees':165,'lengthMeters':2600,'profile':alternative},
        'selectionMethod':'Native DSM search within 750m of the published strip midpoint, bearings 130–190 degrees at 5-degree steps; the selected candidate reduces surface variation/local slope with a displacement penalty. No optimality or buildability proof.',
        'originalRunwayTreatment':'Keep the real airport reference and author revised runway/taxiway connections as campaign expansion. Existing pavement is not assumed to be an existing 2600m runway.',
        'remaining':['Water/road/building footprints, grading and apron/taxiway connections',
                     'Both approach directions and actual aircraft/loadout trial runs'],
        'attribution':base['attribution']}
    (HERE/'paju-runway-alternative.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    fig,axes=plt.subplots(1,2,figsize=(13,5),layout='constrained');b=meta['boundsMeters']
    axes[0].imshow(terrain,extent=[b[0],b[2],b[1],b[3]],cmap='gist_earth',vmin=0,vmax=180,origin='upper')
    for c,bearing,color,label in [(original,field['profiles'][2]['gridBearingDegrees'],'#ffba47','Original-axis extension'),
                                  (centre,165,'#7df3ff','Authored alternative')]:
        a=math.radians(bearing);v=np.array([math.sin(a),math.cos(a)])*1300;q=np.array([c-v,c+v])
        axes[0].plot(q[:,0],q[:,1],color=color,lw=2,label=label)
    axes[0].set_xlim(original[0]-2500,original[0]+2500);axes[0].set_ylim(original[1]-2500,original[1]+2500)
    axes[0].set(title='B-W native DSM around airport candidate',xlabel='UTM easting (m)',ylabel='UTM northing (m)');axes[0].legend(fontsize=8)
    for p,color,label in [(field['profiles'][2],'#d48400','Original-axis extension'),(alternative,'#007b94','Authored alternative')]:
        axes[1].plot(np.array(p['distanceMeters'])/1000,p['surfaceElevationMeters'],color=color,label=label)
    axes[1].set(title='Different study corridors: DSM profiles',xlabel='Distance from each corridor centre (km)',ylabel='DSM surface elevation (m)');axes[1].legend(fontsize=8);axes[1].grid(alpha=.2)
    fig.text(.01,.003,base['attribution'],fontsize=4.8)
    fig.savefig(HERE/'paju-runway-alternative.png',dpi=140);plt.close(fig)


if __name__=='__main__':main()
