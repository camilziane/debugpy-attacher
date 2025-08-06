import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class PortLockManager {
  private windowId: string;
  private lastUserActivity: number = Date.now();
  private lockCleanupInterval: NodeJS.Timeout | undefined;

  constructor() {
    this.windowId = this.generateWindowId();
    this.startLockCleanup();
  }

  markUserActivity(): void {
    this.lastUserActivity = Date.now();
    this.updateActiveWindow();
  }

  tryAcquirePortLock(port: string): boolean {
    try {
      if (!this.isActiveWindow()) {
        return false;
      }

      this.ensureLockDir();
      const lockPath = this.getPortLockPath(port);

      if (fs.existsSync(lockPath)) {
        const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

        if (Date.now() - lockData.timestamp < 30000 && lockData.windowId !== this.windowId) {
          return false;
        }
      }

      if (!this.isActiveWindow()) {
        return false;
      }

      fs.writeFileSync(lockPath, JSON.stringify({
        windowId: this.windowId,
        port,
        timestamp: Date.now(),
        userActivity: this.lastUserActivity
      }));

      return true;
    } catch (error) {
      return false;
    }
  }

  releasePortLock(port: string): void {
    try {
      const lockPath = this.getPortLockPath(port);
      if (fs.existsSync(lockPath)) {
        const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        if (lockData.windowId === this.windowId) {
          fs.unlinkSync(lockPath);
        }
      }
    } catch (error) {
      // Silently handle errors
    }
  }

  cleanup(): void {
    this.stopLockCleanup();
    this.cleanupWindowLocks();
  }

  private generateWindowId(): string {
    return `vscode-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private getLockDir(): string {
    const currentUser = os.userInfo().username || 'unknown-user';
    return path.join(os.tmpdir(), `debugpy-attacher-locks-${currentUser}`);
  }

  private ensureLockDir(): void {
    const lockDir = this.getLockDir();
    if (!fs.existsSync(lockDir)) {
      fs.mkdirSync(lockDir, { recursive: true });
    }
  }

  private getPortLockPath(port: string): string {
    return path.join(this.getLockDir(), `port-${port}.lock`);
  }

  private getActiveWindowPath(): string {
    return path.join(this.getLockDir(), 'active-window.lock');
  }

  private updateActiveWindow(): void {
    try {
      this.ensureLockDir();
      const activeWindowPath = this.getActiveWindowPath();
      fs.writeFileSync(activeWindowPath, JSON.stringify({
        windowId: this.windowId,
        timestamp: Date.now(),
        lastActivity: this.lastUserActivity
      }));
    } catch (error) {
      // Silently handle file system errors
    }
  }

  private isActiveWindow(): boolean {
    try {
      const activeWindowPath = this.getActiveWindowPath();
      if (!fs.existsSync(activeWindowPath)) {
        this.updateActiveWindow();
        return true;
      }

      const data = JSON.parse(fs.readFileSync(activeWindowPath, 'utf8'));

      if (this.lastUserActivity > data.lastActivity + 1000) {
        this.updateActiveWindow();
        return true;
      }

      if (Date.now() - data.lastActivity > 15000) {
        this.updateActiveWindow();
        return true;
      }

      return data.windowId === this.windowId;
    } catch (error) {
      this.updateActiveWindow();
      return true;
    }
  }

  private startLockCleanup(): void {
    this.lockCleanupInterval = setInterval(() => {
      this.cleanupStaleLocks();
    }, 30000);
  }

  private stopLockCleanup(): void {
    if (this.lockCleanupInterval) {
      clearInterval(this.lockCleanupInterval);
      this.lockCleanupInterval = undefined;
    }
  }

  private cleanupStaleLocks(): void {
    try {
      const lockDir = this.getLockDir();
      if (!fs.existsSync(lockDir)) return;

      const files = fs.readdirSync(lockDir);
      const now = Date.now();

      for (const file of files) {
        const filePath = path.join(lockDir, file);
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

          if (now - data.timestamp > 60000) {
            fs.unlinkSync(filePath);
          }
        } catch (error) {
          fs.unlinkSync(filePath);
        }
      }
    } catch (error) {
      // Silently handle cleanup errors
    }
  }

  private cleanupWindowLocks(): void {
    try {
      const lockDir = this.getLockDir();
      if (!fs.existsSync(lockDir)) return;

      const files = fs.readdirSync(lockDir);

      for (const file of files) {
        const filePath = path.join(lockDir, file);
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

          if (data.windowId === this.windowId) {
            fs.unlinkSync(filePath);
          }
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    } catch (error) {
      // Silently handle cleanup errors
    }
  }
}
