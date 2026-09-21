import assert from 'node:assert/strict';
import { wakeActivities } from '../app/wake-summary.ts';
const base = { type: 'mcpToolCall', output: 'private content must not appear', updatedAt: '2026-09-09T00:00:00Z' };
const rows = wakeActivities([
  { ...base, id: 'one', title: 'atlas_memory_graph', status: 'inProgress' },
  { ...base, id: 'one', title: 'atlas_memory_graph', status: 'completed' },
  { ...base, id: 'two', title: 'desire_encounter', status: 'failed' },
  { ...base, id: 'three', title: 'unknown_tool', status: 'inProgress' },
]);
assert.equal(rows.length, 3);
assert.deepEqual(rows.map(item => item.status), ['Completed', 'Incomplete', 'Running']);
assert.equal(rows[0].label, 'Read memories');
assert.equal(rows[2].label, 'Call tool');
assert.ok(!JSON.stringify(rows).includes('private content'));
assert.deepEqual(wakeActivities([]), []);
console.log('Wake activity summary: passed');
