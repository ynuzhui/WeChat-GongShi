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

global.wx = {
  getStorageSync(key) {
    return backing[key] || ''
  },
  setStorageSync(key, value) {
    backing[key] = value
  },
  removeStorageSync(key) {
    delete backing[key]
  },
  showToast(options) {
    backing.__lastToast = options
  },
  showModal(options) {
    backing.__lastModal = options
    if (options.success) {
      options.success({ confirm: true })
    }
  }
}
global.Page = (pageDefinition) => {
  capturedPage = pageDefinition
}

delete require.cache[require.resolve('../pages/record/record.js')]
require('../pages/record/record.js')

try {
  const page = createPageInstance(capturedPage)
  page.onLoad({ date: '2026-05-24' })
  page.onShow()

  assert.strictEqual(page.data.selectedDate, '2026-05-24')
  assert.strictEqual(page.data.selectedHasRecord, false)
  assert.strictEqual(page.data.isDraftDirty, false)
  assert.strictEqual(page.data.draftStateLabel, '草稿')
  assert.strictEqual(page.data.isManualEditorVisible, false)
  assert.strictEqual(worktime.countRecords(backing[worktime.STORAGE_KEY]), 0)
  assert.ok(page.data.presets.length > 0)
  assert.deepStrictEqual(page.data.timePickerRange[1], ['00', '30'])

  page.useManualMode()
  assert.strictEqual(page.data.isManualEditorVisible, true)
  assert.strictEqual(page.data.selectedEntry.type, worktime.DAY_TYPES.WORK)
  assert.strictEqual(page.data.selectedEntry.presetId, undefined)
  assert.strictEqual(page.data.selectedEntry.start, '09:30')
  assert.deepStrictEqual(page.data.startTimePickerValue, [9, 1])

  page.onStartChange({ detail: { value: [10, 0] } })
  assert.strictEqual(page.data.selectedEntry.start, '10:00')
  page.onStartChange({ detail: { value: [10, 1] } })
  assert.strictEqual(page.data.selectedEntry.start, '10:30')
  assert.strictEqual(worktime.parseTime(page.data.selectedEntry.start) % 30, 0)
  page.onStartChange({ detail: { value: [10, 0] } })
  assert.strictEqual(page.data.isDraftDirty, true)
  assert.strictEqual(page.data.draftStateLabel, '未保存')
  assert.strictEqual(page.data.isManualEditorVisible, true)
  assert.strictEqual(worktime.countRecords(backing[worktime.STORAGE_KEY]), 0)

  page.saveDraft()
  assert.strictEqual(page.data.selectedHasRecord, true)
  assert.strictEqual(page.data.isDraftDirty, false)
  assert.strictEqual(page.data.draftStateLabel, '已记')
  assert.strictEqual(page.data.isManualEditorVisible, true)
  assert.strictEqual(worktime.countRecords(backing[worktime.STORAGE_KEY]), 1)
  assert.strictEqual(worktime.formatTimeRange(worktime.normalizeStore(backing[worktime.STORAGE_KEY]).months['2026-05'].entries['2026-05-24']), '10:00-17:00')

  page.onPresetPickerChange({ detail: { value: '0' } })
  assert.strictEqual(page.data.isManualEditorVisible, false)
  assert.strictEqual(page.data.selectedEntry.presetId, page.data.presets[0].id)
  assert.strictEqual(page.data.selectedEntry.note, '全天')

  page.onPresetPickerChange({ detail: { value: '1' } })
  assert.strictEqual(page.data.selectedEntry.note, '11:30-15:30')

  page.onPresetPickerChange({ detail: { value: '0' } })
  assert.strictEqual(page.data.selectedEntry.note, '全天')
  page.onNoteInput({ detail: { value: '客户会议' } })
  page.onPresetPickerChange({ detail: { value: '0' } })
  assert.strictEqual(page.data.selectedEntry.note, '客户会议')
  page.onTypeTap({ currentTarget: { dataset: { type: worktime.DAY_TYPES.REST } } })
  assert.strictEqual(page.data.selectedEntry.note, '客户会议')
  page.onNoteInput({ detail: { value: '' } })
  page.onTypeTap({ currentTarget: { dataset: { type: worktime.DAY_TYPES.LEAVE } } })
  assert.strictEqual(page.data.selectedEntry.note, '调休')
  page.onTypeTap({ currentTarget: { dataset: { type: worktime.DAY_TYPES.REST } } })
  assert.strictEqual(page.data.selectedEntry.note, '本休')
  page.onTypeTap({ currentTarget: { dataset: { type: worktime.DAY_TYPES.WORK } } })

  page.useManualMode()
  assert.strictEqual(page.data.isManualEditorVisible, true)
  assert.strictEqual(page.data.selectedEntry.presetId, undefined)

  page.onEndChange({ detail: { value: [9, 0] } })
  assert.strictEqual(page.data.isDraftDirty, true)
  assert.strictEqual(page.data.selectedWarning, '上班时间需要早于下班时间')
  page.saveDraft()
  assert.strictEqual(backing.__lastToast.icon, 'none')
  assert.strictEqual(worktime.formatTimeRange(worktime.normalizeStore(backing[worktime.STORAGE_KEY]).months['2026-05'].entries['2026-05-24']), '10:00-17:00')

  page.goNextDay()
  assert.strictEqual(backing.__lastModal.title, '放弃草稿')
  assert.strictEqual(page.data.selectedDate, '2026-05-25')

  console.log('record page tests passed')
} finally {
  global.wx = previousWx
  global.Page = previousPage
}
