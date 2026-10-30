const account = require('../../core/account')
const prefs = require('../../core/prefs')

Page({
  data: {
    agree: false,
    busy: false,
    error: '',
    apiBase: '',

    showPrivacy: false,
    /** 用户点了「不同意」后的阻断态 */
    blocked: false,
    showAgreeConfirm: false
  },

  onLoad() {
    this.setData({ apiBase: account.apiBase() })
    if (account.isPrivacyAgreed()) {
      this.tryRestore()
    } else {
      this.setData({ showPrivacy: true })
    }
  },

  onShow() {
    this.setData({ apiBase: account.apiBase() })
  },

  /** 本地 token 仍有效时直接进首页，避免多一次网络请求 */
  tryRestore() {
    if (account.restore()) {
      this.goMain()
    }
  },

  // -------------------------------------------------- 隐私政策

  onPrivacyAgree() {
    account.markPrivacyAgreed()
    this.setData({ showPrivacy: false, blocked: false })
    this.tryRestore()
  },

  onPrivacyDisagree() {
    // 小程序无法主动退出，改为阻断界面：不发起登录，仅保留重新阅读入口
    this.setData({ showPrivacy: false, blocked: true, error: '' })
  },

  onPrivacyDetail() {
    wx.navigateTo({ url: '/pages/privacy/index' })
  },

  reopenPrivacy() {
    this.setData({ showPrivacy: true })
  },

  // -------------------------------------------------- 协议勾选

  toggleAgree() {
    this.setData({ agree: !this.data.agree })
  },

  openPolicy() {
    wx.navigateTo({ url: '/pages/privacy/index' })
  },

  // -------------------------------------------------- 微信登录

  doLogin() {
    if (this.data.busy) return
    if (!account.isPrivacyAgreed()) {
      this.setData({ showPrivacy: true })
      return
    }
    if (!this.data.agree) {
      this.setData({ showAgreeConfirm: true })
      return
    }
    this.performLogin()
  },

  onAgreeCancel() {
    this.setData({ showAgreeConfirm: false })
  },

  onAgreeConfirm() {
    this.setData({ showAgreeConfirm: false, agree: true }, () => {
      this.performLogin()
    })
  },

  performLogin() {
    if (this.data.busy) return
    this.setData({ error: '', busy: true })
    account.loginWithWechat().then((result) => {
      if (!result.ok) {
        this.setData({ busy: false, error: result.message })
        return
      }
      this.setData({ busy: false })
      this.goMain()
    })
  },

  /** 真机联调时临时改后端地址（正式环境请改 config.js） */
  editApiBase() {
    wx.showModal({
      title: '后端地址',
      editable: true,
      content: account.apiBase(),
      placeholderText: 'http://192.168.1.10:5080',
      success: (res) => {
        if (!res.confirm) return
        prefs.setApiBaseOverride(String(res.content || '').trim())
        this.setData({ apiBase: account.apiBase() })
        wx.showToast({
          title: account.apiBase(),
          icon: 'none',
          duration: 2000
        })
      }
    })
  },

  goMain() {
    wx.switchTab({ url: '/pages/focus/index' })
  }
})
