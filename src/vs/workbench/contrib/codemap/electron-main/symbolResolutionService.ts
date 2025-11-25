/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Your Company. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ILanguageService } from '../../../../editor/common/languages/languageService.js';
import {
	Symbol,
	SymbolKind,
	SymbolReference,
	Relationship,
	RelationshipType,
	SymbolMetadata,
	TypeInfo,
	SymbolOptions,
	CodemapError
} from '../common/codemapTypes.js';

export interface ISymbolResolutionService {
	// Symbol resolution
	resolveSymbols(uri: string, options?: SymbolOptions): Promise<Symbol[]>;
	resolveSymbolAtPosition(uri: string, position: { line: number; character: number }): Promise<Symbol | null>;

	// Reference finding
	findReferences(symbolId: string, includeDefinition?: boolean): Promise<SymbolReference[]>;
	findDefinition(symbolId: string): Promise<SymbolReference | null>;
	findImplementations(symbolId: string): Promise<SymbolReference[]>;

	// Relationship analysis
	getRelationships(symbolId: string, types: RelationshipType[]): Promise<Relationship[]>;
 analyzeDependencies(uri: string): Promise<Relationship[]>;

	// Events
	onSymbolsChanged: EventEmitter<{ uri: string; symbols: Symbol[] }>;
	onRelationshipsChanged: EventEmitter<{ symbolId: string; relationships: Relationship[] }>;

	// Lifecycle
	dispose(): void;
}

export class SymbolResolutionService extends Disposable implements ISymbolResolutionService {
	public readonly onSymbolsChanged = this._disposables.add(new EventEmitter<{ uri: string; symbols: Symbol[] }>());
	public readonly onRelationshipsChanged = this._disposables.add(new EventEmitter<{ symbolId: string; relationships: Relationship[] }>());

	private readonly symbolCache = new Map<string, { symbols: Symbol[]; lastModified: number }>();
	private readonly relationshipCache = new Map<string, { relationships: Relationship[]; lastModified: number }>();
	private readonly fileModificationTimes = new Map<string, number>();

	constructor(
		@ILogService private readonly logService: ILogService,
		@ILanguageService private readonly languageService: ILanguageService
	) {
		super();
		this.logService.debug('[Codemap] SymbolResolutionService initialized');
	}

	async resolveSymbols(uri: string, options: SymbolOptions = {}): Promise<Symbol[]> {
		try {
			const cacheKey = `${uri}:${JSON.stringify(options)}`;

			// Check cache
			const cached = this.symbolCache.get(cacheKey);
			if (cached && !this.isFileModified(uri)) {
				this.logService.debug(`[Codemap] Cache hit for symbols in ${uri}`);
				return cached.symbols;
			}

			this.logService.debug(`[Codemap] Resolving symbols in ${uri}`);

			// Get symbols from language service
			const languageServiceSymbols = await this.languageService.getDocumentSymbols(uri);

			// Convert to our Symbol format
			const symbols: Symbol[] = [];
			for (const lsSymbol of languageServiceSymbols) {
				const symbol = await this.convertLanguageServiceSymbol(lsSymbol, uri);
				if (symbol) {
					symbols.push(symbol);
				}
			}

			// Apply filters and sorting
			let filteredSymbols = this.applyFilters(symbols, options);
			if (options.sortBy) {
				filteredSymbols = this.sortSymbols(filteredSymbols, options.sortBy);
			}

			// Include dependencies if requested
			if (options.includeDependencies) {
				const dependencies = await this.resolveDependencies(uri, filteredSymbols, options);
				filteredSymbols.push(...dependencies);
			}

			// Cache results
			this.symbolCache.set(cacheKey, {
				symbols: filteredSymbols,
				lastModified: Date.now()
			});

			// Emit change event
			this.onSymbolsChanged.fire({ uri, symbols: filteredSymbols });

			this.logService.debug(`[Codemap] Resolved ${filteredSymbols.length} symbols in ${uri}`);
			return filteredSymbols;

		} catch (error) {
			this.logService.error(`[Codemap] Failed to resolve symbols in ${uri}:`, error);
			throw new CodemapError(
				`Failed to resolve symbols: ${error instanceof Error ? error.message : 'Unknown error'}`,
				'SYMBOL_RESOLUTION_FAILED',
				{ uri, error }
			);
		}
	}

