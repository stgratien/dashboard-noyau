-- Historique des stories Instagram importé des exports Meta (seeds/instagram-stories-history-2026-10-20.sql), séparé de ce que la synchronisation Windsor
-- écrit dans social_stories : la synchronisation ne peut ni l'effacer ni l'écraser, et le tableau de bord fusionne les deux à la lecture (plus grand chiffre connu).
-- Idempotent : relançable sans erreur (peut aussi être collé dans l'éditeur SQL de Lovable Cloud). Tables optionnelles : sans elles, seul le relevé en direct existe.

-- Une ligne par story : mêmes chiffres que social_stories ; `interactions` = j'aime + réponses + partages (voir le seed) ; `details` : autres chiffres de l'export (JSON).
CREATE TABLE IF NOT EXISTS public.social_story_history (
  platform text NOT NULL CHECK (platform IN ('instagram')),
  story_id text NOT NULL,
  published_at timestamptz NOT NULL,
  views numeric,
  reach numeric,
  replies numeric,
  shares numeric,
  interactions numeric,
  details jsonb,
  source text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, story_id)
);
CREATE INDEX IF NOT EXISTS social_story_history_published_idx ON public.social_story_history (platform, published_at);
REVOKE ALL ON public.social_story_history FROM anon, authenticated;
GRANT SELECT ON public.social_story_history TO anon, authenticated;
GRANT ALL ON public.social_story_history TO service_role;
ALTER TABLE public.social_story_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read story history" ON public.social_story_history;
CREATE POLICY "Read story history" ON public.social_story_history FOR SELECT TO anon, authenticated USING (true);

-- Couverture de l'historique, par fenêtre de jours de Paris : 'complete' = la liste des stories de ces jours est complète (un jour sans story y est un vrai zéro),
-- 'partial' = elle est probablement incomplète (les stories connues sont comptées mais la période reste partielle, sans zéro affiché).
CREATE TABLE IF NOT EXISTS public.social_story_history_windows (
  platform text NOT NULL CHECK (platform IN ('instagram')),
  start_day date NOT NULL,
  end_day date NOT NULL,
  level text NOT NULL CHECK (level IN ('complete', 'partial')),
  source text NOT NULL,
  note text,
  PRIMARY KEY (platform, start_day, end_day),
  CHECK (end_day >= start_day)
);
REVOKE ALL ON public.social_story_history_windows FROM anon, authenticated;
GRANT SELECT ON public.social_story_history_windows TO anon, authenticated;
GRANT ALL ON public.social_story_history_windows TO service_role;
ALTER TABLE public.social_story_history_windows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read story history windows" ON public.social_story_history_windows;
CREATE POLICY "Read story history windows" ON public.social_story_history_windows FOR SELECT TO anon, authenticated USING (true);
