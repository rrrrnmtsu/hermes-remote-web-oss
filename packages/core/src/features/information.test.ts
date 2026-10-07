import { describe, expect, it, vi } from 'vitest';
import { InformationController, type InformationModels, type InformationPort, type InformationScope } from './information';

const scope: InformationScope = { origin: 'https://DEMO.invalid', principal: 'DEMO-user', profile: 'default', liveId: 'live', durableId: 'durable', generation: '1' };
const methods = ['remote.info.models', 'remote.info.snapshot', 'remote.info.commands', 'remote.info.cron', 'remote.info.activity', 'remote.session.model_set', 'remote.project.create_session'];
function models(model = 'first'): InformationModels { return { version: 1, profile: 'default', session_id: 'live', revision: 'revision', model, provider: 'DEMO-provider', api_mode: 'native', endpoint_origin: 'https://provider.example', scope: 'configured_same_route', truncated: false,
  rows: ['first', 'next'].map(name => ({ model: name, provider: 'DEMO-provider', current: name === model, listed: true, credential_present: null, response_confirmed: null, selectable: true, reason: '' })) }; }
function fixture(request = vi.fn().mockResolvedValue(models())) {
  const port: InformationPort = { request, canChangeModel: vi.fn(() => true), canCreateSession: vi.fn(() => true), withOperationLock: vi.fn(async action => action()) };
  const controller = new InformationController(port);
  controller.setScope(scope, methods);
  return { controller, request, port };
}

