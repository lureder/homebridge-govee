import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isFirstReport, logUnknownData, resetReportedUnknowns } from './report-unknown.js'

function makeAccessory(context = {}) {
  return {
    displayName: 'Test Device',
    context: {
      gvDeviceId: 'AA:BB:CC:DD',
      gvModel: 'H6102',
      firmware: '1.03.01',
      hardware: '2.00.01',
      ...context,
    },
    logWarn: vi.fn(),
    logDebug: vi.fn(),
  }
}

function reported(accessory) {
  return accessory.logWarn.mock.calls[0]?.[0] ?? ''
}

function payloadOf(accessory) {
  const line = reported(accessory)
  return JSON.parse(line.slice(line.indexOf('{')))
}

describe('reporting unrecognised data', () => {
  beforeEach(() => {
    resetReportedUnknowns()
  })

  it('includes everything needed to add support, without being asked for it', () => {
    const accessory = makeAccessory()

    logUnknownData(accessory, {
      kind: 'scene',
      source: 'AWS',
      raw: 'MwUBAQAAAAAAAAAAAAAAAAAAADY=',
    })

    const payload = payloadOf(accessory)

    // the three things that otherwise always need a follow-up question
    expect(payload.model).toBe('H6102')
    expect(payload.firmware).toBe('1.03.01')
    expect(payload.source).toBe('AWS')
    // and the data itself, in both the forms that get used
    expect(payload.raw).toBe('MwUBAQAAAAAAAAAAAAAAAAAAADY=')
    expect(payload.hex).toBe('3305010100000000000000000000000000000036')
  })

  it('tells the user the line is what to report', () => {
    const accessory = makeAccessory()
    logUnknownData(accessory, { kind: 'scene', source: 'BLE', raw: 'abc' })

    expect(reported(accessory)).toContain('please include this line if you report it')
  })

  it('is a warning the first time so it is actually seen', () => {
    const accessory = makeAccessory()
    logUnknownData(accessory, { kind: 'scene', source: 'AWS', raw: 'abc' })

    expect(accessory.logWarn).toHaveBeenCalledTimes(1)
    expect(accessory.logDebug).not.toHaveBeenCalled()
  })

  it('does not shout twice about the same payload', () => {
    const accessory = makeAccessory()
    const entry = { kind: 'scene', source: 'AWS', raw: 'abc' }

    logUnknownData(accessory, entry)
    logUnknownData(accessory, entry)
    logUnknownData(accessory, entry)

    // devices repeat their codes constantly, so this must not flood the log
    expect(accessory.logWarn).toHaveBeenCalledTimes(1)
    expect(accessory.logDebug).toHaveBeenCalledTimes(2)
  })

  it('still reports a genuinely different payload', () => {
    const accessory = makeAccessory()

    logUnknownData(accessory, { kind: 'scene', source: 'AWS', raw: 'abc' })
    logUnknownData(accessory, { kind: 'scene', source: 'AWS', raw: 'xyz' })

    expect(accessory.logWarn).toHaveBeenCalledTimes(2)
  })

  it('treats two different devices separately', () => {
    const one = makeAccessory({ gvDeviceId: 'DEVICE:1' })
    const two = makeAccessory({ gvDeviceId: 'DEVICE:2' })

    logUnknownData(one, { kind: 'scene', source: 'AWS', raw: 'abc' })
    logUnknownData(two, { kind: 'scene', source: 'AWS', raw: 'abc' })

    expect(one.logWarn).toHaveBeenCalledTimes(1)
    expect(two.logWarn).toHaveBeenCalledTimes(1)
  })

  it('leaves out fields the device has not told us', () => {
    const accessory = makeAccessory({ firmware: undefined, hardware: undefined })
    logUnknownData(accessory, { kind: 'scene', source: 'AWS', raw: 'abc' })

    const payload = payloadOf(accessory)
    expect(payload).not.toHaveProperty('firmware')
    expect(payload).not.toHaveProperty('hardware')
    expect(payload.model).toBe('H6102')
  })

  it('records an object payload rather than dropping it', () => {
    const accessory = makeAccessory()
    logUnknownData(accessory, { kind: 'payload', source: 'LAN', raw: { foo: 'bar' } })

    expect(payloadOf(accessory).raw).toBe('{"foo":"bar"}')
  })

  it('copes with a payload that is not base64', () => {
    const accessory = makeAccessory()

    expect(() => logUnknownData(accessory, {
      kind: 'scene',
      source: 'AWS',
      raw: 'not base64 !!',
    })).not.toThrow()
    expect(accessory.logWarn).toHaveBeenCalledTimes(1)
  })

  it('says nothing when there is no accessory', () => {
    expect(() => logUnknownData(undefined, { kind: 'scene', raw: 'abc' })).not.toThrow()
  })

  describe('isFirstReport', () => {
    it('is true once and false after', () => {
      expect(isFirstReport('a')).toBe(true)
      expect(isFirstReport('a')).toBe(false)
      expect(isFirstReport('b')).toBe(true)
    })
  })
})
