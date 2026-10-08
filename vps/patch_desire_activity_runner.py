"""Migrate small live-runner hooks; preserve prompts, plans, and local additions."""
import argparse
import os
import shutil
import tempfile
from pathlib import Path


XINCHAO_HOOKS = (
    'import vesper_xinchao as xinchao\n',
    '        xinchao_packet = xinchao.prepare(store, job, allowed)\n        prompt += xinchao.prompt(xinchao_packet)\n',
    '        xinchao.completed(store, job, xinchao_packet, records)\n',
    '    if xinchao.enabled():\n        xinchao.presence(store, [r for r in policy.history(HISTORY, include_archived=True) if policy.normal(r)])\n',
)
READ_BEFORE = "        if required_desire:\n            try: desire_state=run_tool('desire_status',{},'required-desire-status')\n"
READ_AFTER = "        if job['source'] != 'verification' and 'desire_status' in allowed:\n            try: desire_state=run_tool('desire_status',{},'required-desire-status')\n"
INSERTIONS = (
    ('import vesper_wake_store as store\n', 'import vesper_wake_activity as activity\n', 'after'),
    ("        prompt+='只返回 JSON", '        prompt += activity.prompt(store, job, desire_state)\n', 'before_line'),
    ('        schema=wake_output_schema(required_desire)\n', '        schema=activity.output_schema(schema, job)\n', 'after'),
    ("        if not isinstance(decision.get('silentReason',''),str) or len(decision.get('silentReason',''))>200:raise RuntimeError('Invalid silent reason')\n",
     '        activity.validate(decision, job)\n', 'after'),
    ("            update(ident,status='silent',finished=time.time(),decision='nothing_to_share',", '            activity.completed(store, job, decision)\n', 'before_line'),
    ("        update(ident,status='saved',finished=time.time(),notification=message,decision='share')\n", '        activity.completed(store, job, decision)\n', 'after'),
)


def patched(text):
    compile(text, 'vesper_wake_runner.py', 'exec')
    old = [hook in text for hook in XINCHAO_HOOKS]
    new = [insertion in text.splitlines(keepends=True) for _, insertion, _ in INSERTIONS]
    if all(new) and READ_AFTER in text and not any(old):
        if 'xinchao.' in text or 'import vesper_xinchao' in text:
            raise ValueError('Unknown remaining Xinchao integration; review before installing.')
        return text
    if any(new):
        raise ValueError('Partial Desire activity integration; review before installing.')
    if any(old) and not all(old):
        raise ValueError('Partial Xinchao integration; review before installing.')
    for hook in XINCHAO_HOOKS:
        if all(old):
            if text.count(hook) != 1:
                raise ValueError('Ambiguous Xinchao hook')
            text = text.replace(hook, '', 1)
    if 'xinchao.' in text or 'import vesper_xinchao' in text:
        raise ValueError('Unknown remaining Xinchao integration; review before installing.')
    if text.count(READ_BEFORE) != 1:
        raise ValueError('Unknown native Desire read layout')
    text = text.replace(READ_BEFORE, READ_AFTER, 1)
    for anchor, insertion, mode in INSERTIONS:
        if text.count(anchor) != 1:
            raise ValueError('Unknown live runner layout: ' + anchor.strip()[:70])
        index = text.index(anchor) + (len(anchor) if mode == 'after' else 0)
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
    module = Path(__file__).with_name('vesper_wake_activity.py')
    compile(module.read_text(), str(module), 'exec')
    if args.check:
        print('Desire activity hooks checked; live prompt and scheduling additions will be preserved.')
        return
    backup = None
    if replacement != original:
        handle, name = tempfile.mkstemp(prefix=args.runner.name + '.before-desire-activity-', dir=args.runner.parent)
        os.close(handle)
        backup = Path(name)
        backup.write_text(original)
        os.chmod(backup, 0o600)
    shutil.copy2(module, args.runner.with_name(module.name))
    if replacement != original:
        handle, name = tempfile.mkstemp(prefix='.desire-activity-runner-', dir=args.runner.parent)
        os.close(handle)
        stage = Path(name)
        try:
            stage.write_text(replacement)
            os.chmod(stage, args.runner.stat().st_mode & 0o777)
            os.replace(stage, args.runner)
        finally:
            stage.unlink(missing_ok=True)
    print('Native Desire activity context installed.' + (' Runner backup: ' + str(backup) if backup else ' Runner already integrated.'))


if __name__ == '__main__':
    main()
