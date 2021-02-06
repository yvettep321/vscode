/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import * as nls from 'vs/nls';
import * as platform from 'vs/base/common/platform';
import { Action, IAction, IActionViewItem } from 'vs/base/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextMenuService, IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService, IColorTheme, registerThemingParticipant, ICssStyleCollector } from 'vs/platform/theme/common/themeService';
import { TerminalFindWidget } from 'vs/workbench/contrib/terminal/browser/terminalFindWidget';
import { configureTerminalSettingsTitle, selectDefaultShellTitle, switchTerminalActionViewItemSeparator } from 'vs/workbench/contrib/terminal/browser/terminalActions';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { URI } from 'vs/base/common/uri';
import { TERMINAL_BACKGROUND_COLOR, TERMINAL_BORDER_COLOR } from 'vs/workbench/contrib/terminal/common/terminalColorRegistry';
import { DataTransfers } from 'vs/base/browser/dnd';
import { INotificationService, IPromptChoice, Severity } from 'vs/platform/notification/common/notification';
import { ITerminalService, TerminalConnectionState } from 'vs/workbench/contrib/terminal/browser/terminal';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { PANEL_BACKGROUND, SIDE_BAR_BACKGROUND } from 'vs/workbench/common/theme';
import { IMenu, IMenuService, MenuId } from 'vs/platform/actions/common/actions';
import { createAndFillInContextMenuActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { TERMINAL_COMMAND_ID } from 'vs/workbench/contrib/terminal/common/terminal';
import { SelectActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { ITerminalContributionService } from 'vs/workbench/contrib/terminal/common/terminalExtensionPoints';
import { attachSelectBoxStyler, attachStylerCallback } from 'vs/platform/theme/common/styler';
import { selectBorder } from 'vs/platform/theme/common/colorRegistry';
import { ISelectOptionItem } from 'vs/base/browser/ui/selectBox/selectBox';
import { equals } from 'vs/base/common/arrays';

const FIND_FOCUS_CLASS = 'find-focused';

export class TerminalViewPane extends ViewPane {
	private _menu: IMenu;
	private _actions: IAction[] | undefined;
	private _cancelContextMenu: boolean = false;
	private _fontStyleElement: HTMLElement | undefined;
	private _parentDomElement: HTMLElement | undefined;
	private _terminalContainer: HTMLElement | undefined;
	private _findWidget: TerminalFindWidget | undefined;
	private _terminalsInitialized = false;
	private _bodyDimensions: { width: number, height: number } = { width: 0, height: 0 };

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@IThemeService protected readonly themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IOpenerService openerService: IOpenerService,
		@IMenuService menuService: IMenuService,
	) {
		super(options, keybindingService, _contextMenuService, configurationService, contextKeyService, viewDescriptorService, _instantiationService, openerService, themeService, telemetryService);
		this._menu = this._register(menuService.createMenu(MenuId.TerminalContext, contextKeyService));
		this._terminalService.onDidRegisterProcessSupport(() => {
			if (this._actions) {
				for (const action of this._actions) {
					action.enabled = true;
				}
			}
			this._onDidChangeViewWelcomeState.fire();
		});
	}

	protected renderBody(container: HTMLElement): void {
		super.renderBody(container);
		if (this.shouldShowWelcome()) {
			return;
		}

		this._parentDomElement = container;
		this._parentDomElement.classList.add('integrated-terminal');
		this._fontStyleElement = document.createElement('style');

		this._terminalContainer = document.createElement('div');
		this._terminalContainer.classList.add('terminal-outer-container');

		this._findWidget = this._instantiationService.createInstance(TerminalFindWidget, this._terminalService.getFindState());
		this._findWidget.focusTracker.onDidFocus(() => this._terminalContainer!.classList.add(FIND_FOCUS_CLASS));

		this._parentDomElement.appendChild(this._fontStyleElement);
		this._parentDomElement.appendChild(this._terminalContainer);
		this._parentDomElement.appendChild(this._findWidget.getDomNode());

		this._attachEventListeners(this._parentDomElement, this._terminalContainer);

		this._terminalService.setContainers(container, this._terminalContainer);

		this._register(this.themeService.onDidColorThemeChange(theme => this._updateTheme(theme)));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('terminal.integrated.fontFamily') || e.affectsConfiguration('editor.fontFamily')) {
				const configHelper = this._terminalService.configHelper;
				if (!configHelper.configFontIsMonospace()) {
					const choices: IPromptChoice[] = [{
						label: nls.localize('terminal.useMonospace', "Use 'monospace'"),
						run: () => this.configurationService.updateValue('terminal.integrated.fontFamily', 'monospace'),
					}];
					this._notificationService.prompt(Severity.Warning, nls.localize('terminal.monospaceOnly', "The terminal only supports monospace fonts. Be sure to restart VS Code if this is a newly installed font."), choices);
				}
			}
		}));
		this._updateTheme();

		this._register(this.onDidChangeBodyVisibility(visible => {
			if (visible) {
				const hadTerminals = !!this._terminalService.terminalTabs.length;
				if (this._terminalsInitialized) {
					if (!hadTerminals) {
						this._terminalService.createTerminal();
					}
				} else {
					this._terminalsInitialized = true;
					this._terminalService.initializeTerminals();
				}

				this._updateTheme();
				if (hadTerminals) {
					this._terminalService.getActiveTab()?.setVisible(visible);
				} else {
					// TODO@Tyriar - this call seems unnecessary
					this.layoutBody(this._bodyDimensions.height, this._bodyDimensions.width);
				}
			} else {
				this._terminalService.getActiveTab()?.setVisible(false);
				this._terminalService.terminalInstances.forEach(instance => {
					instance.notifyFindWidgetFocusChanged(false);
				});
			}
		}));

		// Force another layout (first is setContainers) since config has changed
		this.layoutBody(this._terminalContainer.offsetHeight, this._terminalContainer.offsetWidth);
	}

	protected layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this.shouldShowWelcome()) {
			return;
		}

		this._bodyDimensions.width = width;
		this._bodyDimensions.height = height;
		this._terminalService.terminalTabs.forEach(t => t.layout(width, height));
	}

	public getActionViewItem(action: Action): IActionViewItem | undefined {
		if (action.id === TERMINAL_COMMAND_ID.SWITCH_TERMINAL) {
			return this._instantiationService.createInstance(SwitchTerminalActionViewItem, action);
		}

		return super.getActionViewItem(action);
	}

	public focus() {
		if (this._terminalService.connectionState === TerminalConnectionState.Connecting) {
			// If the terminal is waiting to reconnect to remote terminals, then there is no TerminalInstance yet that can
			// be focused. So wait for connection to finish, then focus.
			const activeElement = document.activeElement;
			this._register(this._terminalService.onDidChangeConnectionState(() => {
				// Only focus the terminal if the activeElement has not changed since focus() was called
				// TODO hack
				if (document.activeElement === activeElement) {
					this._focus();
				}
			}));

			return;
		}
		this._focus();
	}

	private _focus() {
		this._terminalService.getActiveInstance()?.focusWhenReady();
	}

	public focusFindWidget() {
		const activeInstance = this._terminalService.getActiveInstance();
		if (activeInstance && activeInstance.hasSelection() && activeInstance.selection!.indexOf('\n') === -1) {
			this._findWidget!.reveal(activeInstance.selection);
		} else {
			this._findWidget!.reveal();
		}
	}

	public hideFindWidget() {
		this._findWidget!.hide();
	}

	public showFindWidget() {
		const activeInstance = this._terminalService.getActiveInstance();
		if (activeInstance && activeInstance.hasSelection() && activeInstance.selection!.indexOf('\n') === -1) {
			this._findWidget!.show(activeInstance.selection);
		} else {
			this._findWidget!.show();
		}
	}

	public getFindWidget(): TerminalFindWidget {
		return this._findWidget!;
	}

	private _attachEventListeners(parentDomElement: HTMLElement, terminalContainer: HTMLElement): void {
		this._register(dom.addDisposableListener(parentDomElement, 'mousedown', async (event: MouseEvent) => {
			if (this._terminalService.terminalInstances.length === 0) {
				return;
			}

			if (event.which === 2 && platform.isLinux) {
				// Drop selection and focus terminal on Linux to enable middle button paste when click
				// occurs on the selection itself.
				const terminal = this._terminalService.getActiveInstance();
				if (terminal) {
					terminal.focus();
				}
			} else if (event.which === 3) {
				const rightClickBehavior = this._terminalService.configHelper.config.rightClickBehavior;
				if (rightClickBehavior === 'copyPaste' || rightClickBehavior === 'paste') {
					const terminal = this._terminalService.getActiveInstance();
					if (!terminal) {
						return;
					}

					// copyPaste: Shift+right click should open context menu
					if (rightClickBehavior === 'copyPaste' && event.shiftKey) {
						this._openContextMenu(event);
						return;
					}

					if (rightClickBehavior === 'copyPaste' && terminal.hasSelection()) {
						await terminal.copySelection();
						terminal.clearSelection();
					} else {
						terminal.paste();
					}
					// Clear selection after all click event bubbling is finished on Mac to prevent
					// right-click selecting a word which is seemed cannot be disabled. There is a
					// flicker when pasting but this appears to give the best experience if the
					// setting is enabled.
					if (platform.isMacintosh) {
						setTimeout(() => {
							terminal.clearSelection();
						}, 0);
					}
					this._cancelContextMenu = true;
				}
			}
		}));
		this._register(dom.addDisposableListener(parentDomElement, 'contextmenu', (event: MouseEvent) => {
			if (!this._cancelContextMenu) {
				this._openContextMenu(event);
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			this._cancelContextMenu = false;
		}));
		this._register(dom.addDisposableListener(document, 'keydown', (event: KeyboardEvent) => {
			terminalContainer.classList.toggle('alt-active', !!event.altKey);
		}));
		this._register(dom.addDisposableListener(document, 'keyup', (event: KeyboardEvent) => {
			terminalContainer.classList.toggle('alt-active', !!event.altKey);
		}));
		this._register(dom.addDisposableListener(parentDomElement, 'keyup', (event: KeyboardEvent) => {
			if (event.keyCode === 27) {
				// Keep terminal open on escape
				event.stopPropagation();
			}
		}));
		this._register(dom.addDisposableListener(parentDomElement, dom.EventType.DROP, async (e: DragEvent) => {
			if (e.target === this._parentDomElement || dom.isAncestor(e.target as HTMLElement, parentDomElement)) {
				if (!e.dataTransfer) {
					return;
				}

				// Check if files were dragged from the tree explorer
				let path: string | undefined;
				const resources = e.dataTransfer.getData(DataTransfers.RESOURCES);
				if (resources) {
					path = URI.parse(JSON.parse(resources)[0]).fsPath;
				} else if (e.dataTransfer.files.length > 0 && e.dataTransfer.files[0].path /* Electron only */) {
					// Check if the file was dragged from the filesystem
					path = URI.file(e.dataTransfer.files[0].path).fsPath;
				}

				if (!path) {
					return;
				}

				const terminal = this._terminalService.getActiveInstance();
				if (terminal) {
					const preparedPath = await this._terminalService.preparePathForTerminalAsync(path, terminal.shellLaunchConfig.executable, terminal.title, terminal.shellType);
					terminal.sendText(preparedPath, false);
					terminal.focus();
				}
			}
		}));
	}

	private _openContextMenu(event: MouseEvent): void {
		const standardEvent = new StandardMouseEvent(event);
		const anchor: { x: number, y: number } = { x: standardEvent.posx, y: standardEvent.posy };

		const actions: IAction[] = [];
		const actionsDisposable = createAndFillInContextMenuActions(this._menu, undefined, actions);

		this._contextMenuService.showContextMenu({
			getAnchor: () => anchor,
			getActions: () => actions,
			getActionsContext: () => this._parentDomElement,
			onHide: () => actionsDisposable.dispose()
		});
	}

	private _updateTheme(theme?: IColorTheme): void {
		if (!theme) {
			theme = this.themeService.getColorTheme();
		}

		this._findWidget?.updateTheme(theme);
	}

	shouldShowWelcome(): boolean {
		return !this._terminalService.isProcessSupportRegistered;
	}
}

