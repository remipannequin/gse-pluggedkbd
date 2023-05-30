/* exported init, buildPrefsWidget, fillPreferencesWindow */

const {Adw, Gtk, Gio} = imports.gi;


// It's common practice to keep GNOME API and JS imports in separate blocks
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const {PluggedKbdSettings} = Me.imports.pluggedKbd;

/**
 * Like `extension.js` this is used for any one-time setup like translations.
 *
 * @param {ExtensionMeta} meta - An extension meta object, described below.
 */
function init(meta) {
    log(`initializing ${meta.name} Preferences`);
}

/**
 * This function is called when the preferences window is first created to fill
 * the `Adw.PreferencesWindow`.
 *
 * This function will only be called by GNOME 42 and later. If this function is
 * present, `buildPrefsWidget()` will never be called.
 *
 * @param {Adw.PreferencesWindow} window - The preferences window
 */
function fillPreferencesWindow(window) {
    const settings = new PluggedKbdSettings(ExtensionUtils);

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
        active: settings.alwaysShowMenuitem,
        valign: Gtk.Align.CENTER,
    });
    settings.bindAlwaysShowMenuitem(
        toggle,
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );

    // Add the switch to the row
    row.add_suffix(toggle);
    row.activatable_widget = toggle;

    // Logging pref
    const row2 = new Adw.ActionRow({title: 'Log debug messages'});
    group.add(row2);
    const toggle2 = new Gtk.Switch({
        active: settings.verbose,
        valign: Gtk.Align.CENTER,
    });

    settings.bindVerbose(
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
        active: settings.verbose,
        valign: Gtk.Align.CENTER,
    });

    settings.bindTeachIn(
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


class KbdListGroup {
    constructor(settings, parent) {
        this._parent = parent;
        this.group = new Adw.PreferencesGroup();
        this.group.title = 'Keyboards';
        this._settings = settings;
        this._settings.connect('rules-changed', this.update.bind(this));
        this._rows = [];
        this._buttons = [];
        this.update();
    }

    update() {
        const rules = this._settings.rules;
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
                this._settings.rules = toApply;
            }
            modal.destroy();
        });


        modal.show();
    }
}
