export { handlePypiMetadata, handlePypiFetch };
import { ConfigProps, fireWebhook, checkJson, saveKv, Params } from "./index";

const PURLTYPE = 'pypi';

function parsePyPackageVersion(pathname : string): string[] {
	const pieces = pathname.split("/");
	const whl = pieces[pieces.length - 1].split("-");
	return [whl[0], whl[1]];
}

function removePyBlockedVersions(body : string, packageName : string, blockList : Map<string, string | string[]>): string {
	let pkgdata = JSON.parse(body);
	const bversions = blockList.get(PURLTYPE + '/' + packageName) ?? [];
	for (var i = 0; i < bversions.length; i++) {
		const idx = pkgdata.versions.indexOf(bversions[i]);
		if (idx >= 0) {
			//console.log(`Slicing ${bversions[i]} from ${packageName}!`);
			pkgdata.versions.splice(idx, 1); // Remove version from the versions array
		}
		// Remove all matching files from the files list
		pkgdata.files = pkgdata.files.filter((elem: { filename : string }) => elem.filename.indexOf(packageName + '-' + bversions[i]) != 0);
	}
	return JSON.stringify(pkgdata);
}

// Returns true if the integrity has diminished
async function checkIntegrityAPI(requestedPath : string, previousVersionPath : string): Promise<boolean> {
	try {
		const currResp = await fetch(`https://pypi.org/integrity${requestedPath}/provenance`, {
			headers: { accept: "application/vnd.pypi.integrity.v1+json" },
			cf: {
				cacheEverything: true,
				cacheTtl: 3600
			}
		});
		const prevResp = await fetch(`https://pypi.org/integrity${previousVersionPath}/provenance`, {
			headers: { accept: "application/vnd.pypi.integrity.v1+json" },
			cf: {
				cacheEverything: true,
				cacheTtl: 3600
			}
		});
		if (currResp.status == 404 && prevResp.status == 200) {
			// There was provenance for the previous version, but there isn't any now -> REJECT
			return true;
		} else if (currResp.status == 404 && prevResp.status == 404) {
			// No provenance for either -> ALLOW
			return false;
		} else if (currResp.status == 200 && prevResp.status == 200) {
			const currJson = JSON.parse(await currResp.text());
			const prevJson = JSON.parse(await prevResp.text());

			//console.log(`Checking the publishers types ${currJson["attestation_bundles"][0].publisher.kind} -> ${prevJson["attestation_bundles"][0].publisher.kind}`);

			if (currJson["attestation_bundles"].length == 0 && prevJson["attestation_bundles"].length > 0)
				return true;
			if (currJson["attestation_bundles"][0].publisher.kind != "GitHub" && prevJson["attestation_bundles"][0].publisher.kind == "GitHub")
				return true;
			//console.log(`Allowing the publishers types ${currJson["attestation_bundles"][0].publisher.kind} -> ${prevJson["attestation_bundles"][0].publisher.kind}`);
			return false;
		} else {
			// Unable to ascertain for now
			return false;
		}
	} catch (error) {
		console.log(error);
		return false
	}
}

// Returns true if the version has a different publishing method than the previous version
// async function checkPyChangedPublisher(packageName: string, versionToCheck: string, suffix = '-py3-none-any.whl'): Promise<boolean> {
// 	try {
// 		const indexResp = await fetch(`https://pypi.org/simple/${packageName}`, { headers: { accept: "application/vnd.pypi.simple.v1+json" }, cf: { cacheEverything: true, cacheTtl: 60 * 30 } });
// 		if (indexResp.status != 200) // If there's no package information we just return false
// 			return false
// 		const body = JSON.parse(await indexResp.text());
// 		const idx = body.versions.indexOf(versionToCheck);
// 		if (idx < 1) { // Either this is the first version, or it's not a valid version
// 			return false
// 		}
// 		const prevVersion = body.versions[idx - 1];
// 		return await checkIntegrityAPI(`/${packageName}/${versionToCheck}/${packageName}-${versionToCheck}${suffix}`, `/${packageName}/${prevVersion}/${packageName}-${prevVersion}${suffix}`);
// 	} catch (error) {
// 		console.log(error);
// 		return false;
// 	}
// }

