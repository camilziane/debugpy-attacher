import * as vscode from 'vscode';
import { PythonProcess, PythonProcessService } from './pythonProcessService';
import { ConfigManager } from './config';
import { PortLockManager } from './portLockManager';

export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
  private checkInterval: NodeJS.Timeout | undefined;
  private knownPorts = new Set<string>();
  private processService: PythonProcessService;
  private config: ConfigManager;
  private lockManager: PortLockManager;

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
    this.updateStatusBar();

    if (this.config.isLiveMonitoringEnabled()) {
      this.checkInterval = setInterval(() => this.updateStatusBar(), 3000);
    }
  }

  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
  }

  restartMonitoring(): void {
    this.stopMonitoring();
    this.knownPorts.clear();
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

        if (this.config.isAutoAttachEnabled()) {
          await this.handleAutoAttach(processes);
        }
      } else {
        this.statusBarItem.hide();
      }

      this.knownPorts = currentPorts;
    } catch (error) {
      this.statusBarItem.hide();
    }
  }

  private async handleAutoAttach(processes: PythonProcess[]): Promise<void> {
    const newProcesses = processes.filter((p: PythonProcess) => !this.knownPorts.has(p.port));

    for (const process of newProcesses) {
      if (process.isCurrentUser && !vscode.debug.activeDebugSession && this.lockManager.tryAcquirePortLock(process.port)) {
        try {
          await this.attachToDebugger(process, true);
          vscode.window.showInformationMessage(`Auto-attached to debugpy on port ${process.port}`);
          setTimeout(() => this.lockManager.releasePortLock(process.port), 5000);
        } catch (error) {
          vscode.window.showWarningMessage(`Failed to auto-attach to port ${process.port}: ${error}`);
          this.lockManager.releasePortLock(process.port);
        }
      }
    }
  }

    async attachToDebugger(process: PythonProcess, isAutoAttach: boolean = false): Promise<void> {
    if (!process.isCurrentUser && !isAutoAttach) {
      const confirmation = await vscode.window.showWarningMessage(
        `You are trying to attach to a process owned by another user (${process.user}). This may have security implications. Do you want to continue?`,
        { modal: true },
        'Yes'
      );

      if (confirmation !== 'Yes') {
        vscode.window.showInformationMessage('Attach operation cancelled.');
        return;
      }
    }

    try {
      const success = await vscode.debug.startDebugging(undefined, {
        name: `Attach to Port ${process.port}`,
        type: "python",
        request: "attach",
        connect: {
          host: "localhost",
          port: parseInt(process.port)
        },
        justMyCode: false,
        console: "integratedTerminal"
      });

      if (success) {
        if (!isAutoAttach) {
          vscode.window.showInformationMessage(`Debugger attached to port ${process.port}`);
        }
      } else {
        throw new Error('Debug session failed to start');
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error attaching debugger: ${error}`);
      throw error;
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
