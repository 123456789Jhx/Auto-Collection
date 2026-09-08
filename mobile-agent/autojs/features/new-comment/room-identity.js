"use strict";

function normalizeText(text) {
  text = String(text || "");
  if (typeof text.normalize === "function") return text.normalize("NFKC");
  if (typeof java !== "undefined" && java.text && java.text.Normalizer) {
    return String(java.text.Normalizer.normalize(text, java.text.Normalizer.Form.NFKC));
  }
  return text.replace(/[\uff01-\uff5e]/g, function (character) {
    return String.fromCharCode(character.charCodeAt(0) - 0xfee0);
  }).replace(/\u3000/g, " ");
}

function roomIdentityFromText(text) {
  var normalized = normalizeText(text).replace(/\r\n?/g, "\n").trim();
  var accountLabel = /(^|\n)[ \t]*\u6296[ \t]*\u97f3[ \t]*\u53f7(?=[ \t:\n]|$)[ \t]*:?[ \t]*/.exec(normalized) ||
    /[ \t]+\u6296[ \t]*\u97f3[ \t]*\u53f7(?=[ \t:\n]|$)[ \t]*:?[ \t]*/.exec(normalized);
  var accountId = "";
  var nameText = normalized;
  if (accountLabel) {
    var accountMatch = /^[a-z0-9._-]+/i.exec(normalized.slice(accountLabel.index + accountLabel[0].length));
    accountId = accountMatch ? accountMatch[0] : "";
    nameText = normalized.slice(0, accountLabel.index) + "\n" +
      normalized.slice(accountLabel.index + accountLabel[0].length + accountId.length);
    if (!nameText.trim()) nameText = normalized;
  }
  var accountName = "";
  nameText.split(/\n+/).some(function (line) {
    line = line.replace(/\s+/g, " ").trim();
    if (!line || /^[\s:|._-]+$/.test(line) ||
        /^(\u5173\u6ce8|\u7c89\u4e1d|\u83b7\u8d5e|\u76f4\u64ad\u52a8\u6001|\u5546\u54c1\u6a71\u7a97|\u4f5c\u54c1|\u7b80\u4ecb)$/.test(line)) return false;
    accountName = line;
    return true;
  });
  if (!accountName || accountName.length > 200) return null;
  return { accountName: accountName, accountId: accountId, text: normalized };
}

module.exports = { roomIdentityFromText: roomIdentityFromText };
