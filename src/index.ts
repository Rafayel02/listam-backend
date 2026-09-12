import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { migrate, pool } from './db.js'
import { ingestRouter } from './routes/ingest.js'
import { readRouter } from './routes/read.js'

const app = express()
const port = Number(process.env.PORT ?? 3001)

const corsOrigin = process.env.CORS_ORIGIN?.split(',').map((v) => v.trim()) ?? ['*']

app.use(cors({ origin: corsOrigin }))
app.use(express.json({ limit: '25mb' }))

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.use('/api/ingest', ingestRouter)
app.use('/api', readRouter)

async function start(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn('DATABASE_URL not set — API will fail on DB calls')
  } else {
    await migrate()
  }

  app.listen(port, () => {
    console.log(`listam-backend listening on :${port}`)
  })
}

start().catch((err) => {
  console.error(err)
  process.exit(1)
})

process.on('SIGTERM', async () => {
  await pool.end()
  process.exit(0)
})
