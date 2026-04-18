// Bing Wallpaper GNOME extension
// Copyright (C) 2017-2025 Michael Carroll
// This extension is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// See the GNU General Public License, version 3 or later for details.
// Based on GNOME shell extension NASA APOD by Elia Argentieri https://github.com/Elinvention/gnome-shell-extension-nasa-apod
// This code based on https://github.com/PRATAP-KUMAR/Control_Blur_Effect_On_Lock_Screen 
// and https://github.com/sunwxg/gnome-shell-extension-unlockDialogBackground

import St from 'gi://St';
import * as UnlockDialog from 'resource:///org/gnome/shell/ui/unlockDialog.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
var _updateBackgroundEffects = UnlockDialog.UnlockDialog.prototype._updateBackgroundEffects;
var _showClock = UnlockDialog.UnlockDialog.prototype._showClock;
var _showPrompt = UnlockDialog.UnlockDialog.prototype._showPrompt;
var _setTransitionProgress = UnlockDialog.UnlockDialog.prototype._setTransitionProgress;

var shellVersionMajor = parseInt(Config.PACKAGE_VERSION.split('.')[0]);
var shellVersionMinor = parseInt(Config.PACKAGE_VERSION.split('.')[1]);
var shellVersionPoint = parseInt(Config.PACKAGE_VERSION.split('.')[2]);

var blurField = shellVersionMajor >= 46 ? "radius" : "sigma";
// default BWP mild blur
var BWP_BLUR_SIGMA = 2;
var BWP_BLUR_BRIGHTNESS = 55;
// GNOME defaults
var BLUR_BRIGHTNESS = 0.55;
var BLUR_SIGMA = 60;
var debug = false;

var promptActive = false;   // default GNOME method of testing this relies on state of a transisiton
                            // so we are being explicit here (do not want any races, thanks)

function BingLog(msg) {
    if (debug) // set 'debug' above to false to keep the noise down in journal
        console.log("BingWallpaper extension/Blur: " + msg); 
}

export function _updateBackgroundEffects_BWP(monitorIndex) {
    // GNOME shell 3.36.4 and above
    BingLog("_updateBackgroundEffects_BWP() called for shell >= 3.36.4");
    const themeContext = St.ThemeContext.get_for_stage(global.stage);
    for (const widget of this._backgroundGroup.get_children()) {
        // set blur effects, we have two modes in lockscreen: login prompt or clock
        // blur on when clock is visible is adjustable
        const effect = widget.get_effect('blur');
        if (promptActive) { 
            BingLog('default blur active');
            if (effect) {
                effect.set({ // GNOME defaults when login prompt is visible
                    brightness: BLUR_BRIGHTNESS,
                    [blurField]: BLUR_SIGMA * themeContext.scale_factor,
                });
            }
        }
        else {
            BingLog('adjustable blur active');
            if (effect) {
                effect.set({ // adjustable blur when clock is visible
                    brightness: BWP_BLUR_BRIGHTNESS * 0.01, // we use 0-100 rather than 0-1, so divide by 100
                    [blurField]: BWP_BLUR_SIGMA * themeContext.scale_factor,
                });
            }
        }
    }
}

// we patch both UnlockDialog._showClock() and UnlockDialog._showPrompt() to let us 
// adjustable blur in a Windows-like way (this ensures login prompt is readable)
export function _showClock_BWP() {
    promptActive = false;
    this._showClock_GNOME(); // pass to default GNOME function
}

export function _showPrompt_BWP() {
    promptActive = true;
    this._showPrompt_GNOME(); // pass to default GNOME function
}

