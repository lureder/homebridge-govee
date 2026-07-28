import { describe, expect, it } from 'vitest'

import { BLE_STAGE_TIMEOUTS, BLE_UPDATE_TIMEOUT } from './ble-protocol.js'

/**
 * The bug these guard against (#1328): the BLE connect timeout and the platform
 * queue timeout were both a flat 10000ms. The queue therefore killed a task at
 * the exact moment the connect gave up, and any light that connected slowly had
 * nothing left of the budget for discovering services and writing its command.
 */
describe('bLE timeout budget', () => {
  it('leaves room for every stage of an update', () => {
    const stages = BLE_STAGE_TIMEOUTS.powerOn
      + BLE_STAGE_TIMEOUTS.connect
      + BLE_STAGE_TIMEOUTS.untimedStages
      + BLE_STAGE_TIMEOUTS.write
      + BLE_STAGE_TIMEOUTS.settle

    expect(BLE_UPDATE_TIMEOUT).toBeGreaterThan(stages)
  })

  it('is not simply the connect timeout, which is what caused #1328', () => {
    expect(BLE_UPDATE_TIMEOUT).not.toBe(BLE_STAGE_TIMEOUTS.connect)
  })

  it('still has time left after the slowest possible connect', () => {
    // A connect that only just succeeds must leave enough behind to discover
    // services and send the command - otherwise a slow device is
    // indistinguishable from an unreachable one.
    const afterSlowestConnect = BLE_UPDATE_TIMEOUT
      - BLE_STAGE_TIMEOUTS.powerOn
      - BLE_STAGE_TIMEOUTS.connect

    expect(afterSlowestConnect).toBeGreaterThanOrEqual(
      BLE_STAGE_TIMEOUTS.untimedStages + BLE_STAGE_TIMEOUTS.write + BLE_STAGE_TIMEOUTS.settle,
    )
  })

  it('keeps every stage timeout positive', () => {
    Object.entries(BLE_STAGE_TIMEOUTS).forEach(([stage, ms]) => {
      expect(ms, stage).toBeGreaterThan(0)
    })
  })
})
