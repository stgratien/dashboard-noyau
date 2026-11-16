# Sécurité du tableau de bord

Ce que le tableau de bord expose, ce qui a été durci, et les gestes à faire à la main (hors code).

## Ce qui est public, par choix
Le tableau de bord n'a pas de connexion : toute personne qui connaît l'adresse lit les chiffres (page, fonctions de lecture, `/api/public/report-data`). La clé publique du navigateur lit les tables du tableau de bord.
Si un client attend de la confidentialité, l'étape suivante est une barrière côté serveur (mot de passe partagé par client, cookie signé), puis la lecture des données avec la clé de service et le retrait des droits de lecture de la clé publique (tables et stockage).
Sans cette barrière, le reste de ce document réduit la surface, il ne la ferme pas.

## Déjà en place dans le code
- Pas d'indexation : `noindex` dans l'en-tête de la page, `X-Robots-Tag` sur toutes les réponses (`src/lib/security-headers.ts`, posés par `src/server.ts`) et `public/robots.txt` en `Disallow: /`.
- Pas d'affichage dans le cadre d'un autre site (`frame-ancestors`, sauf l'éditeur et l'aperçu de l'hébergeur), `Referrer-Policy`, `Permissions-Policy` (ni caméra, ni micro, ni position). Pas de CSP de scripts : le site charge Google (connexion, sélecteur de fichiers, polices) ; à ajouter seulement après essai sur une copie.
- Les trois fonctions de lecture (`readSocialData`, `readGoogleAds`, `readYoutube`) n'acceptent que des périodes valides et raisonnables (`src/lib/period-input.ts`), et « Actualiser » (`fresh`) contourne le cache au plus une fois toutes les 10 secondes par instance (un second clic dans ce délai reçoit le cache, vieux de 2 minutes au plus). L'horizon des périodes est de 4 000 jours : « Toute la période » le dépasserait vers 2034.
- Vignettes : seuls jpeg, png, webp, gif et avif sont stockés (jamais SVG).
- Dépôt d'images du rapport : forme du jeton Google vérifiée avant tout appel à Google, jeton envoyé à `tokeninfo` dans le corps d'une requête POST (jamais dans une adresse), nettoyage du stockage en boucle (5 tours de 200 objets au plus par passage).
- Liens YouTube construits depuis l'identifiant de la vidéo ; l'ingestion ne garde qu'une adresse https de youtube.com ou youtu.be (toute autre valeur devient vide).
- Après le déploiement : ouvrir l'aperçu Lovable pour vérifier que le site s'y affiche (`frame-ancestors`) et lire `thumbnailGapCount` à la prochaine synchronisation de nuit (types d'image refusés).

## À faire à la main
1. **Base de données** : coller `drizzle/migrations/0018_revoke_unneeded_grants.sql` dans l'éditeur SQL de chaque projet client. Elle retire les droits d'écriture de la clé publique et tout droit sur les tables réservées au serveur.
2. **Google Cloud** (projet « Rapport ») : écran de consentement OAuth en mode « Test » (ou « Interne »), avec seulement les comptes qui génèrent les rapports comme utilisateurs de test ; clé API limitée aux référents HTTP `https://dashboard-<client>.lovable.app/*` et à l'API Drive/Slides/Picker ; origines JavaScript autorisées limitées aux mêmes adresses. C'est une exigence de sécurité : un écran « Production » ouvre le dépôt d'images à tout compte Google.
3. **Clé Windsor** : une clé par client si Windsor le permet, pour limiter les dégâts d'une fuite à un client. Un seul nom de variable d'environnement.
4. **Secret des tâches planifiées (pg_cron)** : ne pas le laisser en clair dans la commande de la tâche. Principe, avec un secret créé dans Vault :
   ```sql
   select vault.create_secret('<le secret>', 'windsor_cron_secret');            -- une seule fois, à la main
   -- puis la commande de la tâche lit le secret au moment de l'appel :
   --   headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'windsor_cron_secret'))
   ```
   Ne jamais afficher `cron.job.command`. Après le changement, tourner le secret (en changer la valeur dans Vault et dans les variables d'environnement du projet).
5. **Secrets des scripts d'ingestion** (Google Ads, YouTube) : les garder dans les propriétés du script, limiter les personnes qui peuvent ouvrir le script, et les changer si l'une d'elles part.
6. **Clé Anthropic des scripts de rapport** : dans les propriétés du script uniquement, jamais dans le code ; si une clé a déjà été collée dans un fichier, la révoquer et la remplacer.
7. **`.env`** : le fichier suivi par git est géré par Lovable et ne contient que des valeurs publiques. Un secret local va dans `.env.local` (ignoré par git), jamais dans `.env`.

## Dépôts
- Dépôt du noyau : privé (à vérifier dans les réglages GitHub).
- Quiconque a un droit d'écriture sur le dépôt ou d'édition dans Lovable déploie du code qui tourne avec la clé de service : limiter ces accès aux personnes qui en ont besoin.
