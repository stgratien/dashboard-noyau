CREATE TABLE public.social_ad_creative_daily (
 source text NOT NULL CHECK (source IN ('facebook','tiktok','linkedin')),
 platform text NOT NULL CHECK (platform IN ('facebook','instagram','tiktok','linkedin')),
 ad_id text NOT NULL, day date NOT NULL, post_id text,
 spend numeric NOT NULL DEFAULT 0, impressions numeric NOT NULL DEFAULT 0,
 likes numeric, comments numeric, shares numeric,
 synced_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (source, platform, ad_id, day));
CREATE INDEX social_ad_creative_daily_period ON public.social_ad_creative_daily(day, platform);
GRANT SELECT ON public.social_ad_creative_daily TO anon, authenticated;
GRANT ALL ON public.social_ad_creative_daily TO service_role;
ALTER TABLE public.social_ad_creative_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read ad creative delivery" ON public.social_ad_creative_daily FOR SELECT TO anon, authenticated USING (true);
CREATE TABLE public.social_ad_creatives (
 platform text NOT NULL CHECK (platform IN ('facebook','instagram','tiktok','linkedin')),
 ad_id text NOT NULL, ad_name text, thumbnail_path text,
 synced_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (platform, ad_id));
GRANT SELECT ON public.social_ad_creatives TO anon, authenticated;
GRANT ALL ON public.social_ad_creatives TO service_role;
ALTER TABLE public.social_ad_creatives ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read ad creatives" ON public.social_ad_creatives FOR SELECT TO anon, authenticated USING (true);