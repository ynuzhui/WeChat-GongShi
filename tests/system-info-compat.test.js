const assert = require('assert')

const previousWx = global.wx
let fallbackCalls = 0

function resetModule(modulePath) {
  delete require.cache[require.resolve(modulePath)]
}

global.wx = {
  getWindowInfo() {
    return {
      windowWidth: 375,
      windowHeight: 667,
      pixelRatio: 2,
      statusBarHeight: 20
    }
  },
  getDeviceInfo() {
    return {
      platform: 'windows',
      system: 'Windows 11'
    }
  },
  getAppBaseInfo() {
    return {
      SDKVersion: '3.15.2',
      language: 'zh_CN'
    }
  },
  getSystemSetting() {
    return {
      bluetoothEnabled: true
    }
  },
  getAppAuthorizeSetting() {
    return {
      locationAuthorized: 'authorized'
    }
  },
  getSystemInfoSync() {
    fallbackCalls += 1
    return {
      SDKVersion: '0.0.0'
    }
  }
}

try {
  resetModule('../miniprogram_npm/@vant/weapp/common/version.js')
  const vantVersion = require('../miniprogram_npm/@vant/weapp/common/version.js')
  const info = vantVersion.getSystemInfoSync()
  assert.strictEqual(info.windowWidth, 375)
  assert.strictEqual(info.platform, 'windows')
  assert.strictEqual(info.SDKVersion, '3.15.2')
  assert.strictEqual(fallbackCalls, 0)

  const appConfig = require('fs').readFileSync(require('path').join(__dirname, '..', 'app.json'), 'utf8')
  assert.strictEqual(appConfig.indexOf('tdesign-miniprogram'), -1)

  console.log('system info compatibility tests passed')
} finally {
  global.wx = previousWx
}
