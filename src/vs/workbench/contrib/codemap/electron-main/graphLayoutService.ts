/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Your Company. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import {
	GraphData,
	GraphNode,
	GraphEdge,
	LayoutAlgorithm,
	LayoutOptions,
	LayoutResult,
	Viewport,
	CodemapError
} from '../common/codemapTypes.js';

export interface IGraphLayoutService {
	// Layout computation
	computeLayout(data: GraphData, algorithm: LayoutAlgorithm, options: LayoutOptions): Promise<LayoutResult>;
	computeIncrementalLayout(data: GraphData, previousResult: LayoutResult, changedNodes: string[]): Promise<LayoutResult>;

	// Layout utilities
	getNodeBounds(nodes: GraphNode[]): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
	fitToViewport(nodes: GraphNode[], viewport: Viewport): { scale: number; offsetX: number; offsetY: number };
	zoomToNode(node: GraphNode, viewport: Viewport): { scale: number; offsetX: number; offsetY: number };

	// Layout quality
	analyzeLayoutQuality(result: LayoutResult): {
		score: number;
		issues: string[];
		suggestions: string[];
	};
	optimizeLayout(result: LayoutResult, iterations: number): Promise<LayoutResult>;

	// Events
	onLayoutComputed: EventEmitter<{ algorithm: LayoutAlgorithm; result: LayoutResult; computeTime: number }>;

	// Lifecycle
	dispose(): void;
}

export class GraphLayoutService extends Disposable implements IGraphLayoutService {
	public readonly onLayoutComputed = this._disposables.add(new EventEmitter<{ algorithm: LayoutAlgorithm; result: LayoutResult; computeTime: number }>());

	private readonly defaultOptions: LayoutOptions = {
		width: 1000,
		height: 800,
		nodeSpacing: 100,
		iterations: 100,
		gravity: 0.1,
		charge: -300,
		linkDistance: 100,
		linkStrength: 1,
		damping: 0.9,
		velocityDecay: 0.8,
		clustering: {
			enabled: false,
			clusterDistance: 200,
			preventOverlap: true
		}
	};

	constructor(@ILogService private readonly logService: ILogService) {
		super();
		this.logService.debug('[Codemap] GraphLayoutService initialized');
	}

