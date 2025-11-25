/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Your Company. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, {
	useState,
	useEffect,
	useCallback,
	useMemo
} from 'react';
import {
	SymbolDetailsProps,
	Symbol,
	SymbolReference,
	Relationship,
	SymbolKind,
	RelationshipType
} from '../types/index.js';
import { codemapService } from '../services/codemapService.js';

export const SymbolDetails: React.FC<SymbolDetailsProps> = ({
	symbol,
	references = [],
	relationships = [],
	onNavigateToSymbol,
	onShowReferences,
	onShowRelationships
}) => {
	const [loadingReferences, setLoadingReferences] = useState(false);
	const [loadingRelationships, setLoadingRelationships] = useState(false);
	const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['basic', 'documentation']));
	const [tab, setTab] = useState<'references' | 'relationships' | 'hierarchy'>('references');

	// Fetch additional data if not provided
	useEffect(() => {
		if (references.length === 0 && symbol) {
			fetchReferences();
		}
		if (relationships.length === 0 && symbol) {
			fetchRelationships();
		}
	}, [symbol]);

	const fetchReferences = useCallback(async () => {
		if (!symbol) return;

		setLoadingReferences(true);
		try {
			const refs = await codemapService.findReferences(symbol.id, true);
			// Update references - would be handled by parent in real implementation
		} catch (error) {
			console.error('Failed to fetch references:', error);
		} finally {
			setLoadingReferences(false);
		}
	}, [symbol]);

	const fetchRelationships = useCallback(async () => {
		if (!symbol) return;

		setLoadingRelationships(true);
		try {
			const rels = await codemapService.getRelationships(symbol.id, Object.values(RelationshipType));
			// Update relationships - would be handled by parent in real implementation
		} catch (error) {
			console.error('Failed to fetch relationships:', error);
		} finally {
			setLoadingRelationships(false);
		}
	}, [symbol]);

	const toggleSection = useCallback((section: string) => {
		setExpandedSections(prev => {
			const newSet = new Set(prev);
			if (newSet.has(section)) {
				newSet.delete(section);
			} else {
				newSet.add(section);
			}
			return newSet;
		});
	}, []);

	const formatLocation = useCallback((location: any) => {
		const filePath = location.uri.split('/').pop();
		const line = location.range.start.line + 1;
		return `${filePath}:${line}`;
	}, []);

	const getSymbolIcon = useCallback((kind: SymbolKind) => {
		const iconMap: Record<SymbolKind, string> = {
			[SymbolKind.Class]: '📦',
			[SymbolKind.Function]: '⚡',
			[SymbolKind.Method]: '🔧',
			[SymbolKind.Interface]: '🔌',
			[SymbolKind.Variable]: '📝',
			[SymbolKind.Property]: '🏷️',
			[SymbolKind.Module]: '📁',
			[SymbolKind.Enum]: '📋',
			[SymbolKind.Constructor]: '🏗️',
			[SymbolKind.TypeAlias]: '🎭',
			[SymbolKind.Namespace]: '🌐',
			[SymbolKind.Import]: '⬇️',
			[SymbolKind.Export]: '⬆️'
		};
		return iconMap[kind] || '❓';
	}, []);

	const getRelationshipIcon = useCallback((type: RelationshipType) => {
		const iconMap: Record<RelationshipType, string> = {
			[RelationshipType.CALLS]: '📞',
			[RelationshipType.EXTENDS]: '🔗',
			[RelationshipType.IMPLEMENTS]: '⚙️',
			[RelationshipType.IMPORTS]: '📥',
			[RelationshipType.REFERENCES]: '👁️',
			[RelationshipType.DEFINES]: '📐',
			[RelationshipType.USES]: '🔨',
			[RelationshipType.INHERITS]: '🧬',
			[RelationshipType.CONTAINS]: '📦'
		};
		return iconMap[type] || '🔗';
	}, []);

	// Group references by type
	const groupedReferences = useMemo(() => {
		const groups: Record<string, SymbolReference[]> = {
			definition: [],
			reference: [],
			read: [],
			write: []
		};

		references.forEach(ref => {
			if (!groups[ref.kind]) {
				groups[ref.kind] = [];
			}
			groups[ref.kind].push(ref);
		});

		return groups;
	}, [references]);

	// Group relationships by type
	const groupedRelationships = useMemo(() => {
		const groups: Record<string, Relationship[]> = {};

		relationships.forEach(rel => {
			if (!groups[rel.type]) {
				groups[rel.type] = [];
			}
			groups[rel.type].push(rel);
		});

		return groups;
	}, [relationships]);

	if (!symbol) {
		return (
			<div className="symbol-details empty" style={{
				padding: '20px',
				textAlign: 'center',
				color: 'var(--vscode-descriptionForeground)',
				fontStyle: 'italic'
			}}>
				Select a symbol to view its details
			</div>
		);
	}

	return (
		<div className="symbol-details" style={{
			height: '100%',
			display: 'flex',
			flexDirection: 'column',
			backgroundColor: 'var(--vscode-editor-background)',
			color: 'var(--vscode-foreground)',
			fontFamily: 'var(--vscode-font-family)',
			fontSize: '14px'
		}}>
			{/* Header */}
			<div className="symbol-header" style={{
				padding: '16px',
				borderBottom: '1px solid var(--vscode-panel-border)',
				display: 'flex',
				alignItems: 'center',
				gap: '12px'
			}}>
				<span style={{ fontSize: '20px' }}>{getSymbolIcon(symbol.kind)}</span>
				<div style={{ flex: 1 }}>
					<h2 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>{symbol.name}</h2>
					<div style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)' }}>
						{symbol.kind} • {symbol.language}
					</div>
				</div>
			</div>

			{/* Content */}
			<div className="symbol-content" style={{ flex: 1, overflow: 'auto' }}>
				{/* Basic Information */}
				<div className="section" style={{ marginBottom: '16px' }}>
					<button
						onClick={() => toggleSection('basic')}
						style={{
							width: '100%',
							padding: '12px 16px',
							border: 'none',
							background: 'none',
							textAlign: 'left',
							cursor: 'pointer',
							display: 'flex',
							alignItems: 'center',
							gap: '8px',
							fontWeight: 'bold',
							color: 'var(--vscode-foreground)'
						}}
					>
						{expandedSections.has('basic') ? '▼' : '▶'} Basic Information
					</button>
					{expandedSections.has('basic') && (
						<div style={{ padding: '0 16px 16px' }}>
							<div style={{ display: 'grid', gap: '8px' }}>
								<div><strong>Kind:</strong> {symbol.kind}</div>
								<div><strong>Language:</strong> {symbol.language}</div>
								<div><strong>Location:</strong> {formatLocation(symbol.location)}</div>
								{symbol.containerName && (
									<div><strong>Container:</strong> {symbol.containerName}</div>
								)}
								<div>
									<strong>Exported:</strong> <span style={{ color: symbol.metadata.isExported ? 'var(--vscode-charts-green)' : 'var(--vscode-charts-red)' }}>
										{symbol.metadata.isExported ? 'Yes' : 'No'}
									</span>
								</div>
								{symbol.metadata.isDeprecated && (
									<div><strong>Status:</strong> <span style={{ color: 'var(--vscode-charts-orange)' }}>Deprecated</span></div>
								)}
								{symbol.metadata.tags.length > 0 && (
									<div>
										<strong>Tags:</strong>
										<div style={{ marginTop: '4px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
											{symbol.metadata.tags.map(tag => (
												<span key={tag} style={{
													padding: '2px 6px',
													backgroundColor: 'var(--vscode-badge-background)',
													color: 'var(--vscode-badge-foreground)',
													borderRadius: '2px',
													fontSize: '11px'
												}}>
													{tag}
												</span>
											))}
										</div>
									</div>
								)}
							</div>
						</div>
					)}
				</div>

				{/* Documentation */}
				{symbol.metadata.documentation && (
					<div className="section" style={{ marginBottom: '16px' }}>
						<button
							onClick={() => toggleSection('documentation')}
							style={{
								width: '100%',
								padding: '12px 16px',
								border: 'none',
								background: 'none',
								textAlign: 'left',
								cursor: 'pointer',
								display: 'flex',
								alignItems: 'center',
								gap: '8px',
								fontWeight: 'bold',
								color: 'var(--vscode-foreground)'
							}}
						>
							{expandedSections.has('documentation') ? '▼' : '▶'} Documentation
						</button>
						{expandedSections.has('documentation') && (
							<div style={{ padding: '0 16px 16px' }}>
								<div style={{
									padding: '12px',
									backgroundColor: 'var(--vscode-textBlockQuote-background)',
									borderLeft: '4px solid var(--vscode-textBlockQuote-border)',
									borderRadius: '0 4px 4px 0',
									whiteSpace: 'pre-wrap',
									fontSize: '13px',
									lineHeight: '1.4'
								}}>
									{symbol.metadata.documentation}
								</div>
							</div>
						)}
					</div>
				)}

				{/* Tabs */}
				<div className="tabs" style={{
					display: 'flex',
					borderBottom: '1px solid var(--vscode-panel-border)',
					backgroundColor: 'var(--vscode-editor-background)'
				}}>
					{['references', 'relationships', 'hierarchy'].map((tabName) => (
						<button
							key={tabName}
							onClick={() => setTab(tabName as any)}
							style={{
								flex: 1,
								padding: '12px 16px',
								border: 'none',
								background: tab === tabName ? 'var(--vscode-tab-activeBackground)' : 'transparent',
								color: tab === tabName ? 'var(--vscode-tab-activeForeground)' : 'var(--vscode-tab-inactiveForeground)',
								borderBottom: tab === tabName ? '2px solid var(--vscode-tab-activeBorder)' : 'none',
								cursor: 'pointer',
								fontWeight: tab === tabName ? 'bold' : 'normal'
							}}
						>
							{tabName.charAt(0).toUpperCase() + tabName.slice(1)}
							{tabName === 'references' && ` (${references.length})`}
							{tabName === 'relationships' && ` (${relationships.length})`}
						</button>
					))}
				</div>

				{/* Tab Content */}
				<div className="tab-content" style={{ flex: 1, padding: '16px' }}>
					{tab === 'references' && (
						<div className="references-tab">
							{loadingReferences ? (
								<div style={{ textAlign: 'center', padding: '20px' }}>Loading references...</div>
							) : (
								Object.entries(groupedReferences).map(([kind, refs]) => (
									refs.length > 0 && (
										<div key={kind} style={{ marginBottom: '16px' }}>
											<h4 style={{ margin: '0 0 8px 0', textTransform: 'capitalize' }}>{kind} ({refs.length})</h4>
											<div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
												{refs.map((ref, index) => (
													<div
														key={index}
														style={{
															padding: '8px 12px',
															backgroundColor: 'var(--vscode-list-hoverBackground)',
															borderRadius: '4px',
															cursor: 'pointer',
															display: 'flex',
															justifyContent: 'space-between',
															alignItems: 'center'
														}}
														onClick={() => {
															// Navigate to reference location
															onNavigateToSymbol?.(ref.symbolId);
														}}
													>
														<div>
															<div style={{ fontWeight: 'bold' }}>{formatLocation(ref.location)}</div>
															{ref.context && (
																<div style={{
																	fontSize: '12px',
																	color: 'var(--vscode-descriptionForeground)',
																	marginTop: '2px'
																}}>
																	{ref.context.length > 100 ? ref.context.substring(0, 100) + '...' : ref.context}
																</div>
															)}
														</div>
														<span style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)' }}>
															{ref.kind}
														</span>
													</div>
												))}
											</div>
										</div>
									)
								))
							)}
							{references.length === 0 && !loadingReferences && (
								<div style={{ textAlign: 'center', padding: '20px', color: 'var(--vscode-descriptionForeground)' }}>
									No references found
								</div>
							)}
						</div>
					)}

					{tab === 'relationships' && (
						<div className="relationships-tab">
							{loadingRelationships ? (
								<div style={{ textAlign: 'center', padding: '20px' }}>Loading relationships...</div>
							) : (
								Object.entries(groupedRelationships).map(([type, rels]) => (
									rels.length > 0 && (
										<div key={type} style={{ marginBottom: '16px' }}>
											<h4 style={{ margin: '0 0 8px 0' }}>
												<span>{getRelationshipIcon(type as RelationshipType)} {type} ({rels.length})</span>
											</h4>
											<div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
												{rels.map((rel, index) => (
													<div
														key={index}
														style={{
															padding: '8px 12px',
															backgroundColor: 'var(--vscode-list-hoverBackground)',
															borderRadius: '4px',
															cursor: 'pointer',
															display: 'flex',
															alignItems: 'center',
															gap: '8px'
														}}
														onClick={() => {
															// Navigate to related symbol
															onNavigateToSymbol?.(rel.targetId);
														}}
													>
														<div style={{ flex: 1 }}>
															<div style={{ fontWeight: 'bold' }}>
																{rel.targetId}
															</div>
															{rel.metadata.labels && rel.metadata.labels.length > 0 && (
																<div style={{
																	fontSize: '12px',
																	color: 'var(--vscode-descriptionForeground)',
																	marginTop: '2px'
																}}>
																	{rel.metadata.labels.join(', ')}
																</div>
															)}
														</div>
														{rel.metadata.strength && (
															<div style={{
																fontSize: '12px',
																color: 'var(--vscode-descriptionForeground)'
															}}>
																Strength: {(rel.metadata.strength * 100).toFixed(0)}%
															</div>
														)}
													</div>
												))}
											</div>
										</div>
									)
								))
							)}
							{relationships.length === 0 && !loadingRelationships && (
								<div style={{ textAlign: 'center', padding: '20px', color: 'var(--vscode-descriptionForeground)' }}>
									No relationships found
								</div>
							)}
						</div>
					)}

					{tab === 'hierarchy' && (
						<div className="hierarchy-tab">
							<div style={{ textAlign: 'center', padding: '20px', color: 'var(--vscode-descriptionForeground)' }}>
								Hierarchy view coming soon...
							</div>
						</div>
					)}
				</div>
			</div>

			{/* Actions */}
			<div className="symbol-actions" style={{
				padding: '16px',
				borderTop: '1px solid var(--vscode-panel-border)',
				display: 'flex',
				gap: '8px'
			}}>
				<button
					onClick={() => onShowReferences?.(symbol.id)}
					style={{
						padding: '8px 12px',
						borderRadius: '4px',
						border: '1px solid var(--vscode-button-border)',
						backgroundColor: 'var(--vscode-button-background)',
						color: 'var(--vscode-button-foreground)',
						cursor: 'pointer'
					}}
				>
					Find References
				</button>
				<button
					onClick={() => onShowRelationships?.(symbol.id)}
					style={{
						padding: '8px 12px',
						borderRadius: '4px',
						border: '1px solid var(--vscode-button-border)',
						backgroundColor: 'var(--vscode-button-background)',
						color: 'var(--vscode-button-foreground)',
						cursor: 'pointer'
					}}
				>
					Analyze Relationships
				</button>
			</div>
		</div>
	);
};