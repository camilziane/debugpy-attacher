import { exec } from 'child_process';
import * as os from 'os';
import * as vscode from 'vscode';

export interface PythonProcess {
  pid: string;
  port: string;
  user: string;
  isCurrentUser: boolean;
  source?: 'ps' | 'lsof' | 'launch.json';
  command?: string;
}

export class PythonProcessService {
  async findPythonProcesses(): Promise<PythonProcess[]> {
    const processes: PythonProcess[] = [];
    const seenPorts = new Set<string>();

    // Run both detection methods in parallel
    const [psProcesses, lsofProcesses] = await Promise.all([
      this.findProcessesViaPsCommand(),
      this.findProcessesViaLsofFromLaunchConfig()
    ]);

    // Add processes from ps command
    for (const process of psProcesses) {
      if (!seenPorts.has(process.port)) {
        seenPorts.add(process.port);
        processes.push({ ...process, source: 'ps' });
      }
    }

    // Add processes from lsof (Docker containers, etc.)
    for (const process of lsofProcesses) {
      if (!seenPorts.has(process.port)) {
        seenPorts.add(process.port);
        processes.push({ ...process, source: 'lsof' });
      }
    }

    return processes;
  }

  private async findProcessesViaPsCommand(): Promise<PythonProcess[]> {
    return new Promise((resolve) => {
      const processes: PythonProcess[] = [];
      const seenPorts = new Set<string>();

      const platformCmd = process.platform === 'win32'
        ? `wmic process where "commandline like '%debugpy%'" get Owner,ProcessId,CommandLine /format:csv`
        : `ps -eo user,pid,args | grep python | grep debugpy | grep -v grep`;

      exec(platformCmd, {
        timeout: 10000,
        maxBuffer: 1024 * 1024,
        encoding: 'utf8'
      }, (err, output, stderr) => {
        if (err || !output || !output.trim()) {
          resolve([]);
          return;
        }

        const lines = output.split('\n').filter(line => line.trim());

        for (const line of lines) {
          const process = this.parseProcessLine(line, seenPorts);
          if (process) {
            processes.push(process);
          }
        }

        resolve(processes);
      });
    });
  }

  private async findProcessesViaLsofFromLaunchConfig(): Promise<PythonProcess[]> {
    // Skip lsof on Windows as it's not typically available
    if (process.platform === 'win32') {
      return [];
    }

    const ports = await this.getPortsFromLaunchConfig();
    if (ports.length === 0) {
      return [];
    }

    const processes: PythonProcess[] = [];

    // Run lsof for each port in parallel
    const lsofPromises = ports.map(port => this.checkPortWithLsof(port));
    const lsofResults = await Promise.all(lsofPromises);

    for (const result of lsofResults) {
      if (result) {
        processes.push(result);
      }
    }

    return processes;
  }

  private async getPortsFromLaunchConfig(): Promise<string[]> {
    const ports: string[] = [];

    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        return ports;
      }

      for (const folder of workspaceFolders) {
        const launchConfig = vscode.workspace.getConfiguration('launch', folder.uri);
        const configurations = launchConfig.get<any[]>('configurations', []);

        for (const config of configurations) {
          // Look for debugpy configurations
          if (config.debugpyAttacher === true) {
            let port: string | undefined;
            // Check different ways port might be specified
            if (config.connect?.port) {
              port = config.connect.port.toString();
            } else if (config.port) {
              port = config.port.toString();
            }
            if (port && !ports.includes(port)) {
              ports.push(port);
            }
          }
        }
      }
    } catch (error) {
      // Silently handle errors reading launch.json
    }

    return ports;
  }

  private async checkPortWithLsof(port: string): Promise<PythonProcess | null> {
    return new Promise((resolve) => {
      const cmd = `lsof -i :${port} -P -n`;

      exec(cmd, {
        timeout: 5000,
        maxBuffer: 1024 * 512,
        encoding: 'utf8'
      }, (err, output, stderr) => {
        if (err || !output || !output.trim()) {
          resolve(null);
          return;
        }

        const lines = output.split('\n').filter(line => line.trim());

        // Skip header line and look for LISTEN processes
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          // Only consider processes that are listening (not connected)
          if (line.includes('LISTEN')) {
            const process = this.parseLsofLine(line, port);
            if (process) {
              resolve(process);
              return;
            }
          }
        }

        resolve(null);
      });
    });
  }

  private parseLsofLine(line: string, port: string): PythonProcess | null {
    // lsof output format: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
    const parts = line.trim().split(/\s+/);

    if (parts.length >= 3) {
      const command = parts[0];
      const pid = parts[1];
      const user = parts[2];

      // Accept ANY process listening on the port - could be Docker, Python, or any container
      // Since we got the port from launch.json, we assume it's a debugpy target
      const currentUser = os.userInfo().username;
      const isCurrentUser = user === currentUser;

      return {
        pid,
        port,
        user,
        isCurrentUser,
        command // Store the command name for display purposes
      };
    }

    return null;
  }

  private parseProcessLine(line: string, seenPorts: Set<string>): PythonProcess | null {
    if (process.platform === 'win32') {
      return this.parseWindowsProcess(line, seenPorts);
    } else {
      return this.parseUnixProcess(line, seenPorts);
    }
  }

  private parseWindowsProcess(line: string, seenPorts: Set<string>): PythonProcess | null {
    const parts = line.split(',');
    if (parts.length >= 3 && parts[2] && parts[2].includes('debugpy')) {
      const commandLine = parts[2];
      const ownerWithDomain = parts[0] ? parts[0].trim() : '';
      const user = ownerWithDomain.includes('\\') ? ownerWithDomain.split('\\')[1] : ownerWithDomain;
      const pid = parts[1] ? parts[1].trim() : '';
      const isCurrentUser = user.toLowerCase() === os.userInfo().username.toLowerCase();

      const port = this.extractPort(commandLine);

      if (port && /^\d+$/.test(pid) && !seenPorts.has(port)) {
        seenPorts.add(port);
        return { pid, port, user, isCurrentUser };
      }
    }
    return null;
  }

  private parseUnixProcess(line: string, seenPorts: Set<string>): PythonProcess | null {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) return null;

    const user = parts[0];
    const pid = parts[1];
    const command = parts.slice(2).join(' ');
    const isCurrentUser = user === os.userInfo().username;

    const portMatch = command.match(/--port\s+(\d+)/);
    if (portMatch && !seenPorts.has(portMatch[1])) {
      seenPorts.add(portMatch[1]);
      return { pid, port: portMatch[1], user, isCurrentUser };
    }
    return null;
  }

  private extractPort(commandLine: string): string | null {
    const portMatches = [
      commandLine.match(/--port\s+(\d+)/),
      commandLine.match(/--listen\s+(\d+)/),
      commandLine.match(/:(\d{4,5})/),
      commandLine.match(/\b(5\d{3}|6\d{3}|7\d{3}|8\d{3}|9\d{3})\b/)
    ];

    for (const match of portMatches) {
      if (match) {
        return match[1];
      }
    }
    return null;
  }
}
