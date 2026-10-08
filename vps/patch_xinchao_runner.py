"""Apply only three insertion points to the live runner; never replace its prompt.

Reject unknown or partial layouts before writing anything. Keep a private backup.
"""
import argparse
import os
import shutil
import tempfile
from pathlib import Path

INSERTIONS = (
    ("import vesper_wake_store as store\n", "import vesper_xinchao as xinchao\n", 'after'),
    ("        prompt+='只返回 JSON", "        xinchao_packet = xinchao.prepare(store, job, allowed)\n        prompt += xinchao.prompt(xinchao_packet)\n", 'before_line'),
    ("        with store.db() as con:records=con.execute('SELECT * FROM calls WHERE job_id=?',(ident,)).fetchall()\n",
     "        xinchao.completed(store, job, xinchao_packet, records)\n", 'after'),
    ("    if sleep_gate(now):return\n", "    if xinchao.enabled():\n        xinchao.presence(store, [r for r in policy.history(HISTORY, include_archived=True) if policy.normal(r)])\n", 'tick_before'),
)


def patched(text):
    markers = [insertion.strip().split('\n')[0] in text for _, insertion, _ in INSERTIONS]
    if all(markers):
        return text
    if any(markers):
        raise ValueError('Partial Xinchao integration found; review it before installing.')
    for anchor, insertion, mode in INSERTIONS:
        if mode == 'tick_before':
            start = text.index('def tick():\n')
            index = text.index(anchor, start)
            text = text[:index] + insertion + text[index:]
        else:
            if text.count(anchor) != 1:
                raise ValueError('Unknown live runner layout: ' + anchor.strip()[:70])
            index = text.index(anchor)
            if mode == 'after':
                index += len(anchor)
            text = text[:index] + insertion + text[index:]
    compile(text, 'vesper_wake_runner.py', 'exec')
    return text


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('runner', type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    original = args.runner.read_text()
    replacement = patched(original)
    if args.check:
        print('Live runner insertion points checked; prompt will be preserved.')
        return
    module = Path(__file__).with_name('vesper_xinchao.py')
    compile(module.read_text(), str(module), 'exec')
    backup = None
    if replacement != original:
        handle, name = tempfile.mkstemp(prefix=args.runner.name + '.before-xinchao-', dir=args.runner.parent)
        os.close(handle)
        backup = Path(name)
        backup.write_text(original)
        os.chmod(backup, 0o600)
    # Adapter first, then runner: no newly modified runner without its dependency.
    shutil.copy2(module, args.runner.with_name(module.name))
    if replacement != original:
        handle, name = tempfile.mkstemp(prefix='.xinchao-runner-', dir=args.runner.parent)
        os.close(handle)
        stage = Path(name)
        stage.write_text(replacement)
        os.chmod(stage, args.runner.stat().st_mode & 0o777)
        os.replace(stage, args.runner)
    print('Xinchao adapter installed.' + (' Runner backup: ' + str(backup) if backup else ' Runner already integrated.'))


if __name__ == '__main__':
    main()
