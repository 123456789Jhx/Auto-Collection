// 原中文名：打开抖音到相机页.js；职责：导航抖音到相机发布页面。
function createOpenDouyinCameraStep(ui) {
  return function openDouyinCamera() {
    try {
      return ui.openCamera();
    } catch (error) {
      throw new Error("打开抖音到相机页失败：" + String(error));
    }
  };
}

module.exports = {
  createOpenDouyinCameraStep: createOpenDouyinCameraStep
};
