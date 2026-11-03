-- Tailles d'entreprise : deuxième découpage, les ABONNÉS (en plus des visiteurs de la page). Ces chiffres sont chargés à la main, trimestre par trimestre (le réseau ne les
-- fournit pas par période à la synchronisation) : ni les visiteurs (un cumul depuis toujours) ni les abonnés (un instantané) ne se relèvent par trimestre.
-- Idempotent : relançable sans erreur (peut aussi être collé dans l'éditeur SQL de Lovable Cloud). Le nom d'une contrainte CHECK déclarée sur une colonne est « <table>_<colonne>_check ».
BEGIN;
ALTER TABLE public.social_page_audience DROP CONSTRAINT IF EXISTS social_page_audience_dimension_check;
ALTER TABLE public.social_page_audience ADD CONSTRAINT social_page_audience_dimension_check CHECK (dimension IN ('companySize', 'followersCompanySize'));
ALTER TABLE public.social_page_audience_periods DROP CONSTRAINT IF EXISTS social_page_audience_periods_dimension_check;
ALTER TABLE public.social_page_audience_periods ADD CONSTRAINT social_page_audience_periods_dimension_check CHECK (dimension IN ('companySize', 'followersCompanySize'));
COMMIT;
