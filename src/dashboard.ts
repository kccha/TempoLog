import {
	App,
	ButtonComponent,
	ItemView,
	Notice,
	TextComponent,
	ViewStateResult,
	WorkspaceLeaf,
} from 'obsidian';
import {
	DailyTimeLogEntry,
	loadTimeLogEntriesForDate,
} from './time-log';
import { openTrackTimeModal } from './time-tracking';
import type TempoLogPlugin from './main';

export const VIEW_TYPE_TEMPOLOG_DASHBOARD = 'tempolog-dashboard';

const DASHBOARD_ICON = 'calendar-clock';
const DAY_MINUTES = 24 * 60;

interface TimelineEntryLayout {
	column: number;
	columnCount: number;
	endMinute: number;
	entry: DailyTimeLogEntry;
	startMinute: number;
}

interface TimelineEntryBounds {
	endMinute: number;
	entry: DailyTimeLogEntry;
	startMinute: number;
}

export function registerDashboardView(plugin: TempoLogPlugin): void {
	plugin.registerView(
		VIEW_TYPE_TEMPOLOG_DASHBOARD,
		(leaf) => new TempoLogDashboardView(leaf, plugin),
	);

	plugin.addCommand({
		id: 'open-dashboard',
		name: 'Open dashboard',
		callback: async () => {
			await openDashboardView(plugin);
		},
	});
}

export async function openDashboardView(
	plugin: TempoLogPlugin,
	date = getLocalDateValue(new Date()),
): Promise<void> {
	const existingLeaf = plugin.app.workspace.getLeavesOfType(
		VIEW_TYPE_TEMPOLOG_DASHBOARD,
	)[0];
	const leaf = existingLeaf ?? plugin.app.workspace.getRightLeaf(false);

	if (!leaf) {
		new Notice('Unable to open dashboard.');
		return;
	}

	await leaf.setViewState({
		active: true,
		state: {
			date,
		},
		type: VIEW_TYPE_TEMPOLOG_DASHBOARD,
	});

	plugin.app.workspace.rightSplit.expand();
	plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
}

export async function refreshDashboardViews(app: App): Promise<void> {
	await Promise.all(
		app.workspace
			.getLeavesOfType(VIEW_TYPE_TEMPOLOG_DASHBOARD)
			.map(async (leaf) => {
				if (leaf.view instanceof TempoLogDashboardView) {
					await leaf.view.refresh();
				}
			}),
	);
}

