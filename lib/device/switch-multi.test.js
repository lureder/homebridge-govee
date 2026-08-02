import { describe, expect, it } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import deviceSwitchDouble, { asOutlet as deviceOutletDouble } from './switch-double.js'
import deviceSwitchTriple, { asOutlet as deviceOutletTriple } from './switch-triple.js'

/**
 * These devices can be shown as either switches or outlets, chosen by the
 * owner's `showAs` setting, and both used to be a separate copy of the same
 * file. They are now one handler built twice.
 *
 * The model snapshot only covers the default settings, so it never reaches the
 * outlet side. That is what these are for.
 */

function build(Handler, model) {
  const accessory = makeAccessory(model)
  const device = new Handler(makePlatform(), accessory)
  return { device, accessory }
}

function tiles(accessory) {
  return accessory.services
    .filter(service => service.subtype)
    .map(service => ({ type: service.type, name: service.displayName, subtype: service.subtype }))
}

describe('showing a multi-outlet device as switches or outlets', () => {
  it('gives a double device two switch tiles', () => {
    const { accessory } = build(deviceSwitchDouble, 'H5082')

    expect(tiles(accessory)).toEqual([
      { type: 'Switch', name: 'Switch 1', subtype: 'switch1' },
      { type: 'Switch', name: 'Switch 2', subtype: 'switch2' },
    ])
  })

  it('gives the same device outlet tiles when asked for outlets', () => {
    const { accessory } = build(deviceOutletDouble, 'H5082')

    expect(tiles(accessory)).toEqual([
      { type: 'Outlet', name: 'Outlet 1', subtype: 'outlet1' },
      { type: 'Outlet', name: 'Outlet 2', subtype: 'outlet2' },
    ])
  })

  it('gives a triple device three switch tiles', () => {
    const { accessory } = build(deviceSwitchTriple, 'H5160')

    expect(tiles(accessory).map(tile => tile.name)).toEqual(['Switch 1', 'Switch 2', 'Switch 3'])
    expect(tiles(accessory).every(tile => tile.type === 'Switch')).toBe(true)
  })

  it('gives a triple device three outlet tiles when asked for outlets', () => {
    const { accessory } = build(deviceOutletTriple, 'H5160')

    expect(tiles(accessory).map(tile => tile.name)).toEqual(['Outlet 1', 'Outlet 2', 'Outlet 3'])
    expect(tiles(accessory).every(tile => tile.type === 'Outlet')).toBe(true)
  })

  it('clears out the tiles of the other kind when the setting is changed', () => {
    // Without this the old pair sits alongside the new one, as tiles that no
    // longer do anything (#1323)
    const accessory = makeAccessory('H5082')
    void new deviceSwitchDouble(makePlatform(), accessory)
    expect(tiles(accessory).every(tile => tile.type === 'Switch')).toBe(true)

    void new deviceOutletDouble(makePlatform(), accessory)

    expect(tiles(accessory).every(tile => tile.type === 'Outlet')).toBe(true)
    expect(tiles(accessory)).toHaveLength(2)
  })
})
