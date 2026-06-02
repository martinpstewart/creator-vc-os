-- The previous migration added p_include_unpaid as a 6th parameter
-- to get_customers_list. Postgres treats that as a DIFFERENT function
-- signature, so the old 5-arg version was left in place as an
-- overload. PostgREST then saw two functions matching the same named-
-- parameter call and refused to pick — the /customers page failed
-- with "Something went wrong". Dropping the old signature; the new
-- one (with the p_include_unpaid default) covers every existing caller.
DROP FUNCTION IF EXISTS public.get_customers_list(text, integer, integer, bigint[], text[]);
