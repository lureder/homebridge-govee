import { Buffer } from 'node:buffer'

import { beforeEach, describe, expect, it } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import { resetReportedUnknowns } from '../utils/report-unknown.js'
import deviceKettle from './kettle.js'

/**
 * What a kettle says when it first connects.
 *
 * On startup an H7171 sends nine status frames in a row, five of them listing
 * the temperature each preset is set to. None of them was understood, so every
 * one was reported as an "unrecognised scene" - nine alarming lines about
 * scenes, on a kettle, for a device that had in fact been set up correctly.
 * The owner reasonably read it as the kettle having failed to be recognised
 * (#1337).
 *
 * These are the exact frames from that report.
 */

// aa 05 <slot> <degrees F> - the five presets
const PRESETS = [
  'qgUB1AAAAAAAAAAAAAAAAAAAAHo=', // slot 1, 0xd4 = 212F
  'qgUC1AAAAAAAAAAAAAAAAAAAAHk=', // slot 2, 0xd4 = 212F
  'qgUDtAAAAAAAAAAAAAAAAAAAABg=', // slot 3, 0xb4 = 180F
  'qgUEwwAAAAAAAAAAAAAAAAAAAGg=', // slot 4, 0xc3 = 195F
  'qgUFzQAAAAAAAAAAAAAAAAAAAGc=', // slot 5, 0xcd = 205F
]

// the other startup frames, contents not worked out
const OTHER_STARTUP = [
  'qh8IAQAAAAAAAAAAAAAAAAAAALw=', // aa 1f 08 01
  'qh8GAQAAAAAAAAAAAAAAAAAAALI=', // aa 1f 06 01
  'qhcBAIAAAAAAAAAAAAAAAAAAADw=', // aa 17 01 00 80
  'qhkAAAAAAAAAAAAAAAAAAAAAALM=', // aa 19 00
]

function makeKettle() {
  const platform = makePlatform()
  const accessory = makeAccessory('H7171')
  const reported = []
  const logged = []
  accessory.logWarn = msg => reported.push(String(msg))
  accessory.log = msg => logged.push(String(msg))
  const device = new deviceKettle(platform, accessory)
  return { device, reported, logged }
}

function receive(device, commands) {
  device.externalUpdate({ source: 'AWS', commands })
}

describe('a kettle reporting its state on startup', () => {
  // an unknown payload is only reported once per session, so without this the
  // tests below would pass or fail depending on which ran first
  beforeEach(() => {
    resetReportedUnknowns()
  })

  it('says nothing about the preset temperatures', () => {
    const { device, reported } = makeKettle()

    receive(device, PRESETS)

    expect(reported).toHaveLength(0)
  })

  it('says nothing about the other startup frames either', () => {
    const { device, reported } = makeKettle()

    receive(device, OTHER_STARTUP)

    expect(reported).toHaveLength(0)
  })

  it('stays quiet across the whole run the owner saw', () => {
    const { device, reported } = makeKettle()

    receive(device, [...OTHER_STARTUP.slice(0, 2), ...PRESETS, ...OTHER_STARTUP.slice(2)])

    expect(reported).toHaveLength(0)
  })

  it('still reports something genuinely unrecognised, so the reporting is not just switched off', () => {
    const { device, reported } = makeKettle()

    // a made-up frame with a valid shape but a command the kettle never sends
    receive(device, [Buffer.from('aa9901000000000000000000000000000000002b', 'hex').toString('base64')])

    expect(reported).toHaveLength(1)
  })

  it('does not call a kettle status frame a scene', () => {
    // "unrecognised scene" sent the owner looking for a HomeKit scene problem
    const { device, reported } = makeKettle()

    receive(device, [Buffer.from('aa9901000000000000000000000000000000002b', 'hex').toString('base64')])

    expect(reported[0]).not.toMatch(/scene/)
  })

  it('puts the preset temperatures in the normal log, where they can be seen', () => {
    const { device, logged } = makeKettle()

    receive(device, PRESETS)

    expect(logged).toHaveLength(5)
    expect(logged[0]).toBe('preset 1 is set to 212°F [100°C]')
    expect(logged[2]).toBe('preset 3 is set to 180°F [82°C]')
  })

  it('logs each preset once, however often the kettle repeats itself', () => {
    // Nothing says a firmware will not re-send these on a timer, and five lines
    // every few minutes would be worse than the noise this replaced
    const { device, logged } = makeKettle()

    receive(device, PRESETS)
    receive(device, PRESETS)
    receive(device, PRESETS)

    expect(logged).toHaveLength(5)
  })

  it('logs a preset again when its temperature actually changes', () => {
    const { device, logged } = makeKettle()

    receive(device, [PRESETS[2]]) // slot 3 at 180F
    // slot 3 changed to 175F: aa 05 03 af
    receive(device, [Buffer.from('aa0503af00000000000000000000000000000003', 'hex').toString('base64')])

    expect(logged).toHaveLength(2)
    expect(logged[1]).toContain('175°F')
  })

  it('still reacts to a mode change, which shares the same command byte', () => {
    // aa 05 00 <mode> is a mode change, not a preset - the slot byte is the
    // only thing separating them, so the preset branch must not swallow it
    const { device, reported } = makeKettle()

    receive(device, [Buffer.from('aa050002000000000000000000000000000000ad', 'hex').toString('base64')])

    expect(reported).toHaveLength(0)
  })
})

