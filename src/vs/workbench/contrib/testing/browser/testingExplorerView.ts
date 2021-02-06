/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { IIdentityProvider, IKeyboardNavigationLabelProvider, IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { DefaultKeyboardNavigationDelegate, IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { ICompressedTreeNode } from 'vs/base/browser/ui/tree/compressedObjectTreeModel';
import { ObjectTree } from 'vs/base/browser/ui/tree/objectTree';
import { ITreeEvent, ITreeFilter, ITreeNode, ITreeRenderer, ITreeSorter, TreeFilterResult, TreeVisibility } from 'vs/base/browser/ui/tree/tree';
import * as aria from 'vs/base/browser/ui/aria/aria';
import { Action, IAction, IActionViewItem } from 'vs/base/common/actions';
import { DeferredPromise } from 'vs/base/common/async';
import { Color, RGBA } from 'vs/base/common/color';
import { throttle } from 'vs/base/common/decorators';
import { Event } from 'vs/base/common/event';
import { FuzzyScore } from 'vs/base/common/filters';
import { splitGlobAware } from 'vs/base/common/glob';
import { Iterable } from 'vs/base/common/iterator';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from 'vs/base/common/lifecycle';
import 'vs/css!./media/testing';
import { ICodeEditor, isCodeEditor } from 'vs/editor/browser/editorBrowser';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { localize } from 'vs/nls';
import { MenuEntryActionViewItem } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { MenuItemAction } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { FileKind } from 'vs/platform/files/common/files';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { WorkbenchObjectTree } from 'vs/platform/list/browser/listService';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IProgress, IProgressService, IProgressStep } from 'vs/platform/progress/common/progress';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { foreground } from 'vs/platform/theme/common/colorRegistry';
import { IThemeService, registerThemingParticipant, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { TestRunState } from 'vs/workbench/api/common/extHostTypes';
import { IResourceLabel, IResourceLabelOptions, IResourceLabelProps, ResourceLabels } from 'vs/workbench/browser/labels';
import { ViewPane } from 'vs/workbench/browser/parts/views/viewPane';
import { IViewletViewOptions } from 'vs/workbench/browser/parts/views/viewsViewlet';
import { IViewDescriptorService, ViewContainerLocation } from 'vs/workbench/common/views';
import { ITestTreeElement, ITestTreeProjection } from 'vs/workbench/contrib/testing/browser/explorerProjections';
import { HierarchicalByLocationProjection } from 'vs/workbench/contrib/testing/browser/explorerProjections/hierarchalByLocation';
import { HierarchicalByNameProjection } from 'vs/workbench/contrib/testing/browser/explorerProjections/hierarchalByName';
import { getComputedState } from 'vs/workbench/contrib/testing/browser/explorerProjections/hierarchalNodes';
import { StateByLocationProjection } from 'vs/workbench/contrib/testing/browser/explorerProjections/stateByLocation';
import { StateByNameProjection } from 'vs/workbench/contrib/testing/browser/explorerProjections/stateByName';
import { StateElement } from 'vs/workbench/contrib/testing/browser/explorerProjections/stateNodes';
import { testingStatesToIcons } from 'vs/workbench/contrib/testing/browser/icons';
import { ITestExplorerFilterState, TestExplorerFilterState, TestingExplorerFilter } from 'vs/workbench/contrib/testing/browser/testingExplorerFilter';
import { TestingOutputPeekController } from 'vs/workbench/contrib/testing/browser/testingOutputPeek';
import { TestExplorerViewGrouping, TestExplorerViewMode, Testing, testStateNames } from 'vs/workbench/contrib/testing/common/constants';
import { TestingContextKeys } from 'vs/workbench/contrib/testing/common/testingContextKeys';
import { cmpPriority, isFailedState } from 'vs/workbench/contrib/testing/common/testingStates';
import { buildTestUri, TestUriType } from 'vs/workbench/contrib/testing/common/testingUri';
import { ITestResultService, sumCounts, TestStateCount } from 'vs/workbench/contrib/testing/common/testResultService';
import { ITestService } from 'vs/workbench/contrib/testing/common/testService';
import { IWorkspaceTestCollectionService, TestSubscriptionListener } from 'vs/workbench/contrib/testing/common/workspaceTestCollectionService';
import { IActivityService, NumberBadge, ProgressBadge } from 'vs/workbench/services/activity/common/activity';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { DebugAction, RunAction } from './testExplorerActions';

export class TestingExplorerView extends ViewPane {
	public viewModel!: TestingExplorerViewModel;
	private filterActionBar = this._register(new MutableDisposable());
	private currentSubscription?: TestSubscriptionListener;
	private container!: HTMLElement;
	private finishDiscovery?: () => void;
	private readonly location = TestingContextKeys.explorerLocation.bindTo(this.contextKeyService);;

	constructor(
		options: IViewletViewOptions,
		@IWorkspaceTestCollectionService private readonly testCollection: IWorkspaceTestCollectionService,
		@ITestService private readonly testService: ITestService,
		@IProgressService private readonly progress: IProgressService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
		this._register(testService.onDidChangeProviders(() => this._onDidChangeViewWelcomeState.fire()));
		this.location.set(viewDescriptorService.getViewLocationById(Testing.ExplorerViewId) ?? ViewContainerLocation.Sidebar);
	}

	/**
	 * @override
	 */
	public shouldShowWelcome() {
		return this.testService.providers === 0;
	}

	/**
	 * @override
	 */
	protected renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this.container = dom.append(container, dom.$('.test-explorer'));

		if (this.location.get() === ViewContainerLocation.Sidebar) {
			this.filterActionBar.value = this.createFilterActionBar();
		}

		const messagesContainer = dom.append(this.container, dom.$('.test-explorer-messages'));
		this._register(this.instantiationService.createInstance(TestRunProgress, messagesContainer, this.getProgressLocation()));

		const listContainer = dom.append(this.container, dom.$('.test-explorer-tree'));
		this.viewModel = this.instantiationService.createInstance(TestingExplorerViewModel, listContainer, this.onDidChangeBodyVisibility, this.currentSubscription);
		this._register(this.viewModel);

		this._register(this.onDidChangeBodyVisibility(visible => {
			if (!visible && this.currentSubscription) {
				this.currentSubscription.dispose();
				this.currentSubscription = undefined;
				this.viewModel.replaceSubscription(undefined);
			} else if (visible && !this.currentSubscription) {
				this.currentSubscription = this.createSubscription();
				this.viewModel.replaceSubscription(this.currentSubscription);
			}
		}));
	}

	/**
	 * @override
	 */
	public getActionViewItem(action: IAction): IActionViewItem | undefined {
		if (action.id === Testing.FilterActionId) {
			return this.instantiationService.createInstance(TestingExplorerFilter, action);
		}

		return super.getActionViewItem(action);
	}

	/**
	 * @override
	 */
	public saveState() {
		super.saveState();
	}

	private createFilterActionBar() {
		const bar = new ActionBar(this.container, { actionViewItemProvider: action => this.getActionViewItem(action) });
		bar.push(new Action(Testing.FilterActionId));
		bar.getContainer().classList.add('testing-filter-action-bar');
		return bar;
	}

	private updateDiscoveryProgress(busy: number) {
		if (!busy && this.finishDiscovery) {
			this.finishDiscovery();
			this.finishDiscovery = undefined;
		} else if (busy && !this.finishDiscovery) {
			const promise = new Promise<void>(resolve => { this.finishDiscovery = resolve; });
			this.progress.withProgress({ location: this.getProgressLocation() }, () => promise);
		}
	}

	/**
	 * @override
	 */
	protected layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.container.style.height = `${height}px`;
		this.viewModel.layout(height, width);
	}

	private createSubscription() {
		const handle = this.testCollection.subscribeToWorkspaceTests();
		handle.subscription.onBusyProvidersChange(() => this.updateDiscoveryProgress(handle.subscription.busyProviders));
		return handle;
	}
}

