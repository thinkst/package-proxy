/* Timeout for an audit in ms */
const AUDIT_TIMEOUT = 3 * 1000;

import { DurableObject } from "cloudflare:workers";

/**
 * This Durable Object tracks NPM requests to allow for the min age requirement to be overridden specifically for npm audit
 *
 * In audit flows, the POST to the advisories batch API endpoint occurs first, followed by metadata (and files in the case of audit fix)
 * for any/all reported vulnerable packages. When there is a POST request to this endpoint, the request handler creates a Durable
 * Object using the IP and userId of the request, and then any GETs to NPM will skip the minimum age enforcement until the AUDIT_TIMEOUT
 * elapses. Each GET within that timeout resets the timeout. An example flow is:
 * - POST for audit checking
 * - GET package1 and see what is vulnerable
 * - GET package2 which is related to package1 to ensure it would still operate if package1 were updated
 * - ...
 * - GET package1.tar.gz
 * - ...
 *
 * As the dependency processes can take some time, we want to allow each request to "push back" the expiration of the override. Then after
 * AUDIT_TIMEOUT, the proxy reverts to the normal operation. ALLOW_AUDIT_OVERRIDE can be set to false and disable this override behavior.
 */
export class AuditTrackerObject extends DurableObject<Env> {

	async regAudit() {
		//console.log("Registering audit!");
		await this.ctx.storage.put("recent-audit", true);
		await this.ctx.storage.setAlarm(Date.now() + AUDIT_TIMEOUT + 1000);
	}

	async recentAudit(): Promise<boolean> {
		const ra = await this.ctx.storage.get<boolean>("recent-audit") || false;
		if (ra)
			await this.ctx.storage.setAlarm(Date.now() + AUDIT_TIMEOUT + 1000);
		return ra;
	}

	async alarm(): Promise<void> {
		await this.ctx.storage.deleteAll();
	}

}