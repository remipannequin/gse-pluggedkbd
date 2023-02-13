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
const {Clutter, Gio, GObject, GLib, St} = imports.gi;
const Gettext = imports.gettext;
const ByteArray = imports.byteArray;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const PopupMenu = imports.ui.popupMenu;
const Status  = imports.ui.status;
const Signals = imports.signals;
const ExtensionUtils = imports.misc.extensionUtils;

const Me = ExtensionUtils.getCurrentExtension();
const ism = Status.keyboard.getInputSourceManager();
const Domain = Gettext.domain(Me.metadata.uuid);
const _ = Domain.gettext;

/**
 * An input device as described in /proc/bus/input/device (partially).
 */
class InputDevice {
    constructor(name) {
        this._name = name;
        this._displayName = name;
        this._devices = new Map();
        this._isDefaultName = true;
    }

    addPhys(dev, phys) {
        if (!this._devices.has(dev)) {
            this._devices.set(dev, phys);
            if (this._isDefaultName)
                this._queryName(dev);
        }
    }

    toString() {
        /**
         * Transform a (event, phys) tuple to string.
         *
         * @param {Array} ev the phys tupple
         */
        function showEv(ev) {
            return `${ev[0]} (${ev[1]})`;
        }

        /**
         * Get the list of physical devices of this keyboard.
         *
         * @param {Iterable} listPhys list of physical devices (tuple (event, phys))
         */
        function showList(listPhys) {
            return listPhys.map(showEv).join(', ');
        }

        return `${this._name}: [${showList(this._devices.entries())}] `;
    }

    get name() {
        return this._name;
    }

    get displayName() {
        // replace _ with spaces
        let dn = this._displayName.replaceAll('_', ' ');
        // capitalize first letter of each word
        dn = dn.replace(/(^|\s)\S/g, t => {
            return t.toUpperCase();
        });
        dn = dn.replace(/\\x([0-f][0-f])/g, (t, g) => {
            const c = Number.parseInt(g, 16);
            return String.fromCharCode(c);
        });
        return dn;
    }

    /**
     * Call udevadm info on this path to get more info
     *
     * @param {str} eventId the path of the device to query (e.g. /dev/input/event12)
     */
    _queryName(eventId) {
        // log(`udevadm info /dev/input/${eventId}`);
        let [, stdout, , status] = GLib.spawn_command_line_sync(`udevadm info /dev/input/${eventId}`);

        if (status !== 0) {
            // default value
            return;
        }
        if (stdout instanceof Uint8Array)
            stdout = ByteArray.toString(stdout);
        for (const line of stdout.split('\n')) {
            const found = line.match(/E: ID_MODEL_ENC=(.*)/);
            if (found) {
                this._displayName = found[1];
                this._isDefaultName = false;
                return;
            }
        }
    }
}


/**
 * Module that periodically reads /proc/bus/inpu/devices. Emit 'keyboard-added' or
 * 'keyboard-removed' events when a new keyboard is detected or found absent.
 *
 */
class ProcInputDevicesPoller  {
    constructor() {
        this._FILE = '/proc/bus/input/devices';
        this._PARSING = {
            key: /B: KEY=(.*)/,
            name: /N: Name="(.*)"/,
            ev: /B: EV=(\d+)/,
            phys: /P: Phys=(.*)/,
            dev: /H: Handlers=.*(event\d+).*/,
        };
        this._PERIOD = 250;
        this._removed = [];
        this._added = [];
        this._register = new Map();
    }

    _poll() {
        /**
         * Get the number of keys on a keyboard.
         *
         * @param {str} str the hex string with the key declaration
         */
        function numKeys(str) {
            let n = 0;
            for (const c of str) {
                switch (c) {
                case '1':
                case '2':
                case '4':
                case '8':
                    n += 1;
                    break;
                case '3':
                case '5':
                case '6':
                case '9':
                case 'a':
                case 'c':
                    n += 2;
                    break;
                case '7':
                case 'b':
                case 'd':
                case 'e':
                    n += 3;
                    break;
                case 'f':
                    n += 4;
                }
            }
            return n;
        }

        /**
         * Check whether the EV looks the one of a keyboard.
         *
         * @param {str} ev the EV string
         */
        function validEV(ev) {
            const mask = 0x100003; // EV_SYN & EV_KEY & EV_REP
            // a more strit mask would be 0x120013 (EV_MSC and EV_LED added)
            const evInt = parseInt(ev, 16);
            return (evInt & mask) === mask;
        }

        const f = Gio.File.new_for_path(this._FILE);

        let contents = ByteArray.toString(f.load_contents(null)[1]);

        this._markAllRemoved();
        for (const block of contents.split('\n\n')) {
            const elt = {};
            for (const line of block.split('\n')) {
                // If line is empty, start a new entity
                let found = false;
                for (const r in this._PARSING) {
                    found = line.match(this._PARSING[r]);
                    if (found)
                        elt[r] = found[1];
                }
            }
            if (elt.ev && validEV(elt.ev) && elt.key && numKeys(elt.key) > 100) {
                const baseName = elt.name.replace(/\Wkeyboard/i, '');
                this._add(baseName, elt.dev, elt.phys);
            }
        }
        for (const k of this._added)
            this.emit('keyboard-added', k);
        for (const k of this._removed) {
            this.emit('keyboard-removed', k);
            this._register.delete(k);
        }
        return true;
    }

