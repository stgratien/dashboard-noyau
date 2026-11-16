import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS, withSecurityHeaders } from "../lib/security-headers";

describe("withSecurityHeaders", () => {
  it("adds the headers to a response and keeps its body and status", async () => {
    const out = withSecurityHeaders(new Response("ok", { status: 201, headers: { "content-type": "text/plain" } }));
    expect(out.status).toBe(201);
    expect(await out.text()).toBe("ok");
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(out.headers.get(name)).toBe(value);
    expect(out.headers.get("content-type")).toBe("text/plain");
  });
  it("never overrides a header the application already set", () => {
    const out = withSecurityHeaders(new Response("x", { headers: { "X-Robots-Tag": "all" } }));
    expect(out.headers.get("X-Robots-Tag")).toBe("all");
  });
  it("copies a response whose headers are immutable (a redirect built by the runtime)", () => {
    const out = withSecurityHeaders(Response.redirect("https://example.test/", 302));
    expect(out.status).toBe(302);
    expect(out.headers.get("location")).toBe("https://example.test/");
    expect(out.headers.get("X-Robots-Tag")).toBe("noindex, nofollow, noarchive");
  });
  it("forbids framing outside the host's own origins and denies camera, microphone and location", () => {
    expect(SECURITY_HEADERS["Content-Security-Policy"]).toContain("frame-ancestors 'self'");
    expect(SECURITY_HEADERS["Permissions-Policy"]).toContain("camera=()");
  });
});