	async resolveSymbolAtPosition(uri: string, position: { line: number; character: number }): Promise<Symbol | null> {
		try {
			const wordAtPosition = await this.languageService.getWordAtPosition(uri, position);
			if (!wordAtPosition) {
				return null;
			}

			const symbols = await this.resolveSymbols(uri);
			return symbols.find(symbol =>
				symbol.location.range.start.line <= position.line &&
				symbol.location.range.end.line >= position.line &&
				symbol.name === wordAtPosition.word
			) || null;

		} catch (error) {
			this.logService.error(`[Codemap] Failed to resolve symbol at position:`, error);
			return null;
		}
	}

	async findReferences(symbolId: string, includeDefinition = true): Promise<SymbolReference[]> {
		try {
			this.logService.debug(`[Codemap] Finding references for symbol ${symbolId}`);

			// Get symbol from cache or resolve it
			const symbol = await this.getSymbolById(symbolId);
			if (!symbol) {
				throw new CodemapError(`Symbol with ID ${symbolId} not found`, 'SYMBOL_NOT_FOUND');
			}

			// Use language service to find references
			const languageServiceReferences = await this.languageService.getReferences(
				symbol.location.uri,
				symbol.location.range.start,
				{ includeDeclaration: includeDefinition }
			);

			// Convert to our SymbolReference format
			const references: SymbolReference[] = [];
			for (const ref of languageServiceReferences) {
				const reference: SymbolReference = {
					location: ref,
					context: await this.getContextForReference(ref),
					symbolId,
					kind: this.determineReferenceKind(ref, symbol.location)
				};
				references.push(reference);
			}

			this.logService.debug(`[Codemap] Found ${references.length} references for symbol ${symbolId}`);
			return references;

		} catch (error) {
			this.logService.error(`[Codemap] Failed to find references for symbol ${symbolId}:`, error);
			throw new CodemapError(
				`Failed to find references: ${error instanceof Error ? error.message : 'Unknown error'}`,
				'REFERENCE_SEARCH_FAILED',
				{ symbolId, error }
			);
		}
	}

	async findDefinition(symbolId: string): Promise<SymbolReference | null> {
		try {
			const symbol = await this.getSymbolById(symbolId);
			if (!symbol) {
				return null;
			}

			const definition = await this.languageService.getDefinition(
				symbol.location.uri,
				symbol.location.range.start
			);

			if (!definition) {
				return null;
			}

			return {
				location: definition,
				context: await this.getContextForReference(definition),
				symbolId,
				kind: 'definition'
			};

		} catch (error) {
			this.logService.error(`[Codemap] Failed to find definition for symbol ${symbolId}:`, error);
			return null;
		}
	}

	async findImplementations(symbolId: string): Promise<SymbolReference[]> {
		try {
			const symbol = await this.getSymbolById(symbolId);
			if (!symbol) {
				return [];
			}

			const implementations = await this.languageService.getImplementations(
				symbol.location.uri,
				symbol.location.range.start
			);

			const references: SymbolReference[] = [];
			for (const impl of implementations) {
				references.push({
					location: impl,
					context: await this.getContextForReference(impl),
					symbolId,
					kind: 'reference'
				});
			}

			return references;

		} catch (error) {
			this.logService.error(`[Codemap] Failed to find implementations for symbol ${symbolId}:`, error);
			return [];
		}
	}

