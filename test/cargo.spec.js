import { exports } from "cloudflare:workers";
import { describe, it, expect } from "vitest";

describe("Cargo requests", () => {
    it("Returns JSON for a /config.json", async () => {
        const res = await exports.default.fetch('http://example.com/cargo-rs/config.json');
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/json');
        const body = JSON.parse(await res.text());
        expect(body.api).toBe('http://example.com/cargo-rs');
    });
    it("Returns JSON for a /", async () => {
        const res = await exports.default.fetch('http://example.com/cargo-rs/');
        expect(res.status).toBe(200);
    });
    it("Returns 404 for a /favicon.ico", async () => {
        const res = await exports.default.fetch('http://example.com/cargo-rs/favicon.ico');
        expect(res.status).toBe(404);
    });
    it("Doesn't return any yanked packages", async () => {
        const res = await exports.default.fetch('http://example.com/cargo-rs/3/s/syn');
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('text/plain');
        const body = await res.text();
        expect(body.indexOf('"yanked":true')).toBe(-1);
    });
    it("Returns metadata using HTTP basic auth", async () => {
        const res = await exports.default.fetch('http://some.example.com/cargo-rs/3/s/syn', {headers: {'authorization': 'Basic dXNlcjo='}});
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('text/plain');
    });
    // it("Returns metadata using HTTP basic auth including an allowed-version", async () => {
    //     const res = await exports.default.fetch('http://some.example.com/cargo-rs/ru/st/rustls-webpki', {headers: {'authorization': 'Basic dXNlcjo='}});
    //     expect(res.status).toBe(200);
    //     expect(res.headers.get('content-type')).toBe('text/plain');
    //     const body = await res.text();
    //     expect(body.indexOf('"vers":"0.103.12"') >= 0).toBe(true);
    // });
    it("Returns metadata using HTTP basic auth and a sub-domain", async () => {
        const res = await exports.default.fetch('http://cargo.some.example.com/3/s/syn', {headers: {'authorization': 'Basic dXNlcjo='}});
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('text/plain');
    });
});