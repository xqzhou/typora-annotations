# Typora Annotations

为 macOS Typora 添加不修改 Markdown 原文的本地高亮与划词评论。

## 运行方式

本目录是源码目录，也是唯一应该直接修改的地方。Typora **不会动态加载本目录**，项目也没有单独的编译或打包步骤。安装脚本会把源码复制到应用及用户支持目录：

| 源文件 | 安装位置 |
| --- | --- |
| `typora-annotations.js`、`typora-annotations-svg.js`、`typora-annotations.css` | `/Applications/Typora.app/Contents/Resources/TypeMark/` |
| `tools/typora_annotations.py` | `~/Library/Application Support/Typora Annotations/` |
| `launchd/io.local.typora-annotations.helper.plist` | `~/Library/LaunchAgents/` |
| `skill/typora-annotations/` | `~/.agents/skills/typora-annotations/`，并链接到 `~/.codex/skills/` 和 `~/.gemini/config/skills/`（Antigravity） |

安装器还会修改 Typora app 内的 `index.html`，使其加载复制后的 JS/CSS，然后重新签名整个应用。因此，修改本目录后必须重新运行安装脚本并重启 Typora；不要直接编辑 `/Applications/Typora.app` 内的副本。

## 使用

- 选中文字后，点击浮动工具条里的“高亮”或“评论”。
- 正文和 fenced code block 都支持划词高亮与评论。
- 本地 SVG 图片右上角有“批注此图”：点选文字、形状、箭头，或切到“框选”拖出区域，再选“高亮”或“评论”；点击“完成”或按 Esc 退出图内操作。
- 本地 SVG 的显示字体由扩展统一管理：普通文字使用 Avenir Next（中文回退到苹方），等宽文字、命令、邮箱与服务账号标识使用 Source Code Pro；新生成的图片自动应用，源文件不改写。原图的字号层级保留，较宽的替换字体会适当缩小以适配原有文字宽度，批注定位和侧栏预览使用同一显示层。
- 字体主题适用于由标准 SVG 文字和矢量元素组成的图片；包含 `foreignObject`、嵌入位图、滤镜等当前交互层不能完整重现的内容时保留原图显示，避免丢失图形。文字已转为路径的 SVG 无法替换字体。
- SVG 批注在右侧批注栏中标明图片和目标类型，点击可以定位。批注与 Markdown 文档关联，SVG 和 Markdown 原文件都不会被改写。
- SVG 更新后，优先按唯一元素 ID、文字或形状属性重新定位；存在歧义时显示“图中对象已变化或暂时无法读取”。框选区域只在 SVG 内容未改变时恢复。
- 点击窗口右上角“批注”查看、定位、编辑或删除批注。
- 批注栏会占用窗口空间，不遮挡正文；拖动左侧分隔线可调整宽度。
- 批注界面自动继承当前 Typora 正文字体。
- 批注按原文路径保存为 `~/Documents/typora/annotations/**/*.annotations.json`；Markdown 文件本身不会发生变化。
- 批注栏底部显示当前 JSON 路径；“给 Agent”会复制一条可直接交给 agent 的提示词。

## Agent 访问

安装器会安装全局 `typora-annotations` skill。

SVG 批注的 JSON 包含 `scope: "svg"`、图片路径、目标元素（或 SVG 坐标区域）及原图指纹，Agent 可据此检查 SVG 源码。第一版支持用 Markdown 图片语法或 HTML `img` 引用的本地 `.svg`，不支持远程图片、内联 SVG、文字已转为路径后的字符划选，也不自动推断未分组的业务模块。SVG 交互层只解析被动图形、文字和样式，不运行 SVG 脚本或加载外部资源。

Codex 和 Antigravity 共用同一份 skill；安装后在 Antigravity 新开对话即可使用。CLI 的 `list` 直接扫描批注 JSON，索引缓存不可读或过期不会影响发现批注。单个批注 JSON 保存成功后，索引更新失败也不会禁用“给 Agent”。

