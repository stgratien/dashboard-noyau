# Noyau du tableau de bord et dossier client

Ce code est un **noyau** réutilisable : le même code sert plusieurs clients. Chaque client a son propre projet Lovable (donc sa propre URL, sa propre base et ses propres accès) et son propre dépôt Git. Seul ce qui est propre au client diffère ; une amélioration faite dans le noyau s'applique aux autres dashboards par une fusion Git, sans conflit.

## Ce qui appartient au client (jamais modifié par le noyau)

| Fichier | Contenu |
| --- | --- |
| `src/client/config.ts` | Partie publique : identité (titres, logo, signature), début d'historique, éditions ou temps forts, sources Windsor activées, intégrations, réglages du rapport Google. Aucun secret, aucun identifiant de compte. |
| `src/client/config.server.ts` | Partie serveur : identifiant du compte Windsor de chaque source activée. Importé uniquement par du code serveur. |
| `src/client/theme.css` | Palette de marque (clair, sombre, exports). Chargée après `src/styles.css`. Jetons facultatifs pour les graphiques à plusieurs séries : `--brand-second`, `--brand-sky`, `--brand-deep` (sans eux, des valeurs de repli neutres). |
| `public/favicon.svg`, `public/robots.txt`, `src/assets/` | Images et réglages d'indexation du client. |
| `seeds/` | Données propres au client (historiques manuels, imports ponctuels), jamais livrées avec le noyau. |
| `AGENTS.md`, `README.md`, `roadmap.md` | Connaissance et suivi du client. |
| `src/integrations/supabase/` | Fichiers générés par Lovable pour chaque projet. |

Le reste (`src/lib`, `src/components`, `src/routes`, `src/core`, `drizzle/migrations`, tests génériques, `scripts/`, `docs/`) appartient au noyau. **Dans un projet client, ne modifier que les fichiers du client** : toute autre modification passe par le noyau, sinon la prochaine fusion créera des conflits.

## Règles du noyau

- Une nouvelle clé de configuration est **toujours facultative**, avec sa valeur par défaut dans `src/core/client-config.ts`. `src/test/fixtures/client-v1.ts` est la configuration minimale de la première version : elle doit continuer de passer `defineClient`. Valeurs par défaut à connaître : `features.googleAds` et `features.youtube` valent `true` ; `events.editions` est vide ; pas de signature de pied de page.
- Le code lit la configuration par `import { client } from "@/lib/client"` (partie publique) et, côté serveur seulement, par `src/lib/windsor-accounts.server.ts`. Aucune constante propre à un client dans le noyau.
- Les onglets réseaux se déduisent des sources Windsor activées (`PLATFORM_SOURCES`, `SOURCE_PLATFORMS`), sauf si `networks` est fourni. **La source `facebook` est Meta Ads : elle alimente Facebook et Instagram** et impose donc les deux onglets. Google Ads et YouTube se règlent par `features`, tout comme l'onglet **Global** (`features.global` : affiché dès qu'il y a plusieurs onglets réseaux, masqué sinon ; sans lui, le premier réseau s'ouvre en premier et le bouton du rapport Google Slides, qui vit sur Global, n'est plus proposé).
- L'historique organique manuel (export de l'administration d'un compte, table `social_organic_history`) ne comble par défaut que les jours vides des relevés du fournisseur. `data.manualOrganicFirst` (liste de réseaux parmi facebook et linkedin, défaut vide) le fait passer **avant** les relevés du fournisseur pour les jours qu'il couvre : à choisir quand l'export est plus complet que le connecteur (par exemple LinkedIn, dont le connecteur ne remonte qu'en partie les impressions de certains mois). Un champ vide de l'export ne remplace jamais une valeur du fournisseur.
- Une erreur dans la configuration arrête tout le site à l'import (`defineClient` lève exprès, avec un message clair) : lancer les tests avant de pousser une modification de `src/client/config.ts`.
- Règles techniques détaillées : `docs/regles-noyau.md`.

## Publier le noyau (dans le dépôt d'origine)

