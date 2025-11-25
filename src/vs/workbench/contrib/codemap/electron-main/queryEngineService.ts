/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Your Company. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ILanguageService } from '../../../../editor/common/languages/languageService.js';
import { GlobPattern } from '../../../../base/common/glob.js';
import {
	CodeQuery,
	QueryResult,
	QueryScope,
	QuerySelect,
	QueryCondition,
	QueryTraversal,
	Symbol,
	SymbolKind,
	Relationship,
	RelationshipType,
	SymbolReference,
	CodemapError
} from '../common/codemapTypes.js';

export interface IQueryEngineService {
	// Query execution
	executeQuery(query: CodeQuery, scope?: QueryScope): Promise<QueryResult>;
	executeNaturalLanguageQuery(query: string, scope?: QueryScope): Promise<QueryResult>;

	// Query suggestions
	getQuerySuggestions(partialQuery: string, scope?: QueryScope): Promise<string[]>;
	getSymbolSuggestions(pattern: string, scope?: QueryScope): Promise<Symbol[]>;

	// Query optimization
	optimizeQuery(query: CodeQuery): CodeQuery;
	validateQuery(query: CodeQuery): { isValid: boolean; errors: string[] };

	// Index management
	buildIndex(scope?: QueryScope): Promise<void>;
	updateIndex(uris: string[]): Promise<void>;
	clearIndex(): Promise<void>;

	// Events
	onIndexUpdated: EventEmitter<{ scope: QueryScope; symbolsCount: number }>;
	onQueryExecuted: EventEmitter<{ query: CodeQuery; result: QueryResult; executionTime: number }>;

	// Lifecycle
	dispose(): void;
}

export class QueryEngineService extends Disposable implements IQueryEngineService {
	public readonly onIndexUpdated = this._disposables.add(new EventEmitter<{ scope: QueryScope; symbolsCount: number }>());
	public readonly onQueryExecuted = this._disposables.add(new EventEmitter<{ query: CodeQuery; result: QueryResult; executionTime: number }>());

	private readonly symbolIndex = new Map<string, IndexedSymbol[]>();
	private readonly relationshipIndex = new Map<string, IndexedRelationship[]>();
	private readonly fileIndex = new Map<string, FileMetadata>();
	private readonly workspaceRoot: string;

	private queryCache = new LRUCache<string, QueryResult>(100);

	constructor(
		@ILogService private readonly logService: ILogService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ILanguageService private readonly languageService: ILanguageService
	) {
		super();
		this.workspaceRoot = this.getWorkspaceRoot();
		this.logService.debug('[Codemap] QueryEngineService initialized');
	}

	async executeQuery(query: CodeQuery, scope: QueryScope = {}): Promise<QueryResult> {
		const startTime = Date.now();
		const cacheKey = this.getQueryCacheKey(query, scope);

		try {
			this.logService.debug(`[Codemap] Executing query: ${JSON.stringify(query)}`);

			// Check cache first
			const cached = this.queryCache.get(cacheKey);
			if (cached && !this.isIndexStale(scope)) {
				this.logService.debug('[Codemap] Query result retrieved from cache');
				return { ...cached, cached: true };
			}

			// Validate query
			const validation = this.validateQuery(query);
			if (!validation.isValid) {
				throw new CodemapError(`Invalid query: ${validation.errors.join(', ')}`, 'INVALID_QUERY');
			}

			// Optimize query
			const optimizedQuery = this.optimizeQuery(query);

			// Ensure index is up to date
			await this.ensureIndex(scope);

			// Execute query against index
			const result = await this.executeQueryInternal(optimizedQuery, scope);

			const executionTime = Date.now() - startTime;

			// Cache result
			this.queryCache.set(cacheKey, { ...result, cached: false });

			// Emit event
			this.onQueryExecuted.fire({ query, result, executionTime });

			this.logService.debug(`[Codemap] Query executed in ${executionTime}ms, found ${result.symbols.length} symbols, ${result.relationships.length} relationships`);
			return result;

		} catch (error) {
			const executionTime = Date.now() - startTime;
			this.logService.error(`[Codemap] Query execution failed after ${executionTime}ms:`, error);
			throw new CodemapError(
				`Query execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
				'QUERY_EXECUTION_FAILED',
				{ query, scope, error }
			);
		}
	}

	async executeNaturalLanguageQuery(query: string, scope: QueryScope = {}): Promise<QueryResult> {
		this.logService.debug(`[Codemap] Executing natural language query: ${query}`);

		try {
			// Parse natural language query into structured query
			const structuredQuery = await this.parseNaturalLanguageQuery(query);

			return await this.executeQuery(structuredQuery, scope);

		} catch (error) {
			this.logService.error(`[Codemap] Natural language query execution failed:`, error);
			throw new CodemapError(
				`Natural language query execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
				'NL_QUERY_FAILED',
				{ query, scope, error }
			);
		}
	}

