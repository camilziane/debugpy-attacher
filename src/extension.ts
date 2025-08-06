import * as vscode from 'vscode';
import * as fs from 'fs';
import { ConfigManager } from './config';
import { PythonProcessService, PythonProcess } from './pythonProcessService';
import { PortLockManager } from './portLockManager';
import { DecorationManager } from './decorationManager';
import { StatusBarManager } from './statusBarManager';

let configManager: ConfigManager;
let processService: PythonProcessService;
let lockManager: PortLockManager;
let decorationManager: DecorationManager;
let statusBarManager: StatusBarManager;

export function activate(context: vscode.ExtensionContext) {
  // Initialize managers
  configManager = ConfigManager.getInstance();
  processService = new PythonProcessService();
  lockManager = new PortLockManager();
  decorationManager = new DecorationManager();
  statusBarManager = new StatusBarManager(lockManager);

  // Register status bar
  context.subscriptions.push(statusBarManager.getStatusBarItem());

  // Register commands
  registerCommands(context);

  // Setup folding provider
  const foldingProvider = vscode.languages.registerFoldingRangeProvider(
    'python',
    decorationManager.createFoldingRangeProvider()
  );
  context.subscriptions.push(foldingProvider);

  // Setup decoration and folding handlers
  decorationManager.setupEventHandlers(context);

  // Setup user activity tracking
  setupUserActivityTracking(context);

  // Setup configuration change handling
  setupConfigurationHandling(context);

  // Cleanup on deactivation
  context.subscriptions.push({
    dispose: () => {
      statusBarManager.dispose();
      decorationManager.dispose();
      lockManager.cleanup();
    }
  });

  // Start monitoring
  statusBarManager.startMonitoring();
}

function registerCommands(context: vscode.ExtensionContext): void {
  const attachCommand = vscode.commands.registerCommand('debugpy.attachToPort', async () => {
    lockManager.markUserActivity();

    try {
      let pythonProcesses = await processService.findPythonProcesses();

      if (configManager.shouldHideProcessesFromOtherUsers()) {
        pythonProcesses = pythonProcesses.filter(p => p.isCurrentUser);
      }

      if (pythonProcesses.length === 0) {
        vscode.window.showErrorMessage("No Python processes with listening ports found. Make sure a debugpy process is running.");
        return;
      }

      await handleMultipleProcessSelection(pythonProcesses);
    } catch (error) {
      vscode.window.showErrorMessage(`Error searching for Python processes: ${error}`);
    }
  });

  const toggleLiveMonitoringCommand = vscode.commands.registerCommand('debugpy.toggleLiveMonitoring', async () => {
    lockManager.markUserActivity();
    const newState = await configManager.toggleLiveMonitoring();
    vscode.window.showInformationMessage(`Debugpy live monitoring ${newState ? 'enabled' : 'disabled'}`);
    statusBarManager.restartMonitoring();
  });

  const toggleAutoAttachCommand = vscode.commands.registerCommand('debugpy.toggleAutoAttach', async () => {
    lockManager.markUserActivity();
    const newState = await configManager.toggleAutoAttach();
    vscode.window.showInformationMessage(`Debugpy auto-attach ${newState ? 'enabled' : 'disabled'}`);
  });

  const toggleHideProcessesCommand = vscode.commands.registerCommand('debugpy.toggleHideProcessesFromOtherUsers', async () => {
    lockManager.markUserActivity();
    const newState = await configManager.toggleHideProcessesFromOtherUsers();
    vscode.window.showInformationMessage(`Hiding processes from other users is now ${newState ? 'enabled' : 'disabled'}.`);
    statusBarManager.restartMonitoring();
  });

  const cleanRegionsCommand = vscode.commands.registerCommand('debugpy.cleanAttachRegionsWorkspace', cleanAttachRegionsWorkspace);

  const cleanCurrentFileCommand = vscode.commands.registerCommand('debugpy.cleanAttachRegionsCurrentFile', cleanAttachRegionsCurrentFile);

  const insertDebugpyCommand = vscode.commands.registerCommand('debugpy.insertAttachCode', () =>
    insertDebugpySnippet(false)
  );

  const insertDebugpyBreakpointCommand = vscode.commands.registerCommand('debugpy.insertAttachCodeWithBreakpoint', () =>
    insertDebugpySnippet(true)
  );

  context.subscriptions.push(
    attachCommand,
    toggleLiveMonitoringCommand,
    toggleAutoAttachCommand,
    toggleHideProcessesCommand,
    cleanRegionsCommand,
    cleanCurrentFileCommand,
    insertDebugpyCommand,
    insertDebugpyBreakpointCommand
  );
}