	async getRelationships(symbolId: string, types: RelationshipType[]): Promise<Relationship[]> {
		try {
			const cacheKey = `${symbolId}:${JSON.stringify(types)}`;

			// Check cache
			const cached = this.relationshipCache.get(cacheKey);
			if (cached && !this.isSymbolRelatedFileModified(symbolId)) {
				this.logService.debug(`[Codemap] Cache hit for relationships of symbol ${symbolId}`);
				return cached.relationships;
			}

			this.logService.debug(`[Codemap] Analyzing relationships for symbol ${symbolId}`);

			const relationships: Relationship[] = [];
			const symbol = await this.getSymbolById(symbolId);

			if (!symbol) {
				throw new CodemapError(`Symbol with ID ${symbolId} not found`, 'SYMBOL_NOT_FOUND');
			}

			// Analyze different relationship types
			for (const type of types) {
				const typeRelationships = await this.analyzeRelationshipsByType(symbol, type);
				relationships.push(...typeRelationships);
			}

			// Cache results
			this.relationshipCache.set(cacheKey, {
				relationships,
				lastModified: Date.now()
			});

			// Emit change event
			this.onRelationshipsChanged.fire({ symbolId, relationships });

			this.logService.debug(`[Codemap] Found ${relationships.length} relationships for symbol ${symbolId}`);
			return relationships;

		} catch (error) {
			this.logService.error(`[Codemap] Failed to analyze relationships for symbol ${symbolId}:`, error);
			throw new CodemapError(
				`Failed to analyze relationships: ${error instanceof Error ? error.message : 'Unknown error'}`,
				'RELATIONSHIP_ANALYSIS_FAILED',
				{ symbolId, types, error }
			);
		}
	}

	async analyzeDependencies(uri: string): Promise<Relationship[]> {
		try {
			const symbols = await this.resolveSymbols(uri);
			const relationships: Relationship[] = [];

			for (const symbol of symbols) {
				const symbolRelationships = await this.getRelationships(symbol.id, [
					RelationshipType.IMPORTS,
					RelationshipType.USES,
					RelationshipType.CALLS
				]);
				relationships.push(...symbolRelationships);
			}

			return relationships;

		} catch (error) {
			this.logService.error(`[Codemap] Failed to analyze dependencies for ${uri}:`, error);
			return [];
		}
	}

	// Private helper methods

	private async convertLanguageServiceSymbol(lsSymbol: any, uri: string): Promise<Symbol | null> {
		try {
			const symbol: Symbol = {
				id: this.generateSymbolId(lsSymbol),
				name: lsSymbol.name,
				kind: this.convertSymbolKind(lsSymbol.kind),
				location: {
					uri,
					range: lsSymbol.location.range
				},
				containerName: lsSymbol.containerName,
				language: this.getLanguageFromUri(uri),
				metadata: await this.extractSymbolMetadata(lsSymbol)
			};

			return symbol;

		} catch (error) {
			this.logService.warn(`[Codemap] Failed to convert language service symbol:`, error);
			return null;
		}
	}

	private convertSymbolKind(lsKind: number): SymbolKind {
		const mapping: Record<number, SymbolKind> = {
			1: SymbolKind.Class,
			2: SymbolKind.Module,
			3: SymbolKind.Namespace,
			4: SymbolKind.Enum,
			5: SymbolKind.EnumMember,
			6: SymbolKind.Interface,
			7: SymbolKind.Function,
			8: SymbolKind.Variable,
			9: SymbolKind.Constructor,
			10: SymbolKind.Method,
			11: SymbolKind.Property,
			12: SymbolKind.TypeAlias,
			13: SymbolKind.TypeParameter,
			14: SymbolKind.File,
			15: SymbolKind.Folder,
			16: SymbolKind.Package
		};

		return mapping[lsKind] || SymbolKind.Variable;
	}

	private async extractSymbolMetadata(lsSymbol: any): Promise<SymbolMetadata> {
		return {
			isExported: lsSymbol.modifiers?.includes('export') || false,
			isDeprecated: lsSymbol.tags?.some((tag: any) => tag.name === 'deprecated') || false,
			isStatic: lsSymbol.modifiers?.includes('static') || false,
			isAbstract: lsSymbol.modifiers?.includes('abstract') || false,
			tags: lsSymbol.tags?.map((tag: any) => tag.name) || [],
			documentation: lsSymbol.documentation?.value,
			visibility: this.extractVisibility(lsSymbol)
		};
	}

	private extractVisibility(lsSymbol: any): 'public' | 'private' | 'protected' | undefined {
		if (lsSymbol.modifiers?.includes('private')) return 'private';
		if (lsSymbol.modifiers?.includes('protected')) return 'protected';
		if (lsSymbol.modifiers?.includes('public')) return 'public';
		return undefined;
	}

