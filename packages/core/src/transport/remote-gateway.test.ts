import { describe, it, expect } from 'vitest';
import { JsonRpcRequestChannel, type ServerRequest } from '../vendor/hermes/json-rpc-channel';
import { ProfileGateway } from './remote-gateway';

describe('official shared bidirectional channel with Remote Web fixes', () => {
  it.each(['7', 7])('replies using the original server ID %s without colliding with a client call', async id => {
    const outgoing: Record<string, unknown>[] = [];
    const channel = new JsonRpcRequestChannel({ createRequestId: () => id });
    channel.attach({ send: frame => outgoing.push(JSON.parse(frame) as Record<string, unknown>) });
    const result = channel.request('ping', {});
    channel.onRequest(request => request.respond({ choice: 'deny' }));
    channel.handleFrame(JSON.stringify({ jsonrpc: '2.0', id, method: 'approval', params: { session_id: 'DEMO-live' } }));
    expect(outgoing.at(-1)).toEqual({ jsonrpc: '2.0', id, result: { choice: 'deny' } });
    channel.handleFrame(JSON.stringify({ jsonrpc: '2.0', id, result: { pong: true } }));
    await expect(result).resolves.toEqual({ pong: true });
    channel.detach(new Error('done'));
  });

  it('does not send a stale response on a replacement socket or after request.cancel', () => {
    const first: string[] = [];
    const second: string[] = [];
    const channel = new JsonRpcRequestChannel();
    const requests: ServerRequest[] = [];
    channel.onRequest(request => { requests.push(request); });
    channel.attach({ send: frame => first.push(frame) });
    channel.deliverRequest('DEMO-request', 'approval', { session_id: 'DEMO-live' });
    channel.detach(new Error('disconnected'));
    channel.attach({ send: frame => second.push(frame) });
    requests[0]?.respond({ choice: 'once' });
    channel.deliverRequest('DEMO-request', 'approval', { session_id: 'DEMO-live' });
    channel.handleFrame(JSON.stringify({ method: 'event', params: { type: 'request.cancel', session_id: 'DEMO-live', payload: { id: 'DEMO-request', reason: 'resolved' } } }));
    requests[1]?.respond({ choice: 'once' });
    expect(first).toEqual([]);
    expect(second).toEqual([]);
  });

  it('invalidates the previous card when open_requests re-delivers its ID', () => {
    const sent: string[] = [];
    const channel = new JsonRpcRequestChannel();
    const requests: ServerRequest[] = [];
    channel.attach({ send: frame => sent.push(frame) });
    channel.onRequest(request => { requests.push(request); });
    channel.deliverRequest(9, 'clarify', { session_id: 'DEMO-live' });
    channel.deliverRequest(9, 'clarify', { session_id: 'DEMO-live' }, true);
    requests[0]?.respond({ answers: { q0: 'stale' } });
    requests[1]?.respond({ answers: { q0: 'new' } });
    expect(sent.map(frame => JSON.parse(frame))).toEqual([{ jsonrpc: '2.0', id: 9, result: { answers: { q0: 'new' } } }]);
  });

  it('retains seq and fails unsupported server requests immediately', () => {
    const sent: string[] = [];
    const events: unknown[] = [];
    const channel = new JsonRpcRequestChannel({ onEvent: event => events.push(event) });
    channel.attach({ send: frame => sent.push(frame) });
    channel.handleFrame(JSON.stringify({ method: 'event', params: { type: 'message.delta', session_id: 'DEMO-live', seq: 12, payload: { text: 'DEMO' } } }));
    channel.handleFrame(JSON.stringify({ id: 12, method: 'sudo', params: { session_id: 'DEMO-live' } }));
    expect(events).toEqual([{ type: 'message.delta', session_id: 'DEMO-live', seq: 12, payload: { text: 'DEMO' } }]);
    expect(JSON.parse(sent[0] || '{}')).toEqual({ jsonrpc: '2.0', id: 12, error: { code: -32601, message: 'no handler for server request: sudo' } });
  });

  it('stamps the owning profile on official replay RPCs without adding fields to capabilities', async () => {
    const socket = new EventTarget() as WebSocket;
    Object.defineProperty(socket, 'readyState', { value: 1 });
    const frames: Record<string, unknown>[] = [];
    socket.close = () => undefined;
    socket.send = data => {
      const frame = JSON.parse(String(data)) as Record<string, unknown>;
      frames.push(frame);
      queueMicrotask(() => socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: frame.id, result: {} }) })));
    };
    const gateway = new ProfileGateway('DEMO-profile', () => {
      queueMicrotask(() => socket.dispatchEvent(new Event('open')));
      return socket;
    });
    gateway.setTicket('DEMO-ticket');
    await gateway.connect('wss://demo.invalid/api/ws');
    await gateway.request('session.events.since', { session_id: 'DEMO-live', last_seen: 4 });
    await gateway.request('gateway.capabilities');
    expect(frames[0]?.params).toEqual({ session_id: 'DEMO-live', last_seen: 4, profile: 'DEMO-profile' });
    expect(frames[1]?.params).toEqual({});
    gateway.close();
  });
});
