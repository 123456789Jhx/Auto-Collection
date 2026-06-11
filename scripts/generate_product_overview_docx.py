from __future__ import annotations

import html
import json
import math
import textwrap
import zipfile
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs" / "requirements"
ASSET_DIR = ROOT / "docs" / "project-records" / "generated-assets"
OUT_MD = OUT_DIR / "agri_collection_product_overview.md"
OUT_DOCX = OUT_DIR / "agri_collection_product_overview.docx"
FLOW_IMAGE = ASSET_DIR / "agri_collection_flow.png"
CONTROL_IMAGE = ASSET_DIR / "remote_control_flow.png"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/simhei.ttf"),
        Path("C:/Windows/Fonts/simsun.ttc"),
    ]
    for path in candidates:
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def wrap_text(draw: ImageDraw.ImageDraw, text: str, font_obj: ImageFont.ImageFont, max_width: int) -> list[str]:
    lines: list[str] = []
    current = ""
    for char in text:
        test = current + char
        width = draw.textbbox((0, 0), test, font=font_obj)[2]
        if width <= max_width or not current:
            current = test
        else:
            lines.append(current)
            current = char
    if current:
        lines.append(current)
    return lines


def draw_box(draw: ImageDraw.ImageDraw, xy: tuple[int, int, int, int], title: str, body: str = "", fill="#FFFFFF"):
    x1, y1, x2, y2 = xy
    draw.rounded_rectangle(xy, radius=18, fill=fill, outline="#5E7FA3", width=2)
    title_font = font(25, bold=True)
    body_font = font(20)
    title_lines = wrap_text(draw, title, title_font, x2 - x1 - 34)
    body_lines = wrap_text(draw, body, body_font, x2 - x1 - 34) if body else []
    total_h = len(title_lines) * 32 + len(body_lines) * 27 + (8 if body_lines else 0)
    y = y1 + max(16, ((y2 - y1) - total_h) // 2)
    for line in title_lines:
        bbox = draw.textbbox((0, 0), line, font=title_font)
        draw.text((x1 + (x2 - x1 - (bbox[2] - bbox[0])) // 2, y), line, fill="#15324F", font=title_font)
        y += 32
    if body_lines:
        y += 8
    for line in body_lines:
        bbox = draw.textbbox((0, 0), line, font=body_font)
        draw.text((x1 + (x2 - x1 - (bbox[2] - bbox[0])) // 2, y), line, fill="#44546A", font=body_font)
        y += 27


def arrow(draw: ImageDraw.ImageDraw, start: tuple[int, int], end: tuple[int, int], color="#506A85"):
    draw.line([start, end], fill=color, width=4)
    angle = math.atan2(end[1] - start[1], end[0] - start[0])
    size = 14
    points = [
        end,
        (int(end[0] - size * math.cos(angle - math.pi / 6)), int(end[1] - size * math.sin(angle - math.pi / 6))),
        (int(end[0] - size * math.cos(angle + math.pi / 6)), int(end[1] - size * math.sin(angle + math.pi / 6))),
    ]
    draw.polygon(points, fill=color)


def create_flow_images():
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    title_font = font(34, bold=True)

    img = Image.new("RGB", (1800, 1160), "#F6F8FA")
    draw = ImageDraw.Draw(img)
    draw.text((60, 44), "农业内容采集与后台监控业务流程", fill="#102A43", font=title_font)
    boxes = [
        ((70, 135, 390, 260), "手机 Agent 启动", "检查权限，进入待命"),
        ((500, 135, 820, 260), "后台/本地开始任务", "选择任务、关键词和时长"),
        ((930, 135, 1250, 260), "进入农业内容流", "搜索农业关键词或恢复视频流"),
        ((1360, 135, 1680, 260), "视频阶段", "随机运行 2-3 小时"),
        ((1360, 410, 1680, 535), "内容识别", "快速识别文字，判断农业相关"),
        ((930, 410, 1250, 535), "候选采集", "标题、作者、指标、评论、原始文本"),
        ((500, 410, 820, 535), "直播阶段", "随机 1-2 小时，进入少量直播间"),
        ((70, 410, 390, 535), "本地与后台记录", "保存 datasource，并上报后台"),
        ((70, 690, 390, 815), "后台监控", "看板、设备、记录、日志、任务"),
        ((500, 690, 820, 815), "远程控制", "启动、暂停、恢复、停止、查版本"),
        ((930, 690, 1250, 815), "风险识别", "验证码、登录异常、页面跑偏"),
        ((1360, 690, 1680, 815), "人工处理", "停止自动操作，等待处理"),
    ]
    for idx, (xy, title, body) in enumerate(boxes):
        fill = "#EAF3FF" if idx in [0, 8] else "#FFFFFF"
        draw_box(draw, xy, title, body, fill)
    arrow(draw, (390, 197), (500, 197))
    arrow(draw, (820, 197), (930, 197))
    arrow(draw, (1250, 197), (1360, 197))
    arrow(draw, (1520, 260), (1520, 410))
    arrow(draw, (1360, 472), (1250, 472))
    arrow(draw, (930, 472), (820, 472))
    arrow(draw, (500, 472), (390, 472))
    arrow(draw, (230, 535), (230, 690))
    arrow(draw, (390, 752), (500, 752))
    arrow(draw, (820, 752), (930, 752))
    arrow(draw, (1250, 752), (1360, 752))
    draw.text((70, 920), "说明：该流程用于观察和沉淀农业兴趣内容，不包含验证码绕过、自动点赞评论关注或批量互动。", fill="#6B7280", font=font(24))
    img.save(FLOW_IMAGE)

    img2 = Image.new("RGB", (1800, 980), "#F6F8FA")
    draw = ImageDraw.Draw(img2)
    draw.text((60, 44), "远程通信与控制流程", fill="#102A43", font=title_font)
    boxes2 = [
        ((70, 160, 390, 285), "产品/运营后台", "查看设备，点击控制按钮"),
        ((500, 160, 820, 285), "命令进入后台", "记录为待拉取状态"),
        ((930, 160, 1250, 285), "手机主动拉取", "按间隔查询是否有命令"),
        ((1360, 160, 1680, 285), "手机执行命令", "开始、暂停、恢复、停止"),
        ((1360, 460, 1680, 585), "执行结果回执", "已执行、失败或忽略"),
        ((930, 460, 1250, 585), "心跳持续上报", "状态、阶段、计数、版本"),
        ((500, 460, 820, 585), "后台更新状态", "在线、离线、运行、暂停"),
        ((70, 460, 390, 585), "产品侧判断", "是否需要人工介入"),
    ]
    for idx, (xy, title, body) in enumerate(boxes2):
        fill = "#EAF3FF" if idx in [0, 7] else "#FFFFFF"
        draw_box(draw, xy, title, body, fill)
    arrow(draw, (390, 222), (500, 222))
    arrow(draw, (820, 222), (930, 222))
    arrow(draw, (1250, 222), (1360, 222))
    arrow(draw, (1520, 285), (1520, 460))
    arrow(draw, (1360, 522), (1250, 522))
    arrow(draw, (930, 522), (820, 522))
    arrow(draw, (500, 522), (390, 522))
    draw.text((70, 760), "部署要点：手机分散到不同地区后不能访问本机 192.168.x.x 地址，需要公网部署或内网穿透。", fill="#6B7280", font=font(24))
    img2.save(CONTROL_IMAGE)


def md_content() -> str:
    return """# 农业内容采集与账号数据管理平台产品说明

版本日期：2026-06-04

适用对象：产品、运营、项目负责人

## 1. 项目一句话说明

本项目通过手机端自动化脚本浏览农业相关短视频和直播内容，并把运行状态、采集记录、日志和设备状态回传到后台，帮助运营判断脚本是否正常运行、账号浏览内容是否持续偏向农业领域、以及是否出现异常需要人工处理。

项目当前不是完整素材库平台，也不是自动互动平台。当前阶段的重点是“手机脚本采集 + 后台监控 + 远程控制”的闭环。

## 2. 背景与目标

06-03 会议讨论的核心问题是：当手机不再集中插线管理，而是分散到不同地区运行时，后台如何继续监控和控制这些手机脚本。

原来的本机局域网地址只能在同一个网络内访问，手机使用流量或分散到全国后无法访问本机后台。因此后续需要公网后台、内网穿透或正式服务器部署，让手机脚本访问一个公网地址。

产品目标分为三层：

| 层级 | 目标 | 说明 |
|---|---|---|
| 手机端 | 自动执行农业内容浏览与采集 | 负责打开抖音、搜索农业关键词、浏览视频和直播、保存候选信息 |
| 后台端 | 监控设备与任务 | 负责展示设备状态、心跳、采集记录、日志和任务配置 |
| 远程运维 | 远程控制与版本维护 | 负责启动、暂停、恢复、停止脚本，后续支持版本检查和更新 |

## 3. 会议形成的方案边界

06-03 会议里确认的重点不是继续讨论脚本某一个动作怎么调，而是先确认“手机不插线、分散运行后，后台怎样继续监控和控制脚本”。当前项目选择的是脚本 Agent 主动访问后台的方式。

| 场景 | 结论 | 说明 |
|---|---|---|
| 集中插线群控 | 可用，但不是分散运行主方案 | 手机都在现场并接线时，可以通过群控设备直接操作；手机分散到全国后无法依赖这种方式 |
| 分散远程脚本 Agent | 当前主方案 | 手机脚本主动访问公网后台，拉取命令、上报心跳和日志 |
| 第三方群控工具 | 可调研，不作为当前交付依赖 | 如后续发现成熟工具可接入，再单独评估成本、稳定性和权限边界 |
| 公网直接暴露 ADB | 不建议作为主方案 | 安全风险高，也不适合给全国分散手机长期暴露调试通道 |
| 多手机共用同一 Wi-Fi | 不建议作为长期运行方式 | 大量手机使用同一出口 IP 容易带来账号侧风险，分散运行更适合流量或独立网络 |

后台远程控制不是后台直接穿透进手机执行动作，而是后台记录命令，手机脚本自己定时拉取并执行。这样更适合全国分散设备，也便于后续做版本更新、配置下发和异常排查。

## 4. 总体业务流程

![农业内容采集与后台监控业务流程](../project-records/generated-assets/agri_collection_flow.png)

流程说明：

| 步骤 | 产品含义 | 当前实现情况 |
|---|---|---|
| 手机 Agent 启动 | 手机脚本启动后先检查权限，进入待命 | 已实现 |
| 后台或本地开始任务 | 可由悬浮按钮或后台命令触发一轮任务 | 已实现 |
| 进入农业内容流 | 优先搜索农业关键词，再进入视频流浏览 | 已实现 |
| 视频阶段 | 每天随机刷 2-3 小时视频 | 已实现 |
| 内容识别 | 通过屏幕文字识别和关键词判断是否农业相关 | 已实现基础规则 |
| 候选采集 | 命中后采集标题、作者、指标、评论和原始文本 | 已实现 |
| 直播阶段 | 每天随机刷 1-2 小时直播，进入少量直播间 | 已实现基础逻辑 |
| 本地与后台记录 | 本地保存到 datasource，同时尝试上传后台 | 已实现 |
| 后台监控 | 展示看板、设备、采集记录、日志和任务配置 | 已实现基础页面 |
| 远程控制 | 后台下发启动、暂停、恢复、停止等命令 | 已实现基础命令 |
| 风险识别 | 检测验证码、登录异常、页面跑偏等风险 | 已实现基础检测 |
| 人工处理 | 出现风险后停止自动操作，等待人工处理 | 已实现停止策略 |

## 5. 远程通信与控制流程

![远程通信与控制流程](../project-records/generated-assets/remote_control_flow.png)

手机端不等待后台主动连接，而是由手机脚本定时访问后台，主动拉取命令并回传状态。这种方式适合手机分散在不同网络环境中运行。

| 环节 | 说明 |
|---|---|
| 后台下发命令 | 产品或运营在后台设备页点击启动、暂停、恢复、停止等按钮 |
| 命令入库 | 后台先记录命令，状态为待手机拉取 |
| 手机主动拉取 | 手机脚本按配置间隔访问后台，查看是否有新命令 |
| 手机执行命令 | 手机按命令调整当前任务状态 |
| 回写执行结果 | 手机把执行结果回传后台，后台展示命令是否成功 |
| 心跳上报 | 手机每分钟上报一次当前状态，后台据此判断在线或离线 |

## 6. 手机端功能介绍

手机端脚本位于 `mobile-agent/autojs`，运行环境是 AutoX.js / Auto.js。用户复制整个文件夹到手机后，运行入口 `main.js`。

| 功能 | 产品说明 | 当前状态 |
|---|---|---|
| 权限检查 | 检查无障碍、悬浮窗、截图等运行权限 | 已实现 |
| 极简悬浮控制 | 手机上只保留开始/暂停和停止按钮 | 已实现 |
| 农业关键词搜索 | 使用水稻病虫害、大棚蔬菜、果树修剪等词进入农业内容流 | 已实现 |
| 视频浏览 | 随机运行 2-3 小时，减少无关视频停留 | 已实现 |
| 直播浏览 | 随机运行 1-2 小时，限制进入直播间数量 | 已实现 |
| 内容采集 | 保存候选内容、关键词命中、屏幕文本和评论等信息 | 已实现 |
| 本地输出 | 采集结果写入脚本目录下 datasource | 已实现 |
| 后台上报 | 上报采集记录、运行日志和心跳 | 已实现，依赖公网地址 |
| 风险停止 | 出现验证码、账号异常、登录异常时停止自动操作 | 已实现基础检测 |
| 常驻待命 | 任务结束后不退出，回到 idle 等待下一次任务 | 已实现 |

## 7. 后台功能介绍

后台模块位于 `account-data-platform`，当前定位是账号数据管理平台，核心用途是监控和排障。

| 页面 | 面向产品的作用 | 当前状态 |
|---|---|---|
| 监控看板 | 查看设备数、运行数、今日采集、今日异常、最近心跳和最近日志 | 已实现基础版 |
| 设备 | 查看每台手机是否在线、最近心跳、版本、最后命令，并下发控制命令 | 已实现基础版 |
| 采集记录 | 查看手机采集到的视频/直播候选记录 | 已实现基础版 |
| 日志 | 查看脚本运行日志，用于排查卡住、异常、上传失败等问题 | 已实现基础版 |
| 任务配置 | 管理采集任务的关键词、时长和基础策略 | 已实现基础版 |

## 8. 当前采集的数据

当前采集结果主要用于观察账号浏览内容是否偏向农业领域，而不是直接生成内容或自动互动。

| 数据类型 | 内容 | 用途 |
|---|---|---|
| 采集记录 | 平台、视频/直播类型、关键词、标题、作者、互动指标、评论、屏幕文本 | 判断是否采集到农业相关内容 |
| 心跳 | 当前状态、运行阶段、已浏览数量、采集数量、剩余时间、版本 | 判断手机是否在线和任务是否正常 |
| 运行日志 | 启动、暂停、停止、异常、上传结果、风险停止原因 | 排查脚本运行问题 |
| 命令记录 | 后台下发命令、手机是否拉取、是否执行成功 | 判断远程控制是否生效 |
| 版本事件 | 手机版本检查、发现新版本、更新事件 | 后续远程更新使用 |

## 9. 风险识别与安全边界

文档标题中的“风控规避”在本项目里按合规口径理解为：减少不必要的异常触发，并在出现风险时及时停止自动操作，不包含绕过验证码或绕过平台限制。

会议里提到的动作轨迹、批量运行、同一出口 IP 等风险，当前按“降低风险和持续优化”处理：脚本动作需要做随机化和节奏控制，运行中发现异常要能停下来并留下日志，但系统不能承诺完全规避平台检测。

| 场景 | 当前处理方式 |
|---|---|
| 验证码、安全验证、滑块 | 停止自动操作，记录日志，等待人工处理 |
| 登录异常、账号异常 | 停止任务并上报后台 |
| 页面跑到发布页、评论页、商品页等非采集上下文 | 尝试返回视频流，超过次数后停止 |
| 网络不可用 | 本地继续保存关键记录，恢复后再补传 |
| 后台不可达 | 脚本不应被后台请求卡死，继续本地运行 |
| 动作轨迹或批量行为风险 | 通过随机停留、随机滑动和分散网络降低风险，真实效果需要持续观察 |

明确不做的内容：

| 不做内容 | 原因 |
|---|---|
| 不绕过验证码 | 平台风险高，且不符合当前项目边界 |
| 不自动点赞、评论、关注、私信 | 当前目标是采集和监控，不是互动执行 |
| 不直接公网暴露 ADB | 安全风险高，不适合作为远程控制主方案 |
| 不承诺平台账号标签结果 | 后台只能展示浏览和采集证据，不能证明平台最终如何识别账号 |

## 10. 部署与通信说明

如果手机和后台不在同一个局域网，手机不能访问 `192.168.x.x` 这种本机私网地址。要让手机使用流量也能通信，需要满足下面任一条件：

| 方案 | 说明 | 适用阶段 |
|---|---|---|
| 内网穿透 | 本机后台仍在本地运行，通过服务器 frp 暴露公网访问地址 | 本地演示、短期验证 |
| 云服务器部署 | 后台 API 和前端部署到公网服务器，手机直接访问域名 | 正式运行 |
| HTTPS 域名 | 正式环境建议使用域名和 HTTPS | 长期运行 |

当前建议先用 frp 把本机 API 端口映射到服务器公网端口，手机脚本配置为公网地址，例如 `http://服务器IP:公网端口/api/v1`。等产品验证通过后，再迁移到正式服务器部署。

手机可以使用流量，也可以使用 Wi-Fi；通信方案本身不强制某一种网络。产品上要注意的是，大量手机长期共用同一个出口 IP 不适合作为正式运行方式。

## 11. 当前已完成与待完成

| 模块 | 已完成 | 待完成 |
|---|---|---|
| 手机脚本 | 模块化、农业搜索、视频/直播阶段、本地输出、心跳、远程控制、极简悬浮按钮 | 不同手机和抖音版本的稳定性继续调试 |
| 后台监控 | 看板、设备、采集记录、日志、任务配置、命令下发、版本字段 | 命令状态展示更细化，设备详情页待补 |
| 远程通信 | 手机端接口和后台接口已具备 | 需要公网地址，当前本机私网地址不能支持流量手机 |
| 版本管理 | 版本发布表、版本检查接口、更新事件已具备 | 真正替换手机脚本、校验、备份、回滚待下一阶段 |
| 风险处理 | 风险词检测、异常停止、日志上报已具备 | 风险识别准确率需要真实运行继续优化 |

## 12. 产品验收关注点

| 验收点 | 判断方式 |
|---|---|
| 手机是否在线 | 后台设备页最后心跳是否持续更新 |
| 脚本是否在跑 | 看板最近心跳是否显示运行阶段、浏览数量和采集数量 |
| 是否采到农业内容 | 采集记录是否出现农业关键词、标题和屏幕文本 |
| 远程控制是否生效 | 后台命令是否从待拉取变成已执行或失败 |
| 异常是否可排查 | 日志页是否能看到停止原因、风险词、页面恢复记录 |
| 公网通信是否成功 | 手机使用流量时，后台仍能收到心跳和日志 |

## 13. 后续建议

第一步先把 frp 或公网部署打通，验证手机使用流量时能持续上报心跳。第二步完善命令回执展示，让产品能看到每条命令是否被手机拉取和执行。第三步补设备详情页，把单台手机的心跳、日志、采集记录、版本事件串起来。第四步再做远程更新的文件替换、校验、备份和回滚。第五步再单独评估第三方群控工具是否值得接入，不能让它影响当前脚本 Agent 主链路交付。
"""


def esc(text: str) -> str:
    return html.escape(text, quote=True)


def para(text: str, role: str = "body") -> str:
    props = {
        "title": ('<w:pPr><w:spacing w:after="120"/><w:jc w:val="center"/></w:pPr>', '<w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/><w:b/><w:color w:val="102A43"/><w:sz w:val="48"/></w:rPr>'),
        "subtitle": ('<w:pPr><w:spacing w:after="220"/><w:jc w:val="center"/></w:pPr>', '<w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/><w:color w:val="6B7280"/><w:sz w:val="22"/></w:rPr>'),
        "h1": ('<w:pPr><w:spacing w:before="320" w:after="120"/><w:keepNext/></w:pPr>', '<w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/><w:b/><w:color w:val="1F4D78"/><w:sz w:val="32"/></w:rPr>'),
        "h2": ('<w:pPr><w:spacing w:before="200" w:after="100"/><w:keepNext/></w:pPr>', '<w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/><w:b/><w:color w:val="2E74B5"/><w:sz w:val="26"/></w:rPr>'),
        "body": ('<w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr>', '<w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/></w:rPr>'),
        "note": ('<w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr>', '<w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/><w:i/><w:color w:val="666666"/><w:sz w:val="20"/></w:rPr>'),
    }
    ppr, rpr = props[role]
    return f"<w:p>{ppr}<w:r>{rpr}<w:t>{esc(text)}</w:t></w:r></w:p>"


def table(rows: list[list[str]], widths: list[int] | None = None) -> str:
    col_count = len(rows[0])
    widths = widths or [9360 // col_count] * col_count
    grid = "".join(f'<w:gridCol w:w="{w}"/>' for w in widths)
    out = [
        '<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/>'
        '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="DADCE0"/>'
        '<w:left w:val="single" w:sz="4" w:color="DADCE0"/><w:bottom w:val="single" w:sz="4" w:color="DADCE0"/>'
        '<w:right w:val="single" w:sz="4" w:color="DADCE0"/><w:insideH w:val="single" w:sz="4" w:color="DADCE0"/>'
        '<w:insideV w:val="single" w:sz="4" w:color="DADCE0"/></w:tblBorders>'
        '<w:tblCellMar><w:top w:w="120" w:type="dxa"/><w:left w:w="120" w:type="dxa"/>'
        '<w:bottom w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr>'
        f"<w:tblGrid>{grid}</w:tblGrid>"
    ]
    for ridx, row in enumerate(rows):
        out.append("<w:tr>")
        for cidx, cell in enumerate(row):
            fill = '<w:shd w:fill="F2F4F7"/>' if ridx == 0 else ""
            bold = "<w:b/>" if ridx == 0 else ""
            out.append(
                f'<w:tc><w:tcPr><w:tcW w:w="{widths[cidx]}" w:type="dxa"/>{fill}</w:tcPr>'
                f'<w:p><w:pPr><w:spacing w:after="60" w:line="280" w:lineRule="auto"/></w:pPr>'
                f'<w:r><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/>{bold}<w:sz w:val="20"/></w:rPr>'
                f"<w:t>{esc(cell)}</w:t></w:r></w:p></w:tc>"
            )
        out.append("</w:tr>")
    out.append("</w:tbl>")
    return "".join(out) + para("", "body")


def image_para(rel_id: str, cx: int = 5943600, cy: int = 3820000) -> str:
    return f"""
<w:p>
  <w:pPr><w:jc w:val="center"/><w:spacing w:after="160"/></w:pPr>
  <w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"
    xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
    <wp:extent cx="{cx}" cy="{cy}"/>
    <wp:docPr id="{rel_id[-1]}" name="flow"/>
    <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:nvPicPr><pic:cNvPr id="0" name="image.png"/><pic:cNvPicPr/></pic:nvPicPr>
          <pic:blipFill><a:blip r:embed="{rel_id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
          <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
        </pic:pic>
      </a:graphicData>
    </a:graphic>
  </wp:inline></w:drawing></w:r>
</w:p>
"""


def section_break() -> str:
    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'


def build_document_xml() -> str:
    body: list[str] = []
    body.append(para("农业内容采集与账号数据管理平台产品说明", "title"))
    body.append(para("面向产品、运营和项目负责人 | 2026-06-04", "subtitle"))
    body.append(para("本文档根据 06-03 远程脚本控制讨论记录、现有手机脚本、后台监控模块和项目更新记录整理。文档重点说明业务流程、功能范围、当前状态和后续落地顺序，避免过多技术细节。", "body"))
    body.append(para("重要口径：文档中涉及风险控制的内容，均指风险识别、异常停止和人工处理，不包含验证码绕过、平台限制绕过或自动互动行为。", "note"))

    body.append(para("1. 项目定位", "h1"))
    body.append(para("项目当前目标是建立“手机脚本采集 + 后台监控 + 远程控制”的闭环。手机端负责浏览农业相关内容并采集候选信息，后台负责观察设备状态、查看采集结果、下发控制命令和排查异常。", "body"))
    body.append(table([
        ["模块", "产品含义", "当前定位"],
        ["手机 Agent", "在手机上长期运行的采集执行端", "负责打开平台、搜索农业内容、浏览视频/直播、保存和上报记录"],
        ["账号数据管理平台", "产品和运营查看设备与数据的后台", "负责看板、设备、采集记录、日志、任务配置和远程控制"],
        ["公网通信", "让分散手机能访问后台", "本地演示使用 frp 或内网穿透，正式环境建议云服务器和 HTTPS"],
    ], [1800, 3300, 4260]))

    body.append(para("2. 会议形成的方案边界", "h1"))
    body.append(para("06-03 会议确认的重点不是继续调某一个脚本动作，而是先解决手机不插线、分散运行后，后台怎样继续监控和控制脚本。当前项目选择脚本 Agent 主动访问后台的方式。", "body"))
    body.append(table([
        ["场景", "结论", "说明"],
        ["集中插线群控", "可用，但不是分散运行主方案", "手机都在现场并接线时可以直控；分散到全国后无法依赖这种方式"],
        ["分散远程脚本 Agent", "当前主方案", "手机脚本主动访问公网后台，拉取命令、上报心跳和日志"],
        ["第三方群控工具", "可调研，不作为当前交付依赖", "后续如发现成熟工具，再单独评估成本、稳定性和权限边界"],
        ["公网直接暴露 ADB", "不建议作为主方案", "安全风险高，不适合给全国分散手机长期暴露调试通道"],
        ["多手机共用同一 Wi-Fi", "不建议作为长期运行方式", "大量手机共用同一出口 IP 容易带来账号侧风险"],
    ], [2100, 2500, 4760]))
    body.append(para("后台远程控制不是后台直接穿透进手机执行动作，而是后台记录命令，手机脚本自己定时拉取并执行。这样更适合全国分散设备，也便于后续做版本更新、配置下发和异常排查。", "body"))

    body.append(para("3. 总体业务流程", "h1"))
    body.append(image_para("rIdImage1", 5943600, 3820000))
    body.append(table([
        ["流程节点", "说明", "当前状态"],
        ["启动与待命", "脚本检查权限后进入待命，等待本地按钮或后台命令", "已实现"],
        ["农业内容入口", "通过农业关键词进入更稳定的视频流", "已实现"],
        ["视频阶段", "每日随机 2-3 小时，快速跳过无关内容", "已实现"],
        ["直播阶段", "每日随机 1-2 小时，限制进入直播间数量", "已实现"],
        ["采集与上报", "命中农业内容后保存本地记录，并尝试上传后台", "已实现"],
        ["异常处理", "识别验证码、登录异常、页面跑偏后停止或恢复", "已实现基础能力"],
    ], [1800, 4860, 2700]))

    body.append(para("4. 远程通信与控制流程", "h1"))
    body.append(image_para("rIdImage2", 5943600, 3230000))
    body.append(para("手机分散到不同地区后，不适合依赖插线直控，也不能继续使用本机 192.168.x.x 地址。推荐方式是手机主动访问公网后台，定时上报心跳并拉取命令。", "body"))
    body.append(table([
        ["环节", "产品说明"],
        ["后台下发命令", "产品或运营在设备页点击启动、暂停、恢复、停止、刷新配置、检查版本等按钮"],
        ["手机主动拉取", "手机脚本按间隔访问后台，查看是否有自己的命令"],
        ["执行与回执", "手机执行后把结果写回后台，后台应展示是否已拉取、已执行或失败"],
        ["心跳监控", "手机每分钟上报状态，后台根据最后心跳判断在线或离线"],
    ], [2300, 7060]))

    body.append(para("5. 手机端功能介绍", "h1"))
    body.append(table([
        ["功能", "产品说明", "当前状态"],
        ["权限检查", "检查无障碍、悬浮窗、截图等运行权限", "已实现"],
        ["极简悬浮控制", "只保留开始/暂停和停止按钮，减少遮挡", "已实现"],
        ["农业关键词搜索", "使用水稻病虫害、大棚蔬菜、果树修剪等词进入农业内容流", "已实现"],
        ["视频浏览", "随机运行 2-3 小时，减少无关内容停留", "已实现"],
        ["直播浏览", "随机运行 1-2 小时，限制进入直播间数量", "已实现"],
        ["内容采集", "保存标题、作者、指标、评论、屏幕文本等候选信息", "已实现"],
        ["本地输出", "采集结果写入脚本目录下 datasource", "已实现"],
        ["后台上报", "上报采集记录、运行日志和心跳", "已实现，依赖公网地址"],
        ["常驻待命", "任务结束后回到 idle，不直接退出脚本", "已实现"],
    ], [2100, 5200, 2060]))

    body.append(para("6. 后台功能介绍", "h1"))
    body.append(table([
        ["页面", "面向产品的作用", "当前状态"],
        ["监控看板", "查看设备数、运行数、今日采集、今日异常、最近心跳和最近日志", "已实现基础版"],
        ["设备", "查看每台手机是否在线、最近心跳、版本、最后命令，并下发控制命令", "已实现基础版"],
        ["采集记录", "查看手机采集到的视频或直播候选记录", "已实现基础版"],
        ["日志", "查看脚本运行日志，用于排查卡住、异常、上传失败等问题", "已实现基础版"],
        ["任务配置", "管理采集任务的关键词、时长和基础策略", "已实现基础版"],
    ], [1800, 5660, 1900]))

    body.append(para("7. 数据与监控口径", "h1"))
    body.append(table([
        ["数据类型", "内容", "产品用途"],
        ["采集记录", "平台、视频/直播类型、关键词、标题、作者、互动指标、评论、屏幕文本", "判断是否采集到农业相关内容"],
        ["心跳", "当前状态、运行阶段、已浏览数量、采集数量、剩余时间、版本", "判断手机是否在线和任务是否正常"],
        ["运行日志", "启动、暂停、停止、异常、上传结果、风险停止原因", "排查脚本运行问题"],
        ["命令记录", "后台下发命令、手机是否拉取、是否执行成功", "判断远程控制是否生效"],
        ["版本事件", "手机版本检查、发现新版本、更新事件", "支撑后续远程更新"],
    ], [1800, 4700, 2860]))

    body.append(para("8. 风险识别与安全边界", "h1"))
    body.append(para("本项目不做验证码绕过、不做自动点赞评论关注私信、不承诺平台账号标签结果。系统只能展示浏览和采集证据，不能证明平台最终如何识别账号。", "body"))
    body.append(para("会议里提到的动作轨迹、批量运行、同一出口 IP 等风险，当前按“降低风险和持续优化”处理：脚本动作需要做随机化和节奏控制，运行中发现异常要能停下来并留下日志，但系统不能承诺完全规避平台检测。", "body"))
    body.append(table([
        ["场景", "当前处理方式"],
        ["验证码、安全验证、滑块", "停止自动操作，记录日志，等待人工处理"],
        ["登录异常、账号异常", "停止任务并上报后台"],
        ["页面跑偏", "尝试返回视频流，超过次数后停止"],
        ["网络不可用", "本地保存关键记录，恢复后再补传"],
        ["后台不可达", "脚本不应被后台请求卡死，继续本地运行"],
        ["动作轨迹或批量行为风险", "通过随机停留、随机滑动和分散网络降低风险，真实效果需要持续观察"],
    ], [2600, 6760]))

    body.append(para("9. 部署与通信说明", "h1"))
    body.append(para("手机使用流量或分散到不同地区后，无法访问本机私网地址。短期演示可用 frp 把本机 API 端口映射到服务器公网端口；正式运行建议把后台部署到云服务器，并使用域名和 HTTPS。", "body"))
    body.append(table([
        ["方案", "说明", "适用阶段"],
        ["内网穿透", "本机后台仍在本地运行，通过服务器 frp 暴露公网访问地址", "演示和短期验证"],
        ["云服务器部署", "后台 API 和前端部署到公网服务器，手机直接访问域名", "正式运行"],
        ["HTTPS 域名", "用域名和证书保护通信，便于多地区手机长期运行", "长期运行"],
    ], [1900, 5460, 2000]))
    body.append(para("手机可以使用流量，也可以使用 Wi-Fi；通信方案本身不强制某一种网络。产品上要注意的是，大量手机长期共用同一个出口 IP 不适合作为正式运行方式。", "body"))

    body.append(para("10. 当前状态与后续计划", "h1"))
    body.append(table([
        ["模块", "已完成", "待完成"],
        ["手机脚本", "模块化、农业搜索、视频/直播阶段、本地输出、心跳、远程控制、极简悬浮按钮", "继续适配不同手机和抖音版本"],
        ["后台监控", "看板、设备、采集记录、日志、任务配置、命令下发、版本字段", "补设备详情页，细化命令回执展示"],
        ["远程通信", "手机端接口和后台接口已具备", "打通公网地址，验证流量手机持续上报"],
        ["版本管理", "版本发布表、版本检查接口、更新事件已具备", "实现脚本文件替换、校验、备份和回滚"],
        ["风险处理", "风险词检测、异常停止、日志上报已具备", "通过真实运行继续优化识别准确率"],
    ], [1600, 4900, 2860]))

    body.append(para("11. 产品验收关注点", "h1"))
    body.append(table([
        ["验收点", "判断方式"],
        ["手机是否在线", "设备页最后心跳是否持续更新"],
        ["脚本是否在跑", "看板最近心跳是否显示运行阶段、浏览数量和采集数量"],
        ["是否采到农业内容", "采集记录是否出现农业关键词、标题和屏幕文本"],
        ["远程控制是否生效", "后台命令是否从待拉取变成已执行或失败"],
        ["异常是否可排查", "日志页是否能看到停止原因、风险词、页面恢复记录"],
        ["公网通信是否成功", "手机使用流量时，后台仍能收到心跳和日志"],
    ], [2600, 6760]))

    sect = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<w:body>{''.join(body)}{sect}</w:body></w:document>"""


def build_docx():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    OUT_MD.write_text(md_content(), encoding="utf-8")
    document_xml = build_document_xml()
    rels_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/agri_collection_flow.png"/>
<Relationship Id="rIdImage2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/remote_control_flow.png"/>
</Relationships>"""
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>"""
    package_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>"""
    core = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:dcmitype="http://purl.org/dc/dcmitype/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>农业内容采集与账号数据管理平台产品说明</dc:title>
<dc:creator>Codex</dc:creator>
<cp:lastModifiedBy>Codex</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">2026-06-04T00:00:00Z</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">2026-06-04T00:00:00Z</dcterms:modified>
</cp:coreProperties>"""
    app = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
 xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Application>Codex</Application></Properties>"""
    with zipfile.ZipFile(OUT_DOCX, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", package_rels)
        z.writestr("word/document.xml", document_xml)
        z.writestr("word/_rels/document.xml.rels", rels_xml)
        z.writestr("docProps/core.xml", core)
        z.writestr("docProps/app.xml", app)
        z.write(FLOW_IMAGE, "word/media/agri_collection_flow.png")
        z.write(CONTROL_IMAGE, "word/media/remote_control_flow.png")


if __name__ == "__main__":
    create_flow_images()
    build_docx()
    print(json.dumps({
        "docx": str(OUT_DOCX),
        "markdown": str(OUT_MD),
        "flowImage": str(FLOW_IMAGE),
        "controlImage": str(CONTROL_IMAGE),
    }, ensure_ascii=False, indent=2))
