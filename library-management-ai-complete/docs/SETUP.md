# Windows local setup

## Current implementation status

- **Present in the starter:** Express API, PostgreSQL schema and seed script, role-aware pages, book/loan endpoints, and four n8n workflow JSON templates.
- **Implemented and verified in this update:** authenticated librarian/admin CSV and `.xlsx` import, preview, stable catalogue IDs for books without ISBNs, quantity-safe re-import, import/audit summaries, templates, and focused parser/validation tests.
- **Verified locally:** Docker Compose startup, PostgreSQL schema and seed, Express health/API, CSV and Excel uploads, role denial, loan-safe inventory updates, n8n health, and persistence after a PostgreSQL restart. Four automated tests pass and `npm audit` reports zero vulnerabilities.
- **Still requires your credentials:** choose and configure either Gemini or OpenAI for the student assistant. n8n reminder workflows require a real SMTP credential and sender address to be saved in n8n before activation. The separate n8n AI workflow remains a placeholder.

## Requirements and version checks

Open PowerShell in `D:\PEC Project\library-management-ai-complete`:

```powershell
node --version
npm --version
git --version
docker --version
docker compose version
wsl --status
```

Start Docker Desktop if it is not already running:

```powershell
Start-Process "$Env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
docker info
```

Wait until `docker info` returns server details before continuing. Docker Desktop uses its configured WSL 2 backend; do not reset WSL or delete Docker volumes to troubleshoot a startup problem.

## Configure local secrets

Copy the template and replace all `replace_with_...` values in `.env` with unique local-only values. Use at least 32 random bytes for `JWT_SECRET`, `N8N_ENCRYPTION_KEY`, and `N8N_WEBHOOK_SECRET`. Set `POSTGRES_PASSWORD` to a strong password and use the same value in `DATABASE_URL`; URL-encode reserved characters in the URL password. Never commit `.env`.

Variables:

| Variable | Purpose |
|---|---|
| `PORT` | Express port (default 3000). |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | PostgreSQL database and local container credentials. |
| `POSTGRES_PORT` | Host port for local PostgreSQL (default 5432). |
| `DATABASE_URL` | Connection string used by Express and seed script. |
| `JWT_SECRET` | Signs authentication tokens. |
| `N8N_PORT`, `N8N_HOST` | Local n8n editor/webhook address. |
| `N8N_ENCRYPTION_KEY` | Encrypts n8n credentials in its persisted data volume. Keep it stable. |
| `GENERIC_TIMEZONE` | n8n schedule timezone; defaults to `Asia/Kolkata`. |
| `N8N_BASE_URL`, `N8N_WEBHOOK_SECRET` | n8n editor URL displayed in the admin workflow gallery and shared webhook secret for authenticated integrations. |
| `AI_PROVIDER` | `local` for the no-key database assistant (default), `ollama` for a local LLM, `gemini` for Google Gemini, or `openai` for OpenAI. |
| `OLLAMA_BASE_URL` | Ollama API URL; defaults to `http://127.0.0.1:11434`. |
| `OLLAMA_MODEL` | Locally installed Ollama model; defaults to `qwen2.5:1.5b`. |
| `GEMINI_API_KEY` | Optional Google Gemini API key if using the `gemini` provider. Keep it private and out of source control. |
| `GEMINI_MODEL` | Gemini model name; defaults to `gemini-2.5-flash`. |
| `OPENAI_API_KEY` | Optional OpenAI API key if using the `openai` provider. Keep it private and out of source control. |
| `OPENAI_MODEL` | OpenAI model name; defaults to `gpt-4o-mini`. |
| `LOAN_PERIOD_DAYS` | Intended configurable loan period; the existing issue route currently uses 14 days directly. |
| `MAX_UPLOAD_MB`, `MAX_IMPORT_ROWS` | Bulk-import file and row limits (10 MB and 10,000 by default). |

## Install and start

```powershell
npm install
docker compose up -d --wait
docker compose ps
npm test
npm run seed
npm run dev
```

The backend applies `database/schema.sql` at startup; the seed script also applies it before adding demo records. Open:

- Library app: <http://localhost:3000>
- n8n editor: <http://localhost:5678>

After signing in as an admin, open **n8n Workflows** from the admin dashboard to view the workflow map and open the configured n8n editor. The gallery documents the bundled search, due-reminder, overdue, and AI-placeholder workflows. The workflows remain inactive until configured and activated in n8n; set up and verify SMTP before enabling reminder emails.

### Run from VS Code

Open the project folder in VS Code, then select **Run Library Management App** in Run and Debug and press **F5**. This starts the PostgreSQL container, launches the Express server with `.env`, and opens the app at <http://localhost:3000>. Run `npm run seed` once from the project terminal if you need the demo accounts and sample catalogue.

Do not open `frontend/login.html` directly as a `file://` page. The frontend uses root-relative CSS, JavaScript, and API URLs and must be served by Express.

### Enable the LibraryAI agent

The student assistant defaults to a no-key, database-backed local agent for book search, the signed-in student's loans, and that student's unpaid fines. It does not allow arbitrary SQL or perform library actions. This local mode uses intent recognition and direct database tools rather than a generative LLM; no question or result is sent to an external provider. Optional LLM modes are described below.

#### No-key local agent (default)

No API key or model installation is needed. Keep `AI_PROVIDER=local` (or leave it unset), start PostgreSQL and the app, sign in as a student, then open **AI** from the student dashboard.

#### Optional local LLM with Ollama

1. Install Ollama for Windows from <https://ollama.com/download>.
2. In PowerShell, download a small model:

   ```powershell
   ollama pull qwen2.5:1.5b
   ```

