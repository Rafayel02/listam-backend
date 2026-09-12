# listam-backend

Express API + PostgreSQL ingest and read endpoints for list.am scrape data.

## Endpoints

- `GET /health` — health check
- `POST /api/ingest` — bulk upsert (header `X-API-Key`)
- `GET /api/searches`, `/api/listings`, `/api/owners`, `/api/search-listings`, `/api/scrape-runs`, `/api/stats/overview`

## Local dev

```bash
cp .env.example .env
# Set DATABASE_URL and INGEST_API_KEY
npm install
npm run db:migrate
npm run dev
```

## Railway

1. Create a PostgreSQL database on Railway.
2. Deploy this service from the `backend/` folder (Dockerfile or Nixpacks).
3. Set env vars:
   - `DATABASE_URL` — from Railway Postgres
   - `INGEST_API_KEY` — shared secret for scrape-front
   - `CORS_ORIGIN` — Vercel frontend URLs (comma-separated)
   - `PORT` — Railway sets this automatically

Migrations run on startup.
