
-- Restrict ragic-related tables from public/anonymous access; keep them accessible to authenticated app users (single-company internal tool).
DROP POLICY IF EXISTS allow_all_ragic_connections ON public.ragic_connections;
DROP POLICY IF EXISTS allow_all_customer_profiles ON public.customer_profiles;
DROP POLICY IF EXISTS allow_all_customer_product_prices ON public.customer_product_prices;
DROP POLICY IF EXISTS allow_all_ragic_orders_cache ON public.ragic_orders_cache;

CREATE POLICY "Authenticated can manage ragic_connections"
  ON public.ragic_connections FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can manage customer_profiles"
  ON public.customer_profiles FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can manage customer_product_prices"
  ON public.customer_product_prices FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can manage ragic_orders_cache"
  ON public.ragic_orders_cache FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Revoke anon Data API access to these tables (defense in depth)
REVOKE ALL ON public.ragic_connections FROM anon;
REVOKE ALL ON public.customer_profiles FROM anon;
REVOKE ALL ON public.customer_product_prices FROM anon;
REVOKE ALL ON public.ragic_orders_cache FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ragic_connections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_product_prices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ragic_orders_cache TO authenticated;

GRANT ALL ON public.ragic_connections TO service_role;
GRANT ALL ON public.customer_profiles TO service_role;
GRANT ALL ON public.customer_product_prices TO service_role;
GRANT ALL ON public.ragic_orders_cache TO service_role;
