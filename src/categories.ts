import { App, TFile } from 'obsidian';

export interface ProjectCategoryLoadResult {
	activeCategories: string[];
	error: string | null;
	retiredCategories: string[];
}

export interface ProjectCategories {
	activeCategories: string[];
	retiredCategories: string[];
}

export async function loadProjectCategories(
	app: App,
	categoryFilePath: string,
): Promise<ProjectCategoryLoadResult> {
	const normalizedPath = categoryFilePath.trim();

	if (!normalizedPath) {
		return {
			activeCategories: [],
			error: 'Configure a category file path in TempoLog settings.',
			retiredCategories: [],
		};
	}

	if (!normalizedPath.toLowerCase().endsWith('.md')) {
		return {
			activeCategories: [],
			error: 'Category file path must point to a markdown file.',
			retiredCategories: [],
		};
	}

	const file = app.vault.getAbstractFileByPath(normalizedPath);

	if (!(file instanceof TFile)) {
		return {
			activeCategories: [],
			error: `Category file not found: ${normalizedPath}`,
			retiredCategories: [],
		};
	}

	try {
		const markdown = await app.vault.cachedRead(file);
		const categories = parseProjectCategories(markdown);

		if (categories.activeCategories.length === 0) {
			return {
				...categories,
				error: 'Category file has no active categories.',
			};
		}

		return {
			...categories,
			error: null,
		};
	} catch {
		return {
			activeCategories: [],
			error: 'Unable to read category file.',
			retiredCategories: [],
		};
	}
}

export function parseProjectCategories(markdown: string): ProjectCategories {
	const activeCategories: string[] = [];
	const activeCategorySet = new Set<string>();
	const retiredCategories: string[] = [];
	const retiredCategorySet = new Set<string>();
	let isInCodeFence = false;
	let section: ProjectCategorySection = 'active';

	for (const rawLine of markdown.split(/\r?\n/)) {
		const line = rawLine.trim();

		if (isCodeFenceLine(line)) {
			isInCodeFence = !isInCodeFence;
			continue;
		}

		if (isInCodeFence || !line) {
			continue;
		}

		const headingSection = parseCategoryHeading(line);

		if (headingSection) {
			section = headingSection;
			continue;
		}

		if (line.startsWith('#')) {
			continue;
		}

		const category = parseCategoryLine(line);

		if (!category) {
			continue;
		}

		if (section === 'active') {
			if (!activeCategorySet.has(category)) {
				activeCategories.push(category);
				activeCategorySet.add(category);
			}

			if (retiredCategorySet.has(category)) {
				retiredCategorySet.delete(category);
				retiredCategories.splice(retiredCategories.indexOf(category), 1);
			}

			continue;
		}

		if (!activeCategorySet.has(category) && !retiredCategorySet.has(category)) {
			retiredCategories.push(category);
			retiredCategorySet.add(category);
		}
	}

	return {
		activeCategories,
		retiredCategories,
	};
}

type ProjectCategorySection = 'active' | 'retired';

function parseCategoryLine(line: string): string | null {
	const category = stripMarkdownListMarker(line);
	const segments = category.split('/').map((segment) => segment.trim());

	if (segments.length < 2 || segments.some((segment) => segment.length === 0)) {
		return null;
	}

	return segments.join('/');
}

function stripMarkdownListMarker(line: string): string {
	return line
		.replace(/^[-*+]\s+(?:\[[ xX]\]\s+)?/, '')
		.replace(/^\d+[.)]\s+(?:\[[ xX]\]\s+)?/, '')
		.trim();
}

function isCodeFenceLine(line: string): boolean {
	return line.startsWith('```') || line.startsWith('~~~');
}

function parseCategoryHeading(line: string): ProjectCategorySection | null {
	if (!line.startsWith('#')) {
		return null;
	}

	const heading = line.replace(/^#+\s*/, '').trim().toLowerCase();

	if (heading === 'active categories' || heading === 'active category') {
		return 'active';
	}

	if (heading === 'retired categories' || heading === 'retired category') {
		return 'retired';
	}

	return null;
}
