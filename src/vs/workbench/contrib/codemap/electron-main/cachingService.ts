/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Your Company. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import {
	Symbol,
	SymbolReference,
	Relationship,
	GraphData,
	LayoutResult,
	QueryResult,
	CodemapError
} from '../common/codemapTypes.js';

interface CacheEntry<T> {
	data: T;
	timestamp: number;
	lastAccessed: number;
	accessCount: number;
	size: number; // in bytes
	dependencies?: string[]; // file URIs this entry depends on
}

interface CacheStats {
	totalSize: number;
	entryCount: number;
	hitCount: number;
	missCount: number;
	evictionCount: number;
	memoryUsage: number;
}

interface CacheOptions {
	maxSize: number; // Maximum total size in bytes
	maxEntries: number; // Maximum number of entries
	ttl: number; // Time to live in milliseconds
	cleanupInterval: number; // Cleanup interval in milliseconds
}

export interface ICachingService {
	// Symbol cache
	getSymbols(uri: string): Promise<Symbol[] | null>;
	setSymbols(uri: string, symbols: Symbol[]): Promise<void>;
	invalidateSymbols(uri: string): Promise<void>;
	invalidateSymbolsPattern(pattern: string): Promise<void>;

	// Reference cache
	getReferences(symbolId: string): Promise<SymbolReference[] | null>;
	setReferences(symbolId: string, references: SymbolReference[]): Promise<void>;
	invalidateReferences(symbolId: string): Promise<void>;

	// Relationship cache
	getRelationships(symbolId: string): Promise<Relationship[] | null>;
	setRelationships(symbolId: string, relationships: Relationship[]): Promise<void>;
	invalidateRelationships(symbolId: string): Promise<void>;

	// Graph data cache
	getGraphData(key: string): Promise<GraphData | null>;
	setGraphData(key: string, data: GraphData): Promise<void>;
	invalidateGraphData(key: string): Promise<void>;

	// Layout cache
	getLayout(key: string): Promise<LayoutResult | null>;
	setLayout(key: string, layout: LayoutResult): Promise<void>;
	invalidateLayout(key: string): Promise<void>;

	// Query cache
	getQueryResult(key: string): Promise<QueryResult | null>;
	setQueryResult(key: string, result: QueryResult): Promise<void>;
	invalidateQueryResult(key: string): Promise<void>;

	// Cache management
	getCacheStats(): CacheStats;
	clearCache(): Promise<void>;
	optimizeCache(): Promise<void>;
	setCacheOptions(options: Partial<CacheOptions>): void;

	// Events
	onCacheEvicted: EventEmitter<{ type: string; key: string; reason: string }>;
	onCacheStatsUpdated: EventEmitter<CacheStats>;

	// Lifecycle
	dispose(): void;
}

export class CachingService extends Disposable implements ICachingService {
	public readonly onCacheEvicted = this._disposables.add(new EventEmitter<{ type: string; key: string; reason: string }>());
	public readonly onCacheStatsUpdated = this._disposables.add(new EventEmitter<CacheStats>());

	private readonly symbolCache = new Map<string, CacheEntry<Symbol[]>>();
	private readonly referenceCache = new Map<string, CacheEntry<SymbolReference[]>>();
	private readonly relationshipCache = new Map<string, CacheEntry<Relationship[]>>();
	private readonly graphDataCache = new Map<string, CacheEntry<GraphData>>();
	private readonly layoutCache = new Map<string, CacheEntry<LayoutResult>>();
	private readonly queryCache = new Map<string, CacheEntry<QueryResult>>();

	private readonly fileModificationTimes = new Map<string, number>();

	private stats: CacheStats = {
		totalSize: 0,
		entryCount: 0,
		hitCount: 0,
		missCount: 0,
		evictionCount: 0,
		memoryUsage: 0
	};

	private options: CacheOptions = {
		maxSize: 100 * 1024 * 1024, // 100MB
		maxEntries: 10000,
		ttl: 30 * 60 * 1000, // 30 minutes
		cleanupInterval: 5 * 60 * 1000 // 5 minutes
	};

