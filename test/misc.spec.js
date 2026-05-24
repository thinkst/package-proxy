import { exports } from "cloudflare:workers";
import { describe, it, expect } from "vitest";

describe("Misc requests", () => {
    it("responds with a 200 when GETing /", async () => {
        const res1 = await exports.default.fetch("http://example.com/");
        const res2 = await exports.default.fetch("http://example.com");
        expect(res1.status).toBe(200);
        expect(res2.status).toBe(200);
        let r1txt = await res1.text();
        expect(r1txt == await res2.text()).toBe(true);
    });
    it("responds with a 401 when accessing a per-org subdomain", async () => {
        const res = await exports.default.fetch("http://some.example.com/");
        expect(res.status).toBe(401);
    });
    it("Doesn't crash on POST", async () => {
        const res = await exports.default.fetch("http://example.com/none", {method: "POST"});
        expect(res.status).toBe(405);
    });
    it("Doesn't crash on POST to /", async () => {
        const res = await exports.default.fetch("http://example.com/", {method: "POST"});
        expect(res.status).toBe(405);
    });
    it("Doesn't crash on PUT", async () => {
        const res = await exports.default.fetch("http://example.com/none", {method: "PUT"});
        expect(res.status).toBe(405);
    });
    it("Doesn't crash on PUT to /", async () => {
        const res = await exports.default.fetch("http://example.com/", {method: "PUT"});
        expect(res.status).toBe(405);
    });
    it("Doesn't crash on HEAD", async () => {
        const res = await exports.default.fetch("http://example.com/none", {method: "HEAD"});
        expect(res.status).toBe(405);
    });
    it("Doesn't crash on HEAD to /", async () => {
        const res = await exports.default.fetch("http://example.com/", {method: "HEAD"});
        expect(res.status).toBe(405);
    });
    it("Doesn't crash on PATCH", async () => {
        const res = await exports.default.fetch("http://example.com/none", {method: "PATCH"});
        expect(res.status).toBe(405);
    });
    it("Doesn't crash on PATCH to /", async () => {
        const res = await exports.default.fetch("http://example.com/", {method: "PATCH"});
        expect(res.status).toBe(405);
    });
    it("Doesn't crash on DELETE", async () => {
        const res = await exports.default.fetch("http://example.com/none", {method: "DELETE"});
        expect(res.status).toBe(405);
    });
    it("Doesn't crash on DELETE to /", async () => {
        const res = await exports.default.fetch("http://example.com/", {method: "DELETE"});
        expect(res.status).toBe(405);
    });
});