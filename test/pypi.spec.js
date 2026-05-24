import { exports } from "cloudflare:workers";
import { describe, it, expect } from "vitest";

describe("PyPI API requests", () => {
    it("responds with a 404 when given a non-existent package", async () => {
        const res = await exports.default.fetch("http://example.com/pypi/this-package-doesnt-exist");
        expect(res.status).toBe(404);
    });
    it("responds with proper JSON for all packages when fetching the Index API root", async () => {
        const res = await exports.default.fetch("http://example.com/pypi/");
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe('application/vnd.pypi.simple.v1+json');
        let json = JSON.parse(await res.text());
        let keys = Object.keys(json);
        // The JSON should only have "meta" and "projects" as keys
        expect(keys.includes("meta")).toBe(true);
        expect(keys.includes("projects")).toBe(true);

        // These are for specific project JSONs
        expect(keys.includes("files")).toBe(false);
        expect(keys.includes("versions")).toBe(false);
        expect(keys.includes("name")).toBe(false);
        expect(keys.includes("project-status")).toBe(false);
    }, 10_000);
    it("Doesn't return any yanked packages", async () => {
        const res = await exports.default.fetch('http://example.com/pypi/fakeredis');
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/vnd.pypi.simple.v1+json');
        const body = await res.text();
        expect(body.indexOf('"yanked":true')).toBe(-1);
    });
    it("Doesn't return any bad provenance packages", async () => {
        const res = await exports.default.fetch('http://example.com/pypi/fakeredis');
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/vnd.pypi.simple.v1+json');
        const body = await res.text();
        expect(body.indexOf('"2.32.0"')).toBe(-1); // Known package without provenance
    });
    it("Does return good provenance packages", async () => {
        const res = await exports.default.fetch('http://example.com/pypi/fakeredis');
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/vnd.pypi.simple.v1+json');
        const body = await res.text();
        expect(body.indexOf('"2.32.1"') >= 0).toBe(true);
    });
    it("responds with package information even if the URL includes 'integrity'", async () => {
        const res = await exports.default.fetch("http://example.com/pypi/integrity");
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe('application/vnd.pypi.simple.v1+json');
        let json = JSON.parse(await res.text());
        let keys = Object.keys(json);

        // These are for specific project JSONs
        expect(keys.includes("meta")).toBe(true);
        expect(keys.includes("files")).toBe(true);
        expect(keys.includes("versions")).toBe(true);
        expect(keys.includes("name")).toBe(true);
        expect(keys.includes("project-status")).toBe(true);

        expect(keys.includes("projects")).toBe(false);
    });
    it("responds with package information even if the URL includes 'integrity' w/ org and user", async () => {
        const res = await exports.default.fetch("http://example.com/o-example/u-test/pypi/integrity");
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe('application/vnd.pypi.simple.v1+json');
        let json = JSON.parse(await res.text());
        let keys = Object.keys(json);

        // These are for specific project JSONs
        expect(keys.includes("meta")).toBe(true);
        expect(keys.includes("files")).toBe(true);
        expect(keys.includes("versions")).toBe(true);
        expect(keys.includes("name")).toBe(true);
        expect(keys.includes("project-status")).toBe(true);

        expect(keys.includes("projects")).toBe(false);
    });
    it("responds with package information even if the URL includes 'integrity' w/ org", async () => {
        const res = await exports.default.fetch("http://example.com/o-example/pypi/integrity");
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe('application/vnd.pypi.simple.v1+json');
        let json = JSON.parse(await res.text());
        let keys = Object.keys(json);

        // These are for specific project JSONs
        expect(keys.includes("meta")).toBe(true);
        expect(keys.includes("files")).toBe(true);
        expect(keys.includes("versions")).toBe(true);
        expect(keys.includes("name")).toBe(true);
        expect(keys.includes("project-status")).toBe(true);

        expect(keys.includes("projects")).toBe(false);
    });
    it("responds with package information even if the URL includes 'simplejson'", async () => {
        const res = await exports.default.fetch("http://example.com/pypi/simplejson");
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe('application/vnd.pypi.simple.v1+json');
        let json = JSON.parse(await res.text());
        let keys = Object.keys(json);

        // These are for specific project JSONs
        expect(keys.includes("meta")).toBe(true);
        expect(keys.includes("files")).toBe(true);
        expect(keys.includes("versions")).toBe(true);
        expect(keys.includes("name")).toBe(true);
        expect(keys.includes("project-status")).toBe(true);

        expect(keys.includes("projects")).toBe(false);
    });
    it("responds with package integrity information when it exists", async () => {
        const res = await exports.default.fetch("http://example.com/pypi/integrity/idna/3.11/idna-3.11-py3-none-any.whl/provenance");
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe('application/vnd.pypi.integrity.v1+json');
        let json = JSON.parse(await res.text());
        let keys = Object.keys(json);

        // These are for specific project integrity JSONs
        expect(keys.includes("attestation_bundles")).toBe(true);
        expect(keys.includes("version")).toBe(true);
    });
    it("responds with a 404 for package integrity information when it doesn't exist", async () => {
        const res = await exports.default.fetch("http://example.com/pypi/integrity/canarytools/0.2.0/canarytools-0.2.0-py3-none-any.whl/provenance");
        expect(res.status).toBe(404);
    });
    it("replaces all file URLs to not point to https://files.pythonhosted.org", async () => {
        const res = await exports.default.fetch("http://example.com/pypi/integrity");
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe('application/vnd.pypi.simple.v1+json');
        let body = await res.text();
        expect(body.indexOf('https://files.pythonhosted.org')).toBe(-1);
        expect(body.indexOf('/pypi/packages')).above(-1);
    });
    it("returns the correct content-type and data for the JSON API", async () => {
        const res = await exports.default.fetch("http://example.com/pypi/canarytools/json");
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe('application/json');
        let json = JSON.parse(await res.text());
        let keys = Object.keys(json);

        expect(keys.includes("info")).toBe(true);
        expect(keys.includes("last_serial")).toBe(true);
        expect(keys.includes("releases")).toBe(true);
        expect(keys.includes("urls")).toBe(true);
        expect(keys.includes("vulnerabilities")).toBe(true);
        expect(keys.includes("ownership")).toBe(true);
    });
    it("returns the correct content-type and data for the JSON API (packages package)", async () => {
        const res = await exports.default.fetch("http://example.com/pypi/packages/json");
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe('application/json');
        let json = JSON.parse(await res.text());
        let keys = Object.keys(json);

        expect(keys.includes("info")).toBe(true);
        expect(keys.includes("last_serial")).toBe(true);
        expect(keys.includes("releases")).toBe(true);
        expect(keys.includes("urls")).toBe(true);
        expect(keys.includes("vulnerabilities")).toBe(true);
        expect(keys.includes("ownership")).toBe(true);
    });
    it("returns a 200 for a valid file (with old /files/ path)", async () => {
        const res = await exports.default.fetch("http://example.com/files/packages/b3/0b/d6ba17159e5bc432cb679711667e7196bb20d5880aaeca643f4dfeee53c9/canarytools-1.2.2-py2.py3-none-any.whl.metadata");
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/octet-stream');
    });
    it("returns a 200 for a valid file", async () => {
        const res = await exports.default.fetch("http://example.com/pypi/packages/b3/0b/d6ba17159e5bc432cb679711667e7196bb20d5880aaeca643f4dfeee53c9/canarytools-1.2.2-py2.py3-none-any.whl.metadata");
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/octet-stream');
    });
    it("returns a 404 for an invalid file", async () => {
        const res = await exports.default.fetch("http://example.com/files/packages/b3/0b/d6ba17159e5bc432cb679711667e7196bb20d5880aaeca643f4dfeee53c9/notcanarytools-1.2.2-py2.py3-none-any.whl.metadata");
        expect(res.status).toBe(404);
    });
});