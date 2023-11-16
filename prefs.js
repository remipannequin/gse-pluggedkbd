/* exported init, buildPrefsWidget, fillPreferencesWindow */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';


// It's common practice to keep GNOME API and JS imports in separate blocks
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const KEY_RULES = 'rules';
const KEY_ALWAYS_SHOW_MENUITEM = 'always-show-menuitem';
const KEY_VERBOSE = 'debug-messages';
const KEY_TEACHIN = 'teach-in';
const _SCHEMA = 'org.gnome.shell.extensions.plugged-kbd';
    

function setRules(ruleList, settings) {
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
    settings.set_value(KEY_RULES, v);
}

function getRules(settings) {
    const v = settings.get_value(KEY_RULES);
    return v.recursiveUnpack();
}


export default class ExamplePreferences extends ExtensionPreferences {

    /**
     * This function is called when the preferences window is first created to fill
     * the `Adw.PreferencesWindow`.
     *
     * This function will only be called by GNOME 42 and later. If this function is
     * present, `buildPrefsWidget()` will never be called.
     *
     * @param {Adw.PreferencesWindow} window - The preferences window
     */
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Create a preferences page and group
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup();
        page.add(group);

        // Create a new preferences row
        const row = new Adw.ActionRow({title: 'Always Show Keyboards Menu'});
        row.description = 'add an item in the input source menu, even if that is only one keyboard';
        group.add(row);

        // Create the switch and bind its value to the `show-indicator` key
        const toggle = new Gtk.Switch({
            active: settings.get_boolean(KEY_ALWAYS_SHOW_MENUITEM),
            valign: Gtk.Align.CENTER,
        });
        settings.bind(KEY_ALWAYS_SHOW_MENUITEM, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        

        // Add the switch to the row
        row.add_suffix(toggle);
        row.activatable_widget = toggle;

        // Logging pref
        const row2 = new Adw.ActionRow({title: 'Log debug messages'});
        group.add(row2);
        const toggle2 = new Gtk.Switch({
            active: settings.get_boolean(KEY_VERBOSE),
            valign: Gtk.Align.CENTER,
        });

        settings.bind(
            KEY_VERBOSE,
            toggle2,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        row2.add_suffix(toggle2);
        row2.activatable_widget = toggle2;


        // Teach-in / aggressive mode

        const row3 = new Adw.ActionRow({title: 'Teach-in mode'});
        group.add(row3);
        const toggle3 = new Gtk.Switch({
            active: settings.get_boolean(KEY_TEACHIN),
            valign: Gtk.Align.CENTER,
        });

        settings.bind(
            KEY_TEACHIN,
            toggle3,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        row3.add_suffix(toggle3);
        row3.activatable_widget = toggle3;


        // Add our page to the window
        window.add(page);

        // create another page for the rules
        // Create a preferences page and group
        const groupKbd = new KbdListGroup(settings, window);
        page.add(groupKbd.group);
    }
}


class KbdListGroup {
    constructor(settings, parent) {
        this._parent = parent;
        this.group = new Adw.PreferencesGroup();
        this.group.title = 'Keyboards';
        this._settings = settings;
        //this._settings.connect('rules-changed', this.update.bind(this));
        this._rows = [];
        this._buttons = [];
        this.update();
    }

    update() {
        const rules = getRules(this._settings);
        rules.sort((a, b) => a[1] - b[1]);

        for (const r of this._rows)
            this.group.remove(r);
        this._rows = [];
        this._buttons = [];

        for (const [kbdId, kbdPrio, kbdName, SrcId] of rules) {
        // Create a preferences row for each rule
            const kbdRow = new Adw.ActionRow();
            kbdRow.title = kbdName;
            kbdRow.subtitle = `${kbdId}, associated to ${SrcId} (priority ${kbdPrio})`;
            const editButton = new Gtk.Button({icon_name: 'document-properties-symbolic', vexpand: false, valign: Gtk.Align.CENTER});
            editButton.connect('clicked', this.showkbdDialog.bind(this, rules, kbdId));
            kbdRow.add_suffix(editButton);
            kbdRow.activatable_widget = editButton;
            this.group.add(kbdRow);
            this._rows.push(kbdRow);
            this._buttons.push(editButton);
        }
    }


    /**
     * Display a dialog to edit keyboard display name and priority.
     *
     * @param {Array} rules current rules
     * @param {str} kbdId id of the keyboard to edit
     */
    showkbdDialog(rules, kbdId) {
        // get the current values
        let kbdName;
        let kbdPrio;
        let index;
        for (let i in rules) {
            const [id, p, n, _] = rules[i];
            if (id === kbdId) {
                kbdName = n;
                kbdPrio = p;
                index = i;
                break;
            }
        }
        // transition to Adw.MessageDialog when Adw version >= 1.2
        const modal = new Gtk.Dialog({
            default_width: 400,
            modal: true,
            transient_for: this._parent,
            title: kbdId,
            use_header_bar: true,
        });
        const contentArea = modal.get_content_area();
        const hb1 = new Gtk.Box({spacing: 10, margin_top: 10, margin_start: 10, margin_end: 10, homogeneous: true});
        const hb2 = new Gtk.Box({spacing: 10, margin_top: 10, margin_bottom: 10, margin_start: 10, margin_end: 10, homogeneous: true});

        const label = new Gtk.Label({label: 'Display Name', halign: Gtk.Align.START});
        const edit = new Gtk.Entry({hexpand: true});
        edit.buffer.text = kbdName;
        hb1.append(label);
        hb1.append(edit);

        const label2 = new Gtk.Label({label: 'Priority', halign: Gtk.Align.START});
        const prioSpin = new Gtk.SpinButton({hexpand: true});
        prioSpin.adjustment.lower = 0;
        prioSpin.adjustment.upper = rules.length - 1;
        prioSpin.adjustment.step_increment = 1;
        prioSpin.adjustment.value = kbdPrio;
        hb2.append(label2);
        hb2.append(prioSpin);

        contentArea.append(hb1);
        contentArea.append(hb2);

        modal.add_button('Ok', Gtk.ResponseType.OK);
        modal.add_button('Cancel', Gtk.ResponseType.CANCEL);
        modal.connect('response', (_, rspId) => {
            if (rspId === Gtk.ResponseType.OK) {
                // update rules
                rules[index][1] = prioSpin.value;
                rules[index][2] = edit.buffer.text;
                // set settings value
                let toApply =  [];
                for (let [i, p, n, s] of rules)
                    toApply.push({kbdId: i, priority: p, kbdName: n, srcId: s});
                setRules(toApply, this._settings);
            }
            modal.destroy();
        });


        modal.show();
    }
}
