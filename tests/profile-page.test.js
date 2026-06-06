const assert = require('assert')
const fs = require('fs')
const path = require('path')
const worktime = require('../utils/worktime')

const previousWx = global.wx
const previousPage = global.Page
const previousSetTimeout = global.setTimeout
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
  showLoading(options) {
    backing.__loadingShown = options
  },
  hideLoading() {
    backing.__hideLoadingCount = (backing.__hideLoadingCount || 0) + 1
  },
  getFileSystemManager() {
    return {
      writeFile(options) {
        backing.__writeCount = (backing.__writeCount || 0) + 1
        backing.__writtenFile = {
          filePath: options.filePath,
          data: options.data,
          encoding: options.encoding
        }
        if (backing.__writeShouldFail) {
          if (options.fail) {
            options.fail()
          }
          return
        }
        if (options.success) {
          backing.__writeSuccessCalled = true
          options.success()
        }
      },
      access(options) {
        backing.__accessCount = (backing.__accessCount || 0) + 1
        backing.__accessedFilePath = options.path
        if (backing.__holdAccess) {
          backing.__pendingAccess = options
          return
        }
        if (backing.__accessShouldFail) {
          if (options.fail) {
            options.fail()
          }
          return
        }
        backing.__accessSuccessCalled = true
        if (options.success) {
          options.success()
        }
      },
      readFile() {}
    }
  },
  shareFileMessage(options) {
    backing.__shareCount = (backing.__shareCount || 0) + 1
    backing.__sharedFile = {
      filePath: options.filePath,
      fileName: options.fileName,
      writeSuccessBeforeShare: backing.__writeSuccessCalled === true,
      accessSuccessBeforeShare: backing.__accessSuccessCalled === true
    }
    if (options.success) {
      options.success()
    }
  }
}

global.Page = (pageDefinition) => {
  capturedPage = pageDefinition
}

global.setTimeout = (callback) => {
  backing.__timeoutCount = (backing.__timeoutCount || 0) + 1
  callback()
  return 0
}

delete require.cache[require.resolve('../pages/profile/profile.js')]
require('../pages/profile/profile.js')