describe('bounded information adapter', () => {
  it('does not guess methods or read old backend capabilities', async () => {
    const { controller, request } = fixture(); controller.setScope(scope, []);
    await controller.load('models'); await controller.setModel('next'); await controller.createProjectSession('DEMO-project');
    expect(request).not.toHaveBeenCalled(); expect(controller.store.getState().load.models).toBe('unsupported');
  });
  it('reads configured models only, no provider inventory or generate', async () => {
    const { controller, request } = fixture(); await controller.load('models');
    expect(request.mock.calls).toEqual([['remote.info.models', { profile: 'default', session_id: 'live' }]]);
    expect(controller.store.getState().models?.rows[0]?.credential_present).toBeNull();
  });
  it.each(['profile', 'principal', 'origin', 'liveId', 'durableId', 'generation'] as const)('drops late %s scope response', async key => {
    let resolve!: (value: InformationModels) => void;
    const { controller } = fixture(vi.fn(() => new Promise<InformationModels>(yes => { resolve = yes; })));
    const pending = controller.load('models'); controller.setScope({ ...scope, [key]: 'changed' }, methods); resolve(models()); await pending;
    expect(controller.store.getState().models).toBeNull(); expect(controller.store.getState().load.models).toBe('idle');
  });
  it('rejects profile/live response mismatch', async () => {
    const { controller } = fixture(vi.fn().mockResolvedValue({ ...models(), profile: 'other' })); await controller.load('models');
    expect(controller.store.getState().models).toBeNull(); expect(controller.store.getState().load.models).toBe('error');
  });
  it('bounds catalog query and read limit', async () => {
    const { controller, request } = fixture(vi.fn().mockResolvedValue({ version: 1, profile: 'default', rows: [], skills_state: 'available', truncated: false }));
    await controller.load('commands', '日'.repeat(250));
    expect(request).toHaveBeenCalledWith('remote.info.commands', { profile: 'default', session_id: 'live', query: '日'.repeat(200), limit: 50 });
  });
  it('never resumes or activates conversations for the activity read', async () => {
    const { controller, request } = fixture(vi.fn().mockResolvedValue({ version: 1, profile: 'default', rows: [], observed_at: 1, truncated: false }));
    await controller.load('activity'); expect(request.mock.calls).toEqual([['remote.info.activity', { profile: 'default', limit: 50 }]]);
  });
  it('model change uses one guarded CAS and verified same-scope readback', async () => {
    const { controller, request, port } = fixture(vi.fn().mockResolvedValueOnce(models()).mockResolvedValueOnce(models('next')));
    await controller.load('models'); await controller.setModel('next');
    expect(port.withOperationLock).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenLastCalledWith('remote.session.model_set', { profile: 'default', session_id: 'live', model: 'next', expected_revision: 'revision' });
    expect(controller.store.getState().models?.model).toBe('next');
  });
  it('running/guard failure prevents the write', async () => {
    const { controller, request, port } = fixture(); await controller.load('models'); port.canChangeModel = () => false;
    await controller.setModel('next'); expect(request).toHaveBeenCalledTimes(1);
  });
  it('ACK loss performs one readback without repeating write', async () => {
    const request = vi.fn().mockResolvedValueOnce(models()).mockRejectedValueOnce(new Error('ACK lost')).mockResolvedValue(models('next'));
    const { controller } = fixture(request); await controller.load('models'); await controller.setModel('next'); await controller.setModel('next');
    expect(request.mock.calls.filter(call => call[0] === 'remote.session.model_set')).toHaveLength(1);
    expect(controller.store.getState().modelWriteUnknown).toBe(true);
    await controller.refreshModel(); expect(controller.store.getState().modelWriteUnknown).toBe(false);
  });
  it('a late model refresh cannot resolve an unknown write in another owner scope', async () => {
    let release!: (value: InformationModels) => void;
    const request = vi.fn().mockResolvedValueOnce(models())
      .mockImplementationOnce(() => new Promise<InformationModels>(yes => { release = yes; }))
      .mockResolvedValueOnce(models()).mockRejectedValueOnce(new Error('DEMO ACK lost')).mockResolvedValue(models('next'));
    const { controller } = fixture(request); await controller.load('models');
    const oldRead = controller.refreshModel();
    controller.setScope({ ...scope, principal: 'DEMO-second-owner', generation: '2' }, methods);
    await controller.load('models'); await controller.setModel('next');
    expect(controller.store.getState().modelWriteUnknown).toBe(true);
    release(models()); await oldRead;
    expect(controller.store.getState().modelWriteUnknown).toBe(true);
    expect(request.mock.calls.filter(call => call[0] === 'remote.session.model_set')).toHaveLength(1);
    await controller.refreshModel(); expect(controller.store.getState().modelWriteUnknown).toBe(false);
  });
  it('a superseded same-scope refresh cannot resolve a later unknown model write', async () => {
    let release!: (value: InformationModels) => void;
    const request = vi.fn().mockResolvedValueOnce(models())
      .mockImplementationOnce(() => new Promise<InformationModels>(yes => { release = yes; }))
      .mockRejectedValueOnce(new Error('DEMO ACK lost')).mockResolvedValue(models('next'));
    const { controller } = fixture(request); await controller.load('models');
    const oldRead = controller.refreshModel(); await controller.setModel('next');
    release(models()); await oldRead;
    expect(controller.store.getState().modelWriteUnknown).toBe(true);
    expect(request.mock.calls.filter(call => call[0] === 'remote.session.model_set')).toHaveLength(1);
  });
  it('serializes double model events and keeps captured target', async () => {
    let release!: (value: InformationModels) => void;
    const request = vi.fn().mockResolvedValueOnce(models()).mockImplementation(() => new Promise<InformationModels>(yes => { release = yes; }));
    const { controller } = fixture(request); await controller.load('models'); const pending = controller.setModel('next'); await controller.setModel('first');
    release(models('next')); await pending; expect(request).toHaveBeenCalledTimes(2);
  });
  it('project creation fixes registered ID and verifies server project', async () => {
    const result = { session_id: 'new-live', stored_session_id: 'new-durable', profile: 'default', project: { id: 'registered', name: 'DEMO', cwd: '/DEMO/project' } };
    const { controller, request } = fixture(vi.fn().mockResolvedValue(result)); expect(await controller.createProjectSession('registered')).toEqual(result);
    expect(request.mock.calls).toEqual([['remote.project.create_session', { profile: 'default', project_id: 'registered' }]]);
  });
  it('project creation readback mismatch/ACK loss never auto creates another session', async () => {
    const { controller, request } = fixture(vi.fn().mockResolvedValue({ session_id: 'created', stored_session_id: 'durable', profile: 'default', project: { id: 'other', cwd: '/DEMO' } }));
    expect(await controller.createProjectSession('registered')).toBeUndefined(); expect(request).toHaveBeenCalledTimes(1); expect(controller.store.getState().error).toContain('自動で作り直しません');
  });
  it('an unknown project-create ACK blocks another create in that scope and does not guess a result', async () => {
    const request = vi.fn().mockRejectedValue(new Error('DEMO ACK lost'));
    const { controller } = fixture(request);
    expect(await controller.createProjectSession('registered')).toBeUndefined();
    expect(await controller.createProjectSession('registered')).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
    expect(controller.store.getState().projectWriteUnknown).toBe(true);
    request.mockResolvedValue(models()); await controller.load('models');
    expect(controller.store.getState().projectWriteUnknown).toBe(true);
  });
  it('a lock failure before entering a project request is not reported as unknown delivery', async () => {
    const { controller, request, port } = fixture();
    port.withOperationLock = async () => { throw new Error('DEMO lock unavailable'); };
    expect(await controller.createProjectSession('registered')).toBeUndefined();
    expect(request).not.toHaveBeenCalled(); expect(controller.store.getState().projectWriteUnknown).toBe(false);
    expect(controller.store.getState().writing).toBe(false);
  });
  it('a late project failure cannot mark a different profile unknown', async () => {
    let reject!: (reason: Error) => void;
    const { controller } = fixture(vi.fn(() => new Promise((_, fail) => { reject = fail; })));
    const pending = controller.createProjectSession('registered'); controller.setScope({ ...scope, profile: 'DEMO-other' }, methods);
    reject(new Error('DEMO ACK lost')); await pending;
    expect(controller.store.getState().projectWriteUnknown).toBe(false); expect(controller.store.getState().error).toBe('');
  });
  it('logout clears catalogs, identifiers and scope without extra RPC', async () => {
    const { controller, request } = fixture(); await controller.load('models'); controller.clear();
    expect(controller.store.getState().scope).toBeNull(); expect(controller.store.getState().models).toBeNull(); expect(request).toHaveBeenCalledTimes(1);
  });
});
