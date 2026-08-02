import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetReportedUnknowns } from '../utils/report-unknown.js'
import { deviceHumidifierBasic, devicePurifierBasic } from './appliance-basic.js'

/**
 * Minimal stand-ins for the HomeKit objects. Enough to see which service a
 * device is given and which controls it ends up with.
 */
function makeCharacteristic(value) {
  return {
    value,
    onSet(fn) {
      this.setHandler = fn
      return this
    },
    setProps() {
      return this
    },
  }
}

function makeService(name) {
  const chars = new Map()
  return {
    name,
    getCharacteristic(char) {
      if (!chars.has(char)) {
        chars.set(char, makeCharacteristic(char === 'On' ? false : 0))
      }
      return chars.get(char)
    },
    updateCharacteristic(char, value) {
      this.getCharacteristic(char).value = value
      return this
    },
    testCharacteristic: char => chars.has(char),
    removeCharacteristic() {},
    chars,
  }
}

function makePlatform() {
  // Service and characteristic names stand in for themselves, so a test can
  // assert on which one was picked
  const proxy = new Proxy({}, { get: (_t, prop) => prop })
  return {
    log: Object.assign(vi.fn(), { warn: vi.fn(), debug: vi.fn() }),
    api: { hap: { Service: proxy, Characteristic: proxy, HapStatusError: class {} } },
  }
}

function makeAccessory(capabilities) {
  const services = new Map()
  return {
    displayName: 'Test Appliance',
    context: {
      gvModel: 'H7146',
      gvDeviceId: 'AA:BB',
      openApiCapabilities: capabilities,
    },
    getService: name => services.get(name),
    addService(name) {
      const svc = makeService(name)
      services.set(name, svc)
      return svc
    },
    removeService(svc) {
      services.delete(svc.name)
    },
    log: vi.fn(),
    logWarn: vi.fn(),
    logDebug: vi.fn(),
    services,
  }
}

describe('basic appliance handler', () => {
  beforeEach(() => {
    resetReportedUnknowns()
  })

  describe('choosing the tile for a humidifier', () => {
    it('uses the plain fan when the device reports no humidity', () => {
      // HomeKit's humidifier must show a current humidity, and many govee
      // humidifiers never send one - so the safe tile is the plain fan
      const accessory = makeAccessory({})
      const device = new deviceHumidifierBasic(makePlatform(), accessory)

      expect(device.service.name).toBe('Fan')
      expect(accessory.services.has('HumidifierDehumidifier')).toBe(false)
    })

    it('uses the proper humidifier when the device does report humidity', () => {
      const accessory = makeAccessory({ sensorHumidity: { type: 'sensor' } })
      const device = new deviceHumidifierBasic(makePlatform(), accessory)

      expect(device.service.name).toBe('HumidifierDehumidifier')
    })

    it('switches the power characteristic to suit the tile', () => {
      // the plain fan switches on a boolean, the humidifier on active
      const plain = new deviceHumidifierBasic(makePlatform(), makeAccessory({}))
      const rich = new deviceHumidifierBasic(
        makePlatform(),
        makeAccessory({ sensorHumidity: {} }),
      )

      expect(plain.powerChar).toBe('On')
      expect(plain.powerOn).toBe(true)
      expect(rich.powerChar).toBe('Active')
      expect(rich.powerOn).toBe(1)
    })

    it('passes a humidity reading through only on the richer tile', () => {
      const rich = new deviceHumidifierBasic(
        makePlatform(),
        makeAccessory({ sensorHumidity: {} }),
      )
      rich.externalUpdate({ humidity: 55 })

      expect(rich.service.getCharacteristic('CurrentRelativeHumidity').value).toBe(55)
    })
  })

  it('keeps the current-state characteristic on a purifier', () => {
    // the purifier has no fallback tile, so its state characteristic must stay
    const device = new devicePurifierBasic(makePlatform(), makeAccessory({}))

    expect(device.service.name).toBe('AirPurifier')
    expect(device.currentStateChar).toBe('CurrentAirPurifierState')
  })

  it('reports an unknown control and fails the request', async () => {
    const accessory = makeAccessory({})
    const device = new deviceHumidifierBasic(makePlatform(), accessory)

    await expect(device.internalVariableUpdate(50)).rejects.toBeDefined()
    expect(accessory.logWarn).toHaveBeenCalledTimes(1)
    expect(accessory.logWarn.mock.calls[0][0]).toContain('mist level')
  })

  it('ignores the control following the device being switched off', async () => {
    const accessory = makeAccessory({})
    const device = new deviceHumidifierBasic(makePlatform(), accessory)

    await expect(device.internalVariableUpdate(0)).resolves.toBeUndefined()
    expect(accessory.logWarn).not.toHaveBeenCalled()
  })
})
