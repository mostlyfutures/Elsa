/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Your Company. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState, useCallback, useRef, useEffect } from 'react';
import {
	GraphNode,
	GraphEdge,
	Symbol,
	SymbolReference
} from '../../types/index.js';

export interface UseSymbolSelectionOptions {
	enableMultiSelect?: boolean;
	maxSelection?: number;
	onSelectionChange?: (nodes: GraphNode[], edges: GraphEdge[]) => void;
	onNodeClick?: (node: GraphNode) => void;
	onEdgeClick?: (edge: GraphEdge) => void;
}

export function useSymbolSelection(options: UseSymbolSelectionOptions = {}) {
	const {
		enableMultiSelect = false,
		maxSelection = Infinity,
		onSelectionChange,
		onNodeClick,
		onEdgeClick
	} = options;

	const [selectedNodes, setSelectedNodes] = useState<GraphNode[]>([]);
	const [selectedEdges, setSelectedEdges] = useState<GraphEdge[]>([]);
	const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
	const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(new Set());

	const lastClickTime = useRef<number>(0);
	const lastClickedNode = useRef<string | null>(null);

	// Update derived sets when selections change
	useEffect(() => {
		const nodeIds = new Set(selectedNodes.map(n => n.id));
		const edgeIds = new Set(selectedEdges.map(e => `${e.source}-${e.target}`));

		setSelectedNodeIds(nodeIds);
		setSelectedEdgeIds(edgeIds);

		onSelectionChange?.(selectedNodes, selectedEdges);
	}, [selectedNodes, selectedEdges, onSelectionChange]);

	// Select a node
	const selectNode = useCallback((node: GraphNode, multiSelect = false) => {
		const now = Date.now();
		const isDoubleClick = lastClickedNode.current === node.id && (now - lastClickTime.current) < 300;

		if (isDoubleClick) {
			onNodeClick?.(node);
			return;
		}

		lastClickTime.current = now;
		lastClickedNode.current = node.id;

		if (multiSelect && enableMultiSelect) {
			setSelectedNodes(prev => {
				if (selectedNodeIds.has(node.id)) {
					// Deselect if already selected
					return prev.filter(n => n.id !== node.id);
				} else if (prev.length < maxSelection) {
					// Add to selection
					return [...prev, node];
				}
				return prev;
			});
		} else {
			// Single selection
			setSelectedNodes([node]);
			setSelectedEdges([]); // Clear edge selection when selecting nodes
		}
	}, [selectedNodeIds, enableMultiSelect, maxSelection, onNodeClick]);

	// Select an edge
	const selectEdge = useCallback((edge: GraphEdge, multiSelect = false) => {
		if (multiSelect && enableMultiSelect) {
			const edgeId = `${edge.source}-${edge.target}`;
			setSelectedEdges(prev => {
				if (selectedEdgeIds.has(edgeId)) {
					// Deselect if already selected
					return prev.filter(e => `${e.source}-${e.target}` !== edgeId);
				} else if (prev.length < maxSelection) {
					// Add to selection
					return [...prev, edge];
				}
				return prev;
			});
		} else {
			// Single selection
			setSelectedEdges([edge]);
			setSelectedNodes([]); // Clear node selection when selecting edges
		}
	}, [selectedEdgeIds, enableMultiSelect, maxSelection]);

	// Clear selection
	const clearSelection = useCallback(() => {
		setSelectedNodes([]);
		setSelectedEdges([]);
	}, []);

	// Select all nodes
	const selectAllNodes = useCallback((nodes: GraphNode[]) => {
		if (!enableMultiSelect) {
			setSelectedNodes(nodes.slice(0, 1));
			setSelectedEdges([]);
			return;
		}

		const limitedNodes = nodes.slice(0, maxSelection);
		setSelectedNodes(limitedNodes);
		setSelectedEdges([]);
	}, [enableMultiSelect, maxSelection]);

	// Select all edges
	const selectAllEdges = useCallback((edges: GraphEdge[]) => {
		if (!enableMultiSelect) {
			setSelectedEdges(edges.slice(0, 1));
			setSelectedNodes([]);
			return;
		}

		const limitedEdges = edges.slice(0, maxSelection);
		setSelectedEdges(limitedEdges);
		setSelectedNodes([]);
	}, [enableMultiSelect, maxSelection]);

	// Invert selection
	const invertSelection = useCallback((allNodes: GraphNode[], allEdges: GraphEdge[]) => {
		if (!enableMultiSelect) {
			return;
		}

		const unselectedNodes = allNodes.filter(n => !selectedNodeIds.has(n.id));
		const unselectedEdges = allEdges.filter(e => !selectedEdgeIds.has(`${e.source}-${e.target}`));

		const newNodes = unselectedNodes.slice(0, maxSelection - selectedEdges.length);
		const newEdges = unselectedEdges.slice(0, maxSelection - newNodes.length);

		setSelectedNodes(newNodes);
		setSelectedEdges(newEdges);
	}, [enableMultiSelect, maxSelection, selectedNodeIds, selectedEdgeIds]);

	// Select by pattern
	const selectByPattern = useCallback((
		nodes: GraphNode[],
		pattern: string,
		field: 'name' | 'kind' | 'language' = 'name'
	) => {
		const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
		const matchingNodes = nodes.filter(node => {
			switch (field) {
				case 'name':
					return regex.test(node.symbol.name);
				case 'kind':
					return regex.test(node.symbol.kind);
				case 'language':
					return regex.test(node.symbol.language);
				default:
					return false;
			}
		});

		if (enableMultiSelect) {
			selectAllNodes(matchingNodes);
		} else {
			setSelectedNodes(matchingNodes.slice(0, 1));
			setSelectedEdges([]);
		}
	}, [enableMultiSelect, selectAllNodes]);

	// Select connected components
	const selectConnectedNodes = useCallback((
		startNode: GraphNode,
		allEdges: GraphEdge[],
		maxDepth = 1
	) => {
		const visited = new Set<string>([startNode.id]);
		const toVisit = [startNode];
		let currentDepth = 0;
		let nextLevel: GraphNode[] = [];

		while (toVisit.length > 0 && currentDepth < maxDepth) {
			const currentNode = toVisit.pop()!;

			// Find connected nodes
			for (const edge of allEdges) {
				let connectedNode: GraphNode | null = null;

				if (edge.source === currentNode.id) {
					connectedNode = { id: edge.target } as GraphNode;
				} else if (edge.target === currentNode.id) {
					connectedNode = { id: edge.source } as GraphNode;
				}

				if (connectedNode && !visited.has(connectedNode.id)) {
					visited.add(connectedNode.id);
					nextLevel.push(connectedNode);
				}
			}

			// Move to next depth level
			if (toVisit.length === 0) {
				toVisit.push(...nextLevel);
				nextLevel = [];
				currentDepth++;
			}
		}

		const connectedNodeIds = Array.from(visited);
		const connectedNodes = connectedNodeIds.map(id => ({ id } as GraphNode));

		if (enableMultiSelect) {
			setSelectedNodes(prev => {
				const newSelection = [...prev];
				for (const node of connectedNodes) {
					if (!selectedNodeIds.has(node.id) && newSelection.length < maxSelection) {
						newSelection.push(node);
					}
				}
				return newSelection;
			});
		} else {
			setSelectedNodes(connectedNodes.slice(0, 1));
			setSelectedEdges([]);
		}
	}, [enableMultiSelect, maxSelection, selectedNodeIds]);

	// Select related symbols
	const selectRelatedSymbols = useCallback(async (
		node: GraphNode,
		relationshipTypes: string[]
	) => {
		try {
			// This would integrate with the codemap service to get related symbols
			// For now, we'll use a mock implementation
			const relatedNodes: GraphNode[] = [];

			if (enableMultiSelect) {
				setSelectedNodes(prev => {
					const newSelection = [...prev, node, ...relatedNodes];
					return newSelection.slice(0, maxSelection);
				});
			} else {
				setSelectedNodes([node]);
			}

		} catch (err) {
			console.warn('Failed to select related symbols:', err);
		}
	}, [enableMultiSelect, maxSelection]);

	// Get selection summary
	const getSelectionSummary = useCallback(() => {
		const nodeKinds = new Map<string, number>();
		const edgeTypes = new Map<string, number>();

		for (const node of selectedNodes) {
			const kind = node.symbol.kind;
			nodeKinds.set(kind, (nodeKinds.get(kind) || 0) + 1);
		}

		for (const edge of selectedEdges) {
			const type = edge.relationship.type;
			edgeTypes.set(type, (edgeTypes.get(type) || 0) + 1);
		}

		return {
			totalNodes: selectedNodes.length,
			totalEdges: selectedEdges.length,
			nodeKinds: Object.fromEntries(nodeKinds),
			edgeTypes: Object.fromEntries(edgeTypes)
		};
	}, [selectedNodes, selectedEdges]);

	// Export selection
	const exportSelection = useCallback(() => {
		return {
			nodes: selectedNodes.map(n => ({
				id: n.id,
				symbol: n.symbol,
				position: { x: n.x, y: n.y }
			})),
			edges: selectedEdges.map(e => ({
				source: e.source,
				target: e.target,
				relationship: e.relationship
			})),
			timestamp: new Date().toISOString()
		};
	}, [selectedNodes, selectedEdges]);

	// Import selection
	const importSelection = useCallback((selection: any) => {
		try {
			if (selection.nodes && Array.isArray(selection.nodes)) {
				const nodes = selection.nodes.filter(n => n.id && n.symbol);
				if (enableMultiSelect) {
					setSelectedNodes(nodes.slice(0, maxSelection));
				} else {
					setSelectedNodes(nodes.slice(0, 1));
				}
			}

			if (selection.edges && Array.isArray(selection.edges) && enableMultiSelect) {
				const edges = selection.edges.filter(e => e.source && e.target);
				setSelectedEdges(edges.slice(0, maxSelection));
			}
		} catch (err) {
			console.warn('Failed to import selection:', err);
		}
	}, [enableMultiSelect, maxSelection]);

	return {
		selectedNodes,
		selectedEdges,
		selectedNodeIds,
		selectedEdgeIds,
		selectNode,
		selectEdge,
		clearSelection,
		selectAllNodes,
		selectAllEdges,
		invertSelection,
		selectByPattern,
		selectConnectedNodes,
		selectRelatedSymbols,
		getSelectionSummary,
		exportSelection,
		importSelection
	};
}

