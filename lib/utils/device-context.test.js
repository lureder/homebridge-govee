import { describe, expect, it } from 'vitest'

import { applyDeviceContext } from './device-context.js'

/**
 * What a handler is told about a device before it is built - which connections
 * it can use, what firmware it runs, what Govee says it can do.
 *
 * None of this was covered before it was lifted out of the platform. The model
 * snapshot does not reach it either, because it builds devices with none of
 * this information attached, so a mistake here would have gone unseen.
 */

function apply({ device = {}, deviceConf = {}, platform = {} } = {}) {
  const accessory = { displayName: 'Test', context: { gvModel: device.model || 'H6102' } }
  const joins = { awsDevices: [], awsDevicesToPoll: [], doAWSPolling: false, ...(platform.joins || {}) }
  const host = {
    log: Object.assign(() => {}, { warn: () => {}, debug: () => {}, debugWarn: () => {} }),
    ...platform,
  }
  applyDeviceContext(host, accessory, { device: 'AA:BB:CC:DD:EE:FF', ...device }, deviceConf, joins)
  return { accessory, joins }
}

describe('which connections a device can use', () => {
  it('starts with everything off, so nothing is assumed', () => {
    const { accessory } = apply()

    expect(accessory.context).toMatchObject({
      hasAwsControl: false,
      useAwsControl: false,
      hasBleControl: false,
      useBleControl: false,
      hasOpenApiControl: false,
      useOpenApiControl: false,
    })
  })

  it('takes LAN control from what the device reported', () => {
    expect(apply({ device: { isLanDevice: true } }).accessory.context.hasLanControl).toBe(true)
    expect(apply({ device: { isLanDevice: false } }).accessory.context.hasLanControl).toBe(false)
  })

  it('knows a device can use AWS without being able to use it yet', () => {
    // The device having a topic and the plugin having a connection are two
    // different things, and the tiles depend on the second
    const device = { httpInfo: { deviceExt: { deviceSettings: JSON.stringify({ topic: 'a/topic' }) } } }

    const without = apply({ device }).accessory.context
    expect(without.hasAwsControl).toBe(true)
    expect(without.useAwsControl).toBe(false)

    const withClient = apply({ device, platform: { awsClient: {} } }).accessory.context
    expect(withClient.useAwsControl).toBe(true)
  })

  it('registers a device with AWS only once there is a connection', () => {
    const device = { httpInfo: { deviceExt: { deviceSettings: JSON.stringify({ topic: 'a/topic' }) } } }

    expect(apply({ device }).joins.awsDevices).toHaveLength(0)
    expect(apply({ device, platform: { awsClient: {} } }).joins.awsDevices).toHaveLength(1)
  })

  it('adds it to the polling list only when its kind needs polling', () => {
    const device = { httpInfo: { deviceExt: { deviceSettings: JSON.stringify({ topic: 'a/topic' }) } } }
    const platform = { awsClient: {} }

    expect(apply({ device, platform }).joins.awsDevicesToPoll).toHaveLength(0)
    expect(
      apply({ device, platform: { ...platform, joins: { doAWSPolling: true } } }).joins.awsDevicesToPoll,
    ).toHaveLength(1)
  })
})

describe('working out a bluetooth address', () => {
  const device = {
    device: 'AA:BB:CC:DD:EE:FF',
    httpInfo: { deviceExt: { deviceSettings: JSON.stringify({ bleName: 'ihoment_H6102' }) } },
  }

  it('derives one from the device id when none was given', () => {
    const { accessory } = apply({ device })

    // the last four pairs of the device id, lowercased
    expect(accessory.context.hasBleControl).toBe(true)
    expect(accessory.context.bleAddress).toBe('cc:dd:ee:ff')
  })

  it('prefers an address the owner set', () => {
    const { accessory } = apply({ device, deviceConf: { customAddress: 'AA:11:22:33:44:55' } })

    expect(accessory.context.bleAddress).toBe('aa:11:22:33:44:55')
  })
})

describe('what the device tells us about itself', () => {
  it('records the firmware and hardware it reports', () => {
    const { accessory } = apply({
      device: { httpInfo: { versionSoft: '1.03.01', versionHard: '2.00.01' } },
    })

    expect(accessory.context.firmware).toBe('1.03.01')
    expect(accessory.context.hardware).toBe('2.00.01')
  })

  it('says so when it reports nothing', () => {
    const { accessory } = apply()

    expect(accessory.context.firmware).toBe(false)
    expect(accessory.context.hardware).toBe(false)
  })

  it('keeps the capability list the api gave for this device', () => {
    const { accessory } = apply({
      device: { openApiInfo: { byInstance: { powerSwitch: {}, sensorHumidity: {} } } },
    })

    expect(accessory.context.hasOpenApiControl).toBe(true)
    expect(Object.keys(accessory.context.openApiCapabilities)).toEqual(['powerSwitch', 'sensorHumidity'])
  })

  it('shrugs off a broken extras blob rather than failing the whole device', () => {
    const run = () => apply({ device: { httpInfo: { deviceExt: { extResources: 'not json' } } } })

    expect(run).not.toThrow()
    expect(run().accessory.context.image).toBe(false)
  })
})

describe('settings that are carried into the context', () => {
  it('carries a temperature source through', () => {
    const { accessory } = apply({ deviceConf: { temperatureSource: 'AA:BB' } })

    expect(accessory.context.temperatureSource).toBe('AA:BB')
  })

  it('carries a chosen temperature unit, but not the automatic one', () => {
    expect(apply({ deviceConf: { openApiTempUnit: 'f' } }).accessory.context.openApiTempUnit).toBe('f')
    expect(apply({ deviceConf: { openApiTempUnit: 'auto' } }).accessory.context.openApiTempUnit).toBeUndefined()
  })
})
