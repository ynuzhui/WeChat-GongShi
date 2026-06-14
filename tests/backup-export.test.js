const assert = require('assert')
const storage = require('../utils/storage')
const worktime = require('../utils/worktime')

function main() {
  // 测试 storage.buildBackup
  const store = worktime.createDefaultStore()
  const backup = storage.buildBackup(store)
  
  assert.strictEqual(backup.format, 'worktime-miniapp-backup')
  assert.strictEqual(backup.version, 4)
  assert.ok(backup.exportedAt)
  assert.ok(backup.fileName)
  assert.ok(backup.client)
  assert.ok(backup.store)
  assert.strictEqual(typeof backup.exportedAt, 'string')
  assert.match(backup.exportedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/)
  assert.strictEqual(backup.store.version, worktime.STORE_VERSION)

  const fixedBackup = storage.buildBackup(store, {
    now: new Date('2024-01-15T10:30:00.000Z')
  })
  assert.strictEqual(fixedBackup.exportedAt, '2024-01-15T18:30:00+08:00')

  // 测试规范化输入
  const rawStore = {
    version: 1,
    months: {},
    settings: { presets: [] }
  }
  const normalizedBackup = storage.buildBackup(rawStore)
  assert.strictEqual(normalizedBackup.store.version, worktime.STORE_VERSION)
  assert.ok(normalizedBackup.store.settings.defaultPresetsSeeded !== undefined)

  // 测试 storage.serializeBackup
  const json = storage.serializeBackup(store)
  assert.strictEqual(typeof json, 'string')
  const parsed = JSON.parse(json)
  assert.strictEqual(parsed.format, 'worktime-miniapp-backup')
  assert.strictEqual(parsed.version, 4)
  assert.ok(json.includes('\n'))
  assert.ok(json.includes('  '))

  // 测试 storage.buildStorePreview
  const exportedAt = '2024-01-15T10:30:00.000Z'
  const preview = storage.buildStorePreview(store, exportedAt)
  assert.strictEqual(preview.version, worktime.STORE_VERSION)
  assert.strictEqual(preview.exportedAt, exportedAt)
  assert.ok(preview.monthCount !== undefined)
  assert.ok(preview.recordCount !== undefined)
  assert.ok(preview.presetCount !== undefined)
  assert.strictEqual(typeof preview.monthCount, 'number')
  assert.strictEqual(typeof preview.recordCount, 'number')
  assert.strictEqual(typeof preview.presetCount, 'number')

  // 测试统计月份数量
  const storeWithData = worktime.createDefaultStore()
  storeWithData.months['2024-01'] = { entries: { '2024-01-15': worktime.getDefaultWorkEntry() } }
  storeWithData.months['2024-02'] = { entries: { '2024-02-10': worktime.getDefaultWorkEntry() } }
  const previewWithData = storage.buildStorePreview(storeWithData)
  assert.strictEqual(previewWithData.monthCount, 2)
  assert.strictEqual(previewWithData.recordCount, 2)

  // 测试 storage.makeBackupFileName
  const date = new Date('2024-01-15T10:30:00+08:00')
  const fileName = storage.makeBackupFileName(date)
  assert.ok(/^backup-\d{6}-\d{6}\.json$/.test(fileName))
  assert.ok(fileName.includes('240115'))
  assert.ok(fileName.includes('103000'))

  // 测试不同时间输入格式
  const dateObj = new Date('2024-03-20T15:45:00+08:00')
  const timestamp = dateObj.getTime()
  const dateString = dateObj.toISOString()
  const name1 = storage.makeBackupFileName(dateObj)
  const name2 = storage.makeBackupFileName(timestamp)
  const name3 = storage.makeBackupFileName(dateString)
  assert.ok(/^backup-240320-154500\.json$/.test(name1))
  assert.strictEqual(name2, name1)
  assert.strictEqual(name3, name1)

  // 测试完整导出导入循环
  const originalStore = worktime.createDefaultStore()
  originalStore.months['2024-01'] = {
    entries: {
      '2024-01-15': {
        type: worktime.DAY_TYPES.WORK,
        start: '09:00',
        end: '18:00',
        note: '测试记录'
      }
    }
  }
  originalStore.settings.presets.push({
    id: 'test-1',
    name: '测试预设',
    start: '09:00',
    end: '18:00'
  })

  const exportJson = storage.serializeBackup(originalStore)
  const parseResult = storage.parseBackupText(exportJson)
  assert.strictEqual(parseResult.ok, true)
  assert.strictEqual(parseResult.store.version, originalStore.version)
  assert.ok(parseResult.store.months['2024-01'])
  assert.deepStrictEqual(
    parseResult.store.months['2024-01'].entries['2024-01-15'],
    originalStore.months['2024-01'].entries['2024-01-15']
  )
  assert.ok(parseResult.store.settings.presets.length >= originalStore.settings.presets.length)

  // 测试空 store
  const emptyStore = worktime.createDefaultStore()
  const emptyBackup = storage.buildBackup(emptyStore)
  assert.deepStrictEqual(emptyBackup.store.months, {})
  assert.strictEqual(typeof emptyBackup.store.settings.presets, 'object')
  assert.ok(Array.isArray(emptyBackup.store.settings.presets))

  // 测试大量数据
  const largeStore = worktime.createDefaultStore()
  for (let month = 1; month <= 12; month++) {
    const monthKey = `2024-${String(month).padStart(2, '0')}`
    largeStore.months[monthKey] = { entries: {} }
    for (let day = 1; day <= 28; day++) {
      const dateKey = `${monthKey}-${String(day).padStart(2, '0')}`
      largeStore.months[monthKey].entries[dateKey] = {
        type: worktime.DAY_TYPES.WORK,
        start: '09:00',
        end: '18:00',
        note: `记录 ${dateKey}`
      }
    }
  }

  const largeJson = storage.serializeBackup(largeStore)
  assert.ok(largeJson.length > 1000)
  const largeParseResult = storage.parseBackupText(largeJson)
  assert.strictEqual(largeParseResult.ok, true)
  assert.strictEqual(largeParseResult.preview.monthCount, 12)
  assert.strictEqual(largeParseResult.preview.recordCount, 336)

  console.log('backup export tests passed')
}

main()
