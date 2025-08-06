import { exec } from 'child_process';
import * as os from 'os';

export interface PythonProcess {
  pid: string;
  port: string;
  user: string;
  isCurrentUser: boolean;
}

export class PythonProcessService {
  async findPythonProcesses(): Promise<PythonProcess[]> {
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