	private generateSymbolId(lsSymbol: any): string {
		const container = lsSymbol.containerName || '';
		const name = lsSymbol.name || '';
		const kind = lsSymbol.kind || 0;
		return `${container}:${name}:${kind}`.replace(/[^a-zA-Z0-9:_-]/g, '_');
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
			'c': 'c',
			'h': 'c',
			'cs': 'csharp',
			'go': 'go',
			'rs': 'rust',
			'php': 'php',
			'rb': 'ruby',
			'swift': 'swift',
			'kt': 'kotlin'
		};

		return languageMap[extension || ''] || 'unknown';
	}

	private applyFilters(symbols: Symbol[], options: SymbolOptions): Symbol[] {
		let filtered = [...symbols];

		if (options.filter && options.filter.length > 0) {
			filtered = filtered.filter(symbol =>
				options.filter!.includes(symbol.kind)
			);
		}

		return filtered;
	}

	private sortSymbols(symbols: Symbol[], sortBy: 'name' | 'type' | 'location'): Symbol[] {
		return [...symbols].sort((a, b) => {
			switch (sortBy) {
				case 'name':
					return a.name.localeCompare(b.name);
				case 'type':
					return a.kind.localeCompare(b.kind);
				case 'location':
					const uriA = URI.parse(a.location.uri);
					const uriB = URI.parse(b.location.uri);
					const uriCompare = uriA.path.localeCompare(uriB.path);
					if (uriCompare !== 0) return uriCompare;
					return a.location.range.start.line - b.location.range.start.line;
				default:
					return 0;
			}
		});
	}

	private async resolveDependencies(uri: string, symbols: Symbol[], options: SymbolOptions): Promise<Symbol[]> {
		const dependencies: Symbol[] = [];

		// This is a simplified implementation
		// In a real implementation, you would:
		// 1. Parse imports/exports
		// 2. Resolve imported symbols
		// 3. Follow dependencies recursively up to maxDepth

		return dependencies;
	}

	private async getContextForReference(location: { uri: string; range: any }): Promise<string> {
		// Get surrounding text for context
		try {
			const text = await this.languageService.getDocumentText(location.uri);
			const lines = text.split('\n');
			const startLine = Math.max(0, location.range.start.line - 2);
			const endLine = Math.min(lines.length, location.range.end.line + 3);

			return lines.slice(startLine, endLine).join('\n').trim();
		} catch {
			return '';
		}
	}

	private determineReferenceKind(reference: any, symbolLocation: any): 'definition' | 'reference' | 'write' | 'read' {
		// This is a simplified implementation
		// In a real implementation, you would analyze the AST context
		if (reference.uri === symbolLocation.uri &&
			reference.range.start.line === symbolLocation.range.start.line &&
			reference.range.start.character === symbolLocation.range.start.character) {
			return 'definition';
		}
		return 'reference';
	}

	private async analyzeRelationshipsByType(symbol: Symbol, type: RelationshipType): Promise<Relationship[]> {
		const relationships: Relationship[] = [];

		switch (type) {
			case RelationshipType.CALLS:
				// Analyze function calls within the symbol's content
				break;
			case RelationshipType.EXTENDS:
				// Analyze class/interface extensions
				break;
			case RelationshipType.IMPLEMENTS:
				// Analyze interface implementations
				break;
			case RelationshipType.IMPORTS:
				// Analyze import statements
				break;
			case RelationshipType.USES:
				// Analyze symbol usage
				break;
		}

		return relationships;
	}

	private async getSymbolById(symbolId: string): Promise<Symbol | null> {
		// Search through cached symbols
		for (const cacheEntry of this.symbolCache.values()) {
			const symbol = cacheEntry.symbols.find(s => s.id === symbolId);
			if (symbol) {
				return symbol;
			}
		}
		return null;
	}

	private isFileModified(uri: string): boolean {
		// This is a simplified implementation
		// In a real implementation, you would check the file's modification time
		return false;
	}

	private isSymbolRelatedFileModified(symbolId: string): boolean {
		// This is a simplified implementation
		// In a real implementation, you would check if any files related to this symbol have been modified
		return false;
	}

	override dispose(): void {
		this.symbolCache.clear();
		this.relationshipCache.clear();
		this.fileModificationTimes.clear();
		super.dispose();
	}
}