	async computeLayout(data: GraphData, algorithm: LayoutAlgorithm, options: Partial<LayoutOptions> = {}): Promise<LayoutResult> {
		const startTime = Date.now();
		const mergedOptions = { ...this.defaultOptions, ...options };

		this.logService.debug(`[Codemap] Computing ${algorithm} layout for ${data.nodes.length} nodes, ${data.edges.length} edges`);

		try {
			let result: LayoutResult;

			switch (algorithm) {
				case LayoutAlgorithm.FORCE_DIRECTED:
					result = await this.computeForceDirectedLayout(data, mergedOptions);
					break;
				case LayoutAlgorithm.HIERARCHICAL:
					result = await this.computeHierarchicalLayout(data, mergedOptions);
					break;
				case LayoutAlgorithm.CLUSTERED:
					result = await this.computeClusteredLayout(data, mergedOptions);
					break;
				case LayoutAlgorithm.CIRCULAR:
					result = await this.computeCircularLayout(data, mergedOptions);
					break;
				case LayoutAlgorithm.GRID:
					result = await this.computeGridLayout(data, mergedOptions);
					break;
				case LayoutAlgorithm.RANDOM:
					result = await this.computeRandomLayout(data, mergedOptions);
					break;
				default:
					throw new CodemapError(`Unknown layout algorithm: ${algorithm}`, 'UNKNOWN_ALGORITHM');
			}

			const computeTime = Date.now() - startTime;

			// Ensure nodes are within bounds
			this.normalizeLayout(result, mergedOptions);

			this.onLayoutComputed.fire({ algorithm, result, computeTime });
			this.logService.debug(`[Codemap] ${algorithm} layout computed in ${computeTime}ms, converged: ${result.converged}`);

			return result;

		} catch (error) {
			const computeTime = Date.now() - startTime;
			this.logService.error(`[Codemap] Layout computation failed after ${computeTime}ms:`, error);
			throw new CodemapError(
				`Layout computation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
				'LAYOUT_COMPUTATION_FAILED',
				{ algorithm, data, error }
			);
		}
	}

	async computeIncrementalLayout(data: GraphData, previousResult: LayoutResult, changedNodes: string[]): Promise<LayoutResult> {
		this.logService.debug(`[Codemap] Computing incremental layout for ${changedNodes.length} changed nodes`);

		try {
			// Create a copy of the previous result
			const result: LayoutResult = {
				nodes: previousResult.nodes.map(node => ({ ...node })),
				edges: previousResult.edges.map(edge => ({ ...edge })),
				algorithm: previousResult.algorithm,
				options: previousResult.options,
				computeTime: 0,
				iterations: 0,
				converged: true
			};

			// Find affected nodes (changed nodes + their neighbors)
			const affectedNodes = new Set<string>(changedNodes);
			for (const edge of data.edges) {
				if (changedNodes.includes(edge.source) || changedNodes.includes(edge.target)) {
					affectedNodes.add(edge.source);
					affectedNodes.add(edge.target);
				}
			}

			// Recompute positions for affected nodes
			const affectedNodeObjects = result.nodes.filter(node => affectedNodes.has(node.id));
			const unaffectedNodes = result.nodes.filter(node => !affectedNodes.has(node.id));

			if (affectedNodeObjects.length > 0) {
				// Create subgraph with affected nodes
				const subgraphData: GraphData = {
					nodes: affectedNodeObjects,
					edges: result.edges.filter(edge =>
						affectedNodes.has(edge.source) && affectedNodes.has(edge.target)
					),
					metadata: data.metadata
				};

				// Compute layout for subgraph
				const subgraphOptions = {
					...previousResult.options,
					iterations: 50 // Fewer iterations for incremental update
				};

				const subgraphResult = await this.computeForceDirectedLayout(subgraphData, subgraphOptions);

				// Update positions in main result
				for (const node of subgraphResult.nodes) {
					const mainNode = result.nodes.find(n => n.id === node.id);
					if (mainNode) {
						mainNode.x = node.x;
						mainNode.y = node.y;
						mainNode.vx = node.vx;
						mainNode.vy = node.vy;
					}
				}
			}

			result.computeTime = Date.now() - Date.now(); // Will be set by caller
			this.logService.debug(`[Codemap] Incremental layout completed`);

			return result;

		} catch (error) {
			this.logService.error('[Codemap] Incremental layout computation failed:', error);
			throw new CodemapError(
				`Incremental layout computation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
				'INCREMENTAL_LAYOUT_FAILED',
				{ data, previousResult, changedNodes, error }
			);
		}
	}