registerThemingParticipant((theme: IColorTheme, collector: ICssStyleCollector) => {
	const panelBackgroundColor = theme.getColor(TERMINAL_BACKGROUND_COLOR) || theme.getColor(PANEL_BACKGROUND);
	collector.addRule(`.monaco-workbench .part.panel .pane-body.integrated-terminal .terminal-outer-container { background-color: ${panelBackgroundColor ? panelBackgroundColor.toString() : ''}; }`);

	const sidebarBackgroundColor = theme.getColor(TERMINAL_BACKGROUND_COLOR) || theme.getColor(SIDE_BAR_BACKGROUND);
	collector.addRule(`.monaco-workbench .part.sidebar .pane-body.integrated-terminal .terminal-outer-container { background-color: ${sidebarBackgroundColor ? sidebarBackgroundColor.toString() : ''}; }`);

	const borderColor = theme.getColor(TERMINAL_BORDER_COLOR);
	if (borderColor) {
		collector.addRule(`.monaco-workbench .pane-body.integrated-terminal .split-view-view:not(:first-child) { border-color: ${borderColor.toString()}; }`);
	}
});


class SwitchTerminalActionViewItem extends SelectActionViewItem {
	private _lastOptions: ISelectOptionItem[] = [];

	constructor(
		action: IAction,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@IThemeService private readonly _themeService: IThemeService,
		@ITerminalContributionService private readonly _contributions: ITerminalContributionService,
		@IContextViewService contextViewService: IContextViewService,
	) {
		super(null, action, getTerminalSelectOpenItems(_terminalService, _contributions), _terminalService.activeTabIndex, contextViewService, { ariaLabel: nls.localize('terminals', 'Open Terminals.'), optionsAsChildren: true });

		this._register(_terminalService.onInstancesChanged(this._updateItems, this));
		this._register(_terminalService.onActiveTabChanged(this._updateItems, this));
		this._register(_terminalService.onInstanceTitleChanged(this._updateItems, this));
		this._register(_terminalService.onTabDisposed(this._updateItems, this));
		this._register(_terminalService.onDidChangeConnectionState(this._updateItems, this));
		this._register(attachSelectBoxStyler(this.selectBox, this._themeService));
	}

