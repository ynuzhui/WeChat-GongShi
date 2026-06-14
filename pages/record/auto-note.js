const worktime = require('../../utils/worktime')

function cloneEntry(entry) {
  return entry ? JSON.parse(JSON.stringify(entry)) : null
}

function getAutoNoteText(entry, settings) {
  if (!entry || !entry.type) {
    return ''
  }
  if (entry.type === worktime.DAY_TYPES.REST || entry.type === worktime.DAY_TYPES.LEAVE) {
    return worktime.TYPE_LABELS[entry.type]
  }
  if (entry.type !== worktime.DAY_TYPES.WORK) {
    return ''
  }
  const calc = worktime.calculateEntry(entry, settings)
  if (!calc.valid) {
    return ''
  }
  return calc.diffMinutes === 0 ? '全天' : worktime.formatTimeRange(entry)
}

function isSystemAutoNoteText(note) {
  const text = note ? String(note) : ''
  return text === '全天' || text === '本休' || text === '调休' || /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(text)
}

function getInitialAutoNoteText(entry, settings) {
  const note = entry && entry.note ? String(entry.note) : ''
  const autoNote = getAutoNoteText(entry, settings)
  return note && autoNote && note === autoNote ? autoNote : ''
}

function applyAutoNote(entry, settings, previousAutoNote) {
  const draft = cloneEntry(entry)
  if (!draft) {
    return {
      entry: draft,
      autoNoteText: ''
    }
  }
  const note = draft.note ? String(draft.note) : ''
  const autoNote = getAutoNoteText(draft, settings)
  if (!autoNote) {
    if (previousAutoNote && note === previousAutoNote) {
      draft.note = ''
    }
    return {
      entry: draft,
      autoNoteText: ''
    }
  }

  if (!note || note === previousAutoNote || isSystemAutoNoteText(note)) {
    draft.note = autoNote
    return {
      entry: draft,
      autoNoteText: autoNote
    }
  }

  return {
    entry: draft,
    autoNoteText: ''
  }
}

module.exports = {
  getAutoNoteText,
  getInitialAutoNoteText,
  applyAutoNote,
  isSystemAutoNoteText
}
