import * as vscode from 'vscode';
import { PythonProcess, PythonProcessService } from './pythonProcessService';
import { ConfigManager } from './config';
import { PortLockManager } from './portLockManager';

export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
  private checkInterval: NodeJS.Timeout | undefined;
  private autoAttachInterval: NodeJS.Timeout | undefined;
  private knownPorts = new Set<string>();
  private attachedPorts = new Set<string>();
  private connectingPorts = new Set<string>(); // Track ports currently being connected to
  private processService: PythonProcessService;
  private config: ConfigManager;
  private lockManager: PortLockManager;
  private isAutoAttaching = false;
  private debugSessionActive = false;
  private restartAutoAttachTimeout: NodeJS.Timeout | undefined;

  constructor(lockManager: PortLockManager) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'debugpy.attachToPort';
    this.statusBarItem.tooltip = 'Click to attach to debugpy process';

    this.processService = new PythonProcessService();
    this.config = ConfigManager.getInstance();
    this.lockManager = lockManager;
  }

  startMonitoring(): void {
    this.lockManager.markUserActivity();
    
    // Check if there's already an active debug session
    this.debugSessionActive = !!vscode.debug.activeDebugSession;
    
    this.updateStatusBar();

    if (this.config.isLiveMonitoringEnabled()) {
      this.checkInterval = setInterval(() => this.updateStatusBar(), 3000);
    }

    // Start auto-attach if enabled and no debug session is active
    if (this.config.isAutoAttachEnabled() && !this.debugSessionActive) {
      this.startAutoAttach();
    }
  }

  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
    this.stopAutoAttach();
  }

  restartMonitoring(): void {
    this.stopMonitoring();
    this.knownPorts.clear();
    this.attachedPorts.clear();
    this.connectingPorts.clear();
    this.startMonitoring();
  }

  async updateStatusBar(): Promise<void> {
    try {
      let processes = await this.processService.findPythonProcesses();

      if (this.config.shouldHideProcessesFromOtherUsers()) {
        processes = processes.filter(p => p.isCurrentUser);
      }

      const currentPorts = new Set(processes.map((p: PythonProcess) => p.port));

      if (processes.length > 0) {
        const ports = processes.map((p: PythonProcess) => p.port).join(', ');
        this.statusBarItem.text = `$(debug) Debugpy: ${ports}`;
        this.statusBarItem.show();

        if (this.config.isAutoAttachEnabled() && !this.isAutoAttaching) {
          this.startAutoAttach();
        }
      } else {
        this.statusBarItem.hide();
      }

      this.knownPorts = currentPorts;
    } catch (error) {
      this.statusBarItem.hide();
    }
  }

  private startAutoAttach(): void {
    if (this.isAutoAttaching || this.debugSessionActive) {
      return;
    }

    this.isAutoAttaching = true;
    this.attachedPorts.clear();
    this.connectingPorts.clear(); // Clear connecting ports on start

    const retryInterval = this.config.getAutoAttachRetryInterval();

    // Start the retry loop
    this.autoAttachInterval = setInterval(async () => {
      // Stop auto-attach if a debug session becomes active
      if (this.debugSessionActive) {
        this.stopAutoAttach();
        return;
      }
      await this.tryAutoAttach();
    }, retryInterval);

    // Also try immediately if no debug session is active
    if (!this.debugSessionActive) {
      this.tryAutoAttach();
    }
  }

  private stopAutoAttach(): void {
    if (this.autoAttachInterval) {
      clearInterval(this.autoAttachInterval);
      this.autoAttachInterval = undefined;
    }
    if (this.restartAutoAttachTimeout) {
      clearTimeout(this.restartAutoAttachTimeout);
      this.restartAutoAttachTimeout = undefined;
    }
    this.isAutoAttaching = false;
    this.attachedPorts.clear();
    this.connectingPorts.clear(); // Clear connecting ports on stop
  }

  private async tryAutoAttach(): Promise<void> {
    // Double-check that no debug session is active
    if (this.debugSessionActive || vscode.debug.activeDebugSession) {
      console.debug('Skipping auto-attach - debug session is active');
      return;
    }

    try {
      let processes = await this.processService.findPythonProcesses();

      if (this.config.shouldHideProcessesFromOtherUsers()) {
        processes = processes.filter(p => p.isCurrentUser);
      }

      // Get current valid ports
      const currentValidPorts = new Set(processes.map(p => p.port));
      
      // Remove attached ports that are no longer valid (process ended)
      for (const attachedPort of this.attachedPorts) {
        if (!currentValidPorts.has(attachedPort)) {
          this.attachedPorts.delete(attachedPort);
          console.debug(`Removed stale attached port: ${attachedPort}`);
        }
      }

      for (const process of processes) {
        // Skip if we've already attached to this port
        if (this.attachedPorts.has(process.port)) {
          continue;
        }

        // Skip if we're currently trying to connect to this port
        if (this.connectingPorts.has(process.port)) {
          console.debug(`Skipping port ${process.port} - connection already in progress`);
          continue;
        }

        // Final check - skip if there's any active debug session
        if (this.debugSessionActive || vscode.debug.activeDebugSession) {
          console.debug('Debug session detected during auto-attach, stopping');
          return;
        }

        // Try to attach silently
        const success = await this.silentAttach(process);
        if (success) {
          this.attachedPorts.add(process.port);
          vscode.window.showInformationMessage(
            `Successfully auto-attached to port ${process.port}`
          );
          
          // Stop auto-attach after successful attachment to prevent multiple connections
          this.stopAutoAttach();
          return;
        }
      }
    } catch (error) {
      // Silently handle errors during process discovery
      console.debug('Auto-attach process discovery error:', error);
    }
  }

  private async silentAttach(process: PythonProcess): Promise<boolean> {
    return new Promise((resolve) => {
      // Mark this port as being connected to
      this.connectingPorts.add(process.port);

      if (!this.lockManager.tryAcquirePortLock(process.port)) {
        this.connectingPorts.delete(process.port);
        resolve(false);
        return;
      }

      // Check if there's already an active debug session
      if (this.debugSessionActive || vscode.debug.activeDebugSession) {
        this.lockManager.releasePortLock(process.port);
        this.connectingPorts.delete(process.port);
        resolve(false);
        return;
      }

      const workspaceFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0] : undefined;
      const launchConfig = vscode.workspace.getConfiguration('launch', workspaceFolder?.uri);
      const configurations = launchConfig.get<vscode.DebugConfiguration[]>('configurations');

      let debugConfig: vscode.DebugConfiguration;
      const defaultConfigFromLaunch = configurations?.find(config =>
        config.debugpyAttacher === true
      );

      if (defaultConfigFromLaunch) {
        debugConfig = {
          ...defaultConfigFromLaunch,
          connect: {
            ...(defaultConfigFromLaunch.connect || {}),
            port: parseInt(process.port),
          },
          name: `Auto-attach to ${process.port}`,
        };
        if (!debugConfig.connect.host) {
          debugConfig.connect.host = 'localhost';
        }
      } else {
        debugConfig = {
          name: `Auto-attach to ${process.port}`,
          type: "python",
          request: "attach",
          connect: {
            host: "localhost",
            port: parseInt(process.port)
          },
          justMyCode: false,
          // Add timeout to prevent hanging
          timeout: 5000
        };
      }

      console.debug(`Attempting to attach to port ${process.port}`);

      // Start debug session without showing errors
      vscode.debug.startDebugging(workspaceFolder, debugConfig).then(
        (success) => {
          this.connectingPorts.delete(process.port);
          if (success) {
            console.debug(`Successfully attached to port ${process.port}`);
            // Release lock after 5 seconds to allow re-attachment if needed
            setTimeout(() => this.lockManager.releasePortLock(process.port), 5000);
            resolve(true);
          } else {
            console.debug(`Failed to attach to port ${process.port} - debug session not started`);
            this.lockManager.releasePortLock(process.port);
            resolve(false);
          }
        },
        (error) => {
          this.connectingPorts.delete(process.port);
          // Handle specific error types
          const errorMessage = error?.message || error?.toString() || '';
          
          // Log different error types for debugging
          if (errorMessage.includes('ECONNREFUSED')) {
            console.debug(`Port ${process.port} connection refused - service may not be ready yet`);
          } else if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
            console.debug(`Port ${process.port} connection timeout - service may be starting`);
          } else {
            console.debug(`Silent attach attempt failed for port ${process.port}:`, errorMessage);
          }
          
          this.lockManager.releasePortLock(process.port);
          resolve(false);
        }
      );
    });
  }

  private async handleAutoAttach(processes: PythonProcess[]): Promise<void> {
    // This method is kept for compatibility but is no longer used
    // The new auto-attach logic is handled by tryAutoAttach
  }

  async attachToDebugger(process: PythonProcess, isAutoAttach: boolean = false): Promise<vscode.DebugConfiguration | undefined> {
    if (!process.isCurrentUser && !isAutoAttach) {
      const confirmation = await vscode.window.showWarningMessage(
        `You are trying to attach to a process owned by another user (${process.user}). This may have security implications. Do you want to continue?`,
        { modal: true },
        'Yes'
      );

      if (confirmation !== 'Yes') {
        vscode.window.showInformationMessage('Attach operation cancelled.');
        return undefined;
      }
    }

    try {
      const workspaceFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0] : undefined;
      const launchConfig = vscode.workspace.getConfiguration('launch', workspaceFolder?.uri);
      const configurations = launchConfig.get<vscode.DebugConfiguration[]>('configurations');

      let debugConfig: vscode.DebugConfiguration;
      const defaultConfigFromLaunch = configurations?.find(config =>
        config.debugpyAttacher === true
      );

      if (defaultConfigFromLaunch) {
        debugConfig = {
          ...defaultConfigFromLaunch,
          connect: {
            ...(defaultConfigFromLaunch.connect || {}),
            port: parseInt(process.port),
          },
          name: `${defaultConfigFromLaunch.name}`,
        };
        if (!debugConfig.connect.host) {
          debugConfig.connect.host = 'localhost';
        }
      } else {
        debugConfig = {
          name: `Attach to Port ${process.port}`,
          type: "python",
          request: "attach",
          connect: {
            host: "localhost",
            port: parseInt(process.port)
          },
          justMyCode: false,
          console: "integratedTerminal"
        };
      }

      const success = await vscode.debug.startDebugging(workspaceFolder, debugConfig);

      if (success) {
        const msg = defaultConfigFromLaunch
          ? `Debugger attached to port ${process.port} using '${debugConfig.name}' configuration.`
          : `Debugger attached to port ${process.port}`;
        vscode.window.showInformationMessage(msg);
        return debugConfig;
      } else {
        throw new Error('Debug session failed to start');
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error attaching debugger: ${error}`);
      throw error;
    }
  }

  // Handle debug session start - pause auto-attach
  onDebugSessionStart(session: vscode.DebugSession): void {
    this.debugSessionActive = true;
    // Immediately stop auto-attach to prevent conflicts
    if (this.isAutoAttaching) {
      this.stopAutoAttach();
    }
    console.debug(`Debug session started: ${session.name} - auto-attach paused`);
  }

  // Clean up attached ports when debug sessions end
  onDebugSessionEnd(session: vscode.DebugSession): void {
    this.debugSessionActive = false;
    
    if (session.configuration?.connect?.port) {
      const port = session.configuration.connect.port.toString();
      this.attachedPorts.delete(port);
      this.connectingPorts.delete(port); // Also clear from connecting ports
      // Also remove from known ports to allow re-detection
      this.knownPorts.delete(port);
    }

    // Restart auto-attach after a delay to allow the debug infrastructure to clean up
    if (this.config.isAutoAttachEnabled() && !this.isAutoAttaching) {
      this.restartAutoAttachTimeout = setTimeout(() => {
        console.debug('Restarting auto-attach after debug session ended');
        this.startAutoAttach();
      }, 2000); // 2 second delay
    }
  }

  getStatusBarItem(): vscode.StatusBarItem {
    return this.statusBarItem;
  }

  dispose(): void {
    this.stopMonitoring();
    this.statusBarItem.dispose();
  }
}