export class TestingExplorerViewModel extends Disposable {
	public tree: ObjectTree<ITestTreeElement, FuzzyScore>;
	private filter: TestsFilter;
	public projection!: ITestTreeProjection;

	private readonly _viewMode = TestingContextKeys.viewMode.bindTo(this.contextKeyService);
	private readonly _viewGrouping = TestingContextKeys.viewGrouping.bindTo(this.contextKeyService);

	/**
	 * Fires when the selected tests change.
	 */
	public readonly onDidChangeSelection: Event<ITreeEvent<ITestTreeElement | null>>;

	public get viewMode() {
		return this._viewMode.get() ?? TestExplorerViewMode.Tree;
	}

	public set viewMode(newMode: TestExplorerViewMode) {
		if (newMode === this._viewMode.get()) {
			return;
		}

		this._viewMode.set(newMode);
		this.updatePreferredProjection();
		this.storageService.store('testing.viewMode', newMode, StorageScope.WORKSPACE, StorageTarget.USER);
	}


	public get viewGrouping() {
		return this._viewGrouping.get() ?? TestExplorerViewGrouping.ByLocation;
	}

	public set viewGrouping(newGrouping: TestExplorerViewGrouping) {
		if (newGrouping === this._viewGrouping.get()) {
			return;
		}

		this._viewGrouping.set(newGrouping);
		this.updatePreferredProjection();
		this.storageService.store('testing.viewGrouping', newGrouping, StorageScope.WORKSPACE, StorageTarget.USER);
	}

