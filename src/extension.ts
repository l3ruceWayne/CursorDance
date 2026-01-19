import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

type TargetEditor = 'vscode' | 'cursor';

function getMacOpenCommand(): string {
	// Use an absolute path so this works even if PATH is minimal in the extension host environment.
	return fs.existsSync('/usr/bin/open') ? '/usr/bin/open' : 'open';
}

function getHostEditor(): TargetEditor | 'unknown' {
	const appName = (vscode.env.appName ?? '').toLowerCase();
	const scheme = (vscode.env.uriScheme ?? '').toLowerCase();

	if (appName.includes('cursor') || scheme === 'cursor') {
		return 'cursor';
	}

	if (appName.includes('visual studio code') || scheme.startsWith('vscode')) {
		return 'vscode';
	}

	return 'unknown';
}

function getOtherEditor(host: TargetEditor | 'unknown'): TargetEditor {
	return host === 'cursor' ? 'vscode' : 'cursor';
}

function getMacAppCandidates(target: TargetEditor): string[] {
	if (target === 'cursor') {
		return [
			'/Applications/Cursor.app',
			`${os.homedir()}/Applications/Cursor.app`,
		];
	}

	return [
		'/Applications/Visual Studio Code.app',
		'/Applications/Visual Studio Code - Insiders.app',
		`${os.homedir()}/Applications/Visual Studio Code.app`,
		`${os.homedir()}/Applications/Visual Studio Code - Insiders.app`,
	];
}

function getMacCliName(target: TargetEditor): string {
	return target === 'vscode' ? 'code' : 'cursor';
}

function getMacCliPathFromApp(target: TargetEditor, appPath: string): string {
	return `${appPath}/Contents/Resources/app/bin/${getMacCliName(target)}`;
}

function resolveMacApp(target: TargetEditor, configured?: string): { kind: 'open'; app: string } | { kind: 'exec'; command: string } {
	const value = (configured ?? '').trim();
	if (!value) {
		for (const candidate of getMacAppCandidates(target)) {
			if (fs.existsSync(candidate)) {
				const cliPath = getMacCliPathFromApp(target, candidate);
				if (fs.existsSync(cliPath)) {
					return { kind: 'exec', command: cliPath };
				}
				return { kind: 'open', app: candidate };
			}
		}
		return { kind: 'open', app: target === 'vscode' ? 'Visual Studio Code' : 'Cursor' };
	}

	// Explicit .app path => open it.
	if (value.endsWith('.app')) {
		const cliPath = getMacCliPathFromApp(target, value);
		if (fs.existsSync(cliPath)) {
			return { kind: 'exec', command: cliPath };
		}
		return { kind: 'open', app: value };
	}

	// Likely a filesystem path to a CLI binary (e.g. /usr/local/bin/code).
	if (value.includes('/') || value.includes('\\')) {
		return { kind: 'exec', command: value };
	}

	// Common CLI shims (case-sensitive so "Cursor" / "Visual Studio Code" can be treated as app names).
	if (value === 'code' || value === 'cursor') {
		return { kind: 'exec', command: value };
	}

	// Otherwise treat as an app name for `open -a`.
	// Prefer a matching .app location (so we can use its bundled CLI and keep `--goto` accurate).
	for (const candidate of [`/Applications/${value}.app`, `${os.homedir()}/Applications/${value}.app`]) {
		if (fs.existsSync(candidate)) {
			const cliPath = getMacCliPathFromApp(target, candidate);
			if (fs.existsSync(cliPath)) {
				return { kind: 'exec', command: cliPath };
			}
			break;
		}
	}
	return { kind: 'open', app: value };
}

function resolveWindowsCommand(target: TargetEditor, configured?: string): { command: string; argsPrefix: string[] } {
	const value = (configured ?? '').trim();
	if (value) {
		if (value.endsWith('.exe') || value.includes('\\') || value.includes('/')) {
			return { command: value, argsPrefix: [] };
		}
		return { command: 'cmd.exe', argsPrefix: ['/d', '/s', '/c', value] };
	}

	const localAppData = process.env.LOCALAPPDATA;
	const programFiles = process.env.PROGRAMFILES;
	const programFilesX86 = process.env['ProgramFiles(x86)'];

	const candidates: string[] = [];
	if (target === 'vscode') {
		if (localAppData) {
			candidates.push(`${localAppData}\\Programs\\Microsoft VS Code\\Code.exe`);
		}
		if (programFiles) {
			candidates.push(`${programFiles}\\Microsoft VS Code\\Code.exe`);
		}
		if (programFilesX86) {
			candidates.push(`${programFilesX86}\\Microsoft VS Code\\Code.exe`);
		}
	} else {
		// Cursor is typically installed under LocalAppData.
		if (localAppData) {
			candidates.push(`${localAppData}\\Programs\\Cursor\\Cursor.exe`);
			candidates.push(`${localAppData}\\Programs\\cursor\\Cursor.exe`);
		}
	}

	for (const p of candidates) {
		if (fs.existsSync(p)) {
			return { command: p, argsPrefix: [] };
		}
	}

	return { command: 'cmd.exe', argsPrefix: ['/d', '/s', '/c', target === 'vscode' ? 'code' : 'cursor'] };
}

