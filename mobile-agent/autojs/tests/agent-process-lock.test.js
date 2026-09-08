"use strict";

var assert = require("node:assert/strict");
var test = require("node:test");
var createAgentProcessLock = require("../core/agent-process-lock.js").createAgentProcessLock;

function createChannelFactory() {
  var activePaths = {};
  var opened = [];
  return {
    opened: opened,
    create: function (path) {
      var channel = {
        tryLock: function () {
          if (activePaths[path]) return null;
          activePaths[path] = channel;
          return {
            release: function () {
              delete activePaths[path];
            }
          };
        },
        close: function () {
          channel.closed = true;
          if (activePaths[path] === channel) delete activePaths[path];
        },
        closed: false
      };
      opened.push(channel);
      return { getChannel: function () { return channel; }, close: channel.close };
    }
  };
}

test("跨引擎锁只允许一个持有者并支持幂等释放", function () {
  var factory = createChannelFactory();
  var first = createAgentProcessLock({ path: "/tmp/agent.lock", fileFactory: factory.create });
  var second = createAgentProcessLock({ path: "/tmp/agent.lock", fileFactory: factory.create });

  assert.equal(first.acquire(), true);
  assert.equal(first.acquire(), true, "同一持有者重复 acquire 不应创建第二把锁");
  assert.equal(second.acquire(), false, "第二个引擎不能取得已占用的锁");
  assert.equal(second.isHeld(), false);
  assert.equal(first.release(), true);
  assert.equal(first.release(), false);
  assert.equal(second.acquire(), true, "释放后其他引擎可以接管");
  second.release();
  assert.equal(factory.opened[1].closed, true, "失败的 tryLock 应关闭文件句柄");
});

test("锁实现将 tryLock 异常视为占用并关闭句柄", function () {
  var closed = false;
  var lock = createAgentProcessLock({
    path: "/tmp/agent.lock",
    fileFactory: function () {
      return {
        getChannel: function () {
          return {
            tryLock: function () { throw new Error("busy"); },
            close: function () { closed = true; }
          };
        },
        close: function () { closed = true; }
      };
    }
  });

  assert.equal(lock.acquire(), false);
  assert.equal(closed, true);
});

