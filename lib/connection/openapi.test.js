import { beforeEach, describe, expect, it } from 'vitest'

import { resetReportedUnknowns } from '../utils/report-unknown.js'
import OpenApiClient from './openapi.js'

/**
 * The payloads sent to Govee's public api, and what happens when a device was
 * never told to expect one.
 *
 * This connection fails more quietly than the others: a request naming a
 * capability the device does not have comes back successful and the device does
 * nothing at all.
 */

function makeClient() {
  return new OpenApiClient({
    config: { apiKey: 'test-key' },
    log: Object.assign(() => {}, { warn: () => {}, debug: () => {} }),
  })
}

function makeAccessory(capabilities = {}) {
  const messages = { warn: [], debug: [] }
  return {
    context: {
      gvModel: 'H7160',
      gvDeviceId: 'AA:BB:CC:DD',
      openApiCapabilities: capabilities,
    },
    logDebugWarn: msg => messages.warn.push(msg),
    logDebug: msg => messages.debug.push(msg),
    messages,
  }
}

describe('finding the capability to send', () => {
  beforeEach(() => {
    resetReportedUnknowns()
  })

  it('uses what the device itself listed', () => {
    const accessory = makeAccessory({
      powerSwitch: { type: 'devices.capabilities.on_off', instance: 'powerSwitch' },
    })

    const found = makeClient().getCapability(accessory, 'powerSwitch', 'devices.capabilities.range')

    expect(found.type).toBe('devices.capabilities.on_off')
    expect(accessory.messages.warn).toHaveLength(0)
  })

  it('says something when the device never listed it', () => {
    // Otherwise the control just appears broken, with nothing in the log
    const accessory = makeAccessory({ powerSwitch: { type: 'devices.capabilities.on_off', instance: 'powerSwitch' } })

    makeClient().getCapability(accessory, 'oscillationToggle', 'devices.capabilities.toggle')

    expect(accessory.messages.warn).toHaveLength(1)
    expect(accessory.messages.warn[0]).toContain('oscillationToggle')
    expect(accessory.messages.warn[0]).toContain('powerSwitch')
  })

  it('still sends it, since the list is not always complete', () => {
    const accessory = makeAccessory({})

    const found = makeClient().getCapability(accessory, 'oscillationToggle', 'devices.capabilities.toggle')

    expect(found).toMatchObject({ instance: 'oscillationToggle', type: 'devices.capabilities.toggle' })
  })

  it('says it once, then keeps quiet', () => {
    const accessory = makeAccessory({})
    const client = makeClient()

    client.getCapability(accessory, 'oscillationToggle', 'devices.capabilities.toggle')
    client.getCapability(accessory, 'oscillationToggle', 'devices.capabilities.toggle')
    client.getCapability(accessory, 'oscillationToggle', 'devices.capabilities.toggle')

    expect(accessory.messages.warn).toHaveLength(1)
    expect(accessory.messages.debug).toHaveLength(2)
  })

  it('says it again for a different capability', () => {
    const accessory = makeAccessory({})
    const client = makeClient()

    client.getCapability(accessory, 'oscillationToggle', 'devices.capabilities.toggle')
    client.getCapability(accessory, 'lockToggle', 'devices.capabilities.toggle')

    expect(accessory.messages.warn).toHaveLength(2)
  })
})

describe('the payload each command turns into', () => {
  beforeEach(() => {
    resetReportedUnknowns()
  })

  const fullDevice = {
    powerSwitch: { type: 'devices.capabilities.on_off', instance: 'powerSwitch' },
    brightness: { type: 'devices.capabilities.range', instance: 'brightness', parameters: { range: { min: 1, max: 100 } } },
    colorRgb: { type: 'devices.capabilities.color_setting', instance: 'colorRgb' },
    colorTemperatureK: { type: 'devices.capabilities.color_setting', instance: 'colorTemperatureK', parameters: { range: { min: 2000, max: 9000 } } },
  }

  it('turns on and off into the one and zero the api expects', () => {
    const client = makeClient()
    const accessory = makeAccessory(fullDevice)

    expect(client.buildCapabilityPayload(accessory, { cmd: 'state', value: 'on' }).value).toBe(1)
    expect(client.buildCapabilityPayload(accessory, { cmd: 'state', value: 'off' }).value).toBe(0)
  })

  it('names the capability the device listed, not a guessed one', () => {
    const client = makeClient()
    const payload = client.buildCapabilityPayload(makeAccessory(fullDevice), { cmd: 'state', value: 'on' })

    expect(payload).toMatchObject({
      type: 'devices.capabilities.on_off',
      instance: 'powerSwitch',
    })
  })

  it('keeps brightness inside the range the device gave', () => {
    const client = makeClient()
    const accessory = makeAccessory(fullDevice)

    expect(client.buildCapabilityPayload(accessory, { cmd: 'brightness', value: 500 }).value).toBe(100)
    expect(client.buildCapabilityPayload(accessory, { cmd: 'brightness', value: 0 }).value).toBe(1)
    expect(client.buildCapabilityPayload(accessory, { cmd: 'brightness', value: 42 }).value).toBe(42)
  })

  it('passes a named capability straight through', () => {
    const client = makeClient()
    const payload = client.buildCapabilityPayload(makeAccessory({}), {
      cmd: 'openApi',
      instance: 'oscillationToggle',
      capabilityType: 'devices.capabilities.toggle',
      value: 1,
    })

    expect(payload).toMatchObject({ instance: 'oscillationToggle', value: 1 })
  })

  it('refuses a command it has no form of, rather than sending something empty', () => {
    const client = makeClient()

    expect(() => client.buildCapabilityPayload(makeAccessory({}), { cmd: 'nonsense', value: 1 }))
      .toThrow(/not supported via OpenAPI/)
  })

  it('refuses a scene the device does not offer', () => {
    // Sending an unknown scene name is accepted and silently ignored
    const client = makeClient()
    const accessory = makeAccessory({
      lightScene: { type: 'devices.capabilities.dynamic_scene', instance: 'lightScene', parameters: { options: [{ name: 'Sunset', value: 1 }] } },
    })

    expect(client.buildCapabilityPayload(accessory, { cmd: 'lightScene', value: 'Sunset' }).value).toBe(1)
    expect(() => client.buildCapabilityPayload(accessory, { cmd: 'lightScene', value: 'Nonexistent' }))
      .toThrow(/scene not available/)
  })
})
