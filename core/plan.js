/** 专注计划：增删改查与频率判断，对应 Android 的 FocusPlan + FocusPlanDao */
const storage = require('./storage')

const FREQ_DAILY = 0
const FREQ_WEEKDAYS = 1
const FREQ_CUSTOM = 2

const TASK_SCREEN = 0
const TASK_PAPER = 1

const WEEKDAY_NAMES = ['一', '二', '三', '四', '五', '六', '日']
const MASK_ALL = 0b1111111

/** JS 的 getDay() 里 0=周日，这里统一成 0=周一，与 weekdaysMask 的 bit0 对齐 */
function weekdayIndex(date) {
  return (date.getDay() + 6) % 7
}

function scheduledOn(plan, date) {
  const idx = weekdayIndex(date || new Date())
  if (plan.frequencyType === FREQ_WEEKDAYS) return idx < 5
  if (plan.frequencyType === FREQ_CUSTOM) return ((plan.weekdaysMask >> idx) & 1) === 1
  return true
}

function frequencyText(plan) {
  if (plan.frequencyType === FREQ_WEEKDAYS) return '工作日'
  if (plan.frequencyType === FREQ_CUSTOM) {
    if (plan.weekdaysMask === MASK_ALL) return '每天'
    const picked = WEEKDAY_NAMES.filter((_, i) => ((plan.weekdaysMask >> i) & 1) === 1)
    return '周' + picked.join('、')
  }
  return '每天'
}

function strictnessText(strictness) {
  if (strictness === 0) return '宽松'
  if (strictness === 2) return '严格'
  return '标准'
}

function taskModeText(taskMode) {
  return taskMode === TASK_PAPER ? '纸面任务' : '盯屏任务'
}

/** 当前账户的全部计划，默认不包含归档 */
function list(accountId, includeArchived) {
  return storage
    .getAllPlans()
    .filter((p) => p.accountId === accountId && (includeArchived || !p.archived))
    .sort((a, b) => a.createdAt - b.createdAt)
}

/** 今天需要执行的计划 */
function availableToday(accountId, date) {
  return list(accountId).filter((p) => scheduledOn(p, date))
}

function get(id) {
  return storage.getAllPlans().find((p) => p.id === id) || null
}

function count(accountId) {
  return list(accountId).length
}

/** 新建或更新，返回保存后的计划 */
function save(plan) {
  const all = storage.getAllPlans()
  if (!plan.id) {
    const created = Object.assign({}, plan, {
      id: storage.nextId('plan'),
      createdAt: Date.now(),
      archived: false
    })
    all.push(created)
    storage.saveAllPlans(all)
    return created
  }
  const idx = all.findIndex((p) => p.id === plan.id)
  if (idx < 0) return null
  all[idx] = Object.assign({}, all[idx], plan)
  storage.saveAllPlans(all)
  return all[idx]
}

function remove(id) {
  storage.saveAllPlans(storage.getAllPlans().filter((p) => p.id !== id))
}

/** 删除某账户的全部计划，管理员删除账户时清理用 */
function deleteByAccount(accountId) {
  const all = storage.getAllPlans()
  const next = all.filter((p) => p.accountId !== accountId)
  if (next.length === all.length) return 0
  storage.saveAllPlans(next)
  return all.length - next.length
}

/** 从表单值构造计划对象 */
function fromForm(form) {
  let mask = MASK_ALL
  if (form.weekdaysMask !== undefined && form.weekdaysMask !== null) {
    mask = Number(form.weekdaysMask) || 0
  } else if (Array.isArray(form.weekdays) && form.weekdays.length) {
    mask = form.weekdays.reduce((acc, i) => acc | (1 << i), 0)
  }
  return {
    id: form.id || 0,
    name: String(form.name || '').trim(),
    durationMinutes: Number(form.durationMinutes) || 25,
    goal: String(form.goal || '').trim(),
    frequencyType: Number(form.frequencyType) || FREQ_DAILY,
    weekdaysMask: mask,
    dailyTarget: Number(form.dailyTarget) || 1,
    monitorEnabled: !!form.monitorEnabled,
    // 宽松 = 0，不能用 || 兜底，否则 0 会被吞成标准
    strictness: form.strictness === undefined || form.strictness === null
      ? 1
      : Number(form.strictness),
    taskMode: Number(form.taskMode) || TASK_SCREEN,
    accountId: form.accountId,
    archived: !!form.archived
  }
}

module.exports = {
  FREQ_DAILY,
  FREQ_WEEKDAYS,
  FREQ_CUSTOM,
  TASK_SCREEN,
  TASK_PAPER,
  MASK_ALL,
  WEEKDAY_NAMES,
  weekdayIndex,
  scheduledOn,
  frequencyText,
  strictnessText,
  taskModeText,
  list,
  availableToday,
  get,
  count,
  save,
  remove,
  deleteByAccount,
  fromForm
}
