/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Your Company. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { ILanguageService } from '../../../../editor/common/languages/languageService.js';
import { ILanguageServerService, ILanguageServerClient } from '../../../../editor/common/services/languageServerService.js';
import {
	Symbol,
	SymbolKind,
	SymbolReference,
	Relationship,
	RelationshipType,
	CodemapError
} from '../common/codemapTypes.js';

export interface ILanguageServerManager {
	// Server lifecycle
	startServer(language: string, workspacePath: string): Promise<void>;
	stopServer(language: string): Promise<void>;
	restartServer(language: string): Promise<void>;
	isServerRunning(language: string): boolean;

	// Symbol operations
	getDocumentSymbols(uri: string): Promise<any[]>;
	getDocumentSymbolsForLanguage(uri: string, language: string): Promise<any[]>;

	// Reference operations
	getReferences(uri: string, position: { line: number; character: number }, options: any): Promise<any[]>;
	getDefinition(uri: string, position: { line: number; character: number }): Promise<any>;
	getImplementations(uri: string, position: { line: number; character: number }): Promise<any[]>;
 getTypeDefinition(uri: string, position: { line: number; character: number }): Promise<any[]>;

	// Document operations
	getDocumentText(uri: string): Promise<string>;
	getWordAtPosition(uri: string, position: { line: number; character: number }): Promise<{ word: string; range: any } | null>;

	// Events
	onServerConnected: EventEmitter<{ language: string; server: ILanguageServerClient }>;
	onServerDisconnected: EventEmitter<{ language: string; reason?: string }>;
	onServerError: EventEmitter<{ language: string; error: Error }>;

	// Lifecycle
	dispose(): void;
}

export class LanguageServerService extends Disposable implements ILanguageServerManager {
	public readonly onServerConnected = this._disposables.add(new EventEmitter<{ language: string; server: ILanguageServerClient }>());
	public readonly onServerDisconnected = this._disposables.add(new EventEmitter<{ language: string; reason?: string }>());
	public readonly onServerError = this._disposables.add(new EventEmitter<{ language: string; error: Error }>());

	private readonly languageServers = new Map<string, ILanguageServerClient>();
	private readonly serverConfigurations = new Map<string, LanguageServerConfig>();
	private readonly workspaceFolders = new Set<string>();

	constructor(
		@ILogService private readonly logService: ILogService,
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@ILanguageService private readonly languageService: ILanguageService,
		@ILanguageServerService private readonly languageServerService: ILanguageServerService
	) {
		super();
		this.initializeLanguageServerConfigurations();
		this.logService.debug('[Codemap] LanguageServerService initialized');
	}

	async startServer(language: string, workspacePath: string): Promise<void> {
		try {
			if (this.isServerRunning(language)) {
				this.logService.debug(`[Codemap] Language server for ${language} is already running`);
				return;
			}

			this.logService.info(`[Codemap] Starting language server for ${language} in ${workspacePath}`);

			const config = this.serverConfigurations.get(language);
			if (!config) {
				throw new CodemapError(`No language server configuration found for ${language}`, 'NO_SERVER_CONFIG');
			}

			// Add workspace folder if not already added
			this.workspaceFolders.add(workspacePath);

			// Start the language server
			const client = await this.languageServerService.startClient({
				id: `codemap-${language}`,
				name: `Codemap ${language} Server`,
				language,
				workspaceFolders: [workspacePath],
				...config
			});

			this.languageServers.set(language, client);

			// Set up event handlers
			this.setupServerEventHandlers(language, client);

			this.onServerConnected.fire({ language, server: client });
			this.logService.info(`[Codemap] Successfully started language server for ${language}`);

		} catch (error) {
			this.logService.error(`[Codemap] Failed to start language server for ${language}:`, error);
			this.onServerError.fire({ language, error: error instanceof Error ? error : new Error(`${error}`) });
			throw new CodemapError(
				`Failed to start language server: ${error instanceof Error ? error.message : 'Unknown error'}`,
				'SERVER_START_FAILED',
				{ language, error }
			);
		}
	}

