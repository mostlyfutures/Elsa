/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Your Company. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Location, Range, Position } from '../../../../editor/common/languages.js';

export enum SymbolKind {
	Class = 'class',
	Function = 'function',
	Variable = 'variable',
	Interface = 'interface',
	Module = 'module',
	Method = 'method',
	Property = 'property',
	Constructor = 'constructor',
	Enum = 'enum',
	EnumMember = 'enumMember',
	TypeAlias = 'typeAlias',
	TypeParameter = 'typeParameter',
	Namespace = 'namespace',
	Import = 'import',
	Export = 'export',
	File = 'file',
	Folder = 'folder',
	Package = 'package'
}

export enum RelationshipType {
	CALLS = 'calls',
	EXTENDS = 'extends',
	IMPLEMENTS = 'implements',
	IMPORTS = 'imports',
	REFERENCES = 'references',
	DEFINES = 'defines',
	USES = 'uses',
	INHERITS = 'inherits',
	CONTAINS = 'contains'
}

export interface Symbol {
	id: string;
	name: string;
	kind: SymbolKind;
	location: Location;
	containerName?: string;
	language: string;
	metadata: SymbolMetadata;
}

export interface SymbolMetadata {
	isExported: boolean;
	isDeprecated: boolean;
	isStatic: boolean;
	isAbstract: boolean;
	tags: string[];
	documentation?: string;
	typeInfo?: TypeInfo;
	visibility?: 'public' | 'private' | 'protected';
}

export interface TypeInfo {
	type: string;
	parameters?: TypeInfo[];
	returnType?: TypeInfo;
	generics?: TypeInfo[];
}

export interface SymbolReference {
	location: Location;
	context: string;
	symbolId: string;
	kind: 'definition' | 'reference' | 'write' | 'read';
}

export interface Relationship {
	sourceId: string;
	targetId: string;
	type: RelationshipType;
	metadata: RelationshipMetadata;
}

export interface RelationshipMetadata {
	strength?: number; // 0-1 for visual importance
	cardinality?: string;
	direction?: 'bidirectional' | 'unidirectional';
	labels?: string[];
}

// Query Language Types
export interface CodeQuery {
	select: QuerySelect;
	from?: QueryScope;
	where?: QueryCondition;
	traverse?: QueryTraversal;
	limit?: number;
	offset?: number;
}

export interface QuerySelect {
	symbols?: string[]; // symbol patterns
	relationships?: RelationshipType[];
	properties?: string[];
}

export interface QueryScope {
	path?: string;
	language?: string;
	includeTests?: boolean;
	depth?: number;
}

export interface QueryCondition {
	symbolType?: SymbolKind[];
	namePattern?: string;
	inPath?: string;
	hasAnnotation?: string;
	isExported?: boolean;
	isDeprecated?: boolean;
	callsFunction?: string;
	extendsClass?: string;
	implementsInterface?: string;
}

export interface QueryTraversal {
	depth: number;
	direction: 'incoming' | 'outgoing' | 'both';
	relationshipTypes?: RelationshipType[];
}

export interface QueryResult {
	symbols: Symbol[];
	relationships: Relationship[];
	total: number;
	queryTime: number;
	cached: boolean;
}

// Graph Visualization Types
export interface GraphQuery {
	scope: QueryScope;
	query?: CodeQuery;
	maxDepth?: number;
	maxNodes?: number;
}

export interface GraphData {
	nodes: GraphNode[];
	edges: GraphEdge[];
	clusters?: GraphCluster[];
	metadata: GraphMetadata;
}

export interface GraphNode {
	id: string;
	symbol: Symbol;
	x?: number;
	y?: number;
	vx?: number;
	vy?: number;
	fx?: number;
	fy?: number;
	group?: string;
	size?: number;
	color?: string;
	label?: string;
}

export interface GraphEdge {
	source: string;
	target: string;
	relationship: Relationship;
	strength?: number;
	color?: string;
	width?: number;
	type?: 'solid' | 'dashed' | 'dotted';
}

export interface GraphCluster {
	id: string;
	name: string;
	nodes: string[];
	color?: string;
	pattern?: string;
}

