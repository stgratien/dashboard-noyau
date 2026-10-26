CREATE TABLE public.ai_comments (
 cache_key text PRIMARY KEY,
 tab text NOT NULL,
 content text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ai_comments TO service_role;
ALTER TABLE public.ai_comments ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.ai_comments IS 'Server-only cache of generated performance commentary keyed by tab, period, comparison and last sync.';