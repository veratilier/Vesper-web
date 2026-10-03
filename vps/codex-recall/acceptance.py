"""Capture only fictitious model requests, never real credentials or conversations.

python acceptance.py --command /path/to/codex-app-server
python acceptance.py --command /usr/bin/codex app-server --observe
"""
import argparse
import collections
import http.server
import json
import os
import pathlib
import queue
import subprocess
import tempfile
import threading
import time

A = 'FICTIONAL_RECALL_ALPHA_9361'
B = 'FICTIONAL_RECALL_BETA_2470'
LONG = '虚构摘要甲乙丙丁🙂' * 65
captures = []
tool_calls = []
phase = ''


class Provider(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))))
        captures.append((phase, self.path, body))
        n = len(captures)
        item = {'id': f'msg_fixture_{n}', 'type': 'message', 'role': 'assistant',
                'status': 'completed', 'content': [{'type': 'output_text',
                'text': 'Fixture acknowledged.', 'annotations': []}]}
        if phase == 'tool_roundtrip' and sum(label == phase for label, _, _ in captures) == 1:
            item = {'type': 'function_call', 'name': 'recall_probe_noop',
                    'call_id': 'fictional_tool_call', 'arguments': '{}'}
        if phase == 'code_mode' and sum(label == phase for label, _, _ in captures) == 1:
            item = {'type': 'custom_tool_call', 'name': 'exec',
                    'call_id': 'fictional_code_mode_call',
                    'input': 'text(await tools.recall_probe_noop({}));'}
        if phase in ('catalog_refresh', 'cold_catalog_refresh') and sum(label == phase for label, _, _ in captures) == 1:
            item = {'type': 'custom_tool_call', 'name': 'exec', 'call_id': 'fictional_refreshed_call',
                    'input': 'text(await tools.new_capture_probe({}));'}
        if self.path.endswith('/compact'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'output': [{'type': 'compaction',
                                'encrypted_content': 'FICTIONAL_CHECKPOINT'}]}).encode())
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        for event in [
            {'type': 'response.created', 'response': {'id': f'resp_fixture_{n}', 'status': 'in_progress', 'output': []}},
            {'type': 'response.output_item.done', 'output_index': 0, 'item': item},
            {'type': 'response.completed', 'response': {'id': f'resp_fixture_{n}', 'status': 'completed', 'output': [item],
                'usage': {'input_tokens': 1, 'output_tokens': 1, 'total_tokens': 2}}},
        ]:
            self.wfile.write(('event: ' + event['type'] + '\ndata: ' + json.dumps(event) + '\n\n').encode())
            self.wfile.flush()


def fragments(value):
    parts = []; part = ''
    for char in value:
        if len((part + char).encode()) > 768:
            parts.append(part); part = ''
        part += char
    if part:
        parts.append(part)
    return {f'vesper_memory_{i:03}': {'kind': 'untrusted', 'value': part} for i, part in enumerate(parts)}


