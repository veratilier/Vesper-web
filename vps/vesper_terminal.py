"""A real, persistent tmux pane. No transcript files or model output replay."""
import os
import re
import shlex
import shutil
import sys
import uuid
import subprocess
import threading
import time
from pathlib import Path
from vesper_codex_records import collapse_wake_context

LOCK = threading.Lock()
KEYS = {'Enter', 'Escape', 'Tab', 'BSpace', 'Up', 'Down', 'Left', 'Right', 'C-c'}


class TerminalUnavailable(Exception):
    pass


def session(thread_id=None):
    if thread_id is not None:
        try:
            ident = uuid.UUID(thread_id)
        except (ValueError, TypeError, AttributeError) as exc:
            raise ValueError('Invalid Codex thread ID') from exc
        return 'vesper-chat-' + ident.hex
    name = os.environ.get('VESPER_TERMINAL_SESSION', 'vesper-codex')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', name):
        raise TerminalUnavailable('Invalid server terminal session configuration')
    return name


def run(*args, check=True):
    binary = shutil.which('tmux')
    if not binary:
        raise TerminalUnavailable('Install tmux on the VPS to enable the terminal')
    try:
        result = subprocess.run([binary, '-L', 'vesper-terminal', *args],
                                capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise TerminalUnavailable('VPS terminal is unavailable') from exc
    if check and result.returncode:
        raise TerminalUnavailable('VPS terminal session is unavailable')
    return result


def enabled():
    if os.environ.get('VESPER_TERMINAL_ENABLED') != '1':
        raise TerminalUnavailable('VPS terminal has not been enabled on the server yet')


def exists(thread_id=None):
    return run('has-session', '-t', '=' + session(thread_id), check=False).returncode == 0


def pane(thread_id=None):
    if not exists(thread_id):
        raise TerminalUnavailable('Start the VPS Codex session first')
    # Fixed target: clients cannot select another tmux session or pane.
    return run('display-message', '-p', '-t', session(thread_id) + ':0.0', '#{pane_id}').stdout.strip()


def screen(thread_id=None):
    enabled()
    with LOCK:
        if not exists(thread_id):
            return {'running': False, 'screen': '', 'session': session(thread_id), 'capabilities': {'resize': True}}
        target = pane(thread_id)
        info = run('display-message', '-p', '-t', target,
                   '#{pane_dead}|#{pane_width}|#{pane_height}|#{cursor_x}|#{cursor_y}').stdout.strip().split('|')
        # Real pane scrollback, joined at soft wraps. Earlier completed Codex
        # commands are read separately from this thread's original rollout.
        output = run('capture-pane', '-p', '-J', '-S', '-', '-t', target).stdout
        output = collapse_wake_context(output)
        truncated = len(output) > 200000
        output = output[-200000:]
        return {'running': info[0] == '0', 'screen': output, 'session': session(thread_id),
                'columns': int(info[1]), 'rows': int(info[2]),
                'cursorX': int(info[3]), 'cursorY': int(info[4]), 'historyTruncated': truncated,
                'capabilities': {'resize': True}}


def start(thread_id=None):
    enabled()
    with LOCK:
        if exists(thread_id):
            return {'ok': True, 'created': False}
        binary = shutil.which('codex')
        cwd = Path(os.environ.get('VESPER_TERMINAL_CWD', str(Path.home()))).resolve()
        if not binary or not cwd.is_dir():
            raise TerminalUnavailable('Configure the VPS Codex executable and working directory')
        # Launch the installed CLI with its existing account and approval settings.
        # Executable and cwd are server-owned; request bodies never supply shell code.
        command = binary if thread_id is None else shlex.join([sys.executable, str(Path(__file__).resolve()), '--attach', str(uuid.UUID(thread_id))])
        run('new-session', '-d', '-s', session(thread_id), '-x', '48', '-y', '32', '-c', str(cwd), command)
        return {'ok': True, 'created': True}


def resize(body, thread_id):
    enabled()
    columns = body.get('columns')
    if type(columns) is not int or not 24 <= columns <= 120:
        raise ValueError('Terminal columns must be between 24 and 120')
    with LOCK:
        target = pane(thread_id)
        run('resize-window', '-t', target, '-x', str(columns), '-y', '32')
    return {'ok': True, 'columns': columns}


def input_event(body, thread_id=None):
    enabled()
    key, text = body.get('key'), body.get('text')
    if (key is None) == (text is None):
        raise ValueError('Supply exactly one key or text')
    if key is not None and (not isinstance(key, str) or key not in KEYS):
        raise ValueError('Unsupported terminal key')
    if text is not None and (not isinstance(text, str) or not text or len(text.encode('utf-8')) > 4096
                             or any(ord(c) < 32 or ord(c) == 127 for c in text)):
        raise ValueError('Terminal text must be a single line under 4096 bytes')
    with LOCK:
        target = pane(thread_id)
        if key is not None:
            run('send-keys', '-t', target, key)
        else:
            # -l prevents text such as C-c being interpreted as tmux key names.
            run('send-keys', '-l', '-t', target, '--', text)
            # Let Codex finish detecting the literal text as a paste before
            # submitting. An immediate Enter can be absorbed into that paste.
            time.sleep(0.2)
            run('send-keys', '-t', target, 'Enter')
    return {'ok': True}


def attach(thread_id):
    """Attach the TUI to the existing runtime; never load a second local runtime."""
    ident = str(uuid.UUID(thread_id))
    binary = shutil.which('codex')
    token_path = Path(os.environ.get('CODEX_TOKEN_FILE', '/home/ubuntu/.codex/app-server-token'))
    token = token_path.read_text(encoding='utf-8').strip()
    if not binary or not token:
        raise TerminalUnavailable('Existing Codex runtime credentials are unavailable')
    env = dict(os.environ, VESPER_TERMINAL_REMOTE_TOKEN=token)
    os.execvpe(binary, [binary, 'resume', '--remote', 'ws://127.0.0.1:4500',
                       '--remote-auth-token-env', 'VESPER_TERMINAL_REMOTE_TOKEN',
                       '--no-alt-screen', ident], env)


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] != '--attach':
        sys.exit('A current chat thread is required')
    try:
        attach(sys.argv[2])
    except (OSError, ValueError, TerminalUnavailable):
        sys.exit('Could not connect this chat terminal to the existing Codex runtime')
