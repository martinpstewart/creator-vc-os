// RBAC primitives — shared by middleware (edge), server layout, and client
// nav components. Pure types + functions, no Supabase imports, so this file
// is safe to pull into the Edge runtime.
//
// Backend contract:
//   - public.app_user_roles (user_id uuid PK, role text)
//   - role ∈ {'admin','team','support'}
//   - RLS lets a user SELECT only their own row
//   - All app RPCs are GRANTed to authenticated
//   - public.home_dashboard() is admin-gated server-side — only call it for
//     admins, and treat errors defensively if it does ever fire elsewhere.

export type Role = 'admin' | 'team' | 'support'

// Owner — Martin. A small number of surfaces are scoped to a single
// human even tighter than the admin role: the Acutrack import (a
// wipe-and-replace operation) and the dispatch monitor banner on /.
// Role-based ACCESS still applies as a baseline gate; this is the
// stricter second check, used at the page, sidebar, and component
// levels. If ownership ever changes, this is the only line to flip.
export const OWNER_EMAIL = 'martinpstewart@gmail.com'

export function isOwner(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase() === OWNER_EMAIL
}

// Screens we gate. Keep stable identifiers — they are matched by
// screenForPath() below and by the nav menu entries.
export type Screen =
  | 'dashboard'
  | 'campaigns'
  | 'customers'
  | 'marketing'
  | 'query'
  | 'catalogue'
  | 'users'
  | 'tickets'
  | 'settings'

// Single source of truth for screen access. `query` (Ask / NL SQL) and
// `users` (Auth admin) stay admin-only. Catalogue is now team-visible
// with read + create + update on products/variants; delete is gated
// in the UI (ProductsManager hides the Trash2 buttons for non-admin)
// and `users` is the admin CRUD. `tickets` is staff-wide — admin + team
// + support all need it.
export const ACCESS: Record<Role, ReadonlyArray<Screen>> = {
  admin: ['dashboard', 'campaigns', 'customers', 'marketing', 'query', 'catalogue', 'users', 'tickets', 'settings'],
  team: ['campaigns', 'customers', 'marketing', 'tickets', 'catalogue'],
  support: ['customers', 'tickets'],
}

// Where to send a role when they hit a forbidden screen. Their first
// allowed screen, per the spec.
export const FIRST_ALLOWED: Record<Role, string> = {
  admin: '/',
  team: '/campaigns',
  support: '/customers',
}

export function canAccess(role: Role, screen: Screen): boolean {
  return ACCESS[role]?.includes(screen) ?? false
}

// Map a pathname to a Screen key. Returns null for paths we don't gate
// (login, api, the public /p/* microsites — those are filtered out by the
// middleware matcher anyway). Subpaths like /campaigns/5 fold into their
// parent screen.
export function screenForPath(pathname: string): Screen | null {
  if (pathname === '/' || pathname === '') return 'dashboard'
  if (pathname.startsWith('/campaigns')) return 'campaigns'
  if (pathname.startsWith('/customers')) return 'customers'
  if (pathname.startsWith('/marketing')) return 'marketing'
  if (pathname.startsWith('/query')) return 'query'
  if (pathname.startsWith('/catalogue')) return 'catalogue'
  if (pathname.startsWith('/users')) return 'users'
  if (pathname.startsWith('/tickets')) return 'tickets'
  if (pathname.startsWith('/settings')) return 'settings'
  return null
}

// Narrow an arbitrary string to a Role, defaulting to the safest tier.
// Used everywhere we read the role column off a Postgres row.
export function normaliseRole(raw: string | null | undefined): Role {
  if (raw === 'admin' || raw === 'team' || raw === 'support') return raw
  return 'support'
}
