-- Extend campaign_engagement filter to accept an array of campaigns.
-- The frontend now lets the user tick multiple campaigns per row —
-- "signed up on Aliens Expanded OR ISOD 70s OR Terrorbytes" — instead
-- of forcing them to compose N rows joined by match='any'.
--
-- Backwards compat: definitions saved with the scalar
--   { "type":"campaign_engagement", "campaign_id":7, "role":"backer" }
-- shape still evaluate correctly — we normalise campaign_id to a
-- single-element array on the way in.
--
-- Empty selection is a skip (NULL clause) so the segment builder can
-- show a partially-built row without producing surprising counts.

create or replace function aa_03_marketing.evaluate_segment(p_definition jsonb)
returns table (contact_id bigint)
language plpgsql
stable
set search_path = ''
as $$
DECLARE
  v_match  text;
  v_filter jsonb;
  v_clauses text[] := ARRAY[]::text[];
  v_where text;
  v_sql   text;
  v_type  text;
  v_clause text;
  v_has_test_filter boolean := false;
BEGIN
  v_match := COALESCE(p_definition->>'match', 'all');
  IF v_match NOT IN ('all','any') THEN
    RAISE EXCEPTION 'invalid match value: %', v_match;
  END IF;

  FOR v_filter IN SELECT * FROM jsonb_array_elements(COALESCE(p_definition->'filters','[]'::jsonb))
  LOOP
    v_type := v_filter->>'type';
    v_clause := NULL;

    IF v_type = 'campaign_engagement' THEN
      DECLARE
        v_cids int[];
        v_role text := v_filter->>'role';
        v_role_pred text;
      BEGIN
        IF v_filter ? 'campaign_ids' AND jsonb_typeof(v_filter->'campaign_ids') = 'array' THEN
          v_cids := ARRAY(SELECT jsonb_array_elements_text(v_filter->'campaign_ids'))::int[];
        ELSIF v_filter ? 'campaign_id' AND (v_filter->>'campaign_id') <> '' THEN
          v_cids := ARRAY[(v_filter->>'campaign_id')::int];
        ELSE
          v_cids := ARRAY[]::int[];
        END IF;

        IF cardinality(v_cids) = 0 THEN
          v_clause := NULL;
        ELSE
          IF v_role = 'signed_up' THEN
            v_role_pred := 'e.signed_up = true';
          ELSIF v_role = 'backer' THEN
            v_role_pred := 'e.is_backer = true';
          ELSIF v_role = 'signed_up_or_backer' THEN
            v_role_pred := '(e.signed_up = true OR e.is_backer = true)';
          ELSIF v_role = 'backed_historic' THEN
            v_role_pred := 'e.backed_historic = true';
          ELSIF v_role = 'not_backer' THEN
            v_clause := format(
              'NOT EXISTS (SELECT 1 FROM aa_03_marketing.v_contact_campaign_engagement e
                            WHERE e.contact_id = c.id AND e.campaign_id = ANY(%L::int[]) AND e.is_backer = true)',
              v_cids);
          ELSIF v_role = 'not_signed_up' THEN
            v_clause := format(
              'NOT EXISTS (SELECT 1 FROM aa_03_marketing.v_contact_campaign_engagement e
                            WHERE e.contact_id = c.id AND e.campaign_id = ANY(%L::int[]) AND e.signed_up = true)',
              v_cids);
          ELSIF v_role = 'none' THEN
            v_clause := format(
              'NOT EXISTS (SELECT 1 FROM aa_03_marketing.v_contact_campaign_engagement e
                            WHERE e.contact_id = c.id AND e.campaign_id = ANY(%L::int[]))',
              v_cids);
          ELSE
            RAISE EXCEPTION 'invalid campaign_engagement role: %', v_role;
          END IF;

          IF v_clause IS NULL THEN
            v_clause := format(
              'EXISTS (SELECT 1 FROM aa_03_marketing.v_contact_campaign_engagement e
                        WHERE e.contact_id = c.id AND e.campaign_id = ANY(%L::int[]) AND %s)',
              v_cids, v_role_pred);
          END IF;
        END IF;
      END;

    ELSIF v_type = 'consent' THEN
      IF (v_filter->>'consented')::boolean THEN
        v_clause := 'c.marketing_consent = true';
      ELSE
        v_clause := 'c.marketing_consent = false';
      END IF;

    ELSIF v_type = 'total_spend_gte' THEN
      v_clause := format(
        '(SELECT COALESCE(sum(shopify_spend_pence),0)
            FROM aa_03_marketing.v_contact_campaign_engagement e
            WHERE e.contact_id = c.id) >= %L',
        (v_filter->>'value_pence')::bigint);

    ELSIF v_type = 'total_spend_lte' THEN
      v_clause := format(
        '(SELECT COALESCE(sum(shopify_spend_pence),0)
            FROM aa_03_marketing.v_contact_campaign_engagement e
            WHERE e.contact_id = c.id) <= %L',
        (v_filter->>'value_pence')::bigint);

    ELSIF v_type = 'total_orders_gte' THEN
      v_clause := format(
        '(SELECT COALESCE(sum(total_orders),0)
            FROM aa_03_marketing.v_contact_campaign_engagement e
            WHERE e.contact_id = c.id) >= %L',
        (v_filter->>'value')::int);

    ELSIF v_type = 'total_orders_lte' THEN
      v_clause := format(
        '(SELECT COALESCE(sum(total_orders),0)
            FROM aa_03_marketing.v_contact_campaign_engagement e
            WHERE e.contact_id = c.id) <= %L',
        (v_filter->>'value')::int);

    ELSIF v_type = 'signed_up_after' THEN
      v_clause := format(
        'EXISTS (SELECT 1 FROM aa_03_marketing.v_contact_campaign_engagement e
                  WHERE e.contact_id = c.id AND e.first_signed_up_at >= %L::timestamptz)',
        v_filter->>'date');

    ELSIF v_type = 'signed_up_before' THEN
      v_clause := format(
        'EXISTS (SELECT 1 FROM aa_03_marketing.v_contact_campaign_engagement e
                  WHERE e.contact_id = c.id AND e.first_signed_up_at < %L::timestamptz)',
        v_filter->>'date');

    ELSIF v_type = 'country_in' THEN
      v_clause := format(
        'EXISTS (SELECT 1 FROM aa_02_crm.customers cu
                  WHERE cu.id = c.customer_id
                    AND cu.shipping_country_code = ANY(%L::text[]))',
        ARRAY(SELECT jsonb_array_elements_text(v_filter->'codes'))::text[]);

    ELSIF v_type = 'sendable_only' THEN
      IF COALESCE((v_filter->>'value')::boolean, true) THEN
        v_clause := 'EXISTS (SELECT 1 FROM aa_03_marketing.v_sendable_contacts s WHERE s.id = c.id)';
      END IF;

    ELSIF v_type = 'is_test' THEN
      v_has_test_filter := true;
      IF COALESCE((v_filter->>'value')::boolean, true) THEN
        v_clause := 'c.is_test = true';
      ELSE
        v_clause := 'c.is_test = false';
      END IF;

    ELSE
      RAISE EXCEPTION 'unknown filter type: %', v_type;
    END IF;

    IF v_clause IS NOT NULL THEN
      v_clauses := array_append(v_clauses, v_clause);
    END IF;
  END LOOP;

  IF array_length(v_clauses, 1) IS NULL THEN
    v_where := 'TRUE';
  ELSE
    v_where := array_to_string(v_clauses, CASE WHEN v_match = 'all' THEN ' AND ' ELSE ' OR ' END);
  END IF;

  IF NOT v_has_test_filter THEN
    v_where := '(' || v_where || ') AND c.is_test = false';
  END IF;

  v_sql := format('SELECT c.id FROM aa_03_marketing.contacts c WHERE %s', v_where);
  RETURN QUERY EXECUTE v_sql;
END;
$$;
