import { describe, expect, it } from 'vitest'

import { decodeH5074Values, decodeH5075Values, decodeH5179Values } from './decode.js'

/**
 * Helpers that build a advertisement exactly as the sensor would, so a decoder
 * is checked against a known reading rather than against itself.
 */
function leHex(value) {
  const v = value & 0xFFFF
  return `${(v & 0xFF).toString(16).padStart(2, '0')}${((v >> 8) & 0xFF).toString(16).padStart(2, '0')}`
}

function byteHex(value) {
  return value.toString(16).padStart(2, '0')
}

// H5074: temperature and humidity are little-endian pairs at bytes 3-4 and 5-6,
// with the battery at byte 7
function buildH5074(tempInC, humidity, battery) {
  return `88ec00${leHex(Math.round(tempInC * 100))}${leHex(Math.round(humidity * 100))}${byteHex(battery)}00`
}

// H5179: same shape but shifted along, temperature at bytes 6-7, humidity at
// bytes 8-9 and the battery at byte 10
function buildH5179(tempInC, humidity, battery) {
  return `0188ec000102${leHex(Math.round(tempInC * 100))}${leHex(Math.round(humidity * 100))}${byteHex(battery)}`
}

describe('bLE sensor decoding', () => {
  describe('h5074', () => {
    it('reads back a known reading', () => {
      const result = decodeH5074Values(buildH5074(22.5, 45, 88))

      expect(result.tempInC).toBe(22.5)
      expect(result.humidity).toBe(45)
      expect(result.battery).toBe(88)
    })

    it('handles a temperature below freezing', () => {
      expect(decodeH5074Values(buildH5074(-5.25, 30, 50)).tempInC).toBe(-5.25)
    })
  })

  describe('h5179', () => {
    /**
     * The bug this guards against: the temperature was built from the byte that
     * actually holds the low half of the humidity, so a real 22.5C was reported
     * as 21.96C. Wrong, but close enough to look believable, which is why it
     * went unnoticed - hence a test that pins an exact expected value.
     */
    it('reads back a known reading', () => {
      const result = decodeH5179Values(buildH5179(22.5, 45, 100))

      expect(result.tempInC).toBe(22.5)
      expect(result.humidity).toBe(45)
      expect(result.battery).toBe(100)
    })

    it('handles a temperature below freezing', () => {
      const result = decodeH5179Values(buildH5179(-3.5, 55.25, 20))

      expect(result.tempInC).toBe(-3.5)
      expect(result.humidity).toBe(55.25)
    })

    it('does not let the humidity change the temperature', () => {
      // same temperature, different humidity - the temperature must not move
      const a = decodeH5179Values(buildH5179(20, 30, 90))
      const b = decodeH5179Values(buildH5179(20, 70, 90))

      expect(a.tempInC).toBe(20)
      expect(b.tempInC).toBe(20)
    })

    it('converts to fahrenheit from the corrected celsius', () => {
      expect(decodeH5179Values(buildH5179(100, 50, 80)).tempInF).toBe(212)
    })
  })

  describe('h5075', () => {
    it('reads the temperature and humidity out of the shared packed value', () => {
      // This model packs both readings into one 3-byte number, temperature
      // scaled by 10000 with the humidity in the last three digits, so the two
      // cannot be set independently the way they can on the models above.
      const packed = 225450
      const result = decodeH5075Values(`88ec00${packed.toString(16).padStart(6, '0')}58`)

      expect(result.tempInC).toBe(22.545)
      expect(result.humidity).toBe(45)
      expect(result.battery).toBe(88)
    })

    it('reads a temperature below freezing from the sign bit', () => {
      const packed = 0x800000 | 55000
      const result = decodeH5075Values(`88ec00${packed.toString(16).padStart(6, '0')}58`)

      expect(result.tempInC).toBe(-5.5)
    })
  })

  it('rejects a stream that is too short to hold a reading', () => {
    expect(() => decodeH5179Values('0188ec00')).toThrow()
  })
})
