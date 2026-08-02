import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetReportedUnknowns } from '../utils/report-unknown.js'
import deviceFanH7100 from './fan-H7100.js'

/**
 * The H1310 and R1310 ceiling fans share this handler, but their oscillation
 * status message has never been confirmed to mean the same thing, so they are
 * set not to read it. That difference is data rather than a second copy of the
 * file, and the model snapshot cannot see it - it only covers which controls a
 * device is given, not how it reads messages back. So it is pinned here.
 */

const SWING_ON_STATUS = 'qh8BAQAAAAAAAAAAAAAAAAAAALU='

function makeService() {
  const chars = new Map()
  const characteristic = name => ({
    name,
    value: 0,
    onSet() {
      return this
    },
    setProps() {
      return this
    },
  })
  return {
    getCharacteristic(name) {
      if (!chars.has(name)) {
        chars.set(name, characteristic(name))
      }
      return chars.get(name)
    },
    updateCharacteristic(name, value) {
      this.getCharacteristic(name).value = value
      return this
    },
    testCharacteristic: name => chars.has(name),
    removeCharacteristic() {},
    chars,
  }
}

function makePlatform() {
  const proxy = new Proxy({}, { get: (_target, prop) => prop })
  return {
    log: Object.assign(vi.fn(), { warn: vi.fn(), debug: vi.fn() }),
    api: { hap: { Service: proxy, Characteristic: proxy, HapStatusError: class {} } },
    deviceConf: {},
  }
}

function makeAccessory(model) {
  const services = new Map()
  return {
    displayName: model,
    context: { gvModel: model, gvDeviceId: 'AA:BB' },
    getService: name => services.get(name),
    addService(name) {
      const service = makeService()
      service.name = name
      services.set(name, service)
      return service
    },
    removeService(service) {
      services.delete(service.name)
    },
    log: vi.fn(),
    logWarn: vi.fn(),
    logDebug: vi.fn(),
  }
}

describe('reading a fan\'s oscillation status', () => {
  beforeEach(() => {
    resetReportedUnknowns()
  })

  it('updates the switch on a model where the message is understood', () => {
    const accessory = makeAccessory('H7100')
    const device = new deviceFanH7100(makePlatform(), accessory)

    device.externalUpdate({ commands: [SWING_ON_STATUS], source: 'AWS' })

    expect(device.cacheSwing).toBe('on')
    expect(device.service.getCharacteristic('SwingMode').value).toBe(1)
  })

  it('reports the message instead on a model where it is not confirmed', () => {
    const accessory = makeAccessory('H1310')
    const device = new deviceFanH7100(makePlatform(), accessory)

    device.externalUpdate({ commands: [SWING_ON_STATUS], source: 'AWS' })

    expect(device.cacheSwing).not.toBe('on')
    expect(accessory.logWarn).toHaveBeenCalledTimes(1)
    expect(accessory.logWarn.mock.calls[0][0]).toContain('H1310')
  })

  it('treats the R1310 the same as the H1310', () => {
    // Same fan under a newer name, so it must not quietly behave differently
    const accessory = makeAccessory('R1310')
    const device = new deviceFanH7100(makePlatform(), accessory)

    device.externalUpdate({ commands: [SWING_ON_STATUS], source: 'AWS' })

    expect(device.cacheSwing).not.toBe('on')
    expect(accessory.logWarn).toHaveBeenCalledTimes(1)
  })
})