class Host:
    def __init__(self, command, home, port):
        env = {k: v for k, v in os.environ.items() if not any(x in k.upper() for x in ('TOKEN', 'API_KEY', 'AUTH'))}
        env['CODEX_HOME'] = str(home)
        config = f'model_providers.recall_probe={{name="Recall fixture",base_url="http://127.0.0.1:{port}/v1",wire_api="responses",requires_openai_auth=false}}'
        self.err = open(home / 'fixture-stderr.log', 'a')
        self.process = subprocess.Popen(command + ['-c', 'model_provider="recall_probe"', '-c', config,
            '-c', 'model="gpt-6.1-sol"', '-c', 'analytics.enabled=false',
            '-c', 'features.code_mode=true', '-c', 'features.code_mode_host=true'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.err, text=True, env=env, cwd=home)
        self.queue = queue.Queue(); self.pending = collections.deque(); self.counter = 0
        def read():
            for line in self.process.stdout:
                try:
                    self.queue.put(json.loads(line))
                except ValueError:
                    pass
        threading.Thread(target=read, daemon=True).start()
        self.rpc('initialize', {'clientInfo': {'name': 'vesper_recall_acceptance', 'version': '2'}, 'capabilities': {'experimentalApi': True}})
        self.send({'method': 'initialized'})

    def send(self, obj):
        self.process.stdin.write(json.dumps(obj) + '\n'); self.process.stdin.flush()

    def rpc(self, method, params):
        self.counter += 1; ident = self.counter
        self.send({'id': ident, 'method': method, 'params': params})
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            obj = self.queue.get(timeout=max(.1, deadline - time.monotonic()))
            if obj.get('id') == ident:
                if 'error' in obj:
                    raise RuntimeError(f'{method}: {obj["error"]}')
                return obj.get('result', {})
            self.pending.append(obj)
        raise TimeoutError(method)

    def completion(self, thread):
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            obj = self.pending.popleft() if self.pending else self.queue.get(timeout=max(.1, deadline - time.monotonic()))
            params = obj.get('params', {})
            if obj.get('method') == 'turn/completed' and params.get('threadId') == thread:
                if params.get('turn', {}).get('status') == 'failed':
                    raise RuntimeError('Fixture turn failed')
                return
            if obj.get('method') == 'item/tool/call' and 'id' in obj:
                if params.get('tool') not in ('recall_probe_noop', 'new_capture_probe'):
                    raise RuntimeError('Unexpected fixture tool')
                tool_calls.append(phase)
                self.send({'id': obj['id'], 'result': {'success': True,
                    'contentItems': [{'type': 'inputText', 'text': 'Fictitious tool result.'}]}})
            if obj.get('method') == 'error':
                raise RuntimeError('Host emitted error during fixture')
        raise TimeoutError('completion')

    def turn(self, thread, label, context):
        global phase
        phase = label
        self.rpc('turn/start', {'threadId': thread, 'input': [{'type': 'text', 'text': 'Fixture input: ' + label}], 'additionalContext': context})
        self.completion(thread)

    def close(self):
        self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill(); self.process.wait()
        self.err.close()


def main():
    global phase
    parser = argparse.ArgumentParser()
    parser.add_argument('--observe', action='store_true')
    parser.add_argument('--command', nargs='+', required=True)
    args = parser.parse_args()
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    checks = []; host = None
    try:
        with tempfile.TemporaryDirectory(prefix='vesper-recall-acceptance-') as tmp:
            home = pathlib.Path(tmp)
            host = Host(args.command, home, server.server_port)
            params = {'model': 'gpt-6.1-sol', 'modelProvider': 'recall_probe', 'cwd': tmp, 'approvalPolicy': 'never', 'sandbox': 'read-only'}
            params['dynamicTools'] = [{'name': 'recall_probe_noop', 'description': 'Isolated no-op fixture',
                'inputSchema': {'type': 'object', 'properties': {}, 'additionalProperties': False}}]
            thread = host.rpc('thread/start', params)['thread']['id']
            host.turn(thread, 'first', fragments(A))
            refreshed = params['dynamicTools'] + [{'name': 'new_capture_probe', 'description': 'NEW_CAPTURE_CATALOG_FIXTURE',
                'inputSchema': {'type': 'object', 'properties': {}, 'additionalProperties': False}}]
            host.rpc('thread/resume', {'threadId': thread, 'dynamicTools': refreshed, 'excludeTurns': True})
            host.turn(thread, 'catalog_refresh', fragments(A))
            assert 'new_capture_probe' in json.dumps(captures[-1][2]), 'Resumed model request kept stale tools'
            host.rpc('thread/resume', {'threadId': thread, 'dynamicTools': params['dynamicTools'], 'excludeTurns': True})
            host.turn(thread, 'catalog_remove', fragments(A))
            assert 'new_capture_probe' not in json.dumps(captures[-1][2]), 'Removed tool leaked into next request'
            host.turn(thread, 'replace', fragments(B))
            host.turn(thread, 'clear', {})
            host.turn(thread, 'tool_roundtrip', fragments(B))
            host.turn(thread, 'code_mode', fragments(B))
            host.turn(thread, 'long', fragments(LONG))
            host.turn(thread, 'same', fragments(LONG))
            other = host.rpc('thread/start', params)['thread']['id']
            host.turn(other, 'other_thread', {})
            host.turn(thread, 'before_compact', fragments(A))
            phase = 'compact'
            host.rpc('thread/compact/start', {'threadId': thread})
            host.completion(thread)
            host.turn(thread, 'after_compact', {})
            host.turn(thread, 'before_fork', fragments(B))
            fork = host.rpc('thread/fork', {'threadId': thread, **params})['thread']['id']
            host.turn(fork, 'fork', {})
            host.close(); host = None
            # A new process must rebuild history without the automatic snippets.
            host = Host(args.command, home, server.server_port)
            host.rpc('thread/resume', {'threadId': thread, **params})
            host.rpc('thread/resume', {'threadId': thread, 'dynamicTools': refreshed, 'excludeTurns': True})
            host.turn(thread, 'cold_catalog_refresh', fragments(A))
            assert 'new_capture_probe' in json.dumps(captures[-1][2]), 'Cold resume failed to refresh tools'
            host.rpc('thread/resume', {'threadId': thread, 'dynamicTools': params['dynamicTools'], 'excludeTurns': True})
            host.turn(thread, 'resume', {})
            host.close(); host = None
            expected = {'catalog_refresh': (1, 0), 'catalog_remove': (1, 0), 'cold_catalog_refresh': (1, 0), 'first': (1, 0), 'replace': (0, 1), 'clear': (0, 0),
                        'tool_roundtrip': (0, 1), 'code_mode': (0, 1), 'long': (0, 0), 'same': (0, 0), 'other_thread': (0, 0),
                        'before_compact': (1, 0), 'compact': (0, 0), 'after_compact': (0, 0),
                        'before_fork': (0, 1), 'fork': (0, 0), 'resume': (0, 0)}
            for label, path, body in captures:
                serialized = json.dumps(body, ensure_ascii=False)
                counts = (serialized.count(A), serialized.count(B))
                # Reconstruct only our marked fragments; no real content is printed.
                pieces = []
                for item in body.get('input', []):
                    for part in item.get('content', []) if isinstance(item, dict) else []:
                        text = part.get('text', '')
                        if text.startswith('<external_vesper_memory_'):
                            pieces.append(text.split('>', 1)[1].rsplit('</', 1)[0])
                correct = counts == expected[label]
                if label in ('long', 'same'):
                    correct = correct and ''.join(pieces) == LONG
                elif label not in ('catalog_refresh', 'catalog_remove', 'cold_catalog_refresh', 'first', 'replace', 'tool_roundtrip', 'code_mode', 'before_compact', 'before_fork'):
                    correct = correct and not pieces
                checks.append({'phase': label, 'passed': correct, 'alpha': counts[0], 'beta': counts[1], 'recall_bytes': len(''.join(pieces).encode())})
            checks.append({'phase': 'tool_continuation_captured', 'passed': sum(x[0] == 'tool_roundtrip' for x in captures) == 2})
            code_requests = [body for label, _, body in captures if label == 'code_mode']
            code_outputs = [item for body in code_requests for item in body.get('input', [])
                            if item.get('type') == 'custom_tool_call_output'
                            and item.get('call_id') == 'fictional_code_mode_call']
            checks.append({'phase': 'code_mode_host_tool_roundtrip', 'passed':
                len(code_requests) == 2 and tool_calls.count('code_mode') == 1
                and len(code_outputs) == 1
                and 'Fictitious tool result.' in json.dumps(code_outputs[0])})
            checks.append({'phase': 'refreshed_catalog_code_mode_roundtrip', 'passed': tool_calls.count('catalog_refresh') == 1 and tool_calls.count('cold_catalog_refresh') == 1})
            checks.append({'phase': 'all_phases_captured', 'passed': set(expected).issubset({x[0] for x in captures})})
            rollouts = list(home.glob('sessions/**/*.jsonl'))
            checks.append({'phase': 'rollout_excludes_recall', 'passed': bool(rollouts) and not any(
                any(v in p.read_text() for v in (A, B, 'external_vesper_memory_', '虚构摘要甲乙丙丁')) for p in rollouts)})
            print(json.dumps({'isolated_fixture_only': True, 'checks': checks}, ensure_ascii=False))
            if not args.observe and not all(x['passed'] for x in checks):
                raise SystemExit(1)
    finally:
        if host:
            host.close()
        server.shutdown()


if __name__ == '__main__':
    main()
