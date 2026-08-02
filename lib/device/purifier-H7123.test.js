import { beforeEach, describe, expect, it } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import { resetReportedUnknowns } from '../utils/report-unknown.js'
import devicePurifierH7123 from './purifier-H7123.js'

/**
 * The H7124 used to have its own copy of this file, and the air quality fix
 * from #1261 was only ever applied to the H7123's copy. Collapsing the two gave
 * the H7124 that fix, so these pin the behaviour both models now share.
 *
 * The model snapshot cannot see any of this - it covers which controls a device
 * is given, not how a reading is turned into a value.
 */

// aa19 status frames carrying a govee air quality reading
const QUALITY_EXCELLENT = 'qhkAAAEAAAAAAAAAAAAAAAAAALI='
const QUALITY_POOR = 'qhkAAAQAAAAAAAAAAAAAAAAAALc='
const QUALITY_NONSENSE = 'qhkAAAkAAAAAAAAAAAAAAAAAALo='

function build(model) {
  const accessory = makeAccessory(model)
  const device = new devicePurifierH7123(makePlatform(), accessory)
  device.accessory = accessory
  return device
}

describe.each(['H7123', 'H7124'])('air quality on the %s', (model) => {
  beforeEach(() => {
    resetReportedUnknowns()
  })

  it('maps the worst govee reading onto the value HomeKit uses for poor', () => {
    const device = build(model)
    device.externalUpdate({ commands: [QUALITY_POOR], source: 'AWS' })

    expect(device.cacheAir).toBe(5)
    expect(device.airService.getCharacteristic('AirQuality').value).toBe(5)
  })

  it('names that reading in the log rather than logging undefined', () => {
    const device = build(model)
    device.externalUpdate({ commands: [QUALITY_POOR], source: 'AWS' })

    const logged = device.accessory.log.messages().join(' ')
    expect(logged).toContain('poor')
    expect(logged).not.toContain('undefined')
  })

  it('remembers the reading, so an unchanged one is not logged twice', () => {
    const device = build(model)
    device.externalUpdate({ commands: [QUALITY_EXCELLENT], source: 'AWS' })
    const afterFirst = device.accessory.log.calls.length

    device.externalUpdate({ commands: [QUALITY_EXCELLENT], source: 'AWS' })

    expect(device.accessory.log.calls.length).toBe(afterFirst)
  })

  it('never sends HomeKit a value outside the range it accepts', () => {
    const device = build(model)
    device.externalUpdate({ commands: [QUALITY_NONSENSE], source: 'AWS' })

    const value = device.airService.getCharacteristic('AirQuality').value
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThanOrEqual(5)
  })
})
