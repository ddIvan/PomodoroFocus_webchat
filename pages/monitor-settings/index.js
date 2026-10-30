const profileDao = require('../../core/monitor-profile')
const statusbar = require('../../utils/statusbar')

/**
 * 监控参数设置页，对应 Android MonitorSettingsActivity。
 *
 * 参数表由 core/monitor-profile 的 specsFor(scene) 驱动：换场景时同一套代码重建控件。
 * 与 Android 的差异（人脸关键点不可得）已在页尾说明，不展示不生效的角度参数。
 */
Page({
  data: {
    statusBarHeight: 20,
    navRight: 0,
    scenes: [],
    sceneKey: 'front_screen',
    sceneSummary: '',
    custom: false,

    presets: [],
    presetKey: '',

    groups: [],
    showReset: false
  },

  onReady() {
    // 冷启动首帧偶发取不到胶囊位置（返回全 0），渲染完成后再校正一次
    const navRight = statusbar.rightGap(8)
    if (navRight !== this.data.navRight) this.setData({ navRight })
  },

  onLoad(options) {
    this._profile = null
    this._index = {}
    this._specs = {}
    this.setData({
      statusBarHeight: statusbar.height(),
      navRight: statusbar.rightGap(8)
    })

    const sceneKey = (options && options.scene) || profileDao.SCENES[0].key
    const scene = profileDao.fromKey(sceneKey)
    this._profile = profileDao.load(scene)

    this.setData({
      scenes: profileDao.SCENES.map((s) => ({ key: s.key, title: s.title })),
      presets: profileDao.PRESETS.map((p) => ({ key: p.key, label: p.label })),
      sceneKey: scene.key
    })
    this.rebuild()
  },

  rebuild() {
    const scene = profileDao.fromKey(this.data.sceneKey)
    const profile = this._profile
    const groups = []
    const indexMap = {}
    const specMap = {}

    profileDao.specsFor(scene).forEach((spec) => {
      let group = null
      for (let i = 0; i < groups.length; i++) {
        if (groups[i].title === spec.group) group = groups[i]
      }
      if (!group) {
        group = { title: spec.group, items: [] }
        groups.push(group)
      }
      const stored = Number(profile[spec.key])
      group.items.push({
        key: spec.key,
        label: spec.label,
        hint: spec.hint,
        display: profileDao.formatValue(spec, stored),
        value: profileDao.toDisplay(spec, stored),
        min: spec.min,
        max: spec.max,
        step: spec.step
      })
      indexMap[spec.key] = { gi: groups.indexOf(group), ii: group.items.length - 1 }
      specMap[spec.key] = spec
    })

    this._index = indexMap
    this._specs = specMap

    this.setData({
      groups,
      sceneSummary: scene.summary,
      custom: profileDao.hasCustom(scene.key),
      presetKey: profileDao.matchedPreset(scene, profile)
    })
  },

  onSceneTap(e) {
    const key = e.currentTarget.dataset.key
    if (!key || key === this.data.sceneKey) return
    const scene = profileDao.fromKey(key)
    this._profile = profileDao.load(scene)
    this.setData({ sceneKey: scene.key })
    this.rebuild()
  },

  onSliderChanging(e) {
    this.applySlider(e, false)
  },

  onSliderChange(e) {
    this.applySlider(e, true)
  },

  applySlider(e, persist) {
    const key = e.currentTarget.dataset.key
    const pos = this._index[key]
    const spec = this._specs[key]
    if (!pos || !spec) return

    const stored = profileDao.toStored(spec, e.detail.value)
    this._profile[spec.key] = stored

    const patch = {}
    patch['groups[' + pos.gi + '].items[' + pos.ii + '].display'] = profileDao.formatValue(spec, stored)
    patch['groups[' + pos.gi + '].items[' + pos.ii + '].value'] = profileDao.toDisplay(spec, stored)
    this.setData(patch)

    if (!persist) return
    const scene = profileDao.fromKey(this.data.sceneKey)
    profileDao.save(scene, this._profile)
    this.setData({
      custom: true,
      presetKey: profileDao.matchedPreset(scene, this._profile)
    })
  },

  onPresetTap(e) {
    const key = e.currentTarget.dataset.key
    const scene = profileDao.fromKey(this.data.sceneKey)
    this._profile = profileDao.preset(profileDao.defaultFor(scene), key)
    profileDao.save(scene, this._profile)
    this.rebuild()
    const preset = profileDao.PRESETS.find((p) => p.key === key)
    wx.showToast({ title: '已套用「' + (preset ? preset.label : '') + '」预设', icon: 'none' })
  },

  askReset() {
    this.setData({ showReset: true })
  },

  onResetCancel() {
    this.setData({ showReset: false })
  },

  onResetConfirm() {
    const scene = profileDao.fromKey(this.data.sceneKey)
    profileDao.reset(scene)
    this._profile = profileDao.load(scene)
    this.setData({ showReset: false })
    this.rebuild()
    wx.showToast({ title: '已恢复出厂参数', icon: 'none' })
  },

  onBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) wx.navigateBack({ delta: 1 })
    else wx.switchTab({ url: '/pages/focus/index' })
  }
})
