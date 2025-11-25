/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Your Company. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Re-export all types from common
export * from '../../../common/codemapTypes.js';

// Additional React-specific types
export interface ReactGraphProps {
	data: GraphData;
	layout: LayoutResult;
	width: number;
	height: number;
	onNodeClick?: (node: GraphNode) => void;
	onNodeDoubleClick?: (node: GraphNode) => void;
	onNodeHover?: (node: GraphNode | null) => void;
	onEdgeClick?: (edge: GraphEdge) => void;
	onEdgeHover?: (edge: GraphEdge | null) => void;
	onSelectionChange?: (selectedNodes: GraphNode[], selectedEdges: GraphEdge[]) => void;
	theme?: GraphTheme;
	options?: VisualizationOptions;
}

export interface VisualizationOptions {
	showLabels: boolean;
	showEdges: boolean;
	showControls: boolean;
	enableZoom: boolean;
	enablePan: boolean;
	enableSelection: boolean;
	nodeSize: number;
	edgeWidth: number;
	labelSize: number;
	animateTransitions: boolean;
	viewportCulling: boolean;
	levelOfDetail: boolean;
	maxFPS: number;
}

export interface ViewportState {
	x: number;
	y: number;
	zoom: number;
	width: number;
	height: number;
}

export interface InteractionState {
	selectedNodes: Set<string>;
	selectedEdges: Set<string>;
	hoveredNode: string | null;
	hoveredEdge: string | null;
	isDragging: boolean;
	isPanning: boolean;
	dragStart: { x: number; y: number } | null;
	panStart: { x: number; y: number } | null;
}

export interface QueryBuilderProps {
	onQueryChange: (query: CodeQuery) => void;
	onExecuteQuery: (query: CodeQuery) => void;
	suggestions?: string[];
	initialQuery?: CodeQuery;
	placeholder?: string;
	disabled?: boolean;
}

export interface SymbolDetailsProps {
	symbol: Symbol;
	references?: SymbolReference[];
	relationships?: Relationship[];
	onNavigateToSymbol?: (symbolId: string) => void;
	onShowReferences?: (symbolId: string) => void;
	onShowRelationships?: (symbolId: string) => void;
}

export interface ControlsProps {
	viewport: ViewportState;
	onViewportChange: (viewport: Partial<ViewportState>) => void;
	onZoomIn: () => void;
	onZoomOut: () => void;
	onFitToScreen: () => void;
	onResetView: () => void;
	selectedAlgorithm: LayoutAlgorithm;
	onAlgorithmChange: (algorithm: LayoutAlgorithm) => void;
	algorithms: LayoutAlgorithm[];
	loading: boolean;
}

export interface MinimapProps {
	data: GraphData;
	viewport: ViewportState;
	onViewportChange: (viewport: Partial<ViewportState>) => void;
	width?: number;
	height?: number;
	showNodes?: boolean;
	showEdges?: boolean;
	nodeSize?: number;
}

export interface SearchBoxProps {
	onSearch: (query: string) => void;
	onClear: () => void;
	placeholder?: string;
	debounceMs?: number;
	suggestions?: string[];
}

export interface FilterPanelProps {
	filters: FilterOptions;
	onFiltersChange: (filters: FilterOptions) => void;
	symbolKinds: SymbolKind[];
	relationshipTypes: RelationshipType[];
}

export interface PerformanceMonitorProps {
	metrics: PerformanceMetrics;
	visible?: boolean;
	onToggleVisible?: () => void;
}

// Hook return types
export interface UseCodemapDataReturn {
	data: GraphData | null;
	loading: boolean;
	error: Error | null;
	refetch: () => Promise<void>;
	metrics: PerformanceMetrics;
}

export interface UseGraphLayoutReturn {
	layout: LayoutResult | null;
	loading: boolean;
	error: Error | null;
	computeLayout: (data: GraphData, algorithm: LayoutAlgorithm, options?: LayoutOptions) => Promise<void>;
	quality: ReturnType<IGraphLayoutService['analyzeLayoutQuality']> | null;
}

export interface UseSymbolSelectionReturn {
	selectedNodes: GraphNode[];
	selectedEdges: GraphEdge[];
	selectNode: (node: GraphNode, multiSelect?: boolean) => void;
	selectEdge: (edge: GraphEdge, multiSelect?: boolean) => void;
	clearSelection: () => void;
	selectAll: () => void;
	invertSelection: () => void;
}

export interface UseViewportReturn {
	viewport: ViewportState;
	setViewport: (viewport: Partial<ViewportState>) => void;
	zoomTo: (scale: number, centerX?: number, centerY?: number) => void;
	panTo: (x: number, y: number) => void;
	fitToContent: (content: { nodes: GraphNode[] }) => void;
	screenToGraph: (screenX: number, screenY: number) => { x: number; y: number };
	graphToScreen: (graphX: number, graphY: number) => { x: number; y: number };
}

export interface UseRealTimeUpdatesReturn {
	connected: boolean;
	lastUpdate: Date | null;
	subscribe: (scope: QueryScope) => void;
	unsubscribe: (scope: QueryScope) => void;
	pendingUpdates: GraphUpdate[];
}