	async getQuerySuggestions(partialQuery: string, scope: QueryScope = {}): Promise<string[]> {
		const suggestions: string[] = [];

		// Common query patterns
		const patterns = [
			'find all {symbolType} in {path}',
			'show {symbolType} that {action} {target}',
			'list {symbolType} with {property}',
			'display {symbolType} from {language} files',
			'search for {pattern} in {scope}'
		];

		const symbolTypes = Object.values(SymbolKind);
		const actions = ['call', 'extend', 'implement', 'import', 'use', 'reference'];
		const properties = ['no references', 'no implementation', 'deprecated', 'exported'];

		// Generate suggestions based on partial query
		const lowerPartial = partialQuery.toLowerCase();

		if (lowerPartial.length < 3) {
			return patterns.slice(0, 3);
		}

		// Try to match against patterns
		for (const pattern of patterns) {
			if (pattern.toLowerCase().includes(lowerPartial)) {
				suggestions.push(pattern);
			}
		}

		// Add symbol type suggestions
		for (const symbolType of symbolTypes) {
			if (symbolType.toLowerCase().startsWith(lowerPartial)) {
				suggestions.push(`find all ${symbolType}`);
			}
		}

		// Add action-based suggestions
		if (lowerPartial.includes('call')) {
			for (const action of actions) {
				suggestions.push(`show functions that ${action} ${action === 'call' ? 'X' : 'Y'}`);
			}
		}

		return suggestions.slice(0, 10); // Limit to 10 suggestions
	}

	async getSymbolSuggestions(pattern: string, scope: QueryScope = {}): Promise<Symbol[]> {
		try {
			this.logService.debug(`[Codemap] Getting symbol suggestions for pattern: ${pattern}`);

			const symbols: Symbol[] = [];
			const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');

			for (const [file, indexedSymbols] of this.symbolIndex) {
				if (!this.isInScope(file, scope)) {
					continue;
				}

				for (const indexedSymbol of indexedSymbols) {
					if (regex.test(indexedSymbol.symbol.name)) {
						symbols.push(indexedSymbol.symbol);
					}
				}
			}

			return symbols.slice(0, 100); // Limit to 100 suggestions

		} catch (error) {
			this.logService.error(`[Codemap] Failed to get symbol suggestions:`, error);
			return [];
		}
	}

	optimizeQuery(query: CodeQuery): CodeQuery {
		const optimized = { ...query };

		// Add limit if not specified to prevent huge result sets
		if (!optimized.limit || optimized.limit > 1000) {
			optimized.limit = 1000;
		}

		// Add default offset if not specified
		if (!optimized.offset) {
			optimized.offset = 0;
		}

		// Optimize where conditions
		if (optimized.where) {
			optimized.where = this.optimizeWhereConditions(optimized.where);
		}

		// Optimize traversal
		if (optimized.traverse) {
			optimized.traverse = this.optimizeTraversal(optimized.traverse);
		}

		return optimized;
	}

	validateQuery(query: CodeQuery): { isValid: boolean; errors: string[] } {
		const errors: string[] = [];

		// Validate select clause
		if (!query.select) {
			errors.push('Query must have a select clause');
		} else {
			if (query.select.symbols && query.select.symbols.length === 0) {
				errors.push('Select symbols cannot be empty');
			}
			if (query.select.relationships && query.select.relationships.length === 0) {
				errors.push('Select relationships cannot be empty');
			}
		}

		// Validate where conditions
		if (query.where) {
			if (query.where.symbolType && query.where.symbolType.length === 0) {
				errors.push('Where symbolType cannot be empty');
			}
			if (query.where.inPath && !this.isValidPath(query.where.inPath)) {
				errors.push('Invalid path in where clause');
			}
		}

		// Validate traversal
		if (query.traverse) {
			if (query.traverse.depth < 1) {
				errors.push('Traversal depth must be at least 1');
			}
			if (query.traverse.depth > 10) {
				errors.push('Traversal depth cannot exceed 10');
			}
		}

		// Validate pagination
		if (query.limit && query.limit < 1) {
			errors.push('Limit must be at least 1');
		}
		if (query.offset && query.offset < 0) {
			errors.push('Offset cannot be negative');
		}

		return {
			isValid: errors.length === 0,
			errors
		};
	}

