
const Gtk = imports.gi.Gtk;
const Gdk = imports.gi.Gdk;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;
const Lang = imports.lang;

const Convenience = Me.imports.convenience;
const Gettext = imports.gettext.domain('BingWallpaper');
const _ = Gettext.gettext;

let settings;

let marketDescription = null;
let icon_image = null;

const BingImageURL = Utils.BingImageURL;

function init() {
    settings = Utils.getSettings(Me);
    Convenience.initTranslations("BingWallpaper");
}

function buildPrefsWidget(){
    // Prepare labels and controls
    let buildable = new Gtk.Builder();
    buildable.add_from_file( Me.dir.get_path() + '/Settings.ui' );
    let box = buildable.get_object('prefs_widget');

    buildable.get_object('extension_version').set_text(Me.metadata.version.toString());
    buildable.get_object('extension_name').set_text(Me.metadata.name.toString());

    let hideSwitch = buildable.get_object('hide');
    let iconEntry = buildable.get_object('icon');
    let bgSwitch = buildable.get_object('background');
    let lsSwitch = buildable.get_object('lock_screen');
    let fileChooser = buildable.get_object('download_folder');
    let marketEntry = buildable.get_object('market');
    let resolutionEntry = buildable.get_object('resolution');
    let deleteSwitch = buildable.get_object('delete_previous');
    let daysSpin = buildable.get_object('days_after_spinbutton');
    marketDescription = buildable.get_object('market_description');
    icon_image = buildable.get_object('icon_image');
    let overrideSwitch = buildable.get_object('lockscreen_override');
    let strengthEntry = buildable.get_object('entry_strength');
    let brightnessEntry = buildable.get_object('entry_brightness');
    let change_log = buildable.get_object('change_log');

    let buttonGDMdefault = buildable.get_object('button_default_gnome');
    let buttonnoblur = buildable.get_object('button_no_blur');
    let buttonslightblur = buildable.get_object('button_slight_blur');

    // previous wallpaper images
    let images=[];
    for(let i = 1; i <= 7; i++) {
        images.push(buildable.get_object('image'+i));
    }

    // check that these are valid (can be edited through dconf-editor)
    Utils.validate_market(settings, marketDescription);
    Utils.validate_resolution(settings);

    // Indicator
    settings.bind('hide', hideSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);

    Utils.icon_list.forEach(function (iconname, index) { // add markets to dropdown list (aka a GtkComboText)
        iconEntry.append(iconname, iconname);
    });
    settings.bind('icon-name', iconEntry, 'active_id', Gio.SettingsBindFlags.DEFAULT);

    settings.connect('changed::icon-name', function() {
        Utils.validate_icon(settings, icon_image);
    });
    iconEntry.set_active_id(settings.get_string('icon-name'));

    settings.bind('set-background', bgSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    settings.bind('set-lock-screen', lsSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);

    //download folder
    fileChooser.set_filename(settings.get_string('download-folder'));
    log("fileChooser filename/dirname set to '"+fileChooser.get_filename()+"' setting is '"+settings.get_string('download-folder')+"'");
    fileChooser.add_shortcut_folder_uri("file://" + GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES)+"/BingWallpaper");
    fileChooser.connect('file-set', function(widget) {
        settings.set_string('download-folder', widget.get_filename());
    });
    
    // Bing Market (locale/country)
    Utils.markets.forEach(function (bingmarket, index) { // add markets to dropdown list (aka a GtkComboText)
        marketEntry.append(bingmarket, bingmarket+": "+Utils.marketName[index]);
    });
    //marketEntry.set_active_id(settings.get_string('market')); // set to current

    settings.bind('market', marketEntry, 'active_id', Gio.SettingsBindFlags.DEFAULT);
    settings.connect('changed::market', function() {
        Utils.validate_market(settings,marketDescription);
        //marketDescription.label = "Set to "+ marketEntry.active_id + " - " + _("Default is en-US");
    });

    Utils.resolutions.forEach(function (res) { // add res to dropdown list (aka a GtkComboText)
        resolutionEntry.append(res, res);
    });

    // Resolution
    settings.bind('resolution', resolutionEntry, 'active_id', Gio.SettingsBindFlags.DEFAULT);
    settings.connect('changed::resolution', function() {
        Utils.validate_resolution(settings);
    });

    settings.bind('delete-previous', deleteSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    settings.bind('previous-days', daysSpin, 'value', Gio.SettingsBindFlags.DEFAULT);

    if (Convenience.currentVersionGreaterEqual("3.36")) {
        lsSwitch.set_sensitive(false);
        // GDM3 lockscreen blur override
        settings.bind('override-lockscreen-blur', overrideSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('lockscreen-blur-strength', strengthEntry, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('lockscreen-blur-brightness', brightnessEntry, 'value', Gio.SettingsBindFlags.DEFAULT);
        buttonGDMdefault.connect('activate',function(widget) {
            Utils.set_blur_preset(settings, Utils.PRESET_GNOME_DEFAULT);
        });
        buttonnoblur.connect('activate',function(widget) {
            Utils.set_blur_preset(settings, Utils.PRESET_NO_BLUR);
        });
        buttonslightblur.connect('activate',function(widget) {
            Utils.set_blur_preset(settings, Utils.PRESET_SLIGHT_BLUR);
        });
    } else {
        // older version of GNOME
        overrideSwitch.set_sensitive(false);
        strengthEntry.set_sensitive(false);
        brightnessEntry.set_sensitive(false);
        buttonGDMdefault.set_sensitive(false);
        buttonnoblur.set_sensitive(false);
        buttonslightblur.set_sensitive(false);

    }

    box.show_all();

    // fetch
    Utils.fetch_change_log(Me.metadata.version.toString(), change_log);

    return box;
}

