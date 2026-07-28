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
      ui.clickNextIfPresent();
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
