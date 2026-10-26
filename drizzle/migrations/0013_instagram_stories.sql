-- Stories Instagram : Instagram ne fournit les chiffres d'une story que pendant les 24 h de sa vie, elles sont donc relevées plusieurs fois par jour
-- et gardées ici. Idempotent : relançable sans erreur (peut aussi être collé dans l'éditeur SQL de Lovable Cloud).
-- Tables optionnelles : sans elles, le tableau de bord affiche les chiffres Stories comme non disponibles.

-- Une ligne par story ; les chiffres ne font que croître jusqu'à l'expiration, la synchronisation garde donc la plus grande valeur vue.
CREATE TABLE IF NOT EXISTS public.social_stories (
  platform text NOT NULL CHECK (platform IN ('instagram')),
  story_id text NOT NULL,
  published_at timestamptz NOT NULL,
  views numeric,
  reach numeric,
  replies numeric,
  shares numeric,
  interactions numeric,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, story_id)
);
CREATE INDEX IF NOT EXISTS social_stories_published_idx ON public.social_stories (platform, published_at);
GRANT SELECT ON public.social_stories TO anon, authenticated;
GRANT ALL ON public.social_stories TO service_role;
ALTER TABLE public.social_stories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read stories" ON public.social_stories;
CREATE POLICY "Read stories" ON public.social_stories FOR SELECT TO anon, authenticated USING (true);

-- Jours où des stories ont été relevées. Un jour compte pour une période seulement si un relevé a eu lieu ce jour-là ET le lendemain,
-- sans trou de plus de 6 h entre deux relevés (une story vit 24 h, une panne la rendrait invisible). `pulls` = relevés réussis du jour ;
-- `max_gap_minutes` = plus long intervalle entre deux relevés réussis qui se termine ce jour-là (relevé précédent compris, même la veille) ;
-- `last_pull_at` et `last_attempt_at` espacent les relevés (réussis ou non) et restent côté serveur.
CREATE TABLE IF NOT EXISTS public.social_story_coverage (
  platform text NOT NULL CHECK (platform IN ('instagram')),
  day date NOT NULL,
  pulls integer NOT NULL DEFAULT 0,
  max_gap_minutes integer,
  last_pull_at timestamptz,
  last_attempt_at timestamptz,
  PRIMARY KEY (platform, day)
);
ALTER TABLE public.social_story_coverage ADD COLUMN IF NOT EXISTS max_gap_minutes integer;
ALTER TABLE public.social_story_coverage ADD COLUMN IF NOT EXISTS last_pull_at timestamptz;
REVOKE ALL ON public.social_story_coverage FROM anon, authenticated;
GRANT SELECT (platform, day, pulls, max_gap_minutes) ON public.social_story_coverage TO anon, authenticated;
GRANT ALL ON public.social_story_coverage TO service_role;
ALTER TABLE public.social_story_coverage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read story coverage" ON public.social_story_coverage;
CREATE POLICY "Read story coverage" ON public.social_story_coverage FOR SELECT TO anon, authenticated USING (true);
