# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- MIT license, third-party notices, contributing guide, security policy, `.env.example`.
- English README; the German README moved to `README.de.md`.
- License notice for the bundled `web-vitals` in the first line of the generated file.

### Fixed

- CLS and INP were sent again on every tab hide, creating duplicate events. The script now sends each metric once.

## 0.1.0 - 2026-10-30

### Added

- `sync.mjs`: reads the top paths of the last 30 days from the Umami API and writes `soft-nav-vitals.js`.
- Browser script: LCP, CLS and INP per soft navigation, FCP and TTFB for page loads, reported as Umami event `web-vital`.
- Authentication with Umami API key or self-hosted login.
- Optional Cloudflare cache purge after each run.
- Dockerfile for one-shot runs from cron.
