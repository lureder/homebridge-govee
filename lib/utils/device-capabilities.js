import { COLOR_SUB, UUID } from './ble-protocol.js'

/**
 * Per-model overrides for device-specific protocol quirks.
 * Models not listed here use the defaults returned by getDeviceCapabilities().
 *
 * Reference: https://github.com/lasswellt/govee-homeassistant/blob/master/docs/govee-protocol-reference.md
 */
const modelOverrides = {
  // BLE color sub-command: 0x0D instead of 0x02
  H6005: { bleColorCmd: [COLOR_SUB.RGB_ALT] },
  H6052: { bleColorCmd: [COLOR_SUB.RGB_ALT], bleBrightnessScale: 0x64 },
  H6058: { bleColorCmd: [COLOR_SUB.RGB_ALT], bleBrightnessScale: 0x64 },
  H6102: { bleColorCmd: [COLOR_SUB.RGB_ALT], bleBrightnessScale: 0x64 },
  H613B: { bleColorCmd: [COLOR_SUB.RGB_ALT], bleBrightnessScale: 0x64 },
  H613D: { bleColorCmd: [COLOR_SUB.RGB_ALT], bleBrightnessScale: 0x64 },
  H617E: { bleColorCmd: [COLOR_SUB.RGB_ALT], bleBrightnessScale: 0x64 },

  // BLE color sub-command: 0x15 0x01 (extended) with trailing bytes
  H6053: { bleColorCmd: COLOR_SUB.RGB_EXTENDED, bleColorCmdSuffix: [0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0x7F] },
  H6072: { bleColorCmd: COLOR_SUB.RGB_EXTENDED, bleColorCmdSuffix: [0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0x7F] },
  H6199: { bleColorCmd: COLOR_SUB.RGB_EXTENDED, bleColorCmdSuffix: [0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0x7F] },

  // AWS outlet uses 17/16 for on/off instead of 1/0
  H5080: { awsPowerOn: 17, awsPowerOff: 16 },
  H5083: { awsPowerOn: 17, awsPowerOff: 16 },

  // H615B uses alternate BLE write characteristic UUID
  H615B: { bleWriteUuid: UUID.WRITE_ALT },

  // H6121 requires cmdVersion 1 for status requests
  H6121: { awsStatusCmdVersion: 1 },
}

const defaults = {
  bleColorCmd: [COLOR_SUB.RGB_DEFAULT],
  bleColorCmdSuffix: [],
  bleBrightnessScale: 0xFF,
  awsPowerOn: 1,
  awsPowerOff: 0,
  bleWriteUuid: UUID.WRITE_DEFAULT,
  awsStatusCmdVersion: 2,
}

export function getDeviceCapabilities(model) {
  const overrides = modelOverrides[model] || {}
  return { ...defaults, ...overrides }
}
