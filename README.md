# Plugged-Kbd gnome-shell extension

Gnome-shell extension that change automatically input method when a keyboard is plugged in or out.

# Why using this extension ?

Some peoples love keyboards (I do!). But those keyboards can have various layouts. For instance, the
"Azerty" layout is very popular in France. There is also alternative physical layouts such as "dvorak", "colemak", "bépo"...

So, you end up having to change the input source in gnome each time you plug in a keyboard with an alternative layout... or
each time you dock or undock your laptop (if your alternative keyboard is connected to the docking station).

Of course, it is _possible_ to setup an udev rule that call a script when you plug a device in, that change the xkbd layout
for this device only. But I find that method impractical and hard to maintain.

This extension do the input-changing job for you. After you associate an input source to a keyboard, it automatically set
it when the keyboard is connected, and set it back to default when disconnected.

# Limitations

Only USB keyboards were tested. I have no idea about wireless or bluetooth keyboards.

Udev is used to get info about the input devices, and should be present.