function removePyChangedIntegrityMetadata(body : string): string {
	let pkgdata = JSON.parse(body);
	const pName = pkgdata.name;
	let yanked_versions = new Set<string>();
	let yanked_files = new Set<string>();
	let last_has_prov = false;
	for (var i = 0; i < pkgdata.files.length; i++) {
		if (pkgdata.files[i].provenance == null && last_has_prov)
			yanked_files.add(pkgdata.files[i].filename);
		if (pkgdata.files[i].provenance == null && last_has_prov && pkgdata.files[i].filename.endsWith(".whl")) // TODO make this more graceful
			yanked_versions.add(pkgdata.files[i].filename.split('-')[1]);
		if (pkgdata.files[i].provenance != null)
			last_has_prov = true;
		if (pkgdata.files[i].provenance == null && pkgdata.files[i].filename.endsWith(".tar.gz"))
			last_has_prov = false;
	}
	pkgdata.files = pkgdata.files.filter((elem: { filename : string }) => !yanked_files.has(elem.filename));
	pkgdata.versions = pkgdata.versions.filter((elem : string) => !yanked_versions.has(elem));
	if (yanked_versions.size > 0) {
		//console.log(`Yanking ${yanked_versions.size} versions!`);
		yanked_versions.forEach((v) => {
			//console.log(v);
			if (Params.config.blockList.has(PURLTYPE + '/' + pName) && Params.config.blockList.get(PURLTYPE + '/' + pName)?.indexOf(v) == -1) {
				const newBl = (Params.config.blockList.get(PURLTYPE + '/' + pName) ?? []);
				if (newBl == "ALL") {
					console.log("Something went wrong and we're checking ingrity on a blocked package");
					return JSON.stringify(pkgdata);
				}
				if (typeof (newBl) === "object") {
					Params.config.blockList.set(PURLTYPE + '/' + pName, newBl.concat([v]));
					Params.ctx?.waitUntil(saveKv());
				}
			} else if (!Params.config.blockList.has(PURLTYPE + '/' + pName)) {
				Params.config.blockList.set(PURLTYPE + '/' + pName, [v]);
				Params.ctx?.waitUntil(saveKv());
			}
		});
	}
	return JSON.stringify(pkgdata);
}

function removePyYanked(body : string): string {
	let pkgdata = JSON.parse(body);
	let yanked_versions = new Set<string>();
	for (var i = 0; i < pkgdata.files.length; i++) {
		if (pkgdata.files[i].yanked && pkgdata.files[i].filename.endsWith(".whl")) // TODO make this more graceful
			yanked_versions.add(pkgdata.files[i].filename.split('-')[1]);
	}
	pkgdata.files = pkgdata.files.filter((elem: { yanked : boolean }) => !elem.yanked);
	pkgdata.versions = pkgdata.versions.filter((elem : string) => !yanked_versions.has(elem));
	//console.log(pkgdata.versions);
	return JSON.stringify(pkgdata);
}

function enforcePyMinAge(body : string, min_days : number, allowedVers : string[]): string {
	let pkgdata = JSON.parse(body);
	const now = new Date();
	let filteredVersionSet = new Set<string>([]);
	const min_millis = min_days * 24 * 60 * 60 * 1000;
	const filtered = pkgdata.files.filter((elem : { "upload-time" : string }) => Math.abs(now.getTime() - (new Date(elem['upload-time'])).getTime()) < min_millis);
	for (var i = 0; i < filtered.length; i++) {
		if (!allowedVers.includes(filtered[i].filename.split("-")[1]))
			filteredVersionSet.add(filtered[i].filename.split("-")[1]);
	}
	//console.log(filteredVersionSet);
	pkgdata.files = pkgdata.files.filter((elem : { "upload-time" : string, "filename" : string }) =>
		Math.abs(now.getTime() - (new Date(elem['upload-time'])).getTime()) >= min_millis && !allowedVers.includes(elem['filename'].split("-")[1]));
	pkgdata.versions = pkgdata.versions.filter((v : string) => !filteredVersionSet.has(v));
	return JSON.stringify(pkgdata);
}

