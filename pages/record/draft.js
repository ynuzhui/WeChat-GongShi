const worktime = require('../../utils/worktime')
const storage = require('../../utils/storage')
const view = require('../../utils/view')

function cloneEntry(entry) {
  return entry ? JSON.parse(JSON.stringify(entry)) : null
}

function snapshotEntry(entry) {
  if (!entry || !entry.type) {
    return null
  }
  if (entry.type === worktime.DAY_TYPES.REST || entry.type === worktime.DAY_TYPES.LEAVE) {
    return {
      type: entry.type,
      note: entry.note ? String(entry.note) : ''
    }
  }
  return {
    type: worktime.DAY_TYPES.WORK,
    start: entry.start ? String(entry.start) : '',
    end: entry.end ? String(entry.end) : '',
    deductBreak: typeof entry.deductBreak === 'boolean' ? entry.deductBreak : null,
    presetId: entry.presetId ? String(entry.presetId) : '',
    note: entry.note ? String(entry.note) : ''
  }
}

function sameEntry(left, right) {
  return JSON.stringify(snapshotEntry(left)) === JSON.stringify(snapshotEntry(right))
}

function ensureDraftDefaults(entry, settings) {
  if (!entry || entry.type !== worktime.DAY_TYPES.WORK) {
    return entry
  }
  const draft = cloneEntry(entry)
  if (!draft.start) {
    draft.start = settings.defaultStart
  }
  if (!draft.end) {
    draft.end = settings.defaultEnd
  }
  if (typeof draft.deductBreak !== 'boolean') {
    draft.deductBreak = settings.defaultDeductBreak !== false
  }
  return draft
}

function buildDraftEntry(store, dateKey) {
  const savedEntry = storage.getStoredEntry(store, dateKey)
  if (savedEntry) {
    const draft = cloneEntry(savedEntry)
    if (draft.type === worktime.DAY_TYPES.WORK && typeof draft.deductBreak !== 'boolean') {
      draft.deductBreak = worktime.calculateEntry(draft, store.settings).breakDeducted > 0
    }
    return draft
  }
  return worktime.getDefaultWorkEntry(store.settings)
}

function normalizeBaselineEntry(entry, settings) {
  if (!entry || entry.type !== worktime.DAY_TYPES.WORK) {
    return entry
  }
  const baseline = cloneEntry(entry)
  if (typeof baseline.deductBreak !== 'boolean') {
    baseline.deductBreak = worktime.calculateEntry(baseline, settings).breakDeducted > 0
  }
  return baseline
}

function buildDraftState(store, dateKey, draftEntry) {
  const savedEntry = storage.getStoredEntry(store, dateKey)
  const baseline = savedEntry ? normalizeBaselineEntry(savedEntry, store.settings) : worktime.getDefaultWorkEntry(store.settings)
  const calc = worktime.calculateEntry(draftEntry, store.settings)
  return {
    savedEntry,
    isDirty: !sameEntry(draftEntry, baseline),
    calc
  }
}

function isSavedManualWorkEntry(entry) {
  return !!entry && entry.type === worktime.DAY_TYPES.WORK && !entry.presetId
}

function resolveManualEditorVisible(savedEntry, draftEntry, previousVisible) {
  if (!draftEntry || draftEntry.type !== worktime.DAY_TYPES.WORK || draftEntry.presetId) {
    return false
  }
  if (isSavedManualWorkEntry(savedEntry)) {
    return true
  }
  return !!previousVisible
}

function buildDraftStateTheme(hasRecord, isDirty) {
  if (isDirty) {
    return 'warning'
  }
  return hasRecord ? 'success' : 'primary'
}

function getEntryTimePickerValue(entry, key, settings) {
  const fallback = key === 'start' ? settings.defaultStart : settings.defaultEnd
  return worktime.getHalfHourTimePickerValue(entry && entry[key], fallback)
}

function normalizeManualEntryTimes(entry, settings) {
  const draft = cloneEntry(entry)
  draft.start = worktime.roundToHalfHourTime(draft.start, settings.defaultStart)
  draft.end = worktime.roundToHalfHourTime(draft.end, settings.defaultEnd)
  return draft
}

function findPresetIndex(presets, presetId) {
  return presets.findIndex((preset) => preset.id === presetId)
}

function buildDraftViewState(store, selectedDate, draftEntry, previousManualEditorVisible) {
  const draftState = buildDraftState(store, selectedDate, draftEntry)
  const hasRecord = !!draftState.savedEntry
  const presets = store.settings.presets
  const selectedPreset = worktime.getPresetById(store, draftEntry.presetId)
  return {
    selectedDate,
    selectedHasRecord: hasRecord,
    isDraftDirty: draftState.isDirty,
    draftStateLabel: view.buildSaveStateLabel(hasRecord, draftState.isDirty),
    draftStateTheme: buildDraftStateTheme(hasRecord, draftState.isDirty),
    selectedEntry: draftEntry,
    isManualEditorVisible: typeof previousManualEditorVisible === 'boolean'
      ? resolveManualEditorVisible(draftState.savedEntry, draftEntry, previousManualEditorVisible)
      : isSavedManualWorkEntry(draftState.savedEntry),
    presets,
    presetOptions: presets.map((preset) => worktime.formatPresetOption(preset)),
    selectedPresetIndex: Math.max(0, findPresetIndex(presets, draftEntry.presetId)),
    selectedPresetLabel: selectedPreset ? worktime.formatPresetOption(selectedPreset) : '',
    selectedDateLabel: worktime.getShortDateLabel(selectedDate),
    selectedSummary: view.buildEntrySummary(draftState.calc),
    selectedWarning: draftState.calc.valid ? '' : draftState.calc.error,
    startTimePickerValue: getEntryTimePickerValue(draftEntry, 'start', store.settings),
    endTimePickerValue: getEntryTimePickerValue(draftEntry, 'end', store.settings)
  }
}

module.exports = {
  cloneEntry,
  ensureDraftDefaults,
  buildDraftEntry,
  buildDraftState,
  resolveManualEditorVisible,
  getEntryTimePickerValue,
  normalizeManualEntryTimes,
  findPresetIndex,
  buildDraftViewState
}
