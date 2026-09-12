import type { Request, Response, NextFunction } from 'express'

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.INGEST_API_KEY
  if (!expected) {
    res.status(500).json({ error: 'INGEST_API_KEY not configured' })
    return
  }

  const provided = req.header('x-api-key')
  if (provided !== expected) {
    res.status(401).json({ error: 'Invalid API key' })
    return
  }

  next()
}
