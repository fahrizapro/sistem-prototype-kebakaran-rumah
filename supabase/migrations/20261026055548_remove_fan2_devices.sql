/*
# Reduce to one fan per house

1. Data changes
- Remove all `fan2` device rows from `device_state` (both houses). Each house keeps `fan1` only.
2. Schema
- No schema change. `device` is free-text so no constraint edit needed.
3. Security
- No RLS/policy changes.
*/

DELETE FROM device_state WHERE device = 'fan2';
