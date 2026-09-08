import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HEARTBEAT_TIMEOUT_MS,
  MAX_PROTOCOL_MESSAGE_BYTES,
  assertProtocolPayloadSize,
  getReconnectDelay,
  isHeartbeatExpired,
  utf8ByteLength,
} from './connectionPolicy.ts';

test('reconnect delay backs off, adds bounded jitter, and caps out', () => {
  assert.equal(getReconnectDelay(0, 0), 750);
  assert.equal(getReconnectDelay(0, 1), 938);
  assert.equal(getReconnectDelay(3, 0), 6_000);
  assert.equal(getReconnectDelay(30, 1), 10_500);
});

test('heartbeat expires only after the full timeout', () => {
  assert.equal(isHeartbeatExpired(1_000, 999 + HEARTBEAT_TIMEOUT_MS), false);
  assert.equal(
    isHeartbeatExpired(1_000, 1_000 + HEARTBEAT_TIMEOUT_MS),
    true,
  );
});

test('payload accounting uses UTF-8 bytes and rejects oversized messages', () => {
  assert.equal(utf8ByteLength('µ'), 2);
  assert.doesNotThrow(() => assertProtocolPayloadSize('x'.repeat(MAX_PROTOCOL_MESSAGE_BYTES)));
  assert.throws(
    () => assertProtocolPayloadSize('x'.repeat(MAX_PROTOCOL_MESSAGE_BYTES + 1)),
    /exceeds the 65536-byte limit/,
  );
});