async function handlePypiMetadata(pypiPath : string, filePrefix : string): Promise<Response> {
	const packageName = pypiPath.replace(/\/$/, '').split("/").pop() || "";
	const origin = Params.url?.origin;
	let pypiUrl = `https://pypi.org${pypiPath}`;

	let filePath : string = `${origin}${filePrefix}/pypi`;
	// if (org != "" && user != "")
	// 	filePath = `${origin}/o-${org}/u-${user}${filePrefix}/pypi`;
	// else if (org != "")
	// 	filePath = `${origin}/o-${org}${filePrefix}/pypi`
	// else
	// 	filePath = `${origin}${filePrefix}/pypi`;

	if (!pypiPath.startsWith('/simple/') && !pypiPath.endsWith('/json'))
		pypiUrl = `https://pypi.org/simple${pypiPath}`;
	//console.log(pypiUrl);
	if (pypiPath.endsWith('/json') && !pypiPath.startsWith('/simple')) { // This is the JSON API, not the Index/simple API
		pypiUrl = `https://pypi.org/pypi${pypiPath}`;
		const response = await fetch(pypiUrl, { headers: { accept: "application/json" } });
		let body = await response.text();

		body = body.replace(/https:\/\/files.pythonhosted.org/g, filePath);
		return new Response(body, {
			headers: { 'Content-Type': "application/json" }
		});
	} else if (pypiPath.endsWith('/provenance') && pypiPath.startsWith('/integrity')) { // Integrity API
		pypiUrl = `https://pypi.org/${pypiPath}`;
		return fetch(pypiUrl, { headers: { accept: "application/vnd.pypi.integrity.v1+json" } });
	} else { // Simple/Index API
		const response = await fetch(pypiUrl, { headers: { accept: "application/vnd.pypi.simple.v1+json" } });
		if (response.status != 200 || packageName == '' || pypiPath == '/simple' || pypiPath == '/simple/') {
			return response;
		}
		let body = await response.text();
		if (!checkJson(body))
			return new Response("Received invalid upstream JSON.", { status: 400 });
		if (Params.config.blockList.has(PURLTYPE + '/' + packageName)) {
			if (Params.config.blockList.get(PURLTYPE + '/' + packageName) == "ALL") {
				return new Response("Not found.", { status: 404 });
			} else {
				body = removePyBlockedVersions(body, packageName, Params.config.blockList);
				//console.log(body);
			}
		}
		if (!Params.config.ALLOW_YANKED) {
			body = removePyYanked(body);
		}
		if (!Params.config.ALLOW_CHANGED_PUBLISHER) {
			body = removePyChangedIntegrityMetadata(body);
		}
		body = enforcePyMinAge(body, Params.config.MIN_AGE_DAYS, Params.config.allowList.get(PURLTYPE + '/' + packageName) || []);
		//console.log(body);
		if (Params.config.REWRITE_DOWNLOAD_URLS) {
			// Rewrite URLs in the response body to go through the Cloudflare Worker
			body = body.replace(/https:\/\/files.pythonhosted.org/g, filePath);
		}
		return new Response(body, {
			headers: { 'Content-Type': "application/vnd.pypi.simple.v1+json" }
		});
	}
}

async function handlePypiFetch(path : string): Promise<[Response, string, string]> {
	const [pName, pVer] = parsePyPackageVersion(path);
	if (Params.config.blockList.has(PURLTYPE + '/' + pName) && (Params.config.blockList.get(PURLTYPE + '/' + pName) == "ALL" || (Params.config.blockList.get(PURLTYPE + '/' + pName) ?? []).indexOf(pVer) >= 0)) {
		console.log(`Got a direct download request for ${pName}@${pVer} -- returning 404`);
		fireWebhook(Params.config.webhookUrl, `pypi:${pName}@${pVer}`, "This package/version is on the organization's block list, please contact your admin if this package is needed.");
		return [new Response('Package/version not found', { status: 404 }), pName, pVer];
	}
	// if (!config.ALLOW_CHANGED_PUBLISHER) {
	// 	if (await checkPyChangedPublisher(pName, pVer)) {
	// 		console.log(`Got a direct download request for ${pName}@${pVer} which has a changed publisher status -- returning 404`);
	// 		fireWebhook(ctx, config.webhookUrl, user, `pypi:${pName}@${pVer}`, "This package version has changed its provenance status to be less secure, please contact your admin if this version is needed.");
	// 		return [new Response('Package/version not found', { status: 404 }), pName, pVer];
	// 	}
	// }
	const fileUrl = `https://files.pythonhosted.org${path}`;
	//console.log(fileUrl);
	return [await fetch(fileUrl, { cf: { cacheEverything: true, cacheTtl: 3600*6 } }), pName, pVer];
}
