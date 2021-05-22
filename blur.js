// Bing Wallpaper GNOME extension
// Copyright (C) 2017-2021 Michael Carroll
// This extension is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// See the GNU General Public License, version 3 or later for details.
// Based on GNOME shell extension NASA APOD by Elia Argentieri https://github.com/Elinvention/gnome-shell-extension-nasa-apod
// This code based on https://github.com/PRATAP-KUMAR/Control_Blur_Effect_On_Lock_Screen

const St = imports.gi.St;
const Main = imports.ui.main;
const Shell = imports.gi.Shell;
const Background = imports.ui.background;
const UnlockDialog = imports.ui.unlockDialog.UnlockDialog;
const ExtensionUtils = imports.misc.extensionUtils;
var _createBackground = UnlockDialog.prototype._createBackground;
var _updateBackgroundEffects = UnlockDialog.prototype._updateBackgroundEffects;
const Me = ExtensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;

var shellVersionMajor = parseInt(imports.misc.config.PACKAGE_VERSION.split('.')[0]);
var shellVersionMinor = parseInt(imports.misc.config.PACKAGE_VERSION.split('.')[1]);
var shellVersionPoint = parseInt(imports.misc.config.PACKAGE_VERSION.split('.')[2]);

var blur_strength = 2;
var blur_brightness = 55;
var debug = true;

var blurMode = whichVersion();

function log(msg) {
    if (debug)
        print("BingWallpaper extension/Blur: " + msg); // disable to keep the noise down in journal
}

var Blur = class Blur {
    constructor() {
        log('Blur mode is '+blurMode);
    }

    _do_blur_v1(monitorIndex) {
        // GNOME shell 3.36.3 and below (FIXME: this needs work)
        log("_do_blur() called for shell < 3.36.4");
        let monitor = Main.layoutManager.monitors[monitorIndex];
        let widget = new St.Widget({
            style_class: 'screen-shield-background',
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
        });

        let bgManager = new Background.BackgroundManager({
            container: widget,
            monitorIndex,
            controlPosition: false,
        });
        this._bgManagers.push(bgManager);
        this._backgroundGroup.add_child(widget);
        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        log("blur strength: " + blur_strength +" blur brightness: "+blur_brightness);
        let effect = new Shell.BlurEffect({ brightness: blur_brightness * 0.01, sigma: blur_strength * themeContext.scale_factor / 5 });
        this._scaleChangedId = themeContext.connect('notify::scale-factor', () => { effect.sigma = SIGMA_VALUE * themeContext.scale_factor; });
        widget.add_effect(effect);
    }

    _do_blur_v2(monitorIndex) {
        // GNOME shell 3.36.4 and above
        log("_do_blur() called for shell >= 3.36.4");
        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        for (const widget of this._backgroundGroup.get_children()) {
            widget.get_effect('blur').set({
                brightness: blur_brightness * 0.01,
                sigma: blur_strength * themeContext.scale_factor,
            });
        } 
    
    }

    set_blur_strength(value) {
        if (value > 100 )
            value = 100;
        if (value < 0 )
            value = 0;
        blur_strength = value;
        log("lockscreen blur strength set to "+value);
    }

    set_blur_brightness(value) {
        if (value > 100)
            value = 100;
        if (value < 0 )
            value = 0;
        blur_brightness = value;
        log("lockscreen brightness set to " + value);
    }

    _switch(enabled) {
        if (enabled) {
            this._enable();
        }
        else {
            this._disable();
        }
    }

    _enable() {
        log("_enable() called on GNOME "+imports.misc.config.PACKAGE_VERSION);
        if (blurMode == 1) {
            UnlockDialog.prototype._createBackground = this._do_blur_v1;
        }
        else if (blurMode == 2) {
            UnlockDialog.prototype._updateBackgroundEffects = this._do_blur_v2;
        }
        else {
            log("shell version too old, no overriding");
        }
    }

    _disable() {
        log("_lockscreen_blur_disable() called");
        if (blurMode == 1) {
            UnlockDialog.prototype._createBackground = _createBackground;
        }
        else if (blurMode == 2) {
            UnlockDialog.prototype._updateBackgroundEffects = _updateBackgroundEffects;
        }
        else {
            log("shell version too old, no overriding");
        }
    }
}

function whichVersion() {
    if ((shellVersionMajor == 3 && shellVersionMinor >= 36) || shellVersionMajor == 40) {
        if (shellVersionMajor == 3 && shellVersionMinor == 36 && shellVersionPoint <= 3) {
            return 1;
        }
        else {
            return 2
        }
    }
    else {
        return 0;
    }
}
