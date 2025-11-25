/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Your Company. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILanguageService } from '../../../../editor/common/languages/languageService.js';
import { ILanguageServerService } from '../../../../editor/common/services/languageServerService.js';
import {
	SymbolResolutionService,
	LanguageServerService,
	QueryEngineService,
	GraphLayoutService,
	CachingService
} from './index.js';

import {
	CodeQuery,
	QueryResult,
	QueryScope,
	GraphData,
	GraphQuery,
	LayoutAlgorithm,
	LayoutOptions,
	LayoutResult,
	Symbol,
	SymbolReference,
	Relationship,
	RelationshipType,
	SymbolOptions,
	GraphOptions,
	Viewport,
	PerformanceMetrics,
	CodemapError
} from '../common/codemapTypes.js';

export interface ICodemapChannel extends IServerChannel {
	// Events
	onSymbolsChanged: Event<{ uri: string; symbols: Symbol[] }>;
	onRelationshipsChanged: Event<{ symbolId: string; relationships: Relationship[] }>;
	onGraphUpdated: Event<{ type: string; data: any }>;
	onPerformanceMetricsUpdated: Event<PerformanceMetrics>;
}

export class CodemapChannel implements ICodemapChannel {
	private readonly symbolResolutionService: SymbolResolutionService;
	private readonly languageServerService: LanguageServerService;
	private readonly queryEngineService: QueryEngineService;
	private readonly graphLayoutService: GraphLayoutService;
	private readonly cachingService: CachingService;

	// Event emitters
	private readonly _onSymbolsChanged = new Emitter<{ uri: string; symbols: Symbol[] }>();
	private readonly _onRelationshipsChanged = new Emitter<{ symbolId: string; relationships: Relationship[] }>();
	private readonly _onGraphUpdated = new Emitter<{ type: string; data: any }>();
	private readonly _onPerformanceMetricsUpdated = new Emitter<PerformanceMetrics>();

	// Public event accessors
	public readonly onSymbolsChanged = this._onSymbolsChanged.event;
	public readonly onRelationshipsChanged = this._onRelationshipsChanged.event;
	public readonly onGraphUpdated = this._onGraphUpdated.event;
	public readonly onPerformanceMetricsUpdated = this._onPerformanceMetricsUpdated.event;

	// Performance tracking
	private performanceMetrics: PerformanceMetrics = {
		symbolResolution: { totalSymbols: 0, cacheHits: 0, cacheMisses: 0, averageTime: 0 },
		graphLayout: { computeTime: 0, nodeCount: 0, edgeCount: 0, iterations: 0 },
		rendering: { frameRate: 60, renderTime: 0, visibleNodes: 0, totalNodes: 0 },
		memory: { heapUsed: 0, heapTotal: 0, external: 0 }
	};

	constructor(
		@ILogService private readonly logService: ILogService,
		@IFileService private readonly fileService: IFileService,
		@ILanguageService private readonly languageService: ILanguageService,
		@ILanguageServerService private readonly languageServerService: ILanguageServerService
	) {
		this.logService.debug('[Codemap] CodemapChannel initialized');

		// Initialize services
		this.symbolResolutionService = new SymbolResolutionService(this.logService, this.languageService);
		this.languageServerService = new LanguageServerService(
			this.logService,
			this.languageServerService, // This would need to be injected properly
			this.languageService,
			this.languageServerService
		);
		this.queryEngineService = new QueryEngineService(this.logService, this.languageService, { getWorkspace: () => ({ folders: [] }) } as any);
		this.graphLayoutService = new GraphLayoutService(this.logService);
		this.cachingService = new CachingService(this.logService, this.fileService);

		this.setupEventForwarding();
		this.startPerformanceMonitoring();
	}

	// IServerChannel implementation

	listen(_: unknown, event: string): Event<any> {
		switch (event) {
			case 'onSymbolsChanged':
				return this.onSymbolsChanged;
			case 'onRelationshipsChanged':
				return this.onRelationshipsChanged;
			case 'onGraphUpdated':
				return this.onGraphUpdated;
			case 'onPerformanceMetricsUpdated':
				return this.onPerformanceMetricsUpdated;
			default:
				throw new Error(`Unknown event: ${event}`);
		}
	}

