#!/usr/bin/env python3
"""Replace explicitly pinned MiG17/F104 native values in a pinned document.

The frozen source is memory-mapped for bounded, zero-copy JSON scanning. Output
is copied in 1 MiB pieces, optionally straight to deterministic gzip; it never
creates an intermediate 378 MB data.line. All bytes outside the selected values
are preserved, including the other model records and all tank/media data.

Without --out this audits and hashes the virtual splice without writing it.
No input, tracked chunk, app, head, deployment or running process is modified.
"""

from __future__ import annotations

import argparse
import base64
import codecs
import contextlib
import gzip
import hashlib
import json
import math
import mmap
import os
from pathlib import Path
import re
import struct
import tempfile
import zlib

BASELINE = Path('/home/boyang/Desktop/worldbox/tankforge-jet-fixes/handoff/tests/out/parked-roll-f3c6d88-20261024/committed-data.line')
BASELINE_SHA = '56eaa206dfda19a831d1c82c869e411d1c3ba7e82d979ff6f96b13dd3a0366ee'
BASELINE_SIZE = 377797380
CHUNK = 1024 * 1024
WS = b' \t\r\n'
SPECIAL_STRING = re.compile(rb'["\\\x00-\x1f]')
NUMBER = re.compile(rb'-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?')
SCRIPT_TAG = re.compile(rb'<script\b[^>]{0,4096}>', re.I)


def digest_bytes(value):
    return hashlib.sha256(value).hexdigest()


def no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f'Duplicate JSON key: {key!r}')
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError(f'Non-JSON constant: {value}')


class JsonRanges:
    """Validate JSON grammar without materializing large strings or arrays."""

    def __init__(self, data):
        self.data, self.i = data, 0
        self.top, self.models = {}, {}

    def whitespace(self):
        while self.i < len(self.data) and self.data[self.i] in WS:
            self.i += 1

    def string(self, capture=False):
        start = self.i
        if self.data[start] != 34:
            raise ValueError(f'Expected JSON string at byte {start}')
        i = start + 1
        while True:
            match = SPECIAL_STRING.search(self.data, i)
            if not match:
                raise ValueError(f'Unterminated JSON string at byte {start}')
            i = match.start()
            char = self.data[i]
            if char == 34:
                self.i = i + 1
                return json.loads(self.data[start:self.i]) if capture else None
            if char != 92:
                raise ValueError(f'Unescaped control in JSON string at byte {i}')
            i += 1
            if i >= len(self.data):
                raise ValueError('Unterminated JSON escape')
            escape = self.data[i]
            if escape == 117:
                if not re.fullmatch(rb'[0-9a-fA-F]{4}', self.data[i+1:i+5]):
                    raise ValueError(f'Invalid Unicode escape at byte {i}')
                i += 5
            elif escape in b'"\\/bfnrt':
                i += 1
            else:
                raise ValueError(f'Invalid JSON escape at byte {i}')

    def value(self, path=None, depth=0):
        if depth > 128:
            raise ValueError('Unexpected JSON nesting beyond 128 levels')
        self.whitespace()
        if self.i >= len(self.data):
            raise ValueError('Unexpected JSON EOF')
        start, char = self.i, self.data[self.i]
        if char == 123:
            self.i += 1
            self.whitespace()
            seen = set() if path in ((), ('aircraftModels',)) else None
            if self.data[self.i:self.i+1] == b'}':
                self.i += 1
            else:
                while True:
                    key = self.string(capture=seen is not None)
                    if seen is not None:
                        if key in seen:
                            raise ValueError(f'Duplicate key {key!r} in {path}')
                        seen.add(key)
                    self.whitespace()
                    if self.data[self.i:self.i+1] != b':':
                        raise ValueError(f'Expected colon at byte {self.i}')
                    self.i += 1
                    child = (key,) if path == () else None
                    self.whitespace()
                    begin = self.i
                    self.value(child, depth + 1)
                    end = self.i
                    if path == ():
                        self.top[key] = (begin, end)
                    elif path == ('aircraftModels',):
                        self.models[key] = (begin, end)
                    self.whitespace()
                    token = self.data[self.i:self.i+1]
                    if token == b'}':
                        self.i += 1
                        break
                    if token != b',':
                        raise ValueError(f'Expected comma/object end at byte {self.i}')
                    self.i += 1
                    self.whitespace()
        elif char == 91:
            self.i += 1
            self.whitespace()
            if self.data[self.i:self.i+1] == b']':
                self.i += 1
            else:
                while True:
                    self.value(None, depth + 1)
                    self.whitespace()
                    token = self.data[self.i:self.i+1]
                    if token == b']':
                        self.i += 1
                        break
                    if token != b',':
                        raise ValueError(f'Expected comma/array end at byte {self.i}')
                    self.i += 1
        elif char == 34:
            self.string()
        else:
            match = NUMBER.match(self.data, self.i)
            if match:
                self.i = match.end()
            else:
                for literal in (b'true', b'false', b'null'):
                    if self.data[self.i:self.i+len(literal)] == literal:
                        self.i += len(literal)
                        break
                else:
                    raise ValueError(f'Invalid JSON value at byte {self.i}')
        return start, self.i

    def document(self, html=False):
        candidates = [match for match in SCRIPT_TAG.finditer(self.data)
                      if re.search(rb'\bid\s*=\s*([\'"])tf-data\1', match[0], re.I)]
        if len(candidates) != 1:
            raise ValueError('Expected exactly one bounded tf-data script opening tag')
        match = candidates[0]
        self.document_start = match.start()
        tag = match[0]
        if not html and self.data[:match.start()].strip(WS):
            raise ValueError('Unexpected bytes before tf-data script')
        if not re.search(rb'\btype\s*=\s*([\'"])application/json\1', tag, re.I):
            raise ValueError('Expected type="application/json"')
        self.i = match.end()
        self.whitespace()
        if self.data[self.i:self.i+1] != b'{':
            raise ValueError('tf-data must contain one JSON object')
        self.value(())
        self.whitespace()
        close = re.compile(rb'</script>', re.I).match(self.data, self.i)
        if not close or (not html and self.data[close.end():].strip(WS)):
            raise ValueError('tf-data has trailing bytes or more than one JSON value')
        self.document_end = close.end()
        if 'mig17f' not in self.models:
            raise ValueError('Expected exactly one aircraftModels.mig17f object')
        return self