	constructor(
		listContainer: HTMLElement,
		onDidChangeVisibility: Event<boolean>,
		private listener: TestSubscriptionListener | undefined,
		@ITestExplorerFilterState filterState: TestExplorerFilterState,
		@IInstantiationService instantiationService: IInstantiationService,
		@IEditorService private readonly editorService: IEditorService,
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@IStorageService private readonly storageService: IStorageService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
	) {
		super();

		this._viewMode.set(this.storageService.get('testing.viewMode', StorageScope.WORKSPACE, TestExplorerViewMode.Tree) as TestExplorerViewMode);
		this._viewGrouping.set(this.storageService.get('testing.viewGrouping', StorageScope.WORKSPACE, TestExplorerViewGrouping.ByLocation) as TestExplorerViewGrouping);

		const labels = this._register(instantiationService.createInstance(ResourceLabels, { onDidChangeVisibility: onDidChangeVisibility }));

		this.filter = new TestsFilter(filterState.value);

		this._register(filterState.onDidChange(text => {
			this.filter.setFilter(text);
			this.tree.refilter();
		}));

		this.tree = instantiationService.createInstance(
			WorkbenchObjectTree,
			'Test Explorer List',
			listContainer,
			new ListDelegate(),
			[
				instantiationService.createInstance(TestsRenderer, labels)
			],
			{
				simpleKeyboardNavigation: true,
				identityProvider: instantiationService.createInstance(IdentityProvider),
				hideTwistiesOfChildlessElements: true,
				sorter: instantiationService.createInstance(TreeSorter),
				keyboardNavigationLabelProvider: instantiationService.createInstance(TreeKeyboardNavigationLabelProvider),
				accessibilityProvider: instantiationService.createInstance(ListAccessibilityProvider),
				filter: this.filter,
			}) as WorkbenchObjectTree<ITestTreeElement, FuzzyScore>;
		this._register(this.tree);

		this._register(dom.addStandardDisposableListener(this.tree.getHTMLElement(), 'keydown', evt => {
			if (DefaultKeyboardNavigationDelegate.mightProducePrintableCharacter(evt)) {
				filterState.value = evt.browserEvent.key;
				filterState.focusInput();
			}
		}));

		this.updatePreferredProjection();

		this.onDidChangeSelection = this.tree.onDidChangeSelection;
		this._register(this.tree.onDidChangeSelection(evt => {
			const selected = evt.elements[0];
			if (selected && evt.browserEvent) {
				this.openEditorForItem(selected);
			}
		}));

		const tracker = this._register(new CodeEditorTracker(codeEditorService, this));
		this._register(onDidChangeVisibility(visible => {
			if (visible) {
				tracker.activate();
			} else {
				tracker.deactivate();
			}
		}));
	}

