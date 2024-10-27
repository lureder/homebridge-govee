import {
  base64ToHex,
  generateCodeFromHexValues,
  getTwoItemPosition,
  hexToTwoItems,
  parseError,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform

    // Set up variables from the accessory
    this.accessory = accessory

    // Codes etc
    this.speedCodes = {
      0: 'MwEAAAAAAAAAAAAAAAAAAAAAADI=',  // Off
      11: 'MwUBAQAAAAAAAAAAAAAAAAAAADY=',
      22: 'MwUBAgAAAAAAAAAAAAAAAAAAADU=',
      33: 'MwUBAwAAAAAAAAAAAAAAAAAAADQ=',
      44: 'MwUBBAAAAAAAAAAAAAAAAAAAADM=',
      55: 'MwUBBQAAAAAAAAAAAAAAAAAAADI=',
      66: 'MwUBBgAAAAAAAAAAAAAAAAAAADE=',
      77: 'MwUBBwAAAAAAAAAAAAAAAAAAADA=',
      88: 'MwUBCAAAAAAAAAAAAAAAAAAAAD8=',
    }

    // Remove any old original Fan services
    if (this.accessory.getService(this.hapServ.Fan)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Fan))
    }

    // Add the fan service for the fan if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Fanv2) || this.accessory.addService(this.hapServ.Fanv2)

    // Add the set handler to the fan on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async value => this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value ? 'on' : 'off'

    // Add the set handler to the fan rotation speed characteristic
    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({
        minStep: 1,
        minValue: 0,
        maxValue: 100,
      })
      .onSet(async value => this.internalSpeedUpdate(value))
    this.cacheSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value
    this.cacheMode = 'manual'

    // Output the customized options to the log
    const opts = JSON.stringify({})
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (this.cacheState === newValue) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: value ? 'MwEBAAAAAAAAAAAAAAAAAAAAADM=' : 'MwEAAAAAAAAAAAAAAAAAAAAAADI=',
      })

      // Cache the new state and log if appropriate
      if (this.cacheState !== newValue) {
        this.cacheState = newValue
        this.accessory.log(`${platformLang.curState} [${newValue}]`)
      }
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on' ? 1 : 0)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalSpeedUpdate(value) {
    try {
        // Map the slider percentage to the closest fan speed
        let mappedValue;
        if (value === 0) {
            mappedValue = 0;  // Off
        } else if (value <= 25) {
            mappedValue = 22; // 25%
        } else if (value <= 50) {
            mappedValue = 44; // 50%
        } else if (value <= 75) {
            mappedValue = 66; // 75%
        } else {
            mappedValue = 88; // 100%
        }

        // Check if the mapped value is the same as the cached speed
        if (this.cacheSpeed === mappedValue) {
            return;
        }

        const codeToSend = this.speedCodes[mappedValue];
        await this.platform.sendDeviceUpdate(this.accessory, {
            cmd: 'ptReal',
            value: codeToSend,
        });

        // Cache the new state and log if appropriate
        this.cacheSpeed = mappedValue;
        this.accessory.log(`${platformLang.curSpeed} [${mappedValue}%]`);
    } catch (err) {
        // Catch any errors during the process
        this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

        // Throw a 'no response' error and set a timeout to revert this after 2 seconds
        setTimeout(() => {
            this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
        }, 2000)
        throw new this.hapErr(-70402)
    }
}

  externalUpdate(params) {
    // Update the active characteristic
    if (params.state && params.state !== this.cacheState) {
      this.cacheState = params.state
      this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on' ? 1 : 0)
      this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
    }

    // Check for some other scene/mode change
    (params.commands || []).forEach((command) => {
      const hexString = base64ToHex(command)
      const hexParts = hexToTwoItems(hexString)

      // Return now if not a device query update code
      if (getTwoItemPosition(hexParts, 1) !== 'aa') {
        return
      }

      if (getTwoItemPosition(hexParts, 2) === '08') {
        // Sensor Attached?
        const dev = hexString.substring(4, hexString.length - 24)
        this.accessory.context.sensorAttached = dev !== '000000000000'
        return
      }

      const deviceFunction = `${getTwoItemPosition(hexParts, 2)}${getTwoItemPosition(hexParts, 3)}`

      switch (deviceFunction) {
        case '0501': {
          // Fan speed
          const newSpeed = getTwoItemPosition(hexParts, 4)
          const newSpeedInt = Number.parseInt(newSpeed, 10) * 11
          this.cacheMode = 'manual'
          if (this.cacheSpeed !== newSpeedInt) {
            this.cacheSpeed = newSpeedInt
            this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
            this.accessory.log(`${platformLang.curSpeed} [${this.cacheSpeed}%]`)
          }
          break
        }
        default:
          this.accessory.logDebugWarn(`${platformLang.newScene}: [${command}] [${hexString}]`)
          break
      }
    })
  }
}
