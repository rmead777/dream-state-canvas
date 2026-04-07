-- ============================================================================
-- Ragic Integration Tables for Dream State Canvas
-- Ported from Working Capital Wizard, adapted for DSC's Supabase instance.
-- Stores Ragic connection, customer profiles, pricing, and cached orders.
-- ============================================================================

-- 1. Ragic Connection Settings
CREATE TABLE IF NOT EXISTS ragic_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_name TEXT NOT NULL,
    api_key_encrypted TEXT NOT NULL,
    sheet_path TEXT NOT NULL,
    shipment_sheet_path TEXT,
    customer_database TEXT,
    customer_sheet_id TEXT,
    is_active BOOLEAN DEFAULT true,
    last_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE ragic_connections ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_ragic_connections') THEN
    CREATE POLICY allow_all_ragic_connections ON ragic_connections FOR ALL USING (true);
  END IF;
END $$;

-- 2. Customer Profiles (synced from Ragic)
CREATE TABLE IF NOT EXISTS customer_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_name TEXT NOT NULL UNIQUE,
    account_short_name TEXT,
    account_id TEXT,
    quickbooks_name TEXT,
    parent_account TEXT,
    is_distributor_account BOOLEAN DEFAULT false,
    payment_terms TEXT,
    payment_method TEXT,
    freight_terms TEXT,
    account_type TEXT,
    billing_company_name TEXT,
    billing_street TEXT,
    billing_city TEXT,
    billing_state TEXT,
    billing_zip TEXT,
    billing_country TEXT,
    shipping_company_name TEXT,
    shipping_street TEXT,
    shipping_city TEXT,
    shipping_state TEXT,
    shipping_zip TEXT,
    shipping_country TEXT,
    account_notes TEXT,
    po_required BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_profiles_qb_name ON customer_profiles(quickbooks_name);
ALTER TABLE customer_profiles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_customer_profiles') THEN
    CREATE POLICY allow_all_customer_profiles ON customer_profiles FOR ALL USING (true);
  END IF;
END $$;

-- 3. Customer Product Prices (contracted pricing overrides)
CREATE TABLE IF NOT EXISTS customer_product_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_name TEXT NOT NULL,
    product_name TEXT NOT NULL,
    price_per_ton NUMERIC NOT NULL,
    price_per_lb NUMERIC GENERATED ALWAYS AS (price_per_ton / 2000) STORED,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(customer_name, product_name)
);

ALTER TABLE customer_product_prices ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_customer_product_prices') THEN
    CREATE POLICY allow_all_customer_product_prices ON customer_product_prices FOR ALL USING (true);
  END IF;
END $$;

-- 4. Ragic Orders Cache
CREATE TABLE IF NOT EXISTS ragic_orders_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ragic_id TEXT NOT NULL UNIQUE,
    order_number TEXT,
    customer_name TEXT,
    resolved_qb_customer_name TEXT,
    product_name TEXT,
    quantity NUMERIC DEFAULT 0,
    unit_price NUMERIC DEFAULT 0,
    total_amount NUMERIC DEFAULT 0,
    invoice_date DATE,
    due_date DATE,
    payment_terms TEXT,
    customer_po TEXT,
    status TEXT,
    class_name TEXT,
    delivery_date DATE,
    raw_record JSONB,
    cached_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ragic_orders_status ON ragic_orders_cache(status);
CREATE INDEX IF NOT EXISTS idx_ragic_orders_due_date ON ragic_orders_cache(due_date);
CREATE INDEX IF NOT EXISTS idx_ragic_orders_delivery_date ON ragic_orders_cache(delivery_date);
CREATE INDEX IF NOT EXISTS idx_ragic_orders_customer ON ragic_orders_cache(customer_name);
ALTER TABLE ragic_orders_cache ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'allow_all_ragic_orders_cache') THEN
    CREATE POLICY allow_all_ragic_orders_cache ON ragic_orders_cache FOR ALL USING (true);
  END IF;
END $$;
