/**
 * This is a Worker to act as a transparent proxy for npmjs's and pypi's package repositories
 *
 * (C) 2026 Thinkst Applied Research, PTY
 * Author: jacob@thinkst.com
 */

import { AuditTrackerObject } from "./auditworker";
import { handleNpmMetadata, handleNpmAudit, handleNpmFetch } from "./npm";
import { handlePypiMetadata, handlePypiFetch } from "./pypi";
import { handleCargoMetadata, handleCargoFetch } from "./cargo";

export { AuditTrackerObject, ConfigProps, RequestParams, Params, fireWebhook, checkJson, saveKv };

export interface Env {
    AUDIT_TRACKER: DurableObjectNamespace<AuditTrackerObject>;
	PACKAGE_PROXY_CONFIG: KVNamespace;
	install_logs: D1Database;
	ASSETS: Fetcher;
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		Params.ctx = ctx;
		Params.env = env;
		Params.url = new URL(request.url);
		return handleRequest(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;

enum RequestType {
	PypiMetadata,
	PypiFiles,
	CargoMetadata,
	CargoFiles,
	NpmMetadata,
	NpmFiles,
	NpmAudit,
	NpmSearch,
	ApprovePackage,
	Unknown,
	Spam,
	BrowseRoot
};

class ConfigProps {
	MIN_AGE_DAYS : number = 10;
	ALLOW_YANKED = false;
	ALLOW_CHANGED_PUBLISHER = false;
	ALLOW_AUDIT_OVERRIDE = true;
	REWRITE_DOWNLOAD_URLS = true;
	webhookUrl = "";
	approvalWebhookUrl = "";
	blockList = new Map<string, string[] | string>();
	allowList = new Map<string, string[]>();
	bearerToken = "";
};

class RequestParams {
	config : ConfigProps = new ConfigProps();
	orgId : string = '';
	userId : string = '';
	env : Env | null = null;
	ctx : ExecutionContext | null = null;
	url : URL | null = null;
};

const REQUIRE_TOKEN_AUTH = true;
const Params = new RequestParams();

function checkJson(body : string): boolean {
	try {
		const j = JSON.parse(body);
		return true;
	} catch (error) {
		return false;
	}
}

async function initKv() {
	let defConfig;
	if (Params.orgId != null && Params.orgId != "") {
		const oConfig = await Params.env?.PACKAGE_PROXY_CONFIG.get("org-" + Params.orgId);
		if (oConfig != null && oConfig != "" && oConfig != "{}") {
			const conf = JSON.parse(oConfig);
			if (!isNaN(Number(conf['MIN_AGE_DAYS'])))
				Params.config.MIN_AGE_DAYS = conf['MIN_AGE_DAYS'];
			Params.config.ALLOW_YANKED = conf['ALLOW_YANKED'] ?? Params.config.ALLOW_YANKED;
			Params.config.ALLOW_CHANGED_PUBLISHER = conf['ALLOW_CHANGED_PUBLISHER'] ?? Params.config.ALLOW_CHANGED_PUBLISHER;
			Params.config.ALLOW_AUDIT_OVERRIDE = conf['ALLOW_AUDIT_OVERRIDE'] ?? Params.config.ALLOW_AUDIT_OVERRIDE;
			Params.config.webhookUrl = conf['webhook-url'] ?? Params.config.webhookUrl;
			Params.config.REWRITE_DOWNLOAD_URLS = conf['REWRITE_DOWNLOAD_URLS'] ?? Params.config.REWRITE_DOWNLOAD_URLS;
			Params.config.approvalWebhookUrl = conf['approval-webhook-url'] ?? Params.config.approvalWebhookUrl;
			try {
				Object.keys(conf.blocklist).forEach(e => Params.config.blockList.set(e, conf.blocklist[e]));
				Object.keys(conf.allowlist).forEach(e => Params.config.allowList.set(e, conf.allowlist[e]));
			} catch (e) {
				console.log(`Error parsing allow/block-lists: ${e}`);
			}
			return;
		} else {
			console.log(`No KV configuration for ${"org-" + Params.orgId}... Creating one.`);
			defConfig = await Params.env?.PACKAGE_PROXY_CONFIG.get("default");
			if (defConfig != null) {
				await Params.env?.PACKAGE_PROXY_CONFIG.put("org-" + Params.orgId, defConfig);
			} else {
				await Params.env?.PACKAGE_PROXY_CONFIG.put("org-" + Params.orgId, JSON.stringify({
					MIN_AGE_DAYS: Params.config.MIN_AGE_DAYS,
					ALLOW_CHANGED_PUBLISHER: Params.config.ALLOW_CHANGED_PUBLISHER,
					ALLOW_YANKED: Params.config.ALLOW_YANKED,
					ALLOW_AUDIT_OVERRIDE: Params.config.ALLOW_AUDIT_OVERRIDE,
					REWRITE_DOWNLOAD_URLS: Params.config.REWRITE_DOWNLOAD_URLS,
					"webhook-url": "",
					"approval-webhook-url": "",
					blocklist: {},
					allowlist: {}
				}));
			}
		}
	}
	defConfig = await Params.env?.PACKAGE_PROXY_CONFIG.get("default");
	if (defConfig == null) {
		console.log('No default configuration in KV... Creating one.');
		await Params.env?.PACKAGE_PROXY_CONFIG.put("default", JSON.stringify({
			MIN_AGE_DAYS: Params.config.MIN_AGE_DAYS,
			ALLOW_CHANGED_PUBLISHER: Params.config.ALLOW_CHANGED_PUBLISHER,
			ALLOW_YANKED: Params.config.ALLOW_YANKED,
			ALLOW_AUDIT_OVERRIDE: Params.config.ALLOW_AUDIT_OVERRIDE,
			REWRITE_DOWNLOAD_URLS: Params.config.REWRITE_DOWNLOAD_URLS,
			"webhook-url": "",
			"approval-webhook-url": "",
			blocklist: {},
			allowlist: {}
		}));
		return;
	}
	const conf = JSON.parse(defConfig);
	if (!isNaN(Number(conf['MIN_AGE_DAYS'])))
		Params.config.MIN_AGE_DAYS = conf['MIN_AGE_DAYS'];
	Params.config.ALLOW_YANKED = conf['ALLOW_YANKED'] ?? Params.config.ALLOW_YANKED;
	Params.config.ALLOW_CHANGED_PUBLISHER = conf['ALLOW_CHANGED_PUBLISHER'] ?? Params.config.ALLOW_CHANGED_PUBLISHER;
	Params.config.ALLOW_AUDIT_OVERRIDE = conf['ALLOW_AUDIT_OVERRIDE'] ?? Params.config.ALLOW_AUDIT_OVERRIDE;
	Params.config.webhookUrl = conf['webhook-url'] ?? Params.config.webhookUrl;
	Params.config.REWRITE_DOWNLOAD_URLS = conf['REWRITE_DOWNLOAD_URLS'] ?? Params.config.REWRITE_DOWNLOAD_URLS;
	Params.config.approvalWebhookUrl = conf['approval-webhook-url'] ?? Params.config.approvalWebhookUrl;
	try {
		Object.keys(conf.blocklist).forEach(e => Params.config.blockList.set(e, conf.blocklist[e]));
		Object.keys(conf.allowlist).forEach(e => Params.config.allowList.set(e, conf.allowlist[e]));
	} catch (e) {
		console.log(`Error parsing allow/block-lists: ${e}`);
	}
}

async function saveKv() {
	if (Params.orgId == "")
		return;
	let bl : { [key : string] : string[] | string } = {};
	Params.config.blockList.forEach((v, k) => bl[k] = v);

	let al : { [key : string] : string[] } = {};
	Params.config.allowList.forEach((v, k) => al[k] = v);
	await Params.env?.PACKAGE_PROXY_CONFIG.put("org-" + Params.orgId, JSON.stringify({
			MIN_AGE_DAYS: Params.config.MIN_AGE_DAYS,
			ALLOW_CHANGED_PUBLISHER: Params.config.ALLOW_CHANGED_PUBLISHER,
			ALLOW_YANKED: Params.config.ALLOW_YANKED,
			ALLOW_AUDIT_OVERRIDE: Params.config.ALLOW_AUDIT_OVERRIDE,
			REWRITE_DOWNLOAD_URLS: Params.config.REWRITE_DOWNLOAD_URLS,
			"webhook-url": Params.config.webhookUrl,
			"approval-webhook-url": Params.config.approvalWebhookUrl,
			blocklist: bl,
			allowlist: al
		}))
}

async function fireWebhook(url : string, packageStr : string, reason : string) {
	if (url == '')
		return;
	const details = {
		user: Params.userId,
		package: packageStr,
		reason: reason
	};
	Params.ctx?.waitUntil(fetch(url, {method: "POST", headers: {'content-type': 'application/json'}, body: JSON.stringify(details)}));
}

async function logInstall(type : string, ip : string, pName : string, pVer : string) {
	//console.log(`Attempting to log: ${pName} for ${orgId}/${userId}`);
	if (Params.orgId == "" || Params.userId == "" || pName == "")
		return;
	Params.ctx?.waitUntil(Params.env?.install_logs.prepare("INSERT INTO Installs (OrgId, UserId, IpAddress, PackageName, PackageVersion) VALUES (?, ?, ?, ?, ?)")
				.bind(Params.orgId, Params.userId, ip, type + ':' + pName, pVer)
				.run() ?? Promise.resolve());
}

function parseOrgUser(path : string): string[] {
	let splitPath = path.split('/');
	if (splitPath[0] == '')
		splitPath = splitPath.slice(1);
	let org = '', user = '';
	let prefix = '';
	if (splitPath.length < 2) {
		Params.orgId = org;
		Params.userId = user;
		return [path, prefix];
	}
	if (path.startsWith('/o-')) {
		org = splitPath[0].replace('o-', '');
		prefix = '/' + splitPath[0];
		splitPath = splitPath.slice(1);
		if (splitPath[0].startsWith('u-')) {
			user = splitPath[0].replace('u-', '');
			prefix += '/' + splitPath[0];
			splitPath = splitPath.slice(1);
		}
	}
	//console.log(`Parsing path: ${path} into: ${org} ${user} ${'/' + splitPath.join('/')} ${prefix}`);
	Params.orgId = org;
	Params.userId = user;
	return ['/' + splitPath.join('/'), prefix];
}

function determineReqType(origin : string, remainingPath : string, request : Request): [RequestType, string] {
	//console.log(origin + remainingPath);
	// if (request.method == "GET" && remainingPath.startsWith('/.approvals/'))
	// 	return [RequestType.ApprovePackage, remainingPath.replace('/.approvals/', '')];
	if (request.method == "POST" && remainingPath.includes("/npm/v1/security/advisories/bulk")) {
		return [RequestType.NpmAudit, remainingPath];
	}
	if (remainingPath.endsWith('.php') || remainingPath.endsWith('.xml')) {
		return [RequestType.Spam, ''];
	}
	if (origin.split('.').length == 4) {
		switch (origin.split('.')[0].replace('http://', '').replace('https://', '')) {
			case "pypi":
				if (remainingPath.startsWith('/files/'))
					return [RequestType.PypiFiles, remainingPath.replace('/files', '')];
				else
					return [RequestType.PypiMetadata, remainingPath.replace('/pypi', '')];
			case "cargo":
				if (remainingPath.startsWith('/cargofiles/'))
					return [RequestType.CargoFiles, remainingPath.replace('/cargofiles', '')];
				else
					return [RequestType.CargoMetadata, remainingPath.replace('/cargo-rs', '')];
			case "npm":
				if (remainingPath.startsWith('/npmfiles/'))
					return [RequestType.NpmFiles, remainingPath.replace('/npmfiles', '')];
				else
					return [RequestType.NpmMetadata, remainingPath];
			default:
				break;
		}
	}
	// Need to parse out the type based on the request path
	if (remainingPath.startsWith('/cargo-rs/'))
		return [RequestType.CargoMetadata, remainingPath.replace('/cargo-rs', '')];
	if (remainingPath.startsWith('/cargofiles/'))
		return [RequestType.CargoFiles, remainingPath.replace('/cargofiles', '')];
	if (remainingPath.startsWith('/pypi/') && request.headers.get('user-agent')?.startsWith("npm/")) {
		// This is likely a misconfigured NPM client
		// Since we check for the trailing '/' we can be sure it's not NPM requesting the pypi package
		//console.log("Removing /pypi from an NPM client.");
		return [RequestType.NpmMetadata, remainingPath.replace('/pypi', '')];
	}
	if (remainingPath.startsWith('/pypi/')) {
		if (remainingPath.startsWith('/pypi/packages/') && remainingPath != '/pypi/packages/' && remainingPath != '/pypi/packages/json')
			return [RequestType.PypiFiles, remainingPath.replace('/pypi', '')]
		return [RequestType.PypiMetadata, remainingPath.replace('/pypi', '')];
	}
	if (remainingPath.startsWith('/files/'))
		return [RequestType.PypiFiles, remainingPath.replace('/files', '')];
	if (remainingPath.startsWith('/npmfiles/'))
		return [RequestType.NpmFiles, remainingPath.replace('/npmfiles', '')];
	if (remainingPath == '/-/v1/search')
		return [RequestType.NpmSearch, remainingPath];
	if (/\/\-\/.*\.tgz$/.test(remainingPath)) // Special case where loading files from a package-lock.json file
		return [RequestType.NpmFiles, remainingPath];
	if (request.method == "GET" && remainingPath == '/')
		return [RequestType.BrowseRoot, remainingPath];
	if (request.method == "GET")
		return [RequestType.NpmMetadata, remainingPath];

	return [RequestType.Unknown, remainingPath];
}

async function handleRequest(request : Request, env : Env, ctx : ExecutionContext) {
	const url = Params.url ?? new URL(request.url);
	const cache = caches.default;
	const ip = request.headers.get('cf-connecting-ip') || "";
	//console.log(url.pathname);
	let [remainingPath, filePrefix] = parseOrgUser(url.pathname);
	let reqType = RequestType.Unknown;
	if (Params.orgId == '' && url.origin.split('.').length == 3) {
		Params.orgId = url.origin.split('.')[0].replace('http://', '').replace('https://', '');
		[reqType, remainingPath] = determineReqType(url.origin, remainingPath, request);
	} else if (Params.orgId == '' && url.origin.split('.').length == 4) {
		Params.orgId = url.origin.split('.')[1].replace('http://', '').replace('https://', '');
		[reqType, remainingPath] = determineReqType(url.origin, remainingPath, request);
	} else {
		[reqType, remainingPath] = determineReqType(url.origin, remainingPath, request);
	}
	await initKv();
	const authorization = request.headers.get("Authorization");
	if (authorization) {
		const [_, encoded] = authorization.split(" ");
		const credentials = Buffer.from(encoded, "base64").toString().split(":");
		if (Params.userId == '' && credentials[0] != '')
			Params.userId = credentials[0];
		if (credentials.length >= 2 && credentials[1] != "")
			Params.config.bearerToken = credentials[1];
		//console.log(credentials);
	}
	// If we're running from an org-specific subdomain, then we want usernames via HTTP auth
	if (REQUIRE_TOKEN_AUTH && url.origin.split('.').length >= 3) {
		if (!authorization && reqType != RequestType.CargoFiles && reqType != RequestType.ApprovePackage && reqType != RequestType.NpmFiles && reqType != RequestType.PypiFiles) {
			return new Response("You need to login.", {
			status: 401,
			headers: {
				// Prompts the user for credentials.
				"WWW-Authenticate": 'Basic realm="pkgproxy", charset="UTF-8"',
			},
			});
		}
	}

	let res : Response;
	let pName : string;
	let pVer : string;

	switch (reqType) {
		// Handle approval of new package
		// case RequestType.ApprovePackage:
		// 	return approvePackage(remainingPath);
		// Handle Cargo API
		case RequestType.CargoMetadata:
			return handleCargoMetadata(url.origin, remainingPath, filePrefix, Params.orgId, Params.userId, Params.config);

		// Handle Cargo file fetch
		case RequestType.CargoFiles:
			[res, pName, pVer] = await handleCargoFetch(remainingPath, Params.userId, Params.config, ctx);
			if (res.status == 200) {
				//console.log(`Logging install of cargo:${pName} by ${orgId}/${userId}`);
				await logInstall('cargo', ip, pName, pVer);
			}
			return res;

		// Handle requests to the PyPI simple index
		case RequestType.PypiMetadata:
			const pypiMetadataResp = await cache.match(request);
			if (pypiMetadataResp != undefined)
				return pypiMetadataResp;
			res = await handlePypiMetadata(remainingPath, filePrefix);
			ctx.waitUntil(cache.put(request, res.clone()));
			return res;

		// Handle requests to files.pythonhosted.org
		case RequestType.PypiFiles:
			[res, pName, pVer] = await handlePypiFetch(remainingPath);
			if (res.status == 404) {
				return new Response('Package/version not found', { status: 404 });
			} 
			if (!remainingPath.endsWith(".metadata")) {
				//console.log(`Got request to download and install: ${pName}==${pVer} from ${ip}`);
				await logInstall("pypi", ip, pName, pVer);
			}
			const cached_resp = await cache.match(request);
			if (cached_resp != undefined) {
				return cached_resp;
			}
			ctx.waitUntil(cache.put(request, res.clone()));
			return res;

		// Handle requests to fetch npm files
		case RequestType.NpmFiles:
			//console.log(url.pathname);
			var filePath = remainingPath.replace('/npmfiles', '');
			[res, pName, pVer] = await handleNpmFetch(filePath);
			if (res.status == 200 && filePath.endsWith(".tgz") && url.origin != "http://example.com") {
				//console.log(`Got request to download and install: ${parseNpmPackage(filePath)} from ${ip}`);
				await logInstall("npm", ip, pName, pVer);
			}
			return res;

		// NPM search
		case RequestType.NpmSearch:
			return fetch("https://registry.npmjs.org/-/v1/search" + url.search, {headers: {accept: "application/json"}});

		// NPM metadata/registry lookup
		case RequestType.NpmMetadata:
			let stub = env.AUDIT_TRACKER.getByName(`${Params.userId}-${ip}`);
			let audit = false;
			if (Params.config.ALLOW_AUDIT_OVERRIDE)
				audit = await stub.recentAudit();
			return handleNpmMetadata(remainingPath, filePrefix, audit);

		// Advisories (npm audit) lookup
		case RequestType.NpmAudit:
			if (Params.config.ALLOW_AUDIT_OVERRIDE) {
				let stub = env.AUDIT_TRACKER.getByName(`${Params.userId}-${ip}`);
				await stub.regAudit();
			}
			return handleNpmAudit(request);

		case RequestType.BrowseRoot:
			return env.ASSETS.fetch(request);

		// Spam/noisy requests that need 404s
		case RequestType.Spam:
			return new Response('Not found', { status: 404 });

		// Invalid method
		default:
			return new Response('Invalid method', { status: 405 });
	}
}