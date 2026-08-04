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
