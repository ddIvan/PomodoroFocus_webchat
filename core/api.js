/**
 * 后端接口封装。
 * 服务端只负责微信身份与 token，专注数据仍然全部保存在本机。
 */
const prefs = require('./prefs')
const config = require('../config')

function apiBase() {
  const base = prefs.apiBaseOverride() || config.DEFAULT_API_BASE
  return String(base || '').replace(/\/+$/, '')
}

/**
 * 统一请求：无论成功失败都 resolve，调用方只看 ok / message。
 * @returns {Promise<{ok:boolean, code:number, message:string, data:any, unauthorized?:boolean, network?:boolean}>}
 */
function request(path, options) {
  const opt = options || {}
  return new Promise((resolve) => {
    const token = prefs.authToken()
    const header = { 'Content-Type': 'application/json' }
    if (token) header.Authorization = 'Bearer ' + token

    wx.request({
      url: apiBase() + path,
      method: opt.method || 'GET',
      data: opt.data || {},
      header,
      timeout: 10000,
      success(res) {
        const body = res.data && typeof res.data === 'object' ? res.data : {}
        if (res.statusCode === 401) {
          resolve({
            ok: false,
            code: body.code || 2001,
            message: body.message || '登录已失效，请重新登录',
            data: null,
            unauthorized: true
          })
          return
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({
            ok: body.code === 0,
            code: typeof body.code === 'number' ? body.code : 0,
            message: body.message || '',
            data: body.data || null
          })
          return
        }
        resolve({
          ok: false,
          code: typeof body.code === 'number' ? body.code : res.statusCode,
          message: body.message || '请求失败（' + res.statusCode + '）',
          data: null
        })
      },
      fail(err) {
        const detail = err && err.errMsg ? String(err.errMsg) : ''
        resolve({
          ok: false,
          code: -1,
          message: '无法连接服务器' + (detail ? '：' + detail : ''),
          data: null,
          network: true
        })
      }
    })
  })
}

/** wx.login 的 code 换本站 token */
function wechatLogin(code) {
  return request('/api/auth/wechat/login', { method: 'POST', data: { code } })
}

/** 校验 token 是否仍然有效 */
function me() {
  return request('/api/auth/me')
}

module.exports = {
  apiBase,
  request,
  wechatLogin,
  me
}
