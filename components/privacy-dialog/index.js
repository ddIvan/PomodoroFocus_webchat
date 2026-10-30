Component({
  properties: {
    show: {
      type: Boolean,
      value: false
    }
  },

  methods: {
    onDetail() {
      this.triggerEvent('detail')
    },
    onDisagree() {
      this.triggerEvent('disagree')
    },
    onAgree() {
      this.triggerEvent('agree')
    },
    /** 弹窗遮罩层吃掉点击，避免穿透到下层 */
    noop() {}
  }
})