	async stopServer(language: string): Promise<void> {
		try {
			const client = this.languageServers.get(language);
			if (!client) {
				this.logService.debug(`[Codemap] No language server running for ${language}`);
				return;
			}

			this.logService.info(`[Codemap] Stopping language server for ${language}`);

			await this.languageServerService.stopClient(client);
			this.languageServers.delete(language);

			this.onServerDisconnected.fire({ language, reason: 'User requested' });
			this.logService.info(`[Codemap] Successfully stopped language server for ${language}`);

		} catch (error) {
			this.logService.error(`[Codemap] Failed to stop language server for ${language}:`, error);
			throw new CodemapError(
				`Failed to stop language server: ${error instanceof Error ? error.message : 'Unknown error'}`,
				'SERVER_STOP_FAILED',
				{ language, error }
			);
		}
	}

	async restartServer(language: string): Promise<void> {
		this.logService.info(`[Codemap] Restarting language server for ${language}`);

		// Get current workspace folders
		const workspaceFolders = Array.from(this.workspaceFolders);
		if (workspaceFolders.length === 0) {
			throw new CodemapError('No workspace folders available for restart', 'NO_WORKSPACE_FOLDERS');
		}

		await this.stopServer(language);
		await this.startServer(language, workspaceFolders[0]);

		this.logService.info(`[Codemap] Successfully restarted language server for ${language}`);
	}

	isServerRunning(language: string): boolean {
		return this.languageServers.has(language);
	}

	async getDocumentSymbols(uri: string): Promise<any[]> {
		try {
			const language = this.getLanguageFromUri(uri);
			const client = this.languageServers.get(language);

			if (!client) {
				this.logService.warn(`[Codemap] No language server running for ${language}, falling back to built-in parser`);
				return await this.languageService.getDocumentSymbols(uri);
			}

			this.logService.debug(`[Codemap] Getting document symbols for ${uri} using ${language} server`);
			const symbols = await client.getDocumentSymbols(uri);

			// Convert language server symbols to VS Code format
			return this.convertLanguageServerSymbols(symbols);

		} catch (error) {
			this.logService.error(`[Codemap] Failed to get document symbols for ${uri}:`, error);
			// Fallback to built-in language service
			try {
				return await this.languageService.getDocumentSymbols(uri);
			} catch (fallbackError) {
				throw new CodemapError(
					`Failed to get document symbols: ${error instanceof Error ? error.message : 'Unknown error'}`,
					'SYMBOL_RESOLUTION_FAILED',
					{ uri, error }
				);
			}
		}
	}

	async getDocumentSymbolsForLanguage(uri: string, language: string): Promise<any[]> {
		const client = this.languageServers.get(language);

		if (!client) {
			throw new CodemapError(`No language server running for ${language}`, 'SERVER_NOT_RUNNING');
		}

		try {
			const symbols = await client.getDocumentSymbols(uri);
			return this.convertLanguageServerSymbols(symbols);
		} catch (error) {
			this.logService.error(`[Codemap] Failed to get document symbols for ${uri} using ${language} server:`, error);
			throw new CodemapError(
				`Failed to get document symbols: ${error instanceof Error ? error.message : 'Unknown error'}`,
				'SYMBOL_RESOLUTION_FAILED',
				{ uri, language, error }
			);
		}
	}

	async getReferences(uri: string, position: { line: number; character: number }, options: any): Promise<any[]> {
		try {
			const language = this.getLanguageFromUri(uri);
			const client = this.languageServers.get(language);

			if (!client) {
				this.logService.warn(`[Codemap] No language server running for ${language}, falling back to built-in service`);
				return await this.languageService.getReferences(uri, position, options);
			}

			this.logService.debug(`[Codemap] Getting references for ${uri}:${position.line}:${position.character} using ${language} server`);
			const references = await client.getReferences(uri, position, options);

			return references || [];

		} catch (error) {
			this.logService.error(`[Codemap] Failed to get references for ${uri}:`, error);
			// Fallback to built-in language service
			try {
				return await this.languageService.getReferences(uri, position, options);
			} catch (fallbackError) {
				throw new CodemapError(
					`Failed to get references: ${error instanceof Error ? error.message : 'Unknown error'}`,
					'REFERENCE_SEARCH_FAILED',
					{ uri, position, error }
				);
			}
		}
	}

