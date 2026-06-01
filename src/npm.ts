import { fireWebhook, checkJson, Params } from ".";

export { handleNpmMetadata, handleNpmAudit, handleNpmFetch };

const REGISTRIES : { [key: string]: string} = {
	default: "https://registry.npmjs.org",
	'@fortawesome': "https://npm.fontawesome.com"
};
const PURLTYPE = 'npm';

async function handleNpmAudit(request : Request): Promise<Response> {
		const npmUrl = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk';
		//console.log(request.headers);
		//console.log(npmUrl);
		var reqbody;
		const ds = new DecompressionStream("gzip");
		if ((request.headers.get('content-encoding') || 'null') == 'gzip')
			reqbody = await request.body?.pipeThrough(ds);
		else
			reqbody = await request.text();
		//console.log(reqbody);
		return fetch(npmUrl, {method: "post", headers: {accept: "application/json", 'Content-Type': "application/json"}, body: reqbody});
}

async function handleNpmFetch(path : string): Promise<[Response, string, string]> {
		const [pName, pVer] = parseNpmPackageVersion(path);
		//console.log(pName);
		let options : RequestInit<RequestInitCfProperties> = {cf: {cacheEverything: true, cacheTtl: 3600*6}};
		if (Params.config.blockList.has(PURLTYPE + '/' + pName) && (Params.config.blockList.get(PURLTYPE + '/' + pName) == "ALL" || (Params.config.blockList.get(PURLTYPE + '/' + pName) ?? []).indexOf(pVer) >= 0)) {
			console.log(`Got a direct download request for ${pName}@${pVer} -- returning 404`);
			fireWebhook(Params.config.webhookUrl, `npm:${pName}@${pVer}`, "This package/version is on the organization's block list, please contact your admin if this package is needed.");
			return [new Response('Package/version not found', { status: 404 }), pName, pVer];
		}
		let fileUrl = `${REGISTRIES['default']}${path}`;
		if (pName.startsWith('@') && Object.keys(REGISTRIES).includes(pName.split('/')[0])) {
			fileUrl = REGISTRIES[pName.split('/')[0]] + path;
			if (Params.config.bearerToken != "") {
				// If there's an Auth token to set, disable caching of response
				options.headers = {authorization: "Bearer " + Params.config.bearerToken};
				options.cf = {};
			}
		}

		//console.log(fileUrl);
		//console.log(headers);
		return [await fetch(fileUrl, options), pName, pVer];
}

function enforceNpmMinAge(body : string, min_days : number, allowedVers : string[]): string {
	let pkgdata = JSON.parse(body);
	const now = new Date();
	let filteredVersionSet = new Set<string>([]);
	const min_millis = min_days * 24 * 60 * 60 * 1000;
	const versions = Object.keys(pkgdata.time);
	for (var i = 0; i < versions.length; i++) {
		if (versions[i] == 'created' || versions[i] == 'modified')
			continue;
		if (Math.abs(now.getTime() - (new Date(pkgdata.time[versions[i]])).getTime()) < min_millis && !allowedVers.includes(versions[i]))
			filteredVersionSet.add(versions[i]);
	}
	//console.log(filteredVersionSet);
	filteredVersionSet.forEach(v => delete pkgdata.time[v]);
	filteredVersionSet.forEach(v => delete pkgdata.versions[v]);
	return JSON.stringify(pkgdata);
}

function removeNpmChangedIntegrityMetadata(body : string): string {
	let pkgdata = JSON.parse(body);
	let yanked_versions = new Set<string>();
	let last_has_prov = false;
	const versions = Object.keys(pkgdata.versions);
	for (var i = 0; i < versions.length; i++) {
		//console.log(`Checking ${versions[i]}`);
		if (!Object.keys(pkgdata.versions[versions[i]]?.["_npmUser"] ?? {}).includes("trustedPubliser") && last_has_prov)
			yanked_versions.add(versions[i]);
		if (Object.keys(pkgdata.versions[versions[i]]?.["_npmUser"] ?? {}).includes("trustedPubliser"))
			last_has_prov = true;
		else
			last_has_prov = false;
	}
	// if (yanked_versions.size > 0) {
	// 	console.log(`Yanking some versions due to trustedPublisher status: ${yanked_versions}`);
	// }
	yanked_versions.forEach((ver : string) => {
		delete pkgdata.time[ver];
		delete pkgdata.versions[ver]
	});
	//console.log(yanked_versions);
	return JSON.stringify(pkgdata);
}