/**
 * The water temperature tile.
 *
 * This kettle had one before and it was taken away again (6b5bb46): it was
 * added at startup and then nothing ever put a new value in it, so owners were
 * left with a tile frozen at whatever it started on. A number that never moves
 * cannot be told apart from a real reading, which makes it worse than no tile.
 *
 * So the tile only appears once there is a genuine reading to put in it, and
 * every reading after that has to reach it. The frame layout is unconfirmed,
 * so a figure that is not a plausible water temperature must leave the tile
 * alone rather than show something wrong.
 */

// aa 10 01 <hundredths of a degree fahrenheit>
const BOILING = 'qhABUtAAAAAAAAAAAAAAAAAAADk=' // 212F
const WARM = 'qhABQ5QAAAAAAAAAAAAAAAAAAGw=' // 173F
const COLD = 'qhABGpAAAAAAAAAAAAAAAAAAADE=' // 68F
const NOT_A_TEMPERATURE = 'qhABAAAAAAAAAAAAAAAAAAAAALs=' // reads as 0F

describe('the kettle water temperature', () => {
  beforeEach(() => {
    resetReportedUnknowns()
  })

  it('has no tile before a reading has arrived', () => {
    const { device } = makeKettle()

    expect(device.serviceTemp).toBeFalsy()
  })

  it('adds the tile once there is a real reading for it', () => {
    const { device } = makeKettle()

    receive(device, [BOILING])

    expect(device.serviceTemp).toBeTruthy()
  })

  it('shows the reading in celsius', () => {
    const { device } = makeKettle()

    receive(device, [BOILING])

    expect(device.serviceTemp.getCharacteristic('CurrentTemperature').value).toBe(100)
  })

  it('keeps the tile up to date as the water heats', () => {
    // the exact failure that had the tile removed last time
    const { device } = makeKettle()

    receive(device, [COLD])
    expect(device.serviceTemp.getCharacteristic('CurrentTemperature').value).toBe(20)

    receive(device, [WARM])
    expect(device.serviceTemp.getCharacteristic('CurrentTemperature').value).toBe(78)

    receive(device, [BOILING])
    expect(device.serviceTemp.getCharacteristic('CurrentTemperature').value).toBe(100)
  })

  it('logs a reading once rather than on every repeat of it', () => {
    const { device, logged } = makeKettle()

    receive(device, [BOILING])
    receive(device, [BOILING])
    receive(device, [BOILING])

    expect(logged).toHaveLength(1)
  })

  it('shows nothing when the frame does not hold a water temperature', () => {
    const { device, logged } = makeKettle()

    receive(device, [NOT_A_TEMPERATURE])

    expect(device.serviceTemp).toBeFalsy()
    expect(logged).toHaveLength(0)
  })

  it('does not call that frame unrecognised, because it is recognised', () => {
    const { device, reported } = makeKettle()

    receive(device, [NOT_A_TEMPERATURE])

    expect(reported).toHaveLength(0)
    expect(device.accessory.logDebug.messages().join(' ')).toContain('no temperature read')
  })
})