	render(container: HTMLElement): void {
		super.render(container);
		container.classList.add('switch-terminal');
		this._register(attachStylerCallback(this._themeService, { selectBorder }, colors => {
			container.style.borderColor = colors.selectBorder ? `${colors.selectBorder}` : '';
		}));
	}

	private _updateItems(): void {
		const options = getTerminalSelectOpenItems(this._terminalService, this._contributions);
		// only update options if they've changed
		if (!equals(Object.values(options), Object.values(this._lastOptions))) {
			this.setOptions(options, this._terminalService.activeTabIndex);
			this._lastOptions = options;
		}
	}
}

function getTerminalSelectOpenItems(terminalService: ITerminalService, contributions: ITerminalContributionService): ISelectOptionItem[] {
	const items = terminalService.connectionState === TerminalConnectionState.Connected ?
		terminalService.getTabLabels().map(label => <ISelectOptionItem>{ text: label }) :
		[{ text: nls.localize('terminalConnectingLabel', "Starting...") }];

	items.push({ text: switchTerminalActionViewItemSeparator, isDisabled: true });

	for (const contributed of contributions.terminalTypes) {
		items.push({ text: contributed.title });
	}

	items.push({ text: selectDefaultShellTitle });
	items.push({ text: configureTerminalSettingsTitle });
	return items;
}
