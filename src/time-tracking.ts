import {
	App,
	ButtonComponent,
	DropdownComponent,
	Modal,
	Notice,
	Setting,
	SuggestModal,
	TextComponent,
} from 'obsidian';
import { loadProjectCategories } from './categories';
import { saveTimeLogEntry } from './time-log';
import type TempoLogPlugin from './main';

const DURATION_INCREMENT_MINUTES = 15;
const MAX_DURATION_MINUTES = 8 * 60;

export interface TrackedTimeEntry {
	category: string;
	task: string;
	date: string;
	startTime: string;
	endTime: string;
	startDateTime: string;
	endDateTime: string;
	durationMinutes: number;
	notes: string;
	submittedAt: string;
}

interface TimeTrackingFormData {
	category: string;
	task: string;
	date: string;
	startTime: string;
	endTime: string;
	durationMinutes: number | null;
	notes: string;
}

type TimeEntrySavedCallback = () => Promise<void> | void;

export function registerTrackTimeCommand(
	plugin: TempoLogPlugin,
	onTimeEntrySaved?: TimeEntrySavedCallback,
): void {
	plugin.addCommand({
		id: 'track-time',
		name: 'Track time',
		callback: async () => {
			await openTrackTimeModal(plugin, onTimeEntrySaved);
		},
	});
}

export async function openTrackTimeModal(
	plugin: TempoLogPlugin,
	onTimeEntrySaved?: TimeEntrySavedCallback,
): Promise<void> {
	const categoryResult = await loadProjectCategories(
		plugin.app,
		plugin.settings.categoryFilePath,
	);

	if (categoryResult.error) {
		new Notice(categoryResult.error);
	}

	new TrackTimeModal(
		plugin,
		categoryResult.activeCategories,
		onTimeEntrySaved,
	).open();
}

class TrackTimeModal extends Modal {
	private categoryButton: ButtonComponent | null = null;
	private durationDropdown: DropdownComponent | null = null;
	private endTimeInput: TextComponent | null = null;
	private formData: TimeTrackingFormData = createDefaultFormData();
	private startTimeInput: TextComponent | null = null;

