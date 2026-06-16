import { App, TFile, TFolder } from 'obsidian';

const DEFAULT_LOG_FOLDER_PATH = 'TempoLog/Logs';

export interface TimeLogEntry {
	category: string;
	task: string;
	logDate: string;
	startDateTime: string;
	endDateTime: string;
	durationMinutes: number;
	notes: string;
	loggedAt: string;
}

export interface TimeLogSaveResult {
	path: string;
}

export async function saveTimeLogEntry(
	app: App,
	logFolderPath: string,
	entry: TimeLogEntry,
): Promise<TimeLogSaveResult> {
	const folderPath = normalizeVaultFolderPath(logFolderPath);
	const logMonth = entry.logDate.slice(0, 7);
	const logFilePath = `${folderPath}/${logMonth}_Log.md`;

	await ensureVaultFolder(app, folderPath);
	const logFile = await ensureMonthlyLogFile(app, logFilePath);
	const currentContent = await app.vault.cachedRead(logFile);
	const separator = currentContent.endsWith('\n') ? '' : '\n';

	await app.vault.append(logFile, `${separator}${formatTimeLogEntry(entry)}\n`);

	return {
		path: logFilePath,
	};
}

function normalizeVaultFolderPath(path: string): string {
	const normalizedPath = path
		.trim()
		.replace(/\\/g, '/')
		.replace(/^\/+/, '')
		.replace(/\/+$/, '')
		.replace(/\/+/g, '/');

	return normalizedPath || DEFAULT_LOG_FOLDER_PATH;
}

async function ensureVaultFolder(app: App, folderPath: string): Promise<void> {
	let currentPath = '';

	for (const folderName of folderPath.split('/')) {
		currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;

		const existingFile = app.vault.getAbstractFileByPath(currentPath);

		if (existingFile instanceof TFolder) {
			continue;
		}

		if (existingFile) {
			throw new Error(`Log folder path conflicts with a file: ${currentPath}`);
		}

		await app.vault.createFolder(currentPath);
	}
}

async function ensureMonthlyLogFile(
	app: App,
	logFilePath: string,
): Promise<TFile> {
	const existingFile = app.vault.getAbstractFileByPath(logFilePath);

	if (existingFile instanceof TFile) {
		return existingFile;
	}

	if (existingFile) {
		throw new Error(`Log file path conflicts with a folder: ${logFilePath}`);
	}

	return app.vault.create(logFilePath, createMonthlyLogContent());
}

function createMonthlyLogContent(): string {
	return '# Entries\n';
}

function formatTimeLogEntry(entry: TimeLogEntry): string {
	return [
		'-',
		formatInlineField('logged', entry.loggedAt),
		formatInlineField('category', entry.category),
		formatInlineField('task', entry.task),
		formatInlineField('start', entry.startDateTime),
		formatInlineField('end', entry.endDateTime),
		formatInlineField('duration', String(entry.durationMinutes)),
		formatInlineField('notes', entry.notes),
	].join(' ');
}

function formatInlineField(name: string, value: string): string {
	return `[${name}:: ${escapeInlineFieldValue(value)}]`;
}

function escapeInlineFieldValue(value: string): string {
	return value
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/\\/g, '\\\\')
		.replace(/\[/g, '\\[')
		.replace(/\]/g, '\\]');
}
