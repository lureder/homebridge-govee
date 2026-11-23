import {
  base64ToHex,
  getTwoItemPosition,
  hexToTwoItems,
  parseError,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'
import { logUnknownData } from '../utils/report-unknown.js'
import GoveeDevice from './base.js'

const FAN_SPEED_LEVELS = 12
const UI_ROLLBACK_DELAY_MS = 2000
const LOW_SPEED_SUPPRESS_MS = 3000

const POWER_ON_CODE = 'MwEBAAAAAAAAAAAAAAAAAAAAADM='
const POWER_OFF_CODE = 'MwEAAAAAAAAAAAAAAAAAAAAAADI='

export default class extends GoveeDevice {
  constructor(platform, accessory) {
    super(platform, accessory)

    this.hapErr = platform.api.hap.HapStatusError
    this._suppressLowUntil = 0

    // This implementation intentionally exposes a fan only: no night-light
    // service, brightness, hue, or saturation controls.
    this.hideLight = true

    this.speedCodes = {
      1: 'MwUBAQAAAAAAAAAAAAAAAAAAADY=',
      2: 'MwUBAgAAAAAAAAAAAAAAAAAAADU=',
      3: 'MwUBAwAAAAAAAAAAAAAAAAAAADQ=',
      4: 'MwUBBAAAAAAAAAAAAAAAAAAAADM=',
      5: 'MwUBBQAAAAAAAAAAAAAAAAAAADI=',
      6: 'MwUBBgAAAAAAAAAAAAAAAAAAADE=',
      7: 'MwUBBwAAAAAAAAAAAAAAAAAAADA=',
      8: 'MwUBCAAAAAAAAAAAAAAAAAAAAD8=',
      9: 'MwUBCQAAAAAAAAAAAAAAAAAAAD4=',
      10: 'MwUBCgAAAAAAAAAAAAAAAAAAAD0=',
      11: 'MwUBCwAAAAAAAAAAAAAAAAAAADw=',
      12: 'MwUBDAAAAAAAAAAAAAAAAAAAADs=',
    }

    // Remove any old original Fan service.
    const legacyFan = this.accessory.getService(this.hapServ.Fan)
    if (legacyFan) {
      this.accessory.removeService(legacyFan)
    }

    // The H7105 is exposed as a fan only. Remove a previously cached
    // Lightbulb service so old HomeKit accessories do not retain the light.
    const lightService = this.accessory.getService(this.hapServ.Lightbulb)
    if (lightService) {
      this.accessory.removeService(lightService)
    }

    // Rebuild the Fanv2 service if it was cached with incompatible
    // RotationSpeed properties.
    const existingService = this.accessory.getService(this.hapServ.Fanv2)
    if (existingService) {
      const { props } = existingService.getCharacteristic(this.hapChar.RotationSpeed)
      if (props.unit === 'percentage' || props.maxValue !== 100) {
        this.accessory.removeService(existingService)
      }
    }

    this.service =
      this.accessory.getService(this.hapServ.Fanv2) ||
      this.accessory.addService(this.hapServ.Fanv2)

    this.charActive = this.service.getCharacteristic(this.hapChar.Active)
    this.charRotationSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed)

    this.charActive.onSet(value => this.internalStateUpdate(value))
    this.charRotationSpeed
      .setProps({
        minValue: 0,
        maxValue: 100,
        minStep: 1,
        unit: 'unitless',
      })
      .onSet(value => this.internalSpeedUpdate(value))

    this.cacheState = this.charActive.value ? 'on' : 'off'
    this.cacheSpeedPct = Number(this.charRotationSpeed.value) || 0

    // Restore the device's 12-step bucket from HomeKit's persisted percentage.
    this._lastBucket = this.speedPctToBucket(this.cacheSpeedPct)

    platform.log(
      '[%s] %s %s.',
      accessory.displayName,
      platformLang.devInitOpts,
      JSON.stringify({ fanOnly: true })
    )
  }

  speedPctToBucket(value) {
    const pct = Math.max(0, Math.min(100, Number(value) || 0))
    if (pct === 0) {
      return 0
    }

    return Math.max(
      1,
      Math.min(FAN_SPEED_LEVELS, Math.ceil(pct / (100 / FAN_SPEED_LEVELS)))
    )
  }

  bucketToSpeedPct(bucket) {
    const level = Math.max(0, Math.min(FAN_SPEED_LEVELS, Number(bucket) || 0))
    if (level === 0) {
      return 0
    }

    return Math.min(100, Math.ceil(level * (100 / FAN_SPEED_LEVELS)))
  }

  handleUpdateError(err, rollback) {
    this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

    if (rollback) {
      setTimeout(rollback, UI_ROLLBACK_DELAY_MS)
    }

    throw new this.hapErr(-70402)
  }

  async internalStateUpdate(value) {
    const newState = value ? 'on' : 'off'

    if (this.cacheState === newState) {
      return
    }

    try {
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: value ? POWER_ON_CODE : POWER_OFF_CODE,
      })

      this.cacheState = newState
    } catch (err) {
      this.handleUpdateError(err, () => {
        this.charActive.updateValue(this.cacheState === 'on' ? 1 : 0)
      })
    }
  }

  async internalSpeedUpdate(value) {
    const pct = Math.max(0, Math.min(100, Number(value) || 0))

    try {
      // A slider value of 0 is the fan-off command.
      if (pct === 0) {
        if (this.cacheState !== 'off' || this.cacheSpeedPct !== 0) {
          await this.platform.sendDeviceUpdate(this.accessory, {
            cmd: 'ptReal',
            value: POWER_OFF_CODE,
          })

          this.cacheState = 'off'
          this.cacheSpeedPct = 0

          this.charActive.updateValue(0)
          this.charRotationSpeed.updateValue(0)

          // Ignore the low-speed status echo that can follow the off command.
          this._suppressLowUntil = Date.now() + LOW_SPEED_SUPPRESS_MS
        }
        return
      }

      const bucket = this.speedPctToBucket(pct)

      if (this._lastBucket !== bucket || this.cacheState !== 'on') {
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'ptReal',
          value: this.speedCodes[bucket],
        })

        this._lastBucket = bucket
        this.cacheState = 'on'
        this.cacheSpeedPct = pct

        this.charActive.updateValue(1)
        // Do not quantize the slider after a user-selected value is sent.
        this.accessory.log(`${platformLang.curSpeed} [${bucket}]`)
      }
    } catch (err) {
      this.handleUpdateError(err, () => {
        this.charRotationSpeed.updateValue(this.cacheSpeedPct)
        this.charActive.updateValue(this.cacheState === 'on' ? 1 : 0)
      })
    }
  }

  parseCommand(command) {
    const hexString = base64ToHex(command)
    const hexParts = hexToTwoItems(hexString)

    if (getTwoItemPosition(hexParts, 1) !== 'aa') {
      return null
    }

    return {
      hexString,
      hexParts,
      deviceFunction: `${getTwoItemPosition(hexParts, 2)}${getTwoItemPosition(hexParts, 3)}`,
    }
  }

  externalUpdate(params) {
    // Power-state reports update the Active characteristic only. They do not
    // change the speed slider; the fan can be switched off independently.
    if (params.state && params.state !== this.cacheState) {
      this.cacheState = params.state
      this.charActive.updateValue(this.cacheState === 'on' ? 1 : 0)
    }

    for (const command of params.commands || []) {
      const parsed = this.parseCommand(command)
      if (!parsed) {
        continue
      }

      const { hexString, hexParts, deviceFunction } = parsed

      if (getTwoItemPosition(hexParts, 2) === '08') {
        const dev = hexString.substring(4, hexString.length - 24)
        this.accessory.context.sensorAttached = dev !== '000000000000'
        continue
      }

      switch (deviceFunction) {
        case '0501': {
          const newSpeedHex = getTwoItemPosition(hexParts, 4)
          const newSpeedBucket = Number.parseInt(newSpeedHex, 16)

          if (
            this._suppressLowUntil &&
            Date.now() < this._suppressLowUntil &&
            newSpeedBucket <= 1
          ) {
            this._suppressLowUntil = 0
            break
          }

          if (newSpeedBucket === 0) {
            if (this.cacheState !== 'off' || this.cacheSpeedPct !== 0) {
              this.cacheState = 'off'
              this.cacheSpeedPct = 0
              this.charActive.updateValue(0)
              this.charRotationSpeed.updateValue(0)
            }
            break
          }

          // Matching buckets are usually echoes/state dumps. Preserve the
          // exact percentage selected in HomeKit. A different bucket means
          // the speed was changed outside HomeKit, so reflect that change.
          if (newSpeedBucket !== this._lastBucket) {
            this._lastBucket = newSpeedBucket
            this.cacheSpeedPct = this.bucketToSpeedPct(newSpeedBucket)
            this.charRotationSpeed.updateValue(this.cacheSpeedPct)
            this.accessory.log(`${platformLang.curSpeed} [${newSpeedBucket}]`)
          }
          break
        }

        case '0500':
          // No Auto mode: this implementation deliberately exposes 12 speeds.
          break

        default:
          logUnknownData(this.accessory, {
            kind: 'status',
            source: params.source,
            raw: command,
            hex: hexString,
          })
          break
      }
    }
  }
}
