import { App, PluginSettingTab, Setting } from 'obsidian';
import TempoLogPlugin from './main';

const DEFAULT_LOG_FOLDER_PATH = 'TempoLog/Logs';

export interface TempoLogSettings {
	categoryFilePath: string;
	logFolderPath: string;
}

export const DEFAULT_SETTINGS: TempoLogSettings = {
	categoryFilePath: '',
	logFolderPath: DEFAULT_LOG_FOLDER_PATH,
};

export class TempoLogSettingTab extends PluginSettingTab {
	plugin: TempoLogPlugin;

	constructor(app: App, plugin: TempoLogPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Category file path')
			.setDesc('Vault-relative Markdown path.')
			.addText((text) =>
				text
					.setPlaceholder('TempoLog/Categories.md')
					.setValue(this.plugin.settings.categoryFilePath)
					.onChange(async (value) => {
						this.plugin.settings.categoryFilePath = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Log folder path')
			.setDesc('Vault-relative folder path.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_LOG_FOLDER_PATH)
					.setValue(this.plugin.settings.logFolderPath)
					.onChange(async (value) => {
						this.plugin.settings.logFolderPath = value.trim();
						await this.plugin.saveSettings();
					}),
			);
	}
}
