/*
# Add settings + event log tables

1. New Tables
- `app_settings` (single-row singleton): tunable thresholds and actuator delays used by the dashboard and ESP32.
  - `temp_threshold` (numeric, °C) — temperature considered dangerous.
  - `smoke_threshold` (numeric, MQ2 ppm) — smoke level considered dangerous.
  - `gas_threshold` (numeric, %) — gas leak percentage considered dangerous.
  - `sprinkler_delay` (numeric, seconds) — delay before sprinkler activates after fire detected.
  - `fan_delay` (numeric, seconds) — delay before fan activates after gas/smoke detected.
  - `fan_duration` (numeric, seconds) — how long fan runs after trigger clears (cooldown).
  - `updated_at` (timestamptz)
- `event_log`: append-only log of fire/gas/smoke/temperature/system events.
  - `id` (uuid, PK).
  - `house` (text): 'A' or 'B'.
  - `event_type` (text): 'fire' | 'smoke' | 'gas' | 'temperature' | 'system'.
  - `severity` (text): 'info' | 'warning' | 'danger'.
  - `message` (text): human-readable description.
  - `created_at` (timestamptz).

2. Security
- Enable RLS on both tables.
- `app_settings`: grant CRUD to anon+authenticated (single-tenant shared config).
- `event_log`: grant SELECT, INSERT, DELETE to anon+authenticated (append-only; delete allows clearing logs).
- Open policies because data is intentionally shared (no-auth IoT dashboard).

3. Notes
- The dashboard reads `app_settings` to evaluate danger and show settings UI.
- The dashboard inserts rows into `event_log` when danger state changes.
- The ESP32 may read `app_settings` to apply the same thresholds/delays on-device.
*/

CREATE TABLE IF NOT EXISTS app_settings (
  id int PRIMARY KEY DEFAULT 1,
  temp_threshold numeric NOT NULL DEFAULT 50,
  smoke_threshold numeric NOT NULL DEFAULT 1000,
  gas_threshold numeric NOT NULL DEFAULT 20,
  sprinkler_delay numeric NOT NULL DEFAULT 3,
  fan_delay numeric NOT NULL DEFAULT 2,
  fan_duration numeric NOT NULL DEFAULT 30,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT singleton CHECK (id = 1)
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_settings TO anon, authenticated;

DROP POLICY IF EXISTS "anon_select_app_settings" ON app_settings;
CREATE POLICY "anon_select_app_settings" ON app_settings FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_app_settings" ON app_settings;
CREATE POLICY "anon_insert_app_settings" ON app_settings FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_app_settings" ON app_settings;
CREATE POLICY "anon_update_app_settings" ON app_settings FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_app_settings" ON app_settings;
CREATE POLICY "anon_delete_app_settings" ON app_settings FOR DELETE
  TO anon, authenticated USING (true);

INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS event_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('fire','smoke','gas','temperature','system')),
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','danger')),
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE event_log ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON event_log TO anon, authenticated;

DROP POLICY IF EXISTS "anon_select_event_log" ON event_log;
CREATE POLICY "anon_select_event_log" ON event_log FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_event_log" ON event_log;
CREATE POLICY "anon_insert_event_log" ON event_log FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_event_log" ON event_log;
CREATE POLICY "anon_delete_event_log" ON event_log FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS event_log_created_at_idx ON event_log (created_at DESC);