Le noyau vit dans **un dépôt Git à lui** (privé, à pousser sur GitHub pour que les clients le récupèrent), qui n'est jamais le dépôt d'un client. Chaque publication est un commit :

```bash
# arbre de travail propre, tout est validé
python3 scripts/export-core.py --publish ../dashboard-noyau --tag v2 --check
```

Le script retire tout ce qui est propre au client, remplace les fichiers client par des modèles neutres, retire des migrations les instructions qui écrivent des données, et **refuse de rien écrire** s'il reste un mot, une valeur, un identifiant long, une adresse e-mail ou un binaire du client d'origine. Les tests qui contiennent encore des données du client sont écartés et listés.

## Créer le dashboard d'un nouveau client

Dans cet ordre :

1. **Windsor** : autoriser les comptes du client dans le compte Windsor de l'agence, puis relever les identifiants de comptes (connecteur, compte) : ils vont dans `config.server.ts`.
2. **Projet Lovable** : le créer dans l'espace voulu, activer Lovable Cloud, connecter GitHub (Lovable crée alors le dépôt du client).
3. **Adopter le noyau** : cloner le dépôt du client, puis `scripts/update-from-noyau.sh <dépôt noyau> main`. Première fois : le script fusionne les historiques sans ancêtre commun, reprend les fichiers du noyau et conserve ceux du client.
4. **Configurer** `src/client/config.ts`, `config.server.ts`, `theme.css`, `public/favicon.svg`, logo ; valider et pousser (jamais de réécriture d'historique : Lovable).
5. **Base** (éditeur SQL du projet) : rejouer `drizzle/migrations/0000` à la dernière, dans l'ordre et dans une transaction (`begin; … commit;`, pour qu'une erreur n'en laisse pas la moitié), puis

   ```sql
   revoke insert, update, delete, truncate, trigger, references on all tables in schema public from anon, authenticated;
   alter default privileges in schema public revoke insert, update, delete, truncate, trigger, references on tables from anon, authenticated;
   insert into storage.buckets (id, name, public) values ('publication-thumbnails', 'publication-thumbnails', false) on conflict (id) do update set public = false;
   create extension if not exists pg_cron; create extension if not exists pg_net;
   ```

   (La migration 0001 crée une règle de lecture sur le stockage des vignettes ; la politique d'accès du dashboard est une décision à prendre avant de publier les chiffres d'un client.)

6. **Secrets** du projet : `WINDSOR_API_KEY` ; `LOVABLE_CRON_SECRET` est généré par Lovable ; `GOOGLE_ADS_INGEST_SECRET` et `YOUTUBE_INGEST_SECRET` seulement si ces intégrations sont activées.
7. **Tâches planifiées** (à créer à la main, jamais dans une migration ; à valider sur le premier projet) :

   ```sql
   select cron.schedule('windsor-nightly-paris', '17 4,5 * * *', $$ select net.http_post(
     url := 'https://<url publiée>/api/public/windsor-sync',
     headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <LOVABLE_CRON_SECRET>'),
     body := '{"action":"nightly"}'::jsonb, timeout_milliseconds := 170000) $$);
   select cron.schedule('windsor-process-queue', '*/3 * * * *', $$ select net.http_post(
     url := 'https://<url publiée>/api/public/windsor-sync',
     headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <LOVABLE_CRON_SECRET>'),
     body := '{"action":"process"}'::jsonb, timeout_milliseconds := 170000) $$);
   ```

   La première tâche tourne à 04:17 et 05:17 UTC (la synchronisation ne s'exécute que lorsqu'il est 06 h à Paris, été comme hiver) ; la seconde traite un job d'import toutes les 3 minutes. Ne jamais relire `cron.job.command` (il contient le secret). Pour changer de secret : `LOVABLE_CRON_SECRET_PREVIOUS` permet une rotation sans coupure, puis recréer les tâches.
8. **Importer l'historique** : `POST /api/public/windsor-sync` avec `{"action":"enqueue"}` et l'en-tête `Authorization: Bearer <LOVABLE_CRON_SECRET>`, puis laisser la file travailler (environ 5 heures par année d'historique pour les 7 sources, à raison d'un job toutes les 3 minutes ; moins avec moins de sources). Les sources Meta organiques (Facebook, Instagram) refusent les périodes de plus de deux ans glissants : régler `data.start` en conséquence ou accepter des jobs en échec. Un job en échec n'est jamais rejoué : après avoir corrigé la cause, `update public.social_import_jobs set state='pending', attempts=0, started_at=null, finished_at=null, error_message=null where state='failed';` le remet en file (voir d'abord `select state, count(*) from public.social_import_jobs group by 1;`).
9. **Google** (rapport Slides) : ajouter l'URL du projet aux origines JavaScript autorisées de l'identifiant client OAuth et aux référents de la clé du sélecteur ; partager le modèle ; renseigner `report.google` dans `config.ts`. Les marqueurs du modèle sont listés par réseau dans `src/lib/report-tokens.ts` ; un modèle ne doit contenir que ceux des réseaux du client.
10. **Contrôler** trois nuits de synchronisation avant de livrer.