	async getDefinition(uri: string, position: { line: number; character: number }): Promise<any> {
		try {
			const language = this.getLanguageFromUri(uri);
			const client = this.languageServers.get(language);

			if (!client) {
				this.logService.warn(`[Codemap] No language server running for ${language}, falling back to built-in service`);
				return await this.languageService.getDefinition(uri, position);
			}

			this.logService.debug(`[Codemap] Getting definition for ${uri}:${position.line}:${position.character} using ${language} server`);
			const definition = await client.getDefinition(uri, position);

			return definition;

		} catch (error) {
			this.logService.error(`[Codemap] Failed to get definition for ${uri}:`, error);
			// Fallback to built-in language service
			try {
				return await this.languageService.getDefinition(uri, position);
			} catch (fallbackError) {
				throw new CodemapError(
					`Failed to get definition: ${error instanceof Error ? error.message : 'Unknown error'}`,
					'DEFINITION_SEARCH_FAILED',
					{ uri, position, error }
				);
			}
		}
	}

	async getImplementations(uri: string, position: { line: number; character: number }): Promise<any[]> {
		try {
			const language = this.getLanguageFromUri(uri);
			const client = this.languageServers.get(language);

			if (!client) {
				this.logService.warn(`[Codemap] No language server running for ${language}, falling back to built-in service`);
				return await this.languageService.getImplementations(uri, position);
			}

			this.logService.debug(`[Codemap] Getting implementations for ${uri}:${position.line}:${position.character} using ${language} server`);
			const implementations = await client.getImplementations(uri, position);

			return implementations || [];

		} catch (error) {
			this.logService.error(`[Codemap] Failed to get implementations for ${uri}:`, error);
			// Fallback to built-in language service
			try {
				return await this.languageService.getImplementations(uri, position);
			} catch (fallbackError) {
				throw new CodemapError(
					`Failed to get implementations: ${error instanceof Error ? error.message : 'Unknown error'}`,
					'IMPLEMENTATION_SEARCH_FAILED',
					{ uri, position, error }
				);
			}
		}
	}

	async getTypeDefinition(uri: string, position: { line: number; character: number }): Promise<any> {
		try {
			const language = this.getLanguageFromUri(uri);
			const client = this.languageServers.get(language);

			if (!client) {
				this.logService.warn(`[Codemap] No language server running for ${language}, falling back to built-in service`);
				return await this.languageService.getTypeDefinition(uri, position);
			}

			this.logService.debug(`[Codemap] Getting type definition for ${uri}:${position.line}:${position.character} using ${language} server`);
			const typeDefinition = await client.getTypeDefinition(uri, position);

			return typeDefinition;

		} catch (error) {
			this.logService.error(`[Codemap] Failed to get type definition for ${uri}:`, error);
			// Fallback to built-in language service
			try {
				return await this.languageService.getTypeDefinition(uri, position);
			} catch (fallbackError) {
				throw new CodemapError(
					`Failed to get type definition: ${error instanceof Error ? error.message : 'Unknown error'}`,
					'TYPE_DEFINITION_SEARCH_FAILED',
					{ uri, position, error }
				);
			}
		}
	}

	async getDocumentText(uri: string): Promise<string> {
		try {
			return await this.languageService.getDocumentText(uri);
		} catch (error) {
			this.logService.error(`[Codemap] Failed to get document text for ${uri}:`, error);
			throw new CodemapError(
				`Failed to get document text: ${error instanceof Error ? error.message : 'Unknown error'}`,
				'DOCUMENT_TEXT_FAILED',
				{ uri, error }
			);
		}
	}

	async getWordAtPosition(uri: string, position: { line: number; character: number }): Promise<{ word: string; range: any } | null> {
		try {
			return await this.languageService.getWordAtPosition(uri, position);
		} catch (error) {
			this.logService.error(`[Codemap] Failed to get word at position for ${uri}:`, error);
			return null;
		}
	}

	// Private helper methods

