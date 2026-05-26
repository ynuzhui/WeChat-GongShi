const assert = require('assert')
const worktime = require('../utils/worktime')

const previousWx = global.wx
const previousPage = global.Page
const backing = {}
let capturedPage = null

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function createPageInstance(pageDefinition) {
  return Object.assign({}, pageDefinition, {
    data: clone(pageDefinition.data),
    setData(patch, callback) {
      Object.keys(patch).forEach((key) => {
        if (key.indexOf('.') === -1) {
          this.data[key] = patch[key]
          return
        }
        const parts = key.split('.')
        let target = this.data
        for (let index = 0; index < parts.length - 1; index += 1) {
          target = target[parts[index]]
        }
        target[parts[parts.length - 1]] = patch[key]
      })
      if (callback) {
        callback()
      }
    }
  })
}

let store = worktime.createDefaultStore()
store = worktime.setEntry(store, '2026-05-16', { type: 'work', start: '11:00', end: '17:00' })
store = worktime.setEntry(store, '2026-05-17', { type: 'work', start: '09:20', end: '17:00' })
store = worktime.setEntry(store, '2026-05-20', { type: 'rest' })
store = worktime.setEntry(store, '2026-05-22', { type: 'leave' })

backing[worktime.STORAGE_KEY] = store

global.wx = {
  env: {
    USER_DATA_PATH: '/tmp'
  },
  getStorageSync(key) {
    return backing[key] || ''
  },
  setStorageSync(key, value) {
    backing[key] = value
  },
  removeStorageSync(key) {
    delete backing[key]
  },
  setClipboardData(options) {
    backing.__clipboard = options.data
    if (options.success) {
      options.success()
    }
  },
  showToast(options) {
    backing.__lastToast = options
  },
  showModal(options) {
    backing.__lastModal = options
    if (options.success) {
      options.success({ confirm: true })
    }
  },
  getFileSystemManager() {
    return {
      writeFile(options) {
        backing.__writtenFile = {
          filePath: options.filePath,
          data: options.data,
          encoding: options.encoding
        }
        if (options.success) {
          options.success()
        }
      },
      readFile() {}
    }
  }
}

global.Page = (pageDefinition) => {
  capturedPage = pageDefinition
}

delete require.cache[require.resolve('../pages/profile/profile.js')]
require('../pages/profile/profile.js')

try {
  const page = createPageInstance(capturedPage)
  page.onLoad()
  page.setData({
    currentMonthKey: '2026-05',
    exportStart: '2026-05-16',
    exportEnd: '2026-05-22'
  }, () => page.refresh())

  assert.deepStrictEqual(page.data.exportLines, [
    '5.16日  11:00-17:00   -1.5',
    '5.17日  全天',
    '5.20日  本休',
    '5.22日  调休'
  ])
  assert.strictEqual(page.data.exportText, page.data.exportLines.join('\n'))

  page.copyExportText()
  assert.strictEqual(backing.__clipboard, page.data.exportText)

  page.copyExportDeltaText()
  assert.strictEqual(backing.__clipboard, [
    '5.16日  -1.5',
    '5.17日  全天',
    '5.20日  本休',
    '5.22日  调休'
  ].join('\n'))

  assert.deepStrictEqual(page.data.timePickerRange[1], ['00', '30'])
  page.startAddPreset()
  assert.strictEqual(page.data.presetForm.start, '09:30')
  assert.strictEqual(page.data.presetForm.end, '17:00')
  assert.deepStrictEqual(page.data.presetStartTimePickerValue, [9, 1])
  page.onPresetStartChange({ detail: { value: [8, 1] } })
  page.onPresetEndChange({ detail: { value: [20, 0] } })
  assert.strictEqual(page.data.presetForm.start, '08:30')
  assert.strictEqual(page.data.presetForm.end, '20:00')
  page.savePreset()
  const savedPreset = page.data.store.settings.presets.find((preset) => preset.id === page.data.selectedPresetId)
  assert.strictEqual(savedPreset.start, '08:30')
  assert.strictEqual(savedPreset.end, '20:00')

  page.exportBackupFile()
  assert.strictEqual(page.data.exportFilePath, '')
  assert.ok(backing.__writtenFile.filePath.indexOf('工时清单备份-') !== -1)
  assert.ok(!/:\d{2}|T|Z/.test(backing.__writtenFile.filePath))

  console.log('profile page tests passed')
} finally {
  global.wx = previousWx
  global.Page = previousPage
}
