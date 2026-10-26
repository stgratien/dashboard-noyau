async function digest(v: string) { return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v))); }
/** Constant-time comparison of the request's Bearer token with a project secret (SHA-256 digests, equal length). */
export async function bearerMatches(request: Request, secret: string | undefined) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!secret || !token) return false;
  const [x, y] = await Promise.all([digest(token), digest(secret)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
