export { getPackageDownloadCount };

async function getPackageDownloadCount(pkgName : string): Promise<number> {
	const res = await fetch(`https://api.npmjs.org/downloads/point/last-month/${decodeURI(pkgName)}`, {cf: {cacheTtlByStatus: { "200-299": 86400 * 7, 404: 86400 * 7, 429: 10, "500-599": 0 }}});
	if (res.status != 200) {
		return -1;
	}
	try {
		const stats = JSON.parse(await res.text());
		return stats.downloads;
	} catch (e) {
		console.log(e);
		return -1;
	}
}

// if (config.MIN_MONTHLY_DOWNLOADS > 0) {
// 		const dlCount = await getPackageDownloadCount(packageName);
// 		if (dlCount != -1 && dlCount < config.MIN_MONTHLY_DOWNLOADS) {
// 			console.log(`The monthly download count for ${packageName} is ${dlCount}, which is below the threshold of ${config.MIN_MONTHLY_DOWNLOADS}`);
// 			fireWebhook(ctx, config.webhookUrl, user, packageName, `The monthly download count for ${packageName} is ${dlCount}, which is below the threshold of ${config.MIN_MONTHLY_DOWNLOADS}`);
// 			return new Response("Insufficient download count for package.", { status: 404 });
// 		}
// 	}