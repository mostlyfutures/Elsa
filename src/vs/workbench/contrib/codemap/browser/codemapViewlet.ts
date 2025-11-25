/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Your Company. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/codemap.css';
import { localize, localize2 } from '../../../../nls.js';
import { IViewletViewOptions } from '../../browser/parts/views/viewsViewlet.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IContextKeyService, ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IViewsRegistry, IViewDescriptor, Extensions, ViewContainer, IViewContainersRegistry, ViewContainerLocation, IViewDescriptorService } from '../../../common/views.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { ViewPaneContainer } from '../../browser/parts/views/viewPaneContainer.js';
import { ViewPane } from '../../browser/parts/views/viewPane.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { KeybindingService } from '../../../../platform/keybinding/common/keybindingService.js';
import { URI } from '../../../../base/common/uri.js';

// Import React component
import { CodemapView as CodemapReactView } from '../react/src/codemap-tsx/index.js';

// Icons
const codemapViewIcon = registerIcon('codemap-view-icon', Codicon.map, localize('codemapViewIcon', 'View icon of the codemap view.'));

// View container ID
const VIEW_CONTAINER_ID = 'workbench.views.codemap';
const VIEW_CONTAINER_TITLE = localize2('codemap', "Codemap");

// View IDs
export const CODEMAP_VIEW_ID = 'codemap.explorer';

// Context keys
export const CodemapViewVisibleContext = 'codemapViewVisible';

export class CodemapView extends ViewPane {
    private reactContainer: HTMLElement | null = null;
    private codemapReactView: any = null;

    static readonly ID = CODEMAP_VIEW_ID;
    static readonly TITLE = localize2('codemap', 'Codemap');

    constructor(
        options: IViewletViewOptions,
        @IThemeService themeService: IThemeService,
        @IViewDescriptorService viewDescriptorService: IViewDescriptorService,
        @IInstantiationService instantiationService: IInstantiationService,
        @IContextKeyService contextKeyService: IContextKeyService,
        @IContextMenuService contextMenuService: IContextMenuService,
        @IConfigurationService configurationService: IConfigurationService,
        @IOpenerService openerService: IOpenerService,
        @ITelemetryService telemetryService: ITelemetryService,
        @IWorkspaceContextService private workspaceContextService: IWorkspaceContextService,
        @ILogService private logService: ILogService,
    ) {
        super(options, new KeybindingService(contextKeyService), contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
    }

    protected renderBody(container: HTMLElement): void {
        super.renderBody(container);

        // Create the main container for the codemap
        this.reactContainer = document.createElement('div');
        this.reactContainer.className = 'codemap-react-container';
        this.reactContainer.style.width = '100%';
        this.reactContainer.style.height = '100%';
        container.appendChild(this.reactContainer);

        // Initialize React component
        this.initializeCodemapView();
    }

    protected layoutBody(height: number, width: number): void {
        super.layoutBody(height, width);

        // Update React component size
        if (this.codemapReactView && this.reactContainer) {
            this.reactContainer.style.width = `${width}px`;
            this.reactContainer.style.height = `${height}px`;
        }
    }

    private async initializeCodemapView(): Promise<void> {
        try {
            if (!this.reactContainer) {
                return;
            }

            // Get workspace path for initial query
            const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
            const workspacePath = workspaceFolders.length > 0 ? workspaceFolders[0].uri.path : '';

            // Create initial query
            const initialQuery = {
                scope: {
                    path: workspacePath,
                    includeTests: false
                }
            };

            // Create React codemap view
            this.codemapReactView = new CodemapReactView({
                width: this.reactContainer.clientWidth,
                height: this.reactContainer.clientHeight,
                initialQuery,
                onSymbolNavigate: (symbolId: string) => {
                    this.logService.info(`Navigate to symbol: ${symbolId}`);
                    // Implementation would navigate to symbol in editor
                },
                onFileOpen: (filePath: string, line: number, column: number) => {
                    this.logService.info(`Open file: ${filePath}:${line}:${column}`);
                    // Implementation would open file in editor
                    openerService.open(URI.file(filePath)).then(() => {
                        // Navigate to specific line/column
                    });
                }
            });

            // Add the React component to DOM
            this.reactContainer.appendChild(this.codemapReactView);

        } catch (error) {
            this.logService.error('Failed to initialize Codemap view:', error);

            // Show error message
            if (this.reactContainer) {
                this.reactContainer.innerHTML = `
                    <div style="
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        height: 100%;
                        color: var(--vscode-errorForeground);
                        text-align: center;
                        padding: 20px;
                    ">
                        <div>
                            <h3>Failed to load Code Map</h3>
                            <p>Please try refreshing the view or check the console for details.</p>
                        </div>
                    </div>
                `;
            }
        }
    }

    override dispose(): void {
        if (this.codemapReactView) {
            // Clean up React component
            if (this.codemapReactView.dispose) {
                this.codemapReactView.dispose();
            }
            this.codemapReactView = null;
        }

        super.dispose();
    }
}

export class CodemapViewPaneContainer extends ViewPaneContainer {
    static readonly ID = VIEW_CONTAINER_ID;
    static readonly TITLE = VIEW_CONTAINER_TITLE;