	/**
	 * Re-layout the tree.
	 */
	public layout(height: number, width: number): void {
		this.tree.layout(height, width);
	}

	/**
	 * Replaces the test listener and recalculates the tree.
	 */
	public replaceSubscription(listener: TestSubscriptionListener | undefined) {
		this.listener = listener;
		this.updatePreferredProjection();
	}

	/**
	 * Reveals and moves focus to the item.
	 */
	public async revealItem(item: ITestTreeElement, reveal = true): Promise<void> {
		if (!this.tree.hasElement(item)) {
			return;
		}

		const chain: ITestTreeElement[] = [];
		for (let parent = item.parentItem; parent; parent = parent.parentItem) {
			chain.push(parent);
		}

		for (const parent of chain.reverse()) {
			try {
				this.tree.expand(parent);
			} catch {
				// ignore if not present
			}
		}

		if (reveal === true && this.tree.getRelativeTop(item) === null) {
			// Don't scroll to the item if it's already visible, or if set not to.
			this.tree.reveal(item, 0.5);
		}

		this.tree.setFocus([item]);
		this.tree.setSelection([item]);
	}

	/**
	 * Collapse all items in the tree.
	 */
	public async collapseAll() {
		this.tree.collapseAll();
	}

	/**
	 * Opens an editor for the item. If there is a failure associated with the
	 * test item, it will be shown.
	 */
	public async openEditorForItem(item: ITestTreeElement, preserveFocus = true) {
		if (await this.tryPeekError(item)) {
			return;
		}

		const location = item?.location;
		if (!location) {
			return;
		}

		const pane = await this.editorService.openEditor({
			resource: location.uri,
			options: {
				selection: { startColumn: location.range.startColumn, startLineNumber: location.range.startLineNumber },
				preserveFocus,
			},
		});

		// if the user selected a failed test and now they didn't, hide the peek
		const control = pane?.getControl();
		if (isCodeEditor(control)) {
			TestingOutputPeekController.get(control).removePeek();
		}
	}

	/**
	 * Tries to peek the first test error, if the item is in a failed state.
	 */
	private async tryPeekError(item: ITestTreeElement) {
		if (!item.test || !isFailedState(item.test.item.state.runState)) {
			return false;
		}

		const index = item.test.item.state.messages.findIndex(m => !!m.location);
		if (index === -1) {
			return;
		}

		const message = item.test.item.state.messages[index];
		const pane = await this.editorService.openEditor({
			resource: message.location!.uri,
			options: { selection: message.location!.range, preserveFocus: true }
		});

		const control = pane?.getControl();
		if (!isCodeEditor(control)) {
			return false;
		}

		TestingOutputPeekController.get(control).show(buildTestUri({
			type: TestUriType.LiveMessage,
			messageIndex: index,
			providerId: item.test.providerId,
			testId: item.test.id,
		}));

		return true;
	}

	private updatePreferredProjection() {
		this.projection?.dispose();
		if (!this.listener) {
			this.tree.setChildren(null, []);
			return;
		}

		if (this._viewGrouping.get() === TestExplorerViewGrouping.ByLocation) {
			if (this._viewMode.get() === TestExplorerViewMode.List) {
				this.projection = new HierarchicalByNameProjection(this.listener);
			} else {
				this.projection = new HierarchicalByLocationProjection(this.listener);
			}
		} else {
			if (this._viewMode.get() === TestExplorerViewMode.List) {
				this.projection = new StateByNameProjection(this.listener);
			} else {
				this.projection = new StateByLocationProjection(this.listener);
			}
		}

		this.projection.onUpdate(this.deferUpdate, this);
		this.projection.applyTo(this.tree);
	}

	@throttle(200)
	private deferUpdate() {
		this.projection.applyTo(this.tree);
	}

	/**
	 * Gets the selected tests from the tree.
	 */
	public getSelectedTests() {
		return this.tree.getSelection();
	}
}