    _markAllRemoved() {
        this._removed = Array.from(this._register.keys());
        this._added = [];
    }

    _add(name, dev, phys) {
        this._removed = this._removed.filter(elt => name !== elt);
        if (!this._register.has(name)) {
            const kb = new InputDevice(name);
            this._register.set(name, kb);
            this._added.push(name);
        }
        this._register.get(name).addPhys(dev, phys);
    }

    toString() {
        const values = new Array(this._register.values());
        return `[ ${values.map(toString).join('; ')}]`;
    }

    mainLoopAdd() {
        this._timeout = Mainloop.timeout_add(this._PERIOD, this._poll.bind(this));
    }

    mainLoopRemove() {
        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
            this._timeout = null;
        }
    }

    getDevice(id) {
        return this._register.get(id);
    }
}
Signals.addSignalMethods(ProcInputDevicesPoller.prototype);


/**
 * A very simple representation of an input device, based on its name in /dev/input/by-id
 */
class Keyboard {
    constructor(id, connected = true, name) {
        this.id = id;
        this.connected = connected;
        this.associated = null;
        if (name)
            this.displayName = name;
        else
            this.displayName = id;
    }

    /**
     * Associate this device with an input source
     *
     * @param {InputSource} is input source to associate to tis keyboard
     */
    associate(is) {
        this.associated = is;
    }

    deassociate() {
        this.associated = null;
    }

    toString() {
        let s = `Kbd ${this.id} (${this.displayName}) `;
        if (this.connected)
            s += 'connected, ';
        else
            s += 'not connected, ';
        if (this.associated)
            s += `associated to: ${this.associated.shortName}`;
        else
            s += 'not associsated';
        return s;
    }
}



/**
 * Enum for the various type of rule
 *
 * @readonly
 * @enum {{name: string}}
 */
const RuleTrigger = Object.freeze({
    PLUGGED_IN: {name: 'plugged_in'},
    PLUGGED_OUT: {name: 'plugged_out'},
    PRESENT: {name: 'present'},
    ABSENT: {name: 'absent'},
});



/**
 * List of keybords and association rules.
 *
 * When a device is plugged in, the associations are looked up, and
 * if triggered, the corresponding input source is activated. When
 * the device is plugged out, the default (first) input source is
 * activated.
 */
class Keyboards {
    constructor() {
        this._map = new Map();
        this._current = null;
        this._defaultSource = null;
    }

    /**
     * Decide which input source to activate when a keyboard is plugged in or out.
     *
     * Last plugged-in keyboard has priority.
     * When plugging-out, currently connected keyboard are searched, and if none are
     * found, default input source is activated.
     *
     * @param {RuleTrigger} eventType type of event
     * @param {InputDevice} dev the device that was added or removed
     */
    _execRules(eventType, dev) {
        switch (eventType) {
        case RuleTrigger.PLUGGED_IN:
            if (dev.associated) {
                dev.associated.activate();
                this._current = dev;
                this._emitChanged();
            }
            break;
        case RuleTrigger.PLUGGED_OUT:
            // Only the current dev trigger a change of input source (i.e. if the user selected manually another source, nothing is changed)
            if (dev.associated && dev === this._current) {
                // Search for connected keyboard, first one becomes new current
                for (const other of this._map.values()) {
                    if (other.associated && other.connected) {
                        other.associated.activate();
                        this._current = other;
                        this._emitChanged();
                        return;
                    }
                }
                if (this._defaultSource) {
                    this._defaultSource.activate();
                    this._current = null;
                    this._emitChanged();
                }
            }
        }
    }

    _emitChanged() {
        this.emit('changed');
    }

    /**
     * Add a new device
     *
     * @param {ProcInputDevicesPoller} detector objects that emitted the signal
     * @param {str} inputDevId the input file name
     */
    add(detector, inputDevId) {
        let dev;
        let inputDev = detector.getDevice(inputDevId);
        // If device already exists, only update its connected status
        if (this._map.has(inputDev.name)) {
            dev = this._map.get(inputDev.name);
            dev.connected = true;
        } else {
            dev = new Keyboard(inputDev.name, true, inputDev.displayName);
            log(dev);
            this._map.set(dev.id, dev);
        }
        // trigger plugged_in rules
        this._execRules(RuleTrigger.PLUGGED_IN, dev);
        this._emitChanged();
    }

