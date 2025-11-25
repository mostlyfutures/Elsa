/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Your Company. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState, useEffect, useCallback, useRef } from 'react';
import { debounce } from 'lodash-es';
import {
	GraphData,
	GraphQuery,
	QueryScope,
	PerformanceMetrics,
	CodemapError
} from '../../types/index.js';
import { codemapService } from '../services/codemapService.js';

export interface UseCodemapDataOptions {
	scope?: QueryScope;
	query?: GraphQuery;
	refreshInterval?: number;
	enableRealTimeUpdates?: boolean;
	enableCache?: boolean;
	onError?: (error: Error) => void;
	onDataChange?: (data: GraphData) => void;
}

export function useCodemapData(options: UseCodemapDataOptions = {}): UseCodemapDataReturn {
	const {
		scope = {},
		query,
		refreshInterval,
		enableRealTimeUpdates = true,
		enableCache = true,
		onError,
		onDataChange
	} = options;

	const [data, setData] = useState<GraphData | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<Error | null>(null);
	const [metrics, setMetrics] = useState<PerformanceMetrics>({
		symbolResolution: { totalSymbols: 0, cacheHits: 0, cacheMisses: 0, averageTime: 0 },
		graphLayout: { computeTime: 0, nodeCount: 0, edgeCount: 0, iterations: 0 },
		rendering: { frameRate: 60, renderTime: 0, visibleNodes: 0, totalNodes: 0 },
		memory: { heapUsed: 0, heapTotal: 0, external: 0 }
	});

	const abortControllerRef = useRef<AbortController | null>(null);
	const lastQueryRef = useRef<string>('');
	const metricsTimerRef = useRef<NodeJS.Timeout | null>(null);

	// Generate query key for caching
	const generateQueryKey = useCallback((q?: GraphQuery): string => {
		if (!q) return 'default';
		return JSON.stringify({ scope, query: q });
	}, [scope]);

	// Fetch data from service
	const fetchData = useCallback(async (currentQuery?: GraphQuery) => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
		}

		const abortController = new AbortController();
		abortControllerRef.current = abortController;

		try {
			setLoading(true);
			setError(null);

			const queryKey = generateQueryKey(currentQuery || query);

			// Skip if same query as last one (for refresh scenarios)
			if (queryKey === lastQueryRef.current && !refreshInterval) {
				return;
			}

			const startTime = performance.now();

			// Build graph query
			const graphQuery: GraphQuery = {
				scope,
				...currentQuery,
				query: currentQuery?.query || query?.query
			};

			const result = await codemapService.getGraphData(graphQuery, {
				includeTestFiles: false,
				maxNodes: 1000,
				layoutAlgorithm: 'force-directed' as any
			});

			if (abortController.signal.aborted) {
				return;
			}

			const duration = performance.now() - startTime;

			setData(result);
			lastQueryRef.current = queryKey;

			// Update metrics
			setMetrics(prev => ({
				...prev,
				symbolResolution: {
					...prev.symbolResolution,
					totalSymbols: result.metadata.totalNodes,
					averageTime: duration
				}
			}));

			onDataChange?.(result);

		} catch (err) {
			if (abortController.signal.aborted) {
				return;
			}

			const error = err instanceof Error ? err : new Error('Unknown error occurred');
			setError(error);
			onError?.(error);
		} finally {
			if (!abortController.signal.aborted) {
				setLoading(false);
			}
		}
	}, [scope, query, generateQueryKey, refreshInterval, onError, onDataChange]);

	// Debounced fetch function
	const debouncedFetch = useCallback(
		debounce(fetchData, 300, { leading: false, trailing: true }),
		[fetchData]
	);

	// Initial fetch
	useEffect(() => {
		fetchData();
	}, [fetchData]);

	// Refresh interval
	useEffect(() => {
		if (!refreshInterval || refreshInterval <= 0) {
			return;
		}

		const timer = setInterval(() => {
			fetchData();
		}, refreshInterval);

		return () => clearInterval(timer);
	}, [refreshInterval, fetchData]);

	// Real-time updates
	useEffect(() => {
		if (!enableRealTimeUpdates) {
			return;
		}

		const handleUpdate = (update: any) => {
			// Handle real-time updates
			if (data) {
				setData(prev => {
					if (!prev) return prev;
					// This would integrate with the real-time update system
					return prev;
				});
			}
		};

		// Subscribe to updates for the current scope
		const subscription = codemapService.subscribeToUpdates?.(scope.path || '');

		return () => {
			subscription?.();
		};
	}, [enableRealTimeUpdates, scope, data]);

	// Performance metrics monitoring
	useEffect(() => {
		metricsTimerRef.current = setInterval(async () => {
			try {
				const currentMetrics = await codemapService.getPerformanceMetrics?.();
				if (currentMetrics) {
					setMetrics(prev => ({
						...prev,
						...currentMetrics
					}));
				}
			} catch (err) {
				console.warn('Failed to fetch performance metrics:', err);
			}
		}, 5000);

		return () => {
			if (metricsTimerRef.current) {
				clearInterval(metricsTimerRef.current);
			}
		};
	}, []);

	// Refetch function
	const refetch = useCallback(async () => {
		await fetchData();
	}, [fetchData]);

	// Cleanup
	useEffect(() => {
		return () => {
			if (abortControllerRef.current) {
				abortControllerRef.current.abort();
			}
			if (metricsTimerRef.current) {
				clearInterval(metricsTimerRef.current);
			}
		};
	}, []);

	return {
		data,
		loading,
		error,
		refetch,
		metrics
	};
}