class TempoLogDashboardView extends ItemView {
	private renderRequestId = 0;
	private selectedDate = getLocalDateValue(new Date());

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: TempoLogPlugin,
	) {
		super(leaf);
		this.icon = DASHBOARD_ICON;
		this.navigation = false;
	}

	getViewType(): string {
		return VIEW_TYPE_TEMPOLOG_DASHBOARD;
	}

	getDisplayText(): string {
		return 'Timeline';
	}

	getState(): Record<string, unknown> {
		return {
			date: this.selectedDate,
		};
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		await super.setState(state, result);

		const date = parseDateState(state);

		if (date) {
			this.selectedDate = date;
		}

		await this.render();
	}

	async refresh(): Promise<void> {
		await this.render();
	}

	protected async onOpen(): Promise<void> {
		await this.render();
	}

	protected async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	private async render(): Promise<void> {
		const renderRequestId = this.renderRequestId + 1;
		this.renderRequestId = renderRequestId;
		const date = this.selectedDate;

		this.contentEl.empty();
		this.contentEl.addClass('tempolog-dashboard');

		this.renderHeader(this.contentEl, date);

		const bodyEl = this.contentEl.createDiv({
			cls: 'tempolog-dashboard__body',
		});
		bodyEl.createDiv({
			cls: 'tempolog-dashboard__loading',
			text: 'Loading timeline...',
		});

		try {
			const entries = await loadTimeLogEntriesForDate(
				this.app,
				this.plugin.settings.logFolderPath,
				date,
			);

			if (renderRequestId !== this.renderRequestId) {
				return;
			}

			bodyEl.empty();
			this.renderSummary(bodyEl, entries);

			if (entries.length === 0) {
				this.renderEmptyState(bodyEl);
				return;
			}

			this.renderTimeline(bodyEl, entries);
		} catch {
			if (renderRequestId !== this.renderRequestId) {
				return;
			}

			bodyEl.empty();
			this.renderErrorState(bodyEl);
		}
	}

	private renderHeader(containerEl: HTMLElement, date: string): void {
		const headerEl = containerEl.createDiv({
			cls: 'tempolog-dashboard__header',
		});

		headerEl.createEl('h2', {
			cls: 'tempolog-dashboard__title',
			text: 'Timeline',
		});

		const controlsEl = headerEl.createDiv({
			cls: 'tempolog-dashboard__controls',
		});

		new ButtonComponent(controlsEl)
			.setIcon('chevron-left')
			.setTooltip('Previous day')
			.onClick(async () => {
				await this.shiftSelectedDate(-1);
			});

		const dateInput = new TextComponent(controlsEl);
		dateInput.inputEl.type = 'date';
		dateInput.inputEl.addClass('tempolog-dashboard__date-input');
		dateInput.setValue(date).onChange(async (value) => {
			if (isLocalDateValue(value)) {
				await this.setSelectedDate(value);
			}
		});

		new ButtonComponent(controlsEl)
			.setIcon('chevron-right')
			.setTooltip('Next day')
			.onClick(async () => {
				await this.shiftSelectedDate(1);
			});

		new ButtonComponent(controlsEl)
			.setButtonText('Today')
			.setTooltip('Show today')
			.onClick(async () => {
				await this.setSelectedDate(getLocalDateValue(new Date()));
			});

		new ButtonComponent(controlsEl)
			.setIcon('refresh-cw')
			.setTooltip('Refresh')
			.onClick(async () => {
				await this.refresh();
			});

		new ButtonComponent(controlsEl)
			.setIcon('plus')
			.setTooltip('Log time')
			.setCta()
			.onClick(async () => {
				await openTrackTimeModal(this.plugin, async () => {
					await refreshDashboardViews(this.app);
				});
			});
	}

	private renderSummary(
		containerEl: HTMLElement,
		entries: DailyTimeLogEntry[],
	): void {
		const totalMinutes = entries.reduce(
			(total, entry) => total + entry.durationMinutes,
			0,
		);
		const summaryEl = containerEl.createDiv({
			cls: 'tempolog-dashboard__summary',
		});

		this.renderMetric(summaryEl, 'Date', formatDateLabel(this.selectedDate));
		this.renderMetric(summaryEl, 'Total', formatDuration(totalMinutes));
		this.renderMetric(summaryEl, 'Entries', String(entries.length));

		if (entries.length === 0) {
			return;
		}

		const categoryTotals = getCategoryTotals(entries);
		const categoriesEl = containerEl.createDiv({
			cls: 'tempolog-dashboard__categories',
		});

		for (const [category, minutes] of categoryTotals) {
			const categoryEl = categoriesEl.createDiv({
				cls: 'tempolog-dashboard__category-total',
			});
			categoryEl.createSpan({
				cls: 'tempolog-dashboard__category-name',
				text: category,
			});
			categoryEl.createSpan({
				cls: 'tempolog-dashboard__category-duration',
				text: formatDuration(minutes),
			});
		}
	}

	private renderMetric(
		containerEl: HTMLElement,
		label: string,
		value: string,
	): void {
		const metricEl = containerEl.createDiv({
			cls: 'tempolog-dashboard__metric',
		});
		metricEl.createSpan({
			cls: 'tempolog-dashboard__metric-label',
			text: label,
		});
		metricEl.createSpan({
			cls: 'tempolog-dashboard__metric-value',
			text: value,
		});
	}

	private renderTimeline(
		containerEl: HTMLElement,
		entries: DailyTimeLogEntry[],
	): void {
		const timelineEl = containerEl.createDiv({
			cls: 'tempolog-dashboard__timeline',
		});
		const hourColumnEl = timelineEl.createDiv({
			cls: 'tempolog-dashboard__hour-column',
		});
		const gridEl = timelineEl.createDiv({
			cls: 'tempolog-dashboard__time-grid',
		});

		for (let hour = 0; hour <= 24; hour += 1) {
			const topPercent = (hour / 24) * 100;
			const labelEl = hourColumnEl.createDiv({
				cls: 'tempolog-dashboard__hour-label',
				text: formatHourLabel(hour),
			});
			labelEl.style.top = `${topPercent}%`;

			const lineEl = gridEl.createDiv({
				cls: 'tempolog-dashboard__hour-line',
			});
			lineEl.style.top = `${topPercent}%`;
		}

		const entryLayerEl = gridEl.createDiv({
			cls: 'tempolog-dashboard__entry-layer',
		});

		for (const layout of buildTimelineLayout(entries)) {
			this.renderTimelineEntry(entryLayerEl, layout);
		}
	}

	private renderTimelineEntry(
		containerEl: HTMLElement,
		layout: TimelineEntryLayout,
	): void {
		const topPercent = (layout.startMinute / DAY_MINUTES) * 100;
		const heightPercent =
			((layout.endMinute - layout.startMinute) / DAY_MINUTES) * 100;
		const widthPercent = 100 / layout.columnCount;
		const leftPercent = layout.column * widthPercent;
		const entryEl = containerEl.createDiv({
			cls: 'tempolog-dashboard__entry',
		});

		entryEl.style.top = `${topPercent}%`;
		entryEl.style.left = `calc(${leftPercent}% + 2px)`;
		entryEl.style.width = `calc(${widthPercent}% - 4px)`;
		entryEl.style.height = `calc(${heightPercent}% - 2px)`;
		const tooltipText = formatEntryTooltip(layout.entry);
		entryEl.setAttr('aria-label', tooltipText);
		entryEl.setAttr('title', tooltipText);

		entryEl.createDiv({
			cls: 'tempolog-dashboard__entry-task',
			text: layout.entry.task,
		});
		entryEl.createDiv({
			cls: 'tempolog-dashboard__entry-category',
			text: layout.entry.category,
		});
		entryEl.createDiv({
			cls: 'tempolog-dashboard__entry-time',
			text: `${formatTime(layout.entry.startDateTime)}-${formatTime(
				layout.entry.endDateTime,
			)} · ${formatDuration(layout.entry.durationMinutes)}`,
		});

		if (layout.entry.notes) {
			entryEl.createDiv({
				cls: 'tempolog-dashboard__entry-notes',
				text: layout.entry.notes,
			});
		}
	}

	private renderEmptyState(containerEl: HTMLElement): void {
		const emptyEl = containerEl.createDiv({
			cls: 'tempolog-dashboard__empty',
		});
		emptyEl.createDiv({
			cls: 'tempolog-dashboard__empty-title',
			text: 'No entries for this day',
		});
		emptyEl.createDiv({
			cls: 'tempolog-dashboard__empty-description',
			text: 'Use Track time to add an entry.',
		});
	}

	private renderErrorState(containerEl: HTMLElement): void {
		const errorEl = containerEl.createDiv({
			cls: 'tempolog-dashboard__error',
		});
		errorEl.createDiv({
			cls: 'tempolog-dashboard__error-title',
			text: 'Unable to load time entries',
		});
		errorEl.createDiv({
			cls: 'tempolog-dashboard__error-description',
			text: 'Check that the log folder path points to a vault folder.',
		});
	}

	private async shiftSelectedDate(dayDelta: number): Promise<void> {
		const selectedDate = new Date(`${this.selectedDate}T00:00:00`);
		selectedDate.setDate(selectedDate.getDate() + dayDelta);
		await this.setSelectedDate(getLocalDateValue(selectedDate));
	}

	private async setSelectedDate(date: string): Promise<void> {
		this.selectedDate = date;
		await this.leaf.setViewState({
			active: true,
			state: {
				date,
			},
			type: VIEW_TYPE_TEMPOLOG_DASHBOARD,
		});
	}
}

