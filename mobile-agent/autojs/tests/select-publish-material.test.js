const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createSelectPublishMaterialStep } = require("../features/publish-video/select-publish-material.js");

function createUi(nextResults, events) {
  let nextIndex = 0;
  return {
    openAlbum() { events.push("open_album"); },
    readFirstGalleryItems() { events.push("read_gallery"); return [{ durationText: "00:12" }]; },
    clickGalleryItem(index) { events.push("select:" + index); },
    clickNextIfPresent(timeoutMs, silentIfMissing) {
      events.push("next:" + timeoutMs + ":" + Boolean(silentIfMissing));
      return nextResults[nextIndex++];
    }
  };
}

test("选中视频后等待首个下一步并可推进视频编辑页", () => {
  const events = [];
  const select = createSelectPublishMaterialStep(createUi([true, true], events), () => ({ valid: true, index: 0 }));

  assert.deepEqual(select(), { valid: true, index: 0 });
  assert.deepEqual(events, ["open_album", "read_gallery", "select:0", "next:8000:false", "next:3000:true"]);
});

test("视频编辑页没有第二个下一步时仍继续封面流程", () => {
  const events = [];
  const select = createSelectPublishMaterialStep(createUi([true, false], events), () => ({ valid: true, index: 0 }));

  assert.deepEqual(select(), { valid: true, index: 0 });
  assert.deepEqual(events, ["open_album", "read_gallery", "select:0", "next:8000:false", "next:3000:true"]);
});

test("选中视频后下一步未出现时明确失败", () => {
  const events = [];
  const select = createSelectPublishMaterialStep(createUi([false], events), () => ({ valid: true, index: 0 }));

  assert.throws(() => select(), /视频素材已选中，但未找到下一步按钮/);
  assert.deepEqual(events, ["open_album", "read_gallery", "select:0", "next:8000:false"]);
});