class CodeEditorTracker {
	private store = new DisposableStore();
	private lastRevealed?: ITestTreeElement;

	constructor(@ICodeEditorService private readonly codeEditorService: ICodeEditorService, private readonly model: TestingExplorerViewModel) {
	}

	public activate() {
		const editorStores = new Set<DisposableStore>();
		this.store.add(toDisposable(() => {
			for (const store of editorStores) {
				store.dispose();
			}
		}));

		const register = (editor: ICodeEditor) => {
			const store = new DisposableStore();
			editorStores.add(store);

			store.add(editor.onDidChangeCursorPosition(evt => {
				const uri = editor.getModel()?.uri;
				if (!uri) {
					return;
				}

				const test = this.model.projection.getTestAtPosition(uri, evt.position);
				if (test && test !== this.lastRevealed) {
					this.model.revealItem(test);
					this.lastRevealed = test;
				}
			}));

			editor.onDidDispose(() => {
				store.dispose();
				editorStores.delete(store);
			});
		};

		this.store.add(this.codeEditorService.onCodeEditorAdd(register));
		this.codeEditorService.listCodeEditors().forEach(register);
	}

	public deactivate() {
		this.store.dispose();
		this.store = new DisposableStore();
	}

	public dispose() {
		this.store.dispose();
	}
}

const enum FilterResult {
	Include,
	Exclude,
	Inherit,
}

class TestsFilter implements ITreeFilter<ITestTreeElement> {
	private filters: [include: boolean, value: string][] | undefined;

	constructor(initialFilter: string) {
		this.setFilter(initialFilter);
	}

	/**
	 * Parses and updates the tree filter. Supports lists of patterns that can be !negated.
	 */
	public setFilter(text: string) {
		text = text.trim();

		if (!text) {
			this.filters = undefined;
			return;
		}

		this.filters = [];
		for (const filter of splitGlobAware(text, ',').map(s => s.trim()).filter(s => !!s.length)) {
			if (filter.startsWith('!')) {
				this.filters.push([false, filter.slice(1).toLowerCase()]);
			} else {
				this.filters.push([true, filter.toLowerCase()]);
			}
		}
	}

	public filter(element: ITestTreeElement): TreeFilterResult<void> {
		for (let e: ITestTreeElement | null = element; e; e = e.parentItem) {
			switch (this.testFilterText(e.label)) {
				case FilterResult.Exclude:
					return TreeVisibility.Hidden;
				case FilterResult.Include:
					return TreeVisibility.Visible;
				case FilterResult.Inherit:
				// continue to parent
			}
		}

		return TreeVisibility.Recurse;
	}

	private testFilterText(data: string) {
		if (!this.filters) {
			return FilterResult.Include;
		}

		// start as included if the first glob is a negation
		let included = this.filters[0][0] === false ? FilterResult.Exclude : FilterResult.Inherit;
		data = data.toLowerCase();

		for (const [include, filter] of this.filters) {
			if (data.includes(filter)) {
				included = include ? FilterResult.Include : FilterResult.Exclude;
			}
		}

		return included;
	}
}

class TreeSorter implements ITreeSorter<ITestTreeElement> {
	public compare(a: ITestTreeElement, b: ITestTreeElement): number {
		if (a instanceof StateElement && b instanceof StateElement) {
			return cmpPriority(a.computedState, b.computedState);
		}

		return a.label.localeCompare(b.label);
	}
}

class ListAccessibilityProvider implements IListAccessibilityProvider<ITestTreeElement> {
	getWidgetAriaLabel(): string {
		return localize('testExplorer', "Test Explorer");
	}

	getAriaLabel(element: ITestTreeElement): string {
		return localize({
			key: 'testing.treeElementLabel',
			comment: ['label then the unit tests state, for example "Addition Tests (Running)"'],
		}, '{0} ({1})', element.label, testStateNames[getComputedState(element)]);
	}
}

class TreeKeyboardNavigationLabelProvider implements IKeyboardNavigationLabelProvider<ITestTreeElement> {
	getKeyboardNavigationLabel(element: ITestTreeElement) {
		return element.label;
	}
}

