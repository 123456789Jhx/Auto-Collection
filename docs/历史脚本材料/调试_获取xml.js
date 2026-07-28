
// 手动将控件树转换为XML
function getCurrentXML() {
  try {
    let root = auto.root;
    if (!root) {
      console.error("无法获取根节点");
      return null;
    }

    // 手动构建XML
    let xml = '<?xml version="1.0" encoding="utf-8"?>\n';
    xml += "<hierarchy>\n";
    xml += nodeToXMLString(root, 1);
    xml += "</hierarchy>";

    return xml;
  } catch (e) {
    console.error("获取XML失败: " + e);
    return null;
  }
}

// 将节点转换为XML字符串
function nodeToXMLString(node, depth) {
  if (!node) return "";

  let indent = "  ".repeat(depth);
  let xml = indent + "<node";

  // 获取并添加属性
  let className = node.className();
  if (className) {
    xml += ' class="' + escapeXml(className) + '"';
  }

  let text = node.text();
  if (text) {
    xml += ' text="' + escapeXml(text) + '"';
  }

  let desc = node.desc();
  if (desc) {
    xml += ' content-desc="' + escapeXml(desc) + '"';
  }

  let id = node.id();
  if (id) {
    xml += ' resource-id="' + escapeXml(id) + '"';
  }

  let bounds = node.bounds();
  if (bounds) {
    xml +=
      ' bounds="[' +
      bounds.left +
      "," +
      bounds.top +
      "][" +
      bounds.right +
      "," +
      bounds.bottom +
      ']"';
  }

  // 添加状态属性
  if (node.clickable()) xml += ' clickable="true"';
  if (node.focusable()) xml += ' focusable="true"';
  if (node.enabled()) xml += ' enabled="true"';
  if (node.scrollable()) xml += ' scrollable="true"';
  if (node.checked()) xml += ' checked="true"';
  if (node.selected()) xml += ' selected="true"';

  // 处理子节点
  let childCount = node.childCount();
  if (childCount > 0) {
    xml += ">\n";
    for (let i = 0; i < childCount; i++) {
      xml += nodeToXMLString(node.child(i), depth + 1);
    }
    xml += indent + "</node>\n";
  } else {
    xml += "/>\n";
  }

  return xml;
}

// XML转义函数
function escapeXml(str) {
  if (!str) return "";
  return str.replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return c;
    }
  });
}

// 检查无障碍服务是否已经启用
auto();
// 开启控制台悬浮窗，方便查看运行日志
console.show();
// ui.run(function () {
//   let mConsoleViewField = runtime.console.getClass().getDeclaredField('mConsoleView');
//   mConsoleViewField.setAccessible(true);
//   let refConsoleView = mConsoleViewField.get(runtime.console);
//   let mConsoleView = refConsoleView.get();
//   mConsoleView.findViewById(com.stardust.autojs.R.id.input_container).visibility = android.view.View.GONE;
// });

// 使用示例
let xml = getCurrentXML();
if (xml) {
  let dirPath = "/sdcard/安卓群控/xml/";
  // 确保目录存在，如果不存在则创建
  if (!files.exists(dirPath)) {
    files.ensureDir(dirPath);
  }

  const now = new Date();
  const datePart = now.toISOString().split('T')[0];
  const timePart = now.toTimeString().split(' ')[0].replace(/:/g, "-");
  let fileName = `${dirPath}页面布局_${datePart}_${timePart}.xml`;
  files.write(fileName, xml);
  console.log(`XML已保存: ${fileName}`);
}
