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
	QueryBuilderProps,
	CodeQuery,
	QuerySelect,
	QueryCondition,
	QueryScope,
	QueryTraversal,
	SymbolKind,
	RelationshipType
} from '../types/index.js';
import { codemapService } from '../services/codemapService.js';

export const QueryBuilder: React.FC<QueryBuilderProps> = ({
	onQueryChange,
	onExecuteQuery,
	suggestions = [],
	initialQuery,
	placeholder = "Enter your query...",
	disabled = false
}) => {
	const [query, setQuery] = useState<CodeQuery>(
		initialQuery || {
			select: { symbols: ['*'] },
			limit: 100
		}
	);
	const [naturalLanguageQuery, setNaturalLanguageQuery] = useState('');
	const [queryMode, setQueryMode] = useState<'structured' | 'natural'>('structured');
	const [isExecuting, setIsExecuting] = useState(false);
	const [validationErrors, setValidationErrors] = useState<string[]>([]);
	const [showAdvanced, setShowAdvanced] = useState(false);

	// Available symbol kinds and relationship types
	const symbolKinds = useMemo(() => Object.values(SymbolKind), []);
	const relationshipTypes = useMemo(() => Object.values(RelationshipType), []);

	// Validate query
	const validateQuery = useCallback((q: CodeQuery): string[] => {
		const errors: string[] = [];

		if (!q.select) {
			errors.push('Query must have a select clause');
		} else {
			if (q.select.symbols && q.select.symbols.length === 0) {
				errors.push('Select symbols cannot be empty');
			}
			if (q.select.relationships && q.select.relationships.length === 0) {
				errors.push('Select relationships cannot be empty');
			}
		}

		if (q.limit !== undefined && q.limit < 1) {
			errors.push('Limit must be at least 1');
		}

		if (q.offset !== undefined && q.offset < 0) {
			errors.push('Offset cannot be negative');
		}

		return errors;
	}, []);

	// Update query and notify parent
	const updateQuery = useCallback((updates: Partial<CodeQuery>) => {
		const newQuery = { ...query, ...updates };
		const errors = validateQuery(newQuery);

		setQuery(newQuery);
		setValidationErrors(errors);

		if (errors.length === 0) {
			onQueryChange(newQuery);
		}
	}, [query, validateQuery, onQueryChange]);

	// Handle natural language query
	const handleNaturalLanguageQuery = useCallback(async () => {
		if (!naturalLanguageQuery.trim()) return;

		setIsExecuting(true);
		try {
			const structuredQuery = await codemapService.executeNaturalLanguageQuery(
				naturalLanguageQuery,
				query.from
			);
			// This would return the parsed query in a real implementation
			// For now, we'll just execute it directly
			onExecuteQuery(query);
		} catch (error) {
			console.error('Failed to parse natural language query:', error);
		} finally {
			setIsExecuting(false);
		}
	}, [naturalLanguageQuery, query, onExecuteQuery]);

	// Execute query
	const executeQuery = useCallback(async () => {
		if (validationErrors.length > 0) return;

		setIsExecuting(true);
		try {
			await onExecuteQuery(query);
		} finally {
			setIsExecuting(false);
		}
	}, [query, validationErrors, onExecuteQuery]);

	// Handle select clause changes
	const handleSelectChange = useCallback((field: keyof QuerySelect, value: any) => {
		updateQuery({
			select: {
				...query.select,
				[field]: value
			}
		});
	}, [query.select, updateQuery]);

	// Handle where clause changes
	const handleWhereChange = useCallback((field: keyof QueryCondition, value: any) => {
		updateQuery({
			where: {
				...query.where,
				[field]: value
			}
		});
	}, [query.where, updateQuery]);

	// Handle traversal changes
	const handleTraversalChange = useCallback((field: keyof QueryTraversal, value: any) => {
		updateQuery({
			traverse: {
				...query.traverse,
				[field]: value
			}
		});
	}, [query.traverse, updateQuery]);

	return (
		<div className="codemap-query-builder" style={{
			padding: '16px',
			backgroundColor: 'var(--vscode-editor-background)',
			border: '1px solid var(--vscode-panel-border)',
			borderRadius: '6px',
			display: 'flex',
			flexDirection: 'column',
			gap: '16px'
		}}>
			{/* Query Mode Toggle */}
			<div className="query-mode-toggle" style={{
				display: 'flex',
				gap: '8px',
				alignItems: 'center'
			}}>
				<span style={{ fontSize: '14px', fontWeight: 'bold' }}>Query Mode:</span>
				<button
					onClick={() => setQueryMode('structured')}
					disabled={disabled}
					style={{
						padding: '6px 12px',
						borderRadius: '4px',
						border: '1px solid var(--vscode-button-border)',
						backgroundColor: queryMode === 'structured' ? 'var(--vscode-button-background)' : 'var(--vscode-editor-background)',
						color: 'var(--vscode-button-foreground)',
						cursor: disabled ? 'not-allowed' : 'pointer'
					}}
				>
					Structured
				</button>
				<button
					onClick={() => setQueryMode('natural')}
					disabled={disabled}
					style={{
						padding: '6px 12px',
						borderRadius: '4px',
						border: '1px solid var(--vscode-button-border)',
						backgroundColor: queryMode === 'natural' ? 'var(--vscode-button-background)' : 'var(--vscode-editor-background)',
						color: 'var(--vscode-button-foreground)',
						cursor: disabled ? 'not-allowed' : 'pointer'
					}}
				>
					Natural Language
				</button>
			</div>

			{queryMode === 'natural' ? (
				/* Natural Language Query */
				<div className="natural-language-query">
					<textarea
						value={naturalLanguageQuery}
						onChange={(e) => setNaturalLanguageQuery(e.target.value)}
						placeholder={placeholder}
						disabled={disabled || isExecuting}
						style={{
							width: '100%',
							minHeight: '60px',
							padding: '8px',
							border: '1px solid var(--vscode-input-border)',
							borderRadius: '4px',
							backgroundColor: 'var(--vscode-input-background)',
							color: 'var(--vscode-input-foreground)',
							fontFamily: 'var(--vscode-font-family)',
							fontSize: '14px',
							resize: 'vertical'
						}}
					/>
					<div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
						<button
							onClick={handleNaturalLanguageQuery}
							disabled={disabled || isExecuting || !naturalLanguageQuery.trim()}
							style={{
								padding: '8px 16px',
								borderRadius: '4px',
								border: '1px solid var(--vscode-button-border)',
								backgroundColor: 'var(--vscode-button-background)',
								color: 'var(--vscode-button-foreground)',
								cursor: disabled || isExecuting || !naturalLanguageQuery.trim() ? 'not-allowed' : 'pointer'
							}}
						>
							{isExecuting ? 'Processing...' : 'Execute'}
						</button>
					</div>
				</div>
			) : (
				/* Structured Query Builder */
				<div className="structured-query">
					{/* SELECT Clause */}
					<div className="select-clause">
						<h4 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>SELECT</h4>
						<div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
							<div style={{ flex: 1, minWidth: '200px' }}>
								<label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Symbols:</label>
								<input
									type="text"
									value={query.select.symbols?.join(', ') || ''}
									onChange={(e) => handleSelectChange('symbols', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
									placeholder="e.g., *, MyClass, function*"
									disabled={disabled}
									style={{
										width: '100%',
										padding: '6px',
										border: '1px solid var(--vscode-input-border)',
										borderRadius: '4px',
										backgroundColor: 'var(--vscode-input-background)',
										color: 'var(--vscode-input-foreground)'
									}}
								/>
							</div>
							<div style={{ flex: 1, minWidth: '200px' }}>
								<label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Relationships:</label>
								<select
									multiple
									value={query.select.relationships || []}
									onChange={(e) => {
										const selected = Array.from(e.target.selectedOptions, option => option.value as RelationshipType);
										handleSelectChange('relationships', selected);
									}}
									disabled={disabled}
									style={{
										width: '100%',
										padding: '6px',
										border: '1px solid var(--vscode-input-border)',
										borderRadius: '4px',
										backgroundColor: 'var(--vscode-input-background)',
										color: 'var(--vscode-input-foreground)',
										minHeight: '80px'
									}}
								>
									{relationshipTypes.map(type => (
										<option key={type} value={type}>{type}</option>
									))}
								</select>
							</div>
						</div>
					</div>

					{/* WHERE Clause */}
					<div className="where-clause">
						<h4 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>WHERE</h4>
						<div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
							<div style={{ flex: 1, minWidth: '150px' }}>
								<label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Symbol Types:</label>
								<select
									multiple
									value={query.where?.symbolType || []}
									onChange={(e) => {
										const selected = Array.from(e.target.selectedOptions, option => option.value as SymbolKind);
										handleWhereChange('symbolType', selected);
									}}
									disabled={disabled}
									style={{
										width: '100%',
										padding: '6px',
										border: '1px solid var(--vscode-input-border)',
										borderRadius: '4px',
										backgroundColor: 'var(--vscode-input-background)',
										color: 'var(--vscode-input-foreground)',
										minHeight: '80px'
									}}
								>
									{symbolKinds.map(kind => (
										<option key={kind} value={kind}>{kind}</option>
									))}
								</select>
							</div>
							<div style={{ flex: 1, minWidth: '150px' }}>
								<label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Name Pattern:</label>
								<input
									type="text"
									value={query.where?.namePattern || ''}
									onChange={(e) => handleWhereChange('namePattern', e.target.value)}
									placeholder="e.g., *Controller, get*"
									disabled={disabled}
									style={{
										width: '100%',
										padding: '6px',
										border: '1px solid var(--vscode-input-border)',
										borderRadius: '4px',
										backgroundColor: 'var(--vscode-input-background)',
										color: 'var(--vscode-input-foreground)'
									}}
								/>
							</div>
							<div style={{ flex: 1, minWidth: '150px' }}>
								<label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Path:</label>
								<input
									type="text"
									value={query.where?.inPath || ''}
									onChange={(e) => handleWhereChange('inPath', e.target.value)}
									placeholder="e.g., src/components/"
									disabled={disabled}
									style={{
										width: '100%',
										padding: '6px',
										border: '1px solid var(--vscode-input-border)',
										borderRadius: '4px',
										backgroundColor: 'var(--vscode-input-background)',
										color: 'var(--vscode-input-foreground)'
									}}
								/>
							</div>
						</div>
					</div>

					{/* Advanced Options */}
					<div className="advanced-options">
						<button
							onClick={() => setShowAdvanced(!showAdvanced)}
							disabled={disabled}
							style={{
								padding: '6px 12px',
								borderRadius: '4px',
								border: '1px solid var(--vscode-button-border)',
								backgroundColor: 'var(--vscode-button-secondaryBackground)',
								color: 'var(--vscode-button-secondaryForeground)',
								cursor: disabled ? 'not-allowed' : 'pointer'
							}}
						>
							{showAdvanced ? 'Hide' : 'Show'} Advanced Options
						</button>

						{showAdvanced && (
							<div style={{ marginTop: '12px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
								<div style={{ flex: 1, minWidth: '150px' }}>
									<label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Limit:</label>
									<input
										type="number"
										value={query.limit || 100}
										onChange={(e) => updateQuery({ limit: parseInt(e.target.value) || 100 })}
										min="1"
										max="1000"
										disabled={disabled}
										style={{
											width: '100%',
											padding: '6px',
											border: '1px solid var(--vscode-input-border)',
											borderRadius: '4px',
											backgroundColor: 'var(--vscode-input-background)',
											color: 'var(--vscode-input-foreground)'
										}}
									/>
								</div>
								<div style={{ flex: 1, minWidth: '150px' }}>
									<label style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>Offset:</label>
									<input
										type="number"
										value={query.offset || 0}
										onChange={(e) => updateQuery({ offset: parseInt(e.target.value) || 0 })}
										min="0"
										disabled={disabled}
										style={{
											width: '100%',
											padding: '6px',
											border: '1px solid var(--vscode-input-border)',
											borderRadius: '4px',
											backgroundColor: 'var(--vscode-input-background)',
											color: 'var(--vscode-input-foreground)'
										}}
									/>
								</div>
							</div>
						)}
					</div>
				</div>
			)}

			{/* Validation Errors */}
			{validationErrors.length > 0 && (
				<div className="validation-errors" style={{
					padding: '8px 12px',
					backgroundColor: 'var(--vscode-errorBackground)',
					border: '1px solid var(--vscode-errorBorder)',
					borderRadius: '4px',
					color: 'var(--vscode-errorForeground)',
					fontSize: '12px'
				}}>
					{validationErrors.map((error, index) => (
						<div key={index}>• {error}</div>
					))}
				</div>
			)}

			{/* Execute Button */}
			{queryMode === 'structured' && (
				<div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
					<button
						onClick={executeQuery}
						disabled={disabled || isExecuting || validationErrors.length > 0}
						style={{
							padding: '8px 16px',
							borderRadius: '4px',
							border: '1px solid var(--vscode-button-border)',
							backgroundColor: 'var(--vscode-button-background)',
							color: 'var(--vscode-button-foreground)',
							cursor: disabled || isExecuting || validationErrors.length > 0 ? 'not-allowed' : 'pointer'
						}}
					>
						{isExecuting ? 'Executing...' : 'Execute Query'}
					</button>
				</div>
			)}

			{/* Query Suggestions */}
			{suggestions.length > 0 && (
				<div className="query-suggestions" style={{
					marginTop: '12px',
					padding: '8px',
					backgroundColor: 'var(--vscode-editorSuggestWidget-background)',
					border: '1px solid var(--vscode-editorSuggestWidget-border)',
					borderRadius: '4px'
				}}>
					<div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>Suggestions:</div>
					{suggestions.slice(0, 5).map((suggestion, index) => (
						<div
							key={index}
							style={{
								padding: '4px 8px',
								cursor: 'pointer',
								borderRadius: '2px',
								fontSize: '12px'
							}}
							onClick={() => setNaturalLanguageQuery(suggestion)}
							onMouseEnter={(e) => {
								e.currentTarget.style.backgroundColor = 'var(--vscode-editorSuggestWidget-selectedBackground)';
							}}
							onMouseLeave={(e) => {
								e.currentTarget.style.backgroundColor = 'transparent';
							}}
						>
							{suggestion}
						</div>
					))}
				</div>
			)}
		</div>
	);
};