class ListDelegate implements IListVirtualDelegate<ITestTreeElement> {
	getHeight(_element: ITestTreeElement) {
		return 22;
	}

	getTemplateId(_element: ITestTreeElement) {
		return TestsRenderer.ID;
	}
}

class IdentityProvider implements IIdentityProvider<ITestTreeElement> {
	public getId(element: ITestTreeElement) {
		return element.treeId;
	}
}

interface TestTemplateData {
	label: IResourceLabel;
	icon: HTMLElement;
	actionBar: ActionBar;
}

class TestsRenderer implements ITreeRenderer<ITestTreeElement, FuzzyScore, TestTemplateData> {
	public static readonly ID = 'testExplorer';

	constructor(
		private labels: ResourceLabels,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) { }

	renderCompressedElements(node: ITreeNode<ICompressedTreeNode<ITestTreeElement>, FuzzyScore>, index: number, templateData: TestTemplateData): void {
		const element = node.element.elements[node.element.elements.length - 1];
		this.renderElementDirect(element, templateData);
	}

	get templateId(): string {
		return TestsRenderer.ID;
	}

	public renderTemplate(container: HTMLElement): TestTemplateData {
		const wrapper = dom.append(container, dom.$('.test-item'));

		const icon = dom.append(wrapper, dom.$('.computed-state'));
		const name = dom.append(wrapper, dom.$('.name'));
		const label = this.labels.create(name, { supportHighlights: true });

		const actionBar = new ActionBar(wrapper, {
			actionViewItemProvider: action =>
				action instanceof MenuItemAction
					? this.instantiationService.createInstance(MenuEntryActionViewItem, action)
					: undefined
		});

		return { label, actionBar, icon };
	}

	public renderElement(node: ITreeNode<ITestTreeElement, FuzzyScore>, index: number, data: TestTemplateData): void {
		this.renderElementDirect(node.element, data);
	}

	private renderElementDirect(element: ITestTreeElement, data: TestTemplateData) {
		const label: IResourceLabelProps = { name: element.label };
		const options: IResourceLabelOptions = {};
		data.actionBar.clear();

		const state = getComputedState(element);
		const icon = testingStatesToIcons.get(state);
		data.icon.className = 'computed-state ' + (icon ? ThemeIcon.asClassName(icon) : '');
		const test = element.test;
		if (test) {
			if (test.item.location) {
				label.resource = test.item.location.uri;
			}

			let title = element.label;
			for (let p = element.parentItem; p; p = p.parentItem) {
				title = `${p.label}, ${title}`;
			}

			options.title = title;
			options.fileKind = FileKind.FILE;
			label.description = element.description;
		} else {
			options.fileKind = FileKind.ROOT_FOLDER;
		}

		const running = state === TestRunState.Running;
		if (!Iterable.isEmpty(element.runnable)) {
			data.actionBar.push(
				this.instantiationService.createInstance(RunAction, element.runnable, running),
				{ icon: true, label: false },
			);
		}

		if (!Iterable.isEmpty(element.debuggable)) {
			data.actionBar.push(
				this.instantiationService.createInstance(DebugAction, element.debuggable, running),
				{ icon: true, label: false },
			);
		}

		data.label.setResource(label, options);
	}

	disposeTemplate(templateData: TestTemplateData): void {
		templateData.label.dispose();
		templateData.actionBar.dispose();
	}
}

const collectCounts = (count: TestStateCount) => {
	const failed = count[TestRunState.Errored] + count[TestRunState.Failed];
	const passed = count[TestRunState.Passed];
	const skipped = count[TestRunState.Skipped];

	return {
		passed,
		failed,
		runSoFar: passed + failed,
		totalWillBeRun: passed + failed + count[TestRunState.Queued] + count[TestRunState.Running],
		skipped,
	};
};

