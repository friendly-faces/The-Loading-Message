// AES-256-GCM + PBKDF2-SHA256 (100k, 32 bytes) — mirrors pi/loading_message.py
// and scripts/encrypt.mjs. Used only in the offline kiosk build; the public
// site never imports this file.

export type EncryptedBlob = {
  iv: string;
  tag: string;
  data: string;
  salt: string;
};

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

async function deriveKey(
  secret: string,
  encryptDate: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const passphrase = new TextEncoder().encode(secret + encryptDate);
  const baseKey = await crypto.subtle.importKey(
    'raw',
    passphrase,
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
}

export async function decryptMessage(
  blob: EncryptedBlob,
  secret: string,
  encryptDate: string,
): Promise<string> {
  const salt = hexToBytes(blob.salt);
  const iv = hexToBytes(blob.iv);
  const data = hexToBytes(blob.data);
  const tag = hexToBytes(blob.tag);

  // WebCrypto AES-GCM expects ciphertext || tag concatenated, matching the
  // Python AESGCM(...).decrypt(iv, data + tag, None) call site.
  const combined = new Uint8Array(data.length + tag.length);
  combined.set(data, 0);
  combined.set(tag, data.length);

  const key = await deriveKey(secret, encryptDate, salt);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    combined,
  );
  return new TextDecoder().decode(plaintext);
}
