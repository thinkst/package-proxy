import { ConfigProps, fireWebhook, Params } from "./index";
import * as miseVersions from "./mise-versions";

type GithubTag = {
	name?: string;
	date?: string | null;
	commit?: { sha?: string; url?: string };
	[key: string]: unknown;
};

/**
 * GitHub origins intercepted for mise:
 * - api-github-com for release metadata.
 * - github-com for release assets and source archives.
 * - raw-githubusercontent-com for repository files (including Aqua github_content packages).
 */
const GITHUB_INTERCEPT = {
	"api-github-com": "https://api.github.com",
	"github-com": "https://github.com",
	"raw-githubusercontent-com": "https://raw.githubusercontent.com"
} as const;

const defaultFetchOptions: RequestInit<RequestInitCfProperties> = {
	headers: { "user-agent": "Thinkst-Package-Proxy" },
	cf: { cacheEverything: true, cacheTtl: 6 * 60 * 60 }
};

function listedVersion(versions: string[] | string, version: string): boolean {
	if (versions == "ALL")
		return true;
	const decoded = decodeURIComponent(version);
	const candidates = decoded.startsWith("v") ? [decoded, decoded.slice(1)] : [decoded, `v${decoded}`];
	return candidates.some(candidate => versions.includes(candidate));
}

function repositoryConfig<T>(values: Map<string, T>, repository: string): T | undefined {
	const direct = values.get(repository);
	if (direct != undefined)
		return direct;
	const normalized = repository.toLowerCase();
	for (const [name, value] of values) {
		if (name.toLowerCase() == normalized)
			return value;
	}
	return undefined;
}

function blocked(repository: string, version?: string, config: ConfigProps = Params.config): boolean {
	const configured = repositoryConfig(config.blockList, repository);
	if (configured == undefined)
		return false;
	return configured == "ALL" || (version != undefined && listedVersion(configured, version));
}

function allowed(repository: string, version: string, config: ConfigProps = Params.config): boolean {
	return listedVersion(repositoryConfig(config.allowList, repository) ?? [], version);
}

function oldEnough(date: string | null | undefined, minDays: number): boolean {
	if (date == null)
		return false;
	const timestamp = new Date(date).getTime();
	if (Number.isNaN(timestamp))
		return false;
	return Date.now() - timestamp >= minDays * 24 * 60 * 60 * 1000;
}

function versionAllowed(version: string, date: string | null | undefined, repository: string, config: ConfigProps): boolean {
	if (version == "" || blocked(repository, version, config))
		return false;
	return allowed(repository, version, config) || oldEnough(date, config.MIN_AGE_DAYS);
}

function releaseAllowed(release: miseVersions.GithubRelease, repository: string, config: ConfigProps): boolean {
	if (release.draft)
		return false;
	return versionAllowed(release.tag_name ?? "", release.published_at ?? release.created_at, repository, config);
}

function tagAllowed(tag: GithubTag, repository: string, config: ConfigProps): boolean {
	return versionAllowed(tag.name ?? "", tag.date, repository, config);
}

function rewriteGithubUrls(body: string, packageProxyOrigin: string, filePrefix: string): string {
	for (const [route, githubOrigin] of Object.entries(GITHUB_INTERCEPT))
		body = body.replaceAll(`${githubOrigin}/`, `${packageProxyOrigin}${filePrefix}/mise/${route}/`);
	return body;
}

function assetCacheKey(repository: string, id: number): Request {
	return new Request(`https://mise.package-proxy.invalid/assets/${encodeURIComponent(repository.toLowerCase())}/${id}`);
}

function enforceRepositoryPolicy(repository: string): Response | null {
	if (blocked(repository)) {
		fireWebhook(Params.config.webhookUrl, `mise:${repository}`, "This repository is on the organization's block list.");
		return new Response("Repository not found", { status: 404 });
	}
	return null;
}

async function releaseForTag(repository: string, tag: string): Promise<miseVersions.GithubRelease | null> {
	const decodedTag = decodeURIComponent(tag);
	const response = await miseVersions.fetchRelease(repository, decodedTag);
	if (!response.ok)
		return null;
	return await response.json() as miseVersions.GithubRelease;
}

async function tagForName(repository: string, name: string): Promise<GithubTag | null> {
	const response = await miseVersions.fetchTags(repository);
	if (!response.ok)
		return null;
	const list = await response.json() as { tags?: Array<{ tag?: string; sha?: string; date?: string | null }> };
	const decoded = decodeURIComponent(name);
	const found = list.tags?.find(tag => tag.tag == decoded || tag.sha == decoded);
	if (found == null)
		return null;
	return { name: found.tag, date: found.date, commit: { sha: found.sha } };
}

async function enforceReleasePolicy(repository: string, tag: string): Promise<Response | null> {
	if (blocked(repository, tag)) {
		fireWebhook(Params.config.webhookUrl, `mise:${repository}@${decodeURIComponent(tag)}`, "This release is on the organization's block list.");
		return new Response("Release not found", { status: 404 });
	}
	if (allowed(repository, tag))
		return null;
	const release = await releaseForTag(repository, tag);
	if (release != null && releaseAllowed(release, repository, Params.config))
		return null;
	const githubTag = await tagForName(repository, tag);
	if (githubTag == null || !tagAllowed(githubTag, repository, Params.config))
		return new Response("Release not found", { status: 404 });
	return null;
}