	private cleanupTimer: any;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IFileService private readonly fileService: IFileService
	) {
		super();
		this.logService.debug('[Codemap] CachingService initialized');
		this.startCleanupTimer();
	}

	async getSymbols(uri: string): Promise<Symbol[] | null> {
		return this.getFromCache(this.symbolCache, uri, 'symbols');
	}

	async setSymbols(uri: string, symbols: Symbol[]): Promise<void> {
		await this.setToCache(this.symbolCache, uri, symbols, 'symbols', [uri]);
	}

	async invalidateSymbols(uri: string): Promise<void> {
		this.invalidateCache(this.symbolCache, uri, 'file-modified');
	}

	async invalidateSymbolsPattern(pattern: string): Promise<void> {
		const regex = new RegExp(pattern.replace(/\*/g, '.*'));
		for (const key of this.symbolCache.keys()) {
			if (regex.test(key)) {
				this.invalidateCache(this.symbolCache, key, 'pattern-match');
			}
		}
	}

	async getReferences(symbolId: string): Promise<SymbolReference[] | null> {
		return this.getFromCache(this.referenceCache, symbolId, 'references');
	}

	async setReferences(symbolId: string, references: SymbolReference[]): Promise<void> {
		const dependencies = references.map(ref => ref.location.uri);
		await this.setToCache(this.referenceCache, symbolId, references, 'references', dependencies);
	}

	async invalidateReferences(symbolId: string): Promise<void> {
		this.invalidateCache(this.referenceCache, symbolId, 'explicit');
	}

	async getRelationships(symbolId: string): Promise<Relationship[] | null> {
		return this.getFromCache(this.relationshipCache, symbolId, 'relationships');
	}

	async setRelationships(symbolId: string, relationships: Relationship[]): Promise<void> {
		const dependencies = this.extractDependenciesFromRelationships(relationships);
		await this.setToCache(this.relationshipCache, symbolId, relationships, 'relationships', dependencies);
	}

	async invalidateRelationships(symbolId: string): Promise<void> {
		this.invalidateCache(this.relationshipCache, symbolId, 'explicit');
	}

	async getGraphData(key: string): Promise<GraphData | null> {
		return this.getFromCache(this.graphDataCache, key, 'graph-data');
	}

	async setGraphData(key: string, data: GraphData): Promise<void> {
		const dependencies = this.extractDependenciesFromGraphData(data);
		await this.setToCache(this.graphDataCache, key, data, 'graph-data', dependencies);
	}

	async invalidateGraphData(key: string): Promise<void> {
		this.invalidateCache(this.graphDataCache, key, 'explicit');
	}

	async getLayout(key: string): Promise<LayoutResult | null> {
		return this.getFromCache(this.layoutCache, key, 'layout');
	}

	async setLayout(key: string, layout: LayoutResult): Promise<void> {
		await this.setToCache(this.layoutCache, key, layout, 'layout');
	}

	async invalidateLayout(key: string): Promise<void> {
		this.invalidateCache(this.layoutCache, key, 'explicit');
	}

	async getQueryResult(key: string): Promise<QueryResult | null> {
		return this.getFromCache(this.queryCache, key, 'query-result');
	}

	async setQueryResult(key: string, result: QueryResult): Promise<void> {
		const dependencies = this.extractDependenciesFromQueryResult(result);
		await this.setToCache(this.queryCache, key, result, 'query-result', dependencies);
	}

	async invalidateQueryResult(key: string): Promise<void> {
		this.invalidateCache(this.queryCache, key, 'explicit');
	}

	getCacheStats(): CacheStats {
		return { ...this.stats };
	}

	async clearCache(): Promise<void> {
		this.logService.info('[Codemap] Clearing all caches');

		const totalEntries = this.symbolCache.size + this.referenceCache.size +
			this.relationshipCache.size + this.graphDataCache.size +
			this.layoutCache.size + this.queryCache.size;

		this.symbolCache.clear();
		this.referenceCache.clear();
		this.relationshipCache.clear();
		this.graphDataCache.clear();
		this.layoutCache.clear();
		this.queryCache.clear();

		this.updateStats();
		this.logService.info(`[Codemap] Cleared ${totalEntries} cache entries`);
	}

	async optimizeCache(): Promise<void> {
		this.logService.debug('[Codemap] Optimizing cache');

		const allCaches = [
			this.symbolCache,
			this.referenceCache,
			this.relationshipCache,
			this.graphDataCache,
			this.layoutCache,
			this.queryCache
		];

		let optimizedCount = 0;

		for (const cache of allCaches) {
			const entries = Array.from(cache.entries());

			// Sort by access frequency and recency
			entries.sort(([, a], [, b]) => {
				const scoreA = a.accessCount * (Date.now() - a.lastAccessed);
				const scoreB = b.accessCount * (Date.now() - b.lastAccessed);
				return scoreB - scoreA;
			});

			// Remove least frequently used entries if over limit
			if (entries.length > this.options.maxEntries / 6) { // Divide by 6 for each cache type
				const toRemove = entries.slice(this.options.maxEntries / 6);
				for (const [key] of toRemove) {
					cache.delete(key);
					optimizedCount++;
				}
			}
		}

		this.updateStats();
		this.logService.debug(`[Codemap] Cache optimization completed, removed ${optimizedCount} entries`);
	}

	setCacheOptions(newOptions: Partial<CacheOptions>): void {
		this.options = { ...this.options, ...newOptions };
		this.logService.debug('[Codemap] Cache options updated:', this.options);

		// Restart cleanup timer with new interval
		this.startCleanupTimer();
	}

	// Private helper methods

	private async getFromCache<T>(
		cache: Map<string, CacheEntry<T>>,
		key: string,
		type: string
	): Promise<T | null> {
		const entry = cache.get(key);

		if (!entry) {
			this.stats.missCount++;
			return null;
		}

		// Check TTL
		if (Date.now() - entry.timestamp > this.options.ttl) {
			cache.delete(key);
			this.stats.missCount++;
			this.updateStats();
			return null;
		}

		// Check if dependencies are still valid
		if (entry.dependencies && await this.areDependenciesStale(entry.dependencies)) {
			cache.delete(key);
			this.stats.missCount++;
			this.updateStats();
			return null;
		}

		// Update access statistics
		entry.lastAccessed = Date.now();
		entry.accessCount++;
		this.stats.hitCount++;

		this.updateStats();
		this.logService.debug(`[Codemap] Cache hit for ${type}:${key}`);

		return entry.data;
	}

	private async setToCache<T>(
		cache: Map<string, CacheEntry<T>>,
		key: string,
		data: T,
		type: string,
		dependencies?: string[]
	): Promise<void> {
		const size = this.calculateSize(data);

		// Check if we need to make space
		await this.ensureSpace(size);

		const entry: CacheEntry<T> = {
			data,
			timestamp: Date.now(),
			lastAccessed: Date.now(),
			accessCount: 1,
			size,
			dependencies
		};

		cache.set(key, entry);
		this.updateStats();
		this.logService.debug(`[Codemap] Cached ${type}:${key} (${size} bytes)`);
	}

	private invalidateCache<T>(cache: Map<string, CacheEntry<T>>, key: string, reason: string): void {
		const entry = cache.get(key);
		if (entry) {
			cache.delete(key);
			this.stats.evictionCount++;
			this.onCacheEvicted.fire({ type: cache === this.symbolCache ? 'symbols' : 'unknown', key, reason });
			this.updateStats();
		}
	}

	private async ensureSpace(requiredSize: number): Promise<void> {
		const currentSize = this.calculateTotalCacheSize();

		if (currentSize + requiredSize <= this.options.maxSize) {
			return;
		}

		this.logService.debug(`[Codemap] Need to free ${currentSize + requiredSize - this.options.maxSize} bytes`);

		const allCaches = [
			{ cache: this.symbolCache, name: 'symbols' },
			{ cache: this.referenceCache, name: 'references' },
			{ cache: this.relationshipCache, name: 'relationships' },
			{ cache: this.graphDataCache, name: 'graph-data' },
			{ cache: this.layoutCache, name: 'layout' },
			{ cache: this.queryCache, name: 'query-result' }
		];

		// Collect all entries with their metadata
		const allEntries: Array<{
			cache: Map<string, CacheEntry<any>>;
			name: string;
			key: string;
			entry: CacheEntry<any>;
		}> = [];

		for (const { cache, name } of allCaches) {
			for (const [key, entry] of cache.entries()) {
				allEntries.push({ cache, name, key, entry });
			}
		}

		// Sort by LRU (least recently used)
		allEntries.sort((a, b) => {
			const scoreA = a.entry.accessCount * (Date.now() - a.entry.lastAccessed);
			const scoreB = b.entry.accessCount * (Date.now() - b.entry.lastAccessed);
			return scoreA - scoreB;
		});

		// Remove entries until we have enough space
		let freedSpace = 0;
		for (const { cache, name, key, entry } of allEntries) {
			cache.delete(key);
			freedSpace += entry.size;
			this.stats.evictionCount++;
			this.onCacheEvicted.fire({ type: name, key, reason: 'space-needed' });

			if (currentSize - freedSpace + requiredSize <= this.options.maxSize) {
				break;
			}
		}

		this.updateStats();
	}

	private async areDependenciesStale(dependencies: string[]): Promise<boolean> {
		for (const uri of dependencies) {
			try {
				const stat = await this.fileService.stat(URI.parse(uri));
				const modifiedTime = stat.mtime || stat.ctime || 0;
				const cachedTime = this.fileModificationTimes.get(uri) || 0;

				if (modifiedTime > cachedTime) {
					return true;
				}
			} catch (error) {
				// File might not exist, consider it stale
				return true;
			}
		}
		return false;
	}

	private extractDependenciesFromRelationships(relationships: Relationship[]): string[] {
		const dependencies = new Set<string>();
		for (const rel of relationships) {
			// In a real implementation, you would resolve symbol IDs to file URIs
			// For now, we'll return empty array
		}
		return Array.from(dependencies);
	}

	private extractDependenciesFromGraphData(data: GraphData): string[] {
		const dependencies = new Set<string>();
		for (const node of data.nodes) {
			dependencies.add(node.symbol.location.uri);
		}
		return Array.from(dependencies);
	}

	private extractDependenciesFromQueryResult(result: QueryResult): string[] {
		const dependencies = new Set<string>();
		for (const symbol of result.symbols) {
			dependencies.add(symbol.location.uri);
		}
		return Array.from(dependencies);
	}

	private calculateSize(data: any): number {
		// Rough estimation of object size in bytes
		const jsonString = JSON.stringify(data);
		return jsonString.length * 2; // Approximate bytes (2 bytes per char)
	}

	private calculateTotalCacheSize(): number {
		let totalSize = 0;
		const allCaches = [
			this.symbolCache,
			this.referenceCache,
			this.relationshipCache,
			this.graphDataCache,
			this.layoutCache,
			this.queryCache
		];

		for (const cache of allCaches) {
			for (const entry of cache.values()) {
				totalSize += entry.size;
			}
		}

		return totalSize;
	}

	private updateStats(): void {
		const allCaches = [
			this.symbolCache,
			this.referenceCache,
			this.relationshipCache,
			this.graphDataCache,
			this.layoutCache,
			this.queryCache
		];

		let totalSize = 0;
		let entryCount = 0;

		for (const cache of allCaches) {
			for (const entry of cache.values()) {
				totalSize += entry.size;
				entryCount++;
			}
		}

		this.stats = {
			...this.stats,
			totalSize,
			entryCount,
			memoryUsage: totalSize
		};

		this.onCacheStatsUpdated.fire(this.stats);
	}

	private startCleanupTimer(): void {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
		}

		this.cleanupTimer = setInterval(() => {
			this.performCleanup();
		}, this.options.cleanupInterval);
	}

	private performCleanup(): void {
		this.logService.debug('[Codemap] Performing cache cleanup');

		const allCaches = [
			{ cache: this.symbolCache, name: 'symbols' },
			{ cache: this.referenceCache, name: 'references' },
			{ cache: this.relationshipCache, name: 'relationships' },
			{ cache: this.graphDataCache, name: 'graph-data' },
			{ cache: this.layoutCache, name: 'layout' },
			{ cache: this.queryCache, name: 'query-result' }
		];

		let cleanedCount = 0;

		for (const { cache, name } of allCaches) {
			const keysToDelete: string[] = [];

			for (const [key, entry] of cache.entries()) {
				// Remove expired entries
				if (Date.now() - entry.timestamp > this.options.ttl) {
					keysToDelete.push(key);
					continue;
				}

				// Remove entries with stale dependencies
				if (entry.dependencies) {
					// This is async, but for cleanup we'll skip async check
					// and use a simpler heuristic
					const now = Date.now();
					if (now - entry.lastAccessed > this.options.ttl / 2) {
						keysToDelete.push(key);
					}
				}
			}

			for (const key of keysToDelete) {
				cache.delete(key);
				cleanedCount++;
				this.stats.evictionCount++;
				this.onCacheEvicted.fire({ type: name, key, reason: 'expired' });
			}
		}

		if (cleanedCount > 0) {
			this.updateStats();
			this.logService.debug(`[Codemap] Cleanup removed ${cleanedCount} expired entries`);
		}
	}

	override dispose(): void {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = null;
		}

		this.clearCache();
		super.dispose();
	}
}