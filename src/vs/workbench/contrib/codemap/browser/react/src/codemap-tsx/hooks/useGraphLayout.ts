/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Your Company. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState, useCallback, useRef } from 'react';
import {
	GraphData,
	LayoutResult,
	LayoutAlgorithm,
	LayoutOptions,
	Viewport
} from '../../types/index.js';
import { codemapService } from '../services/codemapService.js';

export interface UseGraphLayoutOptions {
	defaultAlgorithm?: LayoutAlgorithm;
	defaultOptions?: Partial<LayoutOptions>;
	enableAutoQuality?: boolean;
	qualityThreshold?: number;
	onLayoutComputed?: (result: LayoutResult) => void;
	onQualityUpdate?: (quality: any) => void;
}

export function useGraphLayout(options: UseGraphLayoutOptions = {}) {
	const {
		defaultAlgorithm = LayoutAlgorithm.FORCE_DIRECTED,
		defaultOptions = {},
		enableAutoQuality = true,
		qualityThreshold = 80,
		onLayoutComputed,
		onQualityUpdate
	} = options;

	const [layout, setLayout] = useState<LayoutResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<Error | null>(null);
	const [quality, setQuality] = useState<any>(null);

	const abortControllerRef = useRef<AbortController | null>(null);
	const currentDataRef = useRef<GraphData | null>(null);

	// Default layout options
	const mergedDefaultOptions: LayoutOptions = {
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
		},
		...defaultOptions
	};

	// Compute layout
	const computeLayout = useCallback(async (
		data: GraphData,
		algorithm: LayoutAlgorithm = defaultAlgorithm,
		options?: Partial<LayoutOptions>
	) => {
		if (!data || data.nodes.length === 0) {
			setLayout(null);
			return;
		}

		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
		}

		const abortController = new AbortController();
		abortControllerRef.current = abortController;

		try {
			setLoading(true);
			setError(null);

			const mergedOptions = { ...mergedDefaultOptions, ...options };

			// Adjust options based on data size
			if (data.nodes.length > 500) {
				mergedOptions.iterations = Math.min(mergedOptions.iterations, 50);
				mergedOptions.charge = mergedOptions.charge * 0.5;
			}

			const result = await codemapService.getLayout?.(data, algorithm, mergedOptions);

			if (abortController.signal.aborted) {
				return;
			}

			if (result) {
				setLayout(result);
				currentDataRef.current = data;
				onLayoutComputed?.(result);

				// Analyze layout quality if enabled
				if (enableAutoQuality) {
					const qualityResult = await analyzeLayoutQuality(result);
					setQuality(qualityResult);
					onQualityUpdate?.(qualityResult);

					// Auto-optimize if quality is below threshold
					if (qualityResult.score < qualityThreshold && qualityResult.suggestions.length > 0) {
						await optimizeLayout(5);
					}
				}
			}

		} catch (err) {
			if (abortController.signal.aborted) {
				return;
			}

			const error = err instanceof Error ? err : new Error('Layout computation failed');
			setError(error);
		} finally {
			if (!abortController.signal.aborted) {
				setLoading(false);
			}
		}
	}, [defaultAlgorithm, mergedDefaultOptions, enableAutoQuality, qualityThreshold, onLayoutComputed, onQualityUpdate]);

	// Analyze layout quality
	const analyzeLayoutQuality = useCallback(async (layoutResult: LayoutResult) => {
		try {
			const quality = await codemapService.analyzeLayoutQuality?.(layoutResult);
			return quality || {
				score: 0,
				issues: ['Quality analysis not available'],
				suggestions: []
			};
		} catch (err) {
			console.warn('Failed to analyze layout quality:', err);
			return {
				score: 50,
				issues: ['Could not analyze quality'],
				suggestions: []
			};
		}
	}, []);

	// Optimize layout
	const optimizeLayout = useCallback(async (additionalIterations: number = 10) => {
		if (!layout || !currentDataRef.current) {
			return;
		}

		try {
			setLoading(true);

			const optimizedResult = await codemapService.optimizeLayout?.(layout, additionalIterations);

			if (optimizedResult) {
				setLayout(optimizedResult);
				onLayoutComputed?.(optimizedResult);

				// Re-analyze quality
				if (enableAutoQuality) {
					const qualityResult = await analyzeLayoutQuality(optimizedResult);
					setQuality(qualityResult);
					onQualityUpdate?.(qualityResult);
				}
			}

		} catch (err) {
			console.warn('Failed to optimize layout:', err);
		} finally {
			setLoading(false);
		}
	}, [layout, enableAutoQuality, onLayoutComputed, analyzeLayoutQuality]);

	// Compute incremental layout
	const computeIncrementalLayout = useCallback(async (
		updatedData: GraphData,
		changedNodes: string[]
	) => {
		if (!layout || !currentDataRef.current) {
			return computeLayout(updatedData);
		}

		try {
			setLoading(true);
			setError(null);

			const result = await codemapService.computeIncrementalLayout?.(updatedData, layout, changedNodes);

			if (result) {
				setLayout(result);
				currentDataRef.current = updatedData;
				onLayoutComputed?.(result);
			}

		} catch (err) {
			// Fallback to full layout
			console.warn('Incremental layout failed, falling back to full layout:', err);
			await computeLayout(updatedData);
		} finally {
			setLoading(false);
		}
	}, [layout, computeLayout, onLayoutComputed]);

	// Get layout bounds
	const getLayoutBounds = useCallback(() => {
		if (!layout || layout.nodes.length === 0) {
			return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
		}

		let minX = Infinity, minY = Infinity;
		let maxX = -Infinity, maxY = -Infinity;

		for (const node of layout.nodes) {
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
	}, [layout]);

	// Fit to viewport
	const fitToViewport = useCallback((viewport: Viewport) => {
		if (!layout) {
			return { scale: 1, offsetX: 0, offsetY: 0 };
		}

		const bounds = getLayoutBounds();
		const padding = 50;

		const requiredWidth = bounds.width + padding * 2;
		const requiredHeight = bounds.height + padding * 2;

		const scaleX = viewport.width / requiredWidth;
		const scaleY = viewport.height / requiredHeight;
		const scale = Math.min(scaleX, scaleY, 2);

		const offsetX = viewport.left + (viewport.width - bounds.width * scale) / 2 - bounds.minX * scale;
		const offsetY = viewport.top + (viewport.height - bounds.height * scale) / 2 - bounds.minY * scale;

		return { scale, offsetX, offsetY };
	}, [layout, getLayoutBounds]);

	// Zoom to node
	const zoomToNode = useCallback((nodeId: string, viewport: Viewport) => {
		if (!layout) {
			return { scale: 1, offsetX: 0, offsetY: 0 };
		}

		const node = layout.nodes.find(n => n.id === nodeId);
		if (!node) {
			return fitToViewport(viewport);
		}

		const nodeSize = node.size || 50;
		const padding = 100;

		const requiredWidth = nodeSize + padding * 2;
		const requiredHeight = nodeSize + padding * 2;

		const scaleX = viewport.width / requiredWidth;
		const scaleY = viewport.height / requiredHeight;
		const scale = Math.min(scaleX, scaleY, 3);

		const nodeX = node.x || 0;
		const nodeY = node.y || 0;

		const offsetX = viewport.left + viewport.width / 2 - nodeX * scale;
		const offsetY = viewport.top + viewport.height / 2 - nodeY * scale;

		return { scale, offsetX, offsetY };
	}, [layout, fitToViewport]);

	// Cleanup
	const cleanup = useCallback(() => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
		}
	}, []);

	return {
		layout,
		loading,
		error,
		quality,
		computeLayout,
		computeIncrementalLayout,
		optimizeLayout,
		analyzeLayoutQuality,
		getLayoutBounds,
		fitToViewport,
		zoomToNode,
		cleanup
	};
}

