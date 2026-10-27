#!/usr/bin/env python3
"""Reconstruct test fixtures from the user's original and upgraded HTML files."""
import argparse,json
from pathlib import Path
HERE=Path(__file__).resolve().parent
def split(path):
    raw=path.read_bytes();marker=b'<script>(() => {'
    if raw.count(marker)!=1:raise ValueError('Runtime wrapper is not unique')
    return raw,raw[raw.index(marker):]
def main():
    p=argparse.ArgumentParser();p.add_argument('original',type=Path);p.add_argument('upgraded',type=Path);a=p.parse_args()
    raw,base=split(a.original);_,fixed=split(a.upgraded)
    tag=b'<script type="application/json" id="tf-data">';start=raw.index(tag)+len(tag);end=raw.index(b'</script>',start)
    data=json.loads(raw[start:end]);fixture={'provenance':'Extracted from local input HTML; no assets downloaded','models':data['aircraftModels'],'pilot':data.get('pilotModel')}
    (HERE/'site-live-current-app.html').write_bytes(base)
    (HERE/'all-interior/current-app-with-interiors.html').write_bytes(fixed)
    (HERE/'model-upgrade-app.html').write_bytes(fixed)
    (HERE/'mount-v3').mkdir(parents=True,exist_ok=True)
    (HERE/'mount-v3/app-fixed.html').write_bytes(fixed)
    (HERE/'mount-v3/store-models.json').write_text(json.dumps(data.get('storeModels',{}),separators=(',',':')))
    (HERE/'flight-ui').mkdir(parents=True,exist_ok=True)
    (HERE/'flight-ui/current-imported-models.json').write_text(json.dumps(fixture,separators=(',',':')))
    (HERE/'all-interior/current-catalog-fixture.json').write_text(json.dumps(fixture,separators=(',',':')))
    (HERE/'hardpoints/current-app-fixed.html').write_bytes(fixed)
    (HERE/'o-mode').mkdir(parents=True,exist_ok=True)
    (HERE/'o-mode/app-with-shell.html').write_bytes(fixed)
    sight=HERE/'me262-sight/fixtures';sight.mkdir(parents=True,exist_ok=True)
    for id in ['me262','me262a2a','me262u4']:
        (sight/(id+'.json')).write_text(json.dumps(data['aircraftModels'][id],separators=(',',':')))
    print('Prepared actual local aircraft fixtures. Run node --test perf/all-interior/all-interior.test.mjs and node perf/hardpoints/test.mjs from source/.')
if __name__=='__main__':main()
