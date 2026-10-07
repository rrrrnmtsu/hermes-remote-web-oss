// Sanitized fixture only: one transparent pixel, no original metadata or user media.
export const demoPng = () => Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5uoAAAAASUVORK5CYII='), char => char.charCodeAt(0));
export const demoImage = () => ({ name: 'DEMO-image.png', mime: 'image/png' as const, width: 1, height: 1, bytes: demoPng() });
