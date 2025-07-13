export default class {
  constructor(api) {
    this.uuids = {
      /* deprecated
      bluetooth: 'E964F001-079E-48FF-8F27-9C2605A29F52'
      bluetoothConn: 'E964F002-079E-48FF-8F27-9C2605A29F52'
      musicMode: 'E964F003-079E-48FF-8F27-9C2605A29F52'
      */
      colourMode: 'E964F004-079E-48FF-8F27-9C2605A29F52',
      musicMode: 'E964F005-079E-48FF-8F27-9C2605A29F52',
      musicModeTwo: 'E964F006-079E-48FF-8F27-9C2605A29F52',
      scene: 'E964F007-079E-48FF-8F27-9C2605A29F52',
      sceneTwo: 'E964F008-079E-48FF-8F27-9C2605A29F52',
      diyMode: 'E964F009-079E-48FF-8F27-9C2605A29F52',
      diyModeTwo: 'E964F010-079E-48FF-8F27-9C2605A29F52',
      sceneThree: 'E964F011-079E-48FF-8F27-9C2605A29F52',
      sceneFour: 'E964F012-079E-48FF-8F27-9C2605A29F52',
      diyModeThree: 'E964F013-079E-48FF-8F27-9C2605A29F52',
      diyModeFour: 'E964F014-079E-48FF-8F27-9C2605A29F52',
      segmented: 'E964F015-079E-48FF-8F27-9C2605A29F52',
      segmentedTwo: 'E964F016-079E-48FF-8F27-9C2605A29F52',
      segmentedThree: 'E964F017-079E-48FF-8F27-9C2605A29F52',
      segmentedFour: 'E964F018-079E-48FF-8F27-9C2605A29F52',
      videoMode: 'E964F019-079E-48FF-8F27-9C2605A29F52',
      videoModeTwo: 'E964F020-079E-48FF-8F27-9C2605A29F52',
      nightLight: 'E964F021-079E-48FF-8F27-9C2605A29F52',
      displayLight: 'E964F022-079E-48FF-8F27-9C2605A29F52',
    }
    const uuids = this.uuids

    this.ColourMode = class extends api.hap.Characteristic {
      constructor() {
        super('Colour Mode', uuids.colourMode)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.MusicMode = class extends api.hap.Characteristic {
      constructor() {
        super('Music Mode', uuids.musicMode)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.MusicModeTwo = class extends api.hap.Characteristic {
      constructor() {
        super('Music Mode 2', uuids.musicModeTwo)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.Scene = class extends api.hap.Characteristic {
      constructor() {
        super('Scene', uuids.scene)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.SceneTwo = class extends api.hap.Characteristic {
      constructor() {
        super('Scene 2', uuids.sceneTwo)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.SceneThree = class extends api.hap.Characteristic {
      constructor() {
        super('Scene 3', uuids.sceneThree)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.SceneFour = class extends api.hap.Characteristic {
      constructor() {
        super('Scene 4', uuids.sceneFour)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.DiyMode = class extends api.hap.Characteristic {
      constructor() {
        super('DIY Mode', uuids.diyMode)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.DiyModeTwo = class extends api.hap.Characteristic {
      constructor() {
        super('DIY Mode 2', uuids.diyModeTwo)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.DiyModeThree = class extends api.hap.Characteristic {
      constructor() {
        super('DIY Mode 3', uuids.diyModeThree)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.DiyModeFour = class extends api.hap.Characteristic {
      constructor() {
        super('DIY Mode 4', uuids.diyModeFour)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.Segmented = class extends api.hap.Characteristic {
      constructor() {
        super('Segmented', uuids.segmented)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.SegmentedTwo = class extends api.hap.Characteristic {
      constructor() {
        super('Segmented 2', uuids.segmentedTwo)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.SegmentedThree = class extends api.hap.Characteristic {
      constructor() {
        super('Segmented 3', uuids.segmentedThree)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.SegmentedFour = class extends api.hap.Characteristic {
      constructor() {
        super('Segmented 4', uuids.segmentedFour)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.VideoMode = class extends api.hap.Characteristic {
      constructor() {
        super('Video Mode', uuids.videoMode)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.VideoModeTwo = class extends api.hap.Characteristic {
      constructor() {
        super('Video Mode 2', uuids.videoModeTwo)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.NightLight = class extends api.hap.Characteristic {
      constructor() {
        super('Night Light', uuids.nightLight)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.DisplayLight = class extends api.hap.Characteristic {
      constructor() {
        super('Display Light', uuids.displayLight)
        this.setProps({
          format: api.hap.Formats.BOOL,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.PAIRED_WRITE, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.ColourMode.UUID = this.uuids.colourMode
    this.MusicMode.UUID = this.uuids.musicMode
    this.MusicModeTwo.UUID = this.uuids.musicModeTwo
    this.Scene.UUID = this.uuids.scene
    this.SceneTwo.UUID = this.uuids.sceneTwo
    this.SceneThree.UUID = this.uuids.sceneThree
    this.SceneFour.UUID = this.uuids.sceneFour
    this.DiyMode.UUID = this.uuids.diyMode
    this.DiyModeTwo.UUID = this.uuids.diyModeTwo
    this.DiyModeThree.UUID = this.uuids.diyModeThree
    this.DiyModeFour.UUID = this.uuids.diyModeFour
    this.Segmented.UUID = this.uuids.segmented
    this.SegmentedTwo.UUID = this.uuids.segmentedTwo
    this.SegmentedThree.UUID = this.uuids.segmentedThree
    this.SegmentedFour.UUID = this.uuids.segmentedFour
    this.VideoMode.UUID = this.uuids.videoMode
    this.VideoModeTwo.UUID = this.uuids.videoModeTwo
    this.NightLight.UUID = this.uuids.nightLight
    this.DisplayLight.UUID = this.uuids.displayLight
  }
}