	async buildIndex(scope: QueryScope = {}): Promise<void> {
		this.logService.info('[Codemap] Building symbol index');

		try {
			// Clear existing index
			this.symbolIndex.clear();
			this.relationshipIndex.clear();
			this.fileIndex.clear();

			// Get files in scope
			const files = await this.getFilesInScope(scope);
			let totalSymbols = 0;

			// Index each file
			for (const file of files) {
				try {
					const symbols = await this.languageService.getDocumentSymbols(file);
					const indexedSymbols = await this.indexSymbols(symbols, file);

					this.symbolIndex.set(file, indexedSymbols);
					this.fileIndex.set(file, {
						uri: file,
						lastModified: Date.now(),
						symbolCount: indexedSymbols.length
					});

					totalSymbols += indexedSymbols.length;

				} catch (error) {
					this.logService.warn(`[Codemap] Failed to index file ${file}:`, error);
				}
			}

			// Build relationship index
			await this.buildRelationshipIndex();

			this.onIndexUpdated.fire({ scope, symbolsCount: totalSymbols });
			this.logService.info(`[Codemap] Index built successfully with ${totalSymbols} symbols from ${files.length} files`);

		} catch (error) {
			this.logService.error('[Codemap] Failed to build index:', error);
			throw new CodemapError(
				`Failed to build index: ${error instanceof Error ? error.message : 'Unknown error'}`,
				'INDEX_BUILD_FAILED',
				{ scope, error }
			);
		}
	}

	async updateIndex(uris: string[]): Promise<void> {
		this.logService.debug(`[Codemap] Updating index for ${uris.length} files`);

		try {
			for (const uri of uris) {
				try {
					const symbols = await this.languageService.getDocumentSymbols(uri);
					const indexedSymbols = await this.indexSymbols(symbols, uri);

					this.symbolIndex.set(uri, indexedSymbols);
					this.fileIndex.set(uri, {
						uri,
						lastModified: Date.now(),
						symbolCount: indexedSymbols.length
					});

				} catch (error) {
					this.logService.warn(`[Codemap] Failed to update index for file ${uri}:`, error);
				}
			}

			// Update relationship index for affected files
			await this.updateRelationshipIndex(uris);

			this.logService.debug(`[Codemap] Index update completed`);

		} catch (error) {
			this.logService.error('[Codemap] Failed to update index:', error);
		}
	}

	async clearIndex(): Promise<void> {
		this.logService.info('[Codemap] Clearing symbol index');

		this.symbolIndex.clear();
		this.relationshipIndex.clear();
		this.fileIndex.clear();
		this.queryCache.clear();

		this.logService.info('[Codemap] Symbol index cleared');
	}

	// Private helper methods

	private async executeQueryInternal(query: CodeQuery, scope: QueryScope): Promise<QueryResult> {
		const matchedSymbols: Symbol[] = [];
		const matchedRelationships: Relationship[] = [];

		// Find matching symbols
		if (query.select.symbols) {
			for (const [file, indexedSymbols] of this.symbolIndex) {
				if (!this.isInScope(file, scope)) {
					continue;
				}

				for (const indexedSymbol of indexedSymbols) {
					if (this.matchesSymbol(indexedSymbol.symbol, query.select.symbols!, query.where)) {
						matchedSymbols.push(indexedSymbol.symbol);
					}
				}
			}
		}

		// Find matching relationships
		if (query.select.relationships) {
			for (const [file, relationships] of this.relationshipIndex) {
				if (!this.isInScope(file, scope)) {
					continue;
				}

				for (const indexedRel of relationships) {
					if (query.select.relationships!.includes(indexedRel.relationship.type)) {
						matchedRelationships.push(indexedRel.relationship);
					}
				}
			}
		}

		// Apply traversal if specified
		if (query.traverse && matchedSymbols.length > 0) {
			const traversedSymbols = new Set(matchedSymbols.map(s => s.id));
			const traversedRelationships = new Set(matchedRelationships.map(r => `${r.sourceId}-${r.targetId}`));

			await this.traverseRelationships(
				Array.from(traversedSymbols),
				query.traverse,
				traversedSymbols,
				traversedRelationships,
				scope
			);

			// Convert back to arrays
			const allSymbols = Array.from(traversedSymbols).map(id => this.findSymbolById(id)).filter(Boolean) as Symbol[];
			const allRelationships = Array.from(traversedRelationships).map(id => this.findRelationshipById(id)).filter(Boolean) as Relationship[];

			return {
				symbols: allSymbols,
				relationships: allRelationships,
				total: allSymbols.length + allRelationships.length,
				queryTime: 0, // This will be set by the caller
				cached: false
			};
		}

		// Apply pagination
		const start = query.offset || 0;
		const end = start + (query.limit || 100);
		const paginatedSymbols = matchedSymbols.slice(start, Math.min(end, matchedSymbols.length));
		const paginatedRelationships = matchedRelationships.slice(start, Math.min(end, matchedRelationships.length));

		return {
			symbols: paginatedSymbols,
			relationships: paginatedRelationships,
			total: matchedSymbols.length + matchedRelationships.length,
			queryTime: 0, // This will be set by the caller
			cached: false
		};
	}

