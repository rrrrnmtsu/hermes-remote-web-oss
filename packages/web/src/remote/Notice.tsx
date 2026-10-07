import type { ReactNode } from 'react';

export function Notice({ tone, title, children, action }: {
  tone: 'info' | 'warning' | 'critical' | 'action-required'; title: string; children?: ReactNode; action?: ReactNode;
}) {
  return <div className={`remote-notice remote-notice-${tone}`} data-tone={tone} role={tone === 'critical' ? 'alert' : 'status'}>
    {children ? <details><summary>{title}<span className="remote-sr-only"> 詳細を表示</span></summary><div className="remote-notice-detail">{children}</div></details>
      : <p>{title}</p>}
    {action}
  </div>;
}