## Appliquer une amélioration du noyau à un dashboard client

Dans le dépôt du client, arbre propre :

```bash
scripts/update-from-noyau.sh <dépôt noyau> main    # ou une étiquette : v2
```

Le script active le pilote de fusion `merge.ours` (les fichiers du client listés dans `.gitattributes` ne sont jamais écrasés), récupère le noyau et le fusionne. Toujours par **commit de fusion** : jamais de squash ni de rebase, ni sur GitHub ni dans Lovable (un squash fait perdre l'ancêtre commun et recrée des conflits). Si le noyau a ajouté une migration SQL, la rejouer dans le projet. Dans le dépôt d'origine lui-même, ne pas activer ce pilote.

## Limites connues

- Une source désactivée par choix (un réseau sans compte payant ou sans compte organique) est encore signalée « partielle » dans les totaux et le rapport : à traiter avec les vrais comptes du premier client concerné.
- Les tests génériques lisent une configuration neutre (`src/test/fixtures/neutral-client.ts`) : plus aucun test n'est écarté de l'export. Les faits propres au client d'origine sont dans `src/client/tests/`, jamais livrés avec le noyau.
- Les textes de définition des indicateurs (`src/lib/kpi-definitions.ts`) ne citent ni agence, ni export, ni date par défaut. L'historique propre à un client se décrit dans `kpiNotes` de sa configuration, tous les champs étant facultatifs : `history` (phrase des chiffres complétés par un historique manuel), `followersFallback`, `newFollowersLinkedin`, `posts`, `storyHistory`, `stories`, `instagramInteractions`, `facebookInteractions`.

## Comportements à connaître

- **Facebook** : les totaux de réactions, commentaires et partages des publications fournis par le connecteur comprennent déjà ceux des annonces (jamais d'ajout de Meta Ads sur les jours du connecteur) ; les j'aime et commentaires d'un historique importé de la page (`social_organic_history`, réglé par `data.manualOrganicFirst`) sont organiques et les actions Meta Ads s'y ajoutent sur les jours qu'il couvre (jamais aux partages). Le connecteur ne donne aucun j'aime pour les vidéos : elles rendent le total partiel et s'affichent « — » dans le tableau. L'historique est un instantané : une période dont des jours ne sont pas couverts (après son dernier jour, avant le premier, dans un trou) est marquée partielle et sa variation masquée, il faut le rafraîchir. Sans source `facebook_organic`, les interactions Facebook sont indisponibles (jamais le payant seul).
- **Instagram et LinkedIn** : les impressions d'une publication comprennent celles de ses annonces reliées (toutes diffusions, comme son budget et son CPM ; le réseau ne compte que l'organique) ; le taux d'une publication boostée, dont les réactions des annonces ne sont pas sur la publication, n'est pas calculé (« — ») et n'entre donc pas dans les flops d'engagement.
- **TikTok** : les annonces sont supposées être des posts boostés (leur diffusion est déjà dans les vues de la vidéo) : TikTok Ads ne sert qu'au budget et aux coûts. Un client qui diffuse des annonces TikTok sans vidéo organique derrière devra adapter `paidInOwnFigures` (`src/lib/social-totals.ts`).
