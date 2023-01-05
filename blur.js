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
var _showClock = UnlockDialog.prototype._showClock;
var _showPrompt = UnlockDialog.prototype._showPrompt;
const Me = ExtensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;

var shellVersionMajor = parseInt(imports.misc.config.PACKAGE_VERSION.split('.')[0]);
var shellVersionMinor = parseInt(imports.misc.config.PACKAGE_VERSION.split('.')[1]);
var shellVersionPoint = parseInt(imports.misc.config.PACKAGE_VERSION.split('.')[2]);

// default BWP mild blur
var BWP_BLUR_SIGMA = 2;
var BWP_BLUR_BRIGHTNESS = 55;
// GNOME defaults
var BLUR_BRIGHTNESS = 0.55;
var BLUR_SIGMA = 60;
var debug = false;

let blurEnabled = false;
var promptActive = false; // default GNOME method of testing this relies on state of transisiton, so be implicit here

function log(msg) {
    if (debug)
        print("BingWallpaper extension/Blur: " + msg); // set 'debug' to false to keep the noise down in journal
}

function _updateBackgroundEffects_BWP(monitorIndex) {
    // GNOME shell 3.36.4 and above
    log("_updateBackgroundEffects_BWP() called for shell >= 3.36.4");
    const themeContext = St.ThemeContext.get_for_stage(global.stage);
    for (const widget of this._backgroundGroup.get_children()) {
        // set blur effects, we have two modes in lockscreen: clock or login prompt
        const effect = widget.get_effect('blur');
        if (promptActive) { 
            log('default blur active');
            if (effect) {
                effect.set({ // GNOME defaults when login prompt is visible
                    brightness: BLUR_BRIGHTNESS,
                    sigma: BLUR_SIGMA * themeContext.scale_factor,
                });
            }
        }
        else {
            log('adjustable blur active');
            if (effect) {
                effect.set({ // adjustable blur when clock is visible
                    brightness: BWP_BLUR_BRIGHTNESS * 0.01, // we use 0-100 rather than 0-1, so divide by 100
                    sigma: BWP_BLUR_SIGMA * themeContext.scale_factor,
                });
            }
        }
    }
    blurEnabled = true;
}

// we patch both _showClock and _showPrompt to let us adjust blur in a Windows-like way (this ensures login prompt is readable)
function _showClock_BWP() {
    log('show clock');
    promptActive = false;
    this._showClock_GNOME(); // pass to default GNOME function
    this._updateBackgroundEffects();
}

function _showPrompt_BWP() {
    log('show prompt');
    promptActive = true;
    this._showPrompt_GNOME(); // pass to default GNOME function
    this._updateBackgroundEffects();
}

var Blur = class Blur {
    constructor() {
        log('Bing Wallpaper adjustable blur is '+supportedVersion()?'available':'not available');
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
            UnlockDialog.prototype._showClock_GNOME = _showClock;
            UnlockDialog.prototype._showClock = _showClock_BWP;
            UnlockDialog.prototype._showPrompt_GNOME = _showPrompt;
            UnlockDialog.prototype._showPrompt = _showPrompt_BWP;
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
            UnlockDialog.prototype._showClock = _showClock;
            UnlockDialog.prototype._showPrompt = _showPrompt;
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
