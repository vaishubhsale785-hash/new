// src/config/deviceStore.js
// Replaces verified_devices.json — reads/writes from a local JSON file.
// In production you could swap this for a Redis SET or a DB table.

const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '../../data/verified_devices.json');

// Ensure data directory exists
const dataDir = path.dirname(STORE_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, '{}');

function load() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function save(devices) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(devices, null, 2));
}

function isVerified(tg_id, device_id) {
  const devices = load();
  const key = `${tg_id}_${device_id}`;
  return devices[key]?.verified === true;
}

function register(tg_id, device_id, username = '', first_name = '', ip = 'unknown') {
  const devices = load();
  const key = `${tg_id}_${device_id}`;
  devices[key] = {
    tg_id,
    device_id,
    username,
    first_name,
    verified: true,
    verified_at: new Date().toISOString(),
    ip,
  };
  save(devices);
}

function getByUser(tg_id) {
  const devices = load();
  return Object.values(devices).filter((d) => String(d.tg_id) === String(tg_id));
}

module.exports = { isVerified, register, getByUser };