    /**
     * Remove a device.
     *
     * @param {ProcInputDevicesPoller} detector objects that emitted the signal
     * @param {str} inputDevId the file that was deleted
     */
    remove(detector, inputDevId) {
        let inputDev = detector.getDevice(inputDevId);
        // If dev already exists, and has no association, remove it
        if (this._map.has(inputDev.id)) {
            let dev = this._map.get(inputDev.id);
            dev.connected = false;
            // trigger plugged_in rules
            this._execRules(RuleTrigger.PLUGGED_OUT, dev);
            if (!dev.associated)
                this._map.delete(dev.id);
            this._emitChanged();
        }
    }

    set  defaultSource(source) {
        this._defaultSource = source;
    }

    get defaultSource() {
        return this._defaultSource;
    }

    get current() {
        return this._current;
    }

    /**
     * Associate an input source with a device.
     *
     * @param {InputDevice} dev the keyboard to associate
     * @param {InputSource} source the input source to associate
     */
    associate(dev, source) {
        dev.associate(source);
        this._current = dev;
        this._emitChanged();
    }

    /**
     * Remove association for this device.
     *
     * @param {InputDevice} dev the keyboard to de-associate
     */
    deassociate(dev) {
        dev.deassociate();
        this._current = null;
        this._emitChanged();
    }

    get ruleList() {
        let result =  [];
        for (let dev of this._map.values()) {
            if (dev.associated)
                result.push({kbdId: dev.id, kbdName: dev.displayName, srcId: dev.associated.id});
        }
        return result;
    }

    set ruleList(list) {
        const src = new Map();
        for (const i in ism.inputSources) {
            let is = ism.inputSources[i];
            src.set(is.id, is);
        }
        for (const [kbdId, kbdName, isId] of list) {
            if (src.has(isId)) {
                const is = src.get(isId);
                const dev = new InputDevice(kbdId, false, kbdName);
                this._map.set(kbdId, dev);
                dev.associate(is);
            } else {
                log(`Warning, input source ${isId} is no longer valid`);
            }
        }
        this._emitChanged();
    }

    clear() {
        this._map.clear();
        this._emitChanged();
    }

    size() {
        return this._map.size;
    }

    has(kbdId) {
        return this._map.has(kbdId);
    }

    values() {
        return this._map.values();
    }

    /**
     * Update which keyboard is "current" if any.
     *
     * When a keyboard activated an input source (when it was plugged, or when anothor kb was unplugged), it
     * becomes current.
     */
    updateCurrentSource() {
        // The new source
        const src = ism.currentSource;

        // Go through the list of connected and associated devices
        // If the new source match, this is the new current
        for (const dev of this._map.values()) {
            if (dev.connected && dev.associated && dev.associated.id === src.id) {
                this._current = dev;
                this._emitChanged();
                return;
            }
        }
        // Else, no kb is current
        this._current = null;
        this._emitChanged();
    }
}
Signals.addSignalMethods(Keyboards.prototype);


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
                return `<i>${this.dev.name()}</i>`;
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


class PluggedKbdSettings {
    constructor() {
        this._SCHEMA = 'org.gnome.shell.extensions.plugged-kbd';
        this._KEY_RULES = 'rules';
        this._KEY_SHOW_INDICATOR = 'show-indicator';
        this._KEY_DEV_INPUT_DIR = 'dev-input-dir';
        this._settings = ExtensionUtils.getSettings(this._SCHEMA);
        this._settings.connect(`changed::${this._KEY_RULES}`, this._emitRulesChanged.bind(this));
        this._settings.connect(`changed::${this._KEY_SHOW_INDICATOR}`, this._emitShowIndicatorChanged.bind(this));
        this._settings.connect(`changed::${this._KEY_DEV_INPUT_DIR}`, this._emitDevDirChanged.bind(this));
    }

    _emitRulesChanged() {
        this.emit('rules-changed');
    }

    _emitShowIndicatorChanged() {
        this.emit('show-indicator-changed');
    }

    _emitDevDirChanged() {
        this.emit('dev-dir-changed');
    }

    set rules(ruleList) {
        let result =  [];

        let  childType = new GLib.VariantType('(sss)');
        for (const elt of ruleList) {
            let assoc = new GLib.Variant('(sss)', [
                elt.kbdId,
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

    get showIndicator() {
        return this._settings.get_boolean(this._KEY_SHOW_INDICATOR);
    }

    get devDir() {
        return this._settings.get_string(this._KEY_DEV_INPUT_DIR);
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
            this.menuItem.menu.removeAll();
            this.subs.clear();
            // Maybe just hide menu item
            this.menuItem.label.text = _('No external keyboards');
            this.menuItem.sensitive = false;
            this.menuItem.hide();
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
        this._devices = new Keyboards();
        this.detector = new ProcInputDevicesPoller();

        this._devices.defaultSource = ism.inputSources[0];
        ism.connect('current-source-changed', this._devices.updateCurrentSource.bind(this._devices));

        // connect settings to models
        // this.settings.connect('rules-changed', () => {this.devices.ruleList = this.settings.rules;})
        this._devices.connect('changed', () => {
            this._settings.rules = this._devices.ruleList;
        });
        this._settings.connect('show-indicator-changed', () => {
            this.menuItem.visible = this._settings.showIndicator;
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
