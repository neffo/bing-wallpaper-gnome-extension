// required to set lock screen dialog background
// code taken from unlockDialogBackground@sun.wxg@gmail.com extension
// (by Xiaoguang Wang  - https://github.com/sunwxg)
// this self-contained file has been modified, and is under MIT license not GPL3

/*
MIT License

Copyright (c) 2018 Xiaoguang Wang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/

const Gio = imports.gi.Gio;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Mainloop = imports.mainloop;

const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const Tweener = imports.ui.tweener;

const BACKGROUND_SCHEMA = 'org.gnome.desktop.background';
const Background = imports.ui.background;
const ScreenShield = imports.ui.screenShield;
const Meta = imports.gi.Meta;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

const Gettext = imports.gettext.domain('gnome-shell-extensions');
const _ = Gettext.gettext;

let enabled = false;
let debug = false;

function log(msg) {
    if (debug)
        print("BingWallpaper extension: " + msg); // disable to keep the noise down in journal
}

function newInit(layoutManager, settingsSchema) {
    // Allow override the background image setting for performance testing
    this._layoutManager = layoutManager;
    this._overrideImage = GLib.getenv('SHELL_BACKGROUND_IMAGE');

    if (settingsSchema.includes("unlockDialogBackground"))
        this._settings = Convenience.getSettings(settingsSchema);
    else
        this._settings = new Gio.Settings({ schema_id: settingsSchema });

    this._backgrounds = [];

    let monitorManager = Meta.MonitorManager.get();
    this._monitorsChangedId =
        monitorManager.connect('monitors-changed',
                               this._onMonitorsChanged.bind(this));
}

class DialogBackground {
    constructor() {
        this._gsettings = Convenience.getSettings(BACKGROUND_SCHEMA);

        Background.BackgroundSource.prototype._init = newInit;
        enabled = false;

        this.connect_signal();
        this._switchChanged();
    }

    _createDialogBackground(monitorIndex) {
        let monitor = Main.layoutManager.monitors[monitorIndex];
        let widget = new St.Widget({ style_class: 'screen-shield-background',
                                     x: monitor.x,
                                     y: monitor.y,
                                     width: monitor.width,
                                     height: monitor.height });

        let bgManager = new Background.BackgroundManager({ container: widget,
                                                           monitorIndex: monitorIndex,
                                                           controlPosition: false,
                                                           vignette: true, // add vignette effect to assist visibility
                                                           settingsSchema: BACKGROUND_SCHEMA });

        Main.screenShield._bgDialogManagers.push(bgManager);
        Main.screenShield._backgroundDialogGroup.add_child(widget);
    }

    _updateDialogBackgrounds() {
        for (let i = 0; i < Main.screenShield._bgDialogManagers.length; i++)
            Main.screenShield._bgDialogManagers[i].destroy();

        Main.screenShield._bgDialogManagers = [];
        Main.screenShield._backgroundDialogGroup.destroy_all_children();

        for (let i = 0; i < Main.layoutManager.monitors.length; i++)
            this._createDialogBackground(i);
    }

    _switchChanged() {
        log("Switch changed(): "+ (enabled? "true": "false"));
        if (enabled) {
            log("Enabled unlock dialog bg...");
            Main.screenShield._backgroundDialogGroup = new Clutter.Actor();
            Main.screenShield._lockDialogGroup.add_actor(Main.screenShield._backgroundDialogGroup);
            Main.screenShield._backgroundDialogGroup.lower_bottom();
            Main.screenShield._bgDialogManagers = [];

            this._updateDialogBackgrounds();
            this._updateDialogBackgroundId = Main.layoutManager.connect('monitors-changed', this._updateDialogBackgrounds.bind(this));
        } else {
            log("Disabled unlock dialog bg...");
            if (Main.screenShield._backgroundDialogGroup == null)
                return;

            for (let i = 0; i < Main.screenShield._bgDialogManagers.length; i++)
                Main.screenShield._bgDialogManagers[i].destroy();

            Main.screenShield._bgDialogManagers = [];
            Main.screenShield._backgroundDialogGroup.destroy_all_children();
            Main.screenShield._backgroundDialogGroup.destroy();
            Main.screenShield._backgroundDialogGroup = null;

            if (this._updateDialogBackgroundId != null) {
                Main.layoutManager.disconnect(this._updateDialogBackgroundId);
                this._updateDialogBackgroundId = null;
            }
        }
    }

    connect_signal() {
        //this.watch('enabled', this._switchChanged.bind(this));
    }
}

let background;

function init() {
    background = new DialogBackground();
    log("unlockdialogbackground.init()");
}

function lsbg_enable() {
    enabled = true;
    log("unlockdialogbackground.enable()");
    background._switchChanged();
}

function lsbg_disable() {
    enabled = false;
    log("unlockdialogbackground.disable()");
    background._switchChanged();
}

function set_active(active) {
    if (typeof(active) === "boolean") {
        active ? lsbg_enable() : lsbg_disable();
    }
}