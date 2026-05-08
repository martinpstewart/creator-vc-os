// First-line SQL safety check. The real defense is the database role
// (nl_query_reader has SELECT only — INSERT/UPDATE/DELETE/DDL fail at
// the role boundary), but rejecting obvious garbage before we open
// a connection saves a round-trip and produces a friendlier error.

const DESTRUCTIVE = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE|COPY|MERGE|VACUUM|ANALYZE|CLUSTER|REINDEX|COMMENT|REFRESH|EXECUTE|CALL|SECURITY|DEFINER|RULE)\b/i

export type ValidationResult =
  | { ok: true; sql: string }
  | { ok: false; reason: string }

export function validateSql(rawSql: string): ValidationResult {
  if (typeof rawSql !== 'string' || rawSql.trim().length === 0) {
    return { ok: false, reason: 'empty SQL' }
  }

  // Strip a single trailing semicolon and trailing whitespace.
  const sql = rawSql.replace(/\s*;\s*$/, '').trim()

  // Reject multi-statement queries. Naive `;` count is OK because the
  // role lacks write privileges anyway — this just gives a clearer
  // error than a Postgres syntax/permission error.
  if (sql.includes(';')) {
    return { ok: false, reason: 'multiple statements not allowed' }
  }

  // Must start with SELECT or WITH (allowing leading comments / whitespace).
  const stripped = sql.replace(/^(\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/g, '')
  if (!/^(SELECT|WITH)\b/i.test(stripped)) {
    return { ok: false, reason: 'only SELECT and WITH queries are allowed' }
  }

  if (DESTRUCTIVE.test(sql)) {
    return { ok: false, reason: 'destructive keyword detected' }
  }

  return { ok: true, sql }
}
