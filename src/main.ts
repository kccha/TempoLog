import { Plugin } from 'obsidian';
import {
	openDashboardView,
	refreshDashboardViews,
	registerDashboardView,
} from './dashboard';
import {
	DEFAULT_SETTINGS,
	TempoLogSettings,
	TempoLogSettingTab,
} from './settings';
import { registerTrackTimeCommand } from './time-tracking';

const PLUGIN_NAME = 'TempoLog';

export default class TempoLogPlugin extends Plugin {
	settings!: TempoLogSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		registerDashboardView(this);

		this.addRibbonIcon('calendar-clock', PLUGIN_NAME, async () => {
			await openDashboardView(this);
		});

		registerTrackTimeCommand(this, async () => {
			await refreshDashboardViews(this.app);
		});

		this.addSettingTab(new TempoLogSettingTab(this.app, this));
	}

	onunload(): void {}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<TempoLogSettings>,
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
