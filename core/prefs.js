/** 轻量偏好设置，对应 Android 版 Prefs（SharedPreferences） */

const K = {
  accountId: 'current_account_id',
  accountName: 'current_account_name',
  accountAdmin: 'current_account_admin',
  selectedPlan: 'selected_plan_id',
  vibrate: 'vibrate_on_distraction',
  sound: 'sound_on_complete',
  voiceComplete: 'voice_on_complete',
  voiceDistraction: 'voice_on_distraction',
  lens: 'monitor_lens',
  monitor: 'monitor_enabled',
  privacyAgreed: 'privacy_agreed_version',
  monitorProfilePrefix: 'monitor_profile_',
  autoClearPrefix: 'last_auto_clear_date',
  authToken: 'auth_token',
  authTokenExpireAt: 'auth_token_expire_at',
  wechatUserId: 'wechat_user_id',
  apiBase: 'api_base_override'
}

function get(key, fallback) {
  try {
    const v = wx.getStorageSync(key)
    return v === '' || v === null || v === undefined ? fallback : v
  } catch (e) {
    return fallback
  }
}

function set(key, value) {
  try {
    wx.setStorageSync(key, value)
  } catch (e) {
    console.error('偏好写入失败', key, e)
  }
}

function remove(key) {
  try {
    wx.removeStorageSync(key)
  } catch (e) {
    /* ignore */
  }
}

module.exports = {
  LENS_FRONT: 0,
  LENS_BACK: 1,

  getRaw: get,
  setRaw: set,
  removeRaw: remove,

  currentAccountId() {
    return Number(get(K.accountId, 0)) || 0
  },
  setCurrentAccountId(id) {
    set(K.accountId, Number(id) || 0)
  },

  currentAccountName() {
    return String(get(K.accountName, '') || '')
  },
  setCurrentAccountName(name) {
    set(K.accountName, String(name || ''))
  },

  currentAccountAdmin() {
    return !!get(K.accountAdmin, false)
  },
  setCurrentAccountAdmin(v) {
    set(K.accountAdmin, !!v)
  },

  selectedPlanId() {
    return Number(get(K.selectedPlan, 0)) || 0
  },
  setSelectedPlanId(id) {
    set(K.selectedPlan, Number(id) || 0)
  },

  vibrateOnDistraction() {
    return get(K.vibrate, true) !== false
  },
  setVibrateOnDistraction(v) {
    set(K.vibrate, !!v)
  },

  soundOnComplete() {
    return get(K.sound, true) !== false
  },
  setSoundOnComplete(v) {
    set(K.sound, !!v)
  },

  voiceOnComplete() {
    return get(K.voiceComplete, true) !== false
  },
  setVoiceOnComplete(v) {
    set(K.voiceComplete, !!v)
  },

  voiceOnDistraction() {
    return get(K.voiceDistraction, true) !== false
  },
  setVoiceOnDistraction(v) {
    set(K.voiceDistraction, !!v)
  },

  /** 监控视角：0 前置，1 后置 */
  monitorLens() {
    return Number(get(K.lens, 0)) || 0
  },
  setMonitorLens(v) {
    set(K.lens, Number(v) === 1 ? 1 : 0)
  },

  /**
   * 监控开关三态：true / false / null（未手动设置，沿用计划默认值）。
   * 小程序存储没有"键不存在"语义，用 __unset__ 哨兵表达。
   */
  monitorEnabled() {
    const v = get(K.monitor, '__unset__')
    if (v === '__unset__') return null
    return !!v
  },
  setMonitorEnabled(v) {
    if (v === null || v === undefined) remove(K.monitor)
    else set(K.monitor, !!v)
  },

  privacyAgreedVersion() {
    return String(get(K.privacyAgreed, '') || '')
  },
  setPrivacyAgreedVersion(v) {
    set(K.privacyAgreed, String(v || ''))
  },

  autoClearMark(accountId) {
    return String(get(K.autoClearPrefix + '_' + accountId, '') || '')
  },
  setAutoClearMark(accountId, dateKey) {
    set(K.autoClearPrefix + '_' + accountId, dateKey)
  },

  /** 某场景是否被手动调过监控参数 */
  hasMonitorProfile(sceneKey) {
    return get(K.monitorProfilePrefix + sceneKey, null) !== null
  },
  monitorProfileJson(sceneKey) {
    return get(K.monitorProfilePrefix + sceneKey, null)
  },
  saveMonitorProfileJson(sceneKey, json) {
    set(K.monitorProfilePrefix + sceneKey, json)
  },
  resetMonitorProfile(sceneKey) {
    remove(K.monitorProfilePrefix + sceneKey)
  },

  // ---------------------------------------------------------- 微信登录态

  authToken() {
    return String(get(K.authToken, '') || '')
  },
  setAuthToken(token) {
    if (token) set(K.authToken, String(token))
    else remove(K.authToken)
  },

  authTokenExpireAt() {
    return Number(get(K.authTokenExpireAt, 0)) || 0
  },
  setAuthTokenExpireAt(ts) {
    set(K.authTokenExpireAt, Number(ts) || 0)
  },

  wechatUserId() {
    return Number(get(K.wechatUserId, 0)) || 0
  },
  setWechatUserId(id) {
    set(K.wechatUserId, Number(id) || 0)
  },

  /** 用户在登录页手动覆盖的后端地址，空串表示用 config.js 默认值 */
  apiBaseOverride() {
    return String(get(K.apiBase, '') || '')
  },
  setApiBaseOverride(base) {
    if (base) set(K.apiBase, String(base))
    else remove(K.apiBase)
  }
}
