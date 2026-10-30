Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
    /** [{ key, label, placeholder, password }] */
    fields: { type: Array, value: [] },
    error: { type: String, value: '' },
    confirmText: { type: String, value: '确定' }
  },

  data: {
    values: {}
  },

  observers: {
    show(v) {
      if (v) {
        const values = {}
        ;(this.data.fields || []).forEach((f) => {
          values[f.key] = ''
        })
        this.setData({ values })
      }
    }
  },

  methods: {
    onInput(e) {
      const key = e.currentTarget.dataset.key
      const values = Object.assign({}, this.data.values)
      values[key] = e.detail.value
      this.setData({ values })
    },
    onCancel() {
      this.triggerEvent('cancel')
    },
    onConfirm() {
      this.triggerEvent('confirm', { values: this.data.values })
    },
    noop() {}
  }
})
