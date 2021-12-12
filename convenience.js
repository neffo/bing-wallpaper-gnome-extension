/* -*- mode: js; js-basic-offset: 4; indent-tabs-mode: nil -*- */
/*
  Copyright (c) 2011-2012, Giovanni Campagna <scampa.giovanni@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * Neither the name of the GNOME nor the
      names of its contributors may be used to endorse or promote products
      derived from this software without specific prior written permission.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
  ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
  WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
  DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
  SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

const Config = imports.misc.config;

const versionArray = (v) => v.split(".").map(Number);

const zip = function(a, b, defaultValue) {
    if (a.length === 0 && b.length === 0) {
        return [];
    }
    const headA = (a.length > 0) ? a.shift() : defaultValue;
    const headB = (b.length > 0) ? b.shift() : defaultValue;
    return [[headA, headB]].concat(zip(a, b, defaultValue));
};

function versionEqual(a, b) {
    return zip(versionArray(a), versionArray(b), 0).reduce(
        (prev, [a, b]) => prev && (a === b)
        , true);
}

function versionGreater(a, b) {
    const diff = zip(versionArray(a), versionArray(b), 0).find(([a, b]) => a !== b);
    if (!diff) {
        return false;
    }
    const [x, y] = diff;
    return x > y;
}

function versionSmaller(a, b) {
    return (!versionEqual(a, b)) && (!versionGreater(a, b));
}

function currentVersion() {
    return Config.PACKAGE_VERSION;
}

function currentVersionEqual(v) {
    return versionEqual(currentVersion(), v);
}

function currentVersionGreater(v) {
    return versionGreater(currentVersion(), v);
}

function currentVersionGreaterEqual(v) {
    return versionEqual(currentVersion(), v)
      || versionGreater(currentVersion(), v);
}

function currentVersionSmaller(v) {
    return versionSmaller(currentVersion(), v);
}

function currentVersionSmallerEqual(v) {
    return versionEqual(currentVersion(), v)
      && (!versionGreater(currentVersion(), v));
}

var exports = {
    currentVersion,
    currentVersionEqual,
    currentVersionGreater,
    currentVersionGreaterEqual,
    currentVersionSmaller,
    currentVersionSmallerEqual
};