	async call(_: unknown, command: string, args?: any[]): Promise<any> {
		try {
			this.logService.debug(`[Codemap] Channel call: ${command}`);

			switch (command) {
				// Symbol resolution commands
				case 'getSymbols':
					return await this.handleGetSymbols(args);
				case 'resolveSymbolAtPosition':
					return await this.handleResolveSymbolAtPosition(args);
				case 'findReferences':
					return await this.handleFindReferences(args);
				case 'findDefinition':
					return await this.handleFindDefinition(args);
				case 'findImplementations':
					return await this.handleFindImplementations(args);
				case 'getRelationships':
					return await this.handleGetRelationships(args);

				// Query engine commands
				case 'executeQuery':
					return await this.handleExecuteQuery(args);
				case 'executeNaturalLanguageQuery':
					return await this.handleExecuteNaturalLanguageQuery(args);
				case 'getQuerySuggestions':
					return await this.handleGetQuerySuggestions(args);
				case 'getSymbolSuggestions':
					return await this.handleGetSymbolSuggestions(args);

				// Graph visualization commands
				case 'getGraphData':
					return await this.handleGetGraphData(args);
				case 'getLayout':
					return await this.handleGetLayout(args);
				case 'computeIncrementalLayout':
					return await this.handleComputeIncrementalLayout(args);

				// Layout utilities
				case 'getNodeBounds':
					return this.handleGetNodeBounds(args);
				case 'fitToViewport':
					return this.handleFitToViewport(args);
				case 'zoomToNode':
					return this.handleZoomToNode(args);

				// Language server commands
				case 'startLanguageServer':
					return await this.handleStartLanguageServer(args);
				case 'stopLanguageServer':
					return await this.handleStopLanguageServer(args);
				case 'restartLanguageServer':
					return await this.handleRestartLanguageServer(args);
				case 'isLanguageServerRunning':
					return this.handleIsLanguageServerRunning(args);

				// Cache management commands
				case 'getCacheStats':
					return this.handleGetCacheStats();
				case 'clearCache':
					return await this.handleClearCache();
				case 'optimizeCache':
					return await this.handleOptimizeCache();
				case 'setCacheOptions':
					return this.handleSetCacheOptions(args);

				// Performance commands
				case 'getPerformanceMetrics':
					return this.handleGetPerformanceMetrics();

				// Health check
				case 'healthCheck':
					return await this.handleHealthCheck();

				default:
					throw new Error(`Unknown command: ${command}`);
			}

		} catch (error) {
			this.logService.error(`[Codemap] Channel command ${command} failed:`, error);
			throw new CodemapError(
				`Command failed: ${command} - ${error instanceof Error ? error.message : 'Unknown error'}`,
				'COMMAND_FAILED',
				{ command, args, error }
			);
		}
	}

	// Command handlers

	private async handleGetSymbols(args: any[]): Promise<Symbol[]> {
		const [uri, options] = args;
		const startTime = Date.now();

		try {
			const symbols = await this.symbolResolutionService.resolveSymbols(uri, options);

			// Update performance metrics
			const duration = Date.now() - startTime;
			this.updateSymbolResolutionMetrics(symbols.length, true, duration);

			return symbols;
		} catch (error) {
			this.updateSymbolResolutionMetrics(0, false, Date.now() - startTime);
			throw error;
		}
	}

	private async handleResolveSymbolAtPosition(args: any[]): Promise<Symbol | null> {
		const [uri, position] = args;
		return await this.symbolResolutionService.resolveSymbolAtPosition(uri, position);
	}

	private async handleFindReferences(args: any[]): Promise<SymbolReference[]> {
		const [symbolId, includeDefinition] = args;
		return await this.symbolResolutionService.findReferences(symbolId, includeDefinition);
	}

	private async handleFindDefinition(args: any[]): Promise<SymbolReference | null> {
		const [symbolId] = args;
		return await this.symbolResolutionService.findDefinition(symbolId);
	}

	private async handleFindImplementations(args: any[]): Promise<SymbolReference[]> {
		const [symbolId] = args;
		return await this.symbolResolutionService.findImplementations(symbolId);
	}

	private async handleGetRelationships(args: any[]): Promise<Relationship[]> {
		const [symbolId, types] = args;
		return await this.symbolResolutionService.getRelationships(symbolId, types);
	}

	private async handleExecuteQuery(args: any[]): Promise<QueryResult> {
		const [query, scope] = args;
		return await this.queryEngineService.executeQuery(query, scope);
	}

