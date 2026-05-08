// Shared types for the nl-query Edge Function.

export type ParamSpec = {
  name: string
  type: 'int' | 'string' | 'date'
  required: boolean
  default?: unknown
  validation?: RegExp
}

export type Template = {
  name: string
  description: string
  example_questions: string[]
  params: ParamSpec[]
  // SQL with positional placeholders ($1, $2, …). The actual values
  // are bound by `build_params` and passed separately to the driver.
  sql: (params: Record<string, unknown>) => string
  build_params: (params: Record<string, unknown>) => unknown[]
}

export type TemplateMetadata = Pick<
  Template,
  'name' | 'description' | 'example_questions' | 'params'
>

export type MatchResult =
  | { match: false }
  | {
      match: true
      template_name: string
      params: Record<string, unknown>
      confidence: 'high' | 'medium' | 'low'
    }

export type QueryResponse = {
  rows: Record<string, unknown>[]
  columns: string[]
  sql: string
  query_type: 'template' | 'generated'
  template_name?: string
  truncated: boolean
  row_count: number
  duration_ms: number
}
