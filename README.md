## Package Proxy

This is a Cloudflare Worker that is set as either `uv/pip`'s `index-url`, `cargo`'s `registry` or `npm`'s `registry` and seamlessly proxies requests to the official repositories. For more information please check out the [blog post](#).

### Installation
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fthinkst%2Fpackage-proxy)

#### Client configuration
With the variable `DOMAIN` set to the [sub-]domain where the Worker is running,
please use the following commands to configure your package manager client:

`pip`: `pip config set global.index-url https://$USER@$DOMAIN$/pypi/`

`uv`: `echo "index-url = \"https://$USER@$DOMAIN/pypi/\"" >> ~/.config/uv/uv.toml`

`cargo`: `echo -e "[registries]\npackage-proxy = { index = \"sparse+https://$USER@$DOMAIN/\" }\n[source.crates-io]\nreplace-with = \"package-proxy\"" >> ~/.cargo/config.toml`

`npm`: `npm config set registry https://$DOMAIN && npm config set //$DOMAIN/:_auth=$(echo -n "$USER:" | base64)`

### Usage

Use the package manager as normal, though if a package version has been removed, the client will simply report it is not found (HTTP 404) and not the specific error/reason for its removal.

### Configurable Rules
The proxy is currently configured to prevent the installation of packages that meet the following criteria:
- Releases newer than 10 days ago
- Version is not "yanked"
- Version is not published in a less-robust manner than the previous release
- Specific known-bad releases such as `axios==0.30.4`

It is possible to define a webhook URL where some of the details of blocked downloads will be sent. This can be useful in e.g., an environment with Slack to provide context for why a package isn't installable.