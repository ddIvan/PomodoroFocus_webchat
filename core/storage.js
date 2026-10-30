/**
 * 本地存储层。
 *
 * 小程序没有 SQLite，这里用 wx 的同步存储复刻 Android 的三张表：
 * accounts / focus_plans / focus_sessions。
 * 数据全部留在本机，不上传任何服务器。
 */
const KEY_ACCOUNTS = 'pomo_accounts'
const KEY_PLANS = 'pomo_plans'
const KEY_SESSIONS = 'pomo_sessions'
const KEY_SEQ = 'pomo_seq'
const KEY_SEEDED = 'pomo_seeded'

function readJson(key, fallback) {
  try {
    const v = wx.getStorageSync(key)
    if (v === '' || v === null || v === undefined) return fallback
    return v
  } catch (e) {
    return fallback
  }
}

function writeJson(key, value) {
  try {
    wx.setStorageSync(key, value)
    return true
  } catch (e) {
    console.error('存储失败', key, e)
    return false
  }
}

// ------------------------------------------------------------ 账户

function getAccounts() {
  const list = readJson(KEY_ACCOUNTS, [])
  return Array.isArray(list) ? list : []
}

function saveAccounts(list) {
  writeJson(KEY_ACCOUNTS, list)
}

function findAccountByName(username) {
  const name = String(username || '').trim()
  return getAccounts().find((a) => a.username === name) || null
}

function findAccountById(id) {
  return getAccounts().find((a) => a.id === id) || null
}

// ------------------------------------------------------------ 计划

function getAllPlans() {
  const list = readJson(KEY_PLANS, [])
  return Array.isArray(list) ? list : []
}

function saveAllPlans(list) {
  writeJson(KEY_PLANS, list)
}

// ------------------------------------------------------------ 记录

function getAllSessions() {
  const list = readJson(KEY_SESSIONS, [])
  return Array.isArray(list) ? list : []
}

function saveAllSessions(list) {
  writeJson(KEY_SESSIONS, list)
}

// ------------------------------------------------------------ 自增 id

function getSeq() {
  const s = readJson(KEY_SEQ, null)
  if (s && typeof s === 'object') return s
  return { account: 0, plan: 0, session: 0 }
}

function nextId(table) {
  const seq = getSeq()
  seq[table] = (seq[table] || 0) + 1
  writeJson(KEY_SEQ, seq)
  return seq[table]
}

// ------------------------------------------------------------ 预置数据

/**
 * 首次运行标记，幂等。
 * 改为微信登录后不再预置任何账户和体验数据：
 * 本地账户由 core/account 在登录成功时按微信 userId 创建。
 */
function ensureSeed() {
  if (readJson(KEY_SEEDED, false)) return
  writeJson(KEY_SEEDED, true)
}

/** 调试用：清空全部本地数据 */
function resetAll() {
  ;[KEY_ACCOUNTS, KEY_PLANS, KEY_SESSIONS, KEY_SEQ, KEY_SEEDED].forEach((k) => {
    try {
      wx.removeStorageSync(k)
    } catch (e) {
      /* ignore */
    }
  })
}

module.exports = {
  KEY_ACCOUNTS,
  KEY_PLANS,
  KEY_SESSIONS,
  getAccounts,
  saveAccounts,
  findAccountByName,
  findAccountById,
  getAllPlans,
  saveAllPlans,
  getAllSessions,
  saveAllSessions,
  nextId,
  ensureSeed,
  resetAll
}
