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
const {Clutter, GObject, GLib, St} = imports.gi;

const Gettext = imports.gettext;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const Status  = imports.ui.status;
const Signals = imports.signals;
const ExtensionUtils = imports.misc.extensionUtils;

const Me = ExtensionUtils.getCurrentExtension();
const ism = Status.keyboard.getInputSourceManager();
const Domain = Gettext.domain(Me.metadata.uuid);
const _ = Domain.gettext;

const {Keyboards, ProcInputDevicesPoller} = Me.imports.pluggedKbd;

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



/**
 * Extensions settings
 */
class PluggedKbdSettings {
    constructor() {
        this._SCHEMA = 'org.gnome.shell.extensions.plugged-kbd';
        this._KEY_RULES = 'rules';
        this._KEY_ALWAYS_SHOW_MENUITEM = 'always-show-menuitem';
        this._KEY_DEV_INPUT_DIR = 'dev-input-dir';
        this._settings = ExtensionUtils.getSettings(this._SCHEMA);
        this._settings.connect(`changed::${this._KEY_RULES}`, this._emitRulesChanged.bind(this));
        this._settings.connect(`changed::${this._KEY_ALWAYS_SHOW_MENUITEM}`, this._emitShowIndicatorChanged.bind(this));
    }

    _emitRulesChanged() {
        this.emit('rules-changed');
    }

    _emitShowIndicatorChanged() {
        this.emit('always-show-menuitem-changed');
    }

    set rules(ruleList) {
        let result =  [];

        let  childType = new GLib.VariantType('(suss)');
        for (const elt of ruleList) {
            let assoc = new GLib.Variant('(suss)', [
                elt.kbdId,
                elt.priority,
                elt.kbdName,
                elt.srcId,
            ]);
            result.push(assoc);
        }
        let v = GLib.Variant.new_array(childType, result);
        this._settings.set_value('rules', v);
    }

    get rules() {
        const v = this._settings.get_value('rules');
        return v.recursiveUnpack();
    }

    get alwaysShowMenuitem() {
        return this._settings.get_boolean(this._KEY_ALWAYS_SHOW_MENUITEM);
    }
}
Signals.addSignalMethods(PluggedKbdSettings.prototype);



class Extension {
    constructor() {
        this._monitor = null;
        this._timeout = null;
        this._devices = null;
        this._settings = null;
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
            // Iterate over devices
            for (const dev of this._devices.values()) {
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

    enable() {
        this._settings = new PluggedKbdSettings();
        this._devices = new Keyboards(ism);
        this.detector = new ProcInputDevicesPoller();

        this._devices.defaultSource = ism.inputSources[0];
        ism.connect('current-source-changed', this._devices.updateCurrentSource.bind(this._devices));

        // connect settings to models
        // this.settings.connect('rules-changed', () => {this.devices.ruleList = this.settings.rules;})
        this._devices.connect('changed', () => {
            this._settings.rules = this._devices.ruleList;
        });

        // Connect signals
        this._devices.connect('changed', this._updateSubmenu.bind(this));

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
        this.detector.connect('keyboard-added', this._devices.add.bind(this._devices));
        this.detector.connect('keyboard-removed', this._devices.remove.bind(this._devices));
        this.detector.mainLoopAdd();
    }

    disable() {
        if (this._devices) {
            this._devices = null;
            this._settings = null;
        }
        // no need to remove menuitem, it seems...
        if (this.menuItem) {
            this.menuItem.destroy();
            this.separator.destroy();
            this.menuItem = null;
        }
        this._cancelMonitors();
    }
}

/**
 * Init extension.
 */
function init() {
    ExtensionUtils.initTranslations(Me.metadata.uuid);
    return new Extension();
}