def range_chunks(data, begin, end):
    for offset in range(begin, end, CHUNK):
        yield data[offset:min(offset + CHUNK, end)]


def range_sha(data, begin, end):
    h = hashlib.sha256()
    for piece in range_chunks(data, begin, end):
        h.update(piece)
    return h.hexdigest()


def file_chunks(path):
    with path.open('rb') as source:
        yield from iter(lambda: source.read(CHUNK), b'')


def native_record(path, expected_sha, expected_type='mig17f'):
    raw = path.read_bytes()
    if digest_bytes(raw) != expected_sha:
        raise ValueError('Native record SHA256 differs from the required --record-sha256')
    value = raw.strip(WS)
    record = json.loads(value, object_pairs_hook=no_duplicate_keys, parse_constant=reject_constant)
    if not isinstance(record, dict) or type(record.get('version')) is not int or record['version'] != 2 or record.get('type') != expected_type:
        raise ValueError(f'Native record must be version2/type {expected_type}')
    scale = record.get('posScale')
    if not isinstance(scale, (float, int)) or not math.isfinite(scale) or scale <= 0:
        raise ValueError('Expected a finite positive native posScale')
    if not isinstance(record.get('parts'), list) or not record['parts'] or not isinstance(record.get('movers'), list):
        raise ValueError('Expected native parts/movers arrays')
    if b'</script' in value.lower():
        raise ValueError('Native record contains an unsafe HTML script terminator')
    compressed = base64.b64decode(record['blob'], validate=True)
    inflater = zlib.decompressobj()
    buffer = inflater.decompress(compressed) + inflater.flush()
    if not inflater.eof or inflater.unused_data or inflater.unconsumed_tail:
        raise ValueError('Expected exactly one complete zlib native blob')
    for part in record['parts']:
        vertices, triangles = part['vertices'], part['triangles']
        if type(vertices) is not int or type(triangles) is not int or not 0 < vertices <= 65536 or triangles <= 0:
            raise ValueError('Invalid native part dimensions')
        for key, count, width in [('pos', vertices*3, 2), ('nor', vertices*3, 1), ('uv', vertices*2, 2), ('idx', triangles*3, 2)]:
            offset = part[key]
            if type(offset) is not int or offset < 0 or offset % width or offset + count*width > len(buffer):
                raise ValueError(f'Invalid native buffer range: {part["name"]}/{key}')
        if any(index[0] >= vertices for index in struct.iter_unpack('<H', buffer[part['idx']:part['idx']+triangles*6])):
            raise ValueError(f'Out-of-range native index in {part["name"]}')
        mover = part.get('mover')
        if mover is not None and (type(mover) is not int or not 0 <= mover < len(record['movers'])):
            raise ValueError('Invalid native mover reference')
    return value, {'inputBytes': len(raw), 'inputSha256': expected_sha, 'valueBytes': len(value),
                   'valueSha256': digest_bytes(value), 'version': 2, 'type': expected_type,
                   'parts': len(record['parts']), 'movers': len(record['movers']),
                   'inflatedBlobBytes': len(buffer), 'inflatedBlobSha256':digest_bytes(buffer),
                   'bufferRangesAndIndicesValid': True,
                   'outerWhitespaceOnlyTrimmed': len(raw) != len(value)}


