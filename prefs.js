const {Adw, GLib, Gtk, Gio} = imports.gi;

// It's common practice to keep GNOME API and JS imports in separate blocks
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();


/**
 * Like `extension.js` this is used for any one-time setup like translations.
 *
 * @param {ExtensionMeta} meta - An extension meta object, described below.
 */
function init(meta) {
    log(`initializing ${meta.name} Preferences`);
}


/**
 * This function is called when the preferences window is first created to build
 * and return a GTK widget.
 *
 * As of GNOME 42, the preferences window will be a `Adw.PreferencesWindow`.
 * Intermediate `Adw.PreferencesPage` and `Adw.PreferencesGroup` widgets will be
 * used to wrap the returned widget if necessary.
 *
 * @returns {Gtk.Widget} the preferences widget
 */
function buildPrefsWidget() {
    // This could be any GtkWidget subclass, although usually you would choose
    // something like a GtkGrid, GtkBox or GtkNotebook
    const prefsWidget = new Gtk.Box();

    // Add a widget to the group. This could be any GtkWidget subclass,
    // although usually you would choose preferences rows such as AdwActionRow,
    // AdwComboRow or AdwRevealerRow.
    const label = new Gtk.Label({ label: `${Me.metadata.name}` });
    prefsWidget.append(label);
    
    return prefsWidget;
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
    const settings = ExtensionUtils.getSettings(
        'org.gnome.shell.extensions.plugged-kbd');
    
    // Create a preferences page and group
    const page = new Adw.PreferencesPage();
    const group = new Adw.PreferencesGroup();
    page.add(group);

    // Create a new preferences row
    const row = new Adw.ActionRow({ title: 'Show Extension Indicator' });
    group.add(row);

    // Create the switch and bind its value to the `show-indicator` key
    const toggle = new Gtk.Switch({
        active: settings.get_boolean ('show-indicator'),
        valign: Gtk.Align.CENTER,
    });
    settings.bind(
        'show-indicator',
        toggle,
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );

    // Add the switch to the row
    row.add_suffix(toggle);
    row.activatable_widget = toggle;

    // Add our page to the window
    window.add(page);

    
}