function responseHeaders(contentType = "application/json"): Headers {
	return new Headers({ "content-type": contentType, "cache-control": "public, max-age=0, s-maxage=600" });
}

function nextPageLink(path: string, filePrefix: string, page: number): string {
	return `<${Params.url?.origin ?? ""}${filePrefix}/mise/api-github-com${path}?per_page=100&page=${page}>; rel="next"`;
}

async function handleReleaseDetail(repository: string, tag: string, filePrefix: string): Promise<Response> {
	const release = await releaseForTag(repository, tag);
	if (release == null || !releaseAllowed(release, repository, Params.config))
		return new Response("Release not found", { status: 404 });
	for (const asset of release.assets ?? []) {
		const assetMatch = asset.url?.match(/\/releases\/assets\/(\d+)$/);
		const id = asset.id ?? (assetMatch == null ? null : Number(assetMatch[1]));
		if (id == null || asset.browser_download_url == null)
			continue;
		await caches.default.put(assetCacheKey(repository, id), new Response(JSON.stringify({
			tag_name: release.tag_name,
			published_at: release.published_at ?? release.created_at,
			browser_download_url: asset.browser_download_url
		}), { headers: { "cache-control": "public, max-age=3600", "content-type": "application/json" } }));
	}
	let body = JSON.stringify(release);
	if (Params.config.REWRITE_DOWNLOAD_URLS)
		body = rewriteGithubUrls(body, Params.url?.origin ?? "", filePrefix);
	return new Response(body, { headers: responseHeaders() });
}

async function passMirrorResponse(upstream: Response, filePrefix: string): Promise<Response> {
	if (!upstream.ok)
		return upstream;
	let body = await upstream.text();
	if (Params.config.REWRITE_DOWNLOAD_URLS)
		body = rewriteGithubUrls(body, Params.url?.origin ?? "", filePrefix);
	return new Response(body, { status: upstream.status, headers: responseHeaders(upstream.headers.get("content-type") ?? "application/json") });
}