	private matchesSymbol(symbol: Symbol, patterns: string[], where?: QueryCondition): boolean {
		// Check name patterns
		let matchesPattern = false;
		for (const pattern of patterns) {
			const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
			if (regex.test(symbol.name)) {
				matchesPattern = true;
				break;
			}
		}

		if (!matchesPattern) {
			return false;
		}

		// Apply where conditions
		if (where) {
			if (where.symbolType && !where.symbolType.includes(symbol.kind)) {
				return false;
			}

			if (where.namePattern && !new RegExp(where.namePattern.replace(/\*/g, '.*'), 'i').test(symbol.name)) {
				return false;
			}

			if (where.inPath && !symbol.location.uri.includes(where.inPath)) {
				return false;
			}

			if (where.isExported !== undefined && where.isExported !== symbol.metadata.isExported) {
				return false;
			}

			if (where.isDeprecated !== undefined && where.isDeprecated !== symbol.metadata.isDeprecated) {
				return false;
			}
		}

		return true;
	}

	private async traverseRelationships(
		startingSymbols: string[],
		traversal: QueryTraversal,
		visitedSymbols: Set<string>,
		visitedRelationships: Set<string>,
		scope: QueryScope
	): Promise<void> {
		if (traversal.depth === 0) {
			return;
		}

		const newSymbols: string[] = [];
		const newRelationships: Relationship[] = [];

		// Find relationships from/to current symbols
		for (const symbolId of startingSymbols) {
			for (const [file, relationships] of this.relationshipIndex) {
				if (!this.isInScope(file, scope)) {
					continue;
				}

				for (const indexedRel of relationships) {
					const rel = indexedRel.relationship;
					const relationshipId = `${rel.sourceId}-${rel.targetId}`;

					// Check if this relationship is relevant
					let isRelevant = false;
					let newSymbolId: string | null = null;

					if (traversal.direction === 'outgoing' || traversal.direction === 'both') {
						if (rel.sourceId === symbolId && !visitedSymbols.has(rel.targetId)) {
							isRelevant = true;
							newSymbolId = rel.targetId;
						}
					}

					if (traversal.direction === 'incoming' || traversal.direction === 'both') {
						if (rel.targetId === symbolId && !visitedSymbols.has(rel.sourceId)) {
							isRelevant = true;
							newSymbolId = rel.sourceId;
						}
					}

					if (isRelevant &&
						(!traversal.relationshipTypes || traversal.relationshipTypes.includes(rel.type)) &&
						!visitedRelationships.has(relationshipId)) {
						visitedRelationships.add(relationshipId);
						newRelationships.push(rel);
						if (newSymbolId) {
							visitedSymbols.add(newSymbolId);
							newSymbols.push(newSymbolId);
						}
					}
				}
			}
		}

		// Recursively traverse
		if (newSymbols.length > 0) {
			const nextTraversal = { ...traversal, depth: traversal.depth - 1 };
			await this.traverseRelationships(newSymbols, nextTraversal, visitedSymbols, visitedRelationships, scope);
		}
	}

