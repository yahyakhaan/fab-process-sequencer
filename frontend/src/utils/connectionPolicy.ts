export const MAX_PROTOCOL_MESSAGE_BYTES = 64 * 1024;
export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_TIMEOUT_MS = 45_000;

const MAX_RECONNECT_DELAY_MS = 10_000;

export function getReconnectDelay(
  attempt: number,
  randomValue = Math.random(),
): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const baseDelay = Math.min(
    750 * 2 ** safeAttempt,
    MAX_RECONNECT_DELAY_MS,
  );
  const boundedRandom = Math.min(1, Math.max(0, randomValue));
  const jitter = Math.round(
    boundedRandom * Math.min(500, baseDelay * 0.25),
  );
  return baseDelay + jitter;
}

export function isHeartbeatExpired(
  lastMessageAtMs: number,
  nowMs: number,
): boolean {
  return nowMs - lastMessageAtMs >= HEARTBEAT_TIMEOUT_MS;
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function assertProtocolPayloadSize(value: string): void {
  if (utf8ByteLength(value) > MAX_PROTOCOL_MESSAGE_BYTES) {
    throw new Error(
      `Protocol message exceeds the ${MAX_PROTOCOL_MESSAGE_BYTES}-byte limit.`,
    );
  }
}
