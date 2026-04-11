/**
 * BLE Protocol Constants for Govee Devices
 *
 * Govee BLE packets are always 20 bytes with XOR checksum:
 * ┌──────────┬─────────┬──────────┬──────────────────┬──────────┐
 * │ ID (1B)  │ Cmd(1B) │ Sub(1B)  │ Data (16B)       │ XOR (1B) │
 * └──────────┴─────────┴──────────┴──────────────────┴──────────┘
 *
 * Reference: https://github.com/lasswellt/govee-homeassistant/blob/master/docs/govee-protocol-reference.md
 */

// Packet identifiers (byte 0)
export const PACKET_ID = {
  COMMAND: 0x33, // Outbound commands to device
  STATUS: 0xAA, // Status/state data in MQTT responses
  DIY: 0xA1, // DIY mode data
  SCENE_MULTI: 0xA3, // Multi-packet scene data
}

// Command types (byte 1, when PACKET_ID is COMMAND)
export const CMD = {
  POWER: 0x01,
  BRIGHTNESS: 0x04,
  COLOR_MODE: 0x05,
  SEGMENT: 0x0B,
  GRADIENT: 0x14,
  SCENE: 0x21,
  NIGHTLIGHT: 0x36,
}

// Color/mode sub-commands (byte 2, when CMD is COLOR_MODE)
export const COLOR_SUB = {
  VIDEO: 0x00, // DreamView mode (H6199)
  MUSIC: 0x01, // Music mode (H6127)
  RGB_DEFAULT: 0x02, // Manual RGB (H6127 and most devices)
  SCENE_PRESET: 0x04, // Scene activation (little-endian code)
  DIY: 0x0A, // DIY animation
  SEGMENT_CT: 0x0B, // Segment + color temp (H6199)
  RGB_ALT: 0x0D, // Manual RGB alternate (H615B, H6052, etc)
  RGB_EXTENDED: [0x15, 0x01], // Extended RGB (H6053, H6072, H6199)
}

// Status packet sub-types (byte 1, when PACKET_ID is STATUS)
export const STATUS_TYPE = {
  MODE: 0x05,
  SLEEP_TIMER: 0x07,
  SETTINGS: 0x11,
  EXTENDED_SETTINGS: 0x12,
  CURRENT_COLOR: 0x13, // [?, R, G, B]
  SEGMENT_CONFIG: 0x23,
  STATUS_FLAGS: 0x26,
  SEGMENT_COLORS: 0xA5, // 4 RGB triplets per packet
}

// BLE service and characteristic UUIDs
export const UUID = {
  SERVICE: '00010203-0405-0607-0809-0a0b0c0d1910',
  WRITE_DEFAULT: '000102030405060708090a0b0c0d2b11',
  WRITE_ALT: '000102030405060708090a0b0c0d2b10', // H615B
}

// Total BLE packet size
export const PACKET_SIZE = 20
