import type { Env } from '../../types'

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const { DB } = context.env

  try {
    await DB.batch([
      DB.prepare(`
        CREATE TABLE IF NOT EXISTS users (
            id         TEXT PRIMARY KEY,
            email      TEXT NOT NULL,
            version    INTEGER NOT NULL,
            is_deleted INTEGER NOT NULL
        )
      `),
      DB.prepare(`
        CREATE TABLE IF NOT EXISTS credentials (
            user_id           TEXT PRIMARY KEY,
            access_key_id     TEXT NOT NULL,
            expiration        INTEGER NOT NULL,
            secret_access_key TEXT NOT NULL,
            session_token     TEXT NOT NULL,
            version           INTEGER NOT NULL,
            is_deleted        INTEGER NOT NULL
        )
      `),
      DB.prepare(`
        CREATE TABLE IF NOT EXISTS buckets (
            user_id                 TEXT PRIMARY KEY,
            region                  TEXT NOT NULL,
            exif_bucket             TEXT NOT NULL,
            exif_keybase            TEXT NOT NULL,
            expand_exif_bucket      TEXT NOT NULL,
            expand_exif_keybase     TEXT NOT NULL,
            expand_original_bucket  TEXT NOT NULL,
            expand_original_keybase TEXT NOT NULL,
            extra_large_bucket      TEXT NOT NULL,
            extra_large_keybase     TEXT NOT NULL,
            middle_bucket           TEXT NOT NULL,
            middle_keybase          TEXT NOT NULL,
            original_bucket         TEXT NOT NULL,
            original_keybase        TEXT NOT NULL,
            version                 INTEGER NOT NULL,
            is_deleted              INTEGER NOT NULL
        )
      `),
      DB.prepare(`
        CREATE TABLE IF NOT EXISTS photos (
            image_id              TEXT PRIMARY KEY,
            user_id               TEXT NOT NULL,
            source_device         TEXT NOT NULL,
            date_path             TEXT NOT NULL,
            shooting_date         INTEGER NOT NULL,
            uploaded_date         INTEGER NOT NULL,
            shooting_camera       TEXT,
            image_size            TEXT,
            file_size             TEXT,
            file_format           TEXT,
            shutter_speed         TEXT,
            aperture_value        TEXT,
            iso_speed             TEXT,
            lens_focal_length     TEXT,
            white_balance_mode    TEXT,
            exposure_compensation TEXT,
            flash_firing          TEXT,
            lens                  TEXT,
            subject_category      TEXT,
            blur_judgement        TEXT,
            exposure_judgement    TEXT,
            version               INTEGER NOT NULL,
            is_deleted            INTEGER NOT NULL
        )
      `),
      DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_photos_user_shooting
        ON photos (user_id, is_deleted, shooting_date DESC, image_id DESC)
      `),
      DB.prepare(`
        CREATE TABLE IF NOT EXISTS sync_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     TEXT NOT NULL,
            mutation_id TEXT UNIQUE NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id   TEXT NOT NULL,
            payload     TEXT,
            version     INTEGER NOT NULL,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `),
    ])

    return Response.json({ success: true, message: 'Database initialized' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
