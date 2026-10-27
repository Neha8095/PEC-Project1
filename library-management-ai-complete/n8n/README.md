# Local n8n setup and workflow status

Start n8n from the project root with `docker compose up -d n8n`, then open <http://localhost:5678>. The Compose setup persists n8n settings and encrypted credentials in the `library_n8n_data` volume. Keep `N8N_ENCRYPTION_KEY` stable.

## Create credentials in n8n

The Compose file starts the services but does not create n8n credentials or import workflows. After creating the n8n owner account, create these credentials in **Credentials**:

- **PostgreSQL**: host `postgres`, port `5432`, database/user/password from `.env`, SSL disabled. Select it on every PostgreSQL workflow node.
- **Header Auth**: header name `X-Library-Webhook-Secret`; use the value of `N8N_WEBHOOK_SECRET` from `.env`. Select it on webhook nodes that use header authentication.
- **SMTP**: use the host, port, security mode, username, and app password supplied by your email provider. For Gmail, use `smtp.gmail.com:587`, STARTTLS, your full Gmail address, and a Google app password. Select it on each reminder email node.

Credentials are encrypted in n8n's persistent volume. Credential IDs are local to one installation and are intentionally not embedded in workflow JSON. Never put API keys or email passwords in workflow files or commit them.

To call an authenticated webhook after deliberately activating it, send the configured header:

```powershell
$config = Get-Content .\.env -Raw | ConvertFrom-StringData
Invoke-RestMethod -Method Post `
  -Uri http://localhost:5678/webhook/library/search-books `
  -Headers @{ 'X-Library-Webhook-Secret' = $config.N8N_WEBHOOK_SECRET } `
  -ContentType 'application/json' `
  -Body (@{ query = 'Python' } | ConvertTo-Json)
```

Keep `.env` private. Do not share webhook secrets or commit them.

## PostgreSQL credential values

If setting up a new n8n instance, create a Postgres credential with:

- Host: `postgres`
- Port: `5432`
- Database, user, and password: the values in `.env`
- SSL: disabled

For an n8n Postgres node, use this credential rather than `localhost`; n8n runs in its own container.

## Import and configure workflows

Import the JSON templates from `workflows/` through the n8n editor. The templates are intentionally inactive. Attach the PostgreSQL and Header Auth credentials to their nodes as applicable. In the two reminder templates, replace the example sender address, select the SMTP credential, save, and send a controlled test before activating.

## Workflow status and limits

- `workflows/01-search-books.json`: authenticated search webhook; uses `$1` query parameters rather than inserting webhook input into SQL. The project template requires selecting the local `Library PostgreSQL` and `Library Webhook Header` credentials after import.
- `workflows/02-due-reminder.json`: sends one reminder two days before an active loan's due date.
- `workflows/03-overdue-check.json`: sends a daily overdue notice and calculates a fine estimate; it does not update application state or create a fine record.
- `workflows/04-ai-assistant.json`: authenticated placeholder response only. It does not call Gemini or retrieve live inventory.

The overdue workflow sends a daily message for every overdue active loan once activated; it does not create a fine record or prevent repeated daily notices. Keep the schedule workflows inactive until credentials and the sender address are set and a test email succeeds. The n8n AI workflow remains a placeholder; the actual student-facing assistant is implemented in the Express `/api/ai/chat` route and supports Gemini or OpenAI when `AI_PROVIDER`, and the corresponding API key, are configured in the project `.env`. The local database-backed assistant remains available with no provider key. Do not paste provider secrets into chat or commit them to the repository.
