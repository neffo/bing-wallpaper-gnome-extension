
const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;

let settings;

function init() {
    settings = Utils.getSettings(Me);
}

function buildPrefsWidget(){

    // Prepare labels and controls
    let buildable = new Gtk.Builder();
    buildable.add_from_file( Me.dir.get_path() + '/Settings.ui' );
    let box = buildable.get_object('prefs_widget');

    buildable.get_object('extension_version').set_text(Me.metadata.version.toString());

    let hideSwitch = buildable.get_object('hide');
    let notifySwitch = buildable.get_object('notifications');
    let transientSwitch = buildable.get_object('transient_notifications');
    let bgSwitch = buildable.get_object('background');
    let lsSwitch = buildable.get_object('lock_screen');
    let fileChooser = buildable.get_object('download_folder');
    let marketEntry = buildable.get_object('market');
    let resolutionEntry = buildable.get_object('resolution');

    // Indicator
    settings.bind('hide', hideSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);

    // Notifications
    settings.bind('notify', notifySwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    settings.bind('transient', transientSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);

    transientSwitch.set_sensitive(settings.get_boolean('notify'));
    settings.connect('changed::notify', function() {
        transientSwitch.set_sensitive(settings.get_boolean('notify'));
    });

    settings.bind('set-background', bgSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    settings.bind('set-lock-screen', lsSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);

    //download folder
    fileChooser.set_filename(settings.get_string('download-folder'));
    fileChooser.add_shortcut_folder_uri("file://" + GLib.get_user_cache_dir() + "/bing");
    fileChooser.connect('file-set', function(widget) {
        settings.set_string('download-folder', widget.get_filename());
    });

    // Bing Market (locale/country)
    settings.bind('market', marketEntry, 'text', Gio.SettingsBindFlags.DEFAULT);
    settings.connect('changed::market', function() {
        if (settings.get_string('market') == "")
            settings.reset('market');
    });

    // Resolution
    settings.bind('resolution', resolutionEntry, 'text', Gio.SettingsBindFlags.DEFAULT);
    settings.connect('changed::resolution', function() {
        if (settings.get_string('resolution') == "")
            settings.reset('resolution');
    });

    box.show_all();

    return box;
};

