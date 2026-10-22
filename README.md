---
title: Travel Poster Studio
emoji: 🗺️
colorFrom: yellow
colorTo: orange
sdk: docker
app_port: 8080
pinned: false
---

# 旅游图工坊

双击 `start.cmd` 打开 <http://127.0.0.1:4173>。三个按钮对应三类图，主路径是 **AI 直出复刻**：把你的提示词 + 参考图一起交给 GPT Image 2.5，出来就是参考图那种版式和笔触。

## 主路径：AI 直出复刻

| 模板 | 你给什么 | 参考图 | 出图尺寸 |
|---|---|---|---|
| 01 背景印字 | 一张照片 + 标题 | `assets/ref-type1.png` | 944×1392（≈943×1382） |
| 02 信息成页 | 标题/副标题 + 内容表 | `assets/ref-type2.png` | 1152×1536（3:4） |
| 03 地图打标 | 标题 + 点位表 | `assets/ref-type3.png` | 1152×1536（3:4） |

点「AI 直出复刻」→ 约 1 分钟出图，结果直接盖在预览区，可打开原图另存。提示词是按参考图拆出来的完整版（对应 `prompts/p1.txt`~`p3.txt`），会随表单内容自动填。

三条提示词就是原始需求的落地：
1. 竖版 943×1382、手绘毛笔艺术字、横向铺满、位于画面中段；
2. 3:4 信息流承接页、纸感手账、四栏表格、文字不顶边；
3. 水彩中国地图 + 宝丽来卡片 + 虚线引线 + 观鸟贴士。

## 只给主题 + 一段文字

每个模板顶部有「只给主题 + 一段文字」：主题写一句（红叶追秋 / 观候鸟），正文整段粘进去。

- **模型自己拆（默认）**：正文原样丢给 GPT Image 2.5，由它通读全文、提炼标题、挑目的地、压出每处 12 字内的亮点、归纳小贴士，再按模板排版。理解力全交给模型，中间不过手。
- **先解析再套用（备选）**：用本地规则把正文拆成字段填进表单，适合命名式 `日本：秋日红叶 + 初冬雪景` 或政策式 `陕西…即日起至10月25日…60岁+免票`；拆完可以先改再出图，也能省 token。

主题词会自动映射风格（红叶→暖橙枫叶、候鸟→蓝绿水彩、极光→深蓝、海岛→碧海）。

## 地图准确性与数量校准

- **真实地图模式（默认开）**：提示词让模型把画面中部留白，生成后用 GIS 国界数据 + 经纬度点位叠上去（`lib/composite.mjs`）。中国用 `assets/china-full.json`（省级），全球用 `assets/world.json`（Natural Earth 110m 国界），按主题自动切暖色/冷色。地图来自真实投影，不靠模型"画得像"。
- **标签避让**：点位标签只允许落在地图区内，且互不重叠；放不下就自动缩字号，不会压到外面的照片卡片。
- **数量校准**：出图前把"文中一共 N 个地点"写死进提示词；出图后再走一次校准（`/api/calibrate`），让模型把标题里的数字改回 N、删掉多出来的卡片。
- 完整链路：生成（约 60s）→ 校准（约 60s）→ 叠加地图（约 5s）。两个开关都在「只给主题 + 一段文字」下面。

## 换主题（03 地图打标）

模板 03 拆成「骨架」和「风格」两层：骨架固定（水彩地图 + 图钉 + 宝丽来卡片 + 虚线引线 + 手写旁白 + 右下贴士卡），风格由「风格主题」一栏控制——填什么就换什么配色、装饰和气质，地图范围也能从中国换成全球/欧洲等。

例：主题填「红叶追秋：枫叶红、银杏金、赭石橙与米色纸感，暖橙到浅米的天光渐变，飘落枫叶」，地图范围填「全球」，点位换成 10 个国家，就能出秋季旅行手账那种封面（见 `out/theme-autumn-global.png`）。

## 备用路径：模板排版（秒出、可编辑）

右侧预览是 HTML/CSS 模板，改字改数字实时更新、2 倍导出。适合表格式内容需要逐字准确、或不想等模型的时候。差别也说清楚：模板出的字是字体排版，笔触质感不如模型直出。

- 01：文字排版 / AI 艺术字（透明底毛笔字合成）
- 02：行数变化自动缩放、自动分 Part，粘整段公告可「整理成表格」
- 03：真实国界数据投影的水彩地图，按经纬度打点，近邻自动挤开

## 模型

内置免费 **GPT Image 2.5（Flare）**，走 Chengxiaobang 授权，不用配 key。要换 Nano Banana 2 改 `server.mjs` 的 `generateImage()`。

## 目录

- `public/` 工作台；`server.mjs` 本地服务（预览/导出/AI 代理）
- `lib/type1-3.mjs` 模板、`lib/map.mjs` 地图、`lib/shot.mjs` 截图
- `prompts/` 三套直出提示词；`assets/ref-type*.png` 三张风格参考
- `out/` 成品：`replica-1~3.png` 是这次的 1:1 复刻结果

## 部署成独立网站

代码已支持脱离本机运行，生图服务商通过环境变量切换：

| 变量 | 值 | 说明 |
|---|---|---|
| `IMAGE_PROVIDER` | `local` / `openai` / `gemini` | 本地开发用 local（走内置通道），线上用 openai 或 gemini |
| `OPENAI_API_KEY` | sk-... | `IMAGE_PROVIDER=openai` 时必填 |
| `GEMINI_API_KEY` | ... | `IMAGE_PROVIDER=gemini` 时必填 |
| `OPENAI_IMAGE_MODEL` | 默认 `gpt-image-1` | 可改 |
| `GEMINI_IMAGE_MODEL` | 默认 `gemini-3-pro-image-preview` | 可改 |
| `PORT` / `HOST` | 8080 / 0.0.0.0 | 容器平台一般自动注入 PORT |

**Render 一键部署**：仓库里有 `Dockerfile` 和 `render.yaml`。把项目推到 GitHub → Render 新建 Blueprint → 选这个仓库 → 填 `GEMINI_API_KEY` → 部署完成后得到 `https://<name>.onrender.com`。之后每次 `git push` 自动重新部署，不需要登录服务器。

健康检查：`GET /api/health` 返回 `{ ok, provider }`。

注意两点：容器里没有 Windows 字体，模板排版里的行楷/楷体会回退到 Noto CJK（01 走 AI 字层，不受影响）；生成的图片写在容器临时磁盘，重新部署会清空，用户出的图要及时下载。

## 免费部署（Hugging Face Spaces）

1. 注册 huggingface.co（免费），New → Space → SDK 选 **Docker** → 模板 Blank。
2. 把本项目文件推到该 Space 仓库（网页上传或 git push）。
3. 在 Space 的 Settings → Variables and secrets 里加：
   - `IMAGE_PROVIDER` = `gemini`
   - `GEMINI_API_KEY` = 你在 Google AI Studio 免费申请的 key
4. 构建完成后访问 `https://<用户名>-<space名>.hf.space`。

免费版说明：空间闲置后会休眠，首次打开需要等几十秒启动；公开 Space 的代码可见；内存 16GB，跑 Chromium 没问题。每次 `git push` 会自动重新构建。