	private async handleExecuteNaturalLanguageQuery(args: any[]): Promise<QueryResult> {
		const [query, scope] = args;
		return await this.queryEngineService.executeNaturalLanguageQuery(query, scope);
	}

	private async handleGetQuerySuggestions(args: any[]): Promise<string[]> {
		const [partialQuery, scope] = args;
		return await this.queryEngineService.getQuerySuggestions(partialQuery, scope);
	}

	private async handleGetSymbolSuggestions(args: any[]): Promise<Symbol[]> {
		const [pattern, scope] = args;
		return await this.queryEngineService.getSymbolSuggestions(pattern, scope);
	}

	private async handleGetGraphData(args: any[]): Promise<GraphData> {
		const [query, options] = args;
		const startTime = Date.now();

		try {
			// Execute query to get symbols and relationships
			const queryResult = await this.queryEngineService.executeQuery(query.select || { symbols: ['*'] }, query.scope);

			// Convert to graph data
			const graphData: GraphData = {
				nodes: queryResult.symbols.map(symbol => ({
					id: symbol.id,
					symbol,
					size: this.getNodeSize(symbol.kind),
					color: this.getNodeColor(symbol.kind)
				})),
				edges: queryResult.relationships.map(rel => ({
					source: rel.sourceId,
					target: rel.targetId,
					relationship: rel,
					strength: rel.metadata.strength || 1
				})),
				metadata: {
					totalNodes: queryResult.symbols.length,
					totalEdges: queryResult.relationships.length,
					lastUpdated: Date.now(),
					scope: query.scope || {},
					layoutAlgorithm: options?.layoutAlgorithm || LayoutAlgorithm.FORCE_DIRECTED
				}
			};

			this._onGraphUpdated.fire({ type: 'graphDataLoaded', data: graphData });
			return graphData;

		} catch (error) {
			this.logService.error('[Codemap] Failed to get graph data:', error);
			throw error;
		}
	}

	private async handleGetLayout(args: any[]): Promise<LayoutResult> {
		const [graphData, algorithm, options] = args;
		const startTime = Date.now();

		try {
			const result = await this.graphLayoutService.computeLayout(graphData, algorithm, options);

			// Update performance metrics
			const duration = Date.now() - startTime;
			this.updateGraphLayoutMetrics(duration, graphData.nodes.length, graphData.edges.length, result.iterations);

			this._onGraphUpdated.fire({ type: 'layoutComputed', data: result });
			return result;

		} catch (error) {
			this.logService.error('[Codemap] Failed to compute layout:', error);
			throw error;
		}
	}

	private async handleComputeIncrementalLayout(args: any[]): Promise<LayoutResult> {
		const [graphData, previousResult, changedNodes] = args;
		return await this.graphLayoutService.computeIncrementalLayout(graphData, previousResult, changedNodes);
	}

	private handleGetNodeBounds(args: any[]): any {
		const [nodes] = args;
		return this.graphLayoutService.getNodeBounds(nodes);
	}

	private handleFitToViewport(args: any[]): any {
		const [nodes, viewport] = args;
		return this.graphLayoutService.fitToViewport(nodes, viewport);
	}

	private handleZoomToNode(args: any[]): any {
		const [node, viewport] = args;
		return this.graphLayoutService.zoomToNode(node, viewport);
	}

	private async handleStartLanguageServer(args: any[]): Promise<void> {
		const [language, workspacePath] = args;
		return await this.languageServerService.startServer(language, workspacePath);
	}

	private async handleStopLanguageServer(args: any[]): Promise<void> {
		const [language] = args;
		return await this.languageServerService.stopServer(language);
	}

	private async handleRestartLanguageServer(args: any[]): Promise<void> {
		const [language] = args;
		return await this.languageServerService.restartServer(language);
	}

	private handleIsLanguageServerRunning(args: any[]): boolean {
		const [language] = args;
		return this.languageServerService.isServerRunning(language);
	}

	private handleGetCacheStats(): any {
		return this.cachingService.getCacheStats();
	}

	private async handleClearCache(): Promise<void> {
		return await this.cachingService.clearCache();
	}

	private async handleOptimizeCache(): Promise<void> {
		return await this.cachingService.optimizeCache();
	}

	private handleSetCacheOptions(args: any[]): void {
		const [options] = args;
		this.cachingService.setCacheOptions(options);
	}