3. Set `AI_PROVIDER=ollama`, `OLLAMA_BASE_URL=http://127.0.0.1:11434`, and `OLLAMA_MODEL=qwen2.5:1.5b` in local `.env`.
4. Restart Express, sign in as a student, and open **AI** from the student dashboard.

#### Google Gemini

Set `AI_PROVIDER=gemini` and `GEMINI_API_KEY` in local `.env`, then restart Express. Never commit or paste the API key into chat. Gemini quota and billing depend on your Google account settings.

#### OpenAI

Set `AI_PROVIDER=openai` and `OPENAI_API_KEY` in local `.env`, then restart Express. `OPENAI_MODEL` defaults to `gpt-4o-mini`. The API key is used only by the Express student assistant; n8n credentials are configured separately in the n8n editor. Never commit or paste the API key into chat.

The first n8n visit prompts you to create its owner account. n8n persists its own settings and credentials in the `library_n8n_data` volume (SQLite); PostgreSQL is the separate library application database. For an n8n PostgreSQL credential, use host `postgres`, port `5432`, and the database/user/password from `.env`, because `localhost` inside the n8n container is not the host or database container.

### Configure n8n database and email credentials

1. Open n8n at <http://localhost:5678> and create the owner account.
2. In **Credentials**, create a PostgreSQL credential using host `postgres`, port `5432`, and `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD` from `.env`. Assign it to each PostgreSQL node in the imported workflows.
3. Create an SMTP credential using the settings from your email provider. For Gmail, use `smtp.gmail.com`, port `587`, STARTTLS, your full Gmail address, and a Google app password (not your regular account password). Do not put SMTP passwords in workflow JSON or source control.
4. Import the JSON templates from `n8n/workflows/` if they are not already present. In both reminder workflows, replace the example sender address with your verified sending address, choose the SMTP credential on the **Send Reminder** / **Send Overdue Reminder** node, save, and send a controlled test.
5. Keep scheduled workflows inactive until the PostgreSQL and SMTP credentials are saved and the test succeeds. Then activate only the reminders you intend to send. The overdue workflow sends a message daily for every active overdue loan.

The Compose file starts n8n and the library PostgreSQL service, but it cannot create provider API keys, an n8n owner, or a mail-provider app password. Those values must be supplied by you in the local `.env` or encrypted n8n credential store. n8n stores its own workflow data in its persistent volume; it connects to the library PostgreSQL database for workflow queries.

## Bulk book import

Sign in as a librarian or admin, then open **Manage Books → Bulk import**. Download either template, fill the required `title`, `author`, and `total_quantity` columns, choose CSV or `.xlsx`, preview, inspect rejected rows, and confirm import.

- ISBN is optional, but a valid ISBN-10 or ISBN-13 (with a valid check digit) is required when supplied.
- If ISBN is blank, `catalogue_id` is required. Assign a stable unique code such as `LIB-LOCAL-001` and reuse it on later imports.
- One row represents one title/catalogue record; `total_quantity` is the combined count of copies. Individual copy barcodes are not modeled in this project.
- Matching ISBN or catalogue ID updates the existing book instead of creating a duplicate. Blank optional values leave existing metadata unchanged.
- A re-import sets the new total quantity but preserves checked-out copies; a requested total below the number currently on loan is rejected.
- File rows are validated before import. Database writes are processed in batches of 200 in one transaction, so an unexpected database failure rolls back the entire import.
- The API response lists validation errors and duplicate rows with spreadsheet row numbers. Preview displays the first 100 data rows and validates all rows.

Template download endpoints:

- `GET /api/books/import/template.csv`
- `GET /api/books/import/template.xlsx`

Import endpoints (librarian/admin JWT required; multipart field name `file`):

- `POST /api/books/import/preview`
- `POST /api/books/import`

## Database maintenance

Check API/database connectivity:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
$config = Get-Content .\.env -Raw | ConvertFrom-StringData
docker compose exec postgres pg_isready -U $config.POSTGRES_USER -d $config.POSTGRES_DB
```

Apply schema changes manually if needed:

```powershell
$config = Get-Content .\.env -Raw | ConvertFrom-StringData
Get-Content .\database\schema.sql -Raw | docker compose exec -T postgres psql -U $config.POSTGRES_USER -d $config.POSTGRES_DB
```

The compose file stores data in named volumes. `docker compose stop`, `docker compose down`, and container restarts preserve PostgreSQL and n8n data. Avoid `docker compose down -v` unless you explicitly intend to delete both volumes.

Create a database backup:

```powershell
$config = Get-Content .\.env -Raw | ConvertFrom-StringData
cmd /c "docker compose exec -T postgres pg_dump -U $($config.POSTGRES_USER) -d $($config.POSTGRES_DB) > library-backup.sql"
```

Keep backups out of Git if they contain real student or library data. Restore only into a deliberate target database:

```powershell
$config = Get-Content .\.env -Raw | ConvertFrom-StringData
docker cp .\library-backup.sql library-postgres:/tmp/library-backup.sql
docker compose exec postgres psql -U $config.POSTGRES_USER -d $config.POSTGRES_DB -f /tmp/library-backup.sql
```

## Logs and stopping

```powershell
docker compose logs --follow postgres n8n
docker compose stop
```

Stop the Express process with `Ctrl+C` in its terminal. `docker compose down` removes containers but keeps named volumes; it does not erase database or n8n data.

## Demo accounts

After `npm run seed`:

- Student: `student1@library.com` / `Student@123`
- Librarian: `librarian@library.com` / `Librarian@123`
- Admin: `admin@library.com` / `Admin@123`

These are demo credentials only. Do not use them in a deployed system.
