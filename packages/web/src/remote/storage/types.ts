/** Browser-only, opt-in storage. Sensitive scope values live inside ciphertext. */
export type StorageKind = 'draft' | 'history';
export interface StorageScope {
  origin: string;
  principal: string;
  profile: string;
  durableSession: string;
}
export interface StoredHistory {
  messages: Array<{ role: 'user' | 'assistant'; text: string }>;
  syncedAt: number;
  limited: boolean;
  partial: boolean;
}
export interface SavedEntry {
  id: string;
  kind: StorageKind;
  savedAt: number;
  expiresAt: number;
  bytes: number;
}
export interface SealedEntry extends SavedEntry {
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
}
export interface WrappedKey {
  version: 1;
  salt: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
  draftEnabled: boolean;
  historyEnabled: boolean;
}
export interface StoreContents { key: WrappedKey | null; entries: SealedEntry[] }
export interface EncryptedPersistence {
  read(): Promise<StoreContents>;
  /** The callback runs synchronously in one storage transaction. */
  change(update: (contents: StoreContents) => StoreContents): Promise<void>;
}
export class StorageError extends Error {
  constructor(public readonly code: 'locked' | 'disabled' | 'invalid_scope' | 'invalid_passphrase' | 'too_large' | 'quota' | 'unavailable' | 'expired' | 'not_found' | 'wrong_key' | 'scope_changed') {
    super(code); this.name = 'StorageError';
  }
}
export const STORAGE_MESSAGES: Record<StorageError['code'], string> = {
  locked: '端末保存は施錠中です。パスフレーズで解錠してください。',
  disabled: 'この保存は無効です。内容を確認して有効にしてください。',
  invalid_scope: '認証利用者・profile・保存会話を確認してから利用してください。',
  invalid_passphrase: 'パスフレーズは12〜256文字で指定してください。忘れた場合の復旧はできません。',
  too_large: '保存上限を超えています。全文を保存した扱いにはしていません。',
  quota: '端末保存の件数・容量上限に達しました。不要な保存を消去してください。',
  unavailable: 'ブラウザの保存領域を利用できません。下書きはメモリに保持します。',
  expired: '保存期限が切れています。Hermesから改めて取得してください。',
  not_found: 'この端末の保存が見つかりません。ブラウザ消去後の復旧は保証できません。',
  wrong_key: 'パスフレーズが一致しないか、保存内容を解錠できません。',
  scope_changed: '会話・認証範囲が変わったため、端末保存の操作を中止しました。',
};
export function storageErrorMessage(error: unknown): string {
  return error instanceof StorageError ? STORAGE_MESSAGES[error.code] : STORAGE_MESSAGES.unavailable;
}
