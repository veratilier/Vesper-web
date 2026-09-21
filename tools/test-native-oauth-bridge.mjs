import assert from 'node:assert/strict';
import { authorizeWithBridge, withOAuthDeadline } from '../app/native-mcp-oauth.ts';
const calls = [];
const bridge = { nativePromise: async (...args) => { calls.push(args); return { url: 'com.rvera.vesper://mcp/oauth/callback?code=test' }; } };
assert.equal((await authorizeWithBridge(bridge, {url:'https://example.com/authorize'})).url.includes('code=test'), true);
assert.deepEqual(calls, [['VesperOAuth','authorize',{url:'https://example.com/authorize'}]]);
await assert.rejects(authorizeWithBridge({}, {url:'https://example.com'}), /bridge is unavailable/);
await assert.rejects(authorizeWithBridge({nativePromise: async () => { throw {code:'UNIMPLEMENTED'}; }}, {url:'https://example.com'}), /not registered/);
const cancelled = new Error('Authorization cancelled.');
await assert.rejects(authorizeWithBridge({nativePromise: async () => {throw cancelled;}}, {url:'https://example.com'}), e => e === cancelled);
console.log('Native bridge: header-free dispatch, missing bridge, missing plugin, and cancellation passed');

assert.equal(await withOAuthDeadline(Promise.resolve("ready"), 20), "ready");
await assert.rejects(withOAuthDeadline(new Promise(() => {}), 5), /did not respond/);