export async function handleMiseApiGithubCom(path: string, filePrefix: string, query: string, logDownload?: (repository: string, version: string) => Promise<void>): Promise<Response> {
	const repositoryMatch = path.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
	if (repositoryMatch == null)
		return new Response("Unsupported GitHub API path", { status: 404 });
	const repository = `${decodeURIComponent(repositoryMatch[1])}/${decodeURIComponent(repositoryMatch[2])}`;
	const repositoryPath = repositoryMatch[3] ?? "";
	const deniedRepository = enforceRepositoryPolicy(repository);
	if (deniedRepository != null)
		return deniedRepository;

	const assetMatch = repositoryPath.match(/^\/releases\/assets\/(\d+)\/?$/);
	if (assetMatch != null) {
		const id = Number(assetMatch[1]);
		const cachedRelease = await caches.default.match(assetCacheKey(repository, id));
		if (cachedRelease == undefined)
			return new Response("Release asset not found", { status: 404 });
		const release = await cachedRelease.json() as miseVersions.GithubRelease & { browser_download_url?: string };
		if (!releaseAllowed(release, repository, Params.config) || release.browser_download_url == null)
			return new Response("Release asset not found", { status: 404 });
		const response = await fetch(release.browser_download_url, defaultFetchOptions);
		if (response.ok && release.tag_name != null && logDownload != undefined)
			await logDownload(repository, release.tag_name);
		return response;
	}

	const archiveMatch = repositoryPath.match(/^\/(tarball|zipball)\/(.+)\/?$/);
	if (archiveMatch != null) {
		const tag = archiveMatch[2].replace(/\/$/, "");
		const denied = await enforceReleasePolicy(repository, tag);
		if (denied != null)
			return denied;
		const extension = archiveMatch[1] == "tarball" ? "tar.gz" : "zip";
		const encodedTag = decodeURIComponent(tag).split("/").map(encodeURIComponent).join("/");
		return fetch(`${GITHUB_INTERCEPT["github-com"]}/${repository}/archive/refs/tags/${encodedTag}.${extension}`, defaultFetchOptions);
	}

	if (/^\/releases\/?$/.test(repositoryPath)) {
		const requestedPage = Number(new URLSearchParams(query).get("page") ?? "1");
		const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
		const upstream = await miseVersions.fetchReleases(repository);
		if (!upstream.ok)
			return upstream;
		const mirrored = await upstream.json() as miseVersions.CompactVersions;
		const allowedReleases = (mirrored.releases ?? []).map(release => ({
			tag_name: release.tag,
			draft: false,
			prerelease: release.prerelease,
			created_at: release.date ?? "",
			published_at: release.date,
			assets: release.asset_count > 0 ? [{ name: "", url: "", browser_download_url: "" }] : []
		})).filter(release => releaseAllowed(release, repository, Params.config));
		let body = JSON.stringify(allowedReleases.slice((page - 1) * 100, page * 100));
		if (Params.config.REWRITE_DOWNLOAD_URLS)
			body = rewriteGithubUrls(body, Params.url?.origin ?? "", filePrefix);
		const headers = responseHeaders();
		if (page * 100 < allowedReleases.length)
			headers.set("link", nextPageLink(path, filePrefix, page + 1));
		return new Response(body, { headers });
	}
	if (/^\/releases\/latest\/?$/.test(repositoryPath))
		return handleReleaseDetail(repository, "latest", filePrefix);
	const releaseTagMatch = repositoryPath.match(/^\/releases\/tags\/(.+)\/?$/);
	if (releaseTagMatch != null)
		return handleReleaseDetail(repository, releaseTagMatch[1].replace(/\/$/, ""), filePrefix);
	if (/^\/tags\/?$/.test(repositoryPath)) {
		const requestedPage = Number(new URLSearchParams(query).get("page") ?? "1");
		const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
		const upstream = await miseVersions.fetchTags(repository);
		if (!upstream.ok)
			return upstream;
		const mirrored = await upstream.json() as miseVersions.CompactVersions;
		const allowedTags = (mirrored.tags ?? []).map(tag => ({
			name: tag.tag,
			date: tag.date,
			commit: { sha: tag.sha, url: `${GITHUB_INTERCEPT["api-github-com"]}/repos/${repository}/commits/${tag.sha}` }
		})).filter(tag => tagAllowed(tag, repository, Params.config));
		let body = JSON.stringify(allowedTags.slice((page - 1) * 100, page * 100));
		if (Params.config.REWRITE_DOWNLOAD_URLS)
			body = rewriteGithubUrls(body, Params.url?.origin ?? "", filePrefix);
		const headers = responseHeaders();
		if (page * 100 < allowedTags.length)
			headers.set("link", nextPageLink(path, filePrefix, page + 1));
		return new Response(body, { headers });
	}
	const commitMatch = repositoryPath.match(/^\/commits\/(.+)\/?$/);
	if (commitMatch != null) {
		const tag = await tagForName(repository, commitMatch[1].replace(/\/$/, ""));
		if (tag == null || !tagAllowed(tag, repository, Params.config))
			return new Response("Commit not found", { status: 404 });
		return Response.json({
			sha: tag.commit?.sha,
			commit: { author: { date: tag.date }, committer: { date: tag.date } }
		}, { headers: responseHeaders() });
	}

	const attestationsMatch = repositoryPath.match(/^\/attestations\/(.+)\/?$/);
	if (attestationsMatch != null) {
		const digest = encodeURIComponent(decodeURIComponent(attestationsMatch[1].replace(/\/$/, ""))).replace("%3A", ":");
		return passMirrorResponse(await miseVersions.fetchAttestations(repository, digest), filePrefix);
	}
	const contentsMatch = repositoryPath.match(/^\/contents\/(.+)$/);
	if (contentsMatch != null) {
		const ref = new URLSearchParams(query).get("ref");
		if (ref == null)
			return new Response("A full commit ref is required", { status: 400 });
		const contentPath = contentsMatch[1].split("/").map(part => encodeURIComponent(decodeURIComponent(part))).join("/");
		return passMirrorResponse(await miseVersions.fetchContents(repository, contentPath, ref), filePrefix);
	}

	return new Response("Unsupported by mise-versions", { status: 404 });
}

export async function handleMiseGithubFetch(path: string, route: "github-com" | "raw-githubusercontent-com", method: "GET" | "HEAD" = "GET"): Promise<[Response, string, string]> {
	const repositoryMatch = path.match(/^\/([^/]+)\/([^/]+)(\/.*)?$/);
	if (repositoryMatch == null)
		return [new Response("Unsupported GitHub path", { status: 404 }), "", ""];
	const repository = `${decodeURIComponent(repositoryMatch[1])}/${decodeURIComponent(repositoryMatch[2]).replace(/\.git$/, "")}`;
	const repositoryPath = repositoryMatch[3] ?? "";
	const deniedRepository = enforceRepositoryPolicy(repository);
	if (deniedRepository != null)
		return [deniedRepository, repository, ""];

	let version = "";
	const releaseMatch = repositoryPath.match(/^\/releases\/download\/([^/]+)\//);
	if (releaseMatch != null) {
		version = decodeURIComponent(releaseMatch[1]);
		const denied = await enforceReleasePolicy(repository, releaseMatch[1]);
		if (denied != null)
			return [denied, repository, version];
	}
	const archiveMatch = repositoryPath.match(/^\/archive\/(?:refs\/tags\/)?(.+?)(?:\.tar\.gz|\.zip)$/);
	if (archiveMatch != null) {
		version = decodeURIComponent(archiveMatch[1]);
		const denied = await enforceReleasePolicy(repository, archiveMatch[1]);
		if (denied != null)
			return [denied, repository, version];
	}

	const githubOrigin = GITHUB_INTERCEPT[route];
	const response = await fetch(`${githubOrigin}${path}${Params.url?.search ?? ""}`, { ...defaultFetchOptions, method });
	return [response, repository, version];
}
