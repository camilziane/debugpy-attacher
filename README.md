# DebugPy Attacher 🐍🔧

A powerful VS Code extension that automatically detects and attaches to Python debugpy processes, making remote debugging effortless and seamless.

![VS Code Extension Version](https://img.shields.io/visual-studio-marketplace/v/DebugPyAttacher.debugpy-attacher)
![VS Code Extension Installs](https://img.shields.io/visual-studio-marketplace/i/DebugPyAttacher.debugpy-attacher)
![License](https://img.shields.io/github/license/camilziane/debugpy-attacher)

![Demo](debug-attach.gif)

## ✨ Features

- 🔍 **Auto-detection** of debugpy processes running on your system
- ⚡ **Zero/One-click attachment** to discovered processes

## 🚀 Quick Start

### 1. Add DebugPy Attach to Your Code

Use one of these methods to add debugpy attachment code:

**Method A: Keyboard Shortcuts**

- `Cmd+K B` (Mac) / `Ctrl+K B` (Windows/Linux) - Insert debugpy attachment code
- `Cmd+K Shift+B` / `Ctrl+K Shift+B` - Insert debugpy attachment code with breakpoint

**Method B: Code Snippets**

- Type `debugpy` + Tab - Insert debugpy attachment code
- Type `debugpyb` + Tab - Insert debugpy attachment code with breakpoint

**Method C: Command Palette**

- `Cmd+Shift+P` → "Debugpy: Insert Attach Code"

### 2. Run Your Python Application

Execute your Python script from anywhere (terminal, IDE, command line, etc.):

```bash
python your_script.py
```

### 3. Attach the Debugger

The extension will automatically detect your debugpy process. Choose from:

- **Auto-Attach**: Enable in settings to automatically connect to new processes
- **Status Bar**: Click the debugpy indicator in the bottom-right corner
- **Manual**: `Cmd+Shift+P` → "Debugpy: Attach to Process"

## ⚙️ Configuration

Open VS Code settings and search for "debugpy" to configure:

| Setting | Default | Description |
|---------|---------|-------------|
| `debugpyAttacher.enableLiveMonitoring` | `true` | Enable background monitoring of debugpy processes |
| `debugpyAttacher.autoAttach` | `true` | Automatically attach to new debugpy processes |
| `debugpyAttacher.showRulerDecorations` | `true` | Show visual indicators in the overview ruler |
| `debugpyAttacher.defaultPort` | `5678` | Default port for keyboard shortcut |

## 🎮 Commands

Access these commands via `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux):

| Command | Description |
|---------|-------------|
| `Debugpy: Attach to Process` | Manually attach to a debugpy process |
| `Debugpy: Insert Attach Code` | Insert debugpy attachment code at cursor |
| `Debugpy: Insert Attach Code with Breakpoint` | Insert code with automatic breakpoint |
| `Debugpy: Toggle Live Monitoring` | Enable/disable background process detection |
| `Debugpy: Toggle Auto-Attach` | Enable/disable automatic attachment |
| `Debugpy: Clean Attach Regions (Current File)` | Remove debugpy regions from active file |
| `Debugpy: Clean All Attach Regions (Workspace)` | Remove all debugpy regions from workspace |

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K B` / `Ctrl+K B` | Insert attach code |
| `Cmd+K Shift+B` / `Ctrl+K Shift+B` | Insert attach code with breakpoint |

*Note: Shortcuts only work in Python files*

## 🐍 Requirements

- **Python** with `debugpy` installed:

  ```bash
  pip install debugpy
  ```

- **VS Code** version 1.74.0 or higher
- **Platform**: macOS, Linux, or Windows



## 🌟 Show Your Support

If this extension helps you, please:

- ⭐ Star the [GitHub repository](https://github.com/camilziane/debugpy-attacher)
- 📝 [Leave a review](https://marketplace.visualstudio.com/items?itemName=DebugPyAttacher.debugpy-attacher)
- 🐦 Share on social media

## 🔄 Changelog

See [CHANGELOG.md](CHANGELOG.md) for a detailed history of changes.

---

**Happy Debugging!** 🎉
