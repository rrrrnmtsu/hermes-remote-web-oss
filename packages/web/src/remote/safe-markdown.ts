import { defaultUrlTransform } from 'react-markdown';

export function safeMarkdownUrl(url: string): string {
  const normalized = defaultUrlTransform(url);
  return /^(https?:\/\/|mailto:)/i.test(normalized) ? normalized : '';
}
