ALTER TABLE public.ragic_orders_cache
  ADD COLUMN IF NOT EXISTS actual_ship_date date,
  ADD COLUMN IF NOT EXISTS requested_delivery_date date,
  ADD COLUMN IF NOT EXISTS has_shipped boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_ragic_orders_actual_ship_date ON public.ragic_orders_cache (actual_ship_date);
CREATE INDEX IF NOT EXISTS idx_ragic_orders_requested_delivery_date ON public.ragic_orders_cache (requested_delivery_date);
CREATE INDEX IF NOT EXISTS idx_ragic_orders_has_shipped ON public.ragic_orders_cache (has_shipped);