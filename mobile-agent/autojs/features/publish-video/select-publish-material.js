// 原中文名：选择发布素材.js；职责：选择待发布视频素材。
function materialError(message) {
  var error = new Error(message);
  error.publishStatus = "MATERIAL_INVALID";
  return error;
}

function createSelectPublishMaterialStep(ui, chooseVideoMaterial) {
  return function selectPublishMaterial() {
    try {
      ui.openAlbum();
      var decision = chooseVideoMaterial(ui.readFirstGalleryItems());
      if (!decision.valid) throw materialError(decision.reason || "素材未正确上传");
      ui.clickGalleryItem(decision.index);
      var nextClicked = ui.clickNextIfPresent(8000);
      if (nextClicked === false) throw new Error("视频素材已选中，但未找到下一步按钮");
      if (nextClicked === true) ui.clickNextIfPresent(3000, true);
      return decision;
    } catch (error) {
      if (error && error.publishStatus) throw error;
      throw materialError("选择发布素材失败：" + String(error));
    }
  };
}

module.exports = {
  createSelectPublishMaterialStep: createSelectPublishMaterialStep
};