function removeNpmBlockedVersions(body : string, packageName : string, blockList : Map<string, string | string[]>): string {
	let pkgdata = JSON.parse(body);
	const bversions = blockList.get(PURLTYPE + '/' + packageName) ?? [];
	for (var i = 0; i < bversions.length; i++) {
		//console.log(`Deleting ${bversions[i]} from ${packageName}`);
		delete pkgdata.time[bversions[i]];
		delete pkgdata.versions[bversions[i]];
	}
	return JSON.stringify(pkgdata);
}

function parseNpmPackageVersion(pathname : string): string[] {
	const pieces = pathname.split("/");
	const regex = /^(.*)-(\d+\.\d+\.\d+.*)\.tgz$/;

	const match = pieces[pieces.length - 1].match(regex);
    if (match == null || (match?.length ?? 0) < 3)
        return ['', ''];
	// If there's a scope, we add it back in:
	if (pieces.length >= 2 && pieces[1].startsWith('@'))
		return [pieces[1] + '/' + match[1], match[2]];
	return [match[1], match[2]];
}

function getDepsForPackage(body : string): string[] {
	const pkgdata = JSON.parse(body);
	let deps : Set<string> = new Set();
	Object.keys(pkgdata.versions).forEach((v) => {
		Object.keys(pkgdata.versions[v].get("dependencies") ?? {}).forEach((pkg) => deps.add(pkg));
		Object.keys(pkgdata.versions[v].get("peerDependencies") ?? {}).forEach((pkg) => deps.add(pkg));
		Object.keys(pkgdata.versions[v].get("devDependencies") ?? {}).forEach((pkg) => deps.add(pkg));
	});
	return Array.from(deps);
}

function fixLatest(body : string): string {
	let pkgdata = JSON.parse(body);
	const vers = Object.keys(pkgdata.versions);
	if (Object.keys(pkgdata).includes("dist-tags"))
		pkgdata["dist-tags"]["latest"] = vers.pop();
	return JSON.stringify(pkgdata);
}

async function handleNpmMetadata(path : string, filePrefix : string, recentAudit : boolean): Promise<Response> {
	const packageName = (path.replace(/\/$/, '').split("/").pop() || "").replaceAll('%2f', '/');
	const origin = Params.url?.origin;
	let registryUrl = REGISTRIES['default'];
	let headers : { [key: string]: string } = {accept: "application/json"};
	if (packageName.startsWith('@') && Object.keys(REGISTRIES).includes(packageName.split('/')[0])) {
		if (Params.config.bearerToken != "")
			headers.authorization = "Bearer " + Params.config.bearerToken;
		registryUrl = REGISTRIES[packageName.split('/')[0]];
	}
	const npmUrl = `${registryUrl}${path}`;

	let filePath : string = `${origin}${filePrefix}/npmfiles`;

	//console.log(packageName);
	if (path == "/-/ping")
		return fetch(npmUrl, {cf: {cacheEverything: true, cacheTtl: 5}});
	if (path.endsWith('.tgz')) {
		console.log(`NPM target: ${path}`);
		return new Response('Something went wrong...', { status: 500 });
	}
	const response = await fetch(npmUrl, {headers: headers, cf: {cacheEverything: true, cacheTtl: 60 * 30}});
	if (response.status != 200) {
		//console.log(`${npmUrl}: ${response.status} - ${await response.text()}`);
		//return new Response("Package not found.", { status: 404 });
		return response;
	}
	let body = await response.text();
	if (!checkJson(body))
		return new Response("Received invalid upstream JSON.", { status: 400 });
	if (Params.config.blockList.has(PURLTYPE + '/' + packageName)) {
		if (Params.config.blockList.get(PURLTYPE + '/' + packageName) == "ALL") {
			return new Response("Package/version blocked.", { status: 404 });
		} else {
			body = removeNpmBlockedVersions(body, packageName, Params.config.blockList);
			//console.log(body);
		}
	}
	if (!(recentAudit && Params.config.ALLOW_AUDIT_OVERRIDE)) {
		//console.log("Checking min age for " + packageName);
		body = enforceNpmMinAge(body, Params.config.MIN_AGE_DAYS, Params.config.allowList.get(PURLTYPE + '/' + packageName) || []);
	}
	if (!Params.config.ALLOW_CHANGED_PUBLISHER) {
		body = removeNpmChangedIntegrityMetadata(body);
	}

	body = fixLatest(body);
	// else {
	//  	console.log("In an audit situation, allowing unrestricted access to " + packageName);
	// }
	//console.log(body);
	if (Params.config.REWRITE_DOWNLOAD_URLS) {
		// Rewrite URLs in the response body to go through the Cloudflare Worker
		body = body.replaceAll(registryUrl, filePath);
	}
	//console.log(body);

	return new Response(body, {
		headers: { 'Content-Type': "application/json"}
	});
}