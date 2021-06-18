#!/usr/bin/env gjs

imports.gi.versions.Gtk = "3.0";
const { Gtk, GdkPixbuf } = imports.gi;

Gtk.init(null);

/* create a widget to demonstrate */
let buildable = new Gtk.Builder();
//buildable.add_from_file( Me.dir.get_path() + '/Settings4.ui' );
let win = new Gtk.Window();
buildable.add_from_file('carousel.ui');
let image = buildable.get_object('galleryImage');
let pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_size('/home/michael/Pictures/BingWallpaper/20190515-AbuSimbel_EN-AU0072035482_UHD.jpg', 480, 270);
image.set_from_pixbuf(pixbuf);

//let fb = buildable.get_object('carouselFlowBox');
//let fbc = buildable.get_object('flowBoxChild');
//fb.add(fbc);


win.add(buildable.get_object('carouselScrollable'));
//let flowBox = new Gtk.FlowBox();


win.show_all();

Gtk.main();