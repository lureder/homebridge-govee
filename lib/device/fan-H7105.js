import {
  base64ToHex,
  getTwoItemPosition,
  hexToTwoItems,
  parseError,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

const FAN_SPEED_LEVELS = 12
const UI_ROLLBACK_DELAY_MS = 2000
const LOW_SPEED_SUPPRESS_MS = 3000

const POWER_ON_CODE = 'MwEBAAAAAAAAAAAAAAAAAAAAADM='
const POWER_OFF_CODE = 'MwEAAAAAAAAAAAAAAAAAAAAAADI='

export default class FanH7105 {
  constructor(platform, accessory) {
    this.platform = platform
    this.accessory = accessory

    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service

    this._suppressLowUntil = 0
    this._lastBucket = 0 // persists the last confirmed speed bucket across power cycles

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

    this.removeLegacyServices()
    this.setupFanService()

    platform.log(
      '[%s] %s %s.',
      accessory.displayName,
      platformLang.devInitOpts,
      JSON.stringify({ fanOnly: true })
    )
  }

  removeLegacyServices() {
    const legacyFan = this.accessory.getService(this.hapServ.Fan)
    if (legacyFan) {
      this.accessory.removeService(legacyFan)
    }

    const lightService = this.accessory.getService(this.hapServ.Lightbulb)
    if (lightService) {
      this.accessory.removeService(lightService)
    }
  }

  setupFanService() {
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
      })
      .onSet(value => this.internalSpeedUpdate(value))

    this.cacheState = this.charActive.value ? 'on' : 'off'
    this.cacheSpeedPct = Number(this.charRotationSpeed.value) || 0
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

  async sendDeviceUpdate(payload) {
    await this.platform.sendDeviceUpdate(this.accessory, payload)
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
      if (newState === 'on') {
        // Always use POWER_ON_CODE for the physical power-on â€” speed codes alone
        // cannot wake the device from an off state.
        await this.sendDeviceUpdate({
          cmd: 'ptReal',
          value: POWER_ON_CODE,
        })

        this.cacheState = 'on'

        // Pre-populate the slider with the last known speed so the UI is immediately
        // correct and the echo from externalUpdate doesn't cause a visible jump.
        if (this._lastBucket > 0) {
          const restoredPct = this.bucketToSpeedPct(this._lastBucket)
          this.cacheSpeedPct = restoredPct
          this.charRotationSpeed.updateValue(restoredPct)
        }
      } else {
        await this.sendDeviceUpdate({
          cmd: 'ptReal',
          value: POWER_OFF_CODE,
        })

        this.cacheState = 'off'
        this.cacheSpeedPct = 0
        this.charRotationSpeed.updateValue(0)
        // _lastBucket is intentionally preserved so it can be restored on power-on.
      }
    } catch (err) {
      this.handleUpdateError(err, () => {
        this.charActive.updateValue(this.cacheState === 'on' ? 1 : 0)
      })
    }
  }

  async internalSpeedUpdate(value) {
    const pct = Math.max(0, Math.min(100, Number(value) || 0))

    try {
      if (pct === 0) {
        if (this.cacheState !== 'off' || this.cacheSpeedPct !== 0) {
          await this.sendDeviceUpdate({
            cmd: 'ptReal',
            value: POWER_OFF_CODE,
          })

          this.cacheState = 'off'
          this.cacheSpeedPct = 0

          this.charActive.updateValue(0)
          this.charRotationSpeed.updateValue(0)

          this._suppressLowUntil = Date.now() + LOW_SPEED_SUPPRESS_MS
        }
        return
      }

      const bucket = this.speedPctToBucket(pct)

      // Deduplicate on bucket â€” dragging within the same bucket range doesn't
      // need to resend the command.
      if (this._lastBucket !== bucket || this.cacheState !== 'on') {
        await this.sendDeviceUpdate({
          cmd: 'ptReal',
          value: this.speedCodes[bucket],
        })

        this._lastBucket = bucket
        this.cacheState = 'on'
        // Store the raw pct so externalUpdate (which returns the normalized bucket-max
        // value) will see a difference and snap the slider after device confirmation.
        this.cacheSpeedPct = pct

        this.charActive.updateValue(1)
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
      raw: command,
      hexString,
      hexParts,
      deviceFunction: `${getTwoItemPosition(hexParts, 2)}${getTwoItemPosition(hexParts, 3)}`,
    }
  }

  externalUpdate(params) {
    if (params.state && params.state !== this.cacheState) {
      this.cacheState = params.state
      this.charActive.updateValue(this.cacheState === 'on' ? 1 : 0)

      if (this.cacheState === 'off' && this.cacheSpeedPct !== 0) {
        this.cacheSpeedPct = 0
        this.charRotationSpeed.updateValue(0)
      }
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

          // Single place where the slider snaps to the bucket-max percentage,
          // after the device confirms its speed.
          const newSpeedPct = this.bucketToSpeedPct(newSpeedBucket)

          if (this.cacheSpeedPct !== newSpeedPct) {
            this._lastBucket = newSpeedBucket
            this.cacheSpeedPct = newSpeedPct
            this.charRotationSpeed.updateValue(newSpeedPct)
            this.accessory.log(`${platformLang.curSpeed} [${newSpeedBucket}]`)
          }
          break
        }

        case '0500':
          break

        default:
          this.accessory.logDebugWarn(
            `${platformLang.newScene}: [${command}] [${hexString}]`
          )
          break
      }
    }
  }
}
