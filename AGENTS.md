<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- Ce dépôt est un projet client du noyau commun des dashboards. Ne modifier que ce qui est propre au client : src/client/, public/, seeds/, src/assets/, AGENTS.md, README.md. Toute autre modification (src/lib, src/components, src/routes, src/core, drizzle/migrations) doit passer par le noyau, sinon la prochaine fusion du noyau créera des conflits.
- Règles techniques du noyau : docs/regles-noyau.md. Architecture, mise en service et fusion des améliorations : docs/noyau.md.