async function handleMultipleProcessSelection(pythonProcesses: PythonProcess[]): Promise<void> {
  const quickPickItems = pythonProcesses.map((proc: PythonProcess) => ({
    label: `Port ${proc.port}`,
    description: `User: ${proc.user}${proc.isCurrentUser ? ' (Current User)' : ''}`,
    detail: `PID: ${proc.pid}`,
    process: proc
  }));

  const selected = await vscode.window.showQuickPick(quickPickItems, {
    placeHolder: "Choose a port to debug",
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (selected) {
    if (!selected.process.isCurrentUser) {
      const choice = await vscode.window.showWarningMessage(
        `You are trying to attach to a process owned by another user (${selected.process.user}). This may have security implications.`,
        { modal: true },
        "Attach Anyway"
      );

      if (choice !== "Attach Anyway") {
        return;
      }
    }

    if (!lockManager.tryAcquirePortLock(selected.process.port)) {
      vscode.window.showWarningMessage(`Port ${selected.process.port} is already being debugged by another window.`);
      return;
    }

    try {
      await statusBarManager.attachToDebugger(selected.process);
      setTimeout(() => lockManager.releasePortLock(selected.process.port), 1000);
    } catch (error) {
      lockManager.releasePortLock(selected.process.port);
      throw error;
    }
  }
}

async function insertDebugpySnippet(includeBreakpoint: boolean): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active editor found.');
    return;
  }

  const port = configManager.getDefaultPort();
  const lines = [
    ('# region dbpy_attach' + (includeBreakpoint ? ' (b)' : '')),
    'import debugpy',
    `(debugpy.listen(${port}), debugpy.wait_for_client()) if not debugpy.is_client_connected() else None`
  ];

  if (includeBreakpoint) {
    lines.push('debugpy.breakpoint()');
  }

  lines.push('# endregion', '$0');

  const snippet = new vscode.SnippetString(lines.join('\n'));
  const insertPosition = editor.selection.active;

  await editor.insertSnippet(snippet);

  // Only auto-collapse the specific region that was just inserted
  setTimeout(async () => {
    await decorationManager.collapseSpecificRegion(editor, insertPosition);
  }, 100);
}

async function cleanAttachRegionsCurrentFile(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active editor found.');
    return;
  }

  if (editor.document.languageId !== 'python') {
    vscode.window.showErrorMessage('Current file is not a Python file.');
    return;
  }

  try {
    const document = editor.document;
    const originalText = document.getText();
    const lines = originalText.split('\n');

    const { cleanedLines, modified, removedCount } = cleanDebugpyRegions(lines);

    if (modified) {
      const cleanedText = cleanedLines.join('\n');
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(originalText.length)
      );
      edit.replace(document.uri, fullRange, cleanedText);

      await vscode.workspace.applyEdit(edit);
      vscode.window.showInformationMessage(
        `Cleaned ${removedCount} debugpy attach region(s) from ${document.fileName}.`
      );
    } else {
      vscode.window.showInformationMessage('No debugpy attach regions found in current file.');
    }

  } catch (error) {
    vscode.window.showErrorMessage(`Error cleaning regions: ${error}`);
  }
}

async function cleanAttachRegionsWorkspace(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showErrorMessage('No workspace folder is open.');
    return;
  }

  let filesModified = 0;
  let regionsRemoved = 0;

  try {
    const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**');

    for (const fileUri of pythonFiles) {
      const document = await vscode.workspace.openTextDocument(fileUri);
      const originalText = document.getText();
      const lines = originalText.split('\n');

      const { cleanedLines, modified, removedCount } = cleanDebugpyRegions(lines);

      if (modified) {
        const cleanedText = cleanedLines.join('\n');
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(originalText.length)
        );
        edit.replace(fileUri, fullRange, cleanedText);

        await vscode.workspace.applyEdit(edit);
        filesModified++;
        regionsRemoved += removedCount;
      }
    }

    if (filesModified > 0) {
      vscode.window.showInformationMessage(
        `Cleaned ${regionsRemoved} debugpy attach region(s) from ${filesModified} file(s) in workspace.`
      );
    } else {
      vscode.window.showInformationMessage('No debugpy attach regions found in workspace.');
    }

  } catch (error) {
    vscode.window.showErrorMessage(`Error cleaning regions: ${error}`);
  }
}

function cleanDebugpyRegions(lines: string[]): { cleanedLines: string[], modified: boolean, removedCount: number } {
  const cleanedLines: string[] = [];
  let i = 0;
  let modified = false;
  let removedCount = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().includes('# region dbpy_attach')) {
      let endIndex = i + 1;
      while (endIndex < lines.length) {
        if (lines[endIndex].trim().includes('# endregion')) {
          break;
        }
        endIndex++;
      }

      if (endIndex < lines.length) {
        removedCount++;
        modified = true;
        i = endIndex + 1;
      } else {
        cleanedLines.push(line);
        i++;
      }
    } else {
      cleanedLines.push(line);
      i++;
    }
  }

  return { cleanedLines, modified, removedCount };
}

function setupUserActivityTracking(context: vscode.ExtensionContext): void {
  const trackingDisposables = [
    vscode.workspace.onDidChangeTextDocument(() => lockManager.markUserActivity()),
    vscode.window.onDidChangeActiveTextEditor(() => lockManager.markUserActivity()),
    vscode.window.onDidChangeTextEditorSelection(() => lockManager.markUserActivity()),
    vscode.window.onDidChangeTextEditorVisibleRanges(() => lockManager.markUserActivity()),
    vscode.window.onDidChangeActiveTerminal(() => lockManager.markUserActivity()),
    vscode.window.onDidChangeWindowState(state => {
      if (state.focused) {
        lockManager.markUserActivity();
      }
    })
  ];

  context.subscriptions.push(...trackingDisposables);
}

function setupConfigurationHandling(context: vscode.ExtensionContext): void {
  const configDisposable = vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('debugpyAttacher.enableLiveMonitoring')) {
      statusBarManager.restartMonitoring();
    }

    if (event.affectsConfiguration('debugpyAttacher.showRulerDecorations')) {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === 'python') {
        decorationManager.updateDecorations(editor);
      }
    }

    if (event.affectsConfiguration('debugpyAttacher.defaultPort')) {
      const newPort = configManager.getDefaultPort();
      vscode.window.showInformationMessage(`DebugPy default port changed to ${newPort}. New snippets will use this port.`);
    }
  });

  context.subscriptions.push(configDisposable);
}

export function deactivate() {
  statusBarManager?.dispose();
  decorationManager?.dispose();
  lockManager?.cleanup();
}
