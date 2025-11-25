/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Your Company. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState, useCallback, useRef, useEffect } from 'react';
import { clamp } from 'lodash-es';
import { ViewportState, GraphNode } from '../../types/index.js';

export interface UseViewportOptions {
	width: number;
	height: number;
	minZoom?: number;
	maxZoom?: number;
	zoomStep?: number;
	panStep?: number;
	enableInertia?: boolean;
	inertiaDuration?: number;
	bounds?: {
		minX?: number;
		minY?: number;
		maxX?: number;
		maxY?: number;
	};
	onViewportChange?: (viewport: ViewportState) => void;
}

export function useViewport(options: UseViewportOptions) {
	const {
		width,
		height,
		minZoom = 0.1,
		maxZoom = 5,
		zoomStep = 0.1,
		panStep = 50,
		enableInertia = true,
		inertiaDuration = 300,
		bounds,
		onViewportChange
	} = options;

	const [viewport, setViewport] = useState<ViewportState>({
		x: 0,
		y: 0,
		zoom: 1,
		width,
		height
	});

	const [isAnimating, setIsAnimating] = useState(false);
	const animationRef = useRef<number | null>(null);
	const velocityRef = useRef({ x: 0, y: 0 });
	const lastPanTime = useRef<number>(0);

	// Apply bounds constraints
	const applyBounds = useCallback((state: ViewportState): ViewportState => {
		if (!bounds) return state;

		const { minX = -Infinity, minY = -Infinity, maxX = Infinity, maxY = Infinity } = bounds;

		// Calculate viewport bounds in world coordinates
		const worldLeft = -state.x / state.zoom;
		const worldTop = -state.y / state.zoom;
		const worldRight = (-state.x + state.width) / state.zoom;
		const worldBottom = (-state.y + state.height) / state.zoom;

		let newX = state.x;
		let newY = state.y;

		// Constrain to bounds
		if (worldLeft < minX) {
			newX = -minX * state.zoom;
		}
		if (worldTop < minY) {
			newY = -minY * state.zoom;
		}
		if (worldRight > maxX) {
			newX = state.width - maxX * state.zoom;
		}
		if (worldBottom > maxY) {
			newY = state.height - maxY * state.zoom;
		}

		return {
			...state,
			x: newX,
			y: newY
		};
	}, [bounds]);

	// Update viewport with constraints
	const updateViewport = useCallback((updates: Partial<ViewportState>) => {
		setViewport(prev => {
			const newViewport = {
				...prev,
				...updates,
				width: updates.width || width,
				height: updates.height || height
			};

			// Clamp zoom
			newViewport.zoom = clamp(newViewport.zoom, minZoom, maxZoom);

			const constrainedViewport = applyBounds(newViewport);
			onViewportChange?.(constrainedViewport);
			return constrainedViewport;
		});
	}, [width, height, minZoom, maxZoom, applyBounds, onViewportChange]);

	// Convert screen coordinates to world coordinates
	const screenToGraph = useCallback((screenX: number, screenY: number) => {
		return {
			x: (screenX - viewport.x) / viewport.zoom,
			y: (screenY - viewport.y) / viewport.zoom
		};
	}, [viewport]);

	// Convert world coordinates to screen coordinates
	const graphToScreen = useCallback((graphX: number, graphY: number) => {
		return {
			x: graphX * viewport.zoom + viewport.x,
			y: graphY * viewport.zoom + viewport.y
		};
	}, [viewport]);

	// Zoom to specific scale and center
	const zoomTo = useCallback((
		scale: number,
		centerX: number = width / 2,
		centerY: number = height / 2,
		duration?: number
	) => {
		const clampedScale = clamp(scale, minZoom, maxZoom);
		const scaleDelta = clampedScale / viewport.zoom;

		if (duration && duration > 0) {
			// Animate zoom
			const startViewport = { ...viewport };
			const targetViewport = {
				...viewport,
				zoom: clampedScale,
				x: centerX - (centerX - startViewport.x) * scaleDelta,
				y: centerY - (centerY - startViewport.y) * scaleDelta
			};

			animateViewport(startViewport, targetViewport, duration);
		} else {
			// Immediate zoom
			updateViewport({
				zoom: clampedScale,
				x: centerX - (centerX - viewport.x) * scaleDelta,
				y: centerY - (centerY - viewport.y) * scaleDelta
			});
		}
	}, [viewport, width, height, minZoom, maxZoom, updateViewport]);

	// Zoom in/out
	const zoomIn = useCallback((centerX?: number, centerY?: number) => {
		zoomTo(viewport.zoom * (1 + zoomStep), centerX, centerY);
	}, [viewport.zoom, zoomStep, zoomTo]);

	const zoomOut = useCallback((centerX?: number, centerY?: number) => {
		zoomTo(viewport.zoom * (1 - zoomStep), centerX, centerY);
	}, [viewport.zoom, zoomStep, zoomTo]);

	// Pan to specific coordinates
	const panTo = useCallback((x: number, y: number, duration?: number) => {
		if (duration && duration > 0) {
			const startViewport = { ...viewport };
			const targetViewport = { ...viewport, x, y };
			animateViewport(startViewport, targetViewport, duration);
		} else {
			updateViewport({ x, y });
		}
	}, [viewport, updateViewport]);

	// Pan by offset
	const panBy = useCallback((deltaX: number, deltaY: number, immediate = false) => {
		const newX = viewport.x + deltaX;
		const newY = viewport.y + deltaY;

		if (immediate) {
			updateViewport({ x: newX, y: newY });
		} else {
			// Track velocity for inertia
			const now = Date.now();
			const dt = now - lastPanTime.current;
			if (dt > 0) {
				velocityRef.current = {
					x: deltaX / dt * 16,
					y: deltaY / dt * 16
				};
				lastPanTime.current = now;
			}

			updateViewport({ x: newX, y: newY });
		}
	}, [viewport, updateViewport]);

	// Animate viewport changes
	const animateViewport = useCallback((
		startViewport: ViewportState,
		targetViewport: ViewportState,
		duration: number
	) => {
		if (animationRef.current) {
			cancelAnimationFrame(animationRef.current);
		}

		const startTime = performance.now();

		const animate = (currentTime: number) => {
			const elapsed = currentTime - startTime;
			const progress = Math.min(elapsed / duration, 1);

			// Easing function (ease-out cubic)
			const eased = 1 - Math.pow(1 - progress, 3);

			const currentViewport = {
				x: startViewport.x + (targetViewport.x - startViewport.x) * eased,
				y: startViewport.y + (targetViewport.y - startViewport.y) * eased,
				zoom: startViewport.zoom + (targetViewport.zoom - startViewport.zoom) * eased,
				width,
				height
			};

			updateViewport(currentViewport);

			if (progress < 1) {
				animationRef.current = requestAnimationFrame(animate);
			} else {
				animationRef.current = null;
			}
		};

		animationRef.current = requestAnimationFrame(animate);
	}, [width, height, updateViewport]);

	// Start inertia animation
	const startInertia = useCallback(() => {
		if (!enableInertia) return;

		const velocity = velocityRef.current;
		if (Math.abs(velocity.x) < 0.1 && Math.abs(velocity.y) < 0.1) {
			return;
		}

		setIsAnimating(true);
		const startVelocity = { ...velocity };
		const startTime = performance.now();

		const inertiaAnimation = (currentTime: number) => {
			const elapsed = currentTime - startTime;
			const progress = Math.min(elapsed / inertiaDuration, 1);

			// Decay velocity
			const decay = Math.pow(1 - progress, 2);
			const currentVelocity = {
				x: startVelocity.x * decay,
				y: startVelocity.y * decay
			};

			panBy(currentVelocity.x, currentVelocity.y, true);

			if (progress < 1 && (Math.abs(currentVelocity.x) > 0.1 || Math.abs(currentVelocity.y) > 0.1)) {
				requestAnimationFrame(inertiaAnimation);
			} else {
				setIsAnimating(false);
				velocityRef.current = { x: 0, y: 0 };
			}
		};

		requestAnimationFrame(inertiaAnimation);
	}, [enableInertia, inertiaDuration, panBy]);

	// Fit content to viewport
	const fitToContent = useCallback((
		nodes: GraphNode[],
		padding = 50,
		duration?: number
	) => {
		if (nodes.length === 0) {
			panTo(0, 0, duration);
			return;
		}

		// Calculate content bounds
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

		const contentWidth = maxX - minX + padding * 2;
		const contentHeight = maxY - minY + padding * 2;

		const scaleX = width / contentWidth;
		const scaleY = height / contentHeight;
		const targetZoom = Math.min(scaleX, scaleY, maxZoom, minZoom);

		const targetX = (width - contentWidth * targetZoom) / 2 - minX * targetZoom + padding * targetZoom;
		const targetY = (height - contentHeight * targetZoom) / 2 - minY * targetZoom + padding * targetZoom;

		if (duration && duration > 0) {
			animateViewport(viewport, {
				...viewport,
				x: targetX,
				y: targetY,
				zoom: targetZoom
			}, duration);
		} else {
			updateViewport({
				x: targetX,
				y: targetY,
				zoom: targetZoom
			});
		}
	}, [viewport, width, height, maxZoom, minZoom, updateViewport, animateViewport]);

	// Center on specific point
	const centerOn = useCallback((
		x: number,
		y: number,
		zoom?: number,
		duration?: number
	) => {
		const targetZoom = zoom !== undefined ? clamp(zoom, minZoom, maxZoom) : viewport.zoom;
		const targetX = width / 2 - x * targetZoom;
		const targetY = height / 2 - y * targetZoom;

		if (duration && duration > 0) {
			animateViewport(viewport, {
				...viewport,
				x: targetX,
				y: targetY,
				zoom: targetZoom
			}, duration);
		} else {
			updateViewport({
				x: targetX,
				y: targetY,
				zoom: targetZoom
			});
		}
	}, [viewport, width, height, minZoom, maxZoom, updateViewport, animateViewport]);

	// Reset viewport to default
	const resetViewport = useCallback((duration?: number) => {
		if (duration && duration > 0) {
			animateViewport(viewport, {
				x: 0,
				y: 0,
				zoom: 1,
				width,
				height
			}, duration);
		} else {
			updateViewport({ x: 0, y: 0, zoom: 1 });
		}
	}, [viewport, width, height, updateViewport, animateViewport]);

	// Check if point is visible
	const isVisible = useCallback((x: number, y: number, margin = 0): boolean => {
		const screen = graphToScreen(x, y);
		return screen.x >= -margin && screen.x <= width + margin &&
			   screen.y >= -margin && screen.y <= height + margin;
	}, [graphToScreen, width, height]);

	// Get visible bounds in world coordinates
	const getVisibleBounds = useCallback(() => {
		const topLeft = screenToGraph(0, 0);
		const bottomRight = screenToGraph(width, height);

		return {
			minX: topLeft.x,
			minY: topLeft.y,
			maxX: bottomRight.x,
			maxY: bottomRight.y
		};
	}, [screenToGraph, width, height]);

	// Handle window resize
	useEffect(() => {
		updateViewport({ width, height });
	}, [width, height, updateViewport]);

	// Cleanup animations
	useEffect(() => {
		return () => {
			if (animationRef.current) {
				cancelAnimationFrame(animationRef.current);
			}
		};
	}, []);

	return {
		viewport,
		isAnimating,
		setViewport: updateViewport,
		screenToGraph,
		graphToScreen,
		zoomTo,
		zoomIn,
		zoomOut,
		panTo,
		panBy,
		fitToContent,
		centerOn,
		resetViewport,
		isVisible,
		getVisibleBounds,
		startInertia
	};
}

