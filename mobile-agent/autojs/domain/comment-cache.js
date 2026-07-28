function normalizeCommentText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function commentKey(comment) {
  var text = normalizeCommentText(comment && (comment.text || comment.raw || comment));
  var author = normalizeCommentText(comment && (comment.authorName || comment.author || ""));
  return [author, text].join("|");
}

function createCommentCache(options) {
  options = options || {};
  var maxSize = Math.max(1, Number(options.maxSize || 200));
  var items = [];
  var seen = {};

  function trim() {
    while (items.length > maxSize) {
      var removed = items.shift();
      if (removed && removed.key) {
        delete seen[removed.key];
      }
    }
  }

  function add(comment, meta) {
    var text = normalizeCommentText(comment && (comment.text || comment.raw || comment));
    if (!text) {
      return null;
    }
    var key = commentKey(comment);
    if (seen[key]) {
      return null;
    }
    var item = {
      key: key,
      text: text,
      raw: comment && comment.raw ? comment.raw : text,
      authorName: normalizeCommentText(comment && (comment.authorName || comment.author || "")),
      source: (comment && comment.source) || (meta && meta.source) || "visible_text",
      sampledAt: (meta && meta.sampledAt) || new Date().toISOString()
    };
    seen[key] = true;
    items.push(item);
    trim();
    return item;
  }

  function addMany(comments, meta) {
    var added = [];
    comments = comments || [];
    for (var i = 0; i < comments.length; i++) {
      var item = add(comments[i], meta);
      if (item) {
        added.push(item);
      }
    }
    return added;
  }

  function list() {
    return items.slice();
  }

  function size() {
    return items.length;
  }

  function clear() {
    items = [];
    seen = {};
  }

  function updateOptions(nextOptions) {
    nextOptions = nextOptions || {};
    maxSize = Math.max(1, Number(nextOptions.maxSize || maxSize || 200));
    trim();
  }

  function getState() {
    return {
      maxSize: maxSize,
      size: items.length
    };
  }

  return {
    add: add,
    addMany: addMany,
    list: list,
    size: size,
    clear: clear,
    updateOptions: updateOptions,
    getState: getState
  };
}

module.exports = {
  createCommentCache: createCommentCache,
  normalizeCommentText: normalizeCommentText,
  commentKey: commentKey
};
