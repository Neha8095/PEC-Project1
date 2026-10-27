# AI-Powered Library Management and Automation System

This repository is the starter implementation for the college project. It contains a Node.js/Express API, PostgreSQL schema and seed script, role-aware frontend pages, library/loan endpoints, Docker Compose, and n8n workflow templates. File presence is not proof that a feature has been configured or verified.

The bulk catalogue import is implemented for CSV and `.xlsx`, with server-side validation, a pre-import preview, and transactional re-import that preserves active loans. See [docs/SETUP.md](docs/SETUP.md).

## Verified project status

- **Existing code:** registration/login, JWT role checks, book/loan routes, seed data, and frontend pages.
- **Implemented and tested here:** librarian/admin CSV and `.xlsx` import, downloadable templates, internal catalogue IDs, import/audit summaries, loan-safe re-import, and role authorization.
- **Verified locally:** Docker Compose configuration, PostgreSQL schema/seed, Express health/API, import UI and API, and n8n health endpoint. Four automated tests pass; `npm audit` reports zero vulnerabilities.
- **AI assistant:** student chat has a no-key, local database-backed mode by default for catalogue search and the signed-in student's own loans/fines. This mode uses intent matching and read-only database lookups, not a generative LLM, and sends no data to an external provider. Optional Ollama, Gemini, and OpenAI integrations are also supported; configure `AI_PROVIDER` and the selected provider settings in local `.env`. The separate n8n AI workflow remains a placeholder.
- **Other incomplete integrations:** due/overdue n8n workflows require a configured SMTP app password before email delivery can be tested or activated.

## Run on Windows / VS Code

Follow [docs/SETUP.md](docs/SETUP.md) for Windows PowerShell commands, local secret setup, Docker startup, tests, and database maintenance.

The app is served at <http://localhost:3000>; n8n is at <http://localhost:5678>.

Do not commit `.env`, database backups, real student data, or active API credentials.
