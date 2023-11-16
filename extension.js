/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Keyboard from 'resource:///org/gnome/shell/ui/status/keyboard.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Keyboards, ProcInputDevicesPoller, PluggedKbdSettings} from './pluggedKbd.js';

const ism = Keyboard.getInputSourceManager();

/**
 * Display an inputDevice as a MenuItem
 */
var LayoutMenuItem = GObject.registerClass(
    class LayoutMenuItem extends PopupMenu.PopupBaseMenuItem {
        /**
         * Init this as gobject.
         *
         * @param {InputDevice} dev the keyboard to display
         * @param {boolean} isCurrent is this keyboard current
         */
        _init(dev, isCurrent) {
            super._init();
            // Name in italics if  not connected
            this.dev = dev;
            this.label = new St.Label({
                text: dev.displayName,
                x_expand: true,
            });
            this.label.clutter_text.set_markup(this._devName());

            this.indicator = new St.Label({text: this._isName()});
            this.add_child(this.label);
            this.add(this.indicator);
            this.label_actor = this.label;
            if (isCurrent)
                this.setOrnament(PopupMenu.Ornament.DOT);
        }

        /**
         * Keyboard name.
         *
         * @returns the name of the keyboard, in italic if not connected
         */
        _devName() {
            if (this.dev.connected)
                return this.dev.displayName;
            else
                return `<i>${this.dev.displayName}</i>`;
        }

        /**
         * Input Source Name.
         *
         * @returns the short name of the associated input source
         */
        _isName() {
            if (this.dev.associated)
                return this.dev.associated.shortName;
            return '';
        }

        update(isCurrent) {
            this.label.clutter_text.set_markup(this._devName());
            this.indicator.text = this._isName();
            if (isCurrent)
                this.setOrnament(PopupMenu.Ornament.DOT);
            else
                this.setOrnament(PopupMenu.Ornament.NONE);
        }
    });



export default class PluggedKbdExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._monitor = null;
        // Timeout for forcing input method
        this._timeout = null;
        this._devices = null;
        this._settings = null;
        // Signal handlers
        this._ism_handler = null;
        this._device_handler1 = null;
        this._device_handler2 = null;
        this._settings_handler = null;
        this._detector_handler1 = null;
        this._detector_handler2 = null;
    }

    /**
     * Update menu item according to the model.
     */
    _updateSubmenu() {
        if (!this.menuItem)
            return;

        // Display connected and associated keyboard (even if not plugged)
        if (this._devices.size()) {
            this.menuItem.show();
            if (this._devices.current) {
                // a device is currently controlling input source
                this.menuItem.label.text = this._devices.current.displayName;
            } else {
                // some devices are connected, but no one control the input source
                this.menuItem.label.text = _('Keyboards');
            }
            this.menuItem.sensitive = true;
            // Remove all subs that are not in device
            for (const [kbdId, sub] of this.subs.entries()) {
                if (!this._devices.has(kbdId)) {
                    this.subs.delete(kbdId);
                    sub.destroy();
                }
            }
            // Iterate over devices, sorted by priority
            const devs = [...this._devices.values()];
            devs.sort((a, b) => {
                return a.prio - b.prio;
            });
            for (const dev of devs) {
                let cur = this._devices.current === dev;
                let sub;
                if (this.subs.has(dev.id)) {
                    // Menu item already there, update
                    sub = this.subs.get(dev.id);
                    sub.update(cur);
                } else {
                    // Create new menu item
                    sub = new LayoutMenuItem(dev, cur);
                    sub.connect('activate', (item, event) => {
                        // Do something special for pointer buttons
                        if (event.type() === Clutter.EventType.BUTTON_RELEASE)
                            this._toggle(dev);
                        return Clutter.EVENT_PROPAGATE;
                    });
                    this.menuItem.menu.addMenuItem(sub);
                    this.subs.set(dev.id, sub);
                }
            }
        } else {
            if (!this._settings.alwaysShowMenuitem)
                this.menuItem.hide();
            this.menuItem.menu.removeAll();
            this.subs.clear();
            // Maybe just hide menu item
            this.menuItem.label.text = _('No external keyboards');
            this.menuItem.sensitive = false;
        }
    }

    /**
     * Callback called when the submenu item is clicked.
     *
     * @param {InputDevice} dev the device that was clicked
     */
    _toggle(dev) {
        if (dev.associated) {
            // deassociate
            this._devices.deassociate(dev);
        } else {
            // associate to current source
            this._devices.associate(dev, ism.currentSource);
        }
    }

    /**
     * Force input source to connected and associated keyboard
     */
    _force() {
        if (!this._settings.teachIn)
            this._devices.forceInputSource();
        // continue periodic call
        return true;
    }

    enable() {
        const extensionObject = Extension.lookupByURL(import.meta.url);
        this._settings = new PluggedKbdSettings(extensionObject);
        this._devices = new Keyboards(ism);
        this._detector = new ProcInputDevicesPoller();

        // Log message to console if set in verbose mode
        if (this._settings.verbose)
            pluggedKbd.debug = console.log;

        this._devices.defaultSource = ism.inputSources[0];
        this._ism_handler = ism.connect('current-source-changed', this._devices.updateCurrentSource.bind(this._devices));

        // connect settings to models
        this._settings_handler = this._settings.connect('rules-changed', () => {
            this._devices.ruleList = this._settings.rules;
        });
        this._device_handler1 = this._devices.connect('changed', () => {
            this._settings.rules = this._devices.ruleList;
        });

        // Update UI when Keybaords register changes
        this._device_handler2 = this._devices.connect('changed', this._updateSubmenu.bind(this));

        // Build UI
        this.parent = Main.panel.statusArea['keyboard']; // InputSourceIndicator
        this.separator = new PopupMenu.PopupSeparatorMenuItem();
        this.parent.menu.addMenuItem(this.separator);
        this.menuItem = new PopupMenu.PopupSubMenuMenuItem('No external keyboard', false); // Name of current connected keyboard
        this.subs = new Map();
        this.parent.menu.addMenuItem(this.menuItem);

        // Set rules in the model
        this._devices.ruleList = this._settings.rules;

        // Set input device and start monitoring it (and do initial exploration)
        this._detector_handler1 = this._detector.connect('keyboard-added', this._devices.add.bind(this._devices));
        this._detector_handler2 = this._detector.connect('keyboard-removed', this._devices.remove.bind(this._devices));
        this._detector.mainLoopAdd(1); // 1s timeout to avoid having input source beeing reset by something else

        // If not in Teach-in mode, periodically force input source
        this._timeout = GLib.timeout_add(GLib.PRIORY_DEFAULT, 2, this._force.bind(this));
    }

    disable() {
        // Cancel force timemout
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = null;
        }

        // Disconnect signals
        if (this._ism_handler)
            ism.disconnect(this._ism_handler);
        if (this._settings) {
            this._settings.disconnect(this._settings_handler);
            this._settings = null;
        }
        if (this._devices) {
            this._devices.disconnect(this._device_handler1);
            this._devices.disconnect(this._device_handler2);
            this._devices = null;
        }
        // no need to remove menuitem, it seems...
        if (this.menuItem) {
            this.menuItem.destroy();
            this.separator.destroy();
            this.menuItem = null;
        }
        // Cancel device monitoring
        if (this._detector) {
            this._detector.disconnect(this._detector_handler1);
            this._detector.disconnect(this._detector_handler2);
            this._detector.mainLoopRemove();
            this._detector = null;
        }
    }
}

