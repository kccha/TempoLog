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

export interface DailyTimeLogEntry {
	category: string;
	task: string;
	date: string;
	startDateTime: string;
	endDateTime: string;
	durationMinutes: number;
	notes: string;
	loggedAt: string;
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

export async function loadTimeLogEntriesForDate(
	app: App,
	logFolderPath: string,
	date: string,
): Promise<DailyTimeLogEntry[]> {
	if (!isLocalDateValue(date)) {
		return [];
	}

	const folderPath = normalizeVaultFolderPath(logFolderPath);
	const logMonth = date.slice(0, 7);
	const logFilePath = `${folderPath}/${logMonth}_Log.md`;
	const logFile = app.vault.getAbstractFileByPath(logFilePath);

	if (!logFile) {
		return [];
	}

	if (!(logFile instanceof TFile)) {
		throw new Error(`Log file path conflicts with a folder: ${logFilePath}`);
	}

	const markdown = await app.vault.cachedRead(logFile);
	return parseTimeLogEntriesForDate(markdown, logFilePath, date);
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

function parseTimeLogEntriesForDate(
	markdown: string,
	path: string,
	date: string,
): DailyTimeLogEntry[] {
	const entries: DailyTimeLogEntry[] = [];

	for (const line of markdown.split(/\r?\n/)) {
		const fields = parseInlineFields(line);
		const category = fields.get('category')?.trim();
		const task = fields.get('task')?.trim();
		const startDateTime = fields.get('start')?.trim();
		const endDateTime = fields.get('end')?.trim();
		const durationValue = fields.get('duration')?.trim();
		const loggedAt = fields.get('logged')?.trim();

		if (
			!category ||
			!task ||
			!startDateTime ||
			!endDateTime ||
			!durationValue ||
			!loggedAt
		) {
			continue;
		}

		if (startDateTime.slice(0, 10) !== date) {
			continue;
		}

		const durationMinutes = Number(durationValue);

		if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
			continue;
		}

		if (!isValidLocalDateTime(startDateTime) || !isValidLocalDateTime(endDateTime)) {
			continue;
		}

		entries.push({
			category,
			task,
			date,
			startDateTime,
			endDateTime,
			durationMinutes,
			notes: fields.get('notes')?.trim() ?? '',
			loggedAt,
			path,
		});
	}

	return entries.sort(compareDailyTimeLogEntries);
}

function parseInlineFields(line: string): Map<string, string> {
	const fields = new Map<string, string>();
	let index = 0;

	while (index < line.length) {
		const openIndex = line.indexOf('[', index);

		if (openIndex === -1) {
			break;
		}

		const separatorIndex = line.indexOf('::', openIndex + 1);

		if (separatorIndex === -1) {
			break;
		}

		const name = line.slice(openIndex + 1, separatorIndex).trim().toLowerCase();

		if (!isInlineFieldName(name)) {
			index = openIndex + 1;
			continue;
		}

		const closeIndex = findUnescapedClosingBracket(line, separatorIndex + 2);

		if (closeIndex === -1) {
			break;
		}

		const value = line.slice(separatorIndex + 2, closeIndex).trim();
		fields.set(name, unescapeInlineFieldValue(value));
		index = closeIndex + 1;
	}

	return fields;
}

function isInlineFieldName(name: string): boolean {
	return /^[a-z][a-z0-9_-]*$/.test(name);
}

function findUnescapedClosingBracket(line: string, startIndex: number): number {
	let isEscaped = false;

	for (let index = startIndex; index < line.length; index += 1) {
		const character = line.charAt(index);

		if (isEscaped) {
			isEscaped = false;
			continue;
		}

		if (character === '\\') {
			isEscaped = true;
			continue;
		}

		if (character === ']') {
			return index;
		}
	}

	return -1;
}

function unescapeInlineFieldValue(value: string): string {
	let unescapedValue = '';
	let isEscaped = false;

	for (const character of value) {
		if (isEscaped) {
			unescapedValue +=
				character === '\\' || character === '[' || character === ']'
					? character
					: `\\${character}`;
			isEscaped = false;
			continue;
		}

		if (character === '\\') {
			isEscaped = true;
			continue;
		}

		unescapedValue += character;
	}

	if (isEscaped) {
		unescapedValue += '\\';
	}

	return unescapedValue;
}

function compareDailyTimeLogEntries(
	firstEntry: DailyTimeLogEntry,
	secondEntry: DailyTimeLogEntry,
): number {
	const startComparison = firstEntry.startDateTime.localeCompare(
		secondEntry.startDateTime,
	);

	if (startComparison !== 0) {
		return startComparison;
	}

	const endComparison = firstEntry.endDateTime.localeCompare(
		secondEntry.endDateTime,
	);

	if (endComparison !== 0) {
		return endComparison;
	}

	return firstEntry.task.localeCompare(secondEntry.task);
}

function isLocalDateValue(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return false;
	}

	const parsedDate = new Date(`${value}T00:00:00`);
	return (
		!Number.isNaN(parsedDate.getTime()) &&
		parsedDate.getFullYear() === Number(value.slice(0, 4)) &&
		parsedDate.getMonth() + 1 === Number(value.slice(5, 7)) &&
		parsedDate.getDate() === Number(value.slice(8, 10))
	);
}

function isValidLocalDateTime(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) {
		return false;
	}

	const parsedDate = new Date(value);
	return !Number.isNaN(parsedDate.getTime());
}
