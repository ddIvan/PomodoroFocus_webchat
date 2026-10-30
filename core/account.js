/**
 * 微信登录态与隐私政策同意状态。
 *
 * 身份由后端用 wx.login 的 code 换取（服务端持有 AppSecret），
 * 本机只保存后端签发的 token 与用户 Id；
 * 专注计划与记录仍然全部保存在本机（core/storage），不上传服务器。
 */
const storage = require('./storage')
const prefs = require('./prefs')
const api = require('./api')
const time = require('../utils/time')

/** 隐私政策因引入微信登录而更新版本，老用户会重新弹一次 */
const POLICY_VERSION = '1.4'
const POLICY_URL = 'http://www.tainylong.cn/workbuddy/zhuanzhu.html'

/** token 剩余不足 1 分钟就当作已过期，提前静默续期 */
const TOKEN_SAFE_WINDOW = 60 * 1000

function fail(message) {
  return { ok: false, message: message }
}

function success(account, extra) {
  return Object.assign({ ok: true, account: account }, extra || {})
}

// ------------------------------------------------------------ 隐私政策

function isPrivacyAgreed() {
  return prefs.privacyAgreedVersion() === POLICY_VERSION
}

function markPrivacyAgreed() {
  prefs.setPrivacyAgreedVersion(POLICY_VERSION)
}

// ------------------------------------------------------------ 登录态

function currentAccountId() {
  return prefs.currentAccountId()
}

function isLoggedIn() {
  return currentAccountId() > 0 && !!currentAccount()
}

function currentAccount() {
  const id = currentAccountId()
  if (id <= 0) return null
  return storage.findAccountById(id)
}

function displayName() {
  return prefs.currentAccountName() || '微信用户'
}

/** 已无管理员角色概念，保留函数避免调用方报错 */
function isAdmin() {
  return false
}

function hasValidToken() {
  const token = prefs.authToken()
  if (!token) return false
  return prefs.authTokenExpireAt() - Date.now() > TOKEN_SAFE_WINDOW
}

/** 后端地址，登录页展示与修改用 */
function apiBase() {
  return api.apiBase()
}

// ------------------------------------------------------------ 本地账户映射

/**
 * 用后端 userId 找到（或创建）对应的本地账户。
 * 旧版本纯本地账户没有 wechatUserId，这里把「当前登录的账户」或「唯一的旧账户」
 * 直接绑定到该微信用户，避免升级后历史数据变成孤儿。
 */
function ensureLocalAccount(wechatUserId, nickName) {
  const accounts = storage.getAccounts()
  const name = String(nickName || '').trim() || '微信用户'
  const uid = Number(wechatUserId) || 0

  let account = accounts.find((a) => Number(a.wechatUserId) === uid && uid > 0)

  if (!account) {
    const currentLegacy = accounts.find(
      (a) => a.id === prefs.currentAccountId() && !a.wechatUserId
    )
    const legacyList = accounts.filter((a) => !a.wechatUserId)
    const legacy = currentLegacy || (legacyList.length === 1 ? legacyList[0] : null)

    if (legacy) {
      legacy.wechatUserId = uid
      legacy.username = name
      delete legacy.passwordHash
      delete legacy.role
      account = legacy
    } else {
      account = {
        id: storage.nextId('account'),
        username: name,
        wechatUserId: uid,
        createdAt: Date.now()
      }
      accounts.push(account)
    }
    storage.saveAccounts(accounts)
  } else if (account.username !== name) {
    account.username = name
    storage.saveAccounts(accounts)
  }

  return account
}

function applySession(account) {
  prefs.setCurrentAccountId(account.id)
  prefs.setCurrentAccountName(account.username)
  prefs.setCurrentAccountAdmin(false)
  prefs.setSelectedPlanId(0)
  return account
}

/**
 * 用 wx.login 的 code 走一次完整登录。
 * @returns {Promise<{ok:boolean, message?:string, account?:object}>}
 */
function loginWithWechat() {
  return new Promise((resolve) => {
    wx.login({
      success(res) {
        const code = res && res.code ? String(res.code) : ''
        if (!code) {
          resolve(fail('未能获取微信登录凭证，请稍后重试'))
          return
        }
        api.wechatLogin(code).then((r) => {
          if (!r.ok) {
            resolve(fail(r.message || '登录失败，请稍后重试'))
            return
          }
          const data = r.data || {}
          prefs.setAuthToken(data.token || '')
          prefs.setAuthTokenExpireAt(Date.now() + (Number(data.expiresIn) || 0) * 1000)
          prefs.setWechatUserId(data.userId)
          const account = ensureLocalAccount(data.userId, data.nickName)
          resolve(success(applySession(account)))
        })
      },
      fail(err) {
        const detail = err && err.errMsg ? String(err.errMsg) : ''
        resolve(fail('微信登录失败' + (detail ? '：' + detail : '')))
      }
    })
  })
}

/**
 * 启动时调用：token 还有效就直接用，否则静默重新登录（不弹任何界面）。
 */
function ensureLogin() {
  const account = currentAccount()
  if (account && hasValidToken()) {
    applySession(account)
    return Promise.resolve(success(account, { cached: true }))
  }
  return loginWithWechat()
}

function logout() {
  prefs.setCurrentAccountId(0)
  prefs.setCurrentAccountName('')
  prefs.setCurrentAccountAdmin(false)
  prefs.setSelectedPlanId(0)
  prefs.setAuthToken('')
  prefs.setAuthTokenExpireAt(0)
  prefs.setWechatUserId(0)
}

/** 启动时按持久化 id 还原；账户不存在或 token 过期则返回 null */
function restore() {
  const account = currentAccount()
  if (!account) {
    if (currentAccountId() > 0) logout()
    return null
  }
  if (!hasValidToken()) return null
  return account
}

// ------------------------------------------------------------ 历史明细自动清理

/**
 * 跨天清理历史明细：每天只跑一次，把今天之前的明细标记为已清空。
 * 只动 cleared 标记，统计数字（番茄数、专注时长）不受影响。
 */
function autoClearIfNeeded() {
  const id = currentAccountId()
  if (id <= 0) return
  const today = time.todayKey()
  if (prefs.autoClearMark(id) === today) return

  const sessions = storage.getAllSessions()
  let changed = false
  sessions.forEach((s) => {
    if (s.accountId === id && !s.cleared && s.dateKey < today) {
      s.cleared = 1
      changed = true
    }
  })
  if (changed) storage.saveAllSessions(sessions)
  prefs.setAutoClearMark(id, today)
}

module.exports = {
  POLICY_VERSION,
  POLICY_URL,
  isPrivacyAgreed,
  markPrivacyAgreed,
  currentAccountId,
  isLoggedIn,
  currentAccount,
  displayName,
  isAdmin,
  hasValidToken,
  apiBase,
  loginWithWechat,
  ensureLogin,
  logout,
  restore,
  autoClearIfNeeded
}
