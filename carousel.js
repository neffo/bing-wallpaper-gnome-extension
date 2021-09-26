// Bing Wallpaper GNOME extension
// Copyright (C) 2017-2021 Michael Carroll
// This extension is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// See the GNU General Public License, version 3 or later for details.
// Based on GNOME shell extension NASA APOD by Elia Argentieri https://github.com/Elinvention/gnome-shell-extension-nasa-apod

const { Gtk, Gdk, GdkPixbuf, Gio, GLib } = imports.gi;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;
const Lang = imports.lang;

const Convenience = Me.imports.convenience;
const Gettext = imports.gettext.domain('BingWallpaper');
const _ = Gettext.gettext;
const default_dimensions = [30, 30, 1500, 800]; // TODO: pull from and save dimensions to settings, but perhaps verify that dimensions are ok

const GALLERY_THUMB_WIDTH = 320;
const GALLERY_THUMB_HEIGHT = 180;

var Carousel = class Carousel {
    constructor(settings, button = null, callbackfunc = null) {
        //create_gallery(widget, settings);
        log('create carousel...');
        this.settings = settings;
        this.button = button;
        this.callbackfunc = callbackfunc;
        this.imageList = Utils.getImageList(this.settings).reverse(); // get images and reverse order
        // disable the button
        if (this.button)
            this.button.set_sensitive(false);
        [this.window, this.flowBox] = this._create_gallery_window(_('Bing Wallpaper Gallery'), default_dimensions);
        if (Gtk.get_major_version() < 4)
            this.window.show_all();
        else
            this.window.show();
        this.window.connect('destroy', function () {
            // re-enable the button
            if (button) {
                // enable the button again
                button.set_sensitive(true);
            }
            else {
                log('No button specified!');
            }
            log('Window destroyed...');
        });
        this._create_gallery();
    }

    _create_gallery_window(title, dimensions) {
        let buildable = new Gtk.Builder();
        let win = new Gtk.Window();
        let flowBox;
        win.set_default_size(dimensions[2], dimensions[3]);
        win.set_title(title);
        if (Gtk.get_major_version() < 4) {
            buildable.add_objects_from_file(Me.dir.get_path() + '/ui/carousel.ui', ['carouselScrollable']);
            flowBox = buildable.get_object('carouselFlowBox');
            win.add(buildable.get_object('carouselScrollable'));
        }
        else {
            buildable.add_objects_from_file(Me.dir.get_path() + '/ui/carousel4.ui', ['carouselScrollable']);
            flowBox = buildable.get_object('carouselFlowBox');
            win.set_child(buildable.get_object('carouselScrollable'));
        }
        return [win, flowBox];
    }

    _create_gallery() {
        let that = this;
        Utils.randomIntervals.forEach(function (seconds, i) {
            let item = that._create_random_item(seconds, Utils.randomIntervalsTitle[i]);
            if (Gtk.get_major_version() < 4)
                that.flowBox.add(item);
            else 
                that.flowBox.insert(item, -1);
        });
        this.imageList.forEach(function (image) {
            let item = that._create_gallery_item(image);
            if (Gtk.get_major_version() < 4)
                that.flowBox.add(item);
            else 
                that.flowBox.insert(item, -1);
        });
    }

    _create_gallery_item(image) {
        let that = this;
        let buildable = new Gtk.Builder();
        if (Gtk.get_major_version() < 4) // grab appropriate object from UI file
            buildable.add_objects_from_file(Me.dir.get_path() + '/ui/carousel.ui', ["flowBoxChild"]);
        else
            buildable.add_objects_from_file(Me.dir.get_path() + '/ui/carousel4.ui', ["flowBoxChild"]);
        let galleryImage = buildable.get_object('galleryImage');
        let imageLabel = buildable.get_object('imageLabel');
        let filename = Utils.imageToFilename(this.settings, image);
        let applyButton = buildable.get_object('applyButton');
        let deleteButton = buildable.get_object('deleteButton');
        try {
            this._load_image(galleryImage, filename);
        }
        catch (e) {
            if (Gtk.get_major_version() < 4) {
                galleryImage.set_from_icon_name('image-missing', '64x64');
            }
            else {
                galleryImage.set_from_icon_name('image-missing');
            }
            galleryImage.set_icon_size = 2; // Gtk.GTK_ICON_SIZE_LARGE;
            log('create_gallery_image: '+e);
        }
        galleryImage.set_tooltip_text(Utils.getImageTitle(image));
        imageLabel.set_width_chars(60);
        imageLabel.set_label(Utils.shortenName(Utils.getImageTitle(image), 60));
        /*galleryImage.connect('clicked', function (widget) {
            Utils.openInSystemViewer(filename);
        });*/
        applyButton.connect('clicked', function(widget) {
            that.settings.set_string('selected-image', Utils.getImageUrlBase(image));
            log('gallery selected '+Utils.getImageUrlBase(image));
        });
        deleteButton.connect('clicked', function(widget) {
            log('Delete requested for '+filename);
            Utils.deleteImage(filename);
            Utils.cleanupImageList(that.settings);
            widget.get_parent().get_parent().destroy(); // bit of a hack
            if (that.callbackfunc)
                that.callbackfunc();
        });
        //deleteButton.set_sensitive(false);
        let item = buildable.get_object('flowBoxChild');
        return item;
    }

    _create_random_item(seconds, title) {
        let that = this;
        let buildable = new Gtk.Builder();
        if (Gtk.get_major_version() < 4) // grab appropriate object from UI file
            buildable.add_objects_from_file(Me.dir.get_path() + '/ui/carousel.ui', ["flowBoxRandom"]);
        else
            buildable.add_objects_from_file(Me.dir.get_path() + '/ui/carousel4.ui', ["flowBoxRandom"]);
        let randomLabel = buildable.get_object('randomLabel');
        randomLabel.set_label(title);
        let filename = 'random';
        let applyButton = buildable.get_object('randomButton');

        applyButton.connect('clicked', function(widget) {
            that.settings.set_string('selected-image', filename);
            that.settings.set_int('random-interval', seconds);
            log('gallery selected random with interval '+seconds);
        });
        let item = buildable.get_object('flowBoxRandom');
        return item;
    }

    _load_image(galleryImage, filename) {
        let thumb_path = Utils.getWallpaperDir(this.settings)+'.thumbs/';
        let thumb_dir = Gio.file_new_for_path(thumb_path);
        if (!thumb_dir.query_exists(null)) {
            thumb_dir.make_directory_with_parents(null);
        }
        let image_file = Gio.file_new_for_path(filename);
        //log('thumbpath -> '+ thumb_path);
        if (!image_file.query_exists(null)){
            this._set_blank_image(galleryImage);
        }
        else {
            let image_thumb_path = thumb_path + image_file.get_basename();
            let image_thumb = Gio.file_new_for_path(image_thumb_path);
            try {
                let pixbuf;
                if (image_thumb.query_exists(null)) { // use thumbnail if available
                    pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_size(image_thumb_path, GALLERY_THUMB_WIDTH, GALLERY_THUMB_HEIGHT);
                }
                else {
                    pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_size(filename, GALLERY_THUMB_WIDTH, GALLERY_THUMB_HEIGHT);
                    pixbuf.savev(image_thumb_path,'jpeg',['quality'], ['90']);
                }
                galleryImage.set_from_pixbuf(pixbuf);
            }
            catch (e) {
                this._set_blank_image(galleryImage);
                log('create_gallery_image: '+e);
            }
        }
    }

    _set_blank_image(galleryImage) {
        if (Gtk.get_major_version() < 4) {
            galleryImage.set_from_icon_name('image-missing', '64x64');
        }
        else {
            galleryImage.set_from_icon_name('image-missing');
        }
        galleryImage.set_icon_size = 2; // Gtk.GTK_ICON_SIZE_LARGE;
    }
};
