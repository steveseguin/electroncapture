'use strict';

const assert = require('node:assert/strict');

if (process.argv.includes('--child')) {
  const { EventEmitter } = require('node:events');
  const { fetch, getGlobalDispatcher } = require('undici');
  const { setupFetchStreams } = require('../fetch-streams');
  const handlers = new Map();
  setupFetchStreams({ handle: (name, handler) => handlers.set(name, handler) }, fetch);
  const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false });
  // GHSA-xjj6-f33q-929c: too many encodings followed by an early disconnect
  // used to emit an uncaught stream error even after fetch rejected normally.
  const server = require('node:net').createServer(socket => {
    socket.once('data', () => socket.end(
      'HTTP/1.1 200 OK\r\nContent-Encoding: gzip, gzip, gzip, gzip, gzip, gzip\r\n' +
      'Content-Length: 100\r\nConnection: close\r\n\r\n'));
  });
  server.listen(0, '127.0.0.1', async () => {
    try {
      const result = await handlers.get('noCORSFetch')({ sender }, {
        url: `http://127.0.0.1:${server.address().port}`,
      });
      assert.equal(result.ok, false);
      assert.equal(typeof result.error, 'string');
      assert.equal(sender.listenerCount('destroyed'), 0, 'failed request releases its owner');
      await new Promise(resolve => setTimeout(resolve, 100));
      await getGlobalDispatcher().close();
      await new Promise(resolve => server.close(resolve));
      console.log('Malformed fetch response handled without an uncaught error');
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });
} else {
  // An uncaught error must fail the test, not be swallowed by a test runner.
  const result = require('node:child_process').spawnSync(process.execPath, [__filename, '--child'], {
    encoding: 'utf8', timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Malformed fetch response handled/);
  console.log('Fetch error regression checks passed');
}