也可以直接使用 CLI：

```bash
python3 "$HOME/Library/Application Support/Typora Annotations/typora_annotations.py" list
python3 "$HOME/Library/Application Support/Typora Annotations/typora_annotations.py" show /absolute/path/to/document.md --json
python3 "$HOME/Library/Application Support/Typora Annotations/typora_annotations.py" path /absolute/path/to/document.md
```

JSON 使用可读的镜像目录。例如：

```text
/Users/alice/Workspace/project/notes.md
→ ~/Documents/typora/annotations/Workspace/project/notes.md.annotations.json
```

已有 LocalStorage 批注会在第一次打开对应文档时自动迁移到 JSON。helper 暂时不可用时，修改仍会留在 LocalStorage，恢复连接后可继续保存。
删除最后一条批注时，对应的空 JSON 和索引记录也会自动清理。

## 开发与验证

修改源码后先运行完整检查：

```bash
node --check typora-annotations.js
node test/annotations.test.js
node --check typora-annotations-svg.js
node test/svg.test.js
/usr/bin/python3 test/storage.test.py
```

代码结构：

- `typora-annotations.js`：编辑器注入逻辑、锚点匹配、正文高亮、评论标记和侧栏交互。
- `typora-annotations-svg.js`：SVG 被动交互层、点选与框选、元素匹配和图内批注定位。
- `typora-annotations.css`：高亮、评论标记和侧栏样式。
- `tools/typora_annotations.py`：本地 JSON 存储、CLI 和 localhost helper。
- `test/`：锚点及存储回归测试。
- `scripts/`：安装、支持组件安装和回滚脚本。
- `skill/`：安装给 agent 使用的批注读取与处理说明。

批注数据位于 `~/Documents/typora`，不属于本仓库。普通 UI 或定位修复不得删除、重写或提交这些文件。

浏览器回归测试使用临时文档和模拟批注服务，不访问用户批注。安装 Playwright 和 Chrome 后运行 `node test/svg-browser.test.js`；也可用 `TYPORA_PLAYWRIGHT_PATH` 指定 Playwright 包路径、`TYPORA_CHROME_PATH` 指定浏览器路径。

供 coding agent 使用的更严格操作约定见 [`AGENTS.md`](AGENTS.md)。

## 安装

保存工作并退出 Typora，然后运行：

```bash
./scripts/install.sh /Applications/Typora.app
```

安装器会先在 `/private/tmp` 生成完整暂存副本，保留官方 App 为 `/Applications/Typora-<版本>-original.backup`，然后注入独立的 JS/CSS 文件并对修改版做本机 ad-hoc 签名。它还会安装只监听 `127.0.0.1:17373` 的 JSON helper、LaunchAgent 和全局 skill。

由于 ad-hoc 签名没有 Team ID，签名会对该 App 开启 `disable-library-validation`，以便主程序继续加载包内的 Sparkle 框架；它不会修改系统全局安全设置。Typora 更新会覆盖扩展，需要重新运行安装器。

安装完成后可验证源码和安装副本、应用签名及 helper：

```bash
cmp -s typora-annotations.js /Applications/Typora.app/Contents/Resources/TypeMark/typora-annotations.js
cmp -s typora-annotations.css /Applications/Typora.app/Contents/Resources/TypeMark/typora-annotations.css
cmp -s typora-annotations-svg.js /Applications/Typora.app/Contents/Resources/TypeMark/typora-annotations-svg.js
codesign --verify --deep --strict /Applications/Typora.app
curl -s http://127.0.0.1:17373/v1/health
```

最后重新打开 Typora，并在正文、行内代码、跨行文本和 fenced code block 上做一次人工检查。

## 回滚

```bash
./scripts/uninstall.sh /Applications/Typora.app
```

回滚会恢复官方 app，并把修改版保留为 `/Applications/Typora-<版本>-annotations-removed.backup`。它不会删除 `~/Documents/typora` 中的批注数据。
