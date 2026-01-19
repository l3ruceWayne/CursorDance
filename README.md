# CursorDance


## 🔍 项目简介

一个提升开发效率的 VS Code/Cursor 扩展，让你在 Cursor 和 VS Code 之间实现丝滑切换。现只保证在 macos 上能正常工作。

## 🌟 功能特性

- 🚀 无缝编辑器切换

  - 在 Cursor 和 VS Code 之间一键切换
  - 自动定位到相同的光标位置（行号和列号）
- ⌨️ 便捷的快捷键支持

  - macOS:
    - `Option+Shift+P` - 在另一个编辑器中打开项目
    - `Option+Shift+O` - 在另一个编辑器中打开当前文件
    - 以上两个快捷键都需要对应应用程序打开才能生效

## 🛠️ 安装指南

### 本地安装

1. 下载最新版扩展包
2. 在 VS Code/Cursor 中，选择 `Extensions` → `...` → `Install from VSIX`
3. 选择下载的扩展包完成安装

## 🚀 使用说明

### 基础使用

#### 打开项目

- 快捷键：`Alt+Shift+P`
- 右键菜单：在文件浏览器中右键 → `Open Project in Other Editor`

#### 打开当前文件

- 快捷键：`Alt+Shift+O`
- 右键菜单：
  - 在编辑器中右键 → `Open File in Other Editor`
  - 在文件浏览器中右键 → `Open File in Other Editor`

### 配置

可选，仅当自动识别失败时需要配置：

- `switch2cursor.cursorPath`：Cursor 可执行文件路径 / CLI 命令 / macOS App 名称
- `switch2cursor.vscodePath`：VS Code 可执行文件路径 / CLI 命令 / macOS App 名称

### 环境要求

- Cursor 1.93.1+
- VS Code 1.93.1+
- 如需双向切换，请在两个编辑器里都安装本扩展

## 🧑‍💻 开发者指南

欢迎提交 Issue 和 Pull Request 来改进这个扩展。