// 原中文名：编辑封面.js；职责：编辑发布视频的封面。
function createEditCoverStep(ui) {
  return function editCover(materials) {
    if (!materials || !materials.coverPath) {
      ui.clickNextIfPresent();
      return { skipped: true };
    }
    try {
      ui.openCoverAlbum();
      ui.clickGalleryItem(0, true);
      ui.clickNextIfPresent();
      ui.closeCoverDiagnostic();
      ui.saveCover();
      ui.clickNextIfPresent();
      return { skipped: false, coverPath: materials.coverPath };
    } catch (error) {
      throw new Error("编辑封面失败：" + String(error));
    }
  };
}

module.exports = {
  createEditCoverStep: createEditCoverStep
};
