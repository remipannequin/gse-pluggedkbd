/* pluggedKbd.js
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


const {Gio, GLib} = imports.gi;
const ByteArray = imports.byteArray;
const Mainloop = imports.mainloop;
const Signals = imports.signals;


/**
 * An input device as described in /proc/bus/input/device (partially).
 */
var InputDevice = class InputDevice {
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

    getEventDevices() {
        return this._devices.keys();
    }

    getPhys(ev) {
        return this._devices.get(ev);
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
         * @param {Array} listPhys list of physical devices (tuple (event, phys))
         */
        function showList(listPhys) {
            if (!listPhys || !listPhys.length)
                return '';
            return listPhys.map(showEv).join(', ');
        }

        return `${this._name}: [${showList([...this._devices.entries()])}] `;
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
};



/**
 * Module that periodically reads /proc/bus/inpu/devices. Emit 'keyboard-added' or
 * 'keyboard-removed' events when a new keyboard is detected or found absent.
 *
 */
var ProcInputDevicesPoller = class ProcInputDevicesPoller  {
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
        const str = [];
        for (const dev of this._register.values())
            str.push(dev.toString());
        return `[ ${str.join('; ')}]`;
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
};
Signals.addSignalMethods(ProcInputDevicesPoller.prototype);



/**
 * A very simple representation of an input device, based on its name in /dev/input/by-id
 */
class Keyboard {
    constructor(id, connected = true, name, priority = 1) {
        this.id = id;
        this.connected = connected;
        this.associated = null;
        if (name)
            this.displayName = name;
        else
            this.displayName = id;
        this.prio = priority;
    }

    /**
     * Associate this device with an input source
     *
     * @param {InputSource} is input source to associate to tis keyboard
     */
    associate(is) {
        this.associated = is;
    }

    /**
     * remove association to an input source.
     */
    deassociate() {
        this.associated = null;
    }

    toString() {
        let s = `Kbd ${this.id} (${this.displayName}) with priority ${this.prio} `;
        if (this.connected)
            s += 'connected, ';
        else
            s += 'not connected, ';
        if (this.associated)
            s += `associated to: ${this.associated.shortName}`;
        else
            s += 'not associated';
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
var Keyboards = class Keyboards {
    constructor(ism) {
        this._ism = ism;
        this._map = new Map();
        this._current = null;
        this._defaultSource = null;
        this._currentSource = ism.currentSource;
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
        const currentSrc = this._ism.currentSource;
        switch (eventType) {
        case RuleTrigger.PLUGGED_IN:
            // if dev is not associated, do nothing
            if (dev.associated) {
                // Check whether newly plugged keyboard's priority is greater or equal than current's priority (if any current)
                if (this._current) {
                    if (this._current.prio <= dev.prio) {
                        // log(`making ${dev} current`);
                        // make this dev current
                        dev.associated.activate();
                        this._current = dev;
                    }
                } else {
                    // No current device
                    if (dev.associated.id !== currentSrc.id)
                        // Activate source if not already done
                        dev.associated.activate();
                    this._current = dev;
                }
            }
            this._emitChanged();
            break;
        case RuleTrigger.PLUGGED_OUT:
            // Only the current dev trigger a change of input source (i.e. if the user selected manually another source, nothing is changed)
            // log(`removing ${dev}`);
            // log(`current is ${this._current}`);
            if (dev.associated && dev === this._current) {
                // Search for connected keyboard, first one becomes new current
                const candidates = [...this._map.values()];
                // sort by priority
                candidates.sort((a, b) => {
                    return a.prio - b.prio;
                });
                for (const other of candidates) {
                    // log(`eximining candidate ${other}`);
                    if (other.associated && other.connected) {
                        other.associated.activate();
                        this._current = other;
                        this._emitChanged();
                        return;
                    }
                }
                if (this._defaultSource)
                    this._defaultSource.activate();
                this._current = null;
                this._emitChanged();
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
        // log(`adding ${inputDev}`);
        if (this._map.has(inputDev.name)) {
            dev = this._map.get(inputDev.name);
            dev.connected = true;
            // log(`found existing keyboard: ${dev}`);
        } else {
            let prio = this.size();
            dev = new Keyboard(inputDev.name, true, inputDev.displayName, prio);
            this._map.set(dev.id, dev);
            // log(`created new keyboard: ${dev}`);
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
        if (this._map.has(inputDev.name)) {
            let dev = this._map.get(inputDev.name);
            dev.connected = false;
            // trigger plugged_in rules
            this._execRules(RuleTrigger.PLUGGED_OUT, dev);
            if (!dev.associated)
                this._map.delete(dev.id);
            this._emitChanged();
        }
    }

    set defaultSource(source) {
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
        if (this._currentSource.id === source.id)
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
        // TODO: no, exec rules
        if (this._current === dev)
            this._current = null;
        this._emitChanged();
    }

    get ruleList() {
        let result =  [];
        for (let dev of this._map.values()) {
            if (dev.associated)
                result.push({kbdId: dev.id, priority: dev.prio, kbdName: dev.displayName, srcId: dev.associated.id});
        }
        return result;
    }

    set ruleList(list) {
        const src = new Map();
        for (const i in this._ism.inputSources) {
            let is = this._ism.inputSources[i];
            src.set(is.id, is);
        }
        for (const [kbdId, kbdPrio, kbdName, isId] of list) {
            if (src.has(isId)) {
                const is = src.get(isId);
                const dev = new Keyboard(kbdId, false, kbdName, kbdPrio);
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

    get(kbdId) {
        return this._map.get(kbdId);
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
        const src = this._ism.currentSource;
        this._currentSource = src;
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
};
Signals.addSignalMethods(Keyboards.prototype);


/**
 * Extensions settings
 */
var PluggedKbdSettings = class PluggedKbdSettings {
    constructor(extension) {
        this._SCHEMA = 'org.gnome.shell.extensions.plugged-kbd';
        this._KEY_RULES = 'rules';
        this._KEY_ALWAYS_SHOW_MENUITEM = 'always-show-menuitem';
        this._KEY_DEV_INPUT_DIR = 'dev-input-dir';
        this._settings = extension.getSettings(this._SCHEMA);
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

    bindAlwaysShowMenuitem(obj, attr, flags) {
        this._settings.bind(this._KEY_ALWAYS_SHOW_MENUITEM, obj, attr, flags);
    }
};
Signals.addSignalMethods(PluggedKbdSettings.prototype);
