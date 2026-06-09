// Stringify any thrown value into a human-readable message. Native
// `String(e)` returns "[object Object]" for Supabase PostgrestError +
// FunctionsHttpError shapes (they're plain objects, not Error
// instances), which leaks into the UI as a useless red `[object Object]`
// next to whatever the user just tried to do.
//
// Order of resolution:
//   1. Real Error instances → e.message
//   2. PostgrestError-shaped objects ({message, code?, hint?, details?})
//      → message, with PG code and hint appended when present
//   3. Anything else with a .message-like string → that string
//   4. Last resort → JSON.stringify (so a stray non-Error object at
//      least surfaces *something* the user can copy-paste to support)
//
// Used across the catalogue, customer, and any other client component
// that catches a supabase.rpc / table-write failure.
export function formatErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const obj = e as Record<string, unknown>
    const msg = typeof obj.message === 'string' ? obj.message : null
    if (msg) {
      // Append PG error code + hint when we have them — useful for
      // 23505 unique-constraint failures where the bare message is
      // technical but the hint usually clarifies (e.g. "the key
      // (legacy_code)=(ISOD-70s-PRODUCER) already exists").
      const code  = typeof obj.code  === 'string' ? obj.code  : null
      const hint  = typeof obj.hint  === 'string' ? obj.hint  : null
      const detail = typeof obj.details === 'string' ? obj.details : null
      const extras: string[] = []
      if (code) extras.push(code)
      if (detail) extras.push(detail)
      if (hint) extras.push(hint)
      return extras.length > 0 ? `${msg} (${extras.join(' · ')})` : msg
    }
    // Last resort — at least don't render "[object Object]".
    try { return JSON.stringify(e) } catch { /* fall through */ }
  }
  return String(e)
}
