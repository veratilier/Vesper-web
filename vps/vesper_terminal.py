"""A real, persistent tmux pane. No transcript files or model output replay."""
import os
import re
import shutil
import subprocess
import threading
from pathlib import Path

LOCK = threading.Lock()
KEYS = {'Enter', 'Escape', 'Tab', 'BSpace', 'Up', 'Down', 'Left', 'Right', 'C-c'}


class TerminalUnavailable(Exception):
    pass


def session():
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


def exists():
    return run('has-session', '-t', '=' + session(), check=False).returncode == 0


def pane():
    if not exists():
        raise TerminalUnavailable('Start the VPS Codex session first')
    # Fixed target: clients cannot select another tmux session or pane.
    return run('display-message', '-p', '-t', session() + ':0.0', '#{pane_id}').stdout.strip()


def screen():
    enabled()
    with LOCK:
        if not exists():
            return {'running': False, 'screen': '', 'session': session()}
        target = pane()
        info = run('display-message', '-p', '-t', target,
                   '#{pane_dead}|#{pane_width}|#{pane_height}|#{cursor_x}|#{cursor_y}').stdout.strip().split('|')
        # Current terminal viewport, including redraws of a TUI; no old command files.
        output = run('capture-pane', '-p', '-t', target).stdout
        return {'running': info[0] == '0', 'screen': output, 'session': session(),
                'columns': int(info[1]), 'rows': int(info[2]),
                'cursorX': int(info[3]), 'cursorY': int(info[4])}


def start():
    enabled()
    with LOCK:
        if exists():
            return {'ok': True, 'created': False}
        binary = shutil.which('codex')
        cwd = Path(os.environ.get('VESPER_TERMINAL_CWD', str(Path.home()))).resolve()
        if not binary or not cwd.is_dir():
            raise TerminalUnavailable('Configure the VPS Codex executable and working directory')
        # Launch the installed CLI with its existing account and approval settings.
        # Executable and cwd are server-owned; request bodies never supply shell code.
        run('new-session', '-d', '-s', session(), '-x', '48', '-y', '32', '-c', str(cwd), binary)
        return {'ok': True, 'created': True}


def input_event(body):
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
        target = pane()
        if key is not None:
            run('send-keys', '-t', target, key)
        else:
            # -l prevents text such as C-c being interpreted as tmux key names.
            run('send-keys', '-l', '-t', target, '--', text)
            run('send-keys', '-t', target, 'Enter')
    return {'ok': True}
