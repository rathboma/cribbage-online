/**
 * Player tokens: random secrets handed to a player once, sent back as `Authorization: Bearer`.
 * Only their SHA-256 hash is stored.
 */

const TOKEN_BYTES = 32

/** 32 random bytes, base64url-encoded (43 characters, no padding). */
export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))
  return base64url(bytes)
}

/** Lower-case hex SHA-256 of the token, as stored in `players.token_hash`. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
