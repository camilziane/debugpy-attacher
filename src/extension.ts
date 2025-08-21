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

  // Listen for debug session events to clean up attached ports
  const debugSessionDisposable = vscode.debug.onDidTerminateDebugSession((session) => {
    statusBarManager.onDebugSessionEnd(session);
  });
  context.subscriptions.push(debugSessionDisposable);

  // Listen for debug session start to pause auto-attach
  const debugSessionStartDisposable = vscode.debug.onDidStartDebugSession((session) => {
    statusBarManager.onDebugSessionStart(session);
  });
  context.subscriptions.push(debugSessionStartDisposable);

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

    // Restart monitoring to apply auto-attach changes
    statusBarManager.restartMonitoring();
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

  const toggleDefaultLaunchConfigCommand = vscode.commands.registerCommand('debugpy.insertDefaultLaunchConfig', 
    toggleDefaultLaunchConfig
  );

  context.subscriptions.push(
    attachCommand,
    toggleLiveMonitoringCommand,
    toggleAutoAttachCommand,
    toggleHideProcessesCommand,
    cleanRegionsCommand,
    cleanCurrentFileCommand,
    insertDebugpyCommand,
    insertDebugpyBreakpointCommand,
    toggleDefaultLaunchConfigCommand
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

  // Try to get port from launch.json first, fallback to default port
  let port = configManager.getDefaultPort();

  try {
    const workspaceFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0] : undefined;
    if (workspaceFolder) {
      const launchConfig = vscode.workspace.getConfiguration('launch', workspaceFolder.uri);
      const configurations = launchConfig.get<any[]>('configurations', []);

      // Look for debugpy attacher configuration
      const debugpyConfig = configurations.find(config => config.debugpyAttacher === true);
      if (debugpyConfig) {
        if (debugpyConfig.connect?.port) {
          port = debugpyConfig.connect.port;
        } else if (debugpyConfig.port) {
          port = debugpyConfig.port;
        }
      }
    }
  } catch (error) {
    // If there's an error reading launch.json, just use the default port
    console.debug('Error reading launch.json, using default port:', error);
  }

  const lines = [
    ('# region dbpy_attach' + (includeBreakpoint ? ' (b)' : '')),
    'import debugpy',
    `(debugpy.listen(("0.0.0.0", ${port})), debugpy.wait_for_client()) if not debugpy.is_client_connected() else None`
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

async function toggleDefaultLaunchConfig(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showErrorMessage('No workspace folder is open.');
    return;
  }

  const workspaceFolder = workspaceFolders[0];
  const launchJsonPath = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode', 'launch.json');
  
  try {
    // Get default port from settings
    let defaultPort = configManager.getDefaultPort();
    
    let configurations: any[] = [];
    let fileExists = false;
    let rawContent = '';
    
    try {
      // Check if file exists
      await vscode.workspace.fs.stat(launchJsonPath);
      fileExists = true;
      
      // Read raw content to preserve later if needed
      const launchJsonContent = await vscode.workspace.fs.readFile(launchJsonPath);
      rawContent = Buffer.from(launchJsonContent).toString('utf8');
      
      // Use VS Code's configuration API to handle JSONC properly
      const launchConfigFromVSCode = vscode.workspace.getConfiguration('launch', workspaceFolder.uri);
      configurations = launchConfigFromVSCode.get<any[]>('configurations', []);
      
    } catch (error) {
      // File doesn't exist, will create it
      fileExists = false;
      configurations = [];
    }

    // Check if debugpy-attacher configuration already exists
    const existingConfig = configurations.find(
      (config: any) => config.debugpyAttacher === true || config.name === 'default-debugpy-attacher'
    );

    if (existingConfig) {
      vscode.window.showInformationMessage('Default debugpy-attacher configuration already exists in launch.json');
      return;
    }

    // Add new debugpy-attacher configuration
    const newConfig = {
      name: "default-debugpy-attacher",
      type: "debugpy",
      request: "attach",
      connect: {
        host: "localhost",
        port: defaultPort
      },
      debugpyAttacher: true,
      pathMappings: [
        {
          localRoot: "${workspaceFolder}",
          remoteRoot: "${workspaceFolder}"
        }
      ],
      justMyCode: false
    };

    configurations.push(newConfig);

    // Create .vscode directory if it doesn't exist
    const vscodeDirPath = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode');
    try {
      await vscode.workspace.fs.stat(vscodeDirPath);
    } catch {
      await vscode.workspace.fs.createDirectory(vscodeDirPath);
    }

    // Create the complete launch.json structure
    const launchConfig = {
      version: "0.2.0",
      configurations: configurations
    };

    // Write the file with proper formatting and comments
    let newFileContent: string;
    if (fileExists && rawContent.includes('//')) {
      // File exists and has comments, try to preserve the structure
      try {
        // Parse without comments to validate, then create new content preserving style
        const cleanContent = rawContent.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        JSON.parse(cleanContent); // Validate it's valid JSON structure
        
        // If we get here, the file is valid JSONC, create new content preserving comments style
        newFileContent = `{
    // Use IntelliSense to learn about possible attributes.
    // Hover to view descriptions of existing attributes.
    // For more information, visit: https://go.microsoft.com/fwlink/?linkid=830387
    "version": "0.2.0",
    "configurations": ${JSON.stringify(configurations, null, 8).replace(/\n/g, '\n    ')}
}`;
      } catch {
        // If parsing fails, create clean new file
        newFileContent = JSON.stringify(launchConfig, null, 4);
      }
    } else {
      // New file or file without comments, create with standard VS Code comments
      newFileContent = `{
    // Use IntelliSense to learn about possible attributes.
    // Hover to view descriptions of existing attributes.
    // For more information, visit: https://go.microsoft.com/fwlink/?linkid=830387
    "version": "0.2.0",
    "configurations": ${JSON.stringify(configurations, null, 8).replace(/\n/g, '\n    ')}
}`;
    }

    await vscode.workspace.fs.writeFile(launchJsonPath, Buffer.from(newFileContent, 'utf8'));

    vscode.window.showInformationMessage(`Added default debugpy-attacher configuration to launch.json (port ${defaultPort})`);

    // Open launch.json if it was just created
    if (!fileExists) {
      const document = await vscode.workspace.openTextDocument(launchJsonPath);
      await vscode.window.showTextDocument(document);
    }
    
  } catch (error) {
    vscode.window.showErrorMessage(`Error adding launch configuration: ${error}`);
  }
}

