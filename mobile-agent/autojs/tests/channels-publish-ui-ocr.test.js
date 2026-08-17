const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createWechatChannelsPublishUi } = require("../features/publish-video/channels-publish-ui.js");

test("视频号发现页在无障碍文本为空时使用当前屏幕全屏 OCR", () => {
  const previousDevice = global.device;
  let screenOcrCalls = 0;
  let recycled = 0;
  global.device = { width: 720, height: 1600 };
  try {
    const ui = createWechatChannelsPublishUi({
      logger: { warn() {} },
      screenRecognizer: {
        extractFastText() { return { visibleText: "" }; },
        extractScreen(regions) {
          screenOcrCalls += 1;
          assert.deepEqual(regions.full, { x: 0, y: 0, w: 720, h: 1600 });
          return { combinedText: "发现 视频号 直播", image: { recycle() { recycled += 1; } } };
        }
      }
    });
    assert.equal(ui.states.discoverReady(), true);
    assert.equal(screenOcrCalls, 1);
    assert.equal(recycled, 1);
  } finally {
    global.device = previousDevice;
  }
});

test("微信首页回退坐标按当前屏幕比例计算", () => {
  const previous = { click: global.click, desc: global.desc, device: global.device, sleep: global.sleep, text: global.text };
  const emptySelector = () => ({ findOne() { return null; } });
  const clicks = [];
  global.click = (x, y) => { clicks.push([x, y]); return true; };
  global.desc = emptySelector;
  global.device = { width: 720, height: 1600 };
  global.sleep = () => {};
  global.text = emptySelector;
  try {
    const ui = createWechatChannelsPublishUi({ logger: { warn() {} } });
    ui.selectWechatHomeTab();
    assert.deepEqual(clicks, [[90, 1440]]);
  } finally {
    Object.assign(global, previous);
  }
});
