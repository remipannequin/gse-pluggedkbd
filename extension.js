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

const ByteArray = imports.byteArray;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const KeyboardManager = imports.misc.keyboardManager;
const PopupMenu = imports.ui.popupMenu;
const Status  = imports.ui.status;
const Signals = imports.signals;
const ExtensionUtils = imports.misc.extensionUtils;

const Me = ExtensionUtils.getCurrentExtension();
const ism = Status.keyboard.getInputSourceManager();

/**
 * A very simple representation of an input device, based on its name in /dev/input/by-id 
 */
class InputDevice {
    constructor(path, connected = true, name) {
        this.id = path;
        this.connected = connected;
        this.associated = null;
        // Parse id to get name and other details
        let tmp;
        let str = path;
        this.isTmp = path.match(/.*.tmp-.*/);
        if (this.isTmp) {
            [str, tmp] = path.split('.');
        }
        //this.isIf1 = path.match(/.*-if01.*/);
        let elt = str.split('-');
        this._if = elt[0];
        this.isKbd = path.match(/.*-event-kbd.*/);
        this.prefix = `${elt[0]}-${elt[1]}`;
        // Set display name
        if (typeof(name) === 'undefined' || name === null) {
            this._name = elt[1]
            this._isDefaultName = true;
        } else {
            this._name = name;
            this._isDefaultName = false;
        }
        
        
        //log(this._if, this._name, this._kbd, this.isTmp, this.isKbd);
    }

    name() {
        // If connected and using default name, try to get model name from udevadm
        if (this.connected && this._isDefaultName) {
            this._queryName();
        }
        // replace underscore with spaces
        let displayName = this._name.replaceAll('_', ' ');
        // capitalize first letter of each word
        displayName = displayName.replace(/(^|\s)\S/g, function(t) { return t.toUpperCase() });
        return displayName;
    }

    /**
     * Check whether this dev is similar to another 
     * 
     * @param {InputDevice} asOther 
     * @returns 
     */
    same(asOther) {
        return this.prefix === asOther.prefix;
    }

    /**
     * Call udevadm info on this path to get more info
     * 
     * @return {str} the device model
     */
    _queryName() {
        let [, stdout, stderr, status] = GLib.spawn_command_line_sync(`udevadm info /dev/input/by-id/${this.id}`);
        
        if (status !== 0) {
            //default value
            return;
        }
        //log(stdout);
        if (stdout instanceof Uint8Array)
            stdout = ByteArray.toString(stdout);
        //log(stdout);
        let found;
        for (const line of stdout.split('\n')) {
            //log(line);
            if (found = line.match(/E: ID_MODEL=(.*)/)) {
                this._name = found[1];
                this._isDefaultName = false;
                return;
            }
        }
    }

    /**
     * Associate this device with an input source
     * 
     * @param {InputSource} is 
     */
    associate(is) {
        //log(`associating ${this.name()} with source ${is.shortName}`);
        this.associated = is;
    }

    deassociate() {
        //log(`de-associating ${this.name()}`);
        this.associated = null;
    }
}


/**
 * Enum for the various type of rule
 * @readonly
 * @enum {{name: string}}
 */
