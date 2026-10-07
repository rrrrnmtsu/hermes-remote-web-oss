export function RemoteIcon({ name }: { name: 'back' | 'more' | 'send' | 'new' | 'down' | 'stop' | 'chat' | 'requests' | 'settings' | 'search' | 'chevron' | 'refresh' | 'check' | 'keyboard' | 'menu' | 'folder' | 'close' }) {
  const paths = {
    back: 'M15 5l-7 7 7 7M8 12h12', more: 'M5 12h.01M12 12h.01M19 12h.01',
    send: 'M12 19V5M5 12l7-7 7 7', new: 'M12 5v14M5 12h14', down: 'M12 5v14M5 12l7 7 7-7',
    stop: 'M7 7h10v10H7z',
    chat: 'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2zM7 9h10M7 13h6',
    requests: 'M8 4H5a1 1 0 0 0-1 1v15h16V5a1 1 0 0 0-1-1h-3M8 3h8v4H8zM8 12h8M8 16h5',
    settings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
    search: 'M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0z',
    chevron: 'M9 5l7 7-7 7', refresh: 'M20 10a8 8 0 1 0-2 8M20 3v7h-7', check: 'M5 12l4 4L19 6',
    keyboard: 'M3 3h18v12H3zM7 7h.01M12 7h.01M17 7h.01M7 11h10M9 19l3 3 3-3',
    menu: 'M4 6h16M4 12h16M4 18h16', folder: 'M3 7V4h6l3 3h9v13H3z', close: 'M6 6l12 12M18 6L6 18',
  };
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 4 : 2}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}