function executeCommand(command: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const childProcess = execFile(command, args, (error, stdout, stderr) => {
			if (error) {
				reject(error);
				return;
			}
			if (stdout) {
				console.log('Command output:', stdout);
			}
			if (stderr) {
				console.log('Command stderr:', stderr);
			}
			resolve();
		});

		// Add error handling
		childProcess.on('error', (error: NodeJS.ErrnoException) => {
			if (error.code === 'EPIPE') {
				console.log('Pipe communication disconnected, but the editor may have started normally');
				resolve(); // Continue execution as the editor may have started normally
			} else {
				reject(error);
			}
		});
	});
}

function getEditorLabel(target: TargetEditor): string {
	return target === 'vscode' ? 'VS Code' : 'Cursor';
}

function buildGotoArg(filePath: string, line: number, column: number): string {
	return `${filePath}:${line}:${column}`;
}

function getMacUrlScheme(target: TargetEditor, configuredPath?: string): string {
	if (target === 'cursor') {
		return 'cursor';
	}

	// Respect explicit hints in configuration (e.g. "Visual Studio Code - Insiders", "code-insiders").
	const configured = (configuredPath ?? '').trim().toLowerCase();
	if (configured.includes('insiders')) {
		return 'vscode-insiders';
	}

	// Auto-detect installed VS Code variant (prefer stable when both exist).
	const stableCandidates = [
		'/Applications/Visual Studio Code.app',
		`${os.homedir()}/Applications/Visual Studio Code.app`,
	];
	for (const p of stableCandidates) {
		if (fs.existsSync(p)) {
			return 'vscode';
		}
	}

	const insidersCandidates = [
		'/Applications/Visual Studio Code - Insiders.app',
		`${os.homedir()}/Applications/Visual Studio Code - Insiders.app`,
	];
	for (const p of insidersCandidates) {
		if (fs.existsSync(p)) {
			return 'vscode-insiders';
		}
	}

	return 'vscode';
}

function buildMacFileUrl(target: TargetEditor, filePath: string, line: number, column: number, configuredPath?: string): string {
	const scheme = getMacUrlScheme(target, configuredPath);
	// Encode the path portion to keep `open` happy with spaces/#/? etc.
	const encodedPath = pathToFileURL(filePath).pathname;
	return `${scheme}://file${encodedPath}:${line}:${column}`;
}

function buildMacProjectUrl(target: TargetEditor, projectPath: string, configuredPath?: string): string {
	const scheme = getMacUrlScheme(target, configuredPath);
	// Cursor/VS Code URL handlers behave more reliably for folders when the path ends with '/'.
	const pathname = pathToFileURL(projectPath).pathname;
	const encodedPath = pathname.endsWith('/') ? pathname : `${pathname}/`;
	return `${scheme}://file${encodedPath}`;
}

function buildOpenFileCommand(target: TargetEditor, filePath: string, line: number, column: number, configuredPath?: string): { command: string; args: string[] } {
	const platform = os.platform();
	if (platform === 'darwin') {
		return { command: getMacOpenCommand(), args: [buildMacFileUrl(target, filePath, line, column, configuredPath)] };
	}

	const gotoArg = buildGotoArg(filePath, line, column);

	if (platform === 'win32') {
		const resolved = resolveWindowsCommand(target, configuredPath);
		return { command: resolved.command, args: [...resolved.argsPrefix, '--goto', gotoArg] };
	}

	const command = (configuredPath ?? '').trim() || (target === 'vscode' ? 'code' : 'cursor');
	return { command, args: ['--goto', gotoArg] };
}

