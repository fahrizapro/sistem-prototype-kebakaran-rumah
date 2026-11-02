/*
# Fire Monitoring Dashboard Schema (single-tenant, no auth)

1. New Tables
- `house_status` — latest sensor readings for each house (upserted by ESP32).
  - `house` (text, primary key): 'A' or 'B'
  - `temperature` (numeric, °C) from sensor 1
  - `smoke_mq2` (numeric, ppm/analog value) from sensor 2
  - `gas_mq6` (numeric, percent gas leak) from sensor 3
  - `fire1`..`fire4` (boolean): fire sensor states
  - `updated_at` (timestamptz)
- `device_state` — current mode (auto/manual) + manual override per device per house.
  - `house` (text): 'A' or 'B'
  - `device` (text): 'sprinkler1'..'sprinkler4', 'fan1', 'fan2'
  - `mode` (text): 'auto' or 'manual'
  - `manual_active` (boolean): whether device is forced on in manual mode
  - `updated_at` (timestamptz)
  - Primary key (house, device)

2. Security
- Enable RLS on both tables.
- Grant CRUD to anon + authenticated (single-tenant IoT dashboard; ESP32 writes via anon key).
- Open CRUD policies since data is intentionally shared for monitoring.

3. Notes
- The dashboard reads `house_status` (realtime) to display sensor values and danger state.
- The dashboard writes `device_state` to switch a device to auto/manual or force it on/off.
- The ESP32 reads `device_state` to know how to actuate sprinklers/fans, and upserts `house_status`.
*/

CREATE TABLE IF NOT EXISTS house_status (
  house text PRIMARY KEY,
  temperature numeric NOT NULL DEFAULT 0,
  smoke_mq2 numeric NOT NULL DEFAULT 0,
  gas_mq6 numeric NOT NULL DEFAULT 0,
  fire1 boolean NOT NULL DEFAULT false,
  fire2 boolean NOT NULL DEFAULT false,
  fire3 boolean NOT NULL DEFAULT false,
  fire4 boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE house_status ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON house_status TO anon, authenticated;

DROP POLICY IF EXISTS "anon_select_house_status" ON house_status;
CREATE POLICY "anon_select_house_status" ON house_status FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_house_status" ON house_status;
CREATE POLICY "anon_insert_house_status" ON house_status FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_house_status" ON house_status;
CREATE POLICY "anon_update_house_status" ON house_status FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_house_status" ON house_status;
CREATE POLICY "anon_delete_house_status" ON house_status FOR DELETE
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS device_state (
  house text NOT NULL,
  device text NOT NULL,
  mode text NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto','manual')),
  manual_active boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (house, device)
);

ALTER TABLE device_state ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON device_state TO anon, authenticated;

DROP POLICY IF EXISTS "anon_select_device_state" ON device_state;
CREATE POLICY "anon_select_device_state" ON device_state FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_device_state" ON device_state;
CREATE POLICY "anon_insert_device_state" ON device_state FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_device_state" ON device_state;
CREATE POLICY "anon_update_device_state" ON device_state FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_device_state" ON device_state;
CREATE POLICY "anon_delete_device_state" ON device_state FOR DELETE
  TO anon, authenticated USING (true);

-- Seed default device rows for both houses
INSERT INTO house_status (house) VALUES ('A'), ('B')
  ON CONFLICT (house) DO NOTHING;

INSERT INTO device_state (house, device) VALUES
  ('A','sprinkler1'),('A','sprinkler2'),('A','sprinkler3'),('A','sprinkler4'),
  ('A','fan1'),('A','fan2'),
  ('B','sprinkler1'),('B','sprinkler2'),('B','sprinkler3'),('B','sprinkler4'),
  ('B','fan1'),('B','fan2')
  ON CONFLICT (house, device) DO NOTHING;
