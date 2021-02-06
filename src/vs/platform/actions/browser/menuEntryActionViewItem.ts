/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./menuEntryActionViewItem';
import { asCSSUrl, ModifierKeyEmitter } from 'vs/base/browser/dom';
import { domEvent } from 'vs/base/browser/event';
import { IAction, Separator } from 'vs/base/common/actions';
import { IDisposable, toDisposable, MutableDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { localize } from 'vs/nls';
import { ICommandAction, IMenu, IMenuActionOptions, MenuItemAction, SubmenuItemAction, Icon } from 'vs/platform/actions/common/actions';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { ActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { DropdownMenuActionViewItem } from 'vs/base/browser/ui/dropdown/dropdownActionViewItem';
import { isWindows, isLinux } from 'vs/base/common/platform';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';

export function createAndFillInContextMenuActions(menu: IMenu, options: IMenuActionOptions | undefined, target: IAction[] | { primary: IAction[]; secondary: IAction[]; }, isPrimaryGroup?: (group: string) => boolean): IDisposable {
	const groups = menu.getActions(options);
	const modifierKeyEmitter = ModifierKeyEmitter.getInstance();
	const useAlternativeActions = modifierKeyEmitter.keyStatus.altKey || ((isWindows || isLinux) && modifierKeyEmitter.keyStatus.shiftKey);
	fillInActions(groups, target, useAlternativeActions, isPrimaryGroup);
	return asDisposable(groups);
}

export function createAndFillInActionBarActions(menu: IMenu, options: IMenuActionOptions | undefined, target: IAction[] | { primary: IAction[]; secondary: IAction[]; }, isPrimaryGroup?: (group: string) => boolean, primaryMaxCount?: number): IDisposable {
	const groups = menu.getActions(options);
	// Action bars handle alternative actions on their own so the alternative actions should be ignored
	fillInActions(groups, target, false, isPrimaryGroup, primaryMaxCount);
	return asDisposable(groups);
}

function asDisposable(groups: ReadonlyArray<[string, ReadonlyArray<MenuItemAction | SubmenuItemAction>]>): IDisposable {
	const disposables = new DisposableStore();
	for (const [, actions] of groups) {
		for (const action of actions) {
			disposables.add(action);
		}
	}
	return disposables;
}

function fillInActions(groups: ReadonlyArray<[string, ReadonlyArray<MenuItemAction | SubmenuItemAction>]>, target: IAction[] | { primary: IAction[]; secondary: IAction[]; }, useAlternativeActions: boolean, isPrimaryGroup: (group: string) => boolean = group => group === 'navigation', primaryMaxCount: number = Number.MAX_SAFE_INTEGER): void {

	let primaryBucket: IAction[];
	let secondaryBucket: IAction[];
	if (Array.isArray(target)) {
		primaryBucket = target;
		secondaryBucket = target;
	} else {
		primaryBucket = target.primary;
		secondaryBucket = target.secondary;
	}

	for (let [group, actions] of groups) {
		if (useAlternativeActions) {
			actions = actions.map(a => (a instanceof MenuItemAction) && !!a.alt ? a.alt : a);
		}

		if (isPrimaryGroup(group)) {
			primaryBucket.unshift(...actions);
		} else {
			if (secondaryBucket.length > 0) {
				secondaryBucket.push(new Separator());
			}
			secondaryBucket.push(...actions);
		}
	}

	// overflow items from the primary group into the secondary bucket
	if (primaryBucket !== secondaryBucket && primaryBucket.length > primaryMaxCount) {
		const overflow = primaryBucket.splice(primaryMaxCount, primaryBucket.length - primaryMaxCount);
		secondaryBucket.unshift(...overflow, new Separator());
	}
}

export class MenuEntryActionViewItem extends ActionViewItem {

	private _wantsAltCommand: boolean = false;
	private readonly _itemClassDispose = this._register(new MutableDisposable());
	private readonly _altKey: ModifierKeyEmitter;

	constructor(
		readonly _action: MenuItemAction,
		@IKeybindingService protected readonly _keybindingService: IKeybindingService,
		@INotificationService protected _notificationService: INotificationService
	) {
		super(undefined, _action, { icon: !!(_action.class || _action.item.icon), label: !_action.class && !_action.item.icon });
		this._altKey = ModifierKeyEmitter.getInstance();
	}

	protected get _commandAction(): MenuItemAction {
		return this._wantsAltCommand && (<MenuItemAction>this._action).alt || this._action;
	}

	onClick(event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();

		this.actionRunner
			.run(this._commandAction, this._context)
			.catch(err => this._notificationService.error(err));
	}

	render(container: HTMLElement): void {
		super.render(container);
		container.classList.add('menu-entry');

		this._updateItemClass(this._action.item);

		let mouseOver = false;

		let alternativeKeyDown = this._altKey.keyStatus.altKey || ((isWindows || isLinux) && this._altKey.keyStatus.shiftKey);

		const updateAltState = () => {
			const wantsAltCommand = mouseOver && alternativeKeyDown;
			if (wantsAltCommand !== this._wantsAltCommand) {
				this._wantsAltCommand = wantsAltCommand;
				this.updateLabel();
				this.updateTooltip();
				this.updateClass();
			}
		};

		if (this._action.alt) {
			this._register(this._altKey.event(value => {
				alternativeKeyDown = value.altKey || ((isWindows || isLinux) && value.shiftKey);
				updateAltState();
			}));
		}

		this._register(domEvent(container, 'mouseleave')(_ => {
			mouseOver = false;
			updateAltState();
		}));

		this._register(domEvent(container, 'mouseenter')(e => {
			mouseOver = true;
			updateAltState();
		}));
	}

	updateLabel(): void {
		if (this.options.label && this.label) {
			this.label.textContent = this._commandAction.label;
		}
	}

	updateTooltip(): void {
		if (this.label) {
			const keybinding = this._keybindingService.lookupKeybinding(this._commandAction.id);
			const keybindingLabel = keybinding && keybinding.getLabel();

			const tooltip = this._commandAction.tooltip || this._commandAction.label;
			this.label.title = keybindingLabel
				? localize('titleAndKb', "{0} ({1})", tooltip, keybindingLabel)
				: tooltip;
		}
	}

	updateClass(): void {
		if (this.options.icon) {
			if (this._commandAction !== this._action) {
				if (this._action.alt) {
					this._updateItemClass(this._action.alt.item);
				}
			} else if ((<MenuItemAction>this._action).alt) {
				this._updateItemClass(this._action.item);
			}
		}
	}

	private _updateItemClass(item: ICommandAction): void {
		this._itemClassDispose.value = undefined;

		const { element, label } = this;
		if (!element || !label) {
			return;
		}

		const icon = this._commandAction.checked && (item.toggled as { icon?: Icon })?.icon ? (item.toggled as { icon: Icon }).icon : item.icon;

		if (!icon) {
			return;
		}

		if (ThemeIcon.isThemeIcon(icon)) {
			// theme icons
			const iconClass = ThemeIcon.asClassName(icon);
			label.classList.add(...iconClass.split(' '));
			this._itemClassDispose.value = toDisposable(() => {
				label.classList.remove(...iconClass.split(' '));
			});

		} else {
			// icon path/url
			if (icon.light) {
				label.style.setProperty('--menu-entry-icon-light', asCSSUrl(icon.light));
			}
			if (icon.dark) {
				label.style.setProperty('--menu-entry-icon-dark', asCSSUrl(icon.dark));
			}
			label.classList.add('icon');
			this._itemClassDispose.value = toDisposable(() => {
				label.classList.remove('icon');
				label.style.removeProperty('--menu-entry-icon-light');
				label.style.removeProperty('--menu-entry-icon-dark');
			});
		}
	}
}

export class SubmenuEntryActionViewItem extends DropdownMenuActionViewItem {

	constructor(
		action: SubmenuItemAction,
		@IContextMenuService contextMenuService: IContextMenuService
	) {
		super(action, { getActions: () => action.actions }, contextMenuService, {
			menuAsChild: true,
			classNames: ThemeIcon.isThemeIcon(action.item.icon) ? ThemeIcon.asClassName(action.item.icon) : undefined,
		});
	}

	render(container: HTMLElement): void {
		super.render(container);
		if (this.element) {
			container.classList.add('menu-entry');
			const { icon } = (<SubmenuItemAction>this._action).item;
			if (icon && !ThemeIcon.isThemeIcon(icon)) {
				this.element.classList.add('icon');
				if (icon.light) {
					this.element.style.setProperty('--menu-entry-icon-light', asCSSUrl(icon.light));
				}
				if (icon.dark) {
					this.element.style.setProperty('--menu-entry-icon-dark', asCSSUrl(icon.dark));
				}
			}
		}
	}
}

/**
 * Creates action view items for menu actions or submenu actions.
 */
export function createActionViewItem(instaService: IInstantiationService, action: IAction): undefined | MenuEntryActionViewItem | SubmenuEntryActionViewItem {
	if (action instanceof MenuItemAction) {
		return instaService.createInstance(MenuEntryActionViewItem, action);
	} else if (action instanceof SubmenuItemAction) {
		return instaService.createInstance(SubmenuEntryActionViewItem, action);
	} else {
		return undefined;
	}
}
