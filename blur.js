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
const ScreenShield = imports.ui.screenShield;
const UnlockDialog = imports.ui.unlockDialog.UnlockDialog;
const ExtensionUtils = imports.misc.extensionUtils;
var _updateBackgroundEffects = UnlockDialog.prototype._updateBackgroundEffects;
var _showClock = UnlockDialog.UnlockDialog.prototype._showClock;
var _showPrompt = UnlockDialog.UnlockDialog.prototype._showPrompt;
const Me = ExtensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;

var shellVersionMajor = parseInt(imports.misc.config.PACKAGE_VERSION.split('.')[0]);
var shellVersionMinor = parseInt(imports.misc.config.PACKAGE_VERSION.split('.')[1]);
var shellVersionPoint = parseInt(imports.misc.config.PACKAGE_VERSION.split('.')[2]);

var BWP_BLUR_SIGMA = 2;
var BWP_BLUR_BRIGHTNESS = 55;
var debug = false;

let blurEnabled = false;

function log(msg) {
    if (debug)
        print("BingWallpaper extension/Blur: " + msg); // disable to keep the noise down in journal
}

function _updateBackgroundEffects_BWP(monitorIndex) {
    // GNOME shell 3.36.4 and above
    log("_updateBackgroundEffects_BWP() called for shell >= 3.36.4");
    const themeContext = St.ThemeContext.get_for_stage(global.stage);
    for (const widget of this._backgroundGroup.get_children()) {
        let effects = widget.get_effects(); // first remove effects
        if (effects.length > 0) {
            widget.myEffect = effects[0];
            widget.remove_effect(widget.myEffect);
        }
        // set blur effects
        if (this._activePage === this._promptBox) { // default blur level for GNOME when prompt is active
            widget.get_effect('blur').set({ // GNOME defaults
                brightness: BLUR_BRIGHTNESS,
                sigma: BLUR_SIGMA * themeContext.scale_factor,
            });
        }
        else {
            widget.get_effect('blur').set({ // adjustable blur
                brightness: BWP_BLUR_BRIGHTNESS * 0.01, // we use 0-100 rather than 0-1, so divide by 100
                sigma: BWP_BLUR_SIGMA * themeContext.scale_factor,
            });
        }
    }
    blurEnabled = true;
}

function _showClock_BWP() {
    this._updateBackgrounds();
    this._showClock_GNOME();
}

function _showPrompt_BWP() {
    this._updateBackgrounds();
    this._showPrompt_GNOME();
}

var Blur = class Blur {
    constructor() {
        log('Blur mode is '+blurMode);
    }

    set_blur_strength(value) {
        if (value > 100 )
            value = 100;
        if (value < 0 )
            value = 0;
        BWP_BLUR_SIGMA = value;
        log("lockscreen blur strength set to "+value);
    }

    set_blur_brightness(value) {
        if (value > 100)
            value = 100;
        if (value < 0 )
            value = 0;
        BWP_BLUR_BRIGHTNESS = value;
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
        if (supportedVersion()) {
            UnlockDialog.prototype._updateBackgroundEffects = _updateBackgroundEffects_BWP;
            // we override _showClock and _showPrompt to patch in updates to blur effect before calling the GNOME functions
            UnlockDialog.UnlockDialog.prototype._showClock_GNOME = _showClock;
            UnlockDialog.UnlockDialog.prototype._showClock = _showClock_BWP;
            UnlockDialog.UnlockDialog.prototype._showPrompt_GNOME = _showPrompt;
            UnlockDialog.UnlockDialog.prototype._showPrompt = _showPrompt_BWP;
        }
        else {
            log("shell version not supported, no overriding");
        }
    }

    _disable() {
        if (blurEnabled == false) // nothing to do, don't clash with other extensions that do the same or similar
            return;
        log("_lockscreen_blur_disable() called");
        if (supportedVersion()) {
            UnlockDialog.prototype._updateBackgroundEffects = _updateBackgroundEffects;
        }
        else {
            log("shell version not supported, no overriding");
        }
    }
};

function supportedVersion() {
    if (shellVersionMajor >= 40 ||
        (shellVersionMajor == 3 && shellVersionMinor == 36 && shellVersionPoint >= 4)) {
        return true;
    }

    return false;
}
