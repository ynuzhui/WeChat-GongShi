const worktime = require('../../utils/worktime')

const DEFAULT_PROFILE_TAB = 'report'
const PROFILE_TABS = [
  { key: 'report', label: '报表导出', icon: 'description-o' },
  { key: 'presets', label: '班次管理', icon: 'setting-o' },
  { key: 'balance', label: '结余设置', icon: 'balance-list-o' },
  { key: 'backup', label: '备份恢复', icon: 'share-o' }
]

function createPresetForm() {
  return {
    id: '',
    start: '09:30',
    end: '17:00',
    deductBreak: true
  }
}

function getPresetTimePickerValue(form, key) {
  const fallback = key === 'start' ? '09:30' : '17:00'
  return worktime.getHalfHourTimePickerValue(form && form[key], fallback)
}

function buildProfileState(store, data) {
  const currentMonthKey = data.currentMonthKey || worktime.toMonthKey(new Date())
  const balanceMonthKey = data.balanceMonthKey || currentMonthKey
  const monthView = worktime.buildMonthView(store, currentMonthKey)
  const balanceLedger = balanceMonthKey === currentMonthKey
    ? monthView.ledger
    : worktime.computeLedger(store, balanceMonthKey)
  const selectedPreset = worktime.getPresetById(store, data.selectedPresetId)
  return {
    currentMonthKey,
    balanceMonthKey,
    presets: store.settings.presets,
    selectedPresetId: selectedPreset ? selectedPreset.id : '',
    openingBalanceText: worktime.formatHours(monthView.ledger.openingBalanceMinutes),
    monthDeltaText: worktime.formatHours(monthView.ledger.monthDeltaMinutes, true),
    closingBalanceText: worktime.formatHours(monthView.ledger.closingBalanceMinutes),
    balanceMonthLabel: worktime.getMonthLabel(balanceMonthKey),
    balanceClosingText: worktime.formatHours(balanceLedger.closingBalanceMinutes),
    balanceInput: worktime.formatHours(balanceLedger.closingBalanceMinutes),
    presetStartTimePickerValue: getPresetTimePickerValue(data.presetForm, 'start'),
    presetEndTimePickerValue: getPresetTimePickerValue(data.presetForm, 'end')
  }
}

module.exports = {
  DEFAULT_PROFILE_TAB,
  PROFILE_TABS,
  createPresetForm,
  getPresetTimePickerValue,
  buildProfileState
}
