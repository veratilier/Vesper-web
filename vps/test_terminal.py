import os
import unittest
from unittest.mock import patch, Mock

import vesper_terminal as terminal


class TerminalTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'VESPER_TERMINAL_ENABLED': '1',
                                         'VESPER_TERMINAL_SESSION': 'vesper-codex'}, clear=False)
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_disabled_does_not_spawn_process(self):
        with patch.dict(os.environ, {'VESPER_TERMINAL_ENABLED': '0'}), patch.object(terminal, 'run') as run:
            with self.assertRaises(terminal.TerminalUnavailable):
                terminal.start()
            run.assert_not_called()

    def test_screen_captures_real_viewport_not_history(self):
        def fake(*args, **kwargs):
            output = '%7\n' if args[0] == 'display-message' and args[-1] == '#{pane_id}' else ''
            if args[0] == 'display-message' and 'pane_dead' in args[-1]:
                output = '0|48|32|5|27\n'
            if args[0] == 'capture-pane':
                output = 'Codex 正在执行…\n> '
            return Mock(returncode=0, stdout=output)
        with patch.object(terminal, 'run', side_effect=fake) as run:
            value = terminal.screen()
            self.assertTrue(value['running'])
            self.assertEqual(value['cursorY'], 27)
            self.assertEqual(value['screen'], 'Codex 正在执行…\n> ')
            run.assert_any_call('capture-pane', '-p', '-t', '%7')

    def test_text_is_literal_and_enter_is_separate(self):
        with patch.object(terminal, 'pane', return_value='%7'), patch.object(terminal, 'run') as run:
            terminal.input_event({'text': 'C-c ; $(touch /tmp/nope) 中文'})
            self.assertEqual(run.call_args_list[0].args,
                             ('send-keys', '-l', '-t', '%7', '--', 'C-c ; $(touch /tmp/nope) 中文'))
            self.assertEqual(run.call_args_list[1].args, ('send-keys', '-t', '%7', 'Enter'))

    def test_special_keys_only_target_fixed_pane(self):
        with patch.object(terminal, 'pane', return_value='%7'), patch.object(terminal, 'run') as run:
            for key in terminal.KEYS:
                terminal.input_event({'key': key, 'session': 'other-session'})
                run.assert_called_with('send-keys', '-t', '%7', key)

    def test_reject_control_injection_and_bad_types(self):
        bodies = [{'text': '\x03'}, {'text': 'hello\nrm -rf'}, {'key': 'kill-session'},
                  {'text': 'x' * 4097}, {'key': []}, {}, {'key': 'Enter', 'text': 'x'}]
        with patch.object(terminal, 'run') as run:
            for body in bodies:
                with self.subTest(body=body), self.assertRaises(ValueError):
                    terminal.input_event(body)
            run.assert_not_called()

    def test_start_reuses_existing_session(self):
        with patch.object(terminal, 'exists', return_value=True), patch.object(terminal, 'run') as run:
            self.assertEqual(terminal.start(), {'ok': True, 'created': False})
            run.assert_not_called()

    def test_fixed_session_name_validated(self):
        with patch.dict(os.environ, {'VESPER_TERMINAL_SESSION': 'foo:1;bar'}):
            with self.assertRaises(terminal.TerminalUnavailable):
                terminal.session()

    def test_http_routes_require_existing_bearer_auth(self):
        import tempfile
        from pathlib import Path
        import codex_history_server as history
        with tempfile.TemporaryDirectory() as directory:
            token = Path(directory) / 'token'
            token.write_text('private-test-token')
            with patch.object(history, 'TOKEN_PATH', token), patch.object(terminal, 'screen', return_value={'running': False}) as screen:
                handler = object.__new__(history.Handler)
                handler.send_json = Mock()
                for route in ['/terminal', '/terminal/start', '/terminal/input']:
                    handler.path = route
                    handler.command = 'GET' if route == '/terminal' else 'POST'
                    handler.headers = {}
                    handler.dispatch_request()
                    handler.send_json.assert_called_with(401, {'error': 'Unauthorized'})
                screen.assert_not_called()
                handler.path, handler.command = '/terminal', 'GET'
                handler.headers = {'Authorization': 'Bearer private-test-token'}
                handler.dispatch_request()
                handler.send_json.assert_called_with(200, {'running': False})
                screen.assert_called_once()

    @unittest.skipUnless(__import__('shutil').which('tmux'), 'tmux required for real pane integration')
    def test_real_persistent_pane_redraw_and_input(self):
        import shutil
        import sys
        import time
        import uuid
        name = 'test-' + uuid.uuid4().hex
        original_which = shutil.which
        def which(binary):
            return sys.executable if binary == 'codex' else original_which(binary)
        with patch.dict(os.environ, {'VESPER_TERMINAL_SESSION': name}), patch.object(terminal.shutil, 'which', side_effect=which):
            try:
                terminal.start()
                time.sleep(.3)
                terminal.input_event({'text': 'print("Vesper 中文 live")'})
                deadline = time.monotonic() + 5
                screen = {}
                while time.monotonic() < deadline:
                    screen = terminal.screen()
                    if 'Vesper 中文 live' in screen['screen'] and '>>>' in screen['screen']:
                        break
                    time.sleep(.1)
                self.assertIn('Vesper 中文 live', screen['screen'])
                self.assertTrue(screen['running'])
                self.assertFalse(terminal.start()['created'])
                terminal.input_event({'key': 'C-c'})
                self.assertEqual(terminal.screen()['session'], name)
            finally:
                terminal.run('kill-session', '-t', '=' + name, check=False)


if __name__ == '__main__':
    unittest.main()
