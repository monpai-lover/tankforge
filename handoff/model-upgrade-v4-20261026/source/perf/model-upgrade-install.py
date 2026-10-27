#!/usr/bin/env python3
"""Apply exact context hunks, retaining unrelated local TankForge changes."""
import argparse, base64, hashlib, json, os, tempfile
from pathlib import Path

FORMAT = 'tankforge-model-context-v1'
MARKER = b'<script>(() => {'
def sha(data): return hashlib.sha256(data).hexdigest()
def file_sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()

def apply_hunks(original, payload):
    if payload.get('format') == 'tankforge-model-context-multi-v1':
        candidates=[]
        for profile in payload.get('profiles',[]):
            try:candidates.append(apply_hunks(original,profile))
            except (ValueError,KeyError,TypeError):pass
        if not candidates:
            raise ValueError('原始版或上一版的模型接口均存在冲突；未生成文件。请合并 source 中对应模块。')
        if any(out != candidates[0][0] for out,_ in candidates[1:]):
            raise ValueError('多个模型补丁产生不同结果；未生成文件。')
        return candidates[0][0],any(exact for _,exact in candidates)
    if payload.get('format') != FORMAT:
        raise ValueError('不支持的模型补丁格式。')
    spans = []
    for i, hunk in enumerate(payload['hunks'], 1):
        if set(hunk) != {'old', 'new', 'old_sha256', 'new_sha256'}:
            raise ValueError('补丁段格式损坏。')
        old = base64.b64decode(hunk['old'], validate=True)
        new = base64.b64decode(hunk['new'], validate=True)
        if not old or sha(old) != hunk['old_sha256'] or sha(new) != hunk['new_sha256']:
            raise ValueError('补丁段校验失败。')
        at = original.find(old)
        if at < 0 or original.find(old, at + 1) >= 0:
            raise ValueError(f'第 {i} 处模型接口冲突或不唯一；未生成文件。请合并 source 中对应模块。')
        if spans and at < spans[-1][1]:
            raise ValueError('补丁接口重叠或顺序不符。')
        spans.append((at, at + len(old), new))
    out, previous = bytearray(), 0
    for start, end, new in spans:
        out.extend(original[previous:start]); out.extend(new); previous = end
    out.extend(original[previous:])
    changed = bytes(out)
    exact = sha(original) == payload['base_sha256']
    if exact and sha(changed) != payload['target_sha256']:
        raise ValueError('精确底版的结果校验失败。')
    return changed, exact

def main():
    p = argparse.ArgumentParser(description='外观、内构与挂架增量升级；保留未涉及的本地脚本修改。')
    p.add_argument('html', type=Path); p.add_argument('--output', type=Path)
    p.add_argument('--check', action='store_true', help='只检查能否合并，不写文件')
    a = p.parse_args(); source = a.html.resolve()
    target = (a.output or source.with_name(source.stem + '-models-upgraded.html')).resolve()
    if target == source or (target.exists() and not a.check):
        p.error('输出必须是新文件；禁止覆盖原网页或已有输出。')
    here = Path(__file__).resolve().parent
    manifest = json.loads((here/'manifest.json').read_bytes())
    encoded = (here/'model-hunks.json').read_bytes()
    if sha(encoded) != manifest['payload_sha256']:
        raise SystemExit('补丁数据损坏，请重新解压。')
    payload = json.loads(encoded)
    raw = source.read_bytes(); original_hash = sha(raw)
    if raw.count(MARKER) != 1:
        raise SystemExit('未找到唯一的 TankForge 网页运行脚本。')
    offset = raw.index(MARKER); prefix, app = memoryview(raw)[:offset], raw[offset:]
    try: changed, exact = apply_hunks(app, payload)
    except (ValueError, KeyError, TypeError) as e: raise SystemExit(str(e))
    if a.check:
        print('合并检查通过；' + ('精确底版。' if exact else '可保留接口以外的本地修改。'))
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='tankforge-models-', suffix='.html', dir=target.parent)
    try:
        with os.fdopen(fd, 'wb') as out:
            out.write(prefix); out.write(changed); out.flush(); os.fsync(out.fileno())
        # Detect a concurrent source edit before committing the new file.
        if file_sha(source) != original_hash:
            raise ValueError('原文件在合并期间发生变化；本次结果未写入。')
        os.chmod(temporary, 0o644)
        os.link(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)
    print('已生成：' + str(target) + '\n原网页保留；未涉及的本地脚本和资源沿用。')

if __name__ == '__main__': main()