    constructor(
        @IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
        @ITelemetryService telemetryService: ITelemetryService,
        @IWorkspaceContextService contextService: IWorkspaceContextService,
        @IStorageService storageService: IStorageService,
        @IConfigurationService configurationService: IConfigurationService,
        @IInstantiationService instantiationService: IInstantiationService,
        @IContextKeyService contextKeyService: IContextKeyService,
        @IThemeService themeService: IThemeService,
        @IContextMenuService contextMenuService: IContextMenuService,
        @IExtensionService extensionService: IExtensionService,
        @IViewDescriptorService viewDescriptorService: IViewDescriptorService,
        @ILogService logService: ILogService,
    ) {
        super(
            VIEW_CONTAINER_ID,
            { mergeViewWithContainerWhenSingleView: true },
            instantiationService,
            configurationService,
            layoutService,
            contextMenuService,
            telemetryService,
            extensionService,
            themeService,
            storageService,
            contextService,
            viewDescriptorService,
            logService
        );
    }

    create(parent: HTMLElement): void {
        super.create(parent);
        // Additional initialization can go here
    }

    focus(): void {
        super.focus();
        // Focus handling logic
    }
}

// Register the view container
const viewContainerRegistry = Registry.as<IViewContainersRegistry>(Extensions.ViewContainersRegistry);
export const VIEW_CONTAINER: ViewContainer = viewContainerRegistry.registerViewContainer(
    {
        id: VIEW_CONTAINER_ID,
        title: VIEW_CONTAINER_TITLE,
        ctorDescriptor: new SyncDescriptor(CodemapViewPaneContainer),
        icon: codemapViewIcon,
        storageId: 'workbench.views.codemap',
        hideIfEmpty: true,
    },
    ViewContainerLocation.Sidebar
);

// Register the view
const viewsRegistry = Registry.as<IViewsRegistry>(Extensions.ViewsRegistry);
viewsRegistry.registerViewWelcomeContent(CODEMAP_VIEW_ID, {
    content: localize('codemap.welcome', 'Visualize and navigate your code structure with Codemap.'),
    preconditions: [CodemapViewVisibleContext],
});

// Register the view descriptor
viewsRegistry.registerViews([{
    id: CODEMAP_VIEW_ID,
    name: localize2('codemap', 'Codemap'),
    ctorDescriptor: new SyncDescriptor(CodemapView),
    containerIcon: codemapViewIcon,
    canToggleVisibility: true,
    canMoveView: true,
    weight: 100,
    order: 0,
    when: ContextKeyExpr.equals('workbench.explorer.visible', true),
}], VIEW_CONTAINER);

// Register as a workbench contribution
export class CodemapViewletViewsContribution extends Disposable implements IWorkbenchContribution {
    static readonly ID = 'workbench.contrib.codemapViewletViews';

    constructor() {
        super();
    }
}

// Register the contribution
Registry.as<IWorkbenchContributionsRegistry>(Extensions.Workbench).registerWorkbenchContribution(
    CodemapViewletViewsContribution,
    'CodemapViewletViewsContribution'
);
