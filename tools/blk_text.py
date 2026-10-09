"""A reader for Dagor's text BLK files (War Thunder CDK .blk): blocks `name{ ... }` holding
parameters `name:type=value` (t string, r real, i int, b bool, p2/p3/p4 reals, ip2 ints, m matrix).
include lines and comments are skipped. Returns nested Block objects: .params is a list of
(name, value) in file order (names repeat), .blocks a list of (name, Block).
"""
import re


class Block:
    def __init__(self):
        self.params = []
        self.blocks = []

    def get(self, name, default=None):
        for k, v in self.params:
            if k == name:
                return v
        return default

    def all(self, name):
        return [v for k, v in self.params if k == name]

    def block(self, name):
        for k, b in self.blocks:
            if k == name:
                return b
        return None

    def blocks_named(self, name):
        return [b for k, b in self.blocks if k == name]


TOKEN = re.compile(r'\s*(?:(//[^\n]*)|(/\*.*?\*/)|("(?:[^"\\]|\\.)*")|([{}])|(=)|([^\s{}=]+))', re.S)


def _value(typ, raw):
    raw = raw.strip()
    if typ == 't':
        return raw.strip('"')
    if typ == 'b':
        return raw.lower() in ('yes', 'true', 'on', '1')
    if typ == 'i':
        return int(raw)
    if typ == 'r':
        return float(raw)
    if typ in ('p2', 'p3', 'p4', 'ip2', 'ip3', 'ip4'):
        nums = [x.strip() for x in raw.split(',') if x.strip()]
        return [int(x) for x in nums] if typ.startswith('i') else [float(x) for x in nums]
    if typ == 'm':
        return [[float(x) for x in g.split(',')] for g in re.findall(r'\[([^\]]*)\]', raw)]
    return raw


def parse(text):
    root = Block()
    stack = [root]
    i = 0
    lines = text.splitlines()
    for line in lines:
        s = line.strip()
        if not s or s.startswith('//') or s.startswith('include'):
            continue
        # a line may hold "name{", "}", "name:type=value", or several of these
        while s:
            if s.startswith('//'):
                break
            if s.startswith('}'):
                stack.pop()
                s = s[1:].strip()
                continue
            m = re.match(r'([A-Za-z0-9_@."\-]+)\s*\{', s)
            if m:
                b = Block()
                stack[-1].blocks.append((m.group(1).strip('"'), b))
                stack.append(b)
                s = s[m.end():].strip()
                continue
            m = re.match(r'"?([A-Za-z0-9_@.:\-]+?)"?:([a-z0-9]+)\s*=\s*', s)
            if m:
                name, typ = m.group(1), m.group(2)
                rest = s[m.end():]
                if rest.startswith('"'):
                    e = rest.index('"', 1)
                    raw, s = rest[:e + 1], rest[e + 1:].strip()
                elif typ == 'm':
                    e = rest.rindex(']')
                    raw, s = rest[:e + 1], rest[e + 1:].strip()
                else:
                    # a value runs to the end of the line, a closing brace or a comment
                    m2 = re.match(r'[^}]*?(?=\}|//|$)', rest)
                    raw, s = m2.group(0), rest[m2.end():].strip()
                stack[-1].params.append((name, _value(typ, raw)))
                continue
            break  # anything else (a stray token) ends the line
    return root