// Hook for managing multiple queries
export function useCodemapQueries(queries: Array<{ id: string; query: GraphQuery; scope?: QueryScope }>) {
	const [results, setResults] = useState<Map<string, GraphData>>(new Map());
	const [loading, setLoading] = useState<Set<string>>(new Set());
	const [errors, setErrors] = useState<Map<string, Error>>(new Map());

	const executeQuery = useCallback(async (id: string, query: GraphQuery, scope?: QueryScope) => {
		setLoading(prev => new Set(prev).add(id));
		setErrors(prev => {
			const newErrors = new Map(prev);
			newErrors.delete(id);
			return newErrors;
		});

		try {
			const result = await codemapService.getGraphData({ scope: scope || {}, ...query });
			setResults(prev => new Map(prev).set(id, result));
		} catch (err) {
			const error = err instanceof Error ? err : new Error('Unknown error');
			setErrors(prev => new Map(prev).set(id, error));
		} finally {
			setLoading(prev => {
				const newLoading = new Set(prev);
				newLoading.delete(id);
				return newLoading;
			});
		}
	}, []);

	// Execute all queries
	const executeAllQueries = useCallback(async () => {
		const promises = queries.map(({ id, query, scope }) =>
			executeQuery(id, query, scope)
		);
		await Promise.all(promises);
	}, [queries, executeQuery]);

	// Initial execution
	useEffect(() => {
		executeAllQueries();
	}, [executeAllQueries]);

	return {
		results,
		loading: Array.from(loading),
		errors: Array.from(errors.entries()),
		executeQuery,
		executeAllQueries
	};
}

// Hook for cache management
export function useCodemapCache() {
	const [cacheStats, setCacheStats] = useState<any>(null);
	const [loading, setLoading] = useState(false);

	const getCacheStats = useCallback(async () => {
		try {
			setLoading(true);
			const stats = await codemapService.getCacheStats?.();
			setCacheStats(stats);
		} catch (err) {
			console.warn('Failed to get cache stats:', err);
		} finally {
			setLoading(false);
		}
	}, []);

	const clearCache = useCallback(async () => {
		try {
			await codemapService.clearCache?.();
			await getCacheStats();
		} catch (err) {
			console.warn('Failed to clear cache:', err);
		}
	}, [getCacheStats]);

	const optimizeCache = useCallback(async () => {
		try {
			await codemapService.optimizeCache?.();
			await getCacheStats();
		} catch (err) {
			console.warn('Failed to optimize cache:', err);
		}
	}, [getCacheStats]);

	useEffect(() => {
		getCacheStats();
	}, [getCacheStats]);

	return {
		cacheStats,
		loading,
		getCacheStats,
		clearCache,
		optimizeCache
	};
}