	private initializeLanguageServerConfigurations(): void {
		// TypeScript/JavaScript - Use built-in TypeScript Language Server
		this.serverConfigurations.set('typescript', {
			serverId: 'typescript-language-server',
			command: 'typescript-language-server',
			args: ['--stdio'],
			installation: {
				mode: 'bundled'
			}
		});

		this.serverConfigurations.set('javascript', {
			serverId: 'typescript-language-server',
			command: 'typescript-language-server',
			args: ['--stdio'],
			installation: {
				mode: 'bundled'
			}
		});

		// Python - Python LSP Server
		this.serverConfigurations.set('python', {
			serverId: 'python-lsp-server',
			command: 'pylsp',
			args: ['--stdio'],
			installation: {
				mode: 'npm',
				package: 'python-lsp-server'
			}
		});

		// Java - Eclipse JDT Language Server
		this.serverConfigurations.set('java', {
			serverId: 'jdt-language-server',
			command: 'java',
			args: [
				'-Declipse.application=org.eclipse.jdt.ls.core.id1',
				'-Dosgi.bundles.defaultStartLevel=4',
				'-Declipse.product=org.eclipse.jdt.ls.core.product',
				'-Dlog.level=ALL',
				'-noverify',
				'-Xmx1G',
				'-jar',
				'${JDTLS_HOME}/plugins/org.eclipse.equinox.launcher.jar',
				'-configuration',
				'${JDTLS_HOME}/config_linux',
				'-data',
				'${WORKSPACE_FOLDER}/.jdt-language-server'
			],
			env: {
				JDTLS_HOME: '/path/to/jdt-language-server'
			},
			installation: {
				mode: 'download',
				url: 'https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz'
			}
		});

		// C++ - clangd
		this.serverConfigurations.set('cpp', {
			serverId: 'clangd',
			command: 'clangd',
			args: ['--background-index'],
			installation: {
				mode: 'system',
				checkCommand: 'clangd --version'
			}
		});

		// Go - gopls
		this.serverConfigurations.set('go', {
			serverId: 'gopls',
			command: 'gopls',
			args: ['serve'],
			installation: {
				mode: 'go',
				package: 'golang.org/x/tools/gopls'
			}
		});

		// Rust - rust-analyzer
		this.serverConfigurations.set('rust', {
			serverId: 'rust-analyzer',
			command: 'rust-analyzer',
			args: ['--stdio'],
			installation: {
				mode: 'system',
				checkCommand: 'rust-analyzer --version'
			}
		});
	}

	private setupServerEventHandlers(language: string, client: ILanguageServerClient): void {
		client.onDidStateChange((state) => {
			this.logService.debug(`[Codemap] Language server for ${language} state changed to: ${state}`);
		});

		client.onError((error) => {
			this.logService.error(`[Codemap] Language server for ${language} error:`, error);
			this.onServerError.fire({ language, error });
		});

		client.onExit((code) => {
			this.logService.info(`[Codemap] Language server for ${language} exited with code: ${code}`);
			this.languageServers.delete(language);
			this.onServerDisconnected.fire({ language, reason: `Process exited with code ${code}` });
		});
	}

	private getLanguageFromUri(uri: string): string {
		const path = URI.parse(uri).path;
		const extension = path.split('.').pop()?.toLowerCase();

		const languageMap: Record<string, string> = {
			'ts': 'typescript',
			'tsx': 'typescript',
			'js': 'javascript',
			'jsx': 'javascript',
			'py': 'python',
			'java': 'java',
			'cpp': 'cpp',
			'c': 'cpp',
			'h': 'cpp',
			'cc': 'cpp',
			'cxx': 'cpp',
			'hpp': 'cpp',
			'cs': 'csharp',
			'go': 'go',
			'rs': 'rust',
			'php': 'php',
			'rb': 'ruby',
			'swift': 'swift',
			'kt': 'kotlin',
			'scala': 'scala'
		};

		return languageMap[extension || ''] || 'unknown';
	}

	private convertLanguageServerSymbols(symbols: any[]): any[] {
		// Convert language server-specific symbol format to VS Code format
		return symbols.map(symbol => ({
			name: symbol.name,
			detail: symbol.detail,
			kind: symbol.kind,
			selectionRange: symbol.selectionRange,
			range: symbol.range,
			children: symbol.children ? this.convertLanguageServerSymbols(symbol.children) : undefined,
			tags: symbol.tags,
			containerName: symbol.containerName,
			location: symbol.location || {
				uri: symbol.uri,
				range: symbol.range
			}
		}));
	}

	override dispose(): void {
		// Stop all running language servers
		const stopPromises = Array.from(this.languageServers.keys()).map(language =>
			this.stopServer(language).catch(error =>
				this.logService.error(`[Codemap] Error stopping server for ${language}:`, error)
			)
		);

		Promise.all(stopPromises).then(() => {
			this.languageServers.clear();
			this.serverConfigurations.clear();
			this.workspaceFolders.clear();
			super.dispose();
		});
	}
}

interface LanguageServerConfig {
	serverId: string;
	command: string;
	args: string[];
	env?: Record<string, string>;
	installation: {
		mode: 'bundled' | 'npm' | 'go' | 'system' | 'download';
		package?: string;
		checkCommand?: string;
		url?: string;
	};
}