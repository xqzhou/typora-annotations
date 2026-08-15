# Typora Annotations

为 macOS Typora 添加不修改 Markdown 原文的本地高亮与划词评论。

## 运行方式

本目录是源码目录，也是唯一应该直接修改的地方。Typora **不会动态加载本目录**，项目也没有单独的编译或打包步骤。安装脚本会把源码复制到应用及用户支持目录：

| 源文件 | 安装位置 |
| --- | --- |
| `typora-annotations.js`、`typora-annotations.css` | `/Applications/Typora.app/Contents/Resources/TypeMark/` |
| `tools/typora_annotations.py` | `~/Library/Application Support/Typora Annotations/` |
| `launchd/io.local.typora-annotations.helper.plist` | `~/Library/LaunchAgents/` |
| `skill/typora-annotations/` | `~/.agents/skills/typora-annotations/`，并链接到 `~/.codex/skills/` |

安装器还会修改 Typora app 内的 `index.html`，使其加载复制后的 JS/CSS，然后重新签名整个应用。因此，修改本目录后必须重新运行安装脚本并重启 Typora；不要直接编辑 `/Applications/Typora.app` 内的副本。

## 使用

- 选中文字后，点击浮动工具条里的“高亮”或“评论”。
- 正文和 fenced code block 都支持划词高亮与评论。
- 点击窗口右上角“批注”查看、定位、编辑或删除批注。
- 批注栏会占用窗口空间，不遮挡正文；拖动左侧分隔线可调整宽度。
- 批注界面自动继承当前 Typora 正文字体。
- 批注按原文路径保存为 `~/Documents/typora/annotations/**/*.annotations.json`；Markdown 文件本身不会发生变化。
- 批注栏底部显示当前 JSON 路径；“给 Agent”会复制一条可直接交给 agent 的提示词。

## Agent 访问

安装器会安装全局 `typora-annotations` skill。也可以直接使用 CLI：

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
/usr/bin/python3 test/storage.test.py
```

代码结构：

- `typora-annotations.js`：编辑器注入逻辑、锚点匹配、正文高亮、评论标记和侧栏交互。
- `typora-annotations.css`：高亮、评论标记和侧栏样式。
- `tools/typora_annotations.py`：本地 JSON 存储、CLI 和 localhost helper。
- `test/`：锚点及存储回归测试。
- `scripts/`：安装、支持组件安装和回滚脚本。
- `skill/`：安装给 agent 使用的批注读取与处理说明。

批注数据位于 `~/Documents/typora`，不属于本仓库。普通 UI 或定位修复不得删除、重写或提交这些文件。

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
codesign --verify --deep --strict /Applications/Typora.app
curl -s http://127.0.0.1:17373/v1/health
```

最后重新打开 Typora，并在正文、行内代码、跨行文本和 fenced code block 上做一次人工检查。

## 回滚

```bash
./scripts/uninstall.sh /Applications/Typora.app
```

回滚会恢复官方 app，并把修改版保留为 `/Applications/Typora-<版本>-annotations-removed.backup`。它不会删除 `~/Documents/typora` 中的批注数据。