function buildTimelineLayout(
	entries: DailyTimeLogEntry[],
): TimelineEntryLayout[] {
	const layouts: TimelineEntryLayout[] = [];
	const pendingBounds = entries
		.map(getTimelineEntryBounds)
		.filter((bounds): bounds is TimelineEntryBounds => bounds !== null)
		.sort(compareTimelineEntryBounds);
	let group: TimelineEntryBounds[] = [];
	let groupEndMinute = 0;

	for (const bounds of pendingBounds) {
		if (group.length > 0 && bounds.startMinute >= groupEndMinute) {
			layouts.push(...layoutOverlappingGroup(group));
			group = [];
		}

		group.push(bounds);
		groupEndMinute = Math.max(groupEndMinute, bounds.endMinute);
	}

	if (group.length > 0) {
		layouts.push(...layoutOverlappingGroup(group));
	}

	return layouts;
}

function layoutOverlappingGroup(
	group: TimelineEntryBounds[],
): TimelineEntryLayout[] {
	const columnEndMinutes: number[] = [];
	const layouts: Omit<TimelineEntryLayout, 'columnCount'>[] = [];

	for (const bounds of group) {
		let reusableColumnIndex = -1;

		for (
			let columnIndex = 0;
			columnIndex < columnEndMinutes.length;
			columnIndex += 1
		) {
			const columnEndMinute = columnEndMinutes[columnIndex];

			if (
				columnEndMinute !== undefined &&
				columnEndMinute <= bounds.startMinute
			) {
				reusableColumnIndex = columnIndex;
				break;
			}
		}

		const column =
			reusableColumnIndex === -1
				? columnEndMinutes.length
				: reusableColumnIndex;
		columnEndMinutes[column] = bounds.endMinute;
		layouts.push({
			column,
			endMinute: bounds.endMinute,
			entry: bounds.entry,
			startMinute: bounds.startMinute,
		});
	}

	const columnCount = Math.max(1, columnEndMinutes.length);
	return layouts.map((layout) => ({
		...layout,
		columnCount,
	}));
}

