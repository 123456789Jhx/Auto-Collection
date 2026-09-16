"use strict";

function createTimedRuntimeActions(options) {
  options = options || {};
  var raw = options.actions || {};
  var timing = options.actionTiming;
  var navigation = options.navigation;
  var control = options.control;
  function success(value) { return options.success ? options.success(value) : { success: true, value: value }; }
  function timed(name, method, args, activeControl, timingOptions) {
    timingOptions = timingOptions || {};
    timingOptions.purpose = name;
    return timing.run(name, function () { return method.apply(null, args || []); },
      activeControl || control, timingOptions);
  }
  function search(keyword, activeControl, restart) {
    var opened = timed("openSearchEntry", navigation ? navigation.openSearchEntry :
      function () { return success(true); }, [], activeControl);
    if (!opened.success) return opened;
    var entered = timed("setSearchKeyword", navigation ? navigation.setSearchKeyword :
      function () { return success(keyword); }, navigation ? [keyword] : [], activeControl);
    if (!entered.success) return entered;
    return timed("submitSearch", navigation ? navigation.submitSearch : restart ? raw.restartSearch : raw.openSearch,
      navigation ? [] : [keyword, activeControl], activeControl);
  }
  return {
    openDouyin: function () { return timed("openDouyin", raw.openDouyin); },
    openDouyinWaitRange: raw.openDouyinWaitRange,
    actionTiming: timing,
    openSearch: function (keyword, activeControl) { return search(keyword, activeControl, false); },
    restartSearch: function (keyword, activeControl) { return search(keyword, activeControl, true); },
    openLiveTab: function () { return timed("openLiveTab", raw.openLiveTab); },
    openFirstLive: function () { return timed("openFirstLive", raw.openFirstLive); },
    isLiveRoom: raw.isLiveRoom,
    readViewerCount: function () { return timed("readViewerCount", raw.readViewerCount); },
    readCommerceCart: function () { return timed("detectCommerceCart", raw.readCommerceCart); },
    nextLive: function () { return timed("nextLive", raw.nextLive); },
    readComments: function (value) { return timed("readComments", raw.readComments, [], null, value); },
    openAnchorSummary: function () { return timed("openAnchorSummary", raw.openAnchorSummary); },
    openAnchorProfile: function () { return timed("openAnchorProfile", raw.openAnchorProfile); },
    readRoomIdentity: function () { return timed("readRoomIdentity", raw.readRoomIdentity); },
    closeAnchorProfile: function () { return timed("closeAnchorProfile", raw.closeAnchorProfile); },
    finishRoomCapture: function () { return timed("finishRoomCapture", function () { return success(true); }); },
    swipeComments: function (value) { return timed("swipeComments", raw.swipeComments, [], null, value); },
    detectPlatformVerification: raw.detectPlatformVerification,
    waitRandom: raw.waitRandom,
    getActionTrace: raw.getActionTrace
  };
}

module.exports = { createTimedRuntimeActions: createTimedRuntimeActions };
