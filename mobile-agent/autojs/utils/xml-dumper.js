function escapeXml(value) {
  if (!value) {
    return "";
  }
  return String(value).replace(/[<>&'"]/g, function (char) {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case "\"":
        return "&quot;";
      default:
        return char;
    }
  });
}

function nodeToXml(node, depth) {
  if (!node) {
    return "";
  }

  var indent = new Array(depth + 1).join("  ");
  var xml = indent + "<node";
  var classNameValue = node.className && node.className();
  var textValue = node.text && node.text();
  var descValue = node.desc && node.desc();
  var idValue = node.id && node.id();
  var boundsValue = node.bounds && node.bounds();

  if (classNameValue) {
    xml += ' class="' + escapeXml(classNameValue) + '"';
  }
  if (textValue) {
    xml += ' text="' + escapeXml(textValue) + '"';
  }
  if (descValue) {
    xml += ' content-desc="' + escapeXml(descValue) + '"';
  }
  if (idValue) {
    xml += ' resource-id="' + escapeXml(idValue) + '"';
  }
  if (boundsValue) {
    xml +=
      ' bounds="[' +
      boundsValue.left +
      "," +
      boundsValue.top +
      "][" +
      boundsValue.right +
      "," +
      boundsValue.bottom +
      ']"';
  }

  if (node.clickable && node.clickable()) {
    xml += ' clickable="true"';
  }
  if (node.enabled && node.enabled()) {
    xml += ' enabled="true"';
  }
  if (node.scrollable && node.scrollable()) {
    xml += ' scrollable="true"';
  }

  var childCount = node.childCount ? node.childCount() : 0;
  if (childCount > 0) {
    xml += ">\n";
    for (var i = 0; i < childCount; i++) {
      xml += nodeToXml(node.child(i), depth + 1);
    }
    xml += indent + "</node>\n";
  } else {
    xml += "/>\n";
  }

  return xml;
}

function dumpCurrentXml(outputDir, logger) {
  var root = auto.root;
  if (!root) {
    throw new Error("无法获取当前页面根节点");
  }

  if (!files.exists(outputDir)) {
    files.createWithDirs(outputDir + "/.keep");
    files.remove(outputDir + "/.keep");
  }

  var now = new Date();
  var fileName =
    "page_" +
    now.getFullYear() +
    ("0" + (now.getMonth() + 1)).slice(-2) +
    ("0" + now.getDate()).slice(-2) +
    "_" +
    ("0" + now.getHours()).slice(-2) +
    ("0" + now.getMinutes()).slice(-2) +
    ("0" + now.getSeconds()).slice(-2) +
    ".xml";
  var filePath = outputDir + "/" + fileName;
  var xml = '<?xml version="1.0" encoding="utf-8"?>\n<hierarchy>\n' + nodeToXml(root, 1) + "</hierarchy>";
  files.write(filePath, xml);

  if (logger) {
    logger.info("页面 XML 已导出", { filePath: filePath });
  }
  return filePath;
}

module.exports = {
  dumpCurrentXml: dumpCurrentXml
};
