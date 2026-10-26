import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORMS, getPosts, type PlatformId } from "@/lib/dashboard-data";
import { client } from "@/lib/client";
import { DashboardFooter } from "@/components/dashboard/footer";

export const Route = createFileRoute("/publications/$platform/$id")({
  head: () => ({
    meta: [
      { title: `Publication de démonstration — ${client.brand.name}` },
      { name: "description", content: `Aperçu d'une publication de démonstration du dashboard ${client.brand.name}.` },
      { property: "og:title", content: `Publication de démonstration — ${client.brand.name}` },
      { property: "og:description", content: `Aperçu d'une publication de démonstration du dashboard ${client.brand.name}.` },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PublicationPage,
});

function PublicationPage() {
  const { platform, id } = Route.useParams();
  const meta = PLATFORMS.find((p) => p.id === platform);
  const post = meta ? getPosts(meta.id as PlatformId).find((p) => String(p.id) === id) : undefined;
  return (
    <div className="flex min-h-screen flex-col">
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 px-6 py-10">
      <p className="text-sm text-muted-foreground">Données de démonstration · {meta?.name ?? "Publication"}</p>
      {post ? <>
        <h1 className="text-2xl font-medium">{post.title}</h1>
        <img src={post.thumbnail_url} alt={post.title} className="max-h-[70vh] rounded-lg object-cover" />
        <p className="text-sm text-muted-foreground">Le lien réel de la publication s'affichera ici une fois les sources branchées.</p>
      </> : <h1 className="text-2xl font-medium">Publication introuvable</h1>}
      <Link to="/" className="text-sm text-primary hover:underline">Retour au dashboard</Link>
    </main>
    <DashboardFooter />
    </div>
  );
}