export interface GraphMetadata {
	totalNodes: number;
	totalEdges: number;
	lastUpdated: number;
	scope: QueryScope;
	layoutAlgorithm: LayoutAlgorithm;
	zoom?: number;
	pan?: { x: number; y: number };
}

// Layout Algorithm Types
export enum LayoutAlgorithm {
	FORCE_DIRECTED = 'force-directed',
	HIERARCHICAL = 'hierarchical',
	CLUSTERED = 'clustered',
	CIRCULAR = 'circular',
	GRID = 'grid',
	RANDOM = 'random'
}

export interface LayoutOptions {
	width: number;
	height: number;
	nodeSpacing: number;
	iterations: number;
	gravity: number;
	charge: number;
	linkDistance: number;
	linkStrength: number;
	damping: number;
	velocityDecay: number;
	clustering?: {
		enabled: boolean;
		clusterDistance: number;
		preventOverlap: boolean;
	};
}

export interface LayoutResult {
	nodes: GraphNode[];
	edges: GraphEdge[];
	algorithm: LayoutAlgorithm;
	options: LayoutOptions;
	computeTime: number;
	iterations: number;
	converged: boolean;
}

// Visualization Types
export interface Viewport {
	left: number;
	top: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
	zoom: number;
}

export interface GraphUpdate {
	type: 'add' | 'remove' | 'update' | 'move';
	nodes?: GraphNode[];
	edges?: GraphEdge[];
	viewport?: Viewport;
	timestamp: number;
}

export interface FilterOptions {
	symbolTypes: SymbolKind[];
	showTestFiles: boolean;
	showDeprecated: boolean;
	minRelationshipStrength: number;
	maxDepth: number;
	searchTerm?: string;
}

export interface GraphTheme {
	colors: {
		background: string;
		nodes: Record<SymbolKind, string>;
		edges: Record<RelationshipType, string>;
		text: string;
		highlight: string;
		selection: string;
	};
	sizes: {
		nodes: Record<SymbolKind, number>;
		edges: Record<RelationshipType, number>;
		text: {
			small: number;
			normal: number;
			large: number;
		};
	};
	opacity: {
		nodes: {
			normal: number;
			faded: number;
			highlighted: number;
		};
		edges: {
			normal: number;
			faded: number;
			highlighted: number;
		};
	};
}

// Performance Monitoring
export interface PerformanceMetrics {
	symbolResolution: {
		totalSymbols: number;
		cacheHits: number;
		cacheMisses: number;
		averageTime: number;
	};
	graphLayout: {
		computeTime: number;
		nodeCount: number;
		edgeCount: number;
		iterations: number;
	};
	rendering: {
		frameRate: number;
		renderTime: number;
		visibleNodes: number;
		totalNodes: number;
	};
	memory: {
		heapUsed: number;
		heapTotal: number;
		external: number;
	};
}

// Error Types
export class CodemapError extends Error {
	constructor(
		message: string,
		public readonly code: string,
		public readonly details?: any
	) {
		super(message);
		this.name = 'CodemapError';
	}
}

export interface ValidationResult {
	isValid: boolean;
	errors: string[];
	warnings: string[];
}

// Service Interfaces
export interface ICodemapService {
	getSymbols(uri: string, options?: SymbolOptions): Promise<Symbol[]>;
	getReferences(symbolId: string, includeDefinition?: boolean): Promise<SymbolReference[]>;
	getRelationships(symbolId: string, types: RelationshipType[]): Promise<Relationship[]>;
	query(query: CodeQuery, scope?: QueryScope): Promise<QueryResult>;
	getGraphData(query: GraphQuery, options?: GraphOptions): Promise<GraphData>;
	getLayout(data: GraphData, algorithm: LayoutAlgorithm, options?: LayoutOptions): Promise<LayoutResult>;
	subscribeToUpdates(uri: string): void;
	unsubscribeFromUpdates(uri: string): void;
	dispose(): void;
}

export interface SymbolOptions {
	includeDependencies?: boolean;
	maxDepth?: number;
	sortBy?: 'name' | 'type' | 'location';
	filter?: string[];
}

export interface GraphOptions {
	includeTestFiles?: boolean;
	maxNodes?: number;
	maxDepth?: number;
	layoutAlgorithm?: LayoutAlgorithm;
	theme?: Partial<GraphTheme>;
	filter?: FilterOptions;
}