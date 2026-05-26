## Package Proxy

This is a Cloudflare Worker that is set as either `uv/pip`'s `index-url`, `cargo`'s `registry` or `npm`'s `registry` and seamlessly proxies requests to the official repositories. For more information please check out the [blog post](#).

### Installation
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fthinkst%2Fpackage-proxy)

#### Client configuration

There's a handy setup script for MacOS in `./scripts/SetupPackageProxy.sh`, simply edit `PACKAGE_PROXY_HOST` with your [sub]-domain of the Cloudflare worker and distribute across your fleet.

Alternatively, here are the manual steps:

1. Set the variable `DOMAIN` to the [sub-]domain where the Worker is running
2. **pip**: `pip config set global.index-url https://$USER@$DOMAIN$/pypi/`
3. **uv**: `echo "index-url = \"https://$USER@$DOMAIN/pypi/\"" >> ~/.config/uv/uv.toml`
4. **cargo**: `echo -e "[registries]\npackage-proxy = { index = \"sparse+https://$USER@$DOMAIN/\" }\n[source.crates-io]\nreplace-with = \"package-proxy\"" >> ~/.cargo/config.toml`
5. **npm**: `npm config set registry https://$DOMAIN && npm config set //$DOMAIN/:_auth=$(echo -n "$USER:" | base64)`

### Usage

Use the package manager as normal, though if a package version has been removed, the client will simply report it is not found (HTTP 404) and not the specific error/reason for its removal.

### Configurable Rules
The proxy is defaultly configured to prevent the installation of packages that meet the following criteria:
- Releases newer than 10 days ago (`MIN_AGE_DAYS`)
- Version is not "yanked" (`ALLOW_YANKED`)
- Version is not published in a less-robust manner than the previous release (`ALLOW_CHANGED_PUBLISHER`)
- Specific known-bad releases such as `axios==0.30.4`, or `base-x-64: ALL` (`blocklist`)

These values can be changed in the KV store created upon deployment. The remaining configuration options are:
- If `npm audit` can bypass the minimum age (`ALLOW_AUDIT_OVERRIDE`)
- If the downloads themselves should be served via the proxy, which is when the logging occurs (`REWRITE_DOWNLOAD_URLS`)
- An allow-list of specific versions (`allowlist`)

It is possible to define a webhook URL (`webhook-url`) where some of the details of blocked downloads will be sent. This can be useful in e.g., an environment with Slack to provide context for why a package isn't installable.

These configurations can be specified to logical units in your organization. If an organization is provided (the subdomain) then the 
proxy will look in the KV store for `org-<ORGNAME>` (example, acme.packageproxy.dev would be configured in `org-acme`). Otherwise, the 
`default` key configuration is used. If there is no configuration present, a default one will be created that contains the value in 
`./scripts/default-kv.json`. This file can be edited and pushed to the KV store using the `npx wrangler kv` command, or via the 
[web dashboard](https://dash.cloudflare.com).

## Observability
Once the proxy has been used to install packages, it will log the user and organization into the created D1 database. These can be queried or explored via the [Cloudflare Dashboard](https://dash.cloudflare.com), `wrangler` CLI, or [API](https://developers.cloudflare.com/api/resources/d1).

Some example queries include:
- Return all the users that have installed a package (and each version): `SELECT DISTINCT UserId, CONCAT(PackageName, '@', PackageVersion) as Installed FROM Installs WHERE PackageName LIKE ?;` 
- Fetch the total number of installed packages: `SELECT COUNT(*) FROM Installs;`
- Fetch all installed package names: `SELECT DISTINCT PackageName FROM Installs;`
