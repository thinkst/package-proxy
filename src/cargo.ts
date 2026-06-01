export { handleCargoMetadata, handleCargoFetch };
import { ConfigProps, fireWebhook } from "./index";

const PURLTYPE = 'cargo';

function checkAge(row : string, now_ms : number, min_ms : number, allowedVers : string[]) {
    if (row != '') {
        const parsed = JSON.parse(row);
        return allowedVers.includes(parsed["vers"]) || Math.abs(now_ms - (new Date(parsed["pubtime"])).getTime()) > min_ms;
    }
    return false;
}

function enforceMinAge(body : string, minDays : number, allowedVers : string[]): string {
    const min_millis = minDays * 24 * 60 * 60 * 1000;
    let pkgdata = body.split('\n');
    const now = new Date();
    const filtered = pkgdata.filter((row : string) => checkAge(row, now.getTime(), min_millis, allowedVers));
    return filtered.join("\n");
}

function checkYanked(row : string) {
    if (row != '') 
        return !JSON.parse(row)["yanked"];
    return false;
}

function enforceYanked(body : string): string {
    let pkgdata = body.split('\n');
    const filtered = pkgdata.filter((row : string) => checkYanked(row));
    return filtered.join("\n");
}

function checkBlocklistVer(row : string, vers : string[]): boolean {
    if (row != '') 
        return !vers.includes(JSON.parse(row)["vers"]);
    return false;
}

function enforceBlocklist(body : string, blockedVers : string[]): string {
    let pkgdata = body.split('\n');
    const filtered = pkgdata.filter((row : string) => checkBlocklistVer(row, blockedVers));
    return filtered.join("\n");
}

async function handleCargoMetadata(origin : string, remainingPath : string, filePrefix : string, org : string, user : string, config : ConfigProps): Promise<Response> {
    const upstreamUrl = "https://index.crates.io";
    const pkgName = remainingPath.split('/').pop() || "";

    let filePath : string = `${origin}${filePrefix}/cargofiles`;
	// if (org != "" && user != "")
	// 	filePath = `${origin}/o-${org}/u-${user}${filePrefix}/cargofiles`;
	// else if (org != "")
	// 	filePath = `${origin}/o-${org}${filePrefix}/cargofiles`
	// else
	// 	filePath = `${origin}${filePrefix}/cargofiles`;
    //console.log(`Got req for ${remainingPath}`);
    if (remainingPath == '/config.json') {
        // console.log(JSON.stringify({
        //     dl: `${origin}/o-${org}/u-${user}${filePrefix}/cargofiles`,
        //     api: origin + filePrefix + '/cargo-rs'
        // }));
        let path = '/cargo-rs';
        if (origin.replace('https://', '').replace('http://', '').split('.')[0] == 'cargo')
            path = '';
        return new Response(JSON.stringify({
            dl: filePath,
            api: origin + filePrefix + path
        }), {headers: {'content-type': 'application/json'}});
    } else if (remainingPath == '/') {
        return new Response('Cargo package index', {status: 200});
    } else if (remainingPath == '/favicon.ico') {
        return new Response('Not found', { status: 404 })
    }
    if (config.blockList.has(PURLTYPE + '/' + pkgName) && config.blockList.get(PURLTYPE + '/' + pkgName) == "ALL") {
        return new Response('Package/version not found', {status: 404});
    }
    const upstream = await fetch(upstreamUrl + remainingPath, {cf: { cacheEverything: true, cacheTtl: 3600 }});
    if (upstream.status != 200)
        return upstream;

    let body = await upstream.text();

    if (config.blockList.has(PURLTYPE + '/' + pkgName) && config.blockList.get(PURLTYPE + '/' + pkgName) == 'ALL')
        return new Response('Not found', { status: 404 })
    if (config.blockList.has(PURLTYPE + '/' + pkgName))
        body = enforceBlocklist(body, config.blockList.get(PURLTYPE + '/' + pkgName) ?? []);
    if (config.MIN_AGE_DAYS > 0)
        body = enforceMinAge(body, config.MIN_AGE_DAYS, config.allowList.get(PURLTYPE + '/' + pkgName) || []);
    if (!config.ALLOW_YANKED)
        body = enforceYanked(body);

    return new Response(body, {headers: {'content-type': 'text/plain'}});
}

function parseCrateName(path : string): [string, string] {
    if (!path.endsWith('/download')) {
        console.log("Got incorrectly formatted fetch: " + path);
        return ['', ''];
    }
    const pieces = path.split('/');
    return [pieces[1], pieces[2]];
}

async function handleCargoFetch(remainingPath : string, user : string, config : ConfigProps, ctx : ExecutionContext): Promise<[Response, string, string]> {
    const upstreamUrl = "https://static.crates.io/crates";
    const [pkgName, pkgVersion] = parseCrateName(remainingPath);
    if (config.blockList.has(pkgName) && config.blockList.get(pkgName) == "ALL") {
			console.log(`Got a direct download request for ${pkgName}@${pkgVersion} -- returning 404`);
            fireWebhook(config.webhookUrl, `cargo:${pkgName}@${pkgVersion}`, "This package is on the organization's block list, please contact your admin if this package is needed.");
			return [new Response('Package/version not found', { status: 404 }), pkgName, pkgVersion];
    }
    if (config.blockList.has(pkgName) && (config.blockList.get(pkgName) ?? []).indexOf(pkgVersion) >= 0) {
        console.log(`Got a direct download request for ${pkgName}@${pkgVersion} -- returning 404`);
        fireWebhook(config.webhookUrl, `cargo:${pkgName}@${pkgVersion}`, "This package version is on the organization's block list, please contact your admin if this package is needed.");
        return [new Response('Package/version not found', { status: 404 }), pkgName, pkgVersion];
    }
    //console.log(`Got fetch request for ${parseCrateName(remainingPath)}`);
    const res = await fetch(upstreamUrl + remainingPath, {cf: { cacheEverything: true, cacheTtl: 3600 }});
    return [res, pkgName, pkgVersion];
}