function buildOpenProjectCommand(target: TargetEditor, projectPath: string, configuredPath?: string): { command: string; args: string[] } {
	const platform = os.platform();
	if (platform === 'darwin') {
		return { command: getMacOpenCommand(), args: [buildMacProjectUrl(target, projectPath, configuredPath)] };
	}

	if (platform === 'win32') {
		const resolved = resolveWindowsCommand(target, configuredPath);
		return { command: resolved.command, args: [...resolved.argsPrefix, projectPath] };
	}

	const command = (configuredPath ?? '').trim() || (target === 'vscode' ? 'code' : 'cursor');
	return { command, args: [projectPath] };
}

function isDirectoryPath(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function getWorkspaceFolderPathForFile(filePath: string): string | undefined {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) {
		return undefined;
	}

	let bestMatch: string | undefined;
	for (const folder of folders) {
		const folderPath = folder.uri.fsPath;
		const folderWithSep = folderPath.endsWith(path.sep) ? folderPath : `${folderPath}${path.sep}`;
		if (filePath === folderPath || filePath.startsWith(folderWithSep)) {
			if (!bestMatch || folderPath.length > bestMatch.length) {
				bestMatch = folderPath;
			}
		}
	}

	return bestMatch ?? folders[0].uri.fsPath;
}

export function activate(context: vscode.ExtensionContext) {

	console.log('CursorDance is now active (Cursor <-> VS Code)!');

	const openFileDisposable = vscode.commands.registerCommand('Switch2Cursor.openFileInOtherEditor', async (uri?: vscode.Uri) => {
		let filePath: string;
		let line = 1;
		let column = 1;

		if (uri) {
			if (uri.scheme !== 'file') {
				vscode.window.showErrorMessage('Only local files can be opened in the other editor.');
				return;
			}
			filePath = uri.fsPath;
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.uri.fsPath === filePath) {
				line = editor.selection.active.line + 1;
				column = editor.selection.active.character + 1;
			}
		} else {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showErrorMessage('No active editor!');
				return;
			}
			if (editor.document.uri.scheme !== 'file') {
				vscode.window.showErrorMessage('Only local files can be opened in the other editor.');
				return;
			}
			filePath = editor.document.uri.fsPath;
			line = editor.selection.active.line + 1;
			column = editor.selection.active.character + 1;
		}

		const host = getHostEditor();
		const target = getOtherEditor(host);

		const config = vscode.workspace.getConfiguration('switch2cursor');
		const configKey = target === 'vscode' ? 'vscodePath' : 'cursorPath';
		const configuredPath = config.get<string>(configKey);

		try {
			const platform = os.platform();
			if (platform === 'darwin') {
				const isDir = isDirectoryPath(filePath);
				const projectPath = isDir
					? filePath
					: (getWorkspaceFolderPathForFile(filePath) ?? path.dirname(filePath));

				const projectCmd = buildOpenProjectCommand(target, projectPath, configuredPath);
				console.log('Executing command:', projectCmd.command, projectCmd.args);

				// If opening the project fails, still try to open the file position.
				try {
					await executeCommand(projectCmd.command, projectCmd.args);
				} catch (error) {
					if (isDir) {
						throw error;
					}
				}

				if (!isDir) {
					const fileCmd = buildOpenFileCommand(target, filePath, line, column, configuredPath);
					console.log('Executing command:', fileCmd.command, fileCmd.args);
					await executeCommand(fileCmd.command, fileCmd.args);
				}
				return;
			}

			const { command, args } = buildOpenFileCommand(target, filePath, line, column, configuredPath);
			console.log('Executing command:', command, args);
			await executeCommand(command, args);
		} catch (error) {
			const err = error as Error;
			vscode.window.showErrorMessage(`Failed to open ${getEditorLabel(target)}: ${err.message}`);
		}
	});

	const openProjectDisposable = vscode.commands.registerCommand('Switch2Cursor.openProjectInOtherEditor', async () => {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			vscode.window.showErrorMessage('No workspace folder is opened!');
			return;
		}

		const projectPath = workspaceFolders[0].uri.fsPath;

		const host = getHostEditor();
		const target = getOtherEditor(host);

		const config = vscode.workspace.getConfiguration('switch2cursor');
		const configKey = target === 'vscode' ? 'vscodePath' : 'cursorPath';
		const configuredPath = config.get<string>(configKey);
		const { command, args } = buildOpenProjectCommand(target, projectPath, configuredPath);

		try {
			await executeCommand(command, args);
		} catch (error) {
			const err = error as Error;
			vscode.window.showErrorMessage(`Failed to open project in ${getEditorLabel(target)}: ${err.message}`);
		}
	});

	context.subscriptions.push(openFileDisposable);
	context.subscriptions.push(openProjectDisposable);
}

export function deactivate() {}
