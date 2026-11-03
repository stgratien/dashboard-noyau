-- Tailles d'entreprise de la page d'un réseau, sur une période exacte (LinkedIn : visiteurs de la page, puis abonnés avec la migration 0017), chargées à la main par seed.
-- Idempotent : relançable sans erreur (peut aussi être collé dans l'éditeur SQL de Lovable Cloud). Tables optionnelles : sans elles, la section n'affiche rien de plus qu'une absence de relevé.
-- Le réseau ne fournit pas ces chiffres par période à la synchronisation : une ligne porte ses dates de début et de fin, celles des trimestres (et éditions) terminés du tableau de bord,
-- pour que la période affichée et sa comparaison retrouvent leur relevé par leurs dates exactes.

-- Une ligne par valeur du découpage et par période (les 50 plus vues au plus). `label` est le libellé brut du réseau (un code de tranche d'effectif) ; l'affichage le met en français.
CREATE TABLE IF NOT EXISTS public.social_page_audience (
  platform text NOT NULL CHECK (platform IN ('linkedin')),
  dimension text NOT NULL CHECK (dimension IN ('companySize')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  label text NOT NULL,
  views numeric NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, dimension, period_start, period_end, label),
  CHECK (period_end >= period_start)
);
REVOKE ALL ON public.social_page_audience FROM anon, authenticated;
GRANT SELECT ON public.social_page_audience TO anon, authenticated;
GRANT ALL ON public.social_page_audience TO service_role;
ALTER TABLE public.social_page_audience ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read page audience" ON public.social_page_audience;
CREATE POLICY "Read page audience" ON public.social_page_audience FOR SELECT TO anon, authenticated USING (true);

-- Un relevé par découpage et par période, écrit EN DERNIER : la seule preuve que les chiffres de la période ont été chargés. Une période sans ligne ici est « Donnée non disponible ».
-- Un relevé sans aucune valeur stockée n'est jamais lu comme une répartition vide. `synced_at` vide : chargement non abouti (ignoré à l'affichage).
-- `returned_count` et `total_views` portent sur toute la répartition, y compris les valeurs non stockées (les listes chargées peuvent ne garder que les plus grandes tailles) ;
-- `is_final` : la période est close.
CREATE TABLE IF NOT EXISTS public.social_page_audience_periods (
  platform text NOT NULL CHECK (platform IN ('linkedin')),
  dimension text NOT NULL CHECK (dimension IN ('companySize')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  returned_count integer,
  total_views numeric,
  is_final boolean NOT NULL DEFAULT false,
  last_attempt_at timestamptz,
  synced_at timestamptz,
  PRIMARY KEY (platform, dimension, period_start, period_end),
  CHECK (period_end >= period_start)
);
REVOKE ALL ON public.social_page_audience_periods FROM anon, authenticated;
GRANT SELECT (platform, dimension, period_start, period_end, returned_count, total_views, is_final, synced_at) ON public.social_page_audience_periods TO anon, authenticated;
GRANT ALL ON public.social_page_audience_periods TO service_role;
ALTER TABLE public.social_page_audience_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read page audience periods" ON public.social_page_audience_periods;
CREATE POLICY "Read page audience periods" ON public.social_page_audience_periods FOR SELECT TO anon, authenticated USING (true);
