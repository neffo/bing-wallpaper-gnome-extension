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

const Gettext = imports.gettext.domain('BingWallpaper');
const _ = Gettext.gettext;
const default_dimensions = [30, 30, 1650, 800]; // TODO: pull from and save dimensions to settings, but perhaps verify that dimensions are ok

const GALLERY_THUMB_WIDTH = 320;
const GALLERY_THUMB_HEIGHT = 180;

var Carousel = class Carousel {
    constructor(settings, button = null, callbackfunc = null, prefs_flowbox = null) {
        //create_gallery(widget, settings);
        this.settings = settings;
        this.button = button;
        this.callbackfunc = callbackfunc;
        this.flowBox = null;
        this.window = null;
        this.imageList = Utils.imageListSortByDate(Utils.getImageList(this.settings)).reverse(); // get images and reverse order
        this.log('create carousel...');
        // disable the button
        //if (this.button)
        //    this.button.set_sensitive(false);
        if (!prefs_flowbox) {    
            [this.window, this.flowBox] = this._create_gallery_window(_('Bing Wallpaper Gallery'), default_dimensions);
            if (Gtk.get_major_version() < 4)
                this.window.show_all();
            else
                this.window.show();
            //this.window.connect('destroy', this._enable_button);
        }
        else {
            this.flowBox = prefs_flowbox;
        }
        if (Gtk.get_major_version() < 4) {
            this._create_gallery();
        }
        else {
            this.flowBox.insert(this._create_placeholder_item(), -1);
        }
    }

    _enable_button() {
        if (this.button) {
            this.button.set_sensitive(state);
        }
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
            buildable.add_objects_from_file(Me.dir.get_path() + '/ui/carousel4.ui', ['carouselViewPort']);
            flowBox = buildable.get_object('carouselFlowBox');
            win.set_child(buildable.get_object('carouselScrollable'));
        }
        return [win, flowBox];
    }

    _create_gallery() {
        Utils.randomIntervals.forEach((seconds, i) => {
            let item = this._create_random_item(seconds, Utils.randomIntervalsTitle[i]);
            if (Gtk.get_major_version() < 4)
                this.flowBox.add(item);
            else 
                this.flowBox.insert(item, -1);
        });
        this.imageList.forEach((image) => {
            let item = this._create_gallery_item(image);
            if (Gtk.get_major_version() < 4)
                this.flowBox.add(item);
            else 
                this.flowBox.insert(item, -1);
        });
    }

    _create_gallery_item(image) {
        let buildable = new Gtk.Builder();
        if (Gtk.get_major_version() < 4) // grab appropriate object from UI file
            buildable.add_objects_from_file(Me.dir.get_path() + '/ui/carousel.ui', ["flowBoxChild"]);
        else
            buildable.add_objects_from_file(Me.dir.get_path() + '/ui/carousel4.ui', ["flowBoxChild"]);
        let galleryImage = buildable.get_object('galleryImage');
        // let imageLabel = buildable.get_object('imageLabel');
        let filename = Utils.imageToFilename(this.settings, image);
        let viewButton = buildable.get_object('viewButton');
        let applyButton = buildable.get_object('applyButton');
        let infoButton = buildable.get_object('infoButton');
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
            this.log('create_gallery_image: '+e);
        }
        galleryImage.set_tooltip_text(image.copyright);
        /*imageLabel.set_width_chars(60);
        imageLabel.set_label(Utils.shortenName(Utils.getImageTitle(image), 60));*/
        viewButton.connect('clicked',  () => {
            Utils.openInSystemViewer(filename);
        });
        applyButton.connect('clicked', () => {
            this.settings.set_string('selected-image', Utils.getImageUrlBase(image));
            this.log('gallery selected '+Utils.getImageUrlBase(image));
        });
        infoButton.connect('clicked', () => {
            Utils.openInSystemViewer(image.copyrightlink, false);
            this.log('info page link opened '+image.copyrightlink);
        });
        deleteButton.connect('clicked', (widget) => {
            this.log('Delete requested for '+filename);
            Utils.deleteImage(filename);
            Utils.cleanupImageList(this.settings);
            widget.get_parent().get_parent().set_visible(false); // bit of a hack
            if (this.callbackfunc)
                this.callbackfunc();
        });
        //deleteButton.set_sensitive(false);
        let item = buildable.get_object('flowBoxChild');
        return item;
    }

    _create_random_item(seconds, title) {
        let buildable = new Gtk.Builder();
        if (Gtk.get_major_version() < 4) {// grab appropriate object from UI file {}
            buildable.add_objects_from_file(Me.dir.get_path() + '/ui/carousel.ui', ["flowBoxRandom"]);
        }
        else {
            buildable.add_objects_from_file(Me.dir.get_path() + '/ui/carousel4.ui', ["flowBoxRandom"]);
        }
        let randomLabel = buildable.get_object('randomLabel');
        randomLabel.set_text(title);
        let filename = 'random';
        let applyButton = buildable.get_object('randomButton');

        applyButton.connect('clicked', (widget) => {
            this.settings.set_string('selected-image', filename);
            this.settings.set_int('random-interval', seconds);
            this.log('gallery selected random with interval '+seconds);
        });
        let item = buildable.get_object('flowBoxRandom');
        return item;
    }

    _create_placeholder_item() {
        let buildable = new Gtk.Builder();
        this.flowBox.set_max_children_per_line(1);
        if (Gtk.get_major_version() >= 4) {// grab appropriate object from UI file {}
            buildable.add_objects_from_file(Me.dir.get_path() + '/ui/carousel4.ui', ["flowBoxPlaceholder"]);
        }
        else {
            return null;
        }

        let loadButton = buildable.get_object('loadButton');

        loadButton.connect('clicked', (widget) => {
            this.flowBox.remove(widget.get_parent());
            this.flowBox.set_max_children_per_line(2);
            this._create_gallery();
        });
        let item = buildable.get_object('flowBoxPlaceholder');
        return item;
    }

    _load_image(galleryImage, filename) {
        let thumb_path = Utils.getWallpaperDir(this.settings)+'.thumbs/';
        let thumb_dir = Gio.file_new_for_path(thumb_path);
        let save_thumbs = !this.settings.get_boolean('delete-previous') && this.settings.get_boolean('create-thumbs'); // create thumbs only if not deleting previous and thumbs are enabled
        if (!thumb_dir.query_exists(null)) {
            thumb_dir.make_directory_with_parents(null);
        }
        let image_file = Gio.file_new_for_path(filename);
        if (!image_file.query_exists(null)){
            this._set_blank_image(galleryImage);
        }
        else {
            let image_thumb_path = thumb_path + image_file.get_basename();
            let image_thumb = Gio.file_new_for_path(image_thumb_path);
            try {
                let pixbuf;
                if (image_thumb.query_exists(null)) { // use thumbnail if available
                    pixbuf = GdkPixbuf.Pixbuf.new_from_file(image_thumb_path);
                }
                else { // significantly speeds up gallery loading, but costs some addtional disk space
                    pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_size(filename, GALLERY_THUMB_WIDTH, GALLERY_THUMB_HEIGHT);
                    if (save_thumbs)
                        pixbuf.savev(image_thumb_path,'jpeg',['quality'], ['90']);
                }
                if (Gtk.get_major_version() < 4) {
                    galleryImage.set_from_pixbuf(pixbuf);
                }
                else {
                    galleryImage.set_pixbuf(pixbuf);
                }
                    
            }
            catch (e) {
                this._set_blank_image(galleryImage);
                this.log('create_gallery_image: '+e);
            }
        }
    }

    _set_blank_image(galleryImage) {
        if (Gtk.get_major_version() < 4) {
            galleryImage.set_from_icon_name('image-missing', '64x64');
            galleryImage.set_icon_size = 3; // Gtk.GTK_ICON_SIZE_LARGE;
        }
        else {
            //galleryImage.set_from_icon_name('image-missing');
            //galleryImage.set_icon_size = 2; // Gtk.GTK_ICON_SIZE_LARGE;
        }
        
    }

    log(msg) {
        if (this.settings.get_boolean('debug-logging'))
            print("BingWallpaper extension: " + msg); // disable to keep the noise down in journal
    }
};