	private handleGetPerformanceMetrics(): PerformanceMetrics {
		return { ...this.performanceMetrics };
	}

	private async handleHealthCheck(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details: any }> {
		const details = {
			services: {
				symbolResolution: 'running',
				languageServer: 'running',
				queryEngine: 'running',
				graphLayout: 'running',
				caching: 'running'
			},
			memory: process.memoryUsage(),
			uptime: process.uptime()
		};

		// Basic health checks
		let issues = 0;
		if (this.performanceMetrics.symbolResolution.averageTime > 1000) issues++;
		if (this.performanceMetrics.graphLayout.computeTime > 5000) issues++;

		const status = issues === 0 ? 'healthy' : issues <= 2 ? 'degraded' : 'unhealthy';
		return { status, details };
	}

	// Private helper methods

	private setupEventForwarding(): void {
		// Forward events from services
		this.symbolResolutionService.onSymbolsChanged((e) => {
			this._onSymbolsChanged.fire(e);
			this._onGraphUpdated.fire({ type: 'symbolsChanged', data: e });
		});

		this.symbolResolutionService.onRelationshipsChanged((e) => {
			this._onRelationshipsChanged.fire(e);
			this._onGraphUpdated.fire({ type: 'relationshipsChanged', data: e });
		});

		this.graphLayoutService.onLayoutComputed((e) => {
			this._onGraphUpdated.fire({ type: 'layoutComputed', data: e });
		});

		this.cachingService.onCacheEvicted((e) => {
			this._onGraphUpdated.fire({ type: 'cacheEvicted', data: e });
		});
	}

	private startPerformanceMonitoring(): void {
		setInterval(() => {
			this.updateMemoryMetrics();
			this._onPerformanceMetricsUpdated.fire(this.performanceMetrics);
		}, 5000); // Update every 5 seconds
	}

	private updateSymbolResolutionMetrics(symbolCount: number, success: boolean, duration: number): void {
		const metrics = this.performanceMetrics.symbolResolution;
		metrics.totalSymbols += symbolCount;

		if (success) {
			if (duration < 100) {
				metrics.cacheHits++;
			} else {
				metrics.cacheMisses++;
			}

			// Update average time
			const totalRequests = metrics.cacheHits + metrics.cacheMisses;
			metrics.averageTime = ((metrics.averageTime * (totalRequests - 1)) + duration) / totalRequests;
		}
	}

	private updateGraphLayoutMetrics(computeTime: number, nodeCount: number, edgeCount: number, iterations: number): void {
		const metrics = this.performanceMetrics.graphLayout;
		metrics.computeTime = computeTime;
		metrics.nodeCount = nodeCount;
		metrics.edgeCount = edgeCount;
		metrics.iterations = iterations;
	}

	private updateMemoryMetrics(): void {
		const memUsage = process.memoryUsage();
		this.performanceMetrics.memory = {
			heapUsed: memUsage.heapUsed,
			heapTotal: memUsage.heapTotal,
			external: memUsage.external
		};
	}

	private getNodeSize(kind: string): number {
		const sizeMap: Record<string, number> = {
			[class: string]: 60,
			[SymbolKind.Function]: 50,
			[SymbolKind.Method]: 45,
			[SymbolKind.Interface]: 55,
			[SymbolKind.Variable]: 40,
			[SymbolKind.Property]: 35,
			[SymbolKind.Module]: 65,
			[SymbolKind.Enum]: 50,
			[SymbolKind.Namespace]: 55
		};
		return sizeMap[kind] || 40;
	}

	private getNodeColor(kind: string): string {
		const colorMap: Record<string, string> = {
			[class: string]: '#4A90E2',
			[SymbolKind.Function]: '#50C878',
			[SymbolKind.Method]: '#32CD32',
			[SymbolKind.Interface]: '#9370DB',
			[SymbolKind.Variable]: '#FF6347',
			[SymbolKind.Property]: '#FF8C00',
			[SymbolKind.Module]: '#2E8B57',
			[SymbolKind.Enum]: '#4682B4',
			[SymbolKind.Namespace]: '#6A5ACD'
		};
		return colorMap[kind] || '#808080';
	}

	// For cleanup
	dispose(): void {
		this.symbolResolutionService.dispose();
		this.languageServerService.dispose();
		// Note: queryEngineService and graphLayoutService don't have dispose methods in our current implementation
		this.cachingService.dispose();
	}
}