// DEMO shell uses the same capability-gated adapter as production. No synthetic ownership port.
import { createRoot } from 'react-dom/client';
import { RemoteApp } from '../../packages/web/src/remote/RemoteApp';
import { browserRemoteOptions } from '../../packages/web/src/remote/runtime';
import { RemoteController } from '../../packages/core/src/stores/remote';
createRoot(document.getElementById('root')!).render(<RemoteApp controller={new RemoteController(browserRemoteOptions())} />);
