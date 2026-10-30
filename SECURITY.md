# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems.

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Include the affected version or commit, steps to reproduce, and the impact you expect.

You get a first response as soon as the maintainer can look at it. This is a spare-time project without a guaranteed response time.

## Supported versions

Only the latest release on the `main` branch receives fixes.

## Scope

In scope:

- `sync.mjs`, including handling of credentials and API tokens
- The generated browser script
- The Dockerfile

Out of scope:

- Vulnerabilities in Umami, Cloudflare or `web-vitals` themselves. Report those to the respective project.
- Your own server, CDN or Umami configuration.
