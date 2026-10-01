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

    def test_screen_captures_bounded_real_scrollback(self):
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
            self.assertTrue(value['capabilities']['resize'])
            self.assertEqual(value['screen'], 'Codex 正在执行…\n> ')
            run.assert_any_call('capture-pane', '-p', '-J', '-S', '-1000', '-t', '%7')

    def test_idle_screen_advertises_resize_without_starting_terminal(self):
        with patch.object(terminal, 'exists', return_value=False), patch.object(terminal, 'run') as run:
            value = terminal.screen()
            self.assertFalse(value['running'])
            self.assertTrue(value['capabilities']['resize'])
            run.assert_not_called()

    def test_resize_only_current_thread_and_bounds(self):
        thread='00000000-0000-0000-0000-000000000007'
        with patch.object(terminal,'pane',return_value='%7') as pane, patch.object(terminal,'run') as run:
            terminal.resize({'columns':42,'session':'other'},thread)
            pane.assert_called_once_with(thread)
            run.assert_called_once_with('resize-window','-t','%7','-x','42','-y','32')
            for invalid in (0,121,True,'48',None):
                with self.assertRaises(ValueError):terminal.resize({'columns':invalid},thread)

    def test_text_is_literal_and_enter_is_separate(self):
        events = []
        with patch.object(terminal, 'pane', return_value='%7'), patch.object(terminal, 'run', side_effect=lambda *args: events.append(args)) as run, patch.object(terminal.time, 'sleep', side_effect=lambda seconds: events.append(('wait', seconds))):
            terminal.input_event({'text': 'C-c ; $(touch /tmp/nope) 中文'})
            self.assertEqual(run.call_args_list[0].args,
                             ('send-keys', '-l', '-t', '%7', '--', 'C-c ; $(touch /tmp/nope) 中文'))
            self.assertEqual(run.call_args_list[1].args, ('send-keys', '-t', '%7', 'Enter'))
            self.assertEqual(events, [run.call_args_list[0].args, ('wait', 0.2), run.call_args_list[1].args])

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
                terminal.input_event({'text': 'print("Vesper 中文" + " live")'})
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

class CurrentChatTerminalTests(unittest.TestCase):
    thread = '11111111-2222-7333-8444-555555555555'

    def test_thread_selector_cannot_escape_tmux_target(self):
        self.assertEqual(terminal.session(self.thread), 'vesper-chat-' + self.thread.replace('-', ''))
        for bad in ['../x', 'foo:1', 'x; rm', None, {}, '']:
            if bad is None: continue  # Existing independent route remains backward compatible.
            with self.subTest(bad=bad), self.assertRaises(ValueError): terminal.session(bad)

    def test_chat_launch_uses_remote_attach_helper_without_secrets(self):
        with patch.dict(os.environ, {'VESPER_TERMINAL_ENABLED': '1'}), patch.object(terminal, 'exists', return_value=False), patch.object(terminal.shutil, 'which', return_value='/usr/bin/codex'), patch.object(terminal, 'run') as run:
            terminal.start(self.thread)
            args = run.call_args.args
            self.assertIn('vesper-chat-', args[3])
            self.assertIn('--attach', args[-1])
            self.assertIn(self.thread, args[-1])
            self.assertNotIn('Bearer', args[-1])

    def test_attach_passes_token_only_in_environment(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as directory:
            token = Path(directory) / 'token'; token.write_text('synthetic-secret')
            with patch.dict(os.environ, {'CODEX_TOKEN_FILE': str(token)}), patch.object(terminal.shutil, 'which', return_value='/usr/bin/codex'), patch.object(terminal.os, 'execvpe') as execute:
                terminal.attach(self.thread)
                _, args, env = execute.call_args.args
                self.assertIn('resume', args)
                self.assertIn('ws://127.0.0.1:4500', args)
                self.assertEqual(args[-1], self.thread)
                self.assertNotIn('synthetic-secret', repr(args))
                self.assertEqual(env['VESPER_TERMINAL_REMOTE_TOKEN'], 'synthetic-secret')

    def test_context_routes_use_durable_mapping_and_reject_missing_deleted_chats(self):
        import tempfile
        from pathlib import Path
        import codex_history_server as history
        with tempfile.TemporaryDirectory() as directory:
            token = Path(directory) / 'token'; token.write_text('test-token')
            with patch.object(history, 'TOKEN_PATH', token), patch.object(history, 'DB_PATH', Path(directory) / 'test.db'):
                with history.db() as con:
                    for conversation, thread in [('a', self.thread), ('new', None)]:
                        con.execute("INSERT INTO conversations(vesper_conversation_id,codex_thread_id,title,created_at,updated_at) VALUES(?,?,?, ?,?)", (conversation,thread,'Test','now','now'))
                handler = object.__new__(history.Handler); handler.send_json = Mock(); handler.headers = {'Authorization':'Bearer test-token'}
                for method, tail, call in [('GET','', 'screen'),('POST','/start','start'),('POST','/input','input_event'),('POST','/resize','resize')]:
                    handler.path='/conversations/a/terminal'+tail; handler.command=method; handler.body=Mock(return_value={'key':'Tab','threadId':'other'})
                    with patch.object(terminal, call, return_value={'ok':True}) as route:
                        handler.dispatch_request()
                        self.assertEqual(handler.send_json.call_args.args[0],200)
                        self.assertEqual(handler.send_json.call_args.args[1]['codexThreadId'], self.thread)
                        self.assertEqual(route.call_args.args[-1],self.thread)
                for conversation, code in [('missing',404),('new',409)]:
                    handler.path='/conversations/'+conversation+'/terminal'; handler.command='GET'; handler.dispatch_request()
                    self.assertEqual(handler.send_json.call_args.args[0],code)
                with history.db() as con: history.conversation_delete.block(con,'a',self.thread)
                handler.path='/conversations/a/terminal/start';handler.command='POST'
                with patch.object(terminal,'start') as start:
                    handler.dispatch_request();self.assertEqual(handler.send_json.call_args.args[0],404);start.assert_not_called()
                handler.headers={};handler.path='/conversations/a/terminal';handler.command='GET';handler.dispatch_request()
                self.assertEqual(handler.send_json.call_args.args[0],401)


if __name__ == '__main__':
    unittest.main()
