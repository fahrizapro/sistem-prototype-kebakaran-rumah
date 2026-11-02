/*
# Add device_config table for editable device configuration

1. New Table
- `device_config`: editable registry of actuators/sensors per house.
  - `id` (uuid, PK)
  - `house` (text): 'A' or 'B' — which house the device belongs to.
  - `device` (text): internal device key used by device_state (e.g. 'sprinkler1', 'fan1').
  - `label` (text): human-friendly display name (e.g. 'Sprinkler 1', 'Kipas 1').
  - `type` (text): 'sprinkler' | 'fan' | 'sensor' — category of device.
  - `device_id` (text): hardware identifier set on the ESP32 (e.g. ESP32 MAC suffix or GPIO pin label). Used by ESP32 to match a device_state row to the physical actuator.
  - `pin` (text, nullable): GPIO pin assignment on ESP32 (e.g. 'GPIO25').
  - `enabled` (boolean, default true): if false, the device is ignored by the dashboard.
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)
- Unique constraint on (house, device) to prevent duplicate config rows.

2. Seed Data
- Pre-populates default config rows matching the existing device_state rows for both houses:
  - sprinkler1-4, fan1 for house A and B.

3. Security
- Enable RLS.
- Grant CRUD to anon + authenticated (single-tenant, no-auth IoT dashboard — data intentionally shared).
- Four separate policies (SELECT/INSERT/UPDATE/DELETE), open USING(true) because data is shared.
*/

CREATE TABLE IF NOT EXISTS device_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house text NOT NULL,
  device text NOT NULL,
  label text NOT NULL,
  type text NOT NULL CHECK (type IN ('sprinkler', 'fan', 'sensor')),
  device_id text NOT NULL DEFAULT '',
  pin text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_config_house_device_key UNIQUE (house, device)
);

ALTER TABLE device_config ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON device_config TO anon, authenticated;

DROP POLICY IF EXISTS "anon_select_device_config" ON device_config;
CREATE POLICY "anon_select_device_config" ON device_config FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_device_config" ON device_config;
CREATE POLICY "anon_insert_device_config" ON device_config FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_device_config" ON device_config;
CREATE POLICY "anon_update_device_config" ON device_config FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_device_config" ON device_config;
CREATE POLICY "anon_delete_device_config" ON device_config FOR DELETE
  TO anon, authenticated USING (true);

-- Seed default device config rows for both houses
INSERT INTO device_config (house, device, label, type, device_id, pin) VALUES
  ('A', 'sprinkler1', 'Sprinkler 1', 'sprinkler', 'ESP32-A-SP1', 'GPIO25'),
  ('A', 'sprinkler2', 'Sprinkler 2', 'sprinkler', 'ESP32-A-SP2', 'GPIO26'),
  ('A', 'sprinkler3', 'Sprinkler 3', 'sprinkler', 'ESP32-A-SP3', 'GPIO27'),
  ('A', 'sprinkler4', 'Sprinkler 4', 'sprinkler', 'ESP32-A-SP4', 'GPIO14'),
  ('A', 'fan1',       'Kipas 1',      'fan',      'ESP32-A-FAN1', 'GPIO12'),
  ('B', 'sprinkler1', 'Sprinkler 1', 'sprinkler', 'ESP32-B-SP1', 'GPIO25'),
  ('B', 'sprinkler2', 'Sprinkler 2', 'sprinkler', 'ESP32-B-SP2', 'GPIO26'),
  ('B', 'sprinkler3', 'Sprinkler 3', 'sprinkler', 'ESP32-B-SP3', 'GPIO27'),
  ('B', 'sprinkler4', 'Sprinkler 4', 'sprinkler', 'ESP32-B-SP4', 'GPIO14'),
  ('B', 'fan1',       'Kipas 1',      'fan',      'ESP32-B-FAN1', 'GPIO12')
ON CONFLICT (house, device) DO NOTHING;
