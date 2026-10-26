CREATE TABLE public.social_post_ad_daily (
 source text NOT NULL CHECK (source IN ('facebook','tiktok','linkedin')),
 platform text NOT NULL CHECK (platform IN ('facebook','instagram','tiktok','linkedin')),
 ad_id text NOT NULL,
 post_id text NOT NULL,
 day date NOT NULL,
 spend numeric NOT NULL DEFAULT 0,
 impressions numeric NOT NULL DEFAULT 0,
 synced_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (source, platform, ad_id, post_id, day)
);
CREATE INDEX social_post_ad_daily_post ON public.social_post_ad_daily (platform, post_id);
GRANT SELECT ON public.social_post_ad_daily TO anon, authenticated;
GRANT ALL ON public.social_post_ad_daily TO service_role;
ALTER TABLE public.social_post_ad_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read sponsored post delivery" ON public.social_post_ad_daily FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.social_audience (
 platform text NOT NULL CHECK (platform IN ('facebook','instagram','tiktok','linkedin')),
 dimension text NOT NULL,
 label text NOT NULL,
 value numeric NOT NULL,
 unit text NOT NULL CHECK (unit IN ('count','percent')),
 synced_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (platform, dimension, label)
);
GRANT SELECT ON public.social_audience TO anon, authenticated;
GRANT ALL ON public.social_audience TO service_role;
ALTER TABLE public.social_audience ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read current follower audience" ON public.social_audience FOR SELECT TO anon, authenticated USING (true);