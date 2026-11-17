import { exports } from "cloudflare:workers";
import { describe, it, expect } from "vitest";

describe("mise GitHub proxy", () => {
    it("rejects GitHub API paths that cannot be tied to a repository", async () => {
        const res = await exports.default.fetch("http://example.com/mise/api-github-com/rate_limit");
        expect(res.status).toBe(404);
    });

    it("does not require client credentials for mise API requests", async () => {
        const res = await exports.default.fetch("http://some.example.com/mise/api-github-com/rate_limit");
        expect(res.status).toBe(404);
    });
});