// Hook for layout algorithm management
export function useLayoutAlgorithms() {
	const [availableAlgorithms] = useState<LayoutAlgorithm[]>([
		LayoutAlgorithm.FORCE_DIRECTED,
		LayoutAlgorithm.HIERARCHICAL,
		LayoutAlgorithm.CLUSTERED,
		LayoutAlgorithm.CIRCULAR,
		LayoutAlgorithm.GRID,
		LayoutAlgorithm.RANDOM
	]);

	const getAlgorithmInfo = useCallback((algorithm: LayoutAlgorithm) => {
		const algorithmInfo = {
			[LayoutAlgorithm.FORCE_DIRECTED]: {
				name: 'Force-Directed',
				description: 'Physics-based layout that simulates attractive and repulsive forces',
				bestFor: ['General graphs', 'Network visualization', 'Social networks'],
				complexity: 'O(n²)',
				performance: 'Medium'
			},
			[LayoutAlgorithm.HIERARCHICAL]: {
				name: 'Hierarchical',
				description: 'Layers nodes in a hierarchical structure',
				bestFor: ['Class hierarchies', 'Organization charts', 'Dependency graphs'],
				complexity: 'O(n log n)',
				performance: 'Fast'
			},
			[LayoutAlgorithm.CLUSTERED]: {
				name: 'Clustered',
				description: 'Groups related nodes together in clusters',
				bestFor: ['Modular systems', 'Package diagrams', 'Component relationships'],
				complexity: 'O(n²)',
				performance: 'Medium'
			},
			[LayoutAlgorithm.CIRCULAR]: {
				name: 'Circular',
				description: 'Arranges nodes in a circular pattern',
				bestFor: ['Small graphs', 'Relationship maps', 'Cyclic dependencies'],
				complexity: 'O(n)',
				performance: 'Fast'
			},
			[LayoutAlgorithm.GRID]: {
				name: 'Grid',
				description: 'Organizes nodes in a regular grid pattern',
				bestFor: ['Large collections', 'Overview displays', 'Uniform layouts'],
				complexity: 'O(n)',
				performance: 'Fastest'
			},
			[LayoutAlgorithm.RANDOM]: {
				name: 'Random',
				description: 'Places nodes at random positions',
				bestFor: ['Initial layouts', 'Testing', 'Artistic effects'],
				complexity: 'O(n)',
				performance: 'Fastest'
			}
		};

		return algorithmInfo[algorithm] || {
			name: algorithm,
			description: 'Unknown algorithm',
			bestFor: [],
			complexity: 'Unknown',
			performance: 'Unknown'
		};
	}, []);

	const getRecommendedAlgorithm = useCallback((data: GraphData): LayoutAlgorithm => {
		const nodeCount = data.nodes.length;
		const edgeCount = data.edges.length;
		const density = edgeCount / (nodeCount * (nodeCount - 1));

		// Small dense graphs
		if (nodeCount < 50 && density > 0.3) {
			return LayoutAlgorithm.CIRCULAR;
		}

		// Large sparse graphs
		if (nodeCount > 500 && density < 0.1) {
			return LayoutAlgorithm.FORCE_DIRECTED;
		}

		// Hierarchical structures
		if (data.edges.some(e => e.relationship.type === 'extends' || e.relationship.type === 'implements')) {
			return LayoutAlgorithm.HIERARCHICAL;
		}

		// Clustered structures
		if (data.clusters && data.clusters.length > 0) {
			return LayoutAlgorithm.CLUSTERED;
		}

		// Default
		return LayoutAlgorithm.FORCE_DIRECTED;
	}, []);

	return {
		availableAlgorithms,
		getAlgorithmInfo,
		getRecommendedAlgorithm
	};
}