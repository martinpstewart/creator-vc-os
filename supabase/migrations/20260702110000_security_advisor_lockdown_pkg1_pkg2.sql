-- Security advisor cleanup — packages 1 + 2.
--
-- Pkg 1: enable RLS + revoke on 16 tables that had neither.
--        13 are public.* archives / queues / debug — dead-storage or
--        service_role-only writers. Zero browser callers.
--        3 are aa_01_campaigns.payhere_* — service_role written by
--        payhere-poll, read via SECURITY DEFINER RPCs only.
--
-- Pkg 2: replace 7 always-true (USING/WITH CHECK = true) RLS policies
--        with role-aware ones. Reads stay open to any authenticated
--        session. Writes go to admin + team. Catalogue DELETE stays
--        admin-only (matches task #91 "team CRU, not D").
--
-- Everything runs through public.current_app_role() and public.is_admin(),
-- which query app_user_roles via auth.uid(). service_role bypasses
-- RLS entirely, so webhooks + cron are unaffected.

-- ────────────────── PACKAGE 1 ──────────────────
alter table public._campaign_orders_archive              enable row level security;
alter table public._campaign_order_lines_archive         enable row level security;
alter table public._customer_campaign_orders_archive     enable row level security;
alter table public._campaign_orders_retire_ddl_backup    enable row level security;
alter table public._freshdesk_capture                    enable row level security;
alter table public._glide_wf_state                       enable row level security;
alter table public._glide_wf_hits                        enable row level security;
alter table public._glide_wf_meta                        enable row level security;
alter table public._mq_ord                               enable row level security;
alter table public._mq_line                              enable row level security;
alter table public._mq_sku                               enable row level security;
alter table public._acutrack_mopup_queue                 enable row level security;
alter table public._ph_test_invoke                       enable row level security;

revoke all on public._campaign_orders_archive              from anon, authenticated;
revoke all on public._campaign_order_lines_archive         from anon, authenticated;
revoke all on public._customer_campaign_orders_archive     from anon, authenticated;
revoke all on public._campaign_orders_retire_ddl_backup    from anon, authenticated;
revoke all on public._freshdesk_capture                    from anon, authenticated;
revoke all on public._glide_wf_state                       from anon, authenticated;
revoke all on public._glide_wf_hits                        from anon, authenticated;
revoke all on public._glide_wf_meta                        from anon, authenticated;
revoke all on public._mq_ord                               from anon, authenticated;
revoke all on public._mq_line                              from anon, authenticated;
revoke all on public._mq_sku                               from anon, authenticated;
revoke all on public._acutrack_mopup_queue                 from anon, authenticated;
revoke all on public._ph_test_invoke                       from anon, authenticated;

alter table aa_01_campaigns.payhere_poll_state           enable row level security;
alter table aa_01_campaigns.payhere_dismissed_alerts     enable row level security;
alter table aa_01_campaigns.payhere_retrigger_log        enable row level security;

revoke all on aa_01_campaigns.payhere_poll_state         from anon, authenticated;
revoke all on aa_01_campaigns.payhere_dismissed_alerts   from anon, authenticated;
revoke all on aa_01_campaigns.payhere_retrigger_log      from anon, authenticated;

-- ────────────────── PACKAGE 2 ──────────────────
drop policy "Authenticated CRUD" on aa_01_campaigns.campaigns;
create policy "authenticated read" on aa_01_campaigns.campaigns
  for select to authenticated using (true);
create policy "admin+team insert" on aa_01_campaigns.campaigns
  for insert to authenticated with check (public.current_app_role() in ('admin','team'));
create policy "admin+team update" on aa_01_campaigns.campaigns
  for update to authenticated
  using       (public.current_app_role() in ('admin','team'))
  with check  (public.current_app_role() in ('admin','team'));

drop policy "Authenticated CRUD" on aa_01_campaigns.products;
create policy "authenticated read" on aa_01_campaigns.products
  for select to authenticated using (true);
create policy "admin+team insert" on aa_01_campaigns.products
  for insert to authenticated with check (public.current_app_role() in ('admin','team'));
create policy "admin+team update" on aa_01_campaigns.products
  for update to authenticated
  using       (public.current_app_role() in ('admin','team'))
  with check  (public.current_app_role() in ('admin','team'));
create policy "admin delete" on aa_01_campaigns.products
  for delete to authenticated using (public.is_admin());

drop policy "Authenticated CRUD" on aa_01_campaigns.variants;
create policy "authenticated read" on aa_01_campaigns.variants
  for select to authenticated using (true);
create policy "admin+team insert" on aa_01_campaigns.variants
  for insert to authenticated with check (public.current_app_role() in ('admin','team'));
create policy "admin+team update" on aa_01_campaigns.variants
  for update to authenticated
  using       (public.current_app_role() in ('admin','team'))
  with check  (public.current_app_role() in ('admin','team'));
create policy "admin delete" on aa_01_campaigns.variants
  for delete to authenticated using (public.is_admin());

drop policy "Authenticated update" on aa_01_campaigns.shopify_product_inbox;
create policy "admin+team update" on aa_01_campaigns.shopify_product_inbox
  for update to authenticated
  using       (public.current_app_role() in ('admin','team'))
  with check  (public.current_app_role() in ('admin','team'));

drop policy "Team insert" on public.email_templates;
drop policy "Team update" on public.email_templates;
drop policy "Team delete" on public.email_templates;

create policy "admin+team insert" on public.email_templates
  for insert to authenticated with check (public.current_app_role() in ('admin','team'));
create policy "admin+team update" on public.email_templates
  for update to authenticated
  using       (public.current_app_role() in ('admin','team'))
  with check  (public.current_app_role() in ('admin','team'));
create policy "admin+team delete" on public.email_templates
  for delete to authenticated using (public.current_app_role() in ('admin','team'));
