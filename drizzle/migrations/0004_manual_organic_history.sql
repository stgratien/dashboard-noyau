CREATE TABLE public.social_organic_history (
 platform text NOT NULL CHECK (platform IN ('instagram','linkedin','facebook')),
 day date NOT NULL,
 organic_views numeric,
 organic_likes numeric,
 organic_comments numeric,
 organic_shares numeric,
 posts_published numeric,
 imported_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (platform, day)
);
GRANT SELECT ON public.social_organic_history TO anon, authenticated;
GRANT ALL ON public.social_organic_history TO service_role;
ALTER TABLE public.social_organic_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read manual organic history" ON public.social_organic_history FOR SELECT TO anon, authenticated USING (platform IN ('instagram','linkedin','facebook'));
COMMENT ON TABLE public.social_organic_history IS 'Agency manual daily organic exports. Paid export fields intentionally excluded to avoid double counting.';