// Hook for viewport controls
export function useViewportControls(viewport: ReturnType<typeof useViewport>) {
	const handleKeyDown = useCallback((event: KeyboardEvent) => {
		const { key, ctrlKey, metaKey, shiftKey } = event;

		// Prevent default for our shortcuts
		if (key === ' ' || key === 'Tab' || (ctrlKey && (key === '=' || key === '-'))) {
			event.preventDefault();
		}

		switch (key) {
			case ' ':
				// Space + drag for panning (handled elsewhere)
				break;
			case 'ArrowUp':
				viewport.panBy(0, shiftKey ? 100 : 20, true);
				break;
			case 'ArrowDown':
				viewport.panBy(0, shiftKey ? -100 : -20, true);
				break;
			case 'ArrowLeft':
				viewport.panBy(shiftKey ? 100 : 20, 0, true);
				break;
			case 'ArrowRight':
				viewport.panBy(shiftKey ? -100 : -20, 0, true);
				break;
			case '+':
			case '=':
				if (ctrlKey || metaKey) {
					viewport.zoomIn();
				}
				break;
			case '-':
			case '_':
				if (ctrlKey || metaKey) {
					viewport.zoomOut();
				}
				break;
			case '0':
				if (ctrlKey || metaKey) {
					viewport.resetViewport();
				}
				break;
			case 'f':
			case 'F':
				if (!ctrlKey && !metaKey) {
					// Fit to content (requires nodes to be passed)
				}
				break;
		}
	}, [viewport]);

	const handleWheel = useCallback((event: WheelEvent) => {
		event.preventDefault();

		const { clientX, clientY, deltaY } = event;
		const zoomDelta = deltaY > 0 ? -0.1 : 0.1;
		const newZoom = Math.max(0.1, Math.min(5, viewport.viewport.zoom + zoomDelta));

		viewport.zoomTo(newZoom, clientX, clientY);
	}, [viewport]);

	return {
		handleKeyDown,
		handleWheel
	};
}