def guard_app_core(old, new):
    """A local sight/radar app patch must preserve the accepted flight kernel."""
    pattern=re.compile(rb'\b(?:var|const|let)\s+FLIGHT_CORE_WASM\s*=\s*"([A-Za-z0-9+/=]+)"')
    before,after=pattern.findall(old),pattern.findall(new)
    if before!=after:
        raise ValueError('App override changed the embedded FLIGHT_CORE_WASM literal')
    return {'flightCoreLiteralCount':len(before),'flightCoreLiteralsUnchanged':True,
            'wasmSha256':[digest_bytes(base64.b64decode(value,validate=True))for value in before]}


def assemble(baseline, record=None, record_sha=None, *, output=None, format='data', head=None,
             app=None, gzip_level=6, expected_sha=BASELINE_SHA, expected_size=BASELINE_SIZE,
             source_html=False, embedded_sha=BASELINE_SHA, embedded_size=BASELINE_SIZE,
             old_metadata_output=None, records=None, app_override=None, old_app_sha=None,
             new_app_sha=None):
    """The pin override is test-only; CLI always enforces the actual frozen source."""
    baseline = Path(baseline).resolve()
    record_specs = dict(records or {})
    if record:
        if 'mig17f' in record_specs:
            raise ValueError('Duplicate mig17f replacement')
        record_specs['mig17f'] = (record,record_sha)
    if not record_specs or not set(record_specs) <= {'mig17f','f104g'}:
        raise ValueError('Specify only mig17f and/or f104g native replacements')
    record_specs = {key:(Path(path).resolve(),sha) for key,(path,sha) in record_specs.items()}
    record_paths = [path for path,sha in record_specs.values()]
    head = Path(head).resolve() if head else None
    app = Path(app).resolve() if app else None
    app_override = Path(app_override).resolve() if app_override else None
    output = Path(output).resolve() if output else None
    old_metadata_output = Path(old_metadata_output).resolve() if old_metadata_output else None
    html = format.startswith('html')
    wrap_html = html and not source_html
    compressed = format.endswith('-gzip')
    if wrap_html and (not head or not app):
        raise ValueError('HTML output requires explicit --head and --app source files')
    if (not html or source_html) and (head or app):
        raise ValueError('--head/--app are only meaningful with HTML format')
    if source_html and not html:
        raise ValueError('A live page source requires HTML output format')
    input_paths = [baseline,*record_paths,head,app,app_override]
    if output and (output in input_paths or output.exists()):
        raise ValueError('Output must be a new file distinct from every input')
    if old_metadata_output and (old_metadata_output in [*input_paths,output] or old_metadata_output.exists()):
        raise ValueError('Old metadata output must be a new file distinct from every input/output')
    if app_override and (not source_html or not old_app_sha or not new_app_sha):
        raise ValueError('App override requires a live page and both exact old/new app SHA256 guards')
    if not app_override and (old_app_sha or new_app_sha):
        raise ValueError('App SHA256 guards require --app-override')
    replacements = {key:native_record(path,sha,key) for key,(path,sha) in record_specs.items()}
    app_replacement = app_override.read_bytes() if app_override else None
    if app_override and digest_bytes(app_replacement) != new_app_sha:
        raise ValueError('App override SHA256 differs from --new-app-sha256')
    before = baseline.stat()
    if before.st_size != expected_size:
        raise ValueError(f'Frozen baseline size mismatch: {before.st_size} != {expected_size}')
    h = hashlib.sha256()
    utf8 = codecs.getincrementaldecoder('utf-8')()
    for piece in file_chunks(baseline):
        h.update(piece)
        utf8.decode(piece)
    utf8.decode(b'', final=True)
    if h.hexdigest() != expected_sha:
        raise ValueError('Frozen baseline SHA256 mismatch; unverified data.line is not accepted')
    with baseline.open('rb') as source, mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ) as data:
        scan = JsonRanges(data).document(html=source_html)
        embedded_begin = scan.document_start if source_html else 0
        embedded_end = embedded_begin + (embedded_size if source_html else len(data))
        if source_html and range_sha(data,embedded_begin,embedded_end) != embedded_sha:
            raise ValueError('Live page embedded tf-data differs from the pinned frozen baseline')
        model_changes = []
        changes_report = []
        for key,(replacement,info) in replacements.items():
            if key not in scan.models:
                raise ValueError(f'Existing native model {key} not found')
            begin,end = scan.models[key]
            if data[begin:begin+1] != b'{':
                raise ValueError(f'Existing {key} value is not a JSON object')
            model_changes.append((begin,end,replacement))
            changes_report.append({'jsonPath':['aircraftModels',key],'startInclusive':begin,'endExclusive':end,
                                   'oldBytes':end-begin,'oldSha256':range_sha(data,begin,end),
                                   'newBytes':len(replacement),'newSha256':digest_bytes(replacement)})
        model_changes.sort()
        changes = list(model_changes)
        app_guard = None
        if app_override:
            if range_sha(data,embedded_end,len(data)) != old_app_sha:
                raise ValueError('Live app suffix differs from --old-app-sha256')
            old_app=data[embedded_end:]
            old_close=old_app.rfind(b'</script>');new_close=app_replacement.rfind(b'</script>')
            if not app_replacement.lstrip().startswith(b'<script') or min(old_close,new_close)<0 or app_replacement[new_close+9:]!=old_app[old_close+9:]:
                raise ValueError('App override must be the complete embedded app script suffix')
            app_replacement.decode('utf-8')
            app_guard=guard_app_core(old_app,app_replacement)
            changes.append((embedded_end,len(data),app_replacement))
            changes_report.append({'component':'app','startInclusive':embedded_end,'endExclusive':len(data),
                                   'oldBytes':len(data)-embedded_end,'oldSha256':old_app_sha,
                                   'newBytes':len(app_replacement),'newSha256':new_app_sha})
        changes.sort()
        preserved_ranges=[];cursor=0
        for begin,end,replacement in changes:
            if begin < cursor:
                raise ValueError('Overlapping source replacement ranges')
            if begin > cursor:
                preserved_ranges.append({'startInclusive':cursor,'endExclusive':begin,
                                         'bytes':begin-cursor,'sha256':range_sha(data,cursor,begin)})
            cursor=end
        if cursor < len(data):
            preserved_ranges.append({'startInclusive':cursor,'endExclusive':len(data),
                                     'bytes':len(data)-cursor,'sha256':range_sha(data,cursor,len(data))})
        if old_metadata_output:
            begin,end=scan.models['mig17f']
            old = json.loads(data[begin:end],parse_constant=reject_constant)
            metadata = {'sourcePath':str(baseline),'sourceSha256':expected_sha,
                        'recordRange':{'startInclusive':begin,'endExclusive':end,'sha256':range_sha(data,begin,end)},
                        **{key:old.get(key) for key in ['version','type','cg_in_model','cg_why','source','spec']}}
            with old_metadata_output.open('x',encoding='utf-8') as dest:
                dest.write(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n')
        components = {}
        for label, path in [('head', head), ('app', app)]:
            if path:
                components[label] = {'path': str(path), 'bytes': path.stat().st_size,
                                     'sha256': range_sha_file(path)}

        def spliced(begin,end,edits):
            cursor=begin
            for a,b,replacement in edits:
                yield from range_chunks(data,cursor,a)
                yield from range_chunks(replacement,0,len(replacement))
                cursor=b
            yield from range_chunks(data,cursor,end)

        def segments():
            if wrap_html:
                yield from file_chunks(head)
            yield from spliced(0,len(data),changes)
            if wrap_html:
                yield from file_chunks(app)

        expected = hashlib.sha256()
        data_hash = hashlib.sha256()
        for piece in spliced(embedded_begin,embedded_end,model_changes):
            data_hash.update(piece)
        output_bytes = 0
        temporary = None
        try:
            if output:
                if not output.parent.is_dir():
                    raise ValueError('Output parent must already exist')
                fd, temporary = tempfile.mkstemp(prefix=output.name+'.partial-', dir=output.parent)
                with os.fdopen(fd, 'wb') as raw:
                    with gzip.GzipFile(filename='', mode='wb', fileobj=raw, compresslevel=gzip_level, mtime=0) if compressed else contextlib.nullcontext(raw) as dest:
                        for piece in segments():
                            dest.write(piece)
                            expected.update(piece)
                            output_bytes += len(piece)
                    raw.flush()
                    os.fsync(raw.fileno())
                # Compare the COMPLETE emitted stream, not just its selected model or its hash.
                reader = gzip.open(temporary, 'rb') if compressed else open(temporary, 'rb')
                actual = hashlib.sha256()
                with reader:
                    for piece in segments():
                        received = reader.read(len(piece))
                        if received != piece:
                            raise ValueError('Output readback differs from the exact source splice')
                        actual.update(received)
                    if reader.read(1):
                        raise ValueError('Unexpected trailing output bytes')
                if actual.hexdigest() != expected.hexdigest():
                    raise ValueError('Output readback SHA256 mismatch')
                after = baseline.stat()
                if (after.st_size, after.st_mtime_ns, after.st_ino) != (before.st_size, before.st_mtime_ns, before.st_ino):
                    raise ValueError('Frozen source changed during assembly')
                os.link(temporary, output)  # Never overwrite a concurrently-created destination.
                os.unlink(temporary)
                temporary = None
            else:
                for piece in segments():
                    expected.update(piece)
                    output_bytes += len(piece)
            manifest = {
                'schemaVersion': 1, 'scope': 'Explicit native record(s) and optional pinned live-app suffix splice only; no aircraft/game/browser/deployment completion claim',
                'source': {'path': str(baseline), 'format':'html' if source_html else 'data',
                           'bytes':len(data),'sha256':expected_sha,'utf8Valid':True},
                'baseline': {'path': str(baseline), 'startInclusive':embedded_begin,'endExclusive':embedded_end,
                             'bytes':embedded_end-embedded_begin,'sha256':embedded_sha if source_html else expected_sha,
                             'fullJsonGrammarValid': True},
                'records': {key:{'path':str(record_specs[key][0]),**info} for key,(replacement,info) in replacements.items()},
                'replacements': changes_report,
                'preserved': {'ranges':preserved_ranges,'allBytesOutsideReplacementRangesUnchanged':True,
                              'topLevelValueRanges': {key: {'bytes': b-a, 'sha256': range_sha(data, a, b)} for key, (a, b) in scan.top.items() if key != 'aircraftModels'},
                              'otherAircraftModels': {key: {'startInclusive':a,'endExclusive':b,'bytes': b-a, 'sha256': range_sha(data, a, b)} for key, (a, b) in scan.models.items() if key not in replacements},
                              'importedModelCountBeforeAndAfter': len(scan.models)},
                'patchedData': {'bytes': embedded_end-embedded_begin+sum(len(value)-(b-a) for a,b,value in model_changes), 'sha256': data_hash.hexdigest(),
                                'jsonValidByValidatedObjectSplice': True},
                'oldMetadataOutput': {'path':str(old_metadata_output),'sha256':range_sha_file(old_metadata_output)} if old_metadata_output else None,
                'components': components,
                'appOverrideGuard':app_guard,
                'output': {'written': output is not None, 'path': str(output) if output else None, 'format': format,
                           'uncompressedBytes': output_bytes, 'uncompressedSha256': expected.hexdigest(),
                           'readbackByteForByteVerified': True if output else None,
                           'storedBytes': output.stat().st_size if output else None,
                           'storedSha256': range_sha_file(output) if output else None,
                           'gzipMtime': 0 if compressed else None, 'gzipLevel': gzip_level if compressed else None},
                'noInputFilesModified': True,
            }
            return manifest
        finally:
            if temporary:
                os.unlink(temporary)


def range_sha_file(path):
    h = hashlib.sha256()
    for piece in file_chunks(path):
        h.update(piece)
    return h.hexdigest()


def self_test():
    """Small actual scanner/splice tests; no production asset is written."""
    import unittest

    class SpliceTests(unittest.TestCase):
        def setUp(self):
            self.temp = tempfile.TemporaryDirectory()
            self.addCleanup(self.temp.cleanup)
            self.root = Path(self.temp.name)
            self.source = self.root/'data.line'
            self.old = b'{"version":1,"name":"old \\\" } [ mig17f"}'
            self.raw = (b'<script type="application/json" id="tf-data">\n'
                        b'{"vehicles":{"mig17f":{"x":[1,-2.5e2,true,null,"\\u4e2d"]}},'
                        b'"aircraftModels" : {"other" : {"blob":" } [ \\\" "}, "mig17f" : '+self.old+
                        b',"last":{"text":"\xe4\xb8\xad \xe7\xbe\x8e"}},"tail":{"ok":false}}</script>\n')
            self.source.write_bytes(self.raw)
            self.record = self.root/'native.json'
            buf = struct.pack('<hhhbbbHHHHH', 0, 1, 2, 0, 0, 127, 1, 2, 0, 0, 0)
            # Add one alignment byte before the UV and index arrays.
            buf = buf[:9]+b'\0'+buf[9:]
            entry = {'version': 2, 'type': 'mig17f', 'posScale': 1/3000,
                     'parts': [{'name': 'test', 'vertices': 1, 'triangles': 1, 'pos': 0, 'nor': 6, 'uv': 10, 'idx': 14}],
                     'movers': [], 'blob': base64.b64encode(zlib.compress(buf)).decode(), 'name': '米格'}
            self.record.write_text(json.dumps(entry, ensure_ascii=False)+'\n')

        def run_splice(self, **kwargs):
            return assemble(self.source, self.record, range_sha_file(self.record),
                            expected_sha=digest_bytes(self.raw), expected_size=len(self.raw), **kwargs)

        def test_exact_data_and_other_values(self):
            out = self.root/'new.line'
            report = self.run_splice(output=out)
            expected = self.raw.replace(self.old, self.record.read_bytes().strip(WS))
            self.assertEqual(out.read_bytes(), expected)
            self.assertEqual(report['preserved']['importedModelCountBeforeAndAfter'], 3)
            self.assertEqual(set(report['preserved']['otherAircraftModels']), {'other', 'last'})
            self.assertEqual(JsonRanges(expected).document().models.keys(), {'other': 0, 'mig17f': 0, 'last': 0}.keys())

        def test_html_gzip_and_virtual_splice(self):
            head, app = self.root/'head', self.root/'app'
            head.write_bytes(b'<!doctype html>\n');app.write_bytes(b'<script>/* app */</script>\n')
            virtual = self.run_splice(format='html-gzip', head=head, app=app)
            out = self.root/'new.html.gz'
            report = self.run_splice(output=out, format='html-gzip', head=head, app=app)
            self.assertEqual(report['output']['uncompressedSha256'], virtual['output']['uncompressedSha256'])
            self.assertTrue(report['output']['readbackByteForByteVerified'])
            self.assertEqual(gzip.decompress(out.read_bytes()), head.read_bytes()+self.raw.replace(self.old,self.record.read_bytes().strip(WS))+app.read_bytes())

        def test_live_page_preserves_current_head_app_and_extracts_old_spec(self):
            page=self.root/'live.html';page.write_bytes(b'<!doctype html>live-head\n'+self.raw+b'<script>/* current LIVE app */</script>')
            out=self.root/'patched.html.gz';old=self.root/'old-spec.json'
            report=assemble(page,self.record,range_sha_file(self.record),output=out,format='html-gzip',
                            source_html=True,expected_sha=range_sha_file(page),expected_size=page.stat().st_size,
                            embedded_sha=digest_bytes(self.raw),embedded_size=len(self.raw),old_metadata_output=old)
            self.assertEqual(gzip.decompress(out.read_bytes()),page.read_bytes().replace(self.old,self.record.read_bytes().strip(WS)))
            self.assertEqual(report['baseline']['sha256'],digest_bytes(self.raw))
            self.assertEqual(json.loads(old.read_bytes())['version'],1)
            with self.assertRaisesRegex(ValueError,'embedded tf-data'):
                assemble(page,self.record,range_sha_file(self.record),format='html-gzip',source_html=True,
                         expected_sha=range_sha_file(page),expected_size=page.stat().st_size,embedded_sha='0'*64,embedded_size=len(self.raw))

        def test_two_records_and_guarded_app_suffix(self):
            raw=self.raw.replace(b'"other" : {"blob":" } [ \\\" "}',b'"f104g" : {"old":104}')
            suffix=b'<script>/* actual live app */</script>\n</body></html>\n'
            page=self.root/'live-multi.html';page.write_bytes(b'<!doctype html>keep-head\n'+raw+suffix)
            replacement=self.root/'f104.json';entry=json.loads(self.record.read_bytes());entry['type']='f104g';replacement.write_text(json.dumps(entry))
            newapp=self.root/'patched-app.html';newapp.write_bytes(b'<script>/* reviewed sight and AA patch */</script>\n</body></html>\n')
            kwargs={'format':'html-gzip','source_html':True,'expected_sha':range_sha_file(page),
                    'expected_size':page.stat().st_size,'embedded_sha':digest_bytes(raw),'embedded_size':len(raw),
                    'records':{'mig17f':(self.record,range_sha_file(self.record)),'f104g':(replacement,range_sha_file(replacement))},
                    'app_override':newapp,'old_app_sha':digest_bytes(suffix),'new_app_sha':range_sha_file(newapp)}
            out=self.root/'multi.gz';report=assemble(page,output=out,**kwargs)
            expected=page.read_bytes().replace(self.old,self.record.read_bytes().strip(WS)).replace(b'{"old":104}',replacement.read_bytes()).replace(suffix,newapp.read_bytes())
            self.assertEqual(gzip.decompress(out.read_bytes()),expected)
            self.assertEqual(set(report['preserved']['otherAircraftModels']),{'last'})
            self.assertEqual(len(report['replacements']),3)
            kwargs['old_app_sha']='0'*64
            with self.assertRaisesRegex(ValueError,'Live app suffix'):
                assemble(page,**kwargs)
            kwargs['old_app_sha']=digest_bytes(suffix);kwargs['new_app_sha']='0'*64
            with self.assertRaisesRegex(ValueError,'App override SHA256'):
                assemble(page,**kwargs)

        def test_bad_pin_record_and_collision_are_rejected(self):
            with self.assertRaisesRegex(ValueError, 'baseline SHA256'):
                assemble(self.source,self.record,range_sha_file(self.record),expected_sha='0'*64,expected_size=len(self.raw))
            with self.assertRaisesRegex(ValueError, 'record SHA256'):
                assemble(self.source,self.record,'0'*64,expected_sha=digest_bytes(self.raw),expected_size=len(self.raw))
            with self.assertRaisesRegex(ValueError, 'new file'):
                self.run_splice(output=self.source)
            entry=json.loads(self.record.read_bytes());entry['type']='mig15';self.record.write_text(json.dumps(entry))
            with self.assertRaisesRegex(ValueError, 'type mig17f'):
                self.run_splice()

        def test_invalid_json_and_duplicate_target_are_rejected(self):
            for value in [b'{"aircraftModels":{"mig17f":{},"mig17f":{}}}',
                          b'{"aircraftModels":{"mig17f":{}},"x":[1,]}',
                          b'{"aircraftModels":{"mig17f":{}},"x":"\\q"}']:
                with self.assertRaises(ValueError):
                    JsonRanges(b'<script id="tf-data" type="application/json">'+value+b'</script>').document()

        def test_local_app_patch_cannot_replace_flight_core(self):
            old=b'<script>var FLIGHT_CORE_WASM = "AQID";/* old UI */</script>'
            new=b'<script>var FLIGHT_CORE_WASM = "AQID";/* reviewed new UI */</script>'
            self.assertEqual(guard_app_core(old,new)['flightCoreLiteralCount'],1)
            with self.assertRaisesRegex(ValueError,'FLIGHT_CORE_WASM'):
                guard_app_core(old,new.replace(b'AQID',b'BAUG'))

    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(SpliceTests))
    if not result.wasSuccessful():
        raise SystemExit(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', type=Path, default=BASELINE)
    parser.add_argument('--page-source',type=Path,help='Exact current live page, replacing only its model value; no head/app substitution')
    parser.add_argument('--page-sha256',help='Independently verified complete live page SHA256, required with --page-source')
    parser.add_argument('--page-bytes',type=int,help='Independently verified complete live page size, required with --page-source')
    parser.add_argument('--record', type=Path)
    parser.add_argument('--record-sha256')
    parser.add_argument('--replace',action='append',default=[],metavar='ID=PATH',help='Repeat for mig17f/f104g; each requires matching --replace-sha')
    parser.add_argument('--replace-sha',action='append',default=[],metavar='ID=SHA256')
    parser.add_argument('--out', type=Path)
    parser.add_argument('--format', choices=['data','data-gzip','html','html-gzip'], default='data')
    parser.add_argument('--head', type=Path)
    parser.add_argument('--app', type=Path)
    parser.add_argument('--app-override',type=Path,help='Reviewed live-app suffix only, requiring exact old/new suffix SHA256 guards')
    parser.add_argument('--old-app-sha256')
    parser.add_argument('--new-app-sha256')
    parser.add_argument('--gzip-level', type=int, choices=range(1,10), default=6)
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--old-spec-out',type=Path,help='Optional small trusted old record cg/spec/source metadata artifact')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    def pairs(entries,label):
        result={}
        for entry in entries:
            if '=' not in entry:
                parser.error(f'{label} requires ID=VALUE')
            key,value=entry.split('=',1)
            if key not in ('mig17f','f104g') or not value or key in result:
                parser.error(f'Invalid or duplicate {label} ID')
            result[key]=value
        return result
    paths=pairs(args.replace,'--replace');hashes=pairs(args.replace_sha,'--replace-sha')
    if set(paths)!=set(hashes) or any(not re.fullmatch('[0-9a-f]{64}',sha)for sha in hashes.values()):
        parser.error('Every --replace must have its exact matching lowercase --replace-sha')
    if bool(args.record)!=bool(args.record_sha256) or (args.record_sha256 and not re.fullmatch('[0-9a-f]{64}',args.record_sha256)):
        parser.error('--record requires its exact lowercase --record-sha256')
    if not args.record and not paths:
        parser.error('Specify --record or one or more --replace inputs')
    if args.record and 'mig17f'in paths:
        parser.error('Duplicate mig17f replacement')
    if args.page_source and (not args.page_sha256 or not re.fullmatch('[0-9a-f]{64}',args.page_sha256) or not args.page_bytes or args.page_bytes <= 0):
        parser.error('--page-source requires exact verified --page-sha256 and --page-bytes')
    if not args.page_source and (args.page_sha256 or args.page_bytes):
        parser.error('--page-sha256/--page-bytes require --page-source')
    if args.page_source and (args.head or args.app):
        parser.error('Live page splicing preserves its own head/app; do not pass --head/--app')
    if args.app_override and (not args.page_source or any(not value or not re.fullmatch('[0-9a-f]{64}',value)for value in [args.old_app_sha256,args.new_app_sha256])):
        parser.error('--app-override requires --page-source and exact --old-app-sha256/--new-app-sha256')
    input_paths=[args.baseline,args.page_source,args.record,args.out,args.head,args.app,args.app_override,args.old_spec_out,*map(Path,paths.values())]
    if args.manifest and (args.manifest.exists() or args.manifest.resolve() in [p.resolve() for p in input_paths if p]):
        parser.error('--manifest must be a new file distinct from every input/output')
    source=args.page_source or args.baseline
    report = assemble(source,args.record,args.record_sha256,output=args.out,
                      format=args.format,head=args.head,app=args.app,gzip_level=args.gzip_level,
                      source_html=bool(args.page_source),expected_sha=args.page_sha256 if args.page_source else BASELINE_SHA,
                      expected_size=args.page_bytes if args.page_source else BASELINE_SIZE,old_metadata_output=args.old_spec_out,
                      records={key:(Path(path),hashes[key])for key,path in paths.items()},app_override=args.app_override,
                      old_app_sha=args.old_app_sha256,new_app_sha=args.new_app_sha256)
    encoded = json.dumps(report,ensure_ascii=False,indent=2)+'\n'
    if args.manifest:
        with args.manifest.open('x',encoding='utf-8') as dest:
            dest.write(encoded)
    print(encoded,end='')


if __name__ == '__main__':
    main()
