// Bing Wallpaper GNOME extension
// Copyright (C) 2017-2023 Michael Carroll
// This extension is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// See the GNU General Public License, version 3 or later for details.
// Based on GNOME shell extension NASA APOD by Elia Argentieri https://github.com/Elinvention/gnome-shell-extension-nasa-apod

import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';
import Adw from 'gi://Adw';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import * as Config from 'resource:///org/gnome/Shell/Extensions/js/misc/config.js';
import * as Utils from './utils.js';
import Carousel from './carousel.js';

const BingImageURL = Utils.BingImageURL;

var DESKTOP_SCHEMA = 'org.gnome.desktop.background';

// this is pretty wide because of the size of the gallery
var PREFS_DEFAULT_WIDTH = 750;
var PREFS_DEFAULT_HEIGHT = 750;

export default class BingWallpaperExtensionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        // formally globals
        let settings = this.getSettings(Utils.BING_SCHEMA);
        //let desktop_settings = this.getSettings(Utils.DESKTOP_SCHEMA);

        window.set_default_size(PREFS_DEFAULT_WIDTH, PREFS_DEFAULT_HEIGHT);

        /*let icon_image = null;*/
        let provider = new Gtk.CssProvider();
        provider.load_from_path(this.dir.get_path() + '/ui/prefs.css');
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(),
            provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

        let carousel = null;
        let httpSession = null;

        let log = (msg) => { // avoids need for globals
            if (settings.get_boolean('debug-logging'))
                console.log("BingWallpaper extension: " + msg); // disable to keep the noise down in journal
        }
        
        let buildable = new Gtk.Builder();
        // GTK4 removes some properties, and builder breaks when it sees them
        buildable.add_from_file( this.dir.get_path() + '/ui/prefsadw.ui' );

        // adw or gtk objects we'll attach to below
        const settings_page = buildable.get_object('settings_page');
        const hideSwitch = buildable.get_object('hideSwitch');
        const notifySwitch = buildable.get_object('notifySwitch');
        const iconEntry = buildable.get_object('iconEntry');
        const bgSwitch = buildable.get_object('bgSwitch');
        const shuffleSwitch = buildable.get_object('shuffleSwitch');
        const shuffleInterval = buildable.get_object('shuffleInterval'); 
        const folderRow = buildable.get_object('folderRow');
        const lockscreen_page = buildable.get_object('lockscreen_page');
        const overrideSwitch = buildable.get_object('overrideSwitch');
        const blurPresets = buildable.get_object('blurPresets');
        const strengthEntry = buildable.get_object('strengthEntry');
        const brightnessEntry = buildable.get_object('brightnessEntry');
        const blurAdjustment = buildable.get_object('blurAdjustment');
        const brightnessAdjustment = buildable.get_object('brightnessAdjustment');
        const resolutionEntry = buildable.get_object('resolutionEntry');
        const debugSwitch = buildable.get_object('debug_switch');
        const revertSwitch = buildable.get_object('revert_switch');
        const trash_purge_switch = buildable.get_object('trash_purge_switch');
        const delete_previous_switch = buildable.get_object('delete_previous_switch');
        const delete_previous_adjustment = buildable.get_object('delete_previous_adjustment');
        const always_export_switch = buildable.get_object('always_export_switch');
        const gallery_page = buildable.get_object('gallery_page');
        const carouselFlowBox = buildable.get_object('carouselFlowBox');
        const randomIntervalEntry = buildable.get_object('entry_random_interval');
        const debug_page = buildable.get_object('debug_page');
        const json_actionrow = buildable.get_object('json_actionrow');
        const about_page = buildable.get_object('about_page');
        const version_button = buildable.get_object('version_button');
        const change_log = buildable.get_object('change_log');

        window.add(settings_page);
        window.add(lockscreen_page);
        window.add(gallery_page);       
        window.add(debug_page);
        window.add(about_page);

        iconEntry.set_value(1+Utils.icon_list.indexOf(settings.get_string('icon-name')));

        // shuffle intervals
        const shuffleIntervals  = new Gtk.StringList;
        Utils.randomIntervals.forEach((x) => {
            shuffleIntervals.append(_(x.title));
        });
       
        shuffleInterval.set_model(shuffleIntervals);
        shuffleInterval.set_selected(Utils.randomIntervals.map( e => e.value).indexOf(settings.get_string('random-interval-mode')));

        // add wallpaper folder open and change buttons
        const openBtn = new Gtk.Button( {
            child: new Adw.ButtonContent({
                        icon_name: 'folder-pictures-symbolic',
                        label: _('Open folder'),
                    },),
            valign: Gtk.Align.CENTER, 
            halign: Gtk.Align.CENTER,
        });
        const changeBtn = new Gtk.Button( {
            child: new Adw.ButtonContent({
                        icon_name: 'folder-download-symbolic',
                        label: _('Change folder'),
                    },),
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
        });

        folderRow.add_suffix(openBtn);
        folderRow.add_suffix(changeBtn);   

        blurAdjustment.set_value(settings.get_int('lockscreen-blur-strength'));
        brightnessAdjustment.set_value(settings.get_int('lockscreen-blur-brightness'));
        
        const defaultBtn = new Gtk.Button( {
            child: new Adw.ButtonContent({
                        icon_name: 'emblem-default-symbolic',
                        label: _('Default'),
                    },),
            valign: Gtk.Align.CENTER, 
            halign: Gtk.Align.CENTER,
        });
        const noBlurBtn = new Gtk.Button( {
            child: new Adw.ButtonContent({
                        icon_name: 'emblem-default-symbolic',
                        label: _('No blur, slight dim'),
                    },),
            valign: Gtk.Align.CENTER, 
            halign: Gtk.Align.CENTER,
        });
        const slightBlurBtn = new Gtk.Button( {
            child: new Adw.ButtonContent({
                        icon_name: 'emblem-default-symbolic',
                        label: _('Slight blur & dim'),
                    },),
            valign: Gtk.Align.CENTER, 
            halign: Gtk.Align.CENTER,
        });

        // add to presets row
        blurPresets.add_suffix(defaultBtn);
        blurPresets.add_suffix(noBlurBtn);
        blurPresets.add_suffix(slightBlurBtn);
        
        randomIntervalEntry.set_value(settings.get_int('random-interval'));

        // these buttons either export or import saved JSON data
        const buttonImportData = new Gtk.Button( {
            child: new Adw.ButtonContent({
                        icon_name: 'document-send-symbolic',
                        label: _('Import'),
                    },),
            valign: Gtk.Align.CENTER, 
            halign: Gtk.Align.CENTER,
        });
        const buttonExportData = new Gtk.Button( {
            child: new Adw.ButtonContent({
                        icon_name: 'document-save-symbolic',
                        label: _('Export'),
                    },),
            valign: Gtk.Align.CENTER, 
            halign: Gtk.Align.CENTER,
        });
        
        json_actionrow.add_suffix(buttonImportData);
        json_actionrow.add_suffix(buttonExportData);

        version_button.set_label(this.metadata.version.toString());      
       
        try {
            httpSession = new Soup.Session();
            httpSession.user_agent = 'User-Agent: Mozilla/5.0 (X11; GNOME Shell/' + Config.PACKAGE_VERSION + '; Linux x86_64; +https://github.com/neffo/bing-wallpaper-gnome-extension ) BingWallpaper Gnome Extension/' + this.metadata.version;
        }
        catch (e) {
            log("Error creating httpSession: " + e);
        }
        const icon_image = buildable.get_object('icon_image');
        
        // check that these are valid (can be edited through dconf-editor)
        Utils.validate_resolution(settings);
        Utils.validate_icon(settings, this.path, icon_image);
        Utils.validate_interval(settings);

        // Indicator & notifications
        settings.bind('hide', hideSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('notify', notifySwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.connect('changed::icon-name', () => {
            Utils.validate_icon(settings, this.path, icon_image);
            iconEntry.set_value(1 + Utils.icon_list.indexOf(settings.get_string('icon-name')));
        });
               
        iconEntry.connect('output', () => {
            settings.set_string('icon-name', Utils.icon_list[iconEntry.get_value()-1]);
        });

        // connect switches to settings changes
        settings.bind('set-background', bgSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('debug-logging', debugSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('revert-to-current-image', revertSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        //settings.bind('override-unsafe-wayland', unsafeSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('random-interval', randomIntervalEntry, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('trash-deletes-images', trash_purge_switch, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('always-export-bing-json', always_export_switch, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('delete-previous', delete_previous_switch, 'active', Gio.SettingsBindFlags.DEFAULT);

        // button opens Nautilus at our image folder
        openBtn.connect('clicked', (widget) => {
            Utils.openImageFolder(settings);
        });
        
        // we populate the tab (gtk4+, gnome 40+), this was previously a button to open a new window in gtk3
        carousel = new Carousel(settings, null, null, carouselFlowBox, this.dir.get_path()); // auto load carousel
        
        // this is intended for migrating image folders between computers (or even sharing) or backups
        // we export the Bing JSON data to the image directory, so this folder becomes portable
        buttonImportData.connect('clicked', () => {
            Utils.importBingJSON(settings);
        });
        buttonExportData.connect('clicked', () => {
            Utils.exportBingJSON(settings);
        });

        // change wallpaper button
        const dirChooser = new Gtk.FileDialog( {
            accept_label: "Select",
            modal: true,
            title: _("Select wallpaper download folder"),
        });

        changeBtn.connect('clicked', (widget) => {
            dirChooser.set_initial_folder(Gio.File.new_for_path(Utils.getWallpaperDir(settings)));
            dirChooser.select_folder(window, null, (self, res) => {
                let new_path = self.select_folder_finish(res).get_uri().replace('file://', '');
                log(new_path);
                Utils.moveImagesToNewFolder(settings, Utils.getWallpaperDir(settings), new_path);
                Utils.setWallpaperDir(settings, new_path);
            });

        });

        // Resolution
        const resolutionModel = new Gtk.StringList();
        Utils.resolutions.forEach((res) => { // add res to dropdown list (aka a GtkComboText)
            resolutionModel.append(res);
        });
        resolutionEntry.set_model(resolutionModel);
        
        settings.connect('changed::resolution', () => {
            resolutionEntry.set_selected(Utils.resolutions.map( e => e.value).indexOf(settings.get_string('resolution')));
        });

        settings.connect('changed::resolution', () => {
            Utils.validate_resolution(settings);
        });

        // shuffle modes
        settings.bind('random-mode-enabled', shuffleSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        /*settings.bind('random-interval-mode', entryShuffleMode, 'active_id', Gio.SettingsBindFlags.DEFAULT);*/

        settings.connect('changed::random-interval-mode', () => {
            shuffleInterval.set_selected(Utils.randomIntervals.map( e => e.value).indexOf(settings.get_string('random-interval-mode')));
        });
            
        // GDM3 lockscreen blur override
        settings.bind('override-lockscreen-blur', overrideSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('lockscreen-blur-strength', strengthEntry, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('lockscreen-blur-brightness', brightnessEntry, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('previous-days', delete_previous_adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);

        // add a couple of preset buttons
        defaultBtn.connect('clicked', (widget) => {
            Utils.set_blur_preset(settings, Utils.PRESET_GNOME_DEFAULT);
        });
        noBlurBtn.connect('clicked', (widget) => {
            Utils.set_blur_preset(settings, Utils.PRESET_NO_BLUR);
        });
        slightBlurBtn.connect('clicked', (widget) => {
            Utils.set_blur_preset(settings, Utils.PRESET_SLIGHT_BLUR);
        });
        
        // fetch change log (on about page)
        
        if (httpSession)
            Utils.fetch_change_log(this.metadata.version.toString(), change_log, httpSession);
    }
}