	getNodeBounds(nodes: GraphNode[]): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } {
		if (nodes.length === 0) {
			return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
		}

		let minX = Infinity, minY = Infinity;
		let maxX = -Infinity, maxY = -Infinity;

		for (const node of nodes) {
			const x = node.x || 0;
			const y = node.y || 0;
			const size = node.size || 50;

			minX = Math.min(minX, x - size / 2);
			minY = Math.min(minY, y - size / 2);
			maxX = Math.max(maxX, x + size / 2);
			maxY = Math.max(maxY, y + size / 2);
		}

		return {
			minX,
			minY,
			maxX,
			maxY,
			width: maxX - minX,
			height: maxY - minY
		};
	}

	fitToViewport(nodes: GraphNode[], viewport: Viewport): { scale: number; offsetX: number; offsetY: number } {
		const bounds = this.getNodeBounds(nodes);
		const padding = 50;

		const requiredWidth = bounds.width + padding * 2;
		const requiredHeight = bounds.height + padding * 2;

		const scaleX = viewport.width / requiredWidth;
		const scaleY = viewport.height / requiredHeight;
		const scale = Math.min(scaleX, scaleY, 2); // Limit max zoom to 2x

		const offsetX = viewport.left + (viewport.width - bounds.width * scale) / 2 - bounds.minX * scale;
		const offsetY = viewport.top + (viewport.height - bounds.height * scale) / 2 - bounds.minY * scale;

		return { scale, offsetX, offsetY };
	}

	zoomToNode(node: GraphNode, viewport: Viewport): { scale: number; offsetX: number; offsetY: number } {
		const nodeSize = node.size || 50;
		const padding = 100;

		const requiredWidth = nodeSize + padding * 2;
		const requiredHeight = nodeSize + padding * 2;

		const scaleX = viewport.width / requiredWidth;
		const scaleY = viewport.height / requiredHeight;
		const scale = Math.min(scaleX, scaleY, 3); // Limit max zoom to 3x for individual nodes

		const nodeX = node.x || 0;
		const nodeY = node.y || 0;

		const offsetX = viewport.left + viewport.width / 2 - nodeX * scale;
		const offsetY = viewport.top + viewport.height / 2 - nodeY * scale;

		return { scale, offsetX, offsetY };
	}

	analyzeLayoutQuality(result: LayoutResult): {
		score: number;
		issues: string[];
		suggestions: string[];
	} {
		const issues: string[] = [];
		const suggestions: string[] = [];
		let score = 100;

		// Check for node overlaps
		const overlapCount = this.countNodeOverlaps(result.nodes);
		if (overlapCount > 0) {
			issues.push(`${overlapCount} node overlaps detected`);
			suggestions.push('Increase node spacing or use hierarchical layout');
			score -= overlapCount * 2;
		}

		// Check for edge crossings (simplified)
		const crossingCount = this.countEdgeCrossings(result.nodes, result.edges);
		if (crossingCount > result.edges.length * 0.5) {
			issues.push('High number of edge crossings');
			suggestions.push('Try hierarchical or clustered layout');
			score -= crossingCount * 0.5;
		}

		// Check for node distribution
		const bounds = this.getNodeBounds(result.nodes);
		const area = bounds.width * bounds.height;
		const expectedArea = result.nodes.length * 10000; // 100x100 pixels per node
		if (area > expectedArea * 3) {
			issues.push('Nodes are too spread out');
			suggestions.push('Increase link strength or gravity');
			score -= 10;
		}

		// Check convergence
		if (!result.converged) {
			issues.push('Layout did not converge');
			suggestions.push('Increase iterations or adjust forces');
			score -= 20;
		}

		return {
			score: Math.max(0, score),
			issues,
			suggestions
		};
	}

	async optimizeLayout(result: LayoutResult, iterations: number): Promise<LayoutResult> {
		this.logService.debug(`[Codemap] Optimizing layout with ${iterations} iterations`);

		const optimizedResult: LayoutResult = {
			...result,
			nodes: result.nodes.map(node => ({ ...node })),
			options: {
				...result.options,
				iterations: iterations
			}
		};

		// Create graph data from result
		const graphData: GraphData = {
			nodes: optimizedResult.nodes,
			edges: optimizedResult.edges,
			metadata: {
				totalNodes: optimizedResult.nodes.length,
				totalEdges: optimizedResult.edges.length,
				lastUpdated: Date.now(),
				scope: { path: '' },
				layoutAlgorithm: result.algorithm
			}
		};

		// Re-run layout with more iterations
		const data = this.computeForceDirectedLayout(graphData, optimizedResult.options);

		return {
			...optimizedResult,
			nodes: data.nodes,
			edges: data.edges,
			converged: data.converged,
			computeTime: data.computeTime,
			iterations: data.iterations
		};
	}

	// Private layout algorithm implementations

	private async computeForceDirectedLayout(data: GraphData, options: LayoutOptions): Promise<LayoutResult> {
		const nodes = [...data.nodes];
		const edges = [...data.edges];

		// Initialize positions if not set
		for (const node of nodes) {
			if (node.x === undefined) node.x = Math.random() * options.width;
			if (node.y === undefined) node.y = Math.random() * options.height;
			if (node.vx === undefined) node.vx = 0;
			if (node.vy === undefined) node.vy = 0;
		}

		// Build adjacency map for faster lookup
		const adjacencyMap = new Map<string, string[]>();
		for (const edge of edges) {
			if (!adjacencyMap.has(edge.source)) {
				adjacencyMap.set(edge.source, []);
			}
			if (!adjacencyMap.has(edge.target)) {
				adjacencyMap.set(edge.target, []);
			}
			adjacencyMap.get(edge.source)!.push(edge.target);
			adjacencyMap.get(edge.target)!.push(edge.source);
		}

		let converged = false;
		let iteration = 0;

		while (iteration < options.iterations && !converged) {
			let maxVelocity = 0;

			// Apply forces to each node
			for (const node of nodes) {
				if (node.fx !== undefined && node.fy !== undefined) {
					// Fixed position node
					continue;
				}

				let fx = 0;
				let fy = 0;

				// Repulsive forces between all nodes
				for (const other of nodes) {
					if (node === other) continue;

					const dx = (node.x || 0) - (other.x || 0);
					const dy = (node.y || 0) - (other.y || 0);
					const distance = Math.sqrt(dx * dx + dy * dy) || 1;

					if (distance < options.nodeSpacing * 2) {
						const force = options.charge / (distance * distance);
						fx += (dx / distance) * force;
						fy += (dy / distance) * force;
					}
				}

				// Attractive forces for connected nodes
				const neighbors = adjacencyMap.get(node.id) || [];
				for (const neighborId of neighbors) {
					const neighbor = nodes.find(n => n.id === neighborId);
					if (!neighbor) continue;

					const dx = (neighbor.x || 0) - (node.x || 0);
					const dy = (neighbor.y || 0) - (node.y || 0);
					const distance = Math.sqrt(dx * dx + dy * dy) || 1;

					const force = options.linkStrength * (distance - options.linkDistance);
					fx += (dx / distance) * force;
					fy += (dy / distance) * force;
				}

				// Gravity towards center
				const centerX = options.width / 2;
				const centerY = options.height / 2;
				fx += (centerX - (node.x || 0)) * options.gravity;
				fy += (centerY - (node.y || 0)) * options.gravity;

				// Update velocity
				node.vx = (node.vx || 0) * options.damping + fx;
				node.vy = (node.vy || 0) * options.damping + fy;

				// Limit maximum velocity
				const maxSpeed = 50;
				const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
				if (speed > maxSpeed) {
					node.vx = (node.vx / speed) * maxSpeed;
					node.vy = (node.vy / speed) * maxSpeed;
				}

				maxVelocity = Math.max(maxVelocity, speed);
			}

			// Update positions
			for (const node of nodes) {
				if (node.fx === undefined) {
					node.x = (node.x || 0) + (node.vx || 0);
					// Keep within bounds
					node.x = Math.max(50, Math.min(options.width - 50, node.x || 0));
				}

				if (node.fy === undefined) {
					node.y = (node.y || 0) + (node.vy || 0);
					// Keep within bounds
					node.y = Math.max(50, Math.min(options.height - 50, node.y || 0));
				}

				// Apply velocity decay
				node.vx = (node.vx || 0) * options.velocityDecay;
				node.vy = (node.vy || 0) * options.velocityDecay;
			}

			// Check for convergence
			if (maxVelocity < 0.1) {
				converged = true;
			}

			iteration++;
		}

		return {
			nodes,
			edges,
			algorithm: LayoutAlgorithm.FORCE_DIRECTED,
			options,
			computeTime: 0, // Will be set by caller
			iterations: iteration,
			converged
		};
	}

	private async computeHierarchicalLayout(data: GraphData, options: LayoutOptions): Promise<LayoutResult> {
		const nodes = [...data.nodes];
		const edges = [...data.edges];

		// Build hierarchy levels
		const levels = this.buildHierarchyLevels(nodes, edges);

		const nodeSpacing = options.nodeSpacing;
		const levelSpacing = options.width / (levels.length + 1);

		// Position nodes by level
		for (let levelIndex = 0; levelIndex < levels.length; levelIndex++) {
			const level = levels[levelIndex];
			const y = levelSpacing * (levelIndex + 1);

			const startX = (options.width - level.length * nodeSpacing) / 2;

			for (let nodeIndex = 0; nodeIndex < level.length; nodeIndex++) {
				const node = level[nodeIndex];
				node.x = startX + nodeIndex * nodeSpacing;
				node.y = y;
				node.vx = 0;
				node.vy = 0;
			}
		}

		return {
			nodes,
			edges,
			algorithm: LayoutAlgorithm.HIERARCHICAL,
			options,
			computeTime: 0,
			iterations: 1,
			converged: true
		};
	}

	private async computeClusteredLayout(data: GraphData, options: LayoutOptions): Promise<LayoutResult> {
		const nodes = [...data.nodes];
		const edges = [...data.edges];

		// Identify clusters
		const clusters = this.identifyClusters(nodes, edges);

		const clusterSpacing = Math.max(options.width, options.height) / (Math.sqrt(clusters.length) + 1);

		// Position clusters in a grid
		let clusterX = clusterSpacing;
		let clusterY = clusterSpacing;

		for (const cluster of clusters) {
			// Layout nodes within cluster using force-directed
			const clusterBounds = {
				x: clusterX,
				y: clusterY,
				width: clusterSpacing - 50,
				height: clusterSpacing - 50
			};

			await this.layoutCluster(cluster, clusterBounds);

			clusterX += clusterSpacing;
			if (clusterX > options.width - clusterSpacing) {
				clusterX = clusterSpacing;
				clusterY += clusterSpacing;
			}
		}

		return {
			nodes,
			edges,
			algorithm: LayoutAlgorithm.CLUSTERED,
			options,
			computeTime: 0,
			iterations: 1,
			converged: true
		};
	}

	private async computeCircularLayout(data: GraphData, options: LayoutOptions): Promise<LayoutResult> {
		const nodes = [...data.nodes];
		const edges = [...data.edges];

		const centerX = options.width / 2;
		const centerY = options.height / 2;
		const radius = Math.min(options.width, options.height) / 2 - 100;

		const angleStep = (2 * Math.PI) / nodes.length;

		for (let i = 0; i < nodes.length; i++) {
			const angle = i * angleStep;
			nodes[i].x = centerX + radius * Math.cos(angle);
			nodes[i].y = centerY + radius * Math.sin(angle);
			nodes[i].vx = 0;
			nodes[i].vy = 0;
		}

		return {
			nodes,
			edges,
			algorithm: LayoutAlgorithm.CIRCULAR,
			options,
			computeTime: 0,
			iterations: 1,
			converged: true
		};
	}

	private async computeGridLayout(data: GraphData, options: LayoutOptions): Promise<LayoutResult> {
		const nodes = [...data.nodes];
		const edges = [...data.edges];

		const cols = Math.ceil(Math.sqrt(nodes.length));
		const rows = Math.ceil(nodes.length / cols);

		const cellWidth = options.width / cols;
		const cellHeight = options.height / rows;

		for (let i = 0; i < nodes.length; i++) {
			const row = Math.floor(i / cols);
			const col = i % cols;

			nodes[i].x = col * cellWidth + cellWidth / 2;
			nodes[i].y = row * cellHeight + cellHeight / 2;
			nodes[i].vx = 0;
			nodes[i].vy = 0;
		}

		return {
			nodes,
			edges,
			algorithm: LayoutAlgorithm.GRID,
			options,
			computeTime: 0,
			iterations: 1,
			converged: true
		};
	}

	private async computeRandomLayout(data: GraphData, options: LayoutOptions): Promise<LayoutResult> {
		const nodes = [...data.nodes];
		const edges = [...data.edges];

		const margin = 100;

		for (const node of nodes) {
			node.x = margin + Math.random() * (options.width - 2 * margin);
			node.y = margin + Math.random() * (options.height - 2 * margin);
			node.vx = 0;
			node.vy = 0;
		}

		return {
			nodes,
			edges,
			algorithm: LayoutAlgorithm.RANDOM,
			options,
			computeTime: 0,
			iterations: 1,
			converged: true
		};
	}

	// Helper methods

	private buildHierarchyLevels(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[][] {
		const levels: GraphNode[][] = [];
		const visited = new Set<string>();
		const inDegree = new Map<string, number>();

		// Calculate in-degree for each node
		for (const node of nodes) {
			inDegree.set(node.id, 0);
		}

		for (const edge of edges) {
			inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
		}

		// Build levels using topological sort
		const queue: string[] = [];
		for (const node of nodes) {
			if ((inDegree.get(node.id) || 0) === 0) {
				queue.push(node.id);
			}
		}

		while (queue.length > 0) {
			const currentLevel: GraphNode[] = [];
			const levelSize = queue.length;

			for (let i = 0; i < levelSize; i++) {
				const nodeId = queue.shift()!;
				const node = nodes.find(n => n.id === nodeId);
				if (node && !visited.has(nodeId)) {
					currentLevel.push(node);
					visited.add(nodeId);

					// Add neighbors to queue
					for (const edge of edges) {
						if (edge.source === nodeId) {
							const targetInDegree = (inDegree.get(edge.target) || 0) - 1;
							inDegree.set(edge.target, targetInDegree);
							if (targetInDegree === 0) {
								queue.push(edge.target);
							}
						}
					}
				}
			}

			if (currentLevel.length > 0) {
				levels.push(currentLevel);
			}
		}

		// Add any remaining nodes
		const remaining = nodes.filter(n => !visited.has(n.id));
		if (remaining.length > 0) {
			levels.push(remaining);
		}

		return levels;
	}

	private identifyClusters(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[][] {
		const clusters: GraphNode[][] = [];
		const visited = new Set<string>();

		// Simple connected components identification
		for (const node of nodes) {
			if (visited.has(node.id)) continue;

			const cluster: GraphNode[] = [];
			const stack = [node.id];

			while (stack.length > 0) {
				const nodeId = stack.pop()!;
				if (visited.has(nodeId)) continue;

				visited.add(nodeId);
				const currentNode = nodes.find(n => n.id === nodeId);
				if (currentNode) {
					cluster.push(currentNode);
				}

				// Find neighbors
				for (const edge of edges) {
					if (edge.source === nodeId && !visited.has(edge.target)) {
						stack.push(edge.target);
					} else if (edge.target === nodeId && !visited.has(edge.source)) {
						stack.push(edge.source);
					}
				}
			}

			if (cluster.length > 0) {
				clusters.push(cluster);
			}
		}

		return clusters;
	}

	private async layoutCluster(cluster: GraphNode[], bounds: { x: number; y: number; width: number; height: number }): Promise<void> {
		const clusterData: GraphData = {
			nodes: cluster,
			edges: [],
			metadata: {
				totalNodes: cluster.length,
				totalEdges: 0,
				lastUpdated: Date.now(),
				scope: { path: '' },
				layoutAlgorithm: LayoutAlgorithm.FORCE_DIRECTED
			}
		};

		const options: LayoutOptions = {
			width: bounds.width,
			height: bounds.height,
			nodeSpacing: 50,
			iterations: 50,
			gravity: 0.1,
			charge: -100,
			linkDistance: 50,
			linkStrength: 1,
			damping: 0.9,
			velocityDecay: 0.8
		};

		const result = await this.computeForceDirectedLayout(clusterData, options);

		// Offset positions to cluster bounds
		for (const node of result.nodes) {
			node.x = (node.x || 0) + bounds.x;
			node.y = (node.y || 0) + bounds.y;
		}
	}

	private normalizeLayout(result: LayoutResult, options: LayoutOptions): void {
		const bounds = this.getNodeBounds(result.nodes);
		const padding = 50;

		const scaleX = (options.width - 2 * padding) / (bounds.width || 1);
		const scaleY = (options.height - 2 * padding) / (bounds.height || 1);
		const scale = Math.min(scaleX, scaleY, 2); // Limit max scale

		const offsetX = padding - bounds.minX * scale;
		const offsetY = padding - bounds.minY * scale;

		for (const node of result.nodes) {
			if (node.fx === undefined) {
				node.x = ((node.x || 0) - bounds.minX) * scale + offsetX;
			}
			if (node.fy === undefined) {
				node.y = ((node.y || 0) - bounds.minY) * scale + offsetY;
			}
		}
	}

	private countNodeOverlaps(nodes: GraphNode[]): number {
		let overlapCount = 0;
		const nodeSize = 50; // Default node size

		for (let i = 0; i < nodes.length; i++) {
			for (let j = i + 1; j < nodes.length; j++) {
				const node1 = nodes[i];
				const node2 = nodes[j];

				const dx = (node1.x || 0) - (node2.x || 0);
				const dy = (node1.y || 0) - (node2.y || 0);
				const distance = Math.sqrt(dx * dx + dy * dy);

				if (distance < nodeSize) {
					overlapCount++;
				}
			}
		}

		return overlapCount;
	}

	private countEdgeCrossings(nodes: GraphNode[], edges: GraphEdge[]): number {
		let crossingCount = 0;

		for (let i = 0; i < edges.length; i++) {
			for (let j = i + 1; j < edges.length; j++) {
				const edge1 = edges[i];
				const edge2 = edges[j];

				// Skip edges that share a node
				if (edge1.source === edge2.source || edge1.source === edge2.target ||
					edge1.target === edge2.source || edge1.target === edge2.target) {
					continue;
				}

				const node1 = nodes.find(n => n.id === edge1.source);
				const node2 = nodes.find(n => n.id === edge1.target);
				const node3 = nodes.find(n => n.id === edge2.source);
				const node4 = nodes.find(n => n.id === edge2.target);

				if (node1 && node2 && node3 && node4) {
					if (this.doEdgesIntersect(
						{ x: node1.x || 0, y: node1.y || 0 },
						{ x: node2.x || 0, y: node2.y || 0 },
						{ x: node3.x || 0, y: node3.y || 0 },
						{ x: node4.x || 0, y: node4.y || 0 }
					)) {
						crossingCount++;
					}
				}
			}
		}

		return crossingCount;
	}

	private doEdgesIntersect(p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }, p4: { x: number; y: number }): boolean {
		const denom = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
		if (Math.abs(denom) < 1e-10) return false; // Parallel lines

		const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denom;
		const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denom;

		return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
	}

	override dispose(): void {
		super.dispose();
	}
}