function insertConfigIntoExistingFile(content: string, newConfig: any): string {
  // Find the configurations array and insert the new config
  const lines = content.split('\n');
  let configurationsStart = -1;
  let configurationsEnd = -1;
  let braceCount = 0;
  let inConfigurations = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.includes('"configurations"') && line.includes('[')) {
      configurationsStart = i;
      inConfigurations = true;
      braceCount = 0;
      continue;
    }
    
    if (inConfigurations) {
      // Count braces to find the end of configurations array
      const openBraces = (line.match(/\[/g) || []).length;
      const closeBraces = (line.match(/\]/g) || []).length;
      braceCount += openBraces - closeBraces;
      
      if (braceCount < 0) {
        configurationsEnd = i;
        break;
      }
    }
  }
  
  if (configurationsStart === -1 || configurationsEnd === -1) {
    throw new Error('Could not find configurations array');
  }
  
  // Get the indentation from the configurations line
  const configurationsLine = lines[configurationsStart];
  const baseIndent = configurationsLine.match(/^(\s*)/)?.[1] || '';
  const configIndent = baseIndent + '        ';
  
  // Format the new configuration
  const configJson = JSON.stringify(newConfig, null, 4);
  const formattedConfig = configJson.split('\n').map((line, index) => {
    if (index === 0) return configIndent + line;
    return configIndent + line;
  }).join('\n');
  
  // Insert the new configuration
  const beforeConfigs = lines.slice(0, configurationsEnd);
  const afterConfigs = lines.slice(configurationsEnd);
  
  // Add comma if there are existing configurations
  let needsComma = false;
  for (let i = configurationsEnd - 1; i > configurationsStart; i--) {
    const trimmed = lines[i].trim();
    if (trimmed && !trimmed.startsWith('//')) {
      if (trimmed !== '[' && !trimmed.endsWith(',')) {
        needsComma = true;
      }
      break;
    }
  }
  
  const result = [
    ...beforeConfigs,
    ...(needsComma ? [beforeConfigs[beforeConfigs.length - 1].replace(/(\s*)(.*?)(\s*)$/, '$1$2,$3')] : []).slice(-1),
    ...(needsComma ? beforeConfigs.slice(0, -1) : beforeConfigs),
    formattedConfig + (afterConfigs[0]?.trim() === ']' ? '' : ','),
    ...afterConfigs
  ];
  
  return result.join('\n');
}

export function deactivate() {
  statusBarManager?.dispose();
  decorationManager?.dispose();
  lockManager?.cleanup();
}
