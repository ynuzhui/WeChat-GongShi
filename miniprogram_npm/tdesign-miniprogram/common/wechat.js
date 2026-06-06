const fallbackSystemInfo = () => wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
const mergeInfo = (...items) => Object.assign({}, ...items.filter(Boolean));

export const getObserver = (target, selector) => new Promise((resolve) => {
  target.createIntersectionObserver({ nativeMode: true }).relativeToViewport().observe(selector, (result) => {
    resolve(result);
  });
});

export const getWindowInfo = () => (wx.getWindowInfo ? wx.getWindowInfo() : fallbackSystemInfo());
export const getAppBaseInfo = () => (wx.getAppBaseInfo ? wx.getAppBaseInfo() : fallbackSystemInfo());
export const getDeviceInfo = () => (wx.getDeviceInfo ? wx.getDeviceInfo() : fallbackSystemInfo());
export const getSystemSetting = () => (wx.getSystemSetting ? wx.getSystemSetting() : {});
export const getAppAuthorizeSetting = () => (wx.getAppAuthorizeSetting ? wx.getAppAuthorizeSetting() : {});
export const getSystemInfo = () => mergeInfo(
  getWindowInfo(),
  getAppBaseInfo(),
  getDeviceInfo(),
  getSystemSetting(),
  getAppAuthorizeSetting()
);
