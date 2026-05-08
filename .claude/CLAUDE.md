# Order Manager CRM

## Project Goal
A demo CRM built on top of an existing Supabase "Order Manager" project.
Showcase what's possible for agency clients.

## Stack
- Framework: Next.js (App Router)
- Database: Supabase (existing Order Manager project)
- Styling: Tailwind CSS
- Language: TypeScript

## Supabase Config
- Project URL: https://xwokhafcllstcnlcberv.supabase.co
- Keys live in `.env.local` (and Vercel project env). Use the
  `sb_publishable_*` key as `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Never
  commit secret/service-role keys.

## Security
- RLS is enabled on `aa_01_campaigns.campaign_orders`,
  `aa_01_campaigns.campaign_order_lines`, and
  `aa_02_crm.customer_campaign_orders`. Authenticated users have
  SELECT; anon is denied.
- All data-layer reads go through `SECURITY DEFINER` RPCs in the
  `public` schema, so RLS doesn't gate them — but this means RPC
  surface area is the trust boundary. Don't add new RPCs without
  thinking about who can call them.

## Conventions
- Use Supabase JS client for all data operations
- Components go in /components
- Supabase queries go in /lib/supabase.ts
- Keep it clean and demo-ready — this is a showcase build