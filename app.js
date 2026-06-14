const storage = require('./utils/storage')
const remoteBackup = require('./utils/remoteBackup')

App({
  globalData: {},

  onHide() {
    // 退出小程序时，若本地数据较上次同步有改动则推送远端（带节流，限制频率）
    Promise.resolve()
      .then(() => remoteBackup.flushOnExit({
        store: storage.loadStore(),
        reason: 'appHide'
      }))
      .catch((error) => {
        console.warn('[app] remote backup flush failed:', error)
      })
  }
})