function getTimelineEntryBounds(
	entry: DailyTimeLogEntry,
): TimelineEntryBounds | null {
	const startMinute = getDateTimeMinuteOfDay(entry.startDateTime);
	const endMinute = getDateTimeMinuteOfDay(entry.endDateTime);

	if (startMinute === null || endMinute === null) {
		return null;
	}

	const calculatedEndMinute =
		endMinute > startMinute ? endMinute : startMinute + entry.durationMinutes;
	const clampedStartMinute = clamp(startMinute, 0, DAY_MINUTES - 1);
	const clampedEndMinute = clamp(
		Math.max(calculatedEndMinute, clampedStartMinute + 1),
		clampedStartMinute + 1,
		DAY_MINUTES,
	);

	return {
		endMinute: clampedEndMinute,
		entry,
		startMinute: clampedStartMinute,
	};
}

function compareTimelineEntryBounds(
	first: TimelineEntryBounds,
	second: TimelineEntryBounds,
): number {
	if (first.startMinute !== second.startMinute) {
		return first.startMinute - second.startMinute;
	}

	if (first.endMinute !== second.endMinute) {
		return first.endMinute - second.endMinute;
	}

	return first.entry.task.localeCompare(second.entry.task);
}

function getCategoryTotals(
	entries: DailyTimeLogEntry[],
): Array<[string, number]> {
	const categoryTotals = new Map<string, number>();

	for (const entry of entries) {
		categoryTotals.set(
			entry.category,
			(categoryTotals.get(entry.category) ?? 0) + entry.durationMinutes,
		);
	}

	return Array.from(categoryTotals.entries()).sort(
		([firstCategory, firstMinutes], [secondCategory, secondMinutes]) =>
			secondMinutes - firstMinutes || firstCategory.localeCompare(secondCategory),
	);
}

function parseDateState(state: unknown): string | null {
	if (!state || typeof state !== 'object') {
		return null;
	}

	const date = (state as Record<string, unknown>).date;
	return typeof date === 'string' && isLocalDateValue(date) ? date : null;
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

function getDateTimeMinuteOfDay(value: string): number | null {
	const hour = Number(value.slice(11, 13));
	const minute = Number(value.slice(14, 16));

	if (
		!Number.isInteger(hour) ||
		!Number.isInteger(minute) ||
		hour < 0 ||
		hour > 23 ||
		minute < 0 ||
		minute > 59
	) {
		return null;
	}

	return hour * 60 + minute;
}

function getLocalDateValue(date: Date): string {
	const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
	return localDate.toISOString().slice(0, 10);
}

function formatDateLabel(date: string): string {
	const parsedDate = new Date(`${date}T00:00:00`);

	if (Number.isNaN(parsedDate.getTime())) {
		return date;
	}

	return parsedDate.toLocaleDateString(undefined, {
		day: 'numeric',
		month: 'short',
		weekday: 'short',
		year: 'numeric',
	});
}

function formatHourLabel(hour: number): string {
	return `${String(hour).padStart(2, '0')}:00`;
}

function formatTime(dateTime: string): string {
	return dateTime.slice(11, 16);
}

function formatDuration(totalMinutes: number): string {
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

function formatEntryTooltip(entry: DailyTimeLogEntry): string {
	const tooltipLines = [
		entry.task,
		entry.category,
		`${formatTime(entry.startDateTime)}-${formatTime(
			entry.endDateTime,
		)} · ${formatDuration(entry.durationMinutes)}`,
	];

	if (entry.notes) {
		tooltipLines.push(entry.notes);
	}

	return tooltipLines.join('\n');
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(Math.max(value, minimum), maximum);
}
