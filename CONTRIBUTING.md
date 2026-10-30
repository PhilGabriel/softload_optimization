# Contributing

Thanks for helping. Issues and pull requests are welcome in English or German.

## Before you start

- **Bugs:** open an issue with your Umami version (Cloud or self-hosted), Node.js or Docker version, the exact error output, and the browser and version if it concerns the generated script.
- **Features:** open an issue first. The project stays small on purpose: one job, one generated file, no runtime dependencies besides `web-vitals`. Features that need a server component, a database or a dashboard probably belong in a separate project.

## Development

```bash
npm ci
```

```bash
npm test
```

- Node.js 22, ES modules, no build step.
- Every behavior change comes with a test in `sync.test.mjs`. The tests must run without network access.
- Code that runs in the browser lives in `clientScript()` and must work without transpiling in current browsers.
- Keep the README in both languages (`README.md`, `README.de.md`) in sync when you change behavior or configuration.
- Add a line to `CHANGELOG.md` under "Unreleased".

## Pull requests

- One topic per pull request.
- Describe what changed and how you tested it.
- Do not commit secrets, `.env` files or generated output (`out/`).

## License of contributions

This repository is the open core of the project and is licensed under MIT. By submitting a pull request you agree that your contribution is licensed under the same MIT license.
