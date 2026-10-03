import assert from 'node:assert/strict';
import { createVoiceRecognition, type SpeechSession, type SpeechResultEvent } from '../lib/voice-recognition.ts';

function fixture() {
  const timers = new Map<number, () => void>();
  const sessions: SpeechSession[] = [];
  const transcripts: string[] = [], errors: string[] = [];
  let phase = 'listening', muted = false, nextTimer = 0, throwStarts = 0;
  const loop = createVoiceRecognition({
    schedule: callback => { const id = ++nextTimer; timers.set(id, callback); return id as unknown as ReturnType<typeof setTimeout>; },
    cancel: timer => { timers.delete(timer as unknown as number); },
    canListen: () => phase === 'listening' && !muted,
    create: () => {
      const session: SpeechSession = {
        lang: '', continuous: false, interimResults: false, onresult: null, onend: null, onerror: null,
        start() { if (throwStarts-- > 0) throw new Error('InvalidStateError'); }, stop() {}, abort() {},
      };
      sessions.push(session); return session;
    },
    onFinal: text => { phase = 'thinking'; transcripts.push(text); },
    onInterim() {}, onError: message => { phase = 'error'; errors.push(message); },
  });
  return {
    loop, sessions, transcripts, errors, timers,
    phase: (value: string) => { phase = value; }, mute: (value: boolean) => { muted = value; },
    throwStarts: (value: number) => { throwStarts = value; },
    tick() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); },
  };
}
const result = (text: string): SpeechResultEvent => ({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });

// Exercise the failure sequence: final speech -> stop -> reply/audio -> fresh STT,
// five consecutive turns, with delayed callbacks from the previous session.
{
  const f = fixture();
  for (let turn = 0; turn < 5; turn++) {
    f.phase('listening'); f.loop.resume(); f.loop.resume();
    assert.equal(f.timers.size, 1); f.tick();
    const session = f.sessions.at(-1)!;
    const lateResult = session.onresult!, lateEnd = session.onend!;
    session.onresult!(result(`turn ${turn}`));
    assert.equal(session.onresult, null);
    lateResult(result('duplicate')); lateEnd();
    f.loop.resume(); f.tick(); // thinking must not restart capture
    f.phase('speaking'); f.loop.resume(); f.tick();
    assert.equal(f.sessions.length, turn + 1);
  }
  assert.deepEqual(f.transcripts, ['turn 0', 'turn 1', 'turn 2', 'turn 3', 'turn 4']);
  assert.equal(f.errors.length, 0); f.loop.close();
}
// A browser start race is retried instead of silently leaving Listening dead.
{
  const f = fixture(); f.throwStarts(1); f.loop.resume(); f.tick();
  assert.equal(f.timers.size, 1); f.tick();
  f.sessions.at(-1)!.onresult!(result('recovered'));
  assert.deepEqual(f.transcripts, ['recovered']); f.loop.close();
}
// Silence restarts once; pending resume is checked against current mute/state.
{
  const f = fixture(); f.loop.resume(); f.tick(); f.sessions[0].onend!();
  f.mute(true); f.tick(); assert.equal(f.sessions.length, 1);
  f.mute(false); f.loop.resume(); f.tick(); assert.equal(f.sessions.length, 2);
  f.loop.suspend(); f.loop.resume(); f.phase('speaking'); f.tick();
  assert.equal(f.sessions.length, 2); f.loop.close();
}
// Hang-up cancels timers and ignores already queued callbacks.
{
  const f = fixture(); f.loop.resume(); f.tick();
  const late = f.sessions[0].onend!;
  f.loop.close(); late(); f.loop.resume(); f.tick();
  assert.equal(f.sessions.length, 1); assert.equal(f.timers.size, 0);
}
// Permission errors surface and do not enter an automatic retry loop.
{
  const f = fixture(); f.loop.resume(); f.tick();
  f.sessions[0].onerror!({ error: 'not-allowed' });
  assert.equal(f.errors.length, 1); assert.equal(f.timers.size, 0); f.loop.close();
}
// Repeated start failures are bounded and visible, rather than a hot loop.
{
  const f = fixture(); f.throwStarts(20); f.loop.resume();
  for (let i = 0; i < 10; i++) f.tick();
  assert.equal(f.sessions.length, 6); assert.equal(f.errors.length, 1);
  assert.equal(f.timers.size, 0); f.loop.close();
}
console.log('Voice recognition: five-turn loop, restart race, mute, stale callbacks, permission and bounded retry checks passed.');