	private async parseNaturalLanguageQuery(query: string): Promise<CodeQuery> {
		const lowerQuery = query.toLowerCase();

		// Parse common patterns
		if (lowerQuery.includes('all functions') || lowerQuery.includes('all methods')) {
			return {
				select: { symbols: ['*'] },
				where: { symbolType: [SymbolKind.Function, SymbolKind.Method] }
			};
		}

		if (lowerQuery.includes('all classes')) {
			return {
				select: { symbols: ['*'] },
				where: { symbolType: [SymbolKind.Class] }
			};
		}

		if (lowerQuery.includes('calls')) {
			const functionMatch = query.match(/calls? (\w+)/i);
			if (functionMatch) {
				return {
					select: { symbols: ['*'], relationships: [RelationshipType.CALLS] },
					where: { callsFunction: functionMatch[1] }
				};
			}
		}

		if (lowerQuery.includes('extends') || lowerQuery.includes('inherit')) {
			const classMatch = query.match(/extends? (\w+)/i);
			if (classMatch) {
				return {
					select: { symbols: ['*'], relationships: [RelationshipType.EXTENDS] },
					where: { extendsClass: classMatch[1] }
				};
			}
		}

		// Default: search by name pattern
		return {
			select: { symbols: [query] }
		};
	}

	private async indexSymbols(symbols: any[], fileUri: string): Promise<IndexedSymbol[]> {
		const indexedSymbols: IndexedSymbol[] = [];

		for (const symbol of symbols) {
			const indexedSymbol: IndexedSymbol = {
				symbol: {
					id: this.generateSymbolId(symbol, fileUri),
					name: symbol.name,
					kind: this.convertSymbolKind(symbol.kind),
					location: {
						uri: fileUri,
						range: symbol.location.range
					},
					containerName: symbol.containerName,
					language: this.getLanguageFromUri(fileUri),
					metadata: {
						isExported: symbol.modifiers?.includes('export') || false,
						isDeprecated: symbol.tags?.some((tag: any) => tag.name === 'deprecated') || false,
						isStatic: symbol.modifiers?.includes('static') || false,
						isAbstract: symbol.modifiers?.includes('abstract') || false,
						tags: symbol.tags?.map((tag: any) => tag.name) || []
					}
				},
				searchTerms: this.generateSearchTerms(symbol)
			};

			indexedSymbols.push(indexedSymbol);

			// Recursively index children
			if (symbol.children) {
				const childSymbols = await this.indexSymbols(symbol.children, fileUri);
				indexedSymbols.push(...childSymbols);
			}
		}

		return indexedSymbols;
	}

	private async buildRelationshipIndex(): Promise<void> {
		// This is a simplified implementation
		// In a real implementation, you would:
		// 1. Analyze AST of each file
		// 2. Extract function calls, imports, inheritance, etc.
		// 3. Build cross-file relationships

		for (const [file, indexedSymbols] of this.symbolIndex) {
			const relationships: IndexedRelationship[] = [];

			// Analyze file content for relationships
			try {
				const content = await this.languageService.getDocumentText(file);
				const fileRelationships = await this.extractRelationships(content, indexedSymbols);
				relationships.push(...fileRelationships);
			} catch (error) {
				this.logService.warn(`[Codemap] Failed to extract relationships from ${file}:`, error);
			}

			this.relationshipIndex.set(file, relationships);
		}
	}

	private async updateRelationshipIndex(updatedFiles: string[]): Promise<void> {
		// For now, rebuild the entire relationship index
		// In a more sophisticated implementation, we could update incrementally
		await this.buildRelationshipIndex();
	}

	private async extractRelationships(content: string, symbols: IndexedSymbol[]): Promise<IndexedRelationship[]> {
		// This is a simplified implementation
		// In a real implementation, you would parse the AST and extract actual relationships
		const relationships: IndexedRelationship[] = [];

		// Example: Find import statements
		const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
		let match;
		while ((match = importRegex.exec(content)) !== null) {
			// Create relationship for import
			// This is simplified - real implementation would resolve to actual symbols
		}

		return relationships;
	}

	private generateSearchTerms(symbol: any): string[] {
		const terms: string[] = [];
		terms.push(symbol.name.toLowerCase());

		if (symbol.containerName) {
			terms.push(symbol.containerName.toLowerCase());
		}

		// Add kind-based terms
		const kind = this.convertSymbolKind(symbol.kind);
		terms.push(kind);

		return terms;
	}

