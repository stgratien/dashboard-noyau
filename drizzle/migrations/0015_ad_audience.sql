-- Audience sponsorisée : le profil (fonction, poste, secteur, entreprise, niveau hiérarchique, lieu) des personnes que les publicités d'un réseau
-- ont touchées sur une période exacte (LinkedIn Ads : « Données démographiques » du Campaign Manager). Idempotent : relançable sans erreur
-- (peut aussi être collé dans l'éditeur SQL de Lovable Cloud). Tables optionnelles : sans elles, la section n'affiche rien de plus qu'une absence de relevé.
-- Le réseau ne fournit ce découpage que pour une période entière (pas par jour) : une ligne porte donc ses dates de début et de fin, celles des trimestres
-- (et éditions) terminés du tableau de bord, pour que la période affichée et sa comparaison retrouvent leur relevé par leurs dates exactes.

-- Une ligne par valeur du découpage et par période (les 50 plus diffusées au plus). `clicks` : tous les clics, comme le Campaign Manager (pas seulement
-- ceux vers la page de destination) ; vide quand le réseau ne le fournit pas. Le taux de clic se calcule à la lecture (clics ÷ impressions), il n'est jamais stocké.
CREATE TABLE IF NOT EXISTS public.social_ad_audience (
  platform text NOT NULL CHECK (platform IN ('facebook', 'instagram', 'linkedin', 'tiktok')),
  dimension text NOT NULL CHECK (dimension IN ('function', 'title', 'industry', 'company', 'seniority', 'region')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  label text NOT NULL,
  impressions numeric NOT NULL,
  clicks numeric,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, dimension, period_start, period_end, label),
  CHECK (period_end >= period_start)
);
REVOKE ALL ON public.social_ad_audience FROM anon, authenticated;
GRANT SELECT ON public.social_ad_audience TO anon, authenticated;
GRANT ALL ON public.social_ad_audience TO service_role;
ALTER TABLE public.social_ad_audience ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read ad audience" ON public.social_ad_audience;
CREATE POLICY "Read ad audience" ON public.social_ad_audience FOR SELECT TO anon, authenticated USING (true);

-- Un relevé par découpage et par période : la seule preuve que le réseau a répondu. Une période sans ligne ici est « Donnée non disponible » ;
-- avec une ligne `synced_at` renseignée et aucune valeur, c'est « aucune diffusion » (le réseau a répondu, rien n'a été touché).
-- `synced_at` reste vide tant qu'aucune lecture n'a abouti : la ligne ne sert alors qu'à espacer les nouvelles tentatives (`last_attempt_at`).
-- `returned_count` et les totaux portent sur toutes les valeurs lues, avant la limite des 50 ; `is_final` : le réseau ne révise plus cette période.
CREATE TABLE IF NOT EXISTS public.social_ad_audience_periods (
  platform text NOT NULL CHECK (platform IN ('facebook', 'instagram', 'linkedin', 'tiktok')),
  dimension text NOT NULL CHECK (dimension IN ('function', 'title', 'industry', 'company', 'seniority', 'region')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  returned_count integer,
  total_impressions numeric,
  total_clicks numeric,
  is_final boolean NOT NULL DEFAULT false,
  last_attempt_at timestamptz,
  synced_at timestamptz,
  PRIMARY KEY (platform, dimension, period_start, period_end),
  CHECK (period_end >= period_start)
);
REVOKE ALL ON public.social_ad_audience_periods FROM anon, authenticated;
GRANT SELECT (platform, dimension, period_start, period_end, returned_count, total_impressions, total_clicks, is_final, synced_at) ON public.social_ad_audience_periods TO anon, authenticated;
GRANT ALL ON public.social_ad_audience_periods TO service_role;
ALTER TABLE public.social_ad_audience_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read ad audience periods" ON public.social_ad_audience_periods;
CREATE POLICY "Read ad audience periods" ON public.social_ad_audience_periods FOR SELECT TO anon, authenticated USING (true);
