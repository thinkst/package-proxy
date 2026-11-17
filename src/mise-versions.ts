/**
 * Wrapper for mise-versions GitHub metadata API cache service
 *
 * https://mise-versions.jdx.dev/share-rate-limit
 *
 * The service lets us get release, tag, content, and attestation metadata bypassing GitHub's rate
 * limits. Normally mise would query this service directly, but we proxy those requests to
 * enforce policies.
 *
 */

export type GithubAsset = {
	id?: number;
	url?: string;
	browser_download_url?: string;
};

export type GithubRelease = {
	tag_name?: string;
	published_at?: string | null;
	created_at?: string | null;
	draft?: boolean;
	assets?: GithubAsset[];
	[key: string]: unknown;
};

export type CompactVersions = {
	releases?: Array<{ tag: string; date?: string | null; prerelease: boolean; asset_count: number }>;
	tags?: Array<{ tag: string; date?: string | null; sha?: string }>;
};

const MISE_VERSIONS_BASE_URL = "https://mise-versions.jdx.dev";

const requestOptions: RequestInit<RequestInitCfProperties> = {
	headers: { accept: "application/json", "user-agent": "Thinkst-Package-Proxy" },
	cf: { cacheEverything: true, cacheTtl: 30 * 60 }
};

function repositoryPath(repository: string): string {
	return repository.split("/").map(part => encodeURIComponent(part.toLowerCase())).join("/");
}

export function fetchReleases(repository: string): Promise<Response> {
	return fetch(`${MISE_VERSIONS_BASE_URL}/data/github/${repositoryPath(repository)}/releases.json`, requestOptions);
}

export function fetchRelease(repository: string, tag: string): Promise<Response> {
	return fetch(`${MISE_VERSIONS_BASE_URL}/api/github/repos/${repositoryPath(repository)}/releases/${encodeURIComponent(tag)}`, requestOptions);
}

export function fetchTags(repository: string): Promise<Response> {
	return fetch(`${MISE_VERSIONS_BASE_URL}/data/github/${repositoryPath(repository)}/tags.json`, requestOptions);
}

export function fetchAttestations(repository: string, digest: string): Promise<Response> {
	return fetch(`${MISE_VERSIONS_BASE_URL}/api/github/repos/${repositoryPath(repository)}/attestations/${digest}`, requestOptions);
}

export function fetchContents(repository: string, path: string, ref: string): Promise<Response> {
	return fetch(`${MISE_VERSIONS_BASE_URL}/api/github/repos/${repositoryPath(repository)}/contents/${path}?ref=${encodeURIComponent(ref)}`, requestOptions);
}
