var assert = require("assert");
var popupModule = null;
try {
  popupModule = require("../features/account-warmup/live-transient-popup.js");
} catch (error) {}

function testDismissesCalendarReminderWithLaterButton() {
  assert(popupModule && typeof popupModule.createLiveTransientPopupHandler === "function", "直播临时弹窗处理器必须存在");
  var events = [];
  var title = { text: "开启日历提醒" };
  var later = { text: "以后再说" };
  var handler = popupModule.createLiveTransientPopupHandler({
    findCalendarReminder: function () { events.push("find-title"); return title; },
    findLaterButton: function () { events.push("find-later"); return later; },
    clickNode: function (node) { events.push(node === later ? "click-later" : "click-wrong"); return true; },
    logger: { info: function () {}, warn: function () {} }
  });

  assert.strictEqual(handler.dismiss(), true);
  assert.deepStrictEqual(events, ["find-title", "find-later", "click-later"]);
}

function testDoesNothingWithoutCalendarReminder() {
  assert(popupModule && typeof popupModule.createLiveTransientPopupHandler === "function", "直播临时弹窗处理器必须存在");
  var clicked = false;
  var handler = popupModule.createLiveTransientPopupHandler({
    findCalendarReminder: function () { return null; },
    findLaterButton: function () { return { text: "以后再说" }; },
    clickNode: function () { clicked = true; return true; }
  });

  assert.strictEqual(handler.dismiss(), false);
  assert.strictEqual(clicked, false);
}

testDismissesCalendarReminderWithLaterButton();
testDoesNothingWithoutCalendarReminder();
console.log("account warmup live transient popup tests passed");
