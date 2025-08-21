# DebugPy Attacher 🐍🔧

A powerful VS Code extension that automatically detects and attaches to Python debugpy processes, making remote debugging effortless and seamless, even in multi-user environments.

![VS Code Extension Version](https://img.shields.io/visual-studio-marketplace/v/DebugPyAttacher.debugpy-attacher)
![VS Code Extension Installs](https://img.shields.io/visual-studio-marketplace/i/DebugPyAttacher.debugpy-attacher)
![License](https://img.shields.io/github/license/camilziane/debugpy-attacher)

![Demo](debug-attach.gif)

## ✨ Features

- 🔍 **Auto-detection** of debugpy processes running on your system and Docker containers.
- ⚡ **One-click attachment** to discovered processes.
- 🐳 **Docker Support** with automatic container process detection.
- 🛡️ **Multi-User Support** for shared environments (like SSH), with process isolation and clear ownership display.
- 📝 **Launch.json Integration** with easy configuration management and JSONC support.
- ⚙️ **Highly configurable** to suit your workflow.

## 🚀 Quick Start

### 1. Add DebugPy Attach to Your Code

Use one of these methods to add debugpy attachment code:

#### Method A: Keyboard Shortcuts

- `Cmd+K B` (Mac) / `Ctrl+K B` (Windows/Linux) - Insert debugpy attachment code
- `Cmd+K Shift+B` / `Ctrl+K Shift+B` - Insert debugpy attachment code with breakpoint

#### Method B: Code Snippets

- Type `debugpy` + Tab - Insert debugpy attachment code
- Type `debugpyb` + Tab - Insert debugpy attachment code with breakpoint

#### Method C: Command Palette

- `Cmd+Shift+P` → "Debugpy: Insert Attach Code"

### 2. Run Your Python Application

Execute your Python script from anywhere (terminal, IDE, command line, etc.):

```bash
python your_script.py
```

### 3. Attach the Debugger

The extension will automatically detect your debugpy process. Choose from:

- **Auto-Attach**: Enable in settings to automatically connect to new processes owned by you.
- **Status Bar**: Click the debugpy indicator in the bottom-right corner.
- **Manual**: `Cmd+Shift+P` → "Debugpy: Attach to Process".

## ⚙️ Configuration

Open VS Code settings and search for "debugpy" to configure:

| Setting | Default | Description |
|---------|---------|-------------|
| `debugpyAttacher.enableLiveMonitoring` | `true` | Enable background monitoring of debugpy processes. |
| `debugpyAttacher.autoAttach` | `true` | Automatically attach to new debugpy processes owned by the current user. |
| `debugpyAttacher.autoAttachRetryInterval` | `1000` | Auto-attach retry interval in milliseconds (500-10000ms). |
| `debugpyAttacher.suppressConnectionErrors` | `true` | Suppress connection error notifications during auto-attach attempts. |
| `debugpyAttacher.hideProcessesFromOtherUsers` | `true` | Hide processes from other users in the status bar and process list. |
| `debugpyAttacher.showRulerDecorations` | `true` | Show visual indicators for attach regions in the overview ruler. |
| `debugpyAttacher.defaultPort` | `5678` | Default port for the "Insert Attach Code" command. |

You can set default options in `launch.json` with a configuration that has `"debugpyAttacher": true`.

Use the command `Debugpy: Insert Default Launch Configuration` to automatically create a launch.json configuration, or use the `debugpy` snippet in launch.json files.

## 🐳 Docker Support

The extension automatically detects debugpy processes running inside Docker containers. This works by:

1. Reading port configurations from your `launch.json`
2. Detecting any process listening on those ports

No additional configuration required - just ensure your Docker containers expose the debugpy ports and they'll be detected automatically!

**Note**: Docker detection is currently supported on macOS and Linux only. Windows support is not available at this time.

## 🎮 Commands

Access these commands via `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux):

| Command | Description |
|---------|-------------|
| `Debugpy: Attach to Process` | Show a list of debugpy processes to attach to. |
| `Debugpy: Insert Default Launch Configuration` | Add a default debugpy configuration to launch.json. |
| `Debugpy: Toggle Hiding Processes from Other Users` | Toggle visibility of processes owned by other users. |
| `Debugpy: Insert Attach Code` | Insert debugpy attachment code at the cursor. |
| `Debugpy: Insert Attach Code with Breakpoint` | Insert code with an automatic breakpoint. |
| `Debugpy: Toggle Live Monitoring` | Enable/disable background process detection. |
| `Debugpy: Toggle Auto-Attach` | Enable/disable automatic attachment. |
| `Debugpy: Clean Attach Regions (Current File)` | Remove debugpy regions from the active file. |
| `Debugpy: Clean All Attach Regions (Workspace)` | Remove all debugpy regions from the workspace. |

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K B` / `Ctrl+K B` | Insert attach code. |
| `Cmd+K Shift+B` / `Ctrl+K Shift+B` | Insert attach code with a breakpoint. |

*Note: Shortcuts only work in Python files.*

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

