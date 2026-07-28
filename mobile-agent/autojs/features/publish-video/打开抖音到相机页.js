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