const getProgressText = ({ passed, runSoFar, skipped }: { passed: number, runSoFar: number, skipped: number }) => {
	const percent = (passed / runSoFar * 100).toFixed(0);
	if (skipped === 0) {
		return localize('testProgress', '{0}/{1} tests passed ({2}%)', passed, runSoFar, percent);
	} else {
		return localize('testProgressWithSkip', '{0}/{1} tests passed ({2}%, {3} skipped)', passed, runSoFar, percent, skipped);
	}
};

class TestRunProgress {
	private current?: { update: IProgress<IProgressStep>; deferred: DeferredPromise<void> };
	private badge = new MutableDisposable();
	private readonly resultLister = this.resultService.onNewTestResult(result => {
		this.updateProgress();
		this.updateBadge();

		result.onChange(this.throttledProgressUpdate, this);
		result.onComplete(() => {
			this.throttledProgressUpdate();
			this.updateBadge();
		});
	});

	constructor(
		private readonly messagesContainer: HTMLElement,
		private readonly location: string,
		@IProgressService private readonly progress: IProgressService,
		@ITestResultService private readonly resultService: ITestResultService,
		@IActivityService private readonly activityService: IActivityService,
	) {
	}

	public dispose() {
		this.resultLister.dispose();
		this.current?.deferred.complete();
		this.badge.dispose();
	}

	@throttle(200)
	private throttledProgressUpdate() {
		this.updateProgress();
	}

	private updateProgress() {
		const running = this.resultService.results.filter(r => !r.isComplete);
		if (!running.length) {
			this.setIdleText(this.resultService.results[0]?.counts);
			this.current?.deferred.complete();
			this.current = undefined;
		} else if (!this.current) {
			this.progress.withProgress({ location: this.location, total: 100 }, update => {
				this.current = { update, deferred: new DeferredPromise() };
				this.updateProgress();
				return this.current.deferred.p;
			});
		} else {
			const counts = sumCounts(running.map(r => r.counts));
			this.setRunningText(counts);
			const { runSoFar, totalWillBeRun } = collectCounts(counts);
			this.current.update.report({ increment: runSoFar, total: totalWillBeRun });
		}
	}

	private setRunningText(counts: TestStateCount) {
		this.messagesContainer.dataset.state = 'running';

		const collected = collectCounts(counts);
		if (collected.runSoFar === 0) {
			this.messagesContainer.innerText = localize('testResultStarting', 'Test run is starting...');
		} else {
			this.messagesContainer.innerText = getProgressText(collected);
		}
	}

	private setIdleText(lastCount?: TestStateCount) {
		if (!lastCount) {
			this.messagesContainer.innerText = '';
		} else {
			const collected = collectCounts(lastCount);
			this.messagesContainer.dataset.state = collected.failed ? 'failed' : 'running';
			const doneMessage = getProgressText(collected);
			this.messagesContainer.innerText = doneMessage;
			aria.alert(doneMessage);
		}
	}

	private updateBadge() {
		this.badge.value = undefined;
		const result = this.resultService.results[0]; // currently running, or last run
		if (!result) {
			return;
		}

		if (!result.isComplete) {
			const badge = new ProgressBadge(() => localize('testBadgeRunning', 'Test run in progress'));
			this.badge.value = this.activityService.showViewActivity(Testing.ExplorerViewId, { badge, clazz: 'progress-badge' });
			return;
		}

		const failures = result.counts[TestRunState.Failed] + result.counts[TestRunState.Errored];
		if (failures === 0) {
			return;
		}

		const badge = new NumberBadge(failures, () => localize('testBadgeFailures', '{0} tests failed', failures));
		this.badge.value = this.activityService.showViewActivity(Testing.ExplorerViewId, { badge });
	}
}

registerThemingParticipant((theme, collector) => {
	if (theme.type === 'dark') {
		const foregroundColor = theme.getColor(foreground);
		if (foregroundColor) {
			const fgWithOpacity = new Color(new RGBA(foregroundColor.rgba.r, foregroundColor.rgba.g, foregroundColor.rgba.b, 0.65));
			collector.addRule(`.test-explorer .test-explorer-messages { color: ${fgWithOpacity}; }`);
		}
	}
});
