// 原中文名：填写标题描述话题.js；职责：填写标题与作品描述。

function createFillPublishTextStep(ui) {
  return function fillPublishText(payload) {
    try {
      ui.fillTitleAndDescription(payload.title, payload.description);
      return { valid: true };
    } catch (error) {
      throw new Error("填写标题和作品描述失败：" + String(error));
    }
  };
}

module.exports = {
  createFillPublishTextStep: createFillPublishTextStep
};