const RuleTrigger = Object.freeze({
    PLUGGED_IN:   { name: "plugged_in" },
    PLUGGED_OUT:  { name: "plugged_out" },
    PRESENT:      { name: "present" },
    ABSENT:       { name: "absent"}
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
     * @param {RuleTrigger} eventType 
     * @param {InputDevice} dev 
     */
    _execRules(eventType, dev) {
       
        switch (eventType) {
            case RuleTrigger.PLUGGED_IN:
            
                if (dev.associated) {
                    //log(`detecting ${dev.id}, activating ${dev.associated.displayName}`);
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
                    //log(`activating default source (${this._defaultSource.displayName})`);
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
     * 
     * @param {str} path the input file name
     */
    add(path) {
        let dev;
        // If device already exists, only update its connected status
        if (this._map.has(path)) {
            dev = this._map.get(path);
            dev.connected = true;
        } else {
            dev = new InputDevice(path);
            // Check if Tmp or not keyboard
            if (dev.isTmp || !dev.isKbd) {
                return;
            }
            // Check if duplicate
            for (const otherDev of this._map.values()) {
                if (dev.same(otherDev)) {
                    return;
                }
            }

            //log(`adding ${dev.name()} (${dev.id})`);
            this._map.set(dev.id, dev);
        }
        
        // trigger plugged_in rules
        this._execRules(RuleTrigger.PLUGGED_IN, dev);
        this._emitChanged();
       
    }

    remove(path) {
        // If dev already exists, and has no association, remove it
        
        if (this._map.has(path)) {
            let dev = this._map.get(path);
            dev.connected = false;
            //log(`removing ${dev.name()} (${dev.id})`);
            // trigger plugged_in rules
            this._execRules(RuleTrigger.PLUGGED_OUT, dev);
            if (!dev.associated) {
                this._map.delete(dev.id);
            }
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

    associate(dev, source) {
        dev.associate(source);
        this._current = dev;
        this._emitChanged();
    }

    deassociate(dev) {
        dev.deassociate();
        this._current = null;
        this._emitChanged();
    }

    get ruleList() {
        let result =  [];
        for (let dev of this._map.values()) {
            if (dev.associated) {
                result.push({kbdId: dev.id, kbdName: dev.name(), srcId: dev.associated.id});
            }
        }
        return result;
    }

    set ruleList (list) {
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
     * 
     * 
     * @param {InputSource} is the current input source
     */
    updateCurrentSource() {
        // The new source 
        const src = ism.currentSource;
        
        // Go through the list of connected and associated devices
        // If the new source match, this is the new current
        for (const dev of this._map.values()) {
            if (dev.connected && dev.associated.id === src.id) {
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
         * 
         * @param {InputDevice} dev 
         */
        _init(dev, isCurrent) {
            super._init();
            // Name in italics if  not connected
            this.dev = dev;
            this.label = new St.Label({
                text: dev.name(),
                x_expand: true,
            });
            this.label.clutter_text.set_markup(this._devName());
            
            this.indicator = new St.Label({ text: this._isName() });
            this.add_child(this.label);
            this.add(this.indicator);
            this.label_actor = this.label;
            if (isCurrent) {
                this.setOrnament(PopupMenu.Ornament.DOT);
            }
        }

        /**
         * 
         * @returns the name of the keyboard, in italic if not connected
         */
        _devName() {
            if (this.dev.connected) {
                return this.dev.name();
            } else {
                return `<i>${this.dev.name()}</i>`;
            }
        }

        /**
         * 
         * @returns the short name of the associated input source
         */
        _isName() {
            if (this.dev.associated) {
                return this.dev.associated.shortName;
            }
            return "";
        }

        update(isCurrent) {
            this.label.clutter_text.set_markup(this._devName());
            this.indicator.text = this._isName();
            if (isCurrent) {
                this.setOrnament(PopupMenu.Ornament.DOT);
            } else {
                this.setOrnament(PopupMenu.Ornament.NONE);
            }
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

    set rules (ruleList) {
        let result =  [];
        
        let  child_type = new GLib.VariantType('(sss)');
        for (const elt of ruleList) {
            let assoc = new GLib.Variant('(sss)', [
                elt.kbdId,
                elt.kbdName,
                elt.srcId]);
            result.push(assoc);
        }
        let v = GLib.Variant.new_array(child_type, result);
        this._settings.set_value('rules', v);
    }

    get rules () {
        const v = this._settings.get_value('rules');
        return v.recursiveUnpack();
    }

    get showIndicator () {
        return this._settings.get_boolean(this._KEY_SHOW_INDICATOR)
    }

    get devDir () {
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


    _setDevDir () {
        this._cancelMonitors();
        this.devDir = Gio.File.new_for_path(this._settings.devDir);
        // Monitor changes to devs
        this._monitor = this.devDir.monitor_directory(null, null);
        this.monitorHandlerId = this._monitor.connect('changed', this._devDirChanged.bind(this));
 
        // Populate the keyboard register, with a small delay
        this._timeout = Mainloop.timeout_add_seconds(5, this._inspectDir.bind(this, false));
    }

    _cancelMonitors() {
        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
            this._timeout = null;
        }
        if (this._monitor) {
            this._monitor.disconnect(this.monitorHandlerId);
            this._monitor.cancel();
            this._monitor = null;
        }
    }

    _inspectDir(repeat = false) {
        let iter = this.devDir.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        let f;
        while (f = iter.next_file(null)) {
            let path = f.get_name();
            this._devices.add(path);
        }
        if (!repeat) {
            this._timeout = null;
        }
        return repeat;
    }

    /**
     * 
     * @param {Gio.File} file 
     * @param {Gio.File} other_file 
     * @param {Gio.FileMonitorEvent} event_type 
     */
    _devDirChanged(monitor, file, other_file, event_type) {
        let path = this.devDir.get_relative_path(file);

        switch (event_type) {
            case Gio.FileMonitorEvent.CREATED:
                this._devices.add(path);
                break;
            case Gio.FileMonitorEvent.DELETED:
                this._devices.remove(path);
                break;
        }
    }

    // Update menu item according to the keyboars register
    _updateSubmenu() {
        // Display connected and associated keyboard (even if not plugged)
        if (this._devices.size()) {
            
            this.menuItem.label.text = 'Keyboards';
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
                let cur = (this._devices.current === dev);
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
            this.menuItem.label.text = 'No external keyboards';
            this.menuItem.sensitive = false;
        }

    }

    _toggle(dev) {
        if (dev.associated) {
            //deassociate
            this._devices.deassociate(dev);
        } else {
            //associate to current source
            this._devices.associate(dev, ism.currentSource);
        }
    }

    enable() {
        this._settings = new PluggedKbdSettings();
        this._devices = new Keyboards();        
        
        this._devices.defaultSource = ism.inputSources[0];
        ism.connect('current-source-changed', this._devices.updateCurrentSource.bind(this._devices));

        // connect settings to models
        //this.settings.connect('rules-changed', () => {this.devices.ruleList = this.settings.rules;})
        this._devices.connect('changed', () => {this._settings.rules = this._devices.ruleList;});
        this._settings.connect('show-indicator-changed', () => {this.menuItem.visible = this._settings.showIndicator});
        this._settings.connect('dev-dir-changed', this._setDevDir.bind(this));

        // Connect signals
        this._devices.connect('changed', this._updateSubmenu.bind(this));

        // Build UI
        this.parent = Main.panel.statusArea['keyboard']; // InputSourceIndicator
        this.separator = new PopupMenu. PopupSeparatorMenuItem();
        this.parent.menu.addMenuItem(this.separator);
        this.menuItem = new PopupMenu.PopupSubMenuMenuItem('No external keyboard', false); //Name of current connected keyboard
        this.subs = new Map();
        this.parent.menu.addMenuItem(this.menuItem);
        
        // Set rules in the model
        this._devices.ruleList = this._settings.rules;

        // Set input device and start monitoring it (and do initial exploration)
        this._setDevDir();
        
    }

    disable() {
        if (this._devices) {
            this._devices = null;
            this._settings = null;
        }
        // no need to remove menuitem, it seems...
        if (this.menuItem) {
            //this.parent.removeMenuItem(this.menuItem);
            this.menuItem.destroy();
            this.separator.destroy();
            this.menuItem = null;
        }
        this._cancelMonitors();
    }

}

function init() {
    return new Extension();
}
