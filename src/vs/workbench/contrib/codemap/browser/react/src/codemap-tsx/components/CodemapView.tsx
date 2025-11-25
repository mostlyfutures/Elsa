/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Your Company. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, {
	useState,
	useCallback,
	useEffect,
	useMemo
} from 'react';
import {
	GraphData,
	GraphQuery,
	CodeQuery,
	LayoutAlgorithm,
	GraphNode,
	GraphOptions,
	GraphTheme
} from '../types/index.js';
import { GraphCanvas } from './GraphCanvas.js';
import { QueryBuilder } from './QueryBuilder.js';
import { SymbolDetails } from './SymbolDetails.js';
import { useCodemapData } from '../hooks/useCodemapData.js';
import { useGraphLayout } from '../hooks/useGraphLayout.js';
import { useSymbolSelection } from '../hooks/useSymbolSelection.js';

export interface CodemapViewProps {
	width?: number;
	height?: number;
	initialQuery?: GraphQuery;
	theme?: GraphTheme;
	onSymbolNavigate?: (symbolId: string) => void;
	onFileOpen?: (filePath: string, line: number, column: number) => void;
}

export const CodemapView: React.FC<CodemapViewProps> = ({
	width = 800,
	height = 600,
	initialQuery,
	theme,
	onSymbolNavigate,
	onFileOpen
}) => {
	const [selectedSymbol, setSelectedSymbol] = useState<GraphNode | null>(null);
	const [showQueryBuilder, setShowQueryBuilder] = useState(false);
	const [showSymbolDetails, setShowSymbolDetails] = useState(false);
	const [currentQuery, setCurrentQuery] = useState<CodeQuery>({
		select: { symbols: ['*'] },
		limit: 100
	});
	const [layoutAlgorithm, setLayoutAlgorithm] = useState<LayoutAlgorithm>(LayoutAlgorithm.FORCE_DIRECTED);

	// Custom hooks
	const {
		data,
		loading: dataLoading,
		error: dataError,
		refetch,
		metrics
	} = useCodemapData({
		query: initialQuery,
		enableRealTimeUpdates: true,
		refreshInterval: 30000, // 30 seconds
		onError: (error) => {
			console.error('Codemap data loading error:', error);
		}
	});

	const {
		layout,
		loading: layoutLoading,
		error: layoutError,
		computeLayout,
		quality
	} = useGraphLayout({
		defaultAlgorithm: layoutAlgorithm,
		enableAutoQuality: true,
		onLayoutComputed: (result) => {
			console.log('Layout computed:', result);
		}
	});

	const {
		selectedNodes,
		selectedEdges,
		selectNode,
		selectEdge,
		clearSelection,
		getSelectionSummary
	} = useSymbolSelection({
		enableMultiSelect: true,
		onSelectionChange: (nodes, edges) => {
			console.log('Selection changed:', { nodes: nodes.length, edges: edges.length });
		}
	});

	// Compute layout when data changes
	useEffect(() => {
		if (data && !dataLoading) {
			computeLayout(data, layoutAlgorithm);
		}
	}, [data, dataLoading, layoutAlgorithm, computeLayout]);

	// Handle query changes
	const handleQueryChange = useCallback((query: CodeQuery) => {
		setCurrentQuery(query);
	}, []);

	const handleQueryExecute = useCallback(async (query: CodeQuery) => {
		setShowQueryBuilder(false);
		// This would trigger data reload through the useCodemapData hook
		// In a real implementation, you'd update the query in the hook
		await refetch();
	}, [refetch]);

	// Handle graph interactions
	const handleNodeClick = useCallback((node: GraphNode) => {
		selectNode(node);
		setSelectedSymbol(node);
		setShowSymbolDetails(true);
	}, [selectNode]);

	const handleNodeDoubleClick = useCallback((node: GraphNode) => {
		// Navigate to symbol in editor
		const location = node.symbol.location;
		onFileOpen?.(location.uri, location.range.start.line, location.range.start.character);
	}, [onFileOpen]);

	const handleEdgeClick = useCallback((edge: any) => {
		selectEdge(edge);
	}, [selectEdge]);

	// Handle navigation
	const handleNavigateToSymbol = useCallback((symbolId: string) => {
		onSymbolNavigate?.(symbolId);
	}, [onSymbolNavigate]);

	const handleShowReferences = useCallback((symbolId: string) => {
		// Update query to find references
		const referencesQuery: CodeQuery = {
			select: { symbols: ['*'] },
			where: { callsFunction: symbolId },
			limit: 50
		};
		setCurrentQuery(referencesQuery);
		// This would trigger a data reload
	}, []);

	const handleShowRelationships = useCallback((symbolId: string) => {
		// Update query to show relationships
		const relationshipsQuery: CodeQuery = {
			select: { symbols: ['*'], relationships: ['calls', 'extends', 'implements'] },
			where: { inPath: symbolId },
			limit: 100
		};
		setCurrentQuery(relationshipsQuery);
		// This would trigger a data reload
	}, []);

	// Memoize graph options
	const graphOptions = useMemo<GraphOptions>(() => ({
		includeTestFiles: false,
		maxNodes: 1000,
		layoutAlgorithm,
		theme
	}), [layoutAlgorithm, theme]);

	// Default theme
	const defaultTheme = useMemo<GraphTheme>(() => ({
		colors: {
			background: '#1e1e1e',
			nodes: {
				class: '#4A90E2',
				function: '#50C878',
				method: '#32CD32',
				interface: '#9370DB',
				variable: '#FF6347',
				property: '#FF8C00',
				module: '#2E8B57',
				enum: '#4682B4',
				namespace: '#6A5ACD'
			},
			edges: {
				calls: '#666',
				extends: '#4A90E2',
				implements: '#9370DB',
				imports: '#50C878',
				references: '#FF6347',
				defines: '#FF8C00',
				uses: '#32CD32'
			},
			text: '#cccccc',
			highlight: '#007ACC',
			selection: '#007ACC'
		},
		sizes: {
			nodes: {
				class: 60,
				function: 50,
				method: 45,
				interface: 55,
				variable: 40,
				property: 35,
				module: 65,
				enum: 50,
				namespace: 55
			},
			edges: {
				calls: 2,
				extends: 3,
				implements: 3,
				imports: 2,
				references: 1,
				defines: 2,
				uses: 2
			},
			text: {
				small: 10,
				normal: 12,
				large: 14
			}
		},
		opacity: {
			nodes: {
				normal: 1,
				faded: 0.3,
				highlighted: 1
			},
			edges: {
				normal: 0.6,
				faded: 0.2,
				highlighted: 1
			}
		}
	}), []);

	const currentTheme = theme || defaultTheme;

	// Loading state
	if (dataLoading && !data) {
		return (
			<div style={{
				width,
				height,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				backgroundColor: currentTheme.colors.background,
				color: currentTheme.colors.text
			}}>
				<div style={{ textAlign: 'center' }}>
					<div style={{ fontSize: '18px', marginBottom: '8px' }}>Loading Code Map...</div>
					<div style={{ fontSize: '14px', opacity: 0.7 }}>Analyzing your codebase</div>
				</div>
			</div>
		);
	}

	// Error state
	if (dataError || layoutError) {
		return (
			<div style={{
				width,
				height,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				backgroundColor: currentTheme.colors.background,
				color: '#ff6b6b'
			}}>
				<div style={{ textAlign: 'center' }}>
					<div style={{ fontSize: '18px', marginBottom: '8px' }}>Error Loading Code Map</div>
					<div style={{ fontSize: '14px', opacity: 0.7 }}>
						{dataError?.message || layoutError?.message || 'Unknown error occurred'}
					</div>
					<button
						onClick={() => refetch()}
						style={{
							marginTop: '16px',
							padding: '8px 16px',
							borderRadius: '4px',
							border: '1px solid #ff6b6b',
							backgroundColor: 'transparent',
							color: '#ff6b6b',
							cursor: 'pointer'
						}}
					>
						Retry
					</button>
				</div>
			</div>
		);
	}

	return (
		<div style={{
			width,
			height,
			display: 'flex',
			flexDirection: 'column',
			backgroundColor: currentTheme.colors.background,
			color: currentTheme.colors.text,
			fontFamily: 'var(--vscode-font-family)',
			position: 'relative'
		}}>
			{/* Toolbar */}
			<div className="codemap-toolbar" style={{
				display: 'flex',
				alignItems: 'center',
				padding: '8px 16px',
				backgroundColor: 'var(--vscode-editor-background)',
				borderBottom: '1px solid var(--vscode-panel-border)',
				gap: '12px',
				minHeight: '48px'
			}}>
				{/* Layout Algorithm Selector */}
				<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
					<label style={{ fontSize: '12px', fontWeight: 'bold' }}>Layout:</label>
					<select
						value={layoutAlgorithm}
						onChange={(e) => setLayoutAlgorithm(e.target.value as LayoutAlgorithm)}
						style={{
							padding: '4px 8px',
							borderRadius: '4px',
							border: '1px solid var(--vscode-input-border)',
							backgroundColor: 'var(--vscode-input-background)',
							color: 'var(--vscode-input-foreground)',
							fontSize: '12px'
						}}
					>
						<option value="force-directed">Force Directed</option>
						<option value="hierarchical">Hierarchical</option>
						<option value="clustered">Clustered</option>
						<option value="circular">Circular</option>
						<option value="grid">Grid</option>
					</select>
				</div>

				{/* Query Button */}
				<button
					onClick={() => setShowQueryBuilder(!showQueryBuilder)}
					style={{
						padding: '6px 12px',
						borderRadius: '4px',
						border: '1px solid var(--vscode-button-border)',
						backgroundColor: showQueryBuilder ? 'var(--vscode-button-background)' : 'transparent',
						color: 'var(--vscode-button-foreground)',
						cursor: 'pointer',
						fontSize: '12px'
					}}
				>
					🔍 Query
				</button>

				{/* Refresh Button */}
				<button
					onClick={() => refetch()}
					disabled={dataLoading}
					style={{
						padding: '6px 12px',
						borderRadius: '4px',
						border: '1px solid var(--vscode-button-border)',
						backgroundColor: 'transparent',
						color: 'var(--vscode-button-foreground)',
						cursor: dataLoading ? 'not-allowed' : 'pointer',
						fontSize: '12px'
					}}
				>
					🔄 Refresh
				</button>

				{/* Clear Selection */}
				<button
					onClick={clearSelection}
					disabled={selectedNodes.length === 0 && selectedEdges.length === 0}
					style={{
						padding: '6px 12px',
						borderRadius: '4px',
						border: '1px solid var(--vscode-button-border)',
						backgroundColor: 'transparent',
						color: 'var(--vscode-button-foreground)',
						cursor: selectedNodes.length === 0 && selectedEdges.length === 0 ? 'not-allowed' : 'pointer',
						fontSize: '12px'
					}}
				>
					✖ Clear Selection
				</button>

				{/* Stats */}
				<div style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--vscode-descriptionForeground)' }}>
					{data && (
						<span>
							{data.metadata.totalNodes} nodes, {data.metadata.totalEdges} edges
							{selectedNodes.length > 0 && ` • ${selectedNodes.length} selected`}
						</span>
					)}
				</div>
			</div>

			{/* Query Builder Panel */}
			{showQueryBuilder && (
				<div className="query-builder-panel" style={{
					position: 'absolute',
					top: '48px',
					left: '16px',
					right: '16px',
					zIndex: 1000,
					maxWidth: '600px',
					maxHeight: '400px',
					overflow: 'auto'
				}}>
					<QueryBuilder
						query={currentQuery}
						onQueryChange={handleQueryChange}
						onExecuteQuery={handleQueryExecute}
						placeholder="Search for symbols and relationships..."
					/>
				</div>
			)}

			{/* Main Content Area */}
			<div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
				{/* Graph Canvas */}
				<div style={{ flex: 1, position: 'relative' }}>
					{data && layout && (
						<GraphCanvas
							data={data}
							layout={layout}
							width={width - (showSymbolDetails ? 300 : 0)}
							height={height - 48}
							onNodeClick={handleNodeClick}
							onNodeDoubleClick={handleNodeDoubleClick}
							onEdgeClick={handleEdgeClick}
							theme={currentTheme}
							options={{
								showLabels: true,
								showEdges: true,
								showControls: false,
								enableZoom: true,
								enablePan: true,
								enableSelection: true,
								nodeSize: 50,
								edgeWidth: 2,
								labelSize: 12,
								animateTransitions: true,
								viewportCulling: true,
								levelOfDetail: true,
								maxFPS: 60
							}}
						/>
					)}
				</div>

				{/* Symbol Details Panel */}
				{showSymbolDetails && selectedSymbol && (
					<div className="symbol-details-panel" style={{
						width: '300px',
						borderLeft: '1px solid var(--vscode-panel-border)',
						backgroundColor: 'var(--vscode-editor-background)'
					}}>
						<div style={{
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'space-between',
							padding: '8px 12px',
							borderBottom: '1px solid var(--vscode-panel-border)',
							backgroundColor: 'var(--vscode-editor-background)'
						}}>
							<span style={{ fontWeight: 'bold', fontSize: '14px' }}>Symbol Details</span>
							<button
								onClick={() => setShowSymbolDetails(false)}
								style={{
									background: 'none',
									border: 'none',
									color: 'var(--vscode-icon-foreground)',
									cursor: 'pointer',
									fontSize: '16px',
									padding: '4px'
								}}
							>
								✖
							</button>
						</div>
						<div style={{ height: 'calc(100% - 41px)', overflow: 'auto' }}>
							<SymbolDetails
								symbol={selectedSymbol.symbol}
								onNavigateToSymbol={handleNavigateToSymbol}
								onShowReferences={handleShowReferences}
								onShowRelationships={handleShowRelationships}
							/>
						</div>
					</div>
				)}
			</div>

			{/* Performance Overlay (development only) */}
			{process.env.NODE_ENV === 'development' && (
				<div style={{
					position: 'absolute',
					bottom: '10px',
					right: '10px',
					backgroundColor: 'rgba(0, 0, 0, 0.8)',
					color: 'white',
					padding: '8px',
					borderRadius: '4px',
					fontSize: '11px',
					fontFamily: 'monospace',
					lineHeight: '1.3'
				}}>
					<div>Nodes: {data?.metadata.totalNodes || 0}</div>
					<div>Edges: {data?.metadata.totalEdges || 0}</div>
					<div>Selected: {selectedNodes.length}</div>
					<div>Layout: {layoutLoading ? 'Computing...' : `${Math.round((quality?.score || 0))}%`}</div>
					<div>FPS: 60 {/* Would be calculated */}</div>
				</div>
			)}
		</div>
	);
};