	private generateSymbolId(symbol: any, fileUri: string): string {
		const container = symbol.containerName || '';
		const name = symbol.name || '';
		const kind = symbol.kind || 0;
		return `${fileUri}:${container}:${name}:${kind}`.replace(/[^a-zA-Z0-9:_/-]/g, '_');
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
			'cs': 'csharp',
			'go': 'go',
			'rs': 'rust'
		};

		return languageMap[extension || ''] || 'unknown';
	}

	private optimizeWhereConditions(where: QueryCondition): QueryCondition {
		const optimized = { ...where };

		// Add default values if not specified
		if (optimized.includeTests === undefined) {
			optimized.includeTests = false;
		}

		return optimized;
	}

	private optimizeTraversal(traversal: QueryTraversal): QueryTraversal {
		const optimized = { ...traversal };

		// Limit traversal depth for performance
		if (optimized.depth > 10) {
			optimized.depth = 10;
		}

		return optimized;
	}

	private async getFilesInScope(scope: QueryScope): Promise<string[]> {
		// This is a simplified implementation
		// In a real implementation, you would use the workspace service to get files
		const files: string[] = [];

		// For now, return empty array - this would be implemented based on workspace service
		return files;
	}

	private isInScope(uri: string, scope: QueryScope): boolean {
		// Check path filter
		if (scope.path && !uri.includes(scope.path)) {
			return false;
		}

		// Check language filter
		if (scope.language) {
			const language = this.getLanguageFromUri(uri);
			if (language !== scope.language) {
				return false;
			}
		}

		// Check test files filter
		if (!scope.includeTests && uri.includes('test')) {
			return false;
		}

		return true;
	}

	private isIndexStale(scope: QueryScope): boolean {
		// This is a simplified implementation
		// In a real implementation, you would check file modification times
		return false;
	}

	private async ensureIndex(scope: QueryScope): Promise<void> {
		// Check if index needs to be built or updated
		if (this.symbolIndex.size === 0) {
			await this.buildIndex(scope);
		}
	}

	private getWorkspaceRoot(): string {
		const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
		if (workspaceFolders.length > 0) {
			return workspaceFolders[0].uri.path;
		}
		return '';
	}

	private isValidPath(path: string): boolean {
		// Basic path validation
		return !path.includes('..') && !path.includes('~');
	}

	private getQueryCacheKey(query: CodeQuery, scope: QueryScope): string {
		return JSON.stringify({ query, scope });
	}

	private findSymbolById(id: string): Symbol | null {
		for (const symbols of this.symbolIndex.values()) {
			const symbol = symbols.find(s => s.symbol.id === id);
			if (symbol) {
				return symbol.symbol;
			}
		}
		return null;
	}

	private findRelationshipById(id: string): Relationship | null {
		const [sourceId, targetId] = id.split('-');
		for (const relationships of this.relationshipIndex.values()) {
			const rel = relationships.find(r => r.relationship.sourceId === sourceId && r.relationship.targetId === targetId);
			if (rel) {
				return rel.relationship;
			}
		}
		return null;
	}

	override dispose(): void {
		this.symbolIndex.clear();
		this.relationshipIndex.clear();
		this.fileIndex.clear();
		this.queryCache.clear();
		super.dispose();
	}
}

// Interfaces for indexed data
interface IndexedSymbol {
	symbol: Symbol;
	searchTerms: string[];
}

interface IndexedRelationship {
	relationship: Relationship;
	confidence: number;
}

interface FileMetadata {
	uri: string;
	lastModified: number;
	symbolCount: number;
}

// Simple LRU Cache implementation
class LRUCache<K, V> {
	private cache = new Map<K, { value: V; timestamp: number }>();
	private maxSize: number;

	constructor(maxSize: number) {
		this.maxSize = maxSize;
	}

	get(key: K): V | undefined {
		const entry = this.cache.get(key);
		if (entry) {
			// Move to end (most recently used)
			this.cache.delete(key);
			this.cache.set(key, entry);
			return entry.value;
		}
		return undefined;
	}

	set(key: K, value: V): void {
		// Remove existing entry
		this.cache.delete(key);

		// Add new entry
		this.cache.set(key, { value, timestamp: Date.now() });

		// Remove oldest entries if over capacity
		if (this.cache.size > this.maxSize) {
			const firstKey = this.cache.keys().next().value;
			this.cache.delete(firstKey);
		}
	}

	clear(): void {
		this.cache.clear();
	}
}