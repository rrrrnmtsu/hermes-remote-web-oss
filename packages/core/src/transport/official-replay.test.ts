import { describe, expect, it } from 'vitest';
import { JsonRpcGatewayClient } from '../vendor/hermes/json-rpc-gateway';
import type { ServerRequest } from '../vendor/hermes/json-rpc-channel';

class DemoSocket extends EventTarget {
  readyState = 0;
  sent: { id: string; method: string; params: Record<string, unknown> }[] = [];
  send(data: string): void { this.sent.push(JSON.parse(data) as typeof this.sent[number]); }
  close(): void { this.readyState = 3; this.dispatchEvent(new CloseEvent('close')); }
  open(): void { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  frame(frame: unknown): void { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(frame) })); }
}

function setup() {
  const sockets: DemoSocket[] = [];
  const gateway = new JsonRpcGatewayClient({ heartbeatIntervalMs: 0, heartbeatDeadlineMs: 0,
    socketFactory: () => { const socket = new DemoSocket(); sockets.push(socket); return socket as unknown as WebSocket; } });
  return { gateway, sockets };
}

describe('official replay on real shared gateway transport', () => {
  it('holds live frames during replay and dispatches missing events once in seq order', async () => {
    const { gateway, sockets } = setup();
    const seen: number[] = [];
    gateway.onAny(event => { if (event.seq) seen.push(event.seq); });
    const first = gateway.connect('wss://demo.invalid'); sockets[0]!.open(); await first;
    sockets[0]!.frame({ method: 'event', params: { type: 'message.delta', session_id: 'DEMO-sid', seq: 1, payload: { text: 'DEMO-1' } } });
    gateway.close();
    const second = gateway.connect('wss://demo.invalid'); sockets[1]!.open(); await second;
    const replay = sockets[1]!.sent.find(frame => frame.method === 'session.events.since');
    expect(replay?.params).toEqual({ session_id: 'DEMO-sid', last_seen: 1 });
    sockets[1]!.frame({ method: 'event', params: { type: 'message.delta', session_id: 'DEMO-sid', seq: 3, payload: { text: 'DEMO-3' } } });
    expect(seen).toEqual([1]);
    sockets[1]!.frame({ id: replay?.id, result: { epoch: 'DEMO-epoch', events: [2, 3].map(seq => ({ type: 'message.delta', session_id: 'DEMO-sid', seq, payload: { text: `DEMO-${seq}` } })) } });
    await gateway.sessionReplayBarrier('DEMO-sid');
    expect(seen).toEqual([1, 2, 3]);
    gateway.close();
  });

  it('resets watermarks on epoch change and ignores frames from a retired socket', async () => {
    const { gateway, sockets } = setup(); const events: string[] = [];
    gateway.onAny(event => { if (event.payload && 'text' in event.payload) events.push(String(event.payload.text)); });
    const first = gateway.connect('wss://demo.invalid'); sockets[0]!.open(); await first;
    sockets[0]!.frame({ method: 'event', params: { type: 'gateway.ready', payload: { replay_epoch: 'DEMO-epoch-1' } } });
    sockets[0]!.frame({ method: 'event', params: { type: 'message.delta', session_id: 'DEMO-sid', seq: 99, payload: { text: 'DEMO-old' } } });
    gateway.close();
    const second = gateway.connect('wss://demo.invalid'); sockets[1]!.open(); await second;
    sockets[1]!.frame({ method: 'event', params: { type: 'gateway.ready', payload: { replay_epoch: 'DEMO-epoch-2' } } });
    sockets[0]!.frame({ method: 'event', params: { type: 'message.delta', session_id: 'DEMO-sid', seq: 100, payload: { text: 'DEMO-stale' } } });
    sockets[1]!.frame({ method: 'event', params: { type: 'message.delta', session_id: 'DEMO-sid', seq: 1, payload: { text: 'DEMO-new' } } });
    expect(gateway.getSeqWatermarks()['DEMO-sid']).toBe(1);
    expect(events).toEqual(['DEMO-old', 'DEMO-new']);
    gateway.close();
  });

  it('restores open_requests from a numeric-ID RPC response before handing the snapshot to its caller', async () => {
    const { gateway, sockets } = setup(); const requests: ServerRequest[] = [];
    gateway.onRequest(request => { requests.push(request); });
    const connected = gateway.connect('wss://demo.invalid'); sockets[0]!.open(); await connected;
    const activated = gateway.request('session.activate', { session_id: 'DEMO-sid' });
    sockets[0]!.frame({ id: sockets[0]!.sent.at(-1)?.id, result: { open_requests: [{ id: 42, method: 'clarify', params: { session_id: 'DEMO-sid', questions: [{ qid: 'q0', question: 'DEMO?' }], answers: { q0: 'accepted' } } }] } });
    await activated;
    expect(requests[0]?.id).toBe(42);
    expect(requests[0]?.replayed).toBe(true);
    expect(requests[0]?.params.answers).toEqual({ q0: 'accepted' });
    gateway.close();
  });
});
