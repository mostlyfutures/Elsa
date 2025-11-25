/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Your Company. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybindingService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { CodemapChannel } from '../electron-main/codemapChannel.js';

// Register codemap services
import {
	ICodemapService,
	SymbolResolutionService,
	LanguageServerService,
	QueryEngineService,
	GraphLayoutService,
	CachingService,
	ICodemapChannel
} from '../electron-main/index.js';

// Register the codemap channel as a singleton
registerSingleton(ICodemapChannel, CodemapChannel);

export class CodemapContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.codemap';

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@ICommandService private readonly commandService: ICommandService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.logService.info('[Codemap] Initializing codemap contribution');
		this.registerCommands();
		this.registerKeybindings();
		this.setupEventListeners();
	}

	private registerCommands(): void {
		// Register codemap commands
		this._register(this.commandService.registerCommand({
			id: 'codemap.show',
			title: 'Show Code Map',
			category: 'Code Map',
			f1: true
		}, () => {
			this.commandService.executeCommand('workbench.view.explorer');
			this.logService.info('[Codemap] Show code map command executed');
		}));

		this._register(this.commandService.registerCommand({
			id: 'codemap.focusSymbol',
			title: 'Focus Symbol in Code Map',
			category: 'Code Map'
		}, (symbolId: string) => {
			this.logService.info(`[Codemap] Focus symbol: ${symbolId}`);
			// Implementation would focus specific symbol in the code map
		}));

		this._register(this.commandService.registerCommand({
			id: 'codemap.analyzeFile',
			title: 'Analyze Current File in Code Map',
			category: 'Code Map'
		}, () => {
			this.logService.info('[Codemap] Analyze current file command executed');
			// Implementation would analyze the current active file
		}));

		this._register(this.commandService.registerCommand({
			id: 'codemap.findReferences',
			title: 'Find References in Code Map',
			category: 'Code Map'
		}, (symbolId: string) => {
			this.logService.info(`[Codemap] Find references for symbol: ${symbolId}`);
			// Implementation would show references in the code map
		}));

		this._register(this.commandService.registerCommand({
			id: 'codemap.showDependencies',
			title: 'Show Dependencies in Code Map',
			category: 'Code Map'
		}, () => {
			this.logService.info('[Codemap] Show dependencies command executed');
			// Implementation would show dependency graph
		}));

		this._register(this.commandService.registerCommand({
			id: 'codemap.export',
			title: 'Export Code Map',
			category: 'Code Map'
		}, () => {
			this.logService.info('[Codemap] Export code map command executed');
			// Implementation would export the current graph view
		}));

		this._register(this.commandService.registerCommand({
			id: 'codemap.refresh',
			title: 'Refresh Code Map',
			category: 'Code Map'
		}, () => {
			this.logService.info('[Codemap] Refresh code map command executed');
			// Implementation would refresh the current view
		}));
	}

	private registerKeybindings(): void {
		// Register keybindings for codemap commands
		this._register(this.keybindingService.registerKeybindingRule({
			id: 'codemap.toggle',
			primary: 2048 /* CtrlCMD */ | 51 /* KeyM */,
			weight: 100,
			when: null,
			command: 'codemap.show'
		}));

		this._register(this.keybindingService.registerKeybindingRule({
			id: 'codemap.focus',
			primary: 2048 /* CtrlCMD */ | 52 /* KeyF */,
			weight: 100,
			when: 'codemapViewVisible',
			command: 'codemap.focusSymbol'
		}));

		this._register(this.keybindingService.registerKeybindingRule({
			id: 'codemap.analyze',
			primary: 2048 /* CtrlCMD */ | 54 /* KeyG */,
			weight: 100,
			when: 'editorTextFocus',
			command: 'codemap.analyzeFile'
		}));
	}

	private setupEventListeners(): void {
		// Set up workspace event listeners
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => {
			this.logService.info('[Codemap] Workspace folders changed');
			// Implementation would refresh the code map
		}));

		// Set up context key for when codemap view is visible
		const codemapVisibleContext = this.contextKeyService.createKey('codemapViewVisible', false);

		// Listen for view visibility changes
		// This would be connected to the actual view visibility state
	}

	// Initialize codemap services
	private async initializeServices(): Promise<void> {
		try {
			// Get the codemap channel
			const codemapChannel = this.instantiationService.createInstance(CodemapChannel);

			// Perform health check
			const healthCheck = await codemapChannel.call('healthCheck');
			this.logService.info('[Codemap] Health check result:', healthCheck);

			// Start language servers for common languages if needed
			const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
			if (workspaceFolders.length > 0) {
				const workspacePath = workspaceFolders[0].uri.fsPath;

				// Start TypeScript language server
				await codemapChannel.call('startLanguageServer', ['typescript', workspacePath]);

				// Start JavaScript language server
				await codemapChannel.call('startLanguageServer', ['javascript', workspacePath]);
			}

		} catch (error) {
			this.logService.error('[Codemap] Failed to initialize services:', error);
		}
	}
}