// Hook for selection history
export function useSelectionHistory(maxHistory = 50) {
	const [history, setHistory] = useState<Array<{
		nodes: GraphNode[];
		edges: GraphEdge[];
		timestamp: number;
		label?: string;
	}>>([]);
	const [currentIndex, setCurrentIndex] = useState(-1);

	const addToHistory = useCallback((
		nodes: GraphNode[],
		edges: GraphEdge[],
		label?: string
	) => {
		const newEntry = {
			nodes: [...nodes],
			edges: [...edges],
			timestamp: Date.now(),
			label
		};

		setHistory(prev => {
			const newHistory = prev.slice(0, currentIndex + 1);
			newHistory.push(newEntry);

			// Limit history size
			if (newHistory.length > maxHistory) {
				return newHistory.slice(-maxHistory);
			}

			return newHistory;
		});

		setCurrentIndex(prev => Math.min(prev + 1, maxHistory - 1));
	}, [currentIndex, maxHistory]);

	const goBack = useCallback(() => {
		if (currentIndex > 0) {
			setCurrentIndex(prev => prev - 1);
			return history[currentIndex - 1];
		}
		return null;
	}, [currentIndex, history]);

	const goForward = useCallback(() => {
		if (currentIndex < history.length - 1) {
			setCurrentIndex(prev => prev + 1);
			return history[currentIndex + 1];
		}
		return null;
	}, [currentIndex, history]);

	const canGoBack = currentIndex > 0;
	const canGoForward = currentIndex < history.length - 1;

	const clearHistory = useCallback(() => {
		setHistory([]);
		setCurrentIndex(-1);
	}, []);

	return {
		history,
		currentIndex,
		addToHistory,
		goBack,
		goForward,
		canGoBack,
		canGoForward,
		clearHistory
	};
}