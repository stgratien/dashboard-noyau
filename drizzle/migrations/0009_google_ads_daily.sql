CREATE TABLE public.google_ads_daily (
 day date NOT NULL, campaign_id text NOT NULL, account_id text NOT NULL,
 campaign_name text NOT NULL DEFAULT '', channel text NOT NULL DEFAULT 'UNKNOWN',
 impressions numeric NOT NULL DEFAULT 0, clicks numeric NOT NULL DEFAULT 0, cost numeric NOT NULL DEFAULT 0,
 conversions numeric NOT NULL DEFAULT 0, conversions_value numeric NOT NULL DEFAULT 0, video_views numeric,
 synced_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (day, campaign_id));
GRANT ALL ON public.google_ads_daily TO service_role;
ALTER TABLE public.google_ads_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read safe sync status" ON public.social_sync_status;
CREATE POLICY "Read safe sync status" ON public.social_sync_status FOR SELECT TO anon, authenticated USING (source = ANY (ARRAY['facebook','facebook_organic','instagram','tiktok','tiktok_organic','linkedin','linkedin_organic','google_ads']));