export function _setTransitionProgress_BWP(progress) {
    this._setTransitionProgress_GNOME(progress);
    const themeContext = St.ThemeContext.get_for_stage(global.stage);
    for (const widget of this._backgroundGroup.get_children()) {
        const effect = widget.get_effect('blur');
        if (effect) {
            // interpolate between BWP and GNOME values
            // progress is 0-1, aka clock-prompt
            let blur = BWP_BLUR_SIGMA + (BLUR_SIGMA - BWP_BLUR_SIGMA) * progress; 
            let bright = 1.0;

            // WORKAROUND: brightness does not work without blur, so we set it to 1.0 when blur is 0.
            if (BWP_BLUR_SIGMA == 0) {
                bright = 1.0 + (BLUR_BRIGHTNESS -1.0) * progress;
            }
            else {
                bright = BWP_BLUR_BRIGHTNESS*0.01 + (BLUR_BRIGHTNESS - BWP_BLUR_BRIGHTNESS*0.01) * progress;
            }

            log('transition progress '+progress+' at blur '+blur+' brightness '+bright);
            effect.set({ // we use 0-100 rather than 0-1, so divide by 100
                brightness: bright,
                [blurField]: blur * themeContext.scale_factor, 
            });
        }
    }
}

export function _clampValue(value) {
       // valid values are 0 to 100
    if (value > 100)
        value = 100;
    if (value < 0 )
        value = 0;
    return value;
}
export default class Blur {
    constructor() {
        this.enabled = false;
        BingLog('Bing Wallpaper adjustable blur is '+(supportedVersion()?'available':'not available'));
    }

    set_blur_strength(value) {
        BWP_BLUR_SIGMA = _clampValue(value);
        BingLog("lockscreen blur strength set to "+BWP_BLUR_SIGMA);
    }

    set_blur_brightness(value) {
        BWP_BLUR_BRIGHTNESS = _clampValue(value);
        BingLog("lockscreen brightness set to " + BWP_BLUR_BRIGHTNESS);
    }

    _switch(enabled) {
        if (enabled && !this.enabled) {
            this._enable();
        }
        else {
            this._disable();
        }
    }

    _enable() {
        if (supportedVersion()) {
            BingLog("Blur._enable() called on GNOME "+Config.PACKAGE_VERSION);
            UnlockDialog.UnlockDialog.prototype._updateBackgroundEffects = _updateBackgroundEffects_BWP;
            // we override _showClock and _showPrompt to patch in updates to blur effect before calling the GNOME functions
            UnlockDialog.UnlockDialog.prototype._showClock = _showClock_BWP;
            UnlockDialog.UnlockDialog.prototype._showPrompt = _showPrompt_BWP;
            UnlockDialog.UnlockDialog.prototype._setTransitionProgress = _setTransitionProgress_BWP;

            // this are the original functions which we call into from our versions above
            UnlockDialog.UnlockDialog.prototype._showClock_GNOME = _showClock;
            UnlockDialog.UnlockDialog.prototype._showPrompt_GNOME = _showPrompt;
            UnlockDialog.UnlockDialog.prototype._setTransitionProgress_GNOME = _setTransitionProgress;
            
        }
        this.enabled = true;
    }

    _disable() {
        if (!this.enabled)
            return;
        BingLog("_lockscreen_blur_disable() called");
        if (supportedVersion()) {
            // restore default functions
            UnlockDialog.UnlockDialog.prototype._updateBackgroundEffects = _updateBackgroundEffects;
            UnlockDialog.UnlockDialog.prototype._showClock = _showClock;
            UnlockDialog.UnlockDialog.prototype._showPrompt = _showPrompt;
            UnlockDialog.UnlockDialog.prototype._setTransitionProgress = _setTransitionProgress;
            // clean up unused functions we created
            UnlockDialog.UnlockDialog.prototype._showClock_GNOME = null;
            delete UnlockDialog.UnlockDialog.prototype._showClock_GNOME;
            UnlockDialog.UnlockDialog.prototype._showPrompt_GNOME = null;
            delete UnlockDialog.UnlockDialog.prototype._showPrompt_GNOME;
            UnlockDialog.UnlockDialog.prototype._setTransitionProgress_GNOME = null;
            delete UnlockDialog.UnlockDialog.prototype._setTransitionProgress_GNOME;
        }
        this.enabled = false;
    }
};

function supportedVersion() { // when current lockscren blur implementation was first shipped (we ignore earlier weird version)
    if (shellVersionMajor >= 40 ||
        (shellVersionMajor == 3 && shellVersionMinor == 36 && shellVersionPoint >= 4)) {
        return true;
    }

    return false;
}