	constructor(
		private readonly plugin: TempoLogPlugin,
		private readonly categories: string[],
		private readonly onTimeEntrySaved?: TimeEntrySavedCallback,
	) {
		super(plugin.app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Track time' });

		new Setting(contentEl)
			.setName('Task')
			.setDesc('Describe what you worked on.')
			.addText((text) => {
				text
					.setPlaceholder('Task or description')
					.setValue(this.formData.task)
					.onChange((value) => {
						this.formData.task = value;
					});
			});

		new Setting(contentEl)
			.setName('Category')
			.setDesc('Required.')
			.addButton((button) => {
				this.categoryButton = button;
				button
					.setButtonText(this.getCategoryButtonText())
					.onClick(() => {
						new CategorySuggestModal(
							this.app,
							this.categories,
							(category) => this.setCategory(category),
						).open();
					});
				button.buttonEl.disabled = this.categories.length === 0;
			});

		new Setting(contentEl)
			.setName('Date')
			.addText((text) => {
				text.inputEl.type = 'date';
				text
					.setValue(this.formData.date)
					.onChange((value) => {
						this.formData.date = value;
						this.syncFromCurrentValues();
					});
			});

		new Setting(contentEl)
			.setName('Start time')
			.addText((text) => {
				this.startTimeInput = text;
				text.inputEl.type = 'time';
				text.inputEl.step = String(DURATION_INCREMENT_MINUTES * 60);
				text
					.setValue(this.formData.startTime)
					.onChange((value) => {
						this.setStartTime(roundTimeValueToNearestIncrement(value));
						this.syncDurationFromStartAndEnd();
					});
			});

		new Setting(contentEl)
			.setName('End time')
			.addText((text) => {
				this.endTimeInput = text;
				text.inputEl.type = 'time';
				text.inputEl.step = String(DURATION_INCREMENT_MINUTES * 60);
				text
					.setValue(this.formData.endTime)
					.onChange((value) => {
						this.setEndTime(roundTimeValueToNearestIncrement(value));
						this.syncFromCurrentValues();
					});
			});

		new Setting(contentEl)
			.setName('Duration')
			.addDropdown((dropdown) => {
				this.durationDropdown = dropdown;
				dropdown.addOption('', '');

				for (
					let minutes = DURATION_INCREMENT_MINUTES;
					minutes <= MAX_DURATION_MINUTES;
					minutes += DURATION_INCREMENT_MINUTES
				) {
					dropdown.addOption(String(minutes), formatDurationLabel(minutes));
				}

				dropdown
					.setValue(durationToDropdownValue(this.formData.durationMinutes))
					.onChange((value) => {
						this.formData.durationMinutes = dropdownValueToDuration(value);
						this.syncStartFromDurationAndEnd();
					});
			});

		new Setting(contentEl)
			.setName('Notes')
			.setDesc('Optional.')
			.addTextArea((text) => {
				text
					.setPlaceholder('Add notes')
					.setValue(this.formData.notes)
					.onChange((value) => {
						this.formData.notes = value;
					});
			});

		new Setting(contentEl).addButton((button) => {
			button
				.setButtonText('Log time')
				.setCta()
				.onClick(async () => {
					await this.submit();
				});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(): Promise<void> {
		this.setStartTime(roundTimeValueToNearestIncrement(this.formData.startTime));
		this.setEndTime(roundTimeValueToNearestIncrement(this.formData.endTime));
		this.syncFromCurrentValues();

		const task = this.formData.task.trim();
		const category = this.formData.category.trim();
		const date = this.formData.date.trim();
		const startTime = this.formData.startTime.trim();
		const endTime = this.formData.endTime.trim();
		const durationMinutes = this.formData.durationMinutes;
		const notes = this.formData.notes.trim();

		if (!task || !date || !endTime) {
			new Notice('Enter task, date, and end time.');
			return;
		}

		if (!category) {
			new Notice('Select a category.');
			return;
		}

		if (durationMinutes !== null) {
			const calculatedStartDateTime = this.getStartFromDurationAndEnd(
				date,
				endTime,
				durationMinutes,
			);

			if (
				calculatedStartDateTime &&
				getLocalDateValue(calculatedStartDateTime) !== date
			) {
				new Notice('Duration cannot start before the selected date.');
				return;
			}
		}

		if (!startTime || durationMinutes === null) {
			new Notice('Start time and duration are required.');
			return;
		}

		const startDateTime = parseDateTime(date, startTime);
		const endDateTime = parseDateTime(date, endTime);

		if (!startDateTime || !endDateTime) {
			new Notice('Enter a valid date and time.');
			return;
		}

		if (endDateTime.getTime() <= startDateTime.getTime()) {
			new Notice('End time must be after start time.');
			return;
		}

		const calculatedStartDateTime = subtractMinutes(endDateTime, durationMinutes);

		if (getLocalDateValue(calculatedStartDateTime) !== date) {
			new Notice('Duration cannot start before the selected date.');
			return;
		}

		const entry: TrackedTimeEntry = {
			category,
			task,
			date,
			startTime: getLocalTimeValue(calculatedStartDateTime),
			endTime,
			startDateTime: getLocalDateTimeValue(calculatedStartDateTime),
			endDateTime: getLocalDateTimeValue(endDateTime),
			durationMinutes,
			notes,
			submittedAt: new Date().toISOString(),
		};

		try {
			await saveTimeLogEntry(this.app, this.plugin.settings.logFolderPath, {
				category: entry.category,
				task: entry.task,
				logDate: entry.date,
				startDateTime: entry.startDateTime,
				endDateTime: entry.endDateTime,
				durationMinutes: entry.durationMinutes,
				notes: entry.notes,
				loggedAt: entry.submittedAt,
			});
		} catch {
			new Notice('Unable to save time entry.');
			return;
		}

		try {
			await this.onTimeEntrySaved?.();
		} catch {
			new Notice('Time entry saved. Refresh the dashboard to see it.');
			this.close();
			return;
		}

		new Notice('Time entry saved.');
		this.close();
	}

	private syncFromCurrentValues(): void {
		if (this.formData.durationMinutes !== null) {
			this.syncStartFromDurationAndEnd();
			return;
		}

		this.syncDurationFromStartAndEnd();
	}

	private syncStartFromDurationAndEnd(): void {
		if (!this.formData.endTime || this.formData.durationMinutes === null) {
			return;
		}

		const endDateTime = parseDateTime(this.formData.date, this.formData.endTime);

		if (!endDateTime) {
			this.setStartTime('');
			return;
		}

		const startDateTime = subtractMinutes(endDateTime, this.formData.durationMinutes);

		if (getLocalDateValue(startDateTime) !== this.formData.date) {
			this.setStartTime('');
			return;
		}

		this.setStartTime(getLocalTimeValue(startDateTime));
	}

	private syncDurationFromStartAndEnd(): void {
		if (!this.formData.startTime || !this.formData.endTime) {
			this.setDuration(null);
			return;
		}

		const startDateTime = parseDateTime(
			this.formData.date,
			this.formData.startTime,
		);
		const endDateTime = parseDateTime(
			this.formData.date,
			this.formData.endTime,
		);

		if (!startDateTime || !endDateTime) {
			this.setDuration(null);
			return;
		}

		const rawDurationMinutes =
			(endDateTime.getTime() - startDateTime.getTime()) / 60000;

		if (rawDurationMinutes <= 0) {
			this.setDuration(null);
			return;
		}

		const roundedDurationMinutes =
			Math.ceil(rawDurationMinutes / DURATION_INCREMENT_MINUTES) *
			DURATION_INCREMENT_MINUTES;

		if (roundedDurationMinutes > MAX_DURATION_MINUTES) {
			this.setDuration(null);
			return;
		}

		this.setDuration(roundedDurationMinutes);
		this.syncStartFromDurationAndEnd();
	}

	private setDuration(durationMinutes: number | null): void {
		this.formData.durationMinutes = durationMinutes;
		this.durationDropdown?.setValue(durationToDropdownValue(durationMinutes));
	}

	private setStartTime(startTime: string): void {
		this.formData.startTime = startTime;
		this.startTimeInput?.setValue(startTime);
	}

	private setEndTime(endTime: string): void {
		this.formData.endTime = endTime;
		this.endTimeInput?.setValue(endTime);
	}

	private setCategory(category: string): void {
		this.formData.category = category;
		this.categoryButton?.setButtonText(this.getCategoryButtonText());
	}

	private getCategoryButtonText(): string {
		if (this.categories.length === 0) {
			return 'No categories loaded';
		}

		return this.formData.category || 'Select category';
	}

	private getStartFromDurationAndEnd(
		date: string,
		endTime: string,
		durationMinutes: number,
	): Date | null {
		const endDateTime = parseDateTime(date, endTime);

		if (!endDateTime) {
			return null;
		}

		return subtractMinutes(endDateTime, durationMinutes);
	}
}

class CategorySuggestModal extends SuggestModal<string> {
	constructor(
		app: App,
		private readonly categories: string[],
		private readonly onChooseCategory: (category: string) => void,
	) {
		super(app);
		this.setPlaceholder('Search categories');
		this.emptyStateText = 'No matching categories';
		this.limit = 20;
	}

	getSuggestions(query: string): string[] {
		const normalizedQuery = query.trim().toLowerCase();

		if (!normalizedQuery) {
			return this.categories;
		}

		return this.categories.filter((category) =>
			category.toLowerCase().includes(normalizedQuery),
		);
	}

	renderSuggestion(category: string, el: HTMLElement): void {
		el.setText(category);
	}

	onChooseSuggestion(category: string): void {
		this.onChooseCategory(category);
	}
}

function createDefaultFormData(): TimeTrackingFormData {
	const now = roundDateToNearestIncrement(new Date());

	return {
		category: '',
		task: '',
		date: getLocalDateValue(now),
		startTime: '',
		endTime: getLocalTimeValue(now),
		durationMinutes: null,
		notes: '',
	};
}

function parseDateTime(date: string, time: string): Date | null {
	const parsedDate = new Date(`${date}T${time}`);

	if (Number.isNaN(parsedDate.getTime())) {
		return null;
	}

	return parsedDate;
}

function subtractMinutes(date: Date, minutes: number): Date {
	return new Date(date.getTime() - minutes * 60000);
}

function roundDateToNearestIncrement(date: Date): Date {
	const incrementMilliseconds = DURATION_INCREMENT_MINUTES * 60000;
	return new Date(
		Math.round(date.getTime() / incrementMilliseconds) * incrementMilliseconds,
	);
}

function getLocalDateValue(date: Date): string {
	const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
	return localDate.toISOString().slice(0, 10);
}

function getLocalTimeValue(date: Date): string {
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	return `${hours}:${minutes}`;
}

function getLocalDateTimeValue(date: Date): string {
	return `${getLocalDateValue(date)}T${getLocalTimeValue(date)}:00`;
}

function roundTimeValueToNearestIncrement(time: string): string {
	const totalMinutes = parseTimeToMinutes(time);

	if (totalMinutes === null) {
		return '';
	}

	const roundedMinutes =
		Math.round(totalMinutes / DURATION_INCREMENT_MINUTES) *
		DURATION_INCREMENT_MINUTES;

	return formatTimeFromMinutes(roundedMinutes);
}

function parseTimeToMinutes(time: string): number | null {
	const [hoursValue, minutesValue] = time.split(':');

	if (!hoursValue || !minutesValue) {
		return null;
	}

	const hours = Number(hoursValue);
	const minutes = Number(minutesValue);

	if (
		!Number.isInteger(hours) ||
		!Number.isInteger(minutes) ||
		hours < 0 ||
		hours > 23 ||
		minutes < 0 ||
		minutes > 59
	) {
		return null;
	}

	return hours * 60 + minutes;
}

function formatTimeFromMinutes(totalMinutes: number): string {
	const minutesInDay = 24 * 60;
	const normalizedMinutes =
		((totalMinutes % minutesInDay) + minutesInDay) % minutesInDay;
	const hours = Math.floor(normalizedMinutes / 60);
	const minutes = normalizedMinutes % 60;

	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function durationToDropdownValue(durationMinutes: number | null): string {
	return durationMinutes === null ? '' : String(durationMinutes);
}

function dropdownValueToDuration(value: string): number | null {
	return value === '' ? null : Number(value);
}

function formatDurationLabel(totalMinutes: number): string {
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;

	if (hours === 0) {
		return `${minutes}m`;
	}

	if (minutes === 0) {
		return `${hours}hr`;
	}

	return `${hours}hr ${minutes}m`;
}
