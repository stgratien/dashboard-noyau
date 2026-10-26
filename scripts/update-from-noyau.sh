#!/usr/bin/env bash
# Applique les améliorations du noyau à ce dépôt client, par fusion Git (jamais de réécriture d'historique).
# Usage : scripts/update-from-noyau.sh <URL ou chemin du dépôt noyau> [branche ou étiquette, défaut main]
# Première fois : adopte le noyau (le dépôt client a été créé à partir d'un export, ses historiques n'ont aucun ancêtre commun).
# Ensuite : fusion ordinaire. Les fichiers du client (voir .gitattributes, lignes merge=ours) ne sont jamais écrasés.
set -euo pipefail

NOYAU="${1:?URL ou chemin du dépôt noyau}"
REF="${2:-main}"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Validez ou rangez d'abord vos changements." >&2
  exit 1
fi

git config merge.ours.driver true
if git remote get-url noyau >/dev/null 2>&1; then git remote set-url noyau "$NOYAU"; else git remote add noyau "$NOYAU"; fi
git fetch --tags noyau

TARGET="noyau/$REF"
git rev-parse --verify -q "$TARGET^{commit}" >/dev/null || TARGET="$REF"
git rev-parse --verify -q "$TARGET^{commit}" >/dev/null || { echo "Branche ou étiquette introuvable : $REF" >&2; exit 1; }

if git merge-base HEAD "$TARGET" >/dev/null 2>&1; then
  git merge --no-ff -m "Fusion du noyau ($REF)" "$TARGET"
else
  echo "Première adoption du noyau : historiques sans ancêtre commun."
  git merge -s ours --allow-unrelated-histories -m "Adoption du noyau ($REF)" "$TARGET"
  # Fichiers du noyau repris tels quels ; fichiers du client (merge=ours dans .gitattributes) conservés.
  EXCLUDES=()
  while read -r pattern attribute; do
    [[ -z "$pattern" || "$pattern" == \#* || "$attribute" != "merge=ours" ]] && continue
    EXCLUDES+=(":(exclude,glob)$pattern")
  done < <(git show "$TARGET:.gitattributes")
  git checkout "$TARGET" -- . "${EXCLUDES[@]}"
  git add -A
  git commit -m "Import du noyau ($REF)" || true
fi
echo "Noyau appliqué. Si le noyau a ajouté une migration SQL, rejouez-la dans le projet du client."
