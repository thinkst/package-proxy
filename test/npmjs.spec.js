import { exports } from "cloudflare:workers";
import { describe, it, expect } from "vitest";

describe("NPMJS API requests", () => {
    it("responds with a 404 when given a non-existent package", async () => {
        const res = await exports.default.fetch("http://example.com/this-package-doesnt-exist");
        expect(res.status).toBe(404);
    });
    it("responds with the package information from NPMJS even if the URL is set incorrectly", async () => {
        const res = await exports.default.fetch("http://example.com/pypi/sax", {headers: {"user-agent": "npm/11.0"}});
        expect(res.status).toBe(200);
        let json = JSON.parse(await res.text());
        let keys = Object.keys(json);
        expect(keys.includes("_id")).toBe(true);
        expect(keys.includes("_rev")).toBe(true);
        expect(keys.includes("name")).toBe(true);
        expect(json.name).toBe('sax');
    });
    it("responds with the package information from NPMJS w/ path-based org and user ", async () => {
        const res = await exports.default.fetch("http://example.com/o-example/u-test/sax", {headers: {"user-agent": "npm/11.0"}});
        expect(res.status).toBe(200);
        let json = JSON.parse(await res.text());
        let keys = Object.keys(json);
        expect(keys.includes("_id")).toBe(true);
        expect(keys.includes("_rev")).toBe(true);
        expect(keys.includes("name")).toBe(true);
        expect(json.name).toBe('sax');
    });
    it("responds with the package information from NPMJS w/ path-based org", async () => {
        const res = await exports.default.fetch("http://example.com/o-example/sax", {headers: {"user-agent": "npm/11.0"}});
        expect(res.status).toBe(200);
        let json = JSON.parse(await res.text());
        let keys = Object.keys(json);
        expect(keys.includes("_id")).toBe(true);
        expect(keys.includes("_rev")).toBe(true);
        expect(keys.includes("name")).toBe(true);
        expect(json.name).toBe('sax');
    });
    it("responds with the package information from NPMJS", async () => {
        const res = await exports.default.fetch("http://example.com/sax", {headers: {"user-agent": "npm/11.0"}});
        expect(res.status).toBe(200);
        let json = JSON.parse(await res.text());
        let keys = Object.keys(json);
        expect(keys.includes("_id")).toBe(true);
        expect(keys.includes("_rev")).toBe(true);
        expect(keys.includes("name")).toBe(true);
        expect(json.name).toBe('sax');
    });
    it("responds with the package information from NPMJS when authenticated", async () => {
        const res = await exports.default.fetch("http://some.example.com/sax", {headers: {"user-agent": "npm/11.0", 'authorization': 'Basic dXNlcjo='}});
        expect(res.status).toBe(200);
        let json = JSON.parse(await res.text());
        let keys = Object.keys(json);
        expect(keys.includes("_id")).toBe(true);
        expect(keys.includes("_rev")).toBe(true);
        expect(keys.includes("name")).toBe(true);
        expect(json.name).toBe('sax');
    });
    it("responds with the package information from NPMJS when authenticated", async () => {
        const res = await exports.default.fetch("http://npm.some.example.com/sax", {headers: {"user-agent": "npm/11.0", 'authorization': 'Basic dXNlcjo='}});
        expect(res.status).toBe(200);
        let json = JSON.parse(await res.text());
        let keys = Object.keys(json);
        expect(keys.includes("_id")).toBe(true);
        expect(keys.includes("_rev")).toBe(true);
        expect(keys.includes("name")).toBe(true);
        expect(json.name).toBe('sax');
    });
    it("responds with the 'pypi' package information from NPMJS", async () => {
        const res = await exports.default.fetch("http://example.com/pypi", {headers: {"user-agent": "npm/11.0"}});
        expect(res.status).toBe(200);
        let json = JSON.parse(await res.text());
        let keys = Object.keys(json);
        expect(keys.includes("_id")).toBe(true);
        expect(keys.includes("_rev")).toBe(true);
        expect(keys.includes("name")).toBe(true);
        expect(json.name).toBe('pypi');
    });
    it("responds correctly to a search API query", async () => {
        const res = await exports.default.fetch("http://example.com/-/v1/search?text=types");
        expect(res.status).toBe(200);
        let json = JSON.parse(await res.text());
        let keys = Object.keys(json);

        expect(keys.includes("objects")).toBe(true);
        expect(keys.includes("time")).toBe(true);
        expect(keys.includes("total")).toBe(true);
    });
    it("responds with a 200 for a valid file", async () => {
        const res = await exports.default.fetch("http://example.com/npmfiles/for-own/-/for-own-1.0.0.tgz");
        expect(res.status).toBe(200);
    });
    it("responds with a 404 for an invalid file", async () => {
        const res = await exports.default.fetch("http://example.com/npmfiles/for-own/-/for-onot-wn-1.0.0.tgz");
        expect(res.status).toBe(404);
    });
});