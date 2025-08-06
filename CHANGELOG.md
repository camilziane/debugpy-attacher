# Changelog

All notable changes to the "DebugPy Attacher" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2025-08-06

### ✨ Added

- **Multi-User Support**: The extension is now fully compatible with multi-user environments like SSH.
  - It detects the user owning each `debugpy` process.
  - The process list now indicates which processes belong to the current user.
  - A warning is displayed before attaching to a process owned by another user.
- **Process Visibility Setting**: Added a new setting `debugpyAttacher.hideProcessesFromOtherUsers` (default: `true`) to show or hide processes from other users.
- **Toggle Command**: Added the `Debugpy: Toggle Hiding Processes from Other Users` command to easily change the visibility of external processes.

### ♻️ Changed

- The "Attach to Process" command now always shows the process selection list, even if only one process is found, for a more consistent experience.
- Auto-attach will now only connect to processes owned by the current user.
- Simplified the process information in the Quick Pick list to show Port, User, and PID.

### 🔒 Security

- Added a user-specific lock directory (`/tmp/debugpy-attacher-locks-<user>`) to prevent conflicts between users on the same machine.

## [1.1.1] - 2025-06-07

### Changed
- Auto-attach is now enabled by default for improved user experience

## [1.1.0] - 2025-06-07

### Added
- Live monitoring of debugpy processes in the background
- Auto-attach functionality (Beta) to automatically connect to new debugpy processes
- Visual decorations and ruler indicators for debugpy attach regions
- Code snippets for quick debugpy setup
- Keyboard shortcuts for inserting attach code (`Ctrl+K B` / `Cmd+K B`)
- Keyboard shortcuts for inserting attach code with breakpoint (`Ctrl+K Shift+B` / `Cmd+K Shift+B`)
- Configuration options for customizing extension behavior
- Commands to clean attach regions from files (current file and workspace-wide)
- Multi-platform support (Windows, macOS, Linux)

### Features
- **Commands**:
  - `Debugpy: Attach to Process` - Manually attach to a debugpy process
  - `Debugpy: Toggle Live Monitoring` - Enable/disable background monitoring
  - `Debugpy: Toggle Auto-Attach` - Enable/disable automatic attachment
  - `Debugpy: Clean Attach Regions (Current File)` - Remove debugpy code from active file
  - `Debugpy: Clean All Attach Regions (Workspace)` - Remove all debugpy code from all workspace files
  - `Debugpy: Insert Attach Code` - Add debugpy setup code
  - `Debugpy: Insert Attach Code with Breakpoint` - Add debugpy setup with breakpoint

- **Configuration Options**:
  - `debugpyAttacher.enableLiveMonitoring` - Control background process monitoring
  - `debugpyAttacher.autoAttach` - Enable automatic attachment to new processes
  - `debugpyAttacher.showRulerDecorations` - Toggle visual indicators in editor
  - `debugpyAttacher.defaultPort` - Set default port for debugpy connections

### Technical
- TypeScript-based implementation
- VS Code API compatibility: ^1.74.0
- Python language activation events
- Integrated snippet support
- Cross-platform compatibility (Windows, macOS, Linux)

---

## Release Notes

### 1.1.0
This release introduces comprehensive debugpy process management with live monitoring, auto-attach capabilities, and enhanced developer experience through visual indicators and keyboard shortcuts.

The extension now provides a complete workflow for Python debugging with debugpy, from code insertion to automatic process detection and attachment. Fully compatible across Windows, macOS, and Linux platforms.

### 1.1.1
This patch update changes the default behavior of the auto-attach feature, enabling it by default for all users to streamline the debugging process. The "Beta" label has been removed, indicating that the feature is stable and ready for production use.

