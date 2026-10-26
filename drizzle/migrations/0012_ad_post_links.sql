-- Corrections manuelles du rattachement annonce -> publication, et historique de l'audience.
-- Idempotent : relançable sans erreur (peut aussi être collé dans l'éditeur SQL de Lovable Cloud).

-- Un lien forcé (post_id renseigné) est prioritaire sur la règle automatique ; post_id vide = ne jamais rattacher cette annonce.
CREATE TABLE IF NOT EXISTS public.social_ad_post_links (
  ad_id text PRIMARY KEY,
  post_platform text CHECK (post_platform IN ('facebook','instagram')),
  post_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((post_id IS NULL) = (post_platform IS NULL))
);
GRANT SELECT ON public.social_ad_post_links TO anon, authenticated;
GRANT ALL ON public.social_ad_post_links TO service_role;
ALTER TABLE public.social_ad_post_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read ad post links" ON public.social_ad_post_links;
CREATE POLICY "Read ad post links" ON public.social_ad_post_links FOR SELECT TO anon, authenticated USING (true);

-- Un instantané par jour et par découpage de l'audience : permet de suivre l'évolution des pays et des villes.
CREATE TABLE IF NOT EXISTS public.social_audience_history (
  snapshot_date date NOT NULL,
  platform text NOT NULL CHECK (platform IN ('facebook','instagram','tiktok','linkedin')),
  dimension text NOT NULL,
  label text NOT NULL,
  value numeric NOT NULL,
  unit text NOT NULL CHECK (unit IN ('count','percent')),
  PRIMARY KEY (snapshot_date, platform, dimension, label)
);
GRANT SELECT ON public.social_audience_history TO anon, authenticated;
GRANT ALL ON public.social_audience_history TO service_role;
ALTER TABLE public.social_audience_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read audience history" ON public.social_audience_history;
CREATE POLICY "Read audience history" ON public.social_audience_history FOR SELECT TO anon, authenticated USING (true);