try {
  const page = createPageInstance(capturedPage)
  page.onLoad()
  page.setData({
    currentMonthKey: '2026-05',
    balanceMonthKey: '2026-05',
    exportStart: '2026-05-16',
    exportEnd: '2026-05-22'
  }, () => page.refresh())

  assert.strictEqual(page.data.activeProfileTab, 'report')
  assert.deepStrictEqual(page.data.profileTabs.map((tab) => tab.key), ['report', 'presets', 'balance', 'backup'])

  const appConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8'))
  assert.deepStrictEqual(appConfig.tabBar.list.map((item) => item.iconPath), [
    'assets/tab/overview.png',
    'assets/tab/record.png',
    'assets/tab/manage.png'
  ])
  assert.deepStrictEqual(appConfig.tabBar.list.map((item) => item.selectedIconPath), [
    'assets/tab/overview-active.png',
    'assets/tab/record-active.png',
    'assets/tab/manage-active.png'
  ])
  appConfig.tabBar.list.forEach((item) => {
    ;[item.iconPath, item.selectedIconPath].forEach((iconPath) => {
      const fullPath = path.join(__dirname, '..', iconPath)
      assert.ok(fs.existsSync(fullPath), `${iconPath} should exist`)
      assert.ok(fs.statSync(fullPath).size < 40 * 1024, `${iconPath} should be smaller than 40KB`)
    })
  })

  const indexConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pages', 'index', 'index.json'), 'utf8'))
  assert.ok(!Object.values(indexConfig.usingComponents).some((value) => value === 'tdesign-miniprogram/icon/icon'))
  const indexWxml = fs.readFileSync(path.join(__dirname, '..', 'pages', 'index', 'index.wxml'), 'utf8')
  assert.ok(indexWxml.indexOf('<t-icon') === -1)
  assert.strictEqual((indexWxml.match(/bind:click="go(Prev|Next)(Month|Day)"/g) || []).length, 4)

  ;['overview', 'overview-active', 'record', 'record-active', 'manage', 'manage-active'].forEach((name) => {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets', 'tab', 'svg', `${name}.svg`)))
  })

  assert.deepStrictEqual(page.data.exportLines, [])

  page.refreshExportText()
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
  page.switchProfileTab({ currentTarget: { dataset: { tab: 'presets' } } })
  assert.strictEqual(page.data.activeProfileTab, 'presets')
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

  page.switchProfileTab({ currentTarget: { dataset: { tab: 'balance' } } })
  assert.strictEqual(page.data.activeProfileTab, 'balance')
  assert.strictEqual(page.data.balanceMonthLabel, '2026年5月')
  assert.strictEqual(page.data.balanceClosingText, '-8.5')

  page.setData({
    balanceInput: '4.5'
  })
  page.saveOpeningBalanceSetting()
  assert.strictEqual(worktime.getMonth(page.data.store, '2026-05').openingBalanceMinutes, 780)
  assert.strictEqual(page.data.balanceClosingText, '4.5')
  assert.strictEqual(page.data.openingBalanceText, '13')
  assert.strictEqual(page.data.closingBalanceText, '4.5')

  page.setData({
    balanceInput: 'abc'
  })
  page.saveOpeningBalanceSetting()
  assert.strictEqual(backing.__lastToast.title, '请输入数字')
  assert.strictEqual(worktime.getMonth(page.data.store, '2026-05').openingBalanceMinutes, 780)

  page.switchProfileTab({ currentTarget: { dataset: { tab: 'backup' } } })
  assert.strictEqual(page.data.activeProfileTab, 'backup')
  backing.__lastToast = null
  backing.__hideLoadingCount = 0
  backing.__holdAccess = true
  page.exportBackupFile()
  page.exportBackupFile()
  assert.strictEqual(backing.__writeCount, 1)
  assert.strictEqual(backing.__shareCount || 0, 0)
  assert.strictEqual(page.isExportingBackup, true)
  assert.deepStrictEqual(backing.__loadingShown, {
    title: '正在生成',
    mask: true
  })
  assert.strictEqual(backing.__accessedFilePath, backing.__writtenFile.filePath)
  backing.__holdAccess = false
  backing.__accessSuccessCalled = true
  backing.__pendingAccess.success()
  assert.strictEqual(page.data.exportFilePath, '')
  assert.ok(backing.__writtenFile.filePath.indexOf('/tmp/备份-') === 0)
  assert.ok(backing.__writtenFile.filePath.endsWith('.json'))
  assert.ok(backing.__sharedFile.fileName.indexOf('备份-') === 0)
  assert.ok(backing.__sharedFile.fileName.endsWith('.json'))
  assert.strictEqual(backing.__sharedFile.filePath, backing.__writtenFile.filePath)
  assert.strictEqual(backing.__sharedFile.writeSuccessBeforeShare, true)
  assert.strictEqual(backing.__sharedFile.accessSuccessBeforeShare, true)
  assert.strictEqual(backing.__shareCount, 1)
  assert.strictEqual(backing.__lastToast, null)
  assert.strictEqual(backing.__hideLoadingCount, 1)
  assert.strictEqual(page.isExportingBackup, false)
  assert.ok(!/:\d{2}|T|Z/.test(backing.__writtenFile.filePath))

  global.wx.shareFileMessage = (options) => {
    backing.__shareCount = (backing.__shareCount || 0) + 1
    if (options.fail) {
      options.fail()
    }
  }
  page.exportBackupFile()
  assert.strictEqual(backing.__shareCount, 2)
  assert.strictEqual(backing.__lastToast.title, '文件已生成')
  assert.strictEqual(page.isExportingBackup, false)

  delete global.wx.shareFileMessage
  page.exportBackupFile()
  assert.strictEqual(backing.__shareCount, 2)
  assert.strictEqual(backing.__lastToast.title, '文件已生成')
  assert.strictEqual(page.isExportingBackup, false)

  backing.__writeShouldFail = true
  page.exportBackupFile()
  assert.strictEqual(backing.__lastToast.title, '导出失败')
  assert.strictEqual(backing.__shareCount, 2)
  assert.strictEqual(page.isExportingBackup, false)
  backing.__writeShouldFail = false

  backing.__accessShouldFail = true
  backing.__accessCount = 0
  page.exportBackupFile()
  assert.strictEqual(backing.__accessCount, 5)
  assert.strictEqual(backing.__lastToast.title, '导出失败')
  assert.strictEqual(backing.__shareCount, 2)
  assert.strictEqual(page.isExportingBackup, false)

  console.log('profile page tests passed')
} finally {
  global.wx = previousWx
  global.Page = previousPage
  global.setTimeout = previousSetTimeout
}
