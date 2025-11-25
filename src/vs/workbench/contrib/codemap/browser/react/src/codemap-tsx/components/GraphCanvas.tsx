/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Your Company. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, {
 useRef,
	useEffect,
	useCallback,
	useMemo,
	useState
} from 'react';
import * as d3 from 'd3';
import {
	ReactGraphProps,
	GraphNode,
	GraphEdge,
	ViewportState,
	InteractionState,
	VisualizationOptions
} from '../types/index.js';
import { useSymbolSelection } from '../hooks/useSymbolSelection.js';
import { useViewport, useViewportControls } from '../hooks/useViewport.js';

const defaultOptions: VisualizationOptions = {
	showLabels: true,
	showEdges: true,
	showControls: true,
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
};

export const GraphCanvas: React.FC<ReactGraphProps> = ({
	data,
	layout,
	width,
	height,
	onNodeClick,
	onNodeDoubleClick,
	onNodeHover,
	onEdgeClick,
	onEdgeHover,
	onSelectionChange,
	theme,
	options = defaultOptions
}) => {
	const canvasRef = useRef<HTMLDivElement>(null);
	const svgRef = useRef<SVGSVGElement>(null);
	const simulationRef = useRef<d3.Simulation<GraphNode, GraphEdge> | null>(null);

	const [interactionState, setInteractionState] = useState<InteractionState>({
		selectedNodes: new Set(),
		selectedEdges: new Set(),
		hoveredNode: null,
		hoveredEdge: null,
		isDragging: false,
		isPanning: false,
		dragStart: null,
		panStart: null
	});

	const [viewport, setViewport] = useState<ViewportState>({
		x: 0,
		y: 0,
		zoom: 1,
		width,
		height
	});

	// Custom hooks
	const {
		selectedNodes,
		selectedEdges,
		selectNode,
		selectEdge,
		clearSelection
	} = useSymbolSelection({
		enableMultiSelect: true,
		onSelectionChange
	});

	const viewportManager = useViewport({
		width,
		height,
		minZoom: 0.1,
		maxZoom: 5,
		onViewportChange: setViewport
	});

	const { handleKeyDown, handleWheel } = useViewportControls(viewportManager);

	// Memoized visible nodes based on viewport culling
	const visibleNodes = useMemo(() => {
		if (!options.viewportCulling) return layout.nodes;

		const bounds = viewportManager.getVisibleBounds();
		const margin = 100; // Extra margin for smooth scrolling

		return layout.nodes.filter(node => {
			const x = node.x || 0;
			const y = node.y || 0;
			const size = node.size || options.nodeSize;

			return x + size / 2 >= bounds.minX - margin &&
				   x - size / 2 <= bounds.maxX + margin &&
				   y + size / 2 >= bounds.minY - margin &&
				   y - size / 2 <= bounds.maxY + margin;
		});
	}, [layout.nodes, options.viewportCulling, options.nodeSize, viewportManager]);

	// Memoized visible edges
	const visibleEdges = useMemo(() => {
		if (!options.showEdges) return [];

		const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
		return layout.edges.filter(edge =>
			visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
		);
	}, [layout.edges, visibleNodes, options.showEdges]);

	// D3 selection memoization
	const d3Selections = useMemo(() => {
		if (!svgRef.current) return null;

		const svg = d3.select(svgRef.current);
		const g = svg.select<SVGGElement>('g.main-group');

		return {
			svg,
			g,
			nodes: g.selectAll<SVGGElement, GraphNode>('.node'),
			edges: g.selectAll<SVGLineElement, GraphEdge>('.edge'),
			labels: g.selectAll<SVGTextElement, GraphNode>('.label')
		};
	}, [svgRef.current]);

	// Initialize D3 force simulation
	useEffect(() => {
		if (!data || !layout || !svgRef.current) return;

		// Clear previous simulation
		if (simulationRef.current) {
			simulationRef.current.stop();
		}

		// Create new simulation
		const simulation = d3.forceSimulation<GraphNode>(layout.nodes)
			.force('link', d3.forceLink<GraphNode, GraphEdge>(layout.edges)
				.id(d => d.id)
				.distance(d => d.strength ? 100 / d.strength : 100)
			)
			.force('charge', d3.forceManyBody().strength(-300))
			.force('center', d3.forceCenter(0, 0))
			.force('collision', d3.forceCollide<GraphNode>()
				.radius(d => (d.size || options.nodeSize) / 2 + 5)
			);

		// Use layout positions as starting positions
		layout.nodes.forEach((node, i) => {
			if (node.fx !== undefined) simulation.nodes()[i].fx = node.fx;
			if (node.fy !== undefined) simulation.nodes()[i].fy = node.fy;
		});

		simulationRef.current = simulation;

		// Setup tick handler
		simulation.on('tick', () => {
			if (d3Selections) {
				d3Selections.nodes
					.attr('transform', d => `translate(${d.x || 0}, ${d.y || 0})`);

				d3Selections.edges
					.attr('x1', d => {
						const source = d.source as GraphNode;
						return source.x || 0;
					})
					.attr('y1', d => {
						const source = d.source as GraphNode;
						return source.y || 0;
					})
					.attr('x2', d => {
						const target = d.target as GraphNode;
						return target.x || 0;
					})
					.attr('y2', d => {
						const target = d.target as GraphNode;
						return target.y || 0;
					});

				if (options.showLabels) {
					d3Selections.labels
						.attr('x', d => (d.x || 0) + (d.size || options.nodeSize) / 2 + 5)
						.attr('y', d => (d.y || 0) + 3);
				}
			}
		});

		return () => {
			simulation.stop();
		};
	}, [data, layout, d3Selections, options.nodeSize, options.showLabels]);

	// Render SVG elements
	useEffect(() => {
		if (!d3Selections) return;

		// Render edges
		const edgeSelection = d3Selections.g.selectAll<SVGLineElement, GraphEdge>('.edge')
			.data(visibleEdges, d => `${d.source}-${d.target}`);

		edgeSelection.exit().remove();

		const edgeEnter = edgeSelection.enter()
			.append('line')
			.attr('class', 'edge')
			.attr('stroke', d => {
				const colors = theme?.colors?.edges || {};
				return colors[d.relationship.type] || '#999';
			})
			.attr('stroke-width', d => {
				const widths = theme?.sizes?.edges || {};
				return (widths[d.relationship.type] || options.edgeWidth) * (d.strength || 1);
			})
			.attr('stroke-opacity', 0.6)
			.style('cursor', 'pointer')
			.on('click', (event, d) => {
				if (options.enableSelection) {
					selectEdge(d, event.shiftKey);
				}
				onEdgeClick?.(d);
			})
			.on('mouseenter', (event, d) => {
				setInteractionState(prev => ({ ...prev, hoveredEdge: `${d.source}-${d.target}` }));
				onEdgeHover?.(d);
			})
			.on('mouseleave', () => {
				setInteractionState(prev => ({ ...prev, hoveredEdge: null }));
				onEdgeHover?.(null);
			});

		// Render nodes
		const nodeSelection = d3Selections.g.selectAll<SVGGElement, GraphNode>('.node')
			.data(visibleNodes, d => d.id);

		nodeSelection.exit().remove();

		const nodeEnter = nodeSelection.enter()
			.append('g')
			.attr('class', 'node')
			.style('cursor', 'pointer')
			.call(d3.drag<SVGGElement, GraphNode>()
				.on('start', (event, d) => {
					if (!event.active && simulationRef.current) {
						simulationRef.current.alphaTarget(0.3).restart();
					}
					d.fx = d.x;
					d.fy = d.y;
					setInteractionState(prev => ({ ...prev, isDragging: true, dragStart: { x: event.x, y: event.y } }));
				})
				.on('drag', (event, d) => {
					d.fx = event.x;
					d.fy = event.y;
				})
				.on('end', (event, d) => {
					if (!event.active && simulationRef.current) {
						simulationRef.current.alphaTarget(0);
					}
					if (!event.sourceEvent.shiftKey) {
						d.fx = null;
						d.fy = null;
					}
					setInteractionState(prev => ({ ...prev, isDragging: false, dragStart: null }));
				})
			);

		// Add node circles
		nodeEnter.append('circle')
			.attr('r', d => (d.size || options.nodeSize) / 2)
			.attr('fill', d => {
				const colors = theme?.colors?.nodes || {};
				return colors[d.symbol.kind] || '#4A90E2';
			})
			.attr('stroke', d => {
				return selectedNodes.some(n => n.id === d.id) ?
					(theme?.colors?.selection || '#007ACC') : '#fff';
			})
			.attr('stroke-width', d => {
				return selectedNodes.some(n => n.id === d.id) ? 3 : 2;
			})
			.attr('stroke-opacity', 0.8);

		// Add node labels
		if (options.showLabels) {
			nodeEnter.append('text')
				.attr('class', 'label')
				.attr('dx', d => (d.size || options.nodeSize) / 2 + 5)
				.attr('dy', 3)
				.style('font-size', `${options.labelSize}px`)
				.style('font-family', 'var(--vscode-font-family)')
				.style('fill', 'var(--vscode-foreground)')
				.style('pointer-events', 'none')
				.text(d => d.symbol.name);
		}

		// Add event handlers
		nodeEnter
			.on('click', (event, d) => {
				if (options.enableSelection) {
					selectNode(d, event.shiftKey);
				}
				onNodeClick?.(d);
			})
			.on('dblclick', (event, d) => {
				onNodeDoubleClick?.(d);
			})
			.on('mouseenter', (event, d) => {
				setInteractionState(prev => ({ ...prev, hoveredNode: d.id }));
				onNodeHover?.(d);
			})
			.on('mouseleave', () => {
				setInteractionState(prev => ({ ...prev, hoveredNode: null }));
				onNodeHover?.(null);
			});

		// Update selections
		d3Selections.nodes = d3Selections.g.selectAll<SVGGElement, GraphNode>('.node');
		d3Selections.edges = d3Selections.g.selectAll<SVGLineElement, GraphEdge>('.edge');
		d3Selections.labels = d3Selections.g.selectAll<SVGTextElement, GraphNode>('.label');

	}, [
		visibleNodes,
		visibleEdges,
		selectedNodes,
		selectedEdges,
		options,
		theme,
		selectNode,
		selectEdge,
		onNodeClick,
		onNodeDoubleClick,
		onNodeHover,
		onEdgeClick,
		onEdgeHover,
		d3Selections
	]);

	// Update viewport transform
	useEffect(() => {
		if (!d3Selections) return;

		const transform = d3.zoomIdentity
			.translate(viewport.x, viewport.y)
			.scale(viewport.zoom);

		d3Selections.svg
			.select<SVGGElement>('g.viewport')
			.attr('transform', transform.toString());
	}, [viewport, d3Selections]);

	// Setup zoom behavior
	useEffect(() => {
		if (!svgRef.current || !options.enableZoom) return;

		const svg = d3.select(svgRef.current);
		const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
			.scaleExtent([0.1, 5])
			.on('zoom', (event) => {
				const { x, y, k } = event.transform;
				setViewport({
					x,
					y,
					zoom: k,
					width,
					height
				});
			});

		svg.call(zoomBehavior);

		return () => {
			svg.on('.zoom', null);
		};
	}, [svgRef.current, options.enableZoom, width, height]);

	// Keyboard event handlers
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			handleKeyDown(event);
		};

		const handleWheel = (event: WheelEvent) => {
			if (event.target === svgRef.current) {
				handleWheel(event);
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		window.addEventListener('wheel', handleWheel, { passive: false });

		return () => {
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('wheel', handleWheel);
		};
	}, [handleKeyDown, handleWheel]);

	return (
		<div
			ref={canvasRef}
			className="codemap-graph"
			style={{
				width: `${width}px`,
				height: `${height}px`,
				position: 'relative',
				overflow: 'hidden',
				backgroundColor: theme?.colors?.background || 'var(--vscode-editor-background)'
			}}
		>
			<svg
				ref={svgRef}
				width={width}
				height={height}
				style={{
					position: 'absolute',
					top: 0,
					left: 0,
					userSelect: 'none'
				}}
			>
				<defs>
					{/* Arrow markers for directed edges */}
					<marker
						id="arrowhead"
						viewBox="0 -5 10 10"
						refX="8"
						refY="0"
						markerWidth="6"
						markerHeight="6"
						orient="auto"
					>
						<path
							d="M0,-5L10,0L0,5"
							fill="#999"
							strokeOpacity={0.6}
						/>
					</marker>
				</defs>

				{/* Main viewport group */}
				<g className="viewport">
					{/* Main content group */}
					<g className="main-group">
						{/* Edges will be rendered here */}
						{/* Nodes will be rendered here */}
					</g>
				</g>
			</svg>

			{/* Overlay for controls */}
			{options.showControls && (
				<div className="codemap-controls-overlay">
					{/* Controls will be rendered here */}
				</div>
			)}

			{/* Performance overlay */}
			{process.env.NODE_ENV === 'development' && (
				<div className="codemap-performance-overlay" style={{
					position: 'absolute',
					top: 10,
					right: 10,
					background: 'rgba(0, 0, 0, 0.8)',
					color: 'white',
					padding: '8px',
					borderRadius: '4px',
					fontSize: '12px',
					fontFamily: 'monospace'
				}}>
					<div>Nodes: {visibleNodes.length} / {layout.nodes.length}</div>
					<div>Edges: {visibleEdges.length} / {layout.edges.length}</div>
					<div>Zoom: {viewport.zoom.toFixed(2)}</div>
					<div>FPS: 60 {/* Will be calculated */}</div>
				</div>
			)}
		</div>
	);
};