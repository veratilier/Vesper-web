"""Permit upstream workspace version bumps, never registry/git dependency drift."""
import pathlib
import subprocess
import sys
import tomllib

path = pathlib.Path(sys.argv[1])
before = tomllib.loads(subprocess.check_output(['git', 'show', 'HEAD:codex-rs/Cargo.lock'], text=True))
after = tomllib.loads(path.read_text())
external = lambda lock: sorted((p for p in lock['package'] if 'source' in p), key=lambda p: (p['name'], p['version'], p['source']))
assert external(before) == external(after), 'External dependency resolution changed; stop build'
old = {p['name']: p for p in before['package'] if 'source' not in p}
new = {p['name']: p for p in after['package'] if 'source' not in p}
assert old.keys() == new.keys(), 'Workspace package set changed'
for name in old:
    a = {k: v for k, v in old[name].items() if k != 'version'}
    b = {k: v for k, v in new[name].items() if k != 'version'}
    assert a == b, f'Unexpected workspace dependency change: {name}'
print('Lock verified: only workspace package versions may differ')
