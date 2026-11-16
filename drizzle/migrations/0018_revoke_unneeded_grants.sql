-- Durcissement des droits de la base (audit de sécurité) : la clé publique du navigateur ne sert qu'à LIRE les tables du tableau de bord.
-- 1. Aucun droit d'écriture pour les rôles anon et authenticated (les tables sont déjà protégées par RLS ; on retire en plus le droit lui-même, pour qu'une règle oubliée ne suffise pas).
-- 2. Les tables réservées au serveur (Google Ads, YouTube, file d'import, commentaires IA) n'ont plus aucun droit pour ces rôles : seul le serveur (clé de service) les lit.
-- Idempotent : relançable sans erreur, une table absente est ignorée. À coller dans l'éditeur SQL du projet Cloud (jamais par l'outil de requête : il refuse les instructions de structure).
BEGIN;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['google_ads_daily', 'youtube_daily', 'youtube_videos', 'youtube_subscriber_snapshots', 'social_import_jobs', 'ai